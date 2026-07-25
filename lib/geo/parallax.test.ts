import { describe, expect, it } from "vitest";
import { parallaxCorrectGeolocation, parallaxCorrectedPoint } from "./parallax";

describe("parallaxCorrectedPoint", () => {
  it("leaves nadir-viewed pixels unchanged", () => {
    const [lon, lat] = parallaxCorrectedPoint(75, 10, 0, 0, 83);
    expect(lat).toBeCloseTo(75, 6);
    expect(lon).toBeCloseTo(10, 6);
  });

  it("shifts a swath-edge pixel toward the satellite by roughly height * tan(VZA)", () => {
    const [, lat] = parallaxCorrectedPoint(75, 0, 50, 0, 83);
    const expectedKm = 83 * Math.tan(50 * Math.PI / 180);
    const shiftedKm = (lat - 75) * 111.32;
    expect(shiftedKm).toBeCloseTo(expectedKm, 0);
  });

  it("passes through non-finite viewing angles unchanged", () => {
    const [lon, lat] = parallaxCorrectedPoint(75, 10, Number.NaN, 0, 83);
    expect(lat).toBe(75);
    expect(lon).toBe(10);
  });
});

describe("parallaxCorrectGeolocation", () => {
  it("returns the original arrays when viewing angles are unavailable", () => {
    const latitude = new Float32Array([75, 76]);
    const longitude = new Float32Array([10, 11]);
    const result = parallaxCorrectGeolocation({ latitude, longitude });
    expect(result.latitude).toBe(latitude);
    expect(result.longitude).toBe(longitude);
  });

  it("corrects the same physical cloud seen from two orbits back to nearly the same point", () => {
    // A single true cloud point, viewed by two orbits with different viewing
    // geometry. Raw L1B geolocation reports the ellipsoid crossing, which lies
    // on the opposite side of the true point from the satellite, so it is the
    // destination point at bearing (azimuth + 180).
    const trueLat = 75, trueLon = 20;
    const geometryA: [number, number] = [55, 90], geometryB: [number, number] = [50, 200];
    const cos = Math.cos(trueLat * Math.PI / 180);
    const rawA = parallaxCorrectedPoint(trueLat, trueLon, geometryA[0], geometryA[1] + 180, 83);
    const rawB = parallaxCorrectedPoint(trueLat, trueLon, geometryB[0], geometryB[1] + 180, 83);
    const rawSeparationKm = Math.hypot(rawA[1] - rawB[1], (rawA[0] - rawB[0]) * cos) * 111.32;
    const correctedA = parallaxCorrectedPoint(rawA[1], rawA[0], geometryA[0], geometryA[1], 83);
    const correctedB = parallaxCorrectedPoint(rawB[1], rawB[0], geometryB[0], geometryB[1], 83);
    const correctedSeparationKm = Math.hypot(correctedA[1] - correctedB[1], (correctedA[0] - correctedB[0]) * cos) * 111.32;
    expect(correctedSeparationKm).toBeLessThan(rawSeparationKm);
    expect(correctedSeparationKm).toBeLessThan(15);
  });

  it("corrects bounds corners using each pixel's own viewing geometry", () => {
    const latitude = new Float32Array([75]);
    const longitude = new Float32Array([10]);
    const viewingZenith = new Float32Array([40]);
    const viewingAzimuth = new Float32Array([0]);
    const latitudeBounds = new Float32Array([74.95, 74.95, 75.05, 75.05]);
    const longitudeBounds = new Float32Array([9.95, 10.05, 10.05, 9.95]);
    const result = parallaxCorrectGeolocation({
      latitude, longitude, latitudeBounds, longitudeBounds, viewingZenith, viewingAzimuth,
    });
    expect(result.latitudeBounds).not.toEqual(latitudeBounds);
    expect(result.latitudeBounds![0]).toBeGreaterThan(latitudeBounds[0]);
  });
});
