// backfillKbana.test.js
// Beslutslogiken i scripts/backfill-kbana.mjs avgör vilka produktionsrader som
// skrivs om (K55 → K61-36), så den låses här. Bara de rena funktionerna testas —
// Supabase-anropen körs aldrig.

import { describe, it, expect } from "vitest";
import { classifyLocation } from "../src/lib/classify.js";
import {
  isCandidate, needsScans, recomputeKbana, planDeviationFixes, planActionFixes,
} from "../scripts/backfill-kbana.mjs";

const K55  = "P3036-10"; // P3-regeln → K55
const K61  = "P6036-10"; // station 36 utan P3-träff → K61-36
const K61B = "P7036-10"; // annan K61-36-plats
const K56  = "P4040-31";

const dev = (id, locations) => ({ id, datum: "2026-09-04", vnr: id, kbana: "K55", locations });
const scans = (...locs) => locs.map((location) => ({ location }));

describe("testdata stämmer med classifyLocation", () => {
  it("platserna klassas som förväntat", () => {
    expect(classifyLocation(K55)).toBe("K55");
    expect(classifyLocation(K61)).toBe("K61-36");
    expect(classifyLocation(K61B)).toBe("K61-36");
    expect(classifyLocation(K56)).toBe("K56");
  });
});

describe("isCandidate / needsScans", () => {
  it("kandidat bara om någon plats klassas K61-36", () => {
    expect(isCandidate(dev("a", [K61]))).toBe(true);
    expect(isCandidate(dev("b", [K55, K61]))).toBe(true);
    expect(isCandidate(dev("c", [K55]))).toBe(false);
    expect(isCandidate(dev("d", []))).toBe(false);
    expect(isCandidate({ id: "e", locations: null })).toBe(false);
  });

  it("scans behövs bara när platserna spänner över flera K-banor", () => {
    expect(needsScans(dev("a", [K61]))).toBe(false);
    expect(needsScans(dev("b", [K61, K61B]))).toBe(false);
    expect(needsScans(dev("c", [K55, K61]))).toBe(true);
  });
});

describe("recomputeKbana", () => {
  it("alla platser K61-36 → K61-36, utan scans", () => {
    expect(recomputeKbana(dev("a", [K61]))).toBe("K61-36");
    expect(recomputeKbana(dev("b", [K61, K61B]))).toBe("K61-36");
  });

  it("blandat: dominant plats (flest scans) avgör", () => {
    const d = dev("a", [K55, K61]);
    expect(recomputeKbana(d, scans(K61, K61, K55))).toBe("K61-36");
    expect(recomputeKbana(d, scans(K55, K55, K61))).toBe("K55");
  });

  it("blandat: jämnt lopp mellan olika K-banor går inte att avgöra", () => {
    expect(recomputeKbana(dev("a", [K55, K61]), scans(K55, K61))).toBeNull();
  });

  it("blandat: jämnt lopp mellan platser på SAMMA K-bana avgörs ändå", () => {
    // K61 och K61B har 2 var (båda K61-36), K55 har 1 → toppen är entydigt K61-36.
    expect(recomputeKbana(dev("a", [K55, K61, K61B]), scans(K61, K61, K61B, K61B, K55))).toBe("K61-36");
  });

  it("blandat utan scans går inte att avgöra", () => {
    expect(recomputeKbana(dev("a", [K55, K61]), [])).toBeNull();
    expect(recomputeKbana(dev("a", [K55, K61]))).toBeNull();
  });
});

describe("planDeviationFixes", () => {
  it("delar upp i fix / ambiguous och rör inte rader vars dominanta plats är K55", () => {
    const deviations = [
      dev("only61", [K61]),                 // → fix
      dev("only55", [K55]),                 // ingen K61-36-plats → inte kandidat
      dev("mixed-61", [K55, K61]),          // dominant K61-36 → fix
      dev("mixed-55", [K55, K61]),          // dominant K55 → oförändrad
      dev("mixed-noscans", [K55, K61]),     // → ambiguous
      dev("mixed-tie", [K55, K61]),         // → ambiguous
    ];
    const scansByDev = new Map([
      ["mixed-61", scans(K61, K61, K55)],
      ["mixed-55", scans(K55, K55, K61)],
      ["mixed-tie", scans(K55, K61)],
    ]);
    const { fix, ambiguous } = planDeviationFixes(deviations, scansByDev);
    expect(fix.map((d) => d.id)).toEqual(["only61", "mixed-61"]);
    expect(ambiguous.map((d) => d.id)).toEqual(["mixed-noscans", "mixed-tie"]);
  });
});

describe("planActionFixes", () => {
  it("väljer åtgärder vars plats klassas K61-36", () => {
    const actions = [
      { id: "1", location: K61 },
      { id: "2", location: K55 },
      { id: "3", location: null },
      { id: "4", location: K56 },
    ];
    expect(planActionFixes(actions).map((a) => a.id)).toEqual(["1"]);
  });
});
