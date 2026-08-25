import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseRader } from "../src/lib/importParser.js";

describe("parseRader — dagens total", () => {
  it("sparar alla stationers rader, utöver zonuppdelningen", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Datum", "Station", "Rader"],
      ["2026-08-25", "10", 100],
      ["2026-08-25", "30", 200],
      ["2026-08-25", "36", 300],
      ["2026-08-25", "Övrig station", 400],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Rader");

    const { rader, error } = parseRader(workbook);

    expect(error).toBe(null);
    expect(rader).toEqual({ zon1: 100, zon2: 200, zon3: 300, total: 1000 });
  });
});
