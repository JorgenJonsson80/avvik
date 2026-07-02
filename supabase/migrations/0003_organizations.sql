-- ============================================================================
-- 0003_organizations.sql — Delat team-ägarskap (steg mot multi-tenant)
-- ----------------------------------------------------------------------------
-- LIVE DATA. Ta en backup (Historik → Exportera Excel) och kör
-- `select id, email from auth.users;` för att bekräfta vilka konton som
-- finns INNAN du kör detta — backfill-steget lägger in ALLA i en gemensam
-- org som admin.
--
-- Varje tabell gick tidigare på user_id = auth.uid() (en användare = en
-- isolerad bubbla). Det gör att en kollega med eget konto ser en TOM app.
-- org_id + my_org_id() ersätter user_id som delnings-gräns, med exakt
-- samma mönster som user_id default auth.uid() redan använder — så
-- applikationskoden behöver bara byta onConflict-strängar, inget annat.
-- ============================================================================

-- 1. organizations
create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Mitt lager',
  created_at timestamptz default now()
);

-- 2. org_members — unique(user_id) enforcar EN org per användare för MVP.
-- Uppgradering till flera org per användare senare kräver även ett separat
-- "aktiv org"-koncept, inte bara att droppa den här begränsningen.
create table org_members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz default now(),
  primary key (org_id, user_id),
  unique (user_id)
);

alter table org_members enable row level security;

create policy "read own membership" on org_members
  for select using (auth.uid() = user_id);
-- Ingen insert/update/delete-policy för authenticated — org_members skrivs
-- bara via add_org_member() nedan, eller direkt som postgres i SQL Editor.

-- 3. my_org_id() — samma roll som auth.uid() redan spelar: kolumn-default
-- OCH RLS-predikat.
create or replace function my_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from org_members where user_id = auth.uid() limit 1;
$$;

-- 4. add_org_member — SECURITY DEFINER kringgår RLS, så den måste
-- verifiera själv att anroparen är admin i orgen. Undantaget för
-- auth.uid() is null tillåter bootstrap direkt i SQL Editor (ingen JWT-
-- kontext där) men blockerar missbruk om funktionen någonsin exponeras
-- via supabase.rpc() från klienten.
create or replace function add_org_member(p_email text, p_org_id uuid, p_role text default 'member')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if auth.uid() is not null and not exists (
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

-- 5. org_id på alla 6 tabeller. default my_org_id() gäller framåt (nya
-- inserts) — befintliga rader backfillas explicit nedan eftersom
-- auth.uid()/my_org_id() är NULL i migrationens serverkontext.
alter table deviations       add column org_id uuid references organizations(id) default my_org_id();
alter table scans            add column org_id uuid references organizations(id) default my_org_id();
alter table rader            add column org_id uuid references organizations(id) default my_org_id();
alter table settings         add column org_id uuid references organizations(id) default my_org_id();
alter table deviation_audit  add column org_id uuid references organizations(id) default my_org_id();
alter table actions          add column org_id uuid references organizations(id) default my_org_id();

-- 6. Backfill: en org, alla befintliga auth-users som admin, alla
-- befintliga rader flyttas till den orgen.
do $$
declare
  v_org_id uuid;
begin
  insert into organizations (name) values ('Mitt lager') returning id into v_org_id;

  insert into org_members (org_id, user_id, role)
  select v_org_id, id, 'admin' from auth.users;

  update deviations       set org_id = v_org_id where org_id is null;
  update scans            set org_id = v_org_id where org_id is null;
  update rader             set org_id = v_org_id where org_id is null;
  update settings          set org_id = v_org_id where org_id is null;
  update deviation_audit   set org_id = v_org_id where org_id is null;
  update actions           set org_id = v_org_id where org_id is null;
end $$;

-- 7. NOT NULL efter backfill.
alter table deviations       alter column org_id set not null;
alter table scans            alter column org_id set not null;
alter table rader            alter column org_id set not null;
alter table settings         alter column org_id set not null;
alter table deviation_audit  alter column org_id set not null;
alter table actions          alter column org_id set not null;

-- 8. Byt unika begränsningar från user_id-scopade till org_id-scopade.
-- KRITISKT: utan detta skapar två kollegor som scannar samma VNR samma
-- dag två separata rader istället för en delad.
alter table deviations drop constraint deviations_user_id_datum_vnr_key;
alter table deviations add constraint deviations_org_datum_vnr_key unique (org_id, datum, vnr);

alter table rader drop constraint rader_user_id_datum_key;
alter table rader add constraint rader_org_datum_key unique (org_id, datum);

alter table settings drop constraint settings_pkey;
alter table settings add constraint settings_org_id_key unique (org_id);

-- 9. Byt RLS-policies från user_id- till org_id-scopade.
drop policy "own rows" on deviations;
drop policy "own scans" on scans;
drop policy "own rader" on rader;
drop policy "own settings" on settings;
drop policy "own audit" on deviation_audit;
drop policy "own actions" on actions;

create policy "org deviations" on deviations for all
  using (org_id = my_org_id()) with check (org_id = my_org_id());
create policy "org scans" on scans for all
  using (org_id = my_org_id()) with check (org_id = my_org_id());
create policy "org rader" on rader for all
  using (org_id = my_org_id()) with check (org_id = my_org_id());
create policy "org settings" on settings for all
  using (org_id = my_org_id()) with check (org_id = my_org_id());
create policy "org audit" on deviation_audit for all
  using (org_id = my_org_id()) with check (org_id = my_org_id());
create policy "org actions" on actions for all
  using (org_id = my_org_id()) with check (org_id = my_org_id());
