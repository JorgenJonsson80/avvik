-- ============================================================================
-- 0002_actions.sql — Åtgärdsloopen för AvvikelseLive
-- ----------------------------------------------------------------------------
-- Varför en egen tabell och inte en kolumn på deviations?
-- En åtgärd gäller en VNR över TID, inte en enskild dag-rad. Samma VNR kan ha
-- dussintals deviation-rader (en per dag) men EN åtgärd ("pratade med påfyllnad
-- 2026-06-12") vars hela poäng är att mäta effekten före vs efter det datumet.
-- Att hänga åtgärden på en dag-rad skulle vara fel granularitet. VNR + datum är
-- den naturliga nyckeln.
-- ============================================================================

create table actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) default auth.uid(),
  vnr         text not null,
  datum       date not null,          -- när åtgärden gjordes = mätgränsen (före/efter)
  text        text not null,          -- vad som gjordes: "Pratade med påfyllnad", "Bytte plockplats"
  av          text,                   -- vem som gjorde det (frivilligt)
  location    text,                   -- plats vid tillfället, för kontext i listan
  kbana       text,                   -- K-bana vid tillfället
  created_at  timestamptz default now()
);

-- En VNR kan ha flera åtgärder över tid (försök 1 hjälpte inte, försök 2...),
-- så ingen unique på (user_id, vnr). Sortera på datum i appen.
create index actions_user_vnr_idx on actions (user_id, vnr);

alter table actions enable row level security;

create policy "own actions" on actions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
