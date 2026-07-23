/// <reference lib="webworker" />
import h5wasm, { Dataset, Group } from "h5wasm";
import { buildOrbitFootprint } from "@/lib/geo/orbit-geojson";
import { discoverVariables } from "@/lib/netcdf/variable-discovery";
import { detectPmc } from "@/lib/pmc/pipeline";
import type { DatasetNode } from "@/types/netcdf";
import type { WorkerRequest, WorkerResponse } from "@/types/worker";

const scope = self as DedicatedWorkerGlobalScope;
let cancelled = false;
let mounted = false;

const send = (message: WorkerResponse) => scope.postMessage(message);
const safe = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>).slice(0, 16);
  if (Array.isArray(value)) return value.slice(0, 16).map(safe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safe(v)]));
  return value;
};

async function open(file: File) {
  const { FS } = await h5wasm.ready;
  if (mounted) {
    try { FS.unmount("/work"); } catch { /* already unmounted */ }
  } else {
    FS.mkdir("/work");
    mounted = true;
  }
  FS.mount(FS.filesystems.WORKERFS, { files: [file] }, "/work");
  return new h5wasm.File(`/work/${file.name}`, "r");
}

function inspectGroup(group: Group, name: string, path: string): DatasetNode {
  if (cancelled) throw new DOMException("Cancelled", "AbortError");
  const children: DatasetNode[] = [];
  for (const childName of group.keys()) {
    const entity = group.get(childName);
    if (!entity) continue;
    const childPath = path === "/" ? `/${childName}` : `${path}/${childName}`;
    if (entity instanceof Group) children.push(inspectGroup(entity, childName, childPath));
    else if (entity instanceof Dataset) {
      children.push({
        name: childName,
        path: childPath,
        kind: "dataset",
        shape: entity.shape ?? [],
        dtype: String(entity.dtype),
        attributes: safe(entity.attrs) as Record<string, unknown>,
      });
    }
  }
  return { name, path, kind: "group", attributes: safe(group.attrs) as Record<string, unknown>, children };
}

function findDataset(group: Group, predicate: (name: string, path: string) => boolean): Dataset | null {
  for (const name of group.keys()) {
    const entity = group.get(name);
    if (entity instanceof Group) { const found = findDataset(entity, predicate); if (found) return found; }
    else if (entity instanceof Dataset && predicate(name.toLowerCase(), entity.path.toLowerCase())) return entity;
  }
  return null;
}

const asFloat32 = (value: unknown) => {
  if (!value || typeof value === "string" || !ArrayBuffer.isView(value)) throw new Error("Ожидался числовой TypedArray.");
  return value instanceof Float32Array ? value : Float32Array.from(value as unknown as ArrayLike<number>);
};

