import { describe, it, expect } from "vitest";
import { kontrollArea, markKontrollScans, kontrollStatsByVnr, scanOrsak } from "../src/lib/kontroll.js";

const ms = (h, m) => (h * 3600 + m * 60) * 1000;

describe("kontrollArea", () => {
  it("grupperar P4 och P6 som samma område", () => {
    expect(kontrollArea("P4040-29")).toBe("P4P6");
    expect(kontrollArea("P6060-10")).toBe("P4P6");
  });
  it("egna områden för P1, P3, P7, PD, PH", () => {
    expect(kontrollArea("P101-23")).toBe("P1");
    expect(kontrollArea("P3036-10")).toBe("P3");
    expect(kontrollArea("P7071-26")).toBe("P7");
    expect(kontrollArea("PD12-01")).toBe("PD");
    expect(kontrollArea("PH99-01")).toBe("PH");
  });
  it("KG kyl och okänt deltar inte (null)", () => {
    expect(kontrollArea("P5050-10")).toBe(null);
    expect(kontrollArea("XYZ")).toBe(null);
    expect(kontrollArea("")).toBe(null);
  });
});

describe("markKontrollScans", () => {
  it("2 OLIKA varor samma område inom 2 min → kontroll", () => {
    const r = markKontrollScans([
      { vnr: "A", area: kontrollArea("P101-10"), timeMs: ms(10, 11) },
      { vnr: "B", area: kontrollArea("P102-12"), timeMs: ms(10, 12) },
    ]);
    expect(r.every((s) => s.inKontroll)).toBe(true);
  });

  it("SAMMA vara två gånger → INTE kontroll (kräver olika VNR)", () => {
    const r = markKontrollScans([
      { vnr: "A", area: kontrollArea("P101-10"), timeMs: ms(10, 11) },
      { vnr: "A", area: kontrollArea("P101-10"), timeMs: ms(10, 12) },
    ]);
    expect(r.every((s) => !s.inKontroll)).toBe(true);
  });

  it("P4 + P6 tillsammans → kontroll (samma grupp)", () => {
    const r = markKontrollScans([
      { vnr: "A", area: kontrollArea("P4040-30"), timeMs: ms(9, 0) },
      { vnr: "B", area: kontrollArea("P6060-10"), timeMs: ms(9, 1) },
    ]);
    expect(r.every((s) => s.inKontroll)).toBe(true);
  });

  it("vara i kedja tidigt + samma vara ensam senare → bara den första är kontroll", () => {
    const r = markKontrollScans([
      { vnr: "A", area: kontrollArea("P101-10"), timeMs: ms(10, 11) },
      { vnr: "B", area: kontrollArea("P102-12"), timeMs: ms(10, 12) },
      { vnr: "A", area: kontrollArea("P101-10"), timeMs: ms(11, 50) },
    ]);
    const aEarly = r.find((s) => s.vnr === "A" && s.timeMs === ms(10, 11));
    const aLate  = r.find((s) => s.vnr === "A" && s.timeMs === ms(11, 50));
    expect(aEarly.inKontroll).toBe(true);
    expect(aLate.inKontroll).toBe(false);
  });

  it("olika områden räknas inte ihop", () => {
    const r = markKontrollScans([
      { vnr: "A", area: kontrollArea("P101-10"), timeMs: ms(10, 11) },
      { vnr: "B", area: kontrollArea("P7071-10"), timeMs: ms(10, 12) },
    ]);
    expect(r.every((s) => !s.inKontroll)).toBe(true);
  });
});

describe("scanOrsak — prioritet tid > kontroll", () => {
  it("Före 08:00 vinner även om i kedja", () => {
    expect(scanOrsak(7, 28, true, "")).toBe("Före 08:00");
  });
  it("Utanför arbetstid (15:30+) vinner över kontroll", () => {
    expect(scanOrsak(15, 45, true, "")).toBe("Utanför min arbetstid");
  });
  it("kontroll gäller inom arbetstid om i kedja", () => {
    expect(scanOrsak(10, 11, true, "")).toBe("Kontrollavvikelse");
  });
  it("faller tillbaka på dagsorsak om ej i kedja och inom arbetstid", () => {
    expect(scanOrsak(10, 11, false, "Saldofel")).toBe("Saldofel");
    expect(scanOrsak(10, 11, false, "")).toBe("");
  });
  it("Loax/KG kyl → alltid Övrigt, vinner även över Före 08:00 och kontroll", () => {
    expect(scanOrsak(7, 0, true, "", "Loax")).toBe("Övrigt");
    expect(scanOrsak(16, 0, false, "", "KG kyl")).toBe("Övrigt");
    expect(scanOrsak(10, 0, true, "Saldofel", "Loax")).toBe("Övrigt");
  });
});

describe("kontrollStatsByVnr", () => {
  it("räknar kontroll vs total per VNR", () => {
    const marked = [
      { vnr: "A", inKontroll: true },
      { vnr: "A", inKontroll: false },
      { vnr: "B", inKontroll: true },
    ];
    const stats = kontrollStatsByVnr(marked);
    expect(stats.get("A")).toEqual({ kontroll: 1, total: 2 });
    expect(stats.get("B")).toEqual({ kontroll: 1, total: 1 });
  });
});
