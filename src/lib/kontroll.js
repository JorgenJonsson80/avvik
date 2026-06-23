// kontroll.js
// 2-minuters glidande fönster för att markera kontrollavvikelser.
// Kopierad VERBATIM från AvvikelseLive.html, extraherad till ren funktion.
//
// inKontroll är BARA en markering — den sätter ALDRIG orsak direkt.
// Se "Critical lesson learned" i SKILL.md.

const KONTROLL_WINDOW_MS = 2 * 60 * 1000;

/**
 * Tar en lista av scans [{vnr, locPrefix, timeMs}] och returnerar samma lista
 * med `inKontroll: true` på de som ingår i ett kluster (≥2 scans med samma
 * lagerplatsprefix inom 2 minuter).
 *
 * @param {Array<{vnr:string, locPrefix:string, timeMs:number}>} scans
 * @returns {Array<{vnr:string, locPrefix:string, timeMs:number, inKontroll:boolean}>}
 */
export function markKontrollScans(scans) {
  const sorted = scans.map((s) => ({ ...s, inKontroll: false }));
  sorted.sort((a, b) => a.timeMs - b.timeMs);

  for (let i = 0; i < sorted.length; i++) {
    const cluster = [sorted[i]];
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].timeMs - sorted[i].timeMs > KONTROLL_WINDOW_MS) break;
      if (sorted[j].locPrefix === sorted[i].locPrefix) cluster.push(sorted[j]);
    }
    if (cluster.length >= 2) cluster.forEach((s) => { s.inKontroll = true; });
  }

  return sorted;
}

/**
 * Beräknar kontrollstatistik per VNR från en lista av markerade scans.
 * Returnerar Map<vnr, {kontroll: number, total: number}>.
 *
 * @param {Array<{vnr:string, inKontroll:boolean}>} markedScans
 * @returns {Map<string, {kontroll:number, total:number}>}
 */
export function kontrollStatsByVnr(markedScans) {
  const stats = new Map();
  for (const s of markedScans) {
    if (!stats.has(s.vnr)) stats.set(s.vnr, { kontroll: 0, total: 0 });
    const st = stats.get(s.vnr);
    st.total++;
    if (s.inKontroll) st.kontroll++;
  }
  return stats;
}
