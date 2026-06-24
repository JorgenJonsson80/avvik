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

// Prioritet: tid (Före 08:00 / Utanför arbetstid) > kontroll > dagsorsak
export function scanOrsak(h, m, inKontroll, dayOrsak) {
  if (h !== null && h !== undefined) {
    if (h < 8) return "Före 08:00";
    if (h > 15 || (h === 15 && m >= 30)) return "Utanför min arbetstid";
  }
  if (inKontroll) return "Kontrollavvikelse";
  return dayOrsak || "";
}
