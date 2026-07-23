/// <reference lib="webworker" />
import h5wasm, { Dataset, Group } from "h5wasm";
import { buildOrbitFootprint } from "@/lib/geo/orbit-geojson";
import { discoverVariables } from "@/lib/netcdf/variable-discovery";
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

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "CANCEL") { cancelled = true; return; }
  cancelled = false;
  const started = performance.now();
  try {
    send({ type: "PROGRESS", stage: "Инициализация HDF5/WebAssembly", percent: 8, bytesRead: 0 });
    const file = await open(event.data.file);
    if (event.data.type === "INSPECT") {
      send({ type: "PROGRESS", stage: "Обход групп и наборов данных", percent: 35, bytesRead: 0 });
      const tree = inspectGroup(file, "/", "/");
      if (cancelled) throw new DOMException("Cancelled", "AbortError");
      const candidates = discoverVariables(tree);
      file.close();
      send({ type: "INSPECTION_COMPLETE", result: { tree, candidates, reader: "h5wasm / HDF5 WORKERFS", durationMs: performance.now() - started } });
    } else if (event.data.type === "EXTRACT_ORBIT") {
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
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") send({ type: "CANCELLED" });
    else send({ type: "ERROR", message: "Не удалось обработать NetCDF4/HDF5.", details: error instanceof Error ? error.message : String(error) });
  }
};

export {};
