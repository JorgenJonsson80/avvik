// importParser.backup.test.js
// Integrationstest: läser en RIKTIG AvvikelseLive-export (.xlsx) och verifierar
// att parseBackupFile ger rätt resultat.
//
// VARFÖR detta test finns: hemmaversionens parseBackupFile läste fel flik
// (SheetNames[0] = "Sammanfattning" istället för "Rådata") och kunde därför inte
// läsa exportfiler alls. Det testet hade fångat det direkt. Fixturen nedan har
// MED FLIT "Sammanfattning" som första flik — precis som den riktiga exporten —
// så att testet bevisar att rätt flik hittas.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as XLSX from "xlsx";
import { parseBackupFile } from "../src/lib/importParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures");

function loadWorkbook(name) {
  const buf = readFileSync(join(fixtureDir, name));
  return XLSX.read(buf, { type: "buffer" });
}

describe("parseBackupFile — riktig exportfil", () => {
  const expected = JSON.parse(
    readFileSync(join(fixtureDir, "export-sample.expected.json"), "utf8")
  );

  it("hittar Rådata-fliken även när Sammanfattning ligger först", () => {
    const wb = loadWorkbook("export-sample.xlsx");
    // Säkerställ att fixturen verkligen har Sammanfattning först (annars testar vi fel sak)
    expect(wb.SheetNames[0].toLowerCase()).toContain("sammanfattning");

    const { records, error } = parseBackupFile(wb);
    expect(error).toBe(null);
    expect(records.length).toBeGreaterThan(0);
  });

  it("läser rätt antal poster", () => {
    const { records } = parseBackupFile(loadWorkbook("export-sample.xlsx"));
    expect(records.length).toBe(expected.totalRecords);
  });

  it("summerar antal avvikelser korrekt", () => {
    const { records } = parseBackupFile(loadWorkbook("export-sample.xlsx"));
    const total = records.reduce((s, r) => s + (r.count || 0), 0);
    expect(total).toBe(expected.totalAvvikelser);
  });

  it("strippar 'Zon '-prefix (Zon 2 → 2)", () => {
    const { records } = parseBackupFile(loadWorkbook("export-sample.xlsx"));
    const zoner = [...new Set(records.map((r) => r.zon || "?"))].sort();
    // Inga värden ska börja med "Zon "
    for (const z of zoner) {
      expect(String(z).startsWith("Zon ")).toBe(false);
    }
    expect(zoner).toEqual(expected.zoner);
  });

  it("varje post har datum och vnr", () => {
    const { records } = parseBackupFile(loadWorkbook("export-sample.xlsx"));
    for (const r of records.slice(0, 50)) {
      expect(r.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.vnr).toBeTruthy();
    }
  });
});
