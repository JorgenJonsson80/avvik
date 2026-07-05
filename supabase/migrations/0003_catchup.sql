-- ============================================================================
-- 0003_catchup.sql — Idempotent catch-up för 0003_organizations
-- Kör detta om 0003 misslyckades halvvägs (organizations-tabellen finns
-- redan men constraint/RLS-bytet är inte klart).
-- ============================================================================

-- 1–2: organizations + org_members (hoppa över om de redan finns)
create table if not exists organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Mitt lager',
  created_at timestamptz default now()
);

create table if not exists org_members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz default now(),
  primary key (org_id, user_id),
  unique (user_id)
);

alter table org_members enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'org_members' and policyname = 'read own membership'
  ) then
    execute 'create policy "read own membership" on org_members for select using (auth.uid() = user_id)';
  end if;
end $$;

-- 3: my_org_id() (CREATE OR REPLACE är alltid säker)
create or replace function my_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from org_members where user_id = auth.uid() limit 1;
$$;

-- 4: add_org_member
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

-- 5: Lägg till org_id-kolumner om de saknas
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name='deviations' and column_name='org_id') then
    alter table deviations add column org_id uuid references organizations(id) default my_org_id();
  end if;
  if not exists (select 1 from information_schema.columns where table_name='scans' and column_name='org_id') then
    alter table scans add column org_id uuid references organizations(id) default my_org_id();
  end if;
  if not exists (select 1 from information_schema.columns where table_name='rader' and column_name='org_id') then
    alter table rader add column org_id uuid references organizations(id) default my_org_id();
  end if;
  if not exists (select 1 from information_schema.columns where table_name='settings' and column_name='org_id') then
    alter table settings add column org_id uuid references organizations(id) default my_org_id();
  end if;
  if not exists (select 1 from information_schema.columns where table_name='deviation_audit' and column_name='org_id') then
    alter table deviation_audit add column org_id uuid references organizations(id) default my_org_id();
  end if;
  if not exists (select 1 from information_schema.columns where table_name='actions' and column_name='org_id') then
    alter table actions add column org_id uuid references organizations(id) default my_org_id();
  end if;
end $$;

-- 6: Backfill — skapa org om ingen finns, lägg in alla users
do $$
declare
  v_org_id uuid;
begin
  select id into v_org_id from organizations limit 1;
  if v_org_id is null then
    insert into organizations (name) values ('Mitt lager') returning id into v_org_id;
  end if;

  insert into org_members (org_id, user_id, role)
  select v_org_id, id, 'admin' from auth.users
  on conflict (user_id) do nothing;

  update deviations      set org_id = v_org_id where org_id is null;
  update scans           set org_id = v_org_id where org_id is null;
  update rader           set org_id = v_org_id where org_id is null;
  update settings        set org_id = v_org_id where org_id is null;
  update deviation_audit set org_id = v_org_id where org_id is null;
  update actions         set org_id = v_org_id where org_id is null;
end $$;

-- 7: NOT NULL (säker att köra igen)
alter table deviations      alter column org_id set not null;
alter table scans           alter column org_id set not null;
alter table rader           alter column org_id set not null;
alter table settings        alter column org_id set not null;
alter table deviation_audit alter column org_id set not null;
alter table actions         alter column org_id set not null;

-- 8: Byt constraints (idempotent — drop IF EXISTS, add IF NOT EXISTS)
do $$ begin
  -- deviations: drop gamla, lägg till nya
  if exists (select 1 from pg_constraint where conname = 'deviations_user_id_datum_vnr_key') then
    alter table deviations drop constraint deviations_user_id_datum_vnr_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deviations_org_datum_vnr_key') then
    alter table deviations add constraint deviations_org_datum_vnr_key unique (org_id, datum, vnr);
  end if;

  -- rader
  if exists (select 1 from pg_constraint where conname = 'rader_user_id_datum_key') then
    alter table rader drop constraint rader_user_id_datum_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rader_org_datum_key') then
    alter table rader add constraint rader_org_datum_key unique (org_id, datum);
  end if;

  -- settings
  if exists (select 1 from pg_constraint where conname = 'settings_pkey') then
    alter table settings drop constraint settings_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_org_id_key') then
    alter table settings add constraint settings_org_id_key unique (org_id);
  end if;
end $$;

-- 9: Byt RLS-policies (drop IF EXISTS, create)
do $$ begin
  if exists (select 1 from pg_policies where tablename='deviations' and policyname='own rows') then
    drop policy "own rows" on deviations; end if;
  if exists (select 1 from pg_policies where tablename='scans' and policyname='own scans') then
    drop policy "own scans" on scans; end if;
  if exists (select 1 from pg_policies where tablename='rader' and policyname='own rader') then
    drop policy "own rader" on rader; end if;
  if exists (select 1 from pg_policies where tablename='settings' and policyname='own settings') then
    drop policy "own settings" on settings; end if;
  if exists (select 1 from pg_policies where tablename='deviation_audit' and policyname='own audit') then
    drop policy "own audit" on deviation_audit; end if;
  if exists (select 1 from pg_policies where tablename='actions' and policyname='own actions') then
    drop policy "own actions" on actions; end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='deviations' and policyname='org deviations') then
    execute 'create policy "org deviations" on deviations for all using (org_id = my_org_id()) with check (org_id = my_org_id())';
  end if;
  if not exists (select 1 from pg_policies where tablename='scans' and policyname='org scans') then
    execute 'create policy "org scans" on scans for all using (org_id = my_org_id()) with check (org_id = my_org_id())';
  end if;
  if not exists (select 1 from pg_policies where tablename='rader' and policyname='org rader') then
    execute 'create policy "org rader" on rader for all using (org_id = my_org_id()) with check (org_id = my_org_id())';
  end if;
  if not exists (select 1 from pg_policies where tablename='settings' and policyname='org settings') then
    execute 'create policy "org settings" on settings for all using (org_id = my_org_id()) with check (org_id = my_org_id())';
  end if;
  if not exists (select 1 from pg_policies where tablename='deviation_audit' and policyname='org audit') then
    execute 'create policy "org audit" on deviation_audit for all using (org_id = my_org_id()) with check (org_id = my_org_id())';
  end if;
  if not exists (select 1 from pg_policies where tablename='actions' and policyname='org actions') then
    execute 'create policy "org actions" on actions for all using (org_id = my_org_id()) with check (org_id = my_org_id())';
  end if;
end $$;