async function processPmc(fileObject: File, settings: import("@/types/processing").ProcessingSettings) {
  const file = await open(fileObject);
  const radiance = findDataset(file, (name) => name === "radiance");
  const wavelength = findDataset(file, (name) => name === "nominal_wavelength" || name === "wavelength");
  const latitude = findDataset(file, (name, path) => name === "latitude" && !path.includes("bounds"));
  const longitude = findDataset(file, (name, path) => name === "longitude" && !path.includes("bounds"));
  const sza = findDataset(file, (name) => name === "solar_zenith_angle");
  if (!radiance || !wavelength || !latitude || !longitude || !sza) throw new Error("Не найдены radiance, nominal_wavelength, latitude, longitude или solar_zenith_angle.");
  const shape = radiance.shape ?? [];
  const rows = shape.at(-3) ?? 0, cols = shape.at(-2) ?? 0, bands = shape.at(-1) ?? 0;
  if (!rows || !cols || !bands) throw new Error("Неожиданная форма radiance.");
  send({ type: "PROGRESS", stage: "Выбор спектральных каналов", percent: 8, bytesRead: 0 });
  const wavelengths = asFloat32(wavelength.value);
  const indices = settings.wavelengths.map((target) => {
    const perColumn = new Uint16Array(cols);
    for (let col = 0; col < cols; col++) {
      let best = 0, distance = Infinity;
      for (let band = 0; band < bands; band++) { const d = Math.abs(wavelengths[col * bands + band] - target); if (d < distance) { distance = d; best = band; } }
      perColumn[col] = best;
    }
    return perColumn;
  });
  const minBand = Math.min(...indices.flatMap((a) => Array.from(a)));
  const maxBand = Math.max(...indices.flatMap((a) => Array.from(a)));
  const signals = [new Float32Array(rows * cols), new Float32Array(rows * cols), new Float32Array(rows * cols)] as [Float32Array, Float32Array, Float32Array];
  const chunkRows = 12;
  for (let start = 0; start < rows; start += chunkRows) {
    if (cancelled) throw new DOMException("Cancelled", "AbortError");
    const count = Math.min(chunkRows, rows - start), width = maxBand - minBand + 1;
    const chunk = asFloat32(radiance.slice([[0, 1], [start, start + count], [], [minBand, maxBand + 1]]));
    for (let r = 0; r < count; r++) for (let col = 0; col < cols; col++) for (let w = 0; w < 3; w++) {
      const raw = chunk[(r * cols + col) * width + indices[w][col] - minBand];
      signals[w][(start + r) * cols + col] = Math.abs(raw) < 1e30 ? raw : NaN;
    }
    send({ type: "PROGRESS", stage: `Чтение radiance · scanline ${start + count}/${rows}`, percent: 10 + Math.round(48 * (start + count) / rows), bytesRead: (start + count) * cols * width * 4 });
  }
  send({ type: "PROGRESS", stage: "Чтение геолокации и SZA", percent: 62, bytesRead: 0 });
  const lat = asFloat32(latitude.value), lon = asFloat32(longitude.value), solarZenith = asFloat32(sza.value);
  send({ type: "PROGRESS", stage: "Итеративная фоновая модель", percent: 72, bytesRead: 0 });
  const result = detectPmc({ sourceFile: fileObject.name, rows, cols, latitude: lat, longitude: lon, sza: solarZenith, signals, settings });
  file.close();
  return result;
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "CANCEL") { cancelled = true; return; }
  cancelled = false;
  const started = performance.now();
  try {
    send({ type: "PROGRESS", stage: "Инициализация HDF5/WebAssembly", percent: 8, bytesRead: 0 });
    if (event.data.type === "INSPECT") {
      const file = await open(event.data.file);
      send({ type: "PROGRESS", stage: "Обход групп и наборов данных", percent: 35, bytesRead: 0 });
      const tree = inspectGroup(file, "/", "/");
      if (cancelled) throw new DOMException("Cancelled", "AbortError");
      const candidates = discoverVariables(tree);
      file.close();
      send({ type: "INSPECTION_COMPLETE", result: { tree, candidates, reader: "h5wasm / HDF5 WORKERFS", durationMs: performance.now() - started } });
    } else if (event.data.type === "EXTRACT_ORBIT") {
      const file = await open(event.data.file);
      const lat = file.get(event.data.latitudePath);
      const lon = file.get(event.data.longitudePath);
      if (!(lat instanceof Dataset) || !(lon instanceof Dataset)) throw new Error("Выбранные пути координат не являются datasets.");
      send({ type: "PROGRESS", stage: "Чтение координат орбиты", percent: 55, bytesRead: 0 });
      const latValues = lat.value;
      const lonValues = lon.value;
      if (!latValues || !lonValues || typeof latValues === "string" || typeof lonValues === "string") throw new Error("Не удалось прочитать числовые координаты.");
      const orbit = buildOrbitFootprint(latValues as ArrayLike<number>, lonValues as ArrayLike<number>, lat.shape ?? []);
      file.close();
      send({ type: "ORBIT_COMPLETE", orbit });
    } else if (event.data.type === "PROCESS") {
      const result = await processPmc(event.data.radianceFile, event.data.settings);
      send({ type: "PROGRESS", stage: "GeoJSON и статистика кластеров", percent: 96, bytesRead: 0 });
      send({ type: "PROCESSING_COMPLETE", result });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") send({ type: "CANCELLED" });
    else send({ type: "ERROR", message: "Не удалось обработать NetCDF4/HDF5.", details: error instanceof Error ? error.message : String(error) });
  }
};

export {};
