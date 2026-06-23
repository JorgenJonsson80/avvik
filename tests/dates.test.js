// dates.test.js
import { describe, it, expect } from "vitest";
import { excelDateToISO, fmtKr, fmtTimmar } from "../src/lib/dates.js";

describe("excelDateToISO", () => {
  it("hanterar Date-objekt", () => {
    expect(excelDateToISO(new Date(2026, 5, 18))).toBe("2026-06-18");
  });
  it("hanterar ISO-strängar", () => {
    expect(excelDateToISO("2026-06-18")).toBe("2026-06-18");
    expect(excelDateToISO("2026-06-18T08:00:00")).toBe("2026-06-18");
  });
  it("hanterar punkt-format", () => {
    expect(excelDateToISO("2026.6.8")).toBe("2026-06-08");
  });
  it("hanterar 8-siffrigt format", () => {
    expect(excelDateToISO("20260618")).toBe("2026-06-18");
  });
  it("returnerar null för tomt", () => {
    expect(excelDateToISO(null)).toBe(null);
    expect(excelDateToISO("")).toBe(null);
  });
});

describe("fmtKr", () => {
  it("formaterar kr med svenska tusentalsavgränsare", () => {
    // OBS: toLocaleString('sv-SE') använder non-breaking space (U+00A0), inte vanligt mellanslag.
    const nbsp = "\u00A0";
    expect(fmtKr(115605)).toBe(`115${nbsp}605 kr`);
    expect(fmtKr(63)).toBe("63 kr");
  });
});

describe("fmtTimmar", () => {
  it("visar decimal under 10 tim", () => {
    expect(fmtTimmar(120)).toBe("2.0 tim");
  });
  it("avrundar över 10 tim", () => {
    expect(fmtTimmar(23820)).toBe("397 tim");
  });
});
