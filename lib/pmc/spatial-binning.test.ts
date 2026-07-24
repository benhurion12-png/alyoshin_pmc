import { describe, expect, it } from "vitest";
import { spatialBin } from "./spatial-binning";

describe("spatialBin", () => {
  it("applies the TROPOMI 2×2/2×3 mapping from 77 to 33 cross-track rows", () => {
    const rows = 4, cols = 77, size = rows * cols;
    const latitude = new Float32Array(size);
    const longitude = new Float32Array(size);
    const sza = new Float32Array(size);
    const qualityMask = new Uint8Array(size);
    const signals = Array.from({ length: 5 }, () => new Float32Array(size)) as [
      Float32Array, Float32Array, Float32Array, Float32Array, Float32Array,
    ];
    qualityMask.fill(1);
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      latitude[index] = 60 + row;
      longitude[index] = col;
      sza[index] = 70;
      signals.forEach((signal) => { signal[index] = col; });
    }
    const result = spatialBin({ rows, cols, latitude, longitude, sza, signals, qualityMask });
    expect(result.rows).toBe(2);
    expect(result.cols).toBe(33);
    expect(result.signals[0][0]).toBeCloseTo(5.5);
    expect(result.signals[0][16]).toBeCloseTo(38);
    expect(result.signals[0][32]).toBeCloseTo(70.5);
  });
});
