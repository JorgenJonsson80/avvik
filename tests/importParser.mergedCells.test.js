// importParser.mergedCells.test.js
// JDE-exporten slår ibland ihop celler i artikelnummer-kolumnen när samma VNR
// scannas flera gånger i rad — bara toppcellen får ett värde, resten blir
// tomma i sheet_to_json. Utan utfyllnad tolkas de tomma raderna som saknad
// VNR och försvinner ur räkningen, vilket gav ett för lågt ×count för
// VNR med flera scanningar i rad (upptäckt på riktig data 2026-06-XX).

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseX08 } from "../src/lib/importParser.js";

function buildMergedX08Workbook() {
  const data = [
    ["Item Number", "Location", "Route", "Ship To", "Time Updated", "Date Updated"],
    ["111222", "P101-12", "120", "K12345", "10:30:00", "2026-05-25"],
    ["", "P101-12", "120", "K12345", "10:31:30", "2026-05-25"],
    ["", "P101-13", "120", "K12345", "10:45:00", "2026-05-25"],
    ["333444", "P102-24", "125", "K22222", "11:15:00", "2026-05-25"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  // Simulerar Excelns sammanslagning av artikelnummer-cellen över rad 1–3 (0-indexerat).
  sheet["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "X08");
  return wb;
}

describe("parseX08 — sammanslagna celler i artikelnummer-kolumnen", () => {
  it("räknar alla scanningar för en VNR, även när cellen är sammanslagen", () => {
    const { records, error } = parseX08(buildMergedX08Workbook());
    expect(error).toBe(null);

    const vnr111222 = records.find((r) => r.vnr === "111222");
    expect(vnr111222.count).toBe(3);
    expect(vnr111222.locations).toEqual(["P101-12", "P101-13"]);

    const vnr333444 = records.find((r) => r.vnr === "333444");
    expect(vnr333444.count).toBe(1);
  });
});
