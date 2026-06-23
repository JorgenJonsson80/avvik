// orsak.js
// Per-scan orsaksaggregering. Kopierad VERBATIM från AvvikelseLive.html.
//
// Bryter ner en post till orsak-per-scan. Litar bara på event-orsaker när de FAKTISKT
// är blandade (>1 distinkt orsak) — annars används VNR-dagens orsak. Detta läker äldre
// data där events råkar bära en auto-stämpel som inte speglar den manuellt satta dagsorsaken.
//
// VIKTIG INVARIANT: sum(orsakBreakdown(r)) === r.count för varje post. Alltid.

export function orsakBreakdown(record) {
  const fallback = () => ({ [record.orsak || "Okänd"]: record.count || 0 });
  if (!record.events || record.events.length === 0) return fallback();

  // Räkna bara events som har ett klockslag (en faktisk scan).
  const scans = record.events.filter(e => e && e.tid);
  if (scans.length === 0) return fallback();

  // Samla distinkta event-orsaker (ignorera tomma).
  const eventOrsaker = scans.map(e => e.orsak).filter(Boolean);
  const distinct = [...new Set(eventOrsaker)];

  // Lita bara på event-orsaker när de FAKTISKT är blandade (>1 distinkt orsak).
  // Är alla samma (eller saknas), använd VNR-dagens orsak.
  if (distinct.length <= 1) return fallback();

  const dist = {};
  for (const ev of scans) {
    const o = ev.orsak || record.orsak || "Okänd";
    dist[o] = (dist[o] || 0) + 1;
  }

  // Säkerhetskoll: om antal scans inte matchar count, skala proportionellt
  // så summan alltid blir record.count.
  const scanTotal = scans.length;
  const realCount = record.count || scanTotal;
  if (scanTotal !== realCount && scanTotal > 0) {
    const scaled = {};
    let assigned = 0;
    const keys = Object.keys(dist);
    keys.forEach((o, i) => {
      if (i === keys.length - 1) {
        scaled[o] = realCount - assigned; // sista får resten (undviker avrundningstapp)
      } else {
        const v = Math.round(dist[o] / scanTotal * realCount);
        scaled[o] = v;
        assigned += v;
      }
    });
    return scaled;
  }
  return dist;
}

// Bekvämlighets-iterator: anropar fn(orsak, antal, record) för varje orsak i en lista poster.
export function forEachOrsak(records, fn) {
  for (const r of records) {
    const dist = orsakBreakdown(r);
    for (const [orsak, antal] of Object.entries(dist)) {
      if (antal > 0) fn(orsak, antal, r);
    }
  }
}
