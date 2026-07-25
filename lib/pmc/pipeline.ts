import { buildOrbitFootprint } from "../geo/orbit-geojson";
import { adaptiveThreshold, articleThreshold, iterativeArticleBackground, iterativeBackground } from "./background";
import { ARTICLE_TROPOMI_NORMALIZATION_SR } from "./constants";
import { connectedComponents, closing, opening } from "./morphology";
import { median } from "./statistics";
import type { PmcClusterCollection, PmcPointCollection, ProcessingResult, ProcessingSettings, ResidualFieldCollection } from "../../types/processing";

export type PmcInput = {
  sourceFile: string;
  rows: number;
  cols: number;
  latitude: Float32Array;
  longitude: Float32Array;
  latitudeBounds?: Float32Array;
  longitudeBounds?: Float32Array;
  // Parallax-corrected ground position of the ~83 km PMC layer (see
  // lib/geo/parallax.ts). Used only for cloud footprint/cluster geometry;
  // the raw latitude/longitude above remain the ellipsoid-crossing position
  // used for the orbit swath outline and season/latitude gating.
  cloudLatitude?: Float32Array;
  cloudLongitude?: Float32Array;
  cloudLatitudeBounds?: Float32Array;
  cloudLongitudeBounds?: Float32Array;
  sza: Float32Array;
  viewingZenith?: Float32Array;
  solarAzimuth?: Float32Array;
  viewingAzimuth?: Float32Array;
  signals: [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  qualityMask?: Uint8Array;
  signalMode?: "relative-radiance" | "albedo";
  settings: ProcessingSettings;
};

// The northern-hemisphere analysis in Wu et al. is seasonal. Their off-season
// reference windows are days -40…-31 and +71…+80 relative to the summer
// solstice, implying an analysed PMC season of approximately -30…+70 days.
export function isNorthernPmcSeason(sourceFile: string) {
  const match = sourceFile.match(/_RA_BD1_(\d{4})(\d{2})(\d{2})T/);
  if (!match) return true;
  const year = Number(match[1]);
  const observation = Date.UTC(year, Number(match[2]) - 1, Number(match[3]));
  const solstice = Date.UTC(year, 5, 21);
  const dayFromSolstice = Math.round((observation - solstice) / 86_400_000);
  return dayFromSolstice >= -30 && dayFromSolstice <= 70;
}

export function detectPmc(input: PmcInput): ProcessingResult {
  const { rows, cols, latitude, longitude, latitudeBounds, longitudeBounds, sza, signals, qualityMask, settings } = input;
  const cloudLatitude = input.cloudLatitude ?? latitude;
  const cloudLongitude = input.cloudLongitude ?? longitude;
  const cloudLatitudeBounds = input.cloudLatitudeBounds ?? latitudeBounds;
  const cloudLongitudeBounds = input.cloudLongitudeBounds ?? longitudeBounds;
  const inSeason = isNorthernPmcSeason(input.sourceFile);
  const valid = new Uint8Array(rows * cols), backgroundValid = new Uint8Array(rows * cols);
  for (let i = 0; i < valid.length; i++) {
    const crossTrack = i % cols;
    const instrumentValid = (!qualityMask || qualityMask[i] === 1) && crossTrack >= 5 && crossTrack <= cols - 6
      && Number.isFinite(signals[0][i]) && Number.isFinite(signals[1][i]) && Number.isFinite(signals[2][i])
      && Number.isFinite(latitude[i]) && Number.isFinite(longitude[i]) && Number.isFinite(sza[i])
      && latitude[i] <= settings.maxLatitude && sza[i] >= settings.minSza && sza[i] <= settings.maxSza;
    backgroundValid[i] = instrumentValid && latitude[i] >= 50 ? 1 : 0;
    valid[i] = inSeason && instrumentValid && latitude[i] >= settings.minLatitude ? 1 : 0;
  }
  const residuals = input.signalMode === "albedo"
    ? iterativeArticleBackground(sza, signals, backgroundValid, rows, cols, settings.maxIterations, settings.wavelengths).residuals
    : signals.map((signal) => iterativeBackground(sza, signal, backgroundValid, rows, cols, settings.maxIterations).residual) as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  const threshold = input.signalMode === "albedo"
    ? articleThreshold(sza, valid, cols)
    : adaptiveThreshold(residuals[0], sza, valid, settings.szaBinSize, settings.noiseMultiplier);
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
  const allCandidateFeatures: PmcPointCollection["features"] = [];
  const fieldFeatures: ResidualFieldCollection["features"] = [];
  const clusterFeatures: PmcClusterCollection["features"] = [];
  const phaseAngles = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];
  const phase40nm = [5.35, 5.2, 4.75, 4.1, 3.35, 2.68, 2.1, 1.65, 1.28, 1, .84, .76, .72, .72, .73, .75, .77, .79, .8];
  const phaseAt = (angle: number) => {
    const bounded = Math.max(0, Math.min(180, angle));
    const lower = Math.min(phaseAngles.length - 2, Math.floor(bounded / 10));
    const fraction = (bounded - phaseAngles[lower]) / 10;
    return phase40nm[lower] * (1 - fraction) + phase40nm[lower + 1] * fraction;
  };
  const base = (i: number, count: number) => {
    const snr = residuals[0][i] / Math.max(threshold[i], 1e-20);
    const score = Math.max(0, Math.min(1, residuals[0][i] / ARTICLE_TROPOMI_NORMALIZATION_SR));
    let normalizedResidual = residuals[0][i];
    if (input.viewingZenith && input.solarAzimuth && input.viewingAzimuth) {
      const toRadians = Math.PI / 180;
      const solarZenith = sza[i] * toRadians;
      const viewingZenith = input.viewingZenith[i] * toRadians;
      const relativeAzimuth = (input.solarAzimuth[i] - input.viewingAzimuth[i]) * toRadians;
      const separation = Math.acos(Math.max(-1, Math.min(1,
        Math.cos(solarZenith) * Math.cos(viewingZenith)
        + Math.sin(solarZenith) * Math.sin(viewingZenith) * Math.cos(relativeAzimuth),
      )));
      const scatteringAngle = 180 - separation / toRadians;
      normalizedResidual = residuals[0][i] / phaseAt(scatteringAngle) * Math.cos(viewingZenith);
    }
    return {
      sourceFile: input.sourceFile, wavelengthNm: settings.wavelengths[0], signalMode: input.signalMode ?? "relative-radiance",
      residual: residuals[0][i], normalizedResidual, threshold: threshold[i], signalToNoise: snr,
      detectionScore: score,
      pixelCount: count, geometryApproximate: !(latitudeBounds && longitudeBounds),
      qualityLevel: residuals[0][i] >= 20e-6 ? "high" as const : residuals[0][i] >= 10e-6 ? "medium" as const : "low" as const,
    };
  };
  const ringFor = (i: number) => {
    const lon = cloudLongitude[i], lat = cloudLatitude[i], cornerOffset = i * 4;
    const cornersValid = cloudLatitudeBounds && cloudLongitudeBounds && cloudLatitudeBounds.length >= cornerOffset + 4 && cloudLongitudeBounds.length >= cornerOffset + 4
      && [0, 1, 2, 3].every((corner) => {
        const cornerLat = cloudLatitudeBounds[cornerOffset + corner], cornerLon = cloudLongitudeBounds[cornerOffset + corner];
        return Number.isFinite(cornerLat) && Number.isFinite(cornerLon) && Math.abs(cornerLat) <= 90 && Math.abs(cornerLon) <= 360;
      });
    let ring: number[][];
    if (cornersValid && cloudLatitudeBounds && cloudLongitudeBounds) {
      const firstLon = cloudLongitudeBounds[cornerOffset];
      ring = Array.from({ length: 4 }, (_, corner) => {
        let x = cloudLongitudeBounds[cornerOffset + corner];
        while (x - firstLon > 180) x -= 360;
        while (x - firstLon < -180) x += 360;
        return [x, cloudLatitudeBounds[cornerOffset + corner]];
      });
    } else {
      const dx = .03, dy = .015;
      ring = [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy]];
    }
    if (!ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return null;
    ring.push([...ring[0]]);
    return ring;
  };
  for (let i = 0; i < valid.length; i++) {
    if (!valid[i] || !Number.isFinite(residuals[0][i])) continue;
    const ring = ringFor(i);
    if (!ring) continue;
    fieldFeatures.push({
      type: "Feature",
      properties: { ...base(i, 1), detected: keep[i] === 1 },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
    if (mask[i]) allCandidateFeatures.push({ type: "Feature", properties: base(i, 1), geometry: { type: "Polygon", coordinates: [ring] } });
  }
  for (const component of components) {
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90, sumLon = 0, sumLat = 0, maxResidual = -Infinity, meanResidual = 0, meanThreshold = 0, representative = component[0];
    const values = new Float32Array(component.length);
    component.forEach((i, j) => {
      const lon = cloudLongitude[i], lat = cloudLatitude[i]; minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      sumLon += lon; sumLat += lat; values[j] = residuals[0][i]; meanResidual += residuals[0][i]; meanThreshold += threshold[i];
      if (residuals[0][i] > maxResidual) { maxResidual = residuals[0][i]; representative = i; }
      const ring = ringFor(i);
      if (ring) {
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
    field: { type: "FeatureCollection", features: fieldFeatures },
    pixels: { type: "FeatureCollection", features: pixelFeatures },
    allCandidates: { type: "FeatureCollection", features: allCandidateFeatures },
    clusters: { type: "FeatureCollection", features: clusterFeatures },
    warnings: [
      !inSeason
        ? "Дата находится вне северного PMC-сезона статьи (примерно 22 мая — 30 августа): PMC-маска намеренно пуста, фон не обозначается как облака."
        : "Дата находится внутри северного PMC-сезона статьи.",
      input.signalMode === "albedo"
        ? "Использован IR_UVN и оцифрованные row-group пороги Figure 5 статьи Wu et al. (2026)."
        : "IR_UVN не загружен: используется экспериментальный residual radiance, а не residual albedo.",
      input.viewingZenith && input.solarAzimuth && input.viewingAzimuth
        ? "Residual albedo нормализовано к надиру по Equation (3) и фазовой функции частиц 40 нм из Figure 6."
        : "Углы наблюдения не найдены: радиометрическая нормализация Equation (3) не применена.",
      latitudeBounds && longitudeBounds ? "PMC отображаются по фактическим corner-координатам пикселей; площадь кластеров приблизительна." : "Corner-координаты отсутствуют: геометрия пикселей приблизительна.",
      input.cloudLatitude && input.cloudLatitude !== latitude
        ? "Геолокация PMC скорректирована на параллакс для высоты облака 83 км: то же облако, увиденное перекрывающимися орбитами, сходится в одну область при объединении площади."
        : "Углы наблюдения не найдены: параллактическая поправка не применена, геолокация PMC берётся на эллипсоиде (h = 0), что может завышать площадь при слиянии перекрывающихся орбит.",
    ],
    metadata: { algorithmVersion: "0.5.3", sourceFile: input.sourceFile, inNorthernPmcSeason: inSeason, articleMethod: input.signalMode === "albedo" ? "digitized-final-2.2-times-threshold-curve" : "approximated", settings, selectedWavelengthsNm: settings.wavelengths, signalMode: input.signalMode ?? "relative-radiance", processedAt: new Date().toISOString() },
  };
}
