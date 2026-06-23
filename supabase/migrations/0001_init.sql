-- AvvikelseLive — initial schema
-- Kör i Supabase Dashboard → SQL Editor, eller via Supabase CLI.

-- Varje rad = en VNRs avvikelser under en dag (speglar localStorage-posten).
create table if not exists deviations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) default auth.uid(),
  datum           date not null,
  vnr             text not null,
  locations       text[] default '{}',
  zon             text,
  kbana           text,
  route_code      text,
  ship_to         text,
  avgangstid      text,
  nasta_dag       boolean default false,
  min_fore_avgang int,
  count           int not null default 1,
  after_hours     int default 0,
  before_work     int default 0,
  hours           int[] default '{}',
  times           text[] default '{}',
  orsak           text,
  kommentar       text,
  kontroll_scans  int default 0,
  kontroll_total  int default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (user_id, datum, vnr)
);

-- Per-scan-rader (den gamla events-arrayen, normaliserad).
-- inKontroll = markör, sätter ALDRIG orsak direkt.
create table if not exists scans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) default auth.uid(),
  deviation_id    uuid not null references deviations(id) on delete cascade,
  tid             text,
  location        text,
  route_code      text,
  ship_to         text,
  avgangstid      text,
  nasta_dag       boolean default false,
  min_fore_avgang int,
  in_kontroll     boolean default false,
  orsak           text,
  created_at      timestamptz default now()
);
create index if not exists scans_deviation_id_idx on scans(deviation_id);

-- Plockade rader per dag per zon (för promilleberäkning).
create table if not exists rader (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) default auth.uid(),
  datum     date not null,
  zon1      int default 0,
  zon2      int default 0,
  zon3      int default 0,
  unique (user_id, datum)
);

-- Inställningar: mål-promille, kostnad per avvikelse, tid per avvikelse.
create table if not exists settings (
  user_id   uuid primary key references auth.users(id) default auth.uid(),
  goal      numeric default 2.0,
  cost      numeric default 63,
  time_min  numeric default 13
);

-- Revisionsspår (valfritt men rekommenderat).
create table if not exists deviation_audit (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  deviation_id  uuid,
  field         text,
  old_value     text,
  new_value     text,
  changed_at    timestamptz default now()
);

-- RLS: varje användare ser och redigerar bara sina egna rader.
alter table deviations enable row level security;
alter table scans enable row level security;
alter table rader enable row level security;
alter table settings enable row level security;
alter table deviation_audit enable row level security;

create policy "own rows" on deviations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own scans" on scans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rader" on rader
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settings" on settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own audit" on deviation_audit
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trigger: uppdatera updated_at automatiskt på deviations.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger deviations_updated_at
  before update on deviations
  for each row execute procedure set_updated_at();
