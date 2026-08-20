import { describe, it, expect } from "vitest";
import { vnrStreaks } from "../src/lib/streaks.js";

describe("vnrStreaks", () => {
  it("räknar en enkel svit och flaggar den aktiv när sista dagen = senaste datadagen", () => {
    const rows = [
      { vnr: "A", datum: "2026-06-01", count: 2, zon: "1" },
      { vnr: "A", datum: "2026-06-02", count: 2, zon: "1" },
      { vnr: "A", datum: "2026-06-03", count: 2, zon: "1" },
    ];
    const [a] = vnrStreaks(rows);
    expect(a.days).toBe(3);
    expect(a.streak).toBe(3);
    expect(a.active).toBe(true);
    expect(a.total).toBe(6);
  });

  it("streak = sviten som slutar på VNR:ns SENASTE dag, inte den längsta någonsin", () => {
    // VNR hade 5 dagar i rad i juni, tystnade i nästan en månad, dök sen upp
    // EN dag i juli (som råkar vara senaste datadagen totalt). Sviten från
    // juni är avslutad — den aktuella sviten är bara 1 dag.
    const rows = [
      { vnr: "A", datum: "2026-06-01", count: 3 },
      { vnr: "A", datum: "2026-06-02", count: 3 },
      { vnr: "A", datum: "2026-06-03", count: 3 },
      { vnr: "A", datum: "2026-06-04", count: 3 },
      { vnr: "A", datum: "2026-06-05", count: 3 },
      { vnr: "A", datum: "2026-07-01", count: 1 },
    ];
    const [a] = vnrStreaks(rows);
    expect(a.days).toBe(6);
    expect(a.streak).toBe(1);
    expect(a.active).toBe(true); // 2026-07-01 ÄR senaste datadagen
  });

  it("active = false när VNR:ns senaste dag inte är den övergripande senaste datadagen", () => {
    const rows = [
      { vnr: "A", datum: "2026-06-01", count: 1 },
      { vnr: "A", datum: "2026-06-02", count: 1 },
      { vnr: "A", datum: "2026-06-03", count: 1 },
      { vnr: "B", datum: "2026-06-10", count: 1 }, // sätter senaste datadag
    ];
    const a = vnrStreaks(rows).find((v) => v.vnr === "A");
    expect(a.streak).toBe(3);
    expect(a.active).toBe(false);
  });

  it("bryter sviten vid ett hopp > 1 dag, räknar bara den trailing delen", () => {
    const rows = [
      { vnr: "A", datum: "2026-06-01", count: 1 },
      { vnr: "A", datum: "2026-06-02", count: 1 },
      // hopp: 06-03 saknas
      { vnr: "A", datum: "2026-06-04", count: 1 },
      { vnr: "A", datum: "2026-06-05", count: 1 },
      { vnr: "A", datum: "2026-06-06", count: 1 },
    ];
    const [a] = vnrStreaks(rows);
    expect(a.days).toBe(5);
    expect(a.streak).toBe(3); // 06-04, 06-05, 06-06
    expect(a.active).toBe(true);
  });

  it("håller VNR:er separata och ignorerar brus från andra VNR", () => {
    const rows = [
      { vnr: "A", datum: "2026-06-01", count: 1 },
      { vnr: "A", datum: "2026-06-02", count: 1 },
      { vnr: "B", datum: "2026-06-01", count: 9 },
      { vnr: "B", datum: "2026-06-02", count: 9 },
      { vnr: "B", datum: "2026-06-03", count: 9 },
    ];
    const byVnr = Object.fromEntries(vnrStreaks(rows).map((v) => [v.vnr, v]));
    expect(byVnr.A.streak).toBe(2);
    expect(byVnr.A.total).toBe(2);
    expect(byVnr.B.streak).toBe(3);
    expect(byVnr.B.total).toBe(27);
  });

  it("en enda dag ger streak 1 och days 1", () => {
    const rows = [{ vnr: "A", datum: "2026-06-01", count: 4 }];
    const [a] = vnrStreaks(rows);
    expect(a.days).toBe(1);
    expect(a.streak).toBe(1);
    expect(a.active).toBe(true);
  });
});
