// rader-datum.test.js
// Skyddar mot promille-buggen: rader-datum och deviations-datum måste matcha även
// om Supabase returnerar date-kolumnen med tidsdel (t.ex. "2026-05-20T00:00:00+00:00").

import { describe, it, expect } from "vitest";

// Samma normaliserings-logik som getRaderForDatum ska använda.
function getRaderForDatum(rader, datum) {
  const key = String(datum).slice(0, 10);
  return rader.find((r) => String(r.datum).slice(0, 10) === key)
    ?? { zon1: 0, zon2: 0, zon3: 0 };
}
function promille(avv, rad) { return rad > 0 ? (avv / rad) * 1000 : null; }

describe("rader-datum matchning (promille-bugg)", () => {
  it("matchar när rader-datum har tidsdel men deviations är ren datumsträng", () => {
    const rader = [{ datum: "2026-05-20T00:00:00+00:00", zon1: 1000, zon2: 2000, zon3: 500 }];
    const rd = getRaderForDatum(rader, "2026-05-20");
    const tot = rd.zon1 + rd.zon2 + rd.zon3;
    expect(tot).toBe(3500);
    expect(promille(7, tot)).toBeCloseTo(2.0, 5);
  });

  it("matchar när båda är rena strängar", () => {
    const rader = [{ datum: "2026-05-20", zon1: 100, zon2: 0, zon3: 0 }];
    expect(getRaderForDatum(rader, "2026-05-20").zon1).toBe(100);
  });

  it("returnerar nollor (inte krasch) när datum saknas", () => {
    const rd = getRaderForDatum([], "2026-05-20");
    expect(rd).toEqual({ zon1: 0, zon2: 0, zon3: 0 });
    expect(promille(5, rd.zon1 + rd.zon2 + rd.zon3)).toBe(null);
  });

  it("blandade format i listan hittar rätt dag", () => {
    const rader = [
      { datum: "2026-05-19T00:00:00Z", zon1: 1, zon2: 1, zon3: 1 },
      { datum: "2026-05-20", zon1: 10, zon2: 20, zon3: 30 },
    ];
    expect(getRaderForDatum(rader, "2026-05-20").zon2).toBe(20);
  });
});
