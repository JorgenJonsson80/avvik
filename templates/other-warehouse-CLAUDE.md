# Bygg en avvikelsehanterare för ert lager

Det här är en byggblueprint, framtagen genom att faktiskt bygga och driftsätta
en likadan app (AvvikelseLive, ett verktyg för att spåra plockavvikelser hos
SDS/Tamro). Arkitekturen, RLS-mönstret, testfilosofin och lärdomarna nedan är
generiska och beprövade i produktion. **Er egen domänlogik (vad ni kallar det
ni spårar, era orsaker, era zoner, ert filformat) är inte det — den fyller ni
i i Steg 0 nedan, och det är den delen som gör appen till ER app.**

## Hur du använder den här filen

1. Lägg den här filen som `CLAUDE.md` i roten av en tom, ny mapp (nytt git-repo).
2. Fyll i **Steg 0** nedan så gott ni kan — även ofullständigt duger, Claude
   kan fråga vidare om det som saknas.
3. Öppna mappen i Claude Code och säg "bygg det här enligt CLAUDE.md".
4. Claude bygger i den ordning som beskrivs under **Byggordning**, och frågar
   er om resten av Steg 0 innan den skriver importparsern (den delen kan inte
   gissas fram, den kräver ett exempel på er faktiska fil).

---

## Steg 0 — Fyll i om ert lager

**Appnamn:** _____

**Vokabulär** — vad kallar ni det ni spårar? ("avvikelse", "fel", "undantag",
annat?). Använd det ordet konsekvent i UI:t istället för att kopiera
AvvikelseLives.

**Områden/zoner** — vilka finns, och hur många? (AvvikelseLive hade zon 1–3 +
"Loax"/"KG kyl" som specialfall — ni kan ha helt annan struktur, t.ex. fack,
våningar, plockvågnummer. Fritt antal, ingen kod nedan förutsätter exakt 3.)

**Orsakslista** — er lista över grundorsaker (t.ex. "Saldofel", "Fel
lagerplats", "Skadad vara", …), gärna med en kort not om vem/vilken funktion
som äger/åtgärdar respektive orsak (motsvarande `ORSAK_ANSVAR` i
AvvikelseLive).

**Importfilen** — det viktigaste fältet i hela formuläret. Bifoga (eller
klistra in) ett verkligt exempel på filen ni exporterar ur ert WMS/system,
eller lista kolumnerna rakt av. Ange:
- Filformat (Excel/CSV/annat)
- Kolumnnamn och vad varje betyder
- Finns en identifierare per "händelse" som kan upprepas över flera dagar
  (motsvarande VNR i AvvikelseLive — ett ordernummer, en plocklista-ID, etc.)?
- Finns datum/tid-fält med kända kvirkar (tidszon-offset, konstiga
  serienummer-format från Excel, etc.)?

**KPI:er** — era nyckeltal, med formel om de skiljer sig från AvvikelseLives:
- Ett måltal (AvvikelseLive: promille = avvikelser / plockade rader × 1000)
- Kostnad per händelse (kr eller annan valuta)
- Tid per händelse (för att räkna nedlagd tid)
- Ska mål-uppfyllelse färgkodas (grön/gul/röd)? Vilka trösklar?

**Arbetstider/cutoff-regler** — finns regler av typen "scans efter kl X räknas
som Y" (AvvikelseLive: efter 15:30 = "after_hours", före 08:00 = "before_work")?

**Delat lag eller ensam användare?** Om flera personer ska dela samma data
(multi-tenant/organisation-modell) svara ja — annars blir det en enklare
en-användare-per-konto-modell (se Schema nedan, båda varianterna beskrivs).

**Åtgärdslogg?** Vill ni logga åtgärder ni vidtagit mot återkommande problem
(t.ex. "pratade med påfyllnad 2026-06-12") och se effekten före/efter i
statistiken? (Motsvarande Åtgärder-fliken i AvvikelseLive.)

---

## Referensarkitektur

**Stack:** Vite + React + Supabase (Postgres + Auth + Row Level Security) +
Vitest. Ingen backend-server att drifta utöver Supabase.

**Projektstruktur:**

```
src/
├── main.jsx
├── App.jsx                 # tab-shell + auth-gate
├── lib/                    # REN domänlogik, inga Supabase-anrop, 100% testbar
│   ├── supabase.js          # klient-singleton
│   ├── classify.js          # er motsvarighet: rå plats/kod → ert område/zon
│   ├── causes.js            # er orsakslista + ansvarsmappning
│   ├── dates.js              # datumformatering, mål-färgkodning, promille-etc
│   ├── importParser.js      # parsar ER fil — går INTE att förbygga, se Steg 0
│   └── ...                  # övrig domänlogik som rena, testbara funktioner
├── hooks/                  # ENDA lagret som pratar med Supabase
│   ├── useDeviations.js     # (eller ert eget namn) — CRUD + paginering
│   ├── useSettings.js
│   └── ...
└── components/
    ├── ImportTab.jsx
    ├── HistorikTab.jsx
    ├── StatistikTab.jsx
    └── shared/
```

**Varför den uppdelningen:** all domänlogik som *kan* vara en ren funktion
(ingen I/O) ska vara det, och ligga i `lib/`. Det gör den trivialt testbar utan
en riktig databas. `hooks/` är det enda stället Supabase-klienten anropas
ifrån — komponenter är dumma och pratar bara med hooks.

---

## Databas: enkel variant (en användare/konto = en isolerad bubbla)

Bra startpunkt om ni svarade "ensam användare" i Steg 0.

```sql
create table events (   -- döp om till er vokabulär, t.ex. "deviations", "avvikelser"
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) default auth.uid(),
  datum       date not null,
  ref         text not null,        -- er motsvarighet till VNR
  -- ... era egna fält, se Steg 0 ...
  orsak       text,
  kommentar   text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, datum, ref)      -- möjliggör upsert vid omimport
);

alter table events enable row level security;
create policy "own rows" on events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Varje ytterligare tabell (er "rader"/nämnare-tabell, era settings, en
åtgärdslogg) följer exakt samma mönster: `user_id uuid ... default auth.uid()`
+ en enda `for all using (auth.uid() = user_id)`-policy.

## Databas: delat lag (flera användare, samma data)

Om ni svarade "delat lag" i Steg 0 — bygg **inte** detta från början om ni är
osäkra; börja med enkla varianten ovan och migrera hit när ett verkligt behov
uppstår (se `avvikelselive-supabase`-skillens bevisade migrationsväg för hur
det steget togs i produktion). Om ni vet redan från start att flera ska dela
data, bygg det direkt så här:

```sql
create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Mitt lager',
  created_at timestamptz default now()
);

