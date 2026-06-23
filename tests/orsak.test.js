// orsak.test.js
// Tester för per-scan-aggregeringen. Detta är den viktigaste funktionen att skydda —
// den läker gammal data OCH måste hålla summan exakt. Kör: npm test

import { describe, it, expect } from "vitest";
import { orsakBreakdown, forEachOrsak } from "../src/lib/orsak.js";

const sum = (d) => Object.values(d).reduce((s, v) => s + v, 0);

describe("orsakBreakdown", () => {
  it("gammal data utan events → hela count på dagsorsaken", () => {
    const r = { orsak: "Saldofel", count: 5 };
    expect(orsakBreakdown(r)).toEqual({ Saldofel: 5 });
  });

  it("läker felstämplad data: alla events Kontroll men dagen är Saldofel", () => {
    const r = {
      orsak: "Saldofel", count: 5,
      events: Array.from({ length: 5 }, (_, i) => ({ tid: `07:0${i}`, orsak: "Kontrollavvikelse" })),
    };
    // Alla events säger samma sak (Kontroll) → ignoreras, dagsorsaken vinner.
    expect(orsakBreakdown(r)).toEqual({ Saldofel: 5 });
  });

  it("respekterar äkta delning: blandade orsaker", () => {
    const r = {
      orsak: "Saldofel", count: 7,
      events: [
        { tid: "07:01", orsak: "Kontrollavvikelse" },
        { tid: "07:02", orsak: "Kontrollavvikelse" },
        { tid: "14:01", orsak: "Saldofel" },
        { tid: "14:02", orsak: "Saldofel" },
        { tid: "14:03", orsak: "Saldofel" },
        { tid: "14:04", orsak: "Saldofel" },
        { tid: "14:05", orsak: "Saldofel" },
      ],
    };
    expect(orsakBreakdown(r)).toEqual({ Kontrollavvikelse: 2, Saldofel: 5 });
  });

  it("skalar när scan-antal inte matchar count", () => {
    const r = {
      orsak: "Saldofel", count: 10,
      events: [
        { tid: "07:01", orsak: "Kontrollavvikelse" },
        { tid: "14:01", orsak: "Saldofel" },
        { tid: "14:02", orsak: "Saldofel" },
      ],
    };
    const result = orsakBreakdown(r);
    expect(sum(result)).toBe(10); // invarianten håller
  });

  it("events utan klockslag → fallback till dagsorsaken", () => {
    const r = { orsak: "Okänd", count: 3, events: [{ route: "101" }] };
    expect(orsakBreakdown(r)).toEqual({ Okänd: 3 });
  });

  // INVARIANT: summan ska ALLTID matcha count
  it("summan matchar alltid record.count", () => {
    const cases = [
      { orsak: "Saldofel", count: 5 },
      { orsak: "Saldofel", count: 7, events: [{ tid: "1", orsak: "A" }, { tid: "2", orsak: "B" }] },
      { orsak: "X", count: 100, events: [{ tid: "1", orsak: "A" }, { tid: "2", orsak: "B" }, { tid: "3", orsak: "C" }] },
      { orsak: "Y", count: 1, events: [] },
    ];
    for (const r of cases) {
      expect(sum(orsakBreakdown(r))).toBe(r.count);
    }
  });
});

describe("forEachOrsak", () => {
  it("itererar över alla orsaker i alla poster", () => {
    const records = [
      { orsak: "Saldofel", count: 3 },
      { orsak: "Kontrollavvikelse", count: 2 },
    ];
    const tally = {};
    forEachOrsak(records, (o, n) => { tally[o] = (tally[o] || 0) + n; });
    expect(tally).toEqual({ Saldofel: 3, Kontrollavvikelse: 2 });
  });
});
