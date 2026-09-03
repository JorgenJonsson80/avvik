---
name: avvikelselive-supabase
description: >
  Build blueprint for the Supabase-backed, multi-component version of AvvikelseLive — the
  warehouse pick deviation (plockavvikelser) tracker for SDS/Tamro, rebuilt from the single-file
  localStorage artifact into a proper Vite + React + Supabase project in VS Code. Use this skill
  whenever the user wants to migrate AvvikelseLive off localStorage onto Supabase, split it into
  components/hooks/lib, set up the Postgres schema, RLS, auth, or migrate existing localStorage
  data into the database. Trigger on: AvvikelseLive Supabase, bygga om AvvikelseLive, flytta från
  localStorage, Supabase-version av avvikelseappen, komponentuppdelning, RLS för avvikelser,
  migrera localStorage till Supabase. For the original single-file artifact version, use the
  `avvikelselive` skill instead.
---

# AvvikelseLive — Supabase build blueprint

This skill is the blueprint for rebuilding AvvikelseLive as a real project:
**Vite + React + Supabase**, multiple components, edited in VS Code.

The original `avvikelselive` skill describes the single-file localStorage artifact.
This skill is for the production-leaning rebuild. **The domain logic is identical and must be
preserved exactly** — only the storage, structure, and auth change.

---

## Core principle: preserve the domain logic verbatim

The single-file app contains hard-won domain logic that took real warehouse knowledge to get
right. When rebuilding, copy these **as pure functions into `src/lib/`** without changing their
behaviour. They are the crown jewels:

| Function / constant | What it does | Why it must not change |
|---|---|---|
| `classifyLocation(loc)` | Maps a lagerplats (e.g. `P101-23`) to a K-bana (e.g. `K52`) | Encodes the real physical layout; silent bugs if altered |
| `getZon(location)` | Derives zone 1/2/3 from location prefix | Drives all zone KPIs |
| `stationToZon(station)` | Zone from station number (for rader-import) | Used in promille calc |
| `ROUTE_TIMES` + `ROUTE_RANGES` + `getAvgangstid(routeCode)` | Departure time per route | Powers the critical "min före avgång" metric |
| `minutesBeforeDeparture` / `formatMinBefore` | Time-to-departure math | Same |
| `excelDateToISO(val)` | Robust Excel date parsing (Date / string / serial) | Many edge cases already solved |
| `ORSAKER` + `ORSAK_ANSVAR` | Root cause list + responsibility mapping | Business taxonomy |
| Kontrollavvikelse detection (2-min sliding window, **per-scan** in `handleFile`) | Marks each individual scan that participates in a cluster, counts kontroll-scans per VNR | Non-trivial algorithm; now scan-level |
| `parseTimeFi` with `JDE_TIME_OFFSET = -1` | Parses JDE "Time Updated", corrects the 1-hour offset | **Critical**: if JDE export changes, all times/min-före-avgång break silently |
| `orsakBreakdown(record)` + `forEachOrsak(records, fn)` | Breaks a VNR-day into per-scan causes; only trusts event-causes when **genuinely mixed** (>1 distinct) | Heals legacy mis-stamping; keeps totals summing to `count` |
| After-hours / before-08:00 auto-classification | Auto-sets orsak | Same |
| Same-day merge logic (preserve manual orsak on re-import) | Data integrity over time | Easy to break |

**Rule:** when in doubt, copy the function character-for-character. Extract it, don't rewrite it.

### Critical lesson learned (the kontroll/scan-orsak bug)

When per-scan causes were added, an early version stamped every in-chain scan as
"Kontrollavvikelse" at **event level**, even when the whole VNR-day was judged to be something
else (e.g. Saldofel). Once statistics counted per-event-cause, those stamps overrode the manual
day-cause — almost everything became Kontroll.

**The fix, which must be preserved in the rebuild:**
1. Import must NOT set a per-scan orsak from `inKontroll`. `inKontroll` is a *marker only*
   (shown as "i kedja" in the detail view). Each scan's default orsak = the VNR-day's orsak.
