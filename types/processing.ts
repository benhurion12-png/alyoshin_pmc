import type { OrbitGeoJson } from "./netcdf";

export type ProcessingSettings = {
  wavelengths: [number, number, number, number, number];
  minLatitude: number;
  maxLatitude: number;
  minSza: number;
  maxSza: number;
  szaBinSize: number;
  noiseMultiplier: number;
  minimumClusterSize: number;
  morphologicalClosing: boolean;
  morphologicalOpening: boolean;
  maxIterations: number;
};

export type PmcProperties = {
  sourceFile: string;
  wavelengthNm: number;
  signalMode: "relative-radiance" | "albedo";
  residual: number;
  normalizedResidual: number;
  threshold: number;
  signalToNoise: number;
  detectionScore: number;
  pixelCount: number;
  geometryApproximate: boolean;
  qualityLevel: "low" | "medium" | "high";
};

export type PmcPointCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, PmcProperties>;
export type ResidualFieldCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, PmcProperties & { detected: boolean }>;
export type PmcClusterCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, PmcProperties & {
  clusterId: number;
  meanResidual: number;
  medianResidual: number;
  maximumResidual: number;
  meanThreshold: number;
  centroid: [number, number];
  boundingBox: [number, number, number, number];
  approximateAreaKm2: number;
}>;

export type ProcessingResult = {
  orbit: OrbitGeoJson;
  pixels: PmcPointCollection;
  // Every pixel that individually passed the spectral+threshold test, before
  // the minimumClusterSize connected-component filter. A genuine upper bound
  // on `pixels` — used to show how much area the cluster-size filter removes,
  // distinct from `pixels` itself (do not use this for the headline area).
  allCandidates: PmcPointCollection;
  field: ResidualFieldCollection;
  clusters: PmcClusterCollection;
  metadata: Record<string, unknown>;
  warnings: string[];
};

export const DEFAULT_SETTINGS: ProcessingSettings = {
  wavelengths: [283, 287, 291.5, 295, 298],
  minLatitude: 50,
  maxLatitude: 90,
  minSza: 0,
  maxSza: 85,
  szaBinSize: 0.25,
  noiseMultiplier: 2.2,
  minimumClusterSize: 3,
  // Closing (dilate -> erode) fills small gaps between nearby threshold
  // crossings; measured against real orbits it increases total footprint
  // area by ~25-30% (it adds pixels that never crossed the threshold), which
  // dominates the ~15% reduction minimumClusterSize alone provides. Left off
  // by default so the headline area reflects actual threshold crossings; it
  // remains available as a user toggle for anyone who wants visually solid,
  // hole-free clusters.
  morphologicalClosing: false,
  morphologicalOpening: false,
  maxIterations: 5,
};
