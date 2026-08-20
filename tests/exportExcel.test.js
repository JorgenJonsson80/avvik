// exportExcel.test.js
// exportDeviationsToExcel() skriver riktigt en .xlsx-fil (XLSX.writeFile), så
// testet kör exporten mot en temp-fil och läser sedan tillbaka den — samma
// integrationsmönster som importParser.backup.test.js använder åt andra hållet.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { exportDeviationsToExcel } from "../src/lib/exportExcel.js";

const tmpDir = mkdtempSync(join(tmpdir(), "avvikelselive-export-"));
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

function runExport(rows, options = {}) {
  const filename = join(tmpDir, `test-${Math.random().toString(36).slice(2)}.xlsx`);
  exportDeviationsToExcel(rows, { ...options, filename });
  const wb = XLSX.readFile(filename);
  const sheets = {};
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
  }
  return sheets;
}

const rows = [
  { vnr: "111", datum: "2026-06-01", count: 2, zon: "1", kbana: "A", orsak: "Saldofel",
    locations: ["P101"], times: ["08:10", "08:15"], route_code: "10", avgangstid: "09:00",
    min_fore_avgang: 45, ship_to: "SDS" },
  { vnr: "222", datum: "2026-06-01", count: 1, zon: "2", kbana: "B", orsak: "Kontrollavvikelse",
    locations: ["P205"], times: ["10:00"], route_code: "20", avgangstid: "11:00",
    min_fore_avgang: 60, ship_to: "Tamro" },
  { vnr: "111", datum: "2026-06-02", count: 1, zon: "1", kbana: "A", orsak: "Saldofel",
    locations: ["P101"], times: ["08:05"] },
];

describe("exportDeviationsToExcel — Sammanfattning", () => {
  it("räknar grundaggregat och unik-VNR-dagar-tiden korrekt", () => {
    const s = runExport(rows, { settings: { cost: 63, goal: 2.0 } });
    const sum = s["Sammanfattning"];
    expect(sum).toContainEqual(["Totalt antal avvikelser", 4]);
    expect(sum).toContainEqual(["Unika VNR", 2]);
    expect(sum).toContainEqual(["Antal dagar", 2]);
    expect(sum).toContainEqual(["Snitt per dag", 2]);
    expect(sum).toContainEqual(["Total kostnad (kr)", 252]); // 4 × 63
    // 06-01 har 2 unika VNR (111,222), 06-02 har 1 (111) → 3 unika VNR-dagar
    expect(sum).toContainEqual(["Unika VNR-dagar", 3]);
  });
});

describe("exportDeviationsToExcel — Per orsak / Per zon / Per K-bana", () => {
  const s = runExport(rows);

  it("Per orsak: summerar count per orsak, sorterat fallande, med andel %", () => {
    expect(s["Per orsak"][0]).toEqual(["Orsak", "Antal avvikelser", "Unika VNR", "Andel %"]);
    expect(s["Per orsak"][1]).toEqual(["Saldofel", 3, 1, 75]);
    expect(s["Per orsak"][2]).toEqual(["Kontrollavvikelse", 1, 1, 25]);
  });

  it("Per zon: visar bara zoner med data, plus en Totalt-rad", () => {
    const zonSheet = s["Per zon"];
    expect(zonSheet.map((r) => r[0])).toEqual(["Zon", "Zon 1", "Zon 2", "Totalt"]);
    expect(zonSheet.find((r) => r[0] === "Zon 1")).toEqual(["Zon 1", 3, 75, "—", "—"]);
    expect(zonSheet.find((r) => r[0] === "Totalt")).toEqual(["Totalt", 4, 100, "—", "—"]);
  });

  it("Per K-bana: summerar count per K-bana, sorterat fallande", () => {
    expect(s["Per K-bana"][1]).toEqual(["A", 3, 75]);
    expect(s["Per K-bana"][2]).toEqual(["B", 1, 25]);
  });
});

describe("exportDeviationsToExcel — Rådata / Per avvikelse", () => {
  const s = runExport(rows);

  it("Rådata: en rad per VNR-dag, med rätt fältmappning", () => {
    const rad = s["Rådata"];
    expect(rad[1]).toEqual(["2026-06-01", "111", "P101", "A", "Zon 1", "10", "09:00", 45, "SDS", 2, "Saldofel", ""]);
  });

  it("Rådata: 'nästa dag' ersätter avgångstiden när nasta_dag är satt", () => {
    const withNextDay = [{ ...rows[0], nasta_dag: true }];
    const rad = runExport(withNextDay)["Rådata"];
    expect(rad[1][6]).toBe("nästa dag");
  });

  it("Per avvikelse: en rad per enskild scan (count expanderat), med klockslag", () => {
    const perAvv = s["Per avvikelse"];
    // 2 (VNR111 06-01) + 1 (VNR222 06-01) + 1 (VNR111 06-02) = 4 datarader + header
    expect(perAvv).toHaveLength(5);
    expect(perAvv[1]).toEqual(["2026-06-01", "08:10", "111", "P101", "A", "Zon 1", "10", "09:00", 45, "SDS", "Saldofel"]);
    expect(perAvv[2]).toEqual(["2026-06-01", "08:15", "111", "P101", "A", "Zon 1", "10", "09:00", 45, "SDS", "Saldofel"]);
  });
});

describe("exportDeviationsToExcel — Hög prioritet (aktiva sviter ≥3 dagar)", () => {
  it("tar med en VNR med pågående ≥3-dagarssvit, mätt mot allDeviations (full historik)", () => {
    const fullHistory = [
      { vnr: "999", datum: "2026-06-01", count: 1, zon: "1", kbana: "A", orsak: "Saldofel", locations: ["P1"] },
      { vnr: "999", datum: "2026-06-02", count: 1, zon: "1", kbana: "A", orsak: "Saldofel", locations: ["P1"] },
      { vnr: "999", datum: "2026-06-03", count: 1, zon: "1", kbana: "A", orsak: "Saldofel", locations: ["P1"] },
    ];
    // Exporten gäller bara en delmängd (senaste dagen), men allDeviations har hela sviten.
    const partialExport = fullHistory.slice(-1);
    const s = runExport(partialExport, { allDeviations: fullHistory });
    const hp = s["Hög prioritet"];
    expect(hp[0]).toEqual(["VNR", "Dagar i rad", "Totalt antal", "Lagerplats", "K-bana", "Zon", "Orsak", "Ansvar"]);
    expect(hp[1][0]).toBe("999");
    expect(hp[1][1]).toBe(3);
  });

  it("utelämnar en AVSLUTAD gammal svit som inte längre är aktiv (streak-regressionstest)", () => {
    // Samma scenario som fixades i streaks.js: 5 dagar i rad i juni, tyst i en
    // månad, dyker upp en enda dag i juli (= senaste datadagen). Ska INTE
    // hamna i Hög prioritet — den pågående sviten är bara 1 dag.
    const fullHistory = [
      { vnr: "A", datum: "2026-06-01", count: 3, zon: "1" },
      { vnr: "A", datum: "2026-06-02", count: 3, zon: "1" },
      { vnr: "A", datum: "2026-06-03", count: 3, zon: "1" },
      { vnr: "A", datum: "2026-06-04", count: 3, zon: "1" },
      { vnr: "A", datum: "2026-06-05", count: 3, zon: "1" },
      { vnr: "A", datum: "2026-07-01", count: 1, zon: "1" },
    ];
    const s = runExport(fullHistory.slice(-1), { allDeviations: fullHistory });
    expect(s["Hög prioritet"]).toHaveLength(1); // bara header, ingen datarad
  });
});
