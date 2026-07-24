import { describe, expect, it } from "vitest";
import { articleThreshold } from "./background";
import { isNorthernPmcSeason } from "./pipeline";

describe("articleThreshold", () => {
  it("uses the three digitized Figure 5 row-group curves", () => {
    const sza = new Float32Array(33).fill(60);
    const valid = new Uint8Array(33).fill(1);
    const threshold = articleThreshold(sza, valid, 33);
    expect(threshold[0]).toBeCloseTo(7.22e-6, 8);
    expect(threshold[8]).toBeCloseTo(5.615e-6, 8);
    expect(threshold[25]).toBeCloseTo(5.601e-6, 8);
  });
});

describe("northern PMC season", () => {
  it("accepts the article summer interval and rejects March controls", () => {
    expect(isNorthernPmcSeason("S5P_OFFL_L1B_RA_BD1_20260723T011010_x.nc")).toBe(true);
    expect(isNorthernPmcSeason("S5P_OFFL_L1B_RA_BD1_20260326T100010_x.nc")).toBe(false);
  });
});