create table org_members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  primary key (org_id, user_id),
  unique (user_id)   -- en org per användare, enklast för MVP
);
alter table org_members enable row level security;
create policy "read own membership" on org_members
  for select using (auth.uid() = user_id);

create or replace function my_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid() limit 1;
$$;

-- SECURITY DEFINER-funktioner kringgår RLS och MÅSTE därför kontrollera
-- behörighet SJÄLVA. Kolla admin-koll oavsett auth.uid()-status — annars
-- kan en anropare UTAN inloggning (bara anon-nyckeln) smita förbi kollen.
create or replace function add_org_member(p_email text, p_org_id uuid, p_role text default 'member')
returns void language plpgsql security definer set search_path = public as $$
declare v_user_id uuid;
begin
  if not exists (
    select 1 from org_members
    where user_id = auth.uid() and org_id = p_org_id and role = 'admin'
  ) then
    raise exception 'not authorized to add members to this org';
  end if;
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'no auth user found for email %', p_email;
  end if;
  insert into org_members (org_id, user_id, role)
  values (p_org_id, v_user_id, p_role)
  on conflict (user_id) do update set org_id = excluded.org_id, role = excluded.role;
end;
$$;
revoke all on function add_org_member(text, uuid, text) from public;
grant execute on function add_org_member(text, uuid, text) to authenticated;

alter table organizations enable row level security;
create policy "read own org" on organizations for select using (id = my_org_id());
```

Varje datatabell får `org_id uuid references organizations(id) default my_org_id()`
istället för `user_id`, och en policy per tabell. **Två varianter beroende på
om radering behöver vara admin-only:**

```sql
-- Om läs/skriv/ändra ska vara öppet för alla i orgen men RADERING bara admin:
create policy "org events select" on events for select using (org_id = my_org_id());
create policy "org events insert" on events for insert with check (org_id = my_org_id());
create policy "org events update" on events for update
  using (org_id = my_org_id()) with check (org_id = my_org_id());
create policy "org events delete admin" on events for delete using (
  org_id = my_org_id() and exists (
    select 1 from org_members
    where user_id = auth.uid() and org_id = events.org_id and role = 'admin'
  )
);

