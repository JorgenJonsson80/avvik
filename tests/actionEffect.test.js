import { describe, it, expect } from "vitest";
import { actionEffect } from "../src/lib/actionEffect.js";

// Scenario: VNR 123 avvek ×5/dag i tre dagar, sen åtgärd 2026-06-10, sen ×1/dag.
const devs = [
  { vnr: "123", datum: "2026-06-07", count: 5 },
  { vnr: "123", datum: "2026-06-08", count: 5 },
  { vnr: "123", datum: "2026-06-09", count: 5 },
  { vnr: "123", datum: "2026-06-11", count: 1 },
  { vnr: "123", datum: "2026-06-12", count: 1 },
  { vnr: "999", datum: "2026-06-11", count: 20 }, // brus, annan VNR
];

describe("actionEffect", () => {
  it("räknar före/efter korrekt och flaggar improved", () => {
    const e = actionEffect("123", "2026-06-10", devs);
    expect(e.beforeDays).toBe(3);
    expect(e.afterDays).toBe(2);
    expect(e.beforePerDay).toBe(5);
    expect(e.afterPerDay).toBe(1);
    expect(Math.round(e.deltaPct)).toBe(-80);
    expect(e.status).toBe("improved");
    expect(e.afterTotal).toBe(2); // ignorerar annan VNR
  });

  it("status pending när åtgärden ligger i framtiden (ingen efter-data)", () => {
    const p = actionEffect("123", "2026-06-20", devs);
    expect(p.status).toBe("pending");
  });

  it("status worse när avvikelserna ökar efter åtgärden", () => {
    const worse = actionEffect("123", "2026-06-08", [
      { vnr: "123", datum: "2026-06-07", count: 1 },
      { vnr: "123", datum: "2026-06-09", count: 5 },
    ]);
    expect(worse.status).toBe("worse");
  });
});
