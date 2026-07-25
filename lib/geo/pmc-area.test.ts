import { describe, expect, it } from "vitest";
import { featureFootprintAreaKm2, multiPolygonAreaKm2, unionPmcFootprints } from "./pmc-area";
import type { PmcPointCollection, PmcProperties } from "@/types/processing";

const properties: PmcProperties = {
  sourceFile: "test.nc", wavelengthNm: 283, signalMode: "albedo",
  residual: 10e-6, normalizedResidual: 10e-6, threshold: 5e-6,
  signalToNoise: 2, detectionScore: 1 / 3, pixelCount: 1,
  geometryApproximate: false, qualityLevel: "medium",
};

const feature = (coordinates: number[][]): PmcPointCollection["features"][number] => ({
  type: "Feature",
  properties,
  geometry: { type: "Polygon", coordinates: [coordinates] },
});

describe("PMC footprint area", () => {
  it("does not count identical overlapping pixels twice", () => {
    const pixel = feature([[0, 79.95], [0.52, 79.95], [0.52, 80.05], [0, 80.05], [0, 79.95]]);
    const once = unionPmcFootprints(null, [pixel]);
    const twice = unionPmcFootprints(once, [pixel]);
    expect(multiPolygonAreaKm2(once)).toBeGreaterThan(100);
    expect(multiPolygonAreaKm2(twice)).toBeCloseTo(multiPolygonAreaKm2(once), 6);
  });

  it("does not crash on degenerate and nearly coincident footprint rings", () => {
    const valid = feature([[0, 80], [0.5, 80], [0.5, 80.1], [0, 80.1], [0, 80]]);
    const degenerate = feature([[0, 80], [0, 80], [Number.NaN, 80], [0, 80]]);
    const shifted = feature([[0.000001, 80], [0.500001, 80], [0.500001, 80.1], [0.000001, 80.1], [0.000001, 80]]);
    expect(() => unionPmcFootprints(null, [valid, degenerate, shifted])).not.toThrow();
    const merged = unionPmcFootprints(null, [valid, shifted]);
    expect(multiPolygonAreaKm2(merged)).toBeGreaterThan(100);
  });
});

describe("featureFootprintAreaKm2", () => {
  it("matches the union area for a single isolated feature", () => {
    const pixel = feature([[0, 79.95], [0.52, 79.95], [0.52, 80.05], [0, 80.05], [0, 79.95]]);
    const union = unionPmcFootprints(null, [pixel]);
    expect(featureFootprintAreaKm2(pixel)).toBeCloseTo(multiPolygonAreaKm2(union), 2);
  });

  it("sums independently for overlapping features instead of deduplicating", () => {
    const a = feature([[0, 79.95], [0.52, 79.95], [0.52, 80.05], [0, 80.05], [0, 79.95]]);
    const b = feature([[0, 79.95], [0.52, 79.95], [0.52, 80.05], [0, 80.05], [0, 79.95]]);
    const sum = featureFootprintAreaKm2(a) + featureFootprintAreaKm2(b);
    expect(sum).toBeCloseTo(2 * featureFootprintAreaKm2(a), 6);
  });
});