-- Om ALLT (inkl. radering) ska vara öppet för alla org-medlemmar:
create policy "org events" on events for all
  using (org_id = my_org_id()) with check (org_id = my_org_id());
```

### ⚠ Den farligaste RLS-fällan, hittad i produktion

Om ni senare **byter** en `for all`-policy mot uppdelade select/insert/update/
delete-policies (som ovan), måste ni droppa den GAMLA policyn **med dess
exakta, verkliga namn** — inte ett namn ni antar att den har.

I AvvikelseLive skrevs en migration som körde
`drop policy if exists 'org ' || tabellnamn on tabellnamn` i en loop över flera
tabeller. För en tabell hette den riktiga policyn något annat än mönstret
förutsatte. `drop policy if exists` på ett namn som inte finns **failar tyst,
ingen error** — så den gamla öppna policyn (ingen adminkoll, tillät radering
för alla) blev liggande kvar parallellt med de nya admin-only-policyerna.
RLS-policies är **permissiva och OR:as ihop**, så den gamla vann: hela poängen
med att låsa ned radering gick förlorad för just den tabellen, helt tyst,
upptäcktes först i en efterföljande säkerhetsgranskning.

**Regel:** kör alltid `select policyname from pg_policies where tablename =
'X'` och verifiera namnet innan ni skriver en `drop policy`-migration som ska
ersätta den. Lita aldrig på att ett antaget namnmönster stämmer.

---

## Domänlogik som rena funktioner

Samma mönster oavsett bransch:

- **`classify.js`** — mappar en rå kod/plats/identifierare till ert
  område/zon-begrepp. Det här är den funktion som är mest "hemlig
  lagerkunskap" — lås den med tester så snart ni vet de rätta svaren för ett
  antal kända exempel, annars kan en ombyggnad av lagret tyst göra all
  statistik fel.
- **`causes.js`** — er orsakslista + ansvarsmappning, som data (ett objekt),
  inte hårdkodad logik utspridd i komponenter.
- **`importParser.js`** — parsar er fil till interna poster. **Den enda delen
  av hela blueprinten som måste skrivas från grunden mot ert riktiga
  exempel** — inget generiskt bibliotek kan gissa era kolumnnamn eller
  datum-kvirkar.
- **`dates.js`** (eller motsvarande) — formatering, mål-färgkodning
  (`goalColor(varde, mal)`), och nämnare-beräkningar.
- **Merge-på-omimport** — om samma dag kan importeras igen (rättad fil,
  kompletterande export), skriv merge-logiken som en ren funktion som bevarar
  manuellt satt orsak/kommentar och bara skriver över volatila fält. Testa den
  explicit: omimport ska ALDRIG tysta radera en manuellt satt klassificering.

## KPI-formler (anpassa namnen, formen är generisk)

```js
promille(avvikelser, totalRader) = avvikelser / totalRader * 1000   // eller er kvot
kostnad = antalHändelser * krPerHändelse
nedlagdTid = antalHändelser * minPerHändelse
goalColor(varde, mal) = varde <= mal ? "grön" : varde <= mal * 1.5 ? "gul" : "röd"  // era egna trösklar
```

---

## Testfilosofi

- **Varje ren funktion i `lib/` får en Vitest-fil.** Inga undantag — det är
  den billigaste sortens test som finns (ingen databas, ingen mockning av
  nätverk) och den som fångar flest verkliga buggar i den här typen av app.
- **Skriv invariant-tester, inte bara exempel-tester** där det går. T.ex. "summan
  av orsaks-uppdelningen är alltid lika med totala antalet" fångar hela
  buggklasser, inte bara ett specifikt fall.
- **För kod som anropar Supabase och där ORDNINGEN på anropen spelar roll**
  (radera-flöden, återställnings-flöden) — skriv en minimal fake av
  query-buildern istället för att dra in en riktig databas i testerna:

  ```js
  function makeSupabase({ selectRows = [], deleteError = null } = {}) {
    const calls = [];
    function builderFor(table) {
      const builder = {
        select(cols)  { calls.push({ table, op: "select" }); return builder; },
        delete()      { calls.push({ table, op: "delete" }); return builder; },
        in(col, vals) {
          calls.push({ table, op: "in", col, vals });
          return Promise.resolve({ data: selectRows, error: deleteError });
        },
      };
      return builder;
    }
    return { calls, from: (table) => builderFor(table) };
  }
  // ... anropa er funktion med denna fejkade klient, assert:a på `calls`-ordningen
  ```

  Det här mönstret bevisade sig ovärderligt för att låsa fast "radera i rätt
  ordning" och "ett fel i steg 2 ska stoppa steg 3" utan integrationstest-krångel.

---

## Lärdomar från denna byggnation — undvik dessa fällor

1. **RLS-policynamn måste matcha exakt vid `drop policy`** — se boxen ovan.
   Tyst no-op vid felstavat namn, ingen varning.
2. **Namnge aldrig en lokal variabel/`useMemo`/`useState`-värde likadant som
   en importerad funktion, i samma scope.** I React-komponenter är detta
   extra lurigt: `const totalRader = useMemo(() => { ...; totalRader(x); ...
   })` skuggar importen `totalRader` med sig själv → "Cannot access before
   initialization" i produktion, en klassisk temporal-dead-zone-krasch som
   kan smita förbi om den aldrig triggas i utvecklingsläge.
3. **Varje Supabase-hook som hämtar en LISTA måste paginera.** PostgREST har
   en server-side `max_rows` (ofta 1000) som `limit()` inte kan höja — svaret
   trunkeras TYST, inget fel kastas. Loopa med `.range(from, from+PAGE-1)`
   tills svaret är kortare än sidstorleken.
4. **Radera/återställ-flöden: skriv (upsert) FÖRE ni raderar, aldrig
   radera-allt-sen-skriv-in.** Upsert är idempotent — ett avbrutet
   nätverksanrop mitt i går att köra om. Radera-först är oåterkalleligt om
   skrivningen sen misslyckas.
5. **Bekräftelsedialoger för destruktiva åtgärder ska räkna mot FÄRSK data**
   (kör en refetch precis innan dialogen öppnas), inte mot ett lokalt state
   som kan vara inaktuellt om någon annan hann ändra data samtidigt.
6. **Tysta aldrig ett fel med ett `.then()` utan `.catch`**, och tysta aldrig
   ett misslyckat sparande genom att bara stänga formuläret som om det
   lyckats. Fail-closed (dölj en knapp, visa inget) är okej; fail-silent
   (låtsas att det gick bra) är det aldrig.
7. **RLS är den enda RIKTIGA spärren.** En knapp som döljs i UI:t för
   icke-admins är bara kosmetisk om databasen inte också nekar — testa alltid
   att motsvarande policy faktiskt finns och gör vad UI:t antar.
8. **`0 === false` i JavaScript** — `parseFloat(x) || fallback` kan aldrig
   spara ett fält till exakt talet 0 (t.ex. ett mål-KPI eller en kostnad satt
   till 0). Skriv en explicit `resolveNum(draft, fallback)` som bara
   fallbackar på tomt fält, inte på falsy-värden.

---

## Byggordning (undvik overbuild-fällan)

1. **Fyll i Steg 0** tillsammans med Claude — särskilt importfil-exemplet.
2. **Scaffold** Vite + React + Supabase-klient. Enklaste möjliga
   inloggning (magic link eller email+lösenord). Inget annat än det.
3. **Schema + RLS** — enkla varianten (en användare) om ni är osäkra på
   delat-lag-behovet; ni migrerar dit senare utan att applikationskoden
   behöver skrivas om (samma `user_id default auth.uid()`-mönster som
   `org_id default my_org_id()` sen ersätter).
4. **`lib/`-funktioner + tester FÖRST**, innan någon UI finns. `classify.js`
   och er merge-logik är de mest riskabla — testa dem mot kända, verkliga
   exempel innan ni litar på dem.
5. **Historik-fliken** (läs-only vy) — bevisar att läsning + RLS fungerar
   innan ni bygger något som skriver.
6. **Import-fliken** — parsern mot ert riktiga filformat + upsert-på-omimport.
   Svårast, gör den sist av grundflödet.
7. **Statistik/Vecka** — presentation ovanpå samma data; KPI:er, promille,
   mål-färgkodning.
8. **Analys/Åtgärder** (om ni ville ha åtgärdslogg) — sist, byggs ovanpå allt
   annat.

Kör hela testsviten (`npm test`) och `npm run build` innan varje "klart"-
påstående — inte bara vid commit.

## Vad den här filen INTE ger er gratis

- Er egen importparser mot ert faktiska filformat — måste skrivas mot
  exemplet ni bifogar i Steg 0, inget generiskt kan gissa det.
- Er egen orsakslista, zonindelning eller motsvarighet till K-bana/rutt-tider
  — er domänkunskap, inte den här blueprintens.
- Hosting/deploy-beslut — bestäm det när appen faktiskt fungerar lokalt.