2. `orsakBreakdown` trusts per-scan causes ONLY when there is more than one distinct cause among
   the events. If all events share one cause (or none), fall back to the VNR-day orsak. This is
   what heals legacy data automatically without a migration.
3. The scan-detail modal defaults each row to the VNR-day orsak unless the events are genuinely
   mixed.

In the Supabase model this maps to a `scans` (or `events`) table — see schema below. The
"trust only when mixed" rule lives in a pure `orsakBreakdown` function in `lib/`, fully unit-tested.

---

## Target project structure

```
avvikelselive/
├── .env.local                    # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── index.html
├── package.json
├── vite.config.js
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql          # schema + RLS
│   └── seed.sql                   # optional
└── src/
    ├── main.jsx
    ├── App.jsx                     # tab shell + auth gate
    ├── lib/
    │   ├── supabase.js             # client singleton
    │   ├── classify.js             # classifyLocation, getZon, stationToZon
    │   ├── routes.js               # ROUTE_TIMES, getAvgangstid, minutesBeforeDeparture
    │   ├── dates.js                # excelDateToISO, formatMinBefore, fmtKr, fmtTimmar
    │   ├── causes.js               # ORSAKER, ORSAK_ANSVAR
    │   ├── orsak.js                # orsakBreakdown, forEachOrsak (per-scan aggregation)
    │   ├── kontroll.js             # 2-min sliding-window per-scan kontroll detection
    │   └── importParser.js         # X08 + rader + append/restore parsing (pure)
    ├── hooks/
    │   ├── useDeviations.js        # fetch/insert/update/delete via Supabase
    │   ├── useScans.js             # per-scan rows (events) for a deviation
    │   ├── useRader.js             # rader per date
    │   └── useSettings.js          # goal, cost, time
    └── components/
        ├── ImportTab.jsx
        ├── HistorikTab.jsx
        ├── StatistikTab.jsx
        ├── VeckaTab.jsx
        ├── AnalysTab.jsx
        └── shared/
            ├── Badge.jsx
            ├── OrsaksSelect.jsx
            └── ScanDetailModal.jsx  # per-scan orsak editing
```

The five tabs map 1:1 to the current app: **Importera, Historik, Statistik, Vecka, Analys.**
Keep that structure for familiarity.

---

## Postgres schema (start simple)

Single-user / single-tenant first. Add roles later only if a real need appears.
File: `supabase/migrations/0001_init.sql`

```sql
-- Each row = one VNR's deviations on one day (mirrors the current localStorage record)
create table deviations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) default auth.uid(),
  datum       date not null,
  vnr         text not null,
  locations   text[] default '{}',
  zon         text,
  kbana       text,
  route_code  text,
  ship_to     text,
  avgangstid  text,
  nasta_dag   boolean default false,
  min_fore_avgang int,
  count       int not null default 1,
  after_hours int default 0,
  before_work int default 0,
  hours       int[] default '{}',
  times       text[] default '{}',
  orsak       text,                 -- VNR-day "dominant" cause
  kommentar   text,
  kontroll_scans int default 0,     -- how many scans were in a kontroll-cluster
  kontroll_total int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, datum, vnr)        -- enables upsert-on-reimport (merge logic)
);

-- Per-scan rows (the old `events` array, normalised). Enables splitting a VNR-day
-- across multiple causes. orsakBreakdown() reads these.
create table scans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  deviation_id  uuid not null references deviations(id) on delete cascade,
  tid           text,               -- HH:MM
  location      text,
  route_code    text,
  ship_to       text,
  avgangstid    text,
  nasta_dag     boolean default false,
  min_fore_avgang int,
  in_kontroll   boolean default false,   -- MARKER only — never sets orsak by itself
  orsak         text,               -- defaults to the deviation's orsak; differs only when split
  created_at    timestamptz default now()
);
create index on scans(deviation_id);

-- Rader (picked lines) per day per zone — for promille calculation
create table rader (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) default auth.uid(),
  datum     date not null,
  zon1      int default 0,
  zon2      int default 0,
  zon3      int default 0,
  unique (user_id, datum)
);

-- Settings: goal promille, cost per deviation, minutes per deviation
create table settings (
  user_id   uuid primary key references auth.users(id) default auth.uid(),
  goal      numeric default 2.0,
  cost      numeric default 63,      -- kr per avvikelse
  time_min  numeric default 13       -- minuter per avvikelse
);

-- OPTIONAL but recommended given the GDP feedback: audit trail
create table deviation_audit (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  deviation_id uuid,
  field       text,
  old_value   text,
  new_value   text,
  changed_at  timestamptz default now()
);
```

