-- ============================================================================
-- 0005_actions_owner_delete.sql — Lås radering av loggade åtgärder till ägaren
-- ----------------------------------------------------------------------------
-- LIVE DATA. Ta en backup (Historik → Exportera Excel) innan du kör detta.
--
-- Från säkerhetsgranskningen 2026-08-20: "org actions"-policyn (satt i
-- 0003_organizations.sql) är `for all using (org_id = my_org_id())` — ingen
-- user_id-koll alls. Vilken org-medlem som helst kan alltså radera VEM SOM
-- HELST:s loggade åtgärd, trots att klientkoden (AtgarderTab.jsx ✕-knappen)
-- visar knappen som om det vore en egen-rad-åtgärd. 0004_secure_org_delete.sql
-- lämnade `actions` medvetet oförändrad med kommentaren "ta bort egen loggad
-- åtgärd" — men policyn backade aldrig upp det påståendet.
--
-- Läs/skriv (select/insert/update) förblir öppet för alla org-medlemmar precis
-- som förut — bara radering låses till ägaren (user_id = auth.uid()) ELLER en
-- admin i samma org (samma admin-undantag som 0004 gav deviations/rader/
-- settings/deviation_audit).
-- ============================================================================

drop policy if exists "org actions" on actions;
drop policy if exists "org actions select" on actions;
drop policy if exists "org actions insert" on actions;
drop policy if exists "org actions update" on actions;
drop policy if exists "org actions delete owner or admin" on actions;

create policy "org actions select" on actions
  for select using (org_id = my_org_id());

create policy "org actions insert" on actions
  for insert with check (org_id = my_org_id());

create policy "org actions update" on actions
  for update using (org_id = my_org_id()) with check (org_id = my_org_id());

create policy "org actions delete owner or admin" on actions
  for delete using (
    org_id = my_org_id()
    and (
      user_id = auth.uid()
      or exists (
        select 1 from org_members
        where user_id = auth.uid() and org_id = actions.org_id and role = 'admin'
      )
    )
  );
