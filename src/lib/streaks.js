// streaks.js
// Beräknar per-VNR konsekutiva dagar-i-rad (streak). Delad mellan AnalysTab
// (åtgärdslista, "hög" prio = streak ≥ 3 och aktiv) och Excel-exporten.

import { classifyLocation } from "./classify.js";

function longestStreak(daysSet) {
  const sorted = [...daysSet].sort();
  if (sorted.length === 0) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.round((new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000);
    if (diff === 1) { cur++; best = Math.max(best, cur); }
    else cur = 1;
  }
  return best;
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
    streak: longestStreak(v.days),
    active: streakActive(v.days, lastDataDay),
    total: v.total,
    zon: v.zon,
    orsak: v.orsak,
    location: v.location,
    kbana: v.kbana,
  }));
}
