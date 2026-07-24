import { buildOrbitFootprint } from "../geo/orbit-geojson";
import { adaptiveThreshold, iterativeBackground } from "./background";
import { connectedComponents, closing, opening } from "./morphology";
import { median } from "./statistics";
import type { PmcClusterCollection, PmcPointCollection, ProcessingResult, ProcessingSettings } from "../../types/processing";

export type PmcInput = {
  sourceFile: string;
  rows: number;
  cols: number;
  latitude: Float32Array;
  longitude: Float32Array;
  latitudeBounds?: Float32Array;
  longitudeBounds?: Float32Array;
  sza: Float32Array;
  signals: [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  qualityMask?: Uint8Array;
  settings: ProcessingSettings;
};

export function detectPmc(input: PmcInput): ProcessingResult {
  const { rows, cols, latitude, longitude, latitudeBounds, longitudeBounds, sza, signals, qualityMask, settings } = input;
  const valid = new Uint8Array(rows * cols), backgroundValid = new Uint8Array(rows * cols);
  for (let i = 0; i < valid.length; i++) {
    const crossTrack = i % cols;
    const instrumentValid = (!qualityMask || qualityMask[i] === 1) && crossTrack >= 5 && crossTrack <= cols - 6
      && Number.isFinite(signals[0][i]) && Number.isFinite(signals[1][i]) && Number.isFinite(signals[2][i])
      && Number.isFinite(latitude[i]) && Number.isFinite(longitude[i]) && Number.isFinite(sza[i])
      && latitude[i] <= settings.maxLatitude && sza[i] >= settings.minSza && sza[i] <= settings.maxSza;
    backgroundValid[i] = instrumentValid && latitude[i] >= 50 ? 1 : 0;
    valid[i] = instrumentValid && latitude[i] >= settings.minLatitude ? 1 : 0;
  }
  const residuals = signals.map((signal) => iterativeBackground(sza, signal, backgroundValid, rows, cols, settings.maxIterations).residual) as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  const threshold = adaptiveThreshold(residuals[0], sza, valid, settings.szaBinSize, settings.noiseMultiplier);
  let mask = new Uint8Array(valid.length);
  for (let i = 0; i < mask.length; i++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let w = 0; w < settings.wavelengths.length; w++) { const x = settings.wavelengths[w], y = residuals[w][i]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const slope = (settings.wavelengths.length * sxy - sx * sy) / (settings.wavelengths.length * sxx - sx * sx);
    if (valid[i] && residuals[0][i] > threshold[i] && residuals[0][i] > 0 && residuals[1][i] > 0 && residuals[2][i] > 0
      && residuals[0][i] > residuals[2][i] && slope < 0) mask[i] = 1;
  }
  if (settings.morphologicalClosing) mask = closing(mask, rows, cols);
  if (settings.morphologicalOpening) mask = opening(mask, rows, cols);
  const components = connectedComponents(mask, rows, cols).filter((c) => c.length >= settings.minimumClusterSize);
  const keep = new Uint8Array(mask.length);
  components.forEach((component) => component.forEach((i) => { keep[i] = 1; }));

  const pixelFeatures: PmcPointCollection["features"] = [];
  const clusterFeatures: PmcClusterCollection["features"] = [];
  const base = (i: number, count: number) => {
    const snr = residuals[0][i] / Math.max(threshold[i] / settings.noiseMultiplier, 1e-20);
    const score = Math.max(0, Math.min(1, 0.45 * Math.min(snr / 6, 1) + 0.35 * Math.min(count / 12, 1) + 0.2 * Math.min((residuals[0][i] - residuals[2][i]) / Math.max(residuals[0][i], 1e-20), 1)));
    return {
      sourceFile: input.sourceFile, wavelengthNm: settings.wavelengths[0], signalMode: "relative-radiance" as const,
      residual: residuals[0][i], threshold: threshold[i], signalToNoise: snr,
      detectionScore: score,
      pixelCount: count, geometryApproximate: !(latitudeBounds && longitudeBounds),
      qualityLevel: score >= .72 ? "high" as const : score >= .45 ? "medium" as const : "low" as const,
    };
  };
  for (const component of components) {
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90, sumLon = 0, sumLat = 0, maxResidual = -Infinity, meanResidual = 0, meanThreshold = 0, representative = component[0];
    const values = new Float32Array(component.length);
    component.forEach((i, j) => {
      const lon = longitude[i], lat = latitude[i]; minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      sumLon += lon; sumLat += lat; values[j] = residuals[0][i]; meanResidual += residuals[0][i]; meanThreshold += threshold[i];
      if (residuals[0][i] > maxResidual) { maxResidual = residuals[0][i]; representative = i; }
      const cornerOffset = i * 4;
      let ring: number[][];
      const cornersValid = latitudeBounds && longitudeBounds && latitudeBounds.length >= cornerOffset + 4 && longitudeBounds.length >= cornerOffset + 4
        && [0, 1, 2, 3].every((corner) => {
          const cornerLat = latitudeBounds[cornerOffset + corner], cornerLon = longitudeBounds[cornerOffset + corner];
          return Number.isFinite(cornerLat) && Number.isFinite(cornerLon) && Math.abs(cornerLat) <= 90 && Math.abs(cornerLon) <= 360;
        });
      if (cornersValid && latitudeBounds && longitudeBounds) {
        const firstLon = longitudeBounds[cornerOffset];
        ring = Array.from({ length: 4 }, (_, corner) => {
          let x = longitudeBounds[cornerOffset + corner];
          while (x - firstLon > 180) x -= 360;
          while (x - firstLon < -180) x += 360;
          return [x, latitudeBounds[cornerOffset + corner]];
        });
      } else {
        const dx = .03, dy = .015;
        ring = [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy]];
      }
      if (ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
        ring.push([...ring[0]]);
        pixelFeatures.push({ type: "Feature", properties: base(i, component.length), geometry: { type: "Polygon", coordinates: [ring] } });
      }
    });
    meanResidual /= component.length; meanThreshold /= component.length;
    const properties = {
      ...base(representative, component.length), clusterId: clusterFeatures.length + 1, meanResidual, medianResidual: median(values), maximumResidual: maxResidual,
      meanThreshold, centroid: [sumLon / component.length, sumLat / component.length] as [number, number],
      boundingBox: [minLon, minLat, maxLon, maxLat] as [number, number, number, number],
      approximateAreaKm2: component.length * 24,
    };
    clusterFeatures.push({
      type: "Feature", properties,
      geometry: { type: "Polygon", coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]] },
    });
  }
  return {
    orbit: buildOrbitFootprint(latitude, longitude, [rows, cols]),
    pixels: { type: "FeatureCollection", features: pixelFeatures },
    clusters: { type: "FeatureCollection", features: clusterFeatures },
    warnings: [
      "IR_UVN не загружен: используется экспериментальный residual radiance, а не residual albedo.",
      latitudeBounds && longitudeBounds ? "PMC отображаются по фактическим corner-координатам пикселей; площадь кластеров приблизительна." : "Corner-координаты отсутствуют: геометрия пикселей приблизительна.",
    ],
    metadata: { algorithmVersion: "0.2.0", sourceFile: input.sourceFile, articleMethod: "approximated", settings, selectedWavelengthsNm: settings.wavelengths, signalMode: "relative-radiance", processedAt: new Date().toISOString() },
  };
}
