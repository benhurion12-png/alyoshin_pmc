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

  it("uses real exterior corners instead of a latitude/longitude bounding box", () => {
    const rows = 2, cols = 2, size = rows * cols;
    const latitude = new Float32Array([80, 80.05, 80.05, 80.1]);
    const longitude = new Float32Array([0, 0.4, 0.1, 0.5]);
    const sza = new Float32Array(size).fill(60);
    const qualityMask = new Uint8Array(size).fill(1);
    const signals = Array.from({ length: 5 }, () => new Float32Array(size).fill(1)) as [
      Float32Array, Float32Array, Float32Array, Float32Array, Float32Array,
    ];
    const latitudeBounds = new Float32Array(size * 4);
    const longitudeBounds = new Float32Array(size * 4);
    const nativeCorners = [
      [[-0.1, 79.98], [0.1, 79.98], [0.1, 80.02], [-0.1, 80.02]],
      [[0.3, 80.03], [0.5, 80.03], [0.5, 80.07], [0.3, 80.07]],
      [[0, 80.03], [0.2, 80.03], [0.2, 80.07], [0, 80.07]],
      [[0.4, 80.08], [0.6, 80.08], [0.6, 80.12], [0.4, 80.12]],
    ];
    nativeCorners.forEach((corners, pixel) => corners.forEach(([lon, lat], corner) => {
      longitudeBounds[pixel * 4 + corner] = lon;
      latitudeBounds[pixel * 4 + corner] = lat;
    }));
    const result = spatialBin({
      rows, cols, latitude, longitude, latitudeBounds, longitudeBounds, sza, signals, qualityMask,
    });
    const corners = Array.from({ length: 4 }, (_, corner) => [
      result.longitudeBounds![corner], result.latitudeBounds![corner],
    ]);
    expect(corners).toContainEqual([expect.closeTo(-0.1, 4), expect.closeTo(79.98, 4)]);
    expect(corners).toContainEqual([expect.closeTo(0.6, 4), expect.closeTo(80.12, 4)]);
    expect(corners).not.toContainEqual([expect.closeTo(-0.1, 4), expect.closeTo(80.12, 4)]);
  });
});
