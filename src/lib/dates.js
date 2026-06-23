// dates.js
// Datumparsning + formatteringshjälpare. Kopierad VERBATIM från AvvikelseLive.html.

/**
 * Robust parsning av Excel-datum till ISO-sträng (YYYY-MM-DD).
 * Hanterar Date-objekt, strängar i flera format, och Excel-serienummer.
 */
export function excelDateToISO(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof val === "string") {
    const v = val.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const dotMatch = v.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/);
    if (dotMatch) {
      return `${dotMatch[1]}-${String(dotMatch[2]).padStart(2,"0")}-${String(dotMatch[3]).padStart(2,"0")}`;
    }
    if (/^\d{8}$/.test(v)) {
      return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
    }
    const d = new Date(v);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const da = String(d.getDate()).padStart(2, "0");
      return `${y}-${mo}-${da}`;
    }
  }
  if (typeof val === "number" && val > 19000000 && val < 99999999) {
    const s = String(val);
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  }
  if (typeof val === "number") {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return null;
}

/**
 * Formaterar ett belopp till svensk kr-sträng.
 */
export function fmtKr(n) {
  return Math.round(n).toLocaleString("sv-SE") + " kr";
}

/**
 * Formaterar minuter till timmar (svensk formatering).
 */
export function fmtTimmar(mins) {
  const h = mins / 60;
  if (h < 10) return h.toFixed(1) + " tim";
  return Math.round(h).toLocaleString("sv-SE") + " tim";
}
