// classify.js
// Klassificeringslogik för lagerplatser. Kopierad VERBATIM från AvvikelseLive.html.
// Ändra inte beteendet — detta speglar den fysiska lagerstrukturen på SDS.

/**
 * Klassificerar en lagerplats (t.ex. "P101-23") till en K-bana (t.ex. "K52").
 * Returnerar null om platsen inte matchar någon känd bana.
 */
export function classifyLocation(loc) {
  if (!loc || typeof loc !== "string") return null;
  const s = loc.trim().toUpperCase();
  if (s.startsWith("PD")) return "K62";
  if (s.startsWith("PH")) return "K63";
  if (!/^P\d/.test(s)) return null;
  const stn = parseInt(s.substring(3, 5), 10);
  if (isNaN(stn)) return null;
  const afterDash = s.split("-")[1] || "";
  const lplMatch = afterDash.match(/^(\d+)/);
  const lpl = lplMatch ? parseInt(lplMatch[1], 10) : null;
  const lastDigit = lpl !== null ? lpl % 10 : null;
  const isEven = lastDigit !== null && lastDigit % 2 === 0;
  const isOdd = lastDigit !== null && lastDigit % 2 === 1;
  const t7 = s[6], t8 = s[7], t10 = s[9], t11 = s[10];
  const t1011 = (t10 || "") + (t11 || "");
  if (s.startsWith("P3")) {
    const t7d = /[0-9]/.test(t7 || "");
    const n = parseInt(t1011, 10);
    if (t7d || t8 === "A" || (t8 === "B" && !isNaN(n) && n >= 1 && n <= 13)) return "K55";
  }
  if (stn === 36) return "K61-36";
  if (s.startsWith("P101")) {
    if (isEven) return "K51";
    if (isOdd && stn >= 10 && stn <= 14) return "K52";
    if (isOdd && stn >= 15 && stn <= 18) return "K53";
  }
  if (s.startsWith("P102")) {
    if (isEven) return "K56";
    if (isOdd && stn >= 20 && stn <= 23) return "K53";
    if (isOdd && stn >= 24 && stn <= 27) return "K52";
  }
  if (s.startsWith("P4")) { if (isEven) return "K58"; if (isOdd) return "K56"; }
  if (s.startsWith("P6")) {
    if (isEven) return "K58";
    if (isOdd && stn >= 60 && stn <= 67) {
      if (lpl !== null) { if (lpl <= 43) return "K60"; if (lpl >= 45) return "K59"; }
    }
  }
  if (s.startsWith("P7")) {
    if (isEven) return "K61-7";
    if (isOdd && stn >= 71 && stn <= 77) {
      if (lpl !== null) { if (lpl <= 81) return "K59"; if (lpl >= 83) return "K60"; }
    }
  }
  return null;
}

/**
 * Härleder zon (1/2/3) från lagerplatsens prefix. "?" om okänd.
 */
export function getZon(location) {
  if (!location) return "?";
  const l = String(location).toUpperCase();
  if (l.startsWith("P1")) return "1";
  if (l.startsWith("P3") || l.startsWith("PD")) return "3";
  if (l.startsWith("P4") || l.startsWith("P6") || l.startsWith("P7")) return "2";
  return "?";
}

/**
 * Härleder zon från stationsnummer (används vid rader-import).
 */
export function stationToZon(station) {
  const n = parseInt(station, 10);
  if (isNaN(n)) return "?";
  if (n === 36 || n === 50) return "3";
  if (n >= 10 && n <= 27) return "1";
  if (n >= 30 && n <= 77) return "2";
  return "?";
}
