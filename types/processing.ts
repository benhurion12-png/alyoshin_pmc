import type { OrbitGeoJson } from "./netcdf";

export type ProcessingSettings = {
  wavelengths: [number, number, number];
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
  signalMode: "relative-radiance";
  residual: number;
  threshold: number;
  signalToNoise: number;
  detectionScore: number;
  pixelCount: number;
  geometryApproximate: true;
};

export type PmcPointCollection = GeoJSON.FeatureCollection<GeoJSON.Point, PmcProperties>;
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
  clusters: PmcClusterCollection;
  metadata: Record<string, unknown>;
  warnings: string[];
};

export const DEFAULT_SETTINGS: ProcessingSettings = {
  wavelengths: [283, 287, 291.5],
  minLatitude: 50,
  maxLatitude: 90,
  minSza: 0,
  maxSza: 85,
  szaBinSize: 0.25,
  noiseMultiplier: 2.2,
  minimumClusterSize: 3,
  morphologicalClosing: true,
  morphologicalOpening: false,
  maxIterations: 5,
};