### RLS — simplest correct version

Owner-only access. Every table: a user sees and edits only their own rows.

```sql
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
```

**Later (if shift leaders need access):** add a `role` column or an `org_id` + a `memberships`
table, and broaden the policies. Do NOT build this now — it's the overbuild trap.

---

## The merge-on-reimport logic → becomes an upsert

The current app's most important data-integrity feature (re-importing the same day keeps your
manually set orsak) maps cleanly onto a Postgres upsert that **does not overwrite** orsak/kommentar:

```js
// In useDeviations.js — upsert that preserves manual classification
const { error } = await supabase
  .from('deviations')
  .upsert(rows, {
    onConflict: 'user_id,datum,vnr',
    // Only update the volatile/recomputed fields; leave orsak/kommentar to a separate
    // conditional update so an existing manual cause is never clobbered.
    ignoreDuplicates: false,
  });
```

For full fidelity, replicate the current behaviour: fetch existing rows for the date first,
merge in JS exactly as `handleSave`/`handleFile` do today (preserve orsak unless it was "Okänd"),
then upsert. Keep the merge in `lib/` as a pure function so it's testable.

---

## Testing (this is a priority — build the rebuild test-first where it counts)

The single-file app has NO tests. The `avvikelselive-lib` learning project already extracted
`classify`, `routes`, `dates`, `causes` with Vitest tests. The rebuild should carry those over
and add tests for the two trickiest pure functions:

**`orsakBreakdown` — the highest-value test target.** It heals legacy data and must keep totals
exact. Minimum cases (all verified against the working app):

```js
// legacy, no events → whole count on day-cause
orsakBreakdown({ orsak:"Saldofel", count:5 })                    // {Saldofel:5}
// all events same cause (or mis-stamped) → fall back to day-cause
orsakBreakdown({ orsak:"Saldofel", count:5, events:[5×Kontroll] }) // {Saldofel:5}  ← heals!
// genuinely mixed → respect per-scan
orsakBreakdown({ orsak:"Saldofel", count:7, events:[2×Kontroll,5×Saldofel] }) // {Kontroll:2,Saldofel:5}
// scan count ≠ record.count → scale, sum must equal count
orsakBreakdown({ orsak:"Saldofel", count:10, events:[1×K,2×S] }) // sums to 10
```
**Invariant under test:** `sum(orsakBreakdown(r)) === r.count` for every record. Always.

**`classifyLocation` — guard against layout drift.** Lock known mappings (e.g. `P3036-10`→K55
via the P3 rule; `P6036-10`→K55 too, since the station-36 rule was merged into K55 in 2026-09
— K61-36 no longer occurs). This is the function most likely to silently break if the warehouse
is rebuilt.

**`getAvgangstid`** — lock exact-match (`802`→18:30 wins over the `8`→nästa-dag rule),
range (`275`→18:00), and prefix-fallback (`350`→18:00).

Run `npm test` in CI before any deploy. These are the regression guards the prototype never had.

## Data migration from localStorage (one-time)

The user has real data in the artifact's localStorage RIGHT NOW. Don't lose it.

1. In the running artifact, dump it:
   ```js
   copy(localStorage.getItem('avvikelselive_v1'));        // deviations (with events arrays)
   copy(localStorage.getItem('avvikelselive_rader_v1'));  // rader
   // also: _goal_v1, _cost_v1, _time_v1
   ```
