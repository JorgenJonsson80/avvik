# AvvikelseLive – Supabase-version

Ombyggnad av AvvikelseLive från single-file-artifact till ett riktigt Vite + React + Supabase-
projekt, uppdelat i moduler med tester.

## Vad som redan finns här

```
avvikelselive-projekt/
├── .claude/skills/avvikelselive-supabase/SKILL.md   ← byggritningen (Claude Code läser denna)
├── reference/AvvikelseLive-single-file-reference.html ← FACIT: färdiga prototypen, rör ej
├── migration/LÄS-MIG.md                              ← så får du in din gamla data
├── src/lib/                                           ← rena domänfunktioner (klara + testade)
│   ├── classify.js   routes.js   dates.js   causes.js   orsak.js
├── tests/                                             ← Vitest-tester (klara att köra)
│   ├── classify.test.js  routes.test.js  dates.test.js  orsak.test.js
└── package.json
```

`src/lib/` och `tests/` är redan klara — det är domänlogiken utbruten och låst med tester.
Resten (Vite-scaffold, Supabase, komponenter) bygger du med Claude enligt SKILL.md.

## Kom igång

```bash
npm install
npm test        # ska visa alla tester gröna
```

Sen, i Claude Code:

> "Läs avvikelselive-supabase-skillen och börja med steg 1 — scaffolda Vite + React +
> Supabase och få login att funka. Inget mer än så."

## Innan du bygger på allvar

1. **Dumpa din gamla data** — följ `migration/LÄS-MIG.md`. Gör detta innan du stänger
   artifact-appen.
2. **Kör testerna** — `npm test`. De skyddar domänlogiken mot regressioner. Bygg vidare på dem.

## Viktigast att inte gå sönder

Se SKILL.md, sektionen "Critical lesson learned" — kontroll/scan-orsak-buggen. Kort version:
`inKontroll` är en markör, inte en orsak. `orsakBreakdown` litar bara på event-orsaker när de
är genuint blandade. Det är därför `orsak.test.js` finns — håll den grön.
