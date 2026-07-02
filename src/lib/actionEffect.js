// ============================================================================
// actionEffect.js — Ren logik för åtgärdsloopen
// ----------------------------------------------------------------------------
// Hela poängen med appen är att gå från "vad hände?" till "hjälpte det vi gjorde?".
// Dessa funktioner tar en åtgärd (VNR + datum) och all deviation-historik, och
// räknar ut om avvikelserna faktiskt minskade EFTER åtgärden jämfört med FÖRE.
//
// Inga Supabase-anrop, ingen React — bara data in, siffror ut. Det gör det
// trivialt att enhetstesta, precis som blueprinten kräver för src/lib/.
// ============================================================================

/**
 * Delar upp en VNR:s deviation-historik i före/efter en åtgärdsdag och räknar
 * effekten. "Efter" inkluderar åtgärdsdagen själv (>=), eftersom en åtgärd på
 * morgonen rimligen ska räknas mot samma dags utfall.
 *
 * @param {string} vnr           varunumret åtgärden gäller
 * @param {string} actionDatum   åtgärdens datum, "YYYY-MM-DD"
 * @param {Array}  deviations    hela deviations-arrayen (samma form som i appen)
 * @returns {{
 *   beforeDays:number, afterDays:number,
 *   beforeTotal:number, afterTotal:number,
 *   beforePerDay:number, afterPerDay:number,
 *   deltaPerDay:number, deltaPct:number|null,
 *   status:'improved'|'worse'|'unchanged'|'pending'
 * }}
 */
export function actionEffect(vnr, actionDatum, deviations) {
  // Bara rader för just denna VNR, sorterade i tid.
  const rows = deviations
    .filter((r) => r.vnr === vnr && r.datum)
    .sort((a, b) => a.datum.localeCompare(b.datum));

  const before = rows.filter((r) => r.datum < actionDatum);
  const after = rows.filter((r) => r.datum >= actionDatum);

  const sum = (arr) => arr.reduce((s, r) => s + (r.count || 0), 0);

  // Antal UNIKA dagar, inte antal rader — annars snedvrider en dag med många
  // VNR-rader snittet. Vi vill ha avvikelser PER DAG som VNR:n dök upp.
  const uniqueDays = (arr) => new Set(arr.map((r) => r.datum)).size;

  const beforeTotal = sum(before);
  const afterTotal = sum(after);
  const beforeDays = uniqueDays(before);
  const afterDays = uniqueDays(after);

  // Per dag = total / antal dagar VNR:n faktiskt förekom. Ger en rättvis
  // jämförelse även om före-perioden är mycket längre än efter-perioden.
  const beforePerDay = beforeDays ? beforeTotal / beforeDays : 0;
  const afterPerDay = afterDays ? afterTotal / afterDays : 0;

  const deltaPerDay = afterPerDay - beforePerDay;
  const deltaPct =
    beforePerDay > 0 ? ((afterPerDay - beforePerDay) / beforePerDay) * 100 : null;

  // status:
  // - pending  = ingen data efter åtgärden än, kan inte bedöma
  // - improved = minst 15% lägre per dag efter
  // - worse    = minst 15% högre per dag efter
  // - unchanged = däremellan (för litet utslag för att kalla det en effekt)
  let status;
  if (afterDays === 0) status = 'pending';
  else if (deltaPct === null) status = afterPerDay > 0 ? 'worse' : 'unchanged';
  else if (deltaPct <= -15) status = 'improved';
  else if (deltaPct >= 15) status = 'worse';
  else status = 'unchanged';

  return {
    beforeDays,
    afterDays,
    beforeTotal,
    afterTotal,
    beforePerDay,
    afterPerDay,
    deltaPerDay,
    deltaPct,
    status,
  };
}

/**
 * För en lista åtgärder: berika var och en med sin effekt. Om samma VNR har
 * flera åtgärder används respektive åtgärds eget datum som gräns — så du ser
 * om försök 2 lyckades där försök 1 misslyckades.
 */
export function withEffects(actions, deviations) {
  return actions.map((a) => ({
    ...a,
    effect: actionEffect(a.vnr, a.datum, deviations),
  }));
}

// Presentationshjälpare — status → färg/etikett. Håll UI-strängarna på ett
// ställe så komponenten blir tunn.
export const EFFECT_META = {
  improved: { label: '↓ Hjälpte', color: '#4ade80' },
  worse: { label: '↑ Värre', color: '#f97316' },
  unchanged: { label: '→ Oförändrad', color: '#60a5fa' },
  pending: { label: '⏳ Inväntar data', color: '#666' },
};
