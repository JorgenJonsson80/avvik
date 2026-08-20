-- ============================================================================
-- 0004_secure_org_delete.sql — Täpp add_org_member-bypass + admin-only radering
-- ----------------------------------------------------------------------------
-- LIVE DATA. Ta en backup (Historik → Exportera Excel) innan du kör detta.
--
-- Extern säkerhetsgranskning hittade tre luckor i 0003_organizations.sql:
--
-- 1. add_org_member() (security definer) hade `if auth.uid() is not null
--    and not exists(admin-koll) then raise exception` — när auth.uid() är
--    NULL (en anropare utan inloggning, dvs bara anon-nyckeln) hoppade HELA
--    kontrollen över och funktionen körde igenom obehindrat. Ingen
--    `revoke execute` fanns, så RPC:n är nåbar för anon-rollen som standard.
-- 2. Alla RLS-policyer var `for all` utan rollkoll — "member" var bara en
--    etikett, identisk skriv/radera-behörighet som "admin".
-- 3. RLS aktiverades aldrig på organizations-tabellen (bara på org_members).
--
-- Denna migration låser bara RADERING till admin på de tabeller där ingen
-- legitim per-rad-radering sker i klientkoden (deviations, rader, settings,
-- deviation_audit — bara upsert/update i normal drift). scans och actions
-- lämnas oförändrade eftersom legitima scoped-raderingar sker där (scan-
-- ersättning vid reimport, ta bort egen loggad åtgärd). Läs/skriv (select/
-- insert/update) förblir öppet för alla org-medlemmar — vardagsflödet
-- (importera, redigera orsak/kommentar, logga åtgärd, uppdatera rader) är
-- opåverkat.
-- ============================================================================

-- 1. Fixa add_org_member — kräv admin OAVSETT auth.uid()-status.
-- Bootstrap (första admin) sker redan via direkt insert i backfill-steget
-- (körs som postgres, kringgår RLS) — ingen funktionalitet förloras.
create or replace function add_org_member(p_email text, p_org_id uuid, p_role text default 'member')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not exists (
    select 1 from org_members
    where user_id = auth.uid() and org_id = p_org_id and role = 'admin'
  ) then
    raise exception 'not authorized to add members to this org';
  end if;

  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'no auth user found for email % — bjud in via Dashboard → Authentication → Users → Invite först', p_email;
  end if;

  insert into org_members (org_id, user_id, role)
  values (p_org_id, v_user_id, p_role)
  on conflict (user_id) do update set org_id = excluded.org_id, role = excluded.role;
end;
$$;

-- 2. Härda grants — försvar i djup utöver punkt 1.
revoke all on function add_org_member(text, uuid, text) from public;
grant execute on function add_org_member(text, uuid, text) to authenticated;

-- 3. Aktivera RLS på organizations (glömdes i 0003). Ingen insert/update/
-- delete-policy → default-deny för alla via RLS; org-hantering sker även
-- fortsatt via SQL Editor som postgres (superuser kringgår RLS).
alter table organizations enable row level security;

drop policy if exists "read own org" on organizations;
create policy "read own org" on organizations
  for select using (id = my_org_id());

-- 4. deviations, rader, settings, deviation_audit: dela upp "for all" i
-- select/insert/update (öppet för org-medlemmar) + delete (kräver admin).
do $$
declare
  t text;
begin
  foreach t in array array['deviations', 'rader', 'settings', 'deviation_audit'] loop
    -- Rensa både den gamla breda policyn och ev. tidigare körning av denna
    -- migration (säker att köra om ifall den skulle avbrytas halvvägs).
    execute format('drop policy if exists %I on %I', 'org ' || t, t);
    execute format('drop policy if exists %I on %I', 'org ' || t || ' select', t);
    execute format('drop policy if exists %I on %I', 'org ' || t || ' insert', t);
    execute format('drop policy if exists %I on %I', 'org ' || t || ' update', t);
    execute format('drop policy if exists %I on %I', 'org ' || t || ' delete admin', t);

    execute format(
      'create policy %I on %I for select using (org_id = my_org_id())',
      'org ' || t || ' select', t
    );
    execute format(
      'create policy %I on %I for insert with check (org_id = my_org_id())',
      'org ' || t || ' insert', t
    );
    execute format(
      'create policy %I on %I for update using (org_id = my_org_id()) with check (org_id = my_org_id())',
      'org ' || t || ' update', t
    );
    execute format(
      'create policy %I on %I for delete using (org_id = my_org_id() and exists (
         select 1 from org_members
         where user_id = auth.uid() and org_id = %I.org_id and role = ''admin''
       ))',
      'org ' || t || ' delete admin', t, t
    );
  end loop;
end $$;

-- scans och actions: medvetet oförändrade (kvar som "for all", öppna för
-- alla org-medlemmar) — legitima scoped-raderingar sker där i normal drift.
