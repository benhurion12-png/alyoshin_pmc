import type { InspectionResult, OrbitGeoJson } from "./netcdf";

export type WorkerRequest =
  | { type: "INSPECT"; file: File }
  | { type: "EXTRACT_ORBIT"; file: File; latitudePath: string; longitudePath: string }
  | { type: "CANCEL" };

export type WorkerResponse =
  | { type: "PROGRESS"; stage: string; percent: number; bytesRead: number }
  | { type: "INSPECTION_COMPLETE"; result: InspectionResult }
  | { type: "ORBIT_COMPLETE"; orbit: OrbitGeoJson }
  | { type: "CANCELLED" }
  | { type: "ERROR"; message: string; details?: string };
