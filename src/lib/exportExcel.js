import * as XLSX from "xlsx";

export function exportDeviationsToExcel(rows, filename) {
  const data = rows.map((r) => ({
    Datum:               r.datum,
    VNR:                 r.vnr,
    Lagerplats:          (r.locations || []).join(", "),
    Zon:                 r.zon || "",
    "K-bana":            r.kbana || "",
    Tur:                 r.route_code || "",
    Avgångstid:          r.avgangstid || "",
    "Min före avg":      r.min_fore_avgang ?? "",
    "Nästa dag":         r.nasta_dag ? "Ja" : "Nej",
    Antal:               r.count,
    Orsak:               r.orsak || "",
    Kommentar:           r.kommentar || "",
    "Kontroll-scannar":  r.kontroll_scans || 0,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Avvikelser");
  XLSX.writeFile(wb, filename ?? `avvikelser_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
