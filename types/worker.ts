import type { InspectionResult, OrbitGeoJson } from "./netcdf";
import type { ProcessingResult, ProcessingSettings } from "./processing";

export type WorkerRequest =
  | { type: "INSPECT"; file: File }
  | { type: "EXTRACT_ORBIT"; file: File; latitudePath: string; longitudePath: string }
  | { type: "PROCESS"; radianceFile: File; irradianceFile?: File; settings: ProcessingSettings }
  | { type: "CANCEL" };

export type WorkerResponse =
  | { type: "PROGRESS"; stage: string; percent: number; bytesRead: number }
  | { type: "INSPECTION_COMPLETE"; result: InspectionResult }
  | { type: "ORBIT_COMPLETE"; orbit: OrbitGeoJson }
  | { type: "PROCESSING_COMPLETE"; result: ProcessingResult }
  | { type: "CANCELLED" }
  | { type: "ERROR"; message: string; details?: string };
