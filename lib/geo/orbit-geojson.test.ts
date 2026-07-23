import { describe, expect, it } from "vitest";
import { buildOrbitFootprint } from "./orbit-geojson";

describe("buildOrbitFootprint", () => {
  it("uses longitude, latitude order and closes the polygon", () => {
    const result = buildOrbitFootprint(
      new Float32Array([70, 70, 71, 71]),
      new Float32Array([10, 11, 10, 11]),
      [2, 2],
    );
    const ring = result.features[0].geometry.coordinates[0];
    expect(ring[0]).toEqual([10, 70]);
    expect(ring.at(-1)).toEqual(ring[0]);
  });

  it("normalizes longitude", () => {
    const result = buildOrbitFootprint(
      new Float32Array([70, 70, 71, 71]),
      new Float32Array([190, 191, 190, 191]),
      [2, 2],
    );
    expect(result.features[0].geometry.coordinates[0][0][0]).toBe(-170);
  });
});
