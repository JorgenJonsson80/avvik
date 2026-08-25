import * as XLSX from "xlsx";
import { ORSAK_ANSVAR } from "./causes.js";
import { vnrStreaks } from "./streaks.js";
import { totalRader } from "./rader.js";

function fmtPct(n, total) { return total > 0 ? +((n / total * 100).toFixed(1)) : 0; }
function fmtPromVal(avv, rad) { return rad > 0 ? +((avv / rad * 1000).toFixed(2)) : "—"; }
function zonLabel(z) { return /^\d+$/.test(z) ? `Zon ${z}` : (z || "?"); }

// Main export — accepts rows + optional context for rich multi-sheet output.
// options: { filename, settings: { goal, cost }, rader: [{datum, zon1, zon2, zon3}], allDeviations }
export function exportDeviationsToExcel(rows, options = {}) {
  const { filename, settings = {}, rader = [], allDeviations } = options;
  const cost        = settings.cost ?? 63;
  const goal        = settings.goal ?? 2.0;
  const minPerVnrDag = 2.5;

  // ─── Grundaggregat ──────────────────────────────────────────────────
  const totalCount  = rows.reduce((s, r) => s + (r.count || 0), 0);
  const uniqueVnrs  = new Set(rows.map((r) => r.vnr)).size;
  const uniqueDatum = [...new Set(rows.map((r) => String(r.datum).slice(0, 10)))].sort();
  const snittDag    = uniqueDatum.length ? Math.round(totalCount / uniqueDatum.length) : 0;
  const totalKr     = totalCount * cost;

  // Tid: unika VNR per dag × 2,5 min — flera missar på samma VNR samma dag
  // räknas som en åtgärd, inte en per missad rad.
  const vnrPerDag = {};
  rows.forEach((r) => {
    const d = String(r.datum).slice(0, 10);
    (vnrPerDag[d] = vnrPerDag[d] || new Set()).add(r.vnr);
  });
  const uniqueVnrDagar = Object.values(vnrPerDag).reduce((s, set) => s + set.size, 0);
  const totalTimH   = +(uniqueVnrDagar * minPerVnrDag / 60).toFixed(1);
  const heltid      = +(totalTimH / 8).toFixed(1);

  // Rader per zon (summerat över period)
  const radByDatum = {};
  rader.forEach((r) => { radByDatum[String(r.datum).slice(0, 10)] = r; });
  let rZ1 = 0, rZ2 = 0, rZ3 = 0, rTot = 0;
  uniqueDatum.forEach((d) => {
    const rd = radByDatum[d] || {};
    rZ1 += rd.zon1 || 0; rZ2 += rd.zon2 || 0; rZ3 += rd.zon3 || 0;
    rTot += totalRader(rd);
  });
  const totalRows = rTot;

  const period = uniqueDatum.length === 1
    ? uniqueDatum[0]
    : `${uniqueDatum[0]} – ${uniqueDatum[uniqueDatum.length - 1]}`;

  const now = new Date();
  const ts  = `${now.toISOString().slice(0, 10)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const wb = XLSX.utils.book_new();

  // ─── Sheet 1: Sammanfattning ─────────────────────────────────────────
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["AvvikelseLive – Sammanfattning", ""],
    ["Exporterad", ts],
    ["Period", period],
    ["", ""],
    ["Totalt antal avvikelser", totalCount],
    ["Unika VNR", uniqueVnrs],
    ["Antal dagar", uniqueDatum.length],
    ["Snitt per dag", snittDag],
    ["", ""],
    ["Mål avvikelsegrad (‰)", goal],
    ["Totalt antal rader", totalRows || "—"],
    ["Avvikelsegrad (‰)", totalRows ? fmtPromVal(totalCount, totalRows) : "—"],
    ["", ""],
    ["Kostnad per avvikelse (kr)", cost],
    ["Total kostnad (kr)", totalKr],
    ["Unika VNR-dagar", uniqueVnrDagar],
    ["Minuter per unik VNR/dag", minPerVnrDag],
    ["Total nedlagd tid (tim)", totalTimH],
    ["Motsvarar heltidstjänster (40h/v)", heltid],
  ]), "Sammanfattning");

  // ─── Sheet 2: Per orsak ─────────────────────────────────────────────
  const orsakCount = {}, orsakVnrs = {};
  rows.forEach((r) => {
    const o = r.orsak || "Okänd";
    orsakCount[o] = (orsakCount[o] || 0) + (r.count || 0);
    (orsakVnrs[o] = orsakVnrs[o] || new Set()).add(r.vnr);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Orsak", "Antal avvikelser", "Unika VNR", "Andel %"],
    ...Object.entries(orsakCount)
      .sort((a, b) => b[1] - a[1])
      .map(([o, n]) => [o, n, orsakVnrs[o].size, fmtPct(n, totalCount)]),
  ]), "Per orsak");

  // ─── Sheet 3: Per zon ───────────────────────────────────────────────
  const zonCount = {};
  rows.forEach((r) => {
    const z = r.zon || "?";
    zonCount[z] = (zonCount[z] || 0) + (r.count || 0);
  });
  const zonRaderMap = { "1": rZ1, "2": rZ2, "3": rZ3 };
  const zonOrder = [...new Set([...["1", "2", "3"], ...Object.keys(zonCount)])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Zon", "Antal avvikelser", "Andel %", "Antal rader", "Avvikelsegrad ‰"],
    ...zonOrder
      .filter((z) => (zonCount[z] || 0) > 0)
      .map((z) => {
        const n  = zonCount[z] || 0;
        const rd = zonRaderMap[z] || 0;
        return [zonLabel(z), n, fmtPct(n, totalCount), rd || "—", fmtPromVal(n, rd)];
      }),
    ["Totalt", totalCount, fmtPct(totalCount, totalCount), totalRows || "—", totalRows ? fmtPromVal(totalCount, totalRows) : "—"],
  ]), "Per zon");

  // ─── Sheet 4: Per K-bana ────────────────────────────────────────────
  const kbanaCount = {};
  rows.forEach((r) => {
    const k = r.kbana || "";
    if (k) kbanaCount[k] = (kbanaCount[k] || 0) + (r.count || 0);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["K-bana", "Antal avvikelser", "Andel %"],
    ...Object.entries(kbanaCount)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => [k, n, fmtPct(n, totalCount)]),
  ]), "Per K-bana");

  // ─── Sheet 5: Rådata (en rad per VNR-dag) ───────────────────────────
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Datum", "VNR", "Lagerplats", "K-bana", "Zon", "Tur", "Avgångstid", "Min före avg", "Ship To", "Antal", "Orsak", "Kommentar"],
    ...rows.map((r) => [
      String(r.datum).slice(0, 10),
      r.vnr,
      (r.locations || [])[0] || "",
      r.kbana || "",
      zonLabel(r.zon || "?"),
      r.route_code || "",
      r.nasta_dag ? "nästa dag" : (r.avgangstid || ""),
      r.min_fore_avgang ?? "",
      r.ship_to || "",
      r.count || 0,
      r.orsak || "",
      r.kommentar || "",
    ]),
  ]), "Rådata");

  // ─── Sheet 6: Per avvikelse (en rad per scan, med klockslag) ────────
  const perAvvRows = [["Datum", "Klockslag", "VNR", "Lagerplats", "K-bana", "Zon", "Tur", "Avgångstid", "Min före avg", "Ship To", "Orsak"]];
  rows.forEach((r) => {
    const times = r.times || [];
    const count = r.count || 0;
    const lager = (r.locations || [])[0] || "";
    const zon   = zonLabel(r.zon || "?");
    const datum = String(r.datum).slice(0, 10);
    for (let i = 0; i < count; i++) {
      perAvvRows.push([
        datum,
        times[i] || "",
        r.vnr,
        lager,
        r.kbana || "",
        zon,
        r.route_code || "",
        r.nasta_dag ? "nästa dag" : (r.avgangstid || ""),
        r.min_fore_avgang ?? "",
        r.ship_to || "",
        r.orsak || "",
      ]);
    }
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perAvvRows), "Per avvikelse");

  // ─── Sheet 7: Hög prioritet (Analys) — aktiva sviter ≥3 dagar i rad ─
  // Samma tröskel som "hög" prio i Analys-fliken: pågående streak till senaste datadag.
  // OBS: streaks räknas mot FULL historik (allDeviations), inte den exporterade
  // (ev. datum-filtrerade) delmängden `rows` — annars kan en enda dags export
  // aldrig innehålla en streak ≥3 och fliken blir alltid tom.
  const hogPrio = vnrStreaks(allDeviations ?? rows)
    .filter((v) => v.streak >= 3 && v.active)
    .sort((a, b) => b.streak - a.streak || b.total - a.total);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["VNR", "Dagar i rad", "Totalt antal", "Lagerplats", "K-bana", "Zon", "Orsak", "Ansvar"],
    ...hogPrio.map((v) => [
      v.vnr, v.streak, v.total, v.location, v.kbana, zonLabel(v.zon || "?"),
      v.orsak || "", ORSAK_ANSVAR[v.orsak] || "",
    ]),
  ]), "Hög prioritet");

  // ─── Spara ──────────────────────────────────────────────────────────
  const name = filename ?? `avvikelser_${uniqueDatum[0] ?? now.toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
}
