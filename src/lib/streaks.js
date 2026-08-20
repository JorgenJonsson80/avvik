// streaks.js
// Beräknar per-VNR konsekutiva dagar-i-rad (streak). Delad mellan AnalysTab
// (åtgärdslista, "hög" prio = streak ≥ 3 och aktiv) och Excel-exporten.

import { classifyLocation } from "./classify.js";

// Sviten som slutar på VNR:ns SENASTE dag — inte den längsta någonsin. En VNR
// som hade 5 dagar i rad i juni, gick tyst, och dök upp en enda dag i juli
// ska rapportera streak=1 (den dagen), inte streak=5 (junisviten). Annars
// kan en gammal, avslutad svit felaktigt flaggas som "aktiv hög prio" bara
// för att den råkar vara VNR:ns bästa svit historiskt.
function trailingStreak(daysSet) {
  const sorted = [...daysSet].sort();
  if (sorted.length === 0) return 0;
  let n = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const diff = Math.round((new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000);
    if (diff === 1) n++;
    else break;
  }
  return n;
}

function streakActive(daysSet, lastDataDay) {
  const sorted = [...daysSet].sort();
  return sorted[sorted.length - 1] === lastDataDay;
}

/**
 * Bygger per-VNR streak-info från en lista deviation-rader.
 * `active` = svitens sista dag sammanfaller med senaste datadagen i `rows`.
 */
export function vnrStreaks(rows) {
  const m = {};
  for (const r of rows) {
    const datum = String(r.datum).slice(0, 10);
    if (!m[r.vnr]) {
      m[r.vnr] = {
        days: new Set(),
        total: 0,
        zon: r.zon,
        orsak: r.orsak,
        location: r.locations?.[0] || "",
        kbana: r.kbana || classifyLocation(r.locations?.[0]) || "",
      };
    }
    m[r.vnr].days.add(datum);
    m[r.vnr].total += r.count || 0;
  }

  const lastDataDay = [...new Set(rows.map((r) => String(r.datum).slice(0, 10)))].sort().at(-1);

  return Object.entries(m).map(([vnr, v]) => ({
    vnr,
    days: v.days.size,
    streak: trailingStreak(v.days),
    active: streakActive(v.days, lastDataDay),
    total: v.total,
    zon: v.zon,
    orsak: v.orsak,
    location: v.location,
    kbana: v.kbana,
  }));
}