2. Save each as a `.json` file in the new project under `migration/`.
3. Write a one-off Node script `migration/import.js` that:
   - inserts each record into `deviations` (camelCase → snake_case, see mapping below)
   - **explodes each record's `events` array into `scans` rows** linked by `deviation_id`
   - inserts rader and settings
   via the Supabase service-role key.
4. Run once, verify counts match (and that `sum(scans per deviation) === deviation.count`),
   then delete the service key from the script.

**Field mapping** (localStorage → Postgres):
`datum→datum, vnr→vnr, locations→locations, zon→zon, kbana→kbana, routeCode→route_code,
shipTo→ship_to, avgangstid→avgangstid, nastaDag→nasta_dag, minForeAvgang→min_fore_avgang,
count→count, afterHours→after_hours, beforeWork→before_work, hours→hours, times→times,
orsak→orsak, kommentar→kommentar, kontrollScans→kontroll_scans, kontrollTotal→kontroll_total`
Each `events[]` entry → a `scans` row:
`tid→tid, location→location, route→route_code, ship→ship_to, avgangstid→avgangstid,
nastaDag→nasta_dag, minForeAvgang→min_fore_avgang, inKontroll→in_kontroll, orsak→orsak`

---

## Auth (keep it trivial first)

Supabase email magic-link or email+password. One user (you). `App.jsx` gates on session:

```jsx
const { data: { session } } = await supabase.auth.getSession();
if (!session) return <Login />;
```

No roles, no org logic. The schema already stamps `user_id` via `default auth.uid()`, so
everything is owner-scoped from day one without extra work.

---

## AI analysis tab — the one thing that changes

In the artifact, the Analys tab calls `api.anthropic.com` directly and the key is injected by
the Claude.ai environment. **Outside the artifact that won't work** — you can't ship an Anthropic
key in a Vite frontend (it'd be public).

Options, in order of preference:
1. **Supabase Edge Function** as a proxy: frontend calls the edge function, the function holds
   the `ANTHROPIC_API_KEY` as a secret and forwards to the API. Clean, keeps the key server-side.
2. Skip AI for v1 — the rule-based actions (streaks, peak hour, recurring VNR) already deliver
   most of the value without any API cost.

Recommend option 1, but ship without it first if it slows you down.

---

## Build order (avoid the overbuild trap)

Do it in this sequence, validating at each step:

1. **Scaffold** Vite + React + Supabase client. Get a login working. Nothing else.
2. **Migrate data** in (deviations + exploded scans). Confirm your real history shows up.
3. **Port `lib/`** — copy the pure domain functions from `avvikelselive-lib`, then add
   `orsak.js` (orsakBreakdown/forEachOrsak) and `kontroll.js`. Unit-test orsakBreakdown and
   classifyLocation first — they're the riskiest.
4. **Historik tab** — read-only view of migrated data + the ScanDetailModal (per-scan orsak).
   Proves reads + the scans relationship work.
5. **Import tab** — the X08 parser + per-scan kontroll detection + upsert. Hardest part.
6. **Statistik + Vecka** — presentation over the same data. Wire in:
   - promille (rader-based) + goal per the settings table
   - **cost + time KPIs** (count × cost, count × time/60 → hours)
   - **orsakBreakdown** for all per-orsak aggregation (so splits show in the numbers)
   - matched-weekday week comparison
7. **Analys** — rule-based first (streaks, peak hour shown as a range e.g. "13–14",
   recurring VNR, action list with prominent lagerplats). AI proxy last (or never for v1).

Carry over these UX guards from the prototype (cheap, high value):
- **localStorage was the single point of failure** — in Supabase this risk is gone, but keep the
  equivalent: a clear error if a write fails, and never silently swallow it.
- Disable Save until a datum is set.
- Warn on mixed kontroll cases at import (the "X/Y i kedja" banner).
- Comment the `JDE_TIME_OFFSET` constant prominently.

Resist building auth roles, multi-tenant, or fancy dashboards until the single-user version is
actually in daily use.

---

## What this skill does NOT cover
- Deployment/hosting (Vercel, etc.) — decide later
- Multi-tenant / org structure — deferred until a real need appears
- The original single-file artifact — that's the `avvikelselive` skill
