// routes.js
// Avgångstider per tur + tidsberäkning. Kopierad VERBATIM från AvvikelseLive.html.

export const ROUTE_TIMES = {
  "101":"09:00","102":"09:00","103":"09:00","112":"09:15","104":"09:30","106":"09:30","109":"09:30",
  "115":"09:30","127":"09:30","107":"09:35","117":"09:45","108":"09:50","105":"10:00",
  "111":"10:00","110":"10:00","124":"10:00","138":"10:15","114":"10:30","130":"10:30",
  "137":"10:45","120":"11:00","123":"11:00","134":"11:00","131":"11:15","132":"11:45",
  "129":"11:45","135":"12:15","128":"12:00","116":"12:30","119":"12:30","139":"12:30",
  "140":"13:00","121":"13:00","144":"13:15","136":"13:30","145":"13:30","148":"13:30",
  "122":"13:30","118":"13:45","125":"14:00","126":"14:10",
  "214":"16:00","202":"17:30","203":"17:30","204":"17:30","205":"17:30","206":"17:30",
  "207":"17:30","208":"17:30","209":"17:30","210":"17:30","211":"17:30","212":"17:30",
  "213":"17:30","215":"17:30","226":"17:30","265":"17:30","224":"18:30","802":"18:30",
  "260":"19:30","219":"19:30","261":"19:30","262":"19:30","264":"19:30","266":"19:30",
  "251":"19:30","253":"19:30","254":"19:30","256":"20:30","257":"21:30","218":"21:00",
  "220":"21:00","221":"21:00","222":"21:00","299":"21:00","225":"21:00","227":"21:00",
  "228":"21:00","229":"21:00",
};

export const ROUTE_RANGES = [
  { from: 271, to: 292, time: "18:00" },
  { from: 230, to: 244, time: "19:30" },
  { from: 220, to: 229, time: "21:00" },
];

/**
 * Returnerar { tid, nastaDag } för en tur-kod.
 */
export function getAvgangstid(routeCode) {
  const rc = String(routeCode || "").trim();
  if (!rc) return { tid: null, nastaDag: false };
  if (ROUTE_TIMES[rc]) return { tid: ROUTE_TIMES[rc], nastaDag: false };
  const n = parseInt(rc, 10);
  for (const r of ROUTE_RANGES) {
    if (!isNaN(n) && n >= r.from && n <= r.to) return { tid: r.time, nastaDag: false };
  }
  if (rc.startsWith("8")) return { tid: null, nastaDag: true };
  if (/^[3456]/.test(rc)) return { tid: "18:00", nastaDag: false };
  return { tid: null, nastaDag: false };
}

/**
 * Minuter mellan avvikelsetid och avgångstid. Negativt = efter avgång.
 */
export function minutesBeforeDeparture(devTime, avgTid) {
  if (!devTime || !avgTid) return null;
  const [dh, dm] = devTime.split(":").map(Number);
  const [ah, am] = avgTid.split(":").map(Number);
  if (isNaN(dh) || isNaN(ah)) return null;
  return (ah * 60 + am) - (dh * 60 + dm);
}

/**
 * Formaterar minuter-före-avgång till läsbar svensk text.
 */
export function formatMinBefore(mins, nastaDag) {
  if (nastaDag) return "nästa dag";
  if (mins === null) return "";
  if (mins < 0) return `${Math.abs(mins)} min EFTER avgång`;
  if (mins < 60) return `${mins} min före`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m === 0 ? `${h} tim före` : `${h}t ${m}m före`;
}
