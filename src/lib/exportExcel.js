import * as XLSX from "xlsx";

function fmtPct(n, total) { return total > 0 ? +((n / total * 100).toFixed(1)) : 0; }
function fmtPromVal(avv, rad) { return rad > 0 ? +((avv / rad * 1000).toFixed(2)) : "—"; }
function zonLabel(z) { return /^\d+$/.test(z) ? `Zon ${z}` : (z || "?"); }

// Main export — accepts rows + optional context for rich multi-sheet output.
// options: { filename, settings: { goal, cost, time_min }, rader: [{datum, zon1, zon2, zon3}] }
export function exportDeviationsToExcel(rows, options = {}) {
  const { filename, settings = {}, rader = [] } = options;
  const cost     = settings.cost     ?? 63;
  const timePMin = settings.time_min ?? 13;
  const goal     = settings.goal     ?? 2.0;

  // ─── Grundaggregat ──────────────────────────────────────────────────
  const totalCount  = rows.reduce((s, r) => s + (r.count || 0), 0);
  const uniqueVnrs  = new Set(rows.map((r) => r.vnr)).size;
  const uniqueDatum = [...new Set(rows.map((r) => String(r.datum).slice(0, 10)))].sort();
  const snittDag    = uniqueDatum.length ? Math.round(totalCount / uniqueDatum.length) : 0;
  const totalKr     = totalCount * cost;
  const totalTimH   = +(totalCount * timePMin / 60).toFixed(1);
  const heltid      = +(totalTimH / 8).toFixed(1);

  // Rader per zon (summerat över period)
  const radByDatum = {};
  rader.forEach((r) => { radByDatum[String(r.datum).slice(0, 10)] = r; });
  let rZ1 = 0, rZ2 = 0, rZ3 = 0;
  uniqueDatum.forEach((d) => {
    const rd = radByDatum[d] || {};
    rZ1 += rd.zon1 || 0; rZ2 += rd.zon2 || 0; rZ3 += rd.zon3 || 0;
  });
  const totalRader = rZ1 + rZ2 + rZ3;

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
    ["Totalt antal rader", totalRader || "—"],
    ["Avvikelsegrad (‰)", totalRader ? fmtPromVal(totalCount, totalRader) : "—"],
    ["", ""],
    ["Kostnad per avvikelse (kr)", cost],
    ["Total kostnad (kr)", totalKr],
    ["Minuter per avvikelse", timePMin],
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

  // ─── Spara ──────────────────────────────────────────────────────────
  const name = filename ?? `avvikelser_${uniqueDatum[0] ?? now.toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
}
