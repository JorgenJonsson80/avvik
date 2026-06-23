// classify.test.js
// Tester för klassificeringslogiken. Detta är den riskigaste funktionen att råka ändra,
// så här låser vi fast beteendet. Kör med: npm test

import { describe, it, expect } from "vitest";
import { classifyLocation, getZon, stationToZon } from "../src/lib/classify.js";

describe("classifyLocation", () => {
  it("hanterar tomma/ogiltiga värden", () => {
    expect(classifyLocation(null)).toBe(null);
    expect(classifyLocation("")).toBe(null);
    expect(classifyLocation(123)).toBe(null);
    expect(classifyLocation("XYZ")).toBe(null);
  });

  it("känner igen PD och PH prefix", () => {
    expect(classifyLocation("PD12-34")).toBe("K62");
    expect(classifyLocation("PH99-01")).toBe("K63");
  });

  it("klassificerar P101 jämna platser till K51", () => {
    // sista siffran jämn => K51
    expect(classifyLocation("P10110-12")).toBe("K51");
  });

  it("klassificerar P4 jämna till K58, udda till K56", () => {
    expect(classifyLocation("P4040-30")).toBe("K58"); // jämn
    expect(classifyLocation("P4040-31")).toBe("K56"); // udda
  });

  it("station 36 ger K61-36 (när P3-regeln inte triggar först)", () => {
    // OBS: P3-prefix-regeln körs FÖRE station-36-regeln.
    // P3036-10 matchar P3-regeln (t7='3' är siffra) => K55, inte K61-36.
    expect(classifyLocation("P3036-10")).toBe("K55");
    // En station-36-plats som inte triggar P3-regeln hamnar på K61-36.
    expect(classifyLocation("P6036-10")).toBe("K61-36");
  });

  it("returnerar null för okänd plats", () => {
    expect(classifyLocation("P999-99")).toBe(null);
  });

  // Snapshot-skydd: om någon ändrar reglerna ska dessa fastställda värden ändras medvetet
  it("låser fast kända exempel", () => {
    const known = {
      "P4040-29": "K56", // udda
      "PD01-01": "K62",
    };
    for (const [loc, expected] of Object.entries(known)) {
      expect(classifyLocation(loc)).toBe(expected);
    }
  });
});

describe("getZon", () => {
  it("härleder zon från prefix", () => {
    expect(getZon("P101-23")).toBe("1");
    expect(getZon("P3036-10")).toBe("3");
    expect(getZon("PD12-01")).toBe("3");
    expect(getZon("P4040-29")).toBe("2");
    expect(getZon("P6060-10")).toBe("2");
    expect(getZon("P7070-10")).toBe("2");
  });

  it("returnerar ? för okänt och tomt", () => {
    expect(getZon("")).toBe("?");
    expect(getZon(null)).toBe("?");
    expect(getZon("Z999")).toBe("?");
  });
});

describe("stationToZon", () => {
  it("mappar stationsnummer till zon", () => {
    expect(stationToZon(36)).toBe("3");
    expect(stationToZon(50)).toBe("3");
    expect(stationToZon(15)).toBe("1");
    expect(stationToZon(45)).toBe("2");
  });

  it("returnerar ? för ogiltigt", () => {
    expect(stationToZon("abc")).toBe("?");
    expect(stationToZon(999)).toBe("?");
  });
});
