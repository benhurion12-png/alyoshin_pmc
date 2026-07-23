import { describe, expect, it } from "vitest";
import { mad, mean, median, percentile, robustSigma } from "./statistics";

describe("robust statistics", () => {
  const values = new Float32Array([1, 2, 3, 4, 100]);
  it("computes mean and order statistics", () => {
    expect(mean(values)).toBe(22);
    expect(median(values)).toBe(3);
    expect(percentile(values, .75)).toBe(4);
  });
  it("computes MAD and robust sigma", () => {
    expect(mad(values)).toBe(1);
    expect(robustSigma(values)).toBeCloseTo(1.4826);
  });
});
