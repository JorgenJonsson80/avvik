# Migrering – läs detta FÖRST

Här lägger du din befintliga data från single-file-appen innan du bygger Supabase-versionen.
Annars börjar du från noll.

## Steg 1: Dumpa datan från artifact-appen

Öppna den körande AvvikelseLive-appen (artifact-versionen), öppna konsolen (F12) i rätt
iframe, och kör en i taget. Varje `copy(...)` lägger resultatet i urklipp — klistra in i en fil:

```js
copy(localStorage.getItem('avvikelselive_v1'));        // → spara som deviations.json
copy(localStorage.getItem('avvikelselive_rader_v1'));  // → spara som rader.json
copy(localStorage.getItem('avvikelselive_goal_v1'));   // → spara som goal.json (bara ett tal)
copy(localStorage.getItem('avvikelselive_cost_v1'));   // → spara som cost.json
copy(localStorage.getItem('avvikelselive_time_v1'));   // → spara som time.json
```

Lägg de filerna här i `migration/`. De är gitignorade (riktig lagerdata committas inte).

## Steg 2: Importskriptet

När Supabase-schemat finns (se SKILL.md), be Claude bygga `migration/import.js` enligt
fält-mappningen i skillen. Det ska:
- läsa deviations.json och lägga varje post i `deviations`
- explodera varje posts `events`-array till rader i `scans`
- lägga rader, goal, cost, time
- verifiera att `sum(scans per deviation) === deviation.count`

Kör en gång, kontrollera antalen, ta sen bort service-nyckeln ur skriptet.
