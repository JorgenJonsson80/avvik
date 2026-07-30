# AvvikelseLive

AvvikelseLive är en webbapplikation för att registrera, analysera och följa upp avvikelser i lagerverksamhet.

Projektet utgår från ett praktiskt behov: en avvikelse måste gå snabbt att registrera, vara möjlig att förstå i efterhand och kunna användas för att förbättra flödet. I stället för att behandla händelser som isolerade incidenter hjälper systemet verksamheten att se mönster, orsaker och effekten av genomförda åtgärder.

## Funktioner

- Inloggning och datalagring via Supabase
- Import av avvikelsedata från Excel
- Historik över registrerade avvikelser och scanningar
- Statistik- och veckovy för att följa mönster över tid
- Analys av avvikelser och orsaker
- Uppföljning av åtgärder
- Export av data till Excel
- Separat, testad domänlogik för bland annat klassificering, routing, datum och orsaker

## Teknik

- React
- Vite
- JavaScript
- Supabase
- Vitest
- SheetJS / `xlsx`
- GitHub Actions

## Arkitektur och kvalitet

Verksamhetslogiken ligger separat från gränssnittet i `src/lib/` och täcks av automatiserade tester i `tests/`. Det gör reglerna enklare att förstå, ändra och skydda mot regressioner när funktionaliteten utvecklas.

Databasens struktur och ändringar ligger i `supabase/migrations/`.

## Kör lokalt

```bash
npm install
npm test
npm run dev
```

För att ansluta till en egen Supabase-instans, skapa en lokal miljöfil utifrån `.env.local.example` och ange projektets URL och nyckel.

## AI-assisterad utveckling

AvvikelseLive byggs i samarbete med Claude Code som en del av ett AI-assisterat utvecklingsflöde. Jag definierar verksamhetsproblemet, kraven, domänreglerna och prioriteringarna samt granskar och testar lösningen. Claude Code används för att snabba upp utforskning och implementation, medan produktbeslut, kvalitetssäkring och leveransansvar ligger hos mig.

## Bakgrund

Efter mer än två decennier inom lager och logistik vet jag att mjukvara bara skapar värde om den fungerar för människorna och flödet på golvet. AvvikelseLive kombinerar den erfarenheten med fullstackutveckling för att skapa ett verktyg som är förankrat i en verklig verksamhet.
