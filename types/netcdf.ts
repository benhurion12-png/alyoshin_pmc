export type DatasetNode = {
  name: string;
  path: string;
  kind: "group" | "dataset";
  shape?: number[];
  dtype?: string;
  attributes?: Record<string, unknown>;
  children?: DatasetNode[];
};

export type Candidate = {
  semanticType: "latitude" | "longitude" | "radiance" | "wavelength";
  path: string;
  score: number;
  reasons: string[];
  shape: number[];
};

export type InspectionResult = {
  tree: DatasetNode;
  candidates: Candidate[];
  reader: string;
  durationMs: number;
};

export type OrbitGeoJson = GeoJSON.FeatureCollection<GeoJSON.Polygon>;
