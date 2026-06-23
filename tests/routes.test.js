// routes.test.js
import { describe, it, expect } from "vitest";
import { getAvgangstid, minutesBeforeDeparture, formatMinBefore } from "../src/lib/routes.js";

describe("getAvgangstid", () => {
  it("slår upp exakt tur i ROUTE_TIMES", () => {
    expect(getAvgangstid("101")).toEqual({ tid: "09:00", nastaDag: false });
    expect(getAvgangstid("802")).toEqual({ tid: "18:30", nastaDag: false });
  });

  it("använder ROUTE_RANGES för intervall", () => {
    expect(getAvgangstid("275")).toEqual({ tid: "18:00", nastaDag: false }); // 271-292
  });

  it("3/4/5/6-prefix faller tillbaka på 18:00", () => {
    expect(getAvgangstid("350")).toEqual({ tid: "18:00", nastaDag: false });
  });

  it("tom tur ger null", () => {
    expect(getAvgangstid("")).toEqual({ tid: null, nastaDag: false });
    expect(getAvgangstid(null)).toEqual({ tid: null, nastaDag: false });
  });
});

describe("minutesBeforeDeparture", () => {
  it("räknar minuter mellan tider", () => {
    expect(minutesBeforeDeparture("09:30", "10:00")).toBe(30);
    expect(minutesBeforeDeparture("09:00", "11:00")).toBe(120);
  });

  it("negativt om efter avgång", () => {
    expect(minutesBeforeDeparture("10:10", "10:00")).toBe(-10);
  });

  it("null vid saknad data", () => {
    expect(minutesBeforeDeparture("", "10:00")).toBe(null);
    expect(minutesBeforeDeparture("09:00", "")).toBe(null);
  });
});

describe("formatMinBefore", () => {
  it("formaterar minuter under en timme", () => {
    expect(formatMinBefore(25, false)).toBe("25 min före");
  });
  it("formaterar timmar och minuter", () => {
    expect(formatMinBefore(90, false)).toBe("1t 30m före");
    expect(formatMinBefore(120, false)).toBe("2 tim före");
  });
  it("markerar efter avgång", () => {
    expect(formatMinBefore(-10, false)).toBe("10 min EFTER avgång");
  });
  it("nästa dag har företräde", () => {
    expect(formatMinBefore(50, true)).toBe("nästa dag");
  });
  it("tom vid null", () => {
    expect(formatMinBefore(null, false)).toBe("");
  });
});
