const KONTROLL_WINDOW_MS = 2 * 60 * 1000;

// Grupperar lagerplatser i kontrollområden.
// P4 + P6 betraktas som samma område (angränsar fysiskt).
export function kontrollArea(location) {
  if (!location) return null;
  const l = String(location).toUpperCase();
  const p = l.slice(0, 2);
  if (p === "P4" || p === "P6") return "P4P6";
  if (["P1", "P3", "P7", "PD", "PH"].includes(p)) return p;
  return null; // P5/PC/PK (KG kyl) deltar inte i kontrolldetektering
}

export function markKontrollScans(scans) {
  const sorted = scans.map((s) => ({ ...s, inKontroll: false }));
  sorted.sort((a, b) => a.timeMs - b.timeMs);

  for (let i = 0; i < sorted.length; i++) {
    if (!sorted[i].area) continue;
    const cluster = [sorted[i]];
    const vnrsInWindow = new Set([sorted[i].vnr]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].timeMs - sorted[i].timeMs > KONTROLL_WINDOW_MS) break;
      if (sorted[j].area === sorted[i].area) {
        cluster.push(sorted[j]);
        vnrsInWindow.add(sorted[j].vnr);
      }
    }
    // Kräver ≥2 OLIKA VNR — samma vara två gånger är inte kontroll
    if (vnrsInWindow.size >= 2) cluster.forEach((s) => { s.inKontroll = true; });
  }

  return sorted;
}

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

// Arbetstidsfönster 08:00–15:30. Delad mellan scanOrsak() (per scan) och
// importParser.js (dagsnivå-räknare beforeWork/afterHours) — en enda källa så
// de två aldrig kan hamna i otakt om skifttiderna ändras.
export function isBeforeWork(h) {
  return h < 8;
}
export function isAfterHours(h, m) {
  return h > 15 || (h === 15 && m >= 30);
}

// Prioritet: Loax/KG kyl (saknar rader-underlag, tidsregler blir missvisande) >
// tid (Före 08:00 / Utanför arbetstid) > kontroll > dagsorsak
//
// P7-undantag: kedjor som börjar på P7 beror i praktiken nästan alltid på
// sen A-Frame-påfyllning, inte på plockarens kontrollscanning — så de får
// "Försent påfylld – saldo finns – A-Frame" som grund istället för Kontrollavvikelse.
export function scanOrsak(h, m, inKontroll, dayOrsak, zon, isP7 = false) {
  if (zon === "Loax" || zon === "KG kyl") return "Övrigt";
  if (h !== null && h !== undefined) {
    if (isBeforeWork(h)) return "Före 08:00";
    if (isAfterHours(h, m)) return "Utanför min arbetstid";
  }
  if (inKontroll) return isP7 ? "Försent påfylld – saldo finns – A-Frame" : "Kontrollavvikelse";
  return dayOrsak || "";
}
