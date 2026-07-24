import { describe, expect, it } from "vitest";
import { multiPolygonAreaKm2, unionPmcFootprints } from "./pmc-area";
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
});
