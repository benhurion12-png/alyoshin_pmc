/// <reference lib="webworker" />
import h5wasm, { Dataset } from "h5wasm";

const scope = self as DedicatedWorkerGlobalScope;
const TARGET_METERS = 83_000;
const TAI93_UNIX_MS = Date.UTC(1993, 0, 1);

type Request = { temperatureFile: File; gphFile: File };
type Sample = {
  latitude: number;
  longitude: number;
  temperature: number;
  altitudeKm: number;
  pressureHpa: number;
  precisionK: number;
  timeUtc: string;
};

const typed = (dataset: Dataset) => {
  const value = dataset.value;
  if (!value || typeof value === "string" || !ArrayBuffer.isView(value)) throw new Error(`Не удалось прочитать ${dataset.path}.`);
  return value as unknown as ArrayLike<number>;
};

scope.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    const { FS } = await h5wasm.ready;
    try { FS.mkdir("/mls"); } catch { /* exists */ }
    try { FS.unmount("/mls"); } catch { /* not mounted */ }
    FS.mount(FS.filesystems.WORKERFS, { files: [data.temperatureFile, data.gphFile] }, "/mls");
    const temperatureFile = new h5wasm.File(`/mls/${data.temperatureFile.name}`, "r");
    const gphFile = new h5wasm.File(`/mls/${data.gphFile.name}`, "r");
    const get = (file: InstanceType<typeof h5wasm.File>, path: string) => {
      const value = file.get(path);
      if (!(value instanceof Dataset)) throw new Error(`В Aura MLS отсутствует ${path}.`);
      return value;
    };
    const tRoot = "/HDFEOS/SWATHS/Temperature";
    const gRoot = "/HDFEOS/SWATHS/GPH";
    const temperatures = typed(get(temperatureFile, `${tRoot}/Data Fields/L2gpValue`));
    const precisions = typed(get(temperatureFile, `${tRoot}/Data Fields/L2gpPrecision`));
    const statuses = typed(get(temperatureFile, `${tRoot}/Data Fields/Status`));
    const qualities = typed(get(temperatureFile, `${tRoot}/Data Fields/Quality`));
    const convergence = typed(get(temperatureFile, `${tRoot}/Data Fields/Convergence`));
    const latitudes = typed(get(temperatureFile, `${tRoot}/Geolocation Fields/Latitude`));
    const longitudes = typed(get(temperatureFile, `${tRoot}/Geolocation Fields/Longitude`));
    const times = typed(get(temperatureFile, `${tRoot}/Geolocation Fields/Time`));
    const tPressures = typed(get(temperatureFile, `${tRoot}/Geolocation Fields/Pressure`));
    const heights = typed(get(gphFile, `${gRoot}/Data Fields/L2gpValue`));
    const gPressures = typed(get(gphFile, `${gRoot}/Geolocation Fields/Pressure`));
    const gStatuses = typed(get(gphFile, `${gRoot}/Data Fields/Status`));
    const profiles = latitudes.length;
    const tLevels = tPressures.length;
    const gLevels = gPressures.length;
    const samples: Sample[] = [];

    for (let profile = 0; profile < profiles; profile++) {
      // MLS standard screening: reject profiles with the two least-significant
      // Status bits set, bad convergence, or non-positive retrieval quality.
      if ((Number(statuses[profile]) & 3) !== 0 || (Number(gStatuses[profile]) & 3) !== 0) continue;
      if (Number(qualities[profile]) <= 0 || Number(convergence[profile]) >= 2) continue;
      let level = -1;
      let distance = Infinity;
      for (let i = 0; i < gLevels; i++) {
        const height = Number(heights[profile * gLevels + i]);
        const next = Math.abs(height - TARGET_METERS);
        if (Number.isFinite(height) && Math.abs(height) < 1e10 && next < distance) { distance = next; level = i; }
      }
      if (level < 0 || distance > 5_000) continue;
      const pressure = Number(gPressures[level]);
      let tLevel = 0;
      for (let i = 1; i < tLevels; i++) {
        if (Math.abs(Math.log(Number(tPressures[i]) / pressure)) < Math.abs(Math.log(Number(tPressures[tLevel]) / pressure))) tLevel = i;
      }
      const temperature = Number(temperatures[profile * tLevels + tLevel]);
      const precisionK = Number(precisions[profile * tLevels + tLevel]);
      const altitudeKm = Number(heights[profile * gLevels + level]) / 1000;
      const latitude = Number(latitudes[profile]);
      let longitude = Number(longitudes[profile]);
      if (longitude > 180) longitude -= 360;
      if (![temperature, precisionK, altitudeKm, latitude, longitude].every(Number.isFinite)) continue;
      if (temperature < 80 || temperature > 400 || precisionK <= 0 || precisionK > 100) continue;
      samples.push({
        latitude, longitude, temperature, altitudeKm, pressureHpa: pressure, precisionK,
        timeUtc: new Date(TAI93_UNIX_MS + Number(times[profile]) * 1000).toISOString(),
      });
    }
    temperatureFile.close();
    gphFile.close();
    scope.postMessage({ type: "complete", samples });
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

export {};
