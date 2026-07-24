"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import DatasetTree from "@/components/inspection/DatasetTree";
import ApiCalendar from "@/components/catalogue/ApiCalendar";
import type { InspectionResult, OrbitGeoJson } from "@/types/netcdf";
import type { WorkerResponse } from "@/types/worker";
import { DEFAULT_SETTINGS, type ProcessingResult, type ProcessingSettings } from "@/types/processing";

const PmcMap = dynamic(() => import("@/components/map/PmcMap"), { ssr: false });
const PolarMap = dynamic(() => import("@/components/map/PolarMap"), { ssr: false });
const formatBytes = (n: number) => new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(n / 1024 / 1024) + " МБ";
const EARTH_RADIUS_KM = 6371;
const DAILY_GRID_KM = 7.5;

const projectNorth = ([longitude, latitude]: [number, number]) => {
  const lambda = longitude * Math.PI / 180;
  const rho = 2 * EARTH_RADIUS_KM * Math.tan(Math.PI / 4 - latitude * Math.PI / 360);
  return [rho * Math.sin(lambda), -rho * Math.cos(lambda)] as const;
};

const unprojectNorth = (x: number, y: number) => {
  const rho = Math.hypot(x, y);
  const latitude = (Math.PI / 2 - 2 * Math.atan(rho / (2 * EARTH_RADIUS_KM))) * 180 / Math.PI;
  const longitude = Math.atan2(x, -y) * 180 / Math.PI;
  return [longitude, latitude] as [number, number];
};

const dailyGrid = (features: ProcessingResult["pixels"]["features"]) => {
  const brightest = new Map<string, { feature: ProcessingResult["pixels"]["features"][number]; x: number; y: number }>();
  for (const feature of features) {
    const ring = feature.geometry.coordinates[0];
    if (!ring?.length) continue;
    const longitude = ring.slice(0, -1).reduce((sum, point) => sum + point[0], 0) / Math.max(1, ring.length - 1);
    const latitude = ring.slice(0, -1).reduce((sum, point) => sum + point[1], 0) / Math.max(1, ring.length - 1);
    const [x, y] = projectNorth([longitude, latitude]);
    const gridX = Math.round(x / DAILY_GRID_KM), gridY = Math.round(y / DAILY_GRID_KM);
    const key = `${gridX}:${gridY}`;
    const current = brightest.get(key);
    if (!current || feature.properties.normalizedResidual > current.feature.properties.normalizedResidual) {
      brightest.set(key, { feature, x: gridX * DAILY_GRID_KM, y: gridY * DAILY_GRID_KM });
    }
  }
  const selected = [...brightest.values()];
  const maximumResidual = Math.max(...selected.map(({ feature }) => feature.properties.normalizedResidual), 1e-20);
  return selected.map(({ feature, x, y }) => ({
      ...feature,
      properties: { ...feature.properties, detectionScore: feature.properties.normalizedResidual / maximumResidual },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          unprojectNorth(x - DAILY_GRID_KM / 2, y - DAILY_GRID_KM / 2),
          unprojectNorth(x + DAILY_GRID_KM / 2, y - DAILY_GRID_KM / 2),
          unprojectNorth(x + DAILY_GRID_KM / 2, y + DAILY_GRID_KM / 2),
          unprojectNorth(x - DAILY_GRID_KM / 2, y + DAILY_GRID_KM / 2),
          unprojectNorth(x - DAILY_GRID_KM / 2, y - DAILY_GRID_KM / 2),
        ]],
      },
    }));
};

const mergeProcessingResult = (current: ProcessingResult | null, next: ProcessingResult, daily: boolean): ProcessingResult => {
  if (!current && !daily) return {
    ...next,
    metadata: { ...next.metadata, orbitCount: 1, sourceFiles: [next.metadata.sourceFile].filter(Boolean), displayMode: "single-orbit-native-bins" },
  };
  if (!current) return { ...next, pixels: { ...next.pixels, features: dailyGrid(next.pixels.features) }, metadata: { ...next.metadata, orbitCount: 1, sourceFiles: [next.metadata.sourceFile].filter(Boolean), dailyGridKm: DAILY_GRID_KM, displayMode: "daily-7.5-km-grid" } };
  const clusterOffset = current.clusters.features.length;
  return {
    orbit: { type: "FeatureCollection", features: [...current.orbit.features, ...next.orbit.features] },
    pixels: { type: "FeatureCollection", features: dailyGrid([...current.pixels.features, ...next.pixels.features]) },
    clusters: {
      type: "FeatureCollection",
      features: [...current.clusters.features, ...next.clusters.features.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, clusterId: feature.properties.clusterId + clusterOffset },
      }))],
    },
    warnings: [...new Set([...current.warnings, ...next.warnings])],
    metadata: {
      ...next.metadata,
      product: "daily-orbit-mosaic",
      orbitCount: Number(current.metadata.orbitCount ?? 1) + 1,
      sourceFiles: [...(Array.isArray(current.metadata.sourceFiles) ? current.metadata.sourceFiles : []), next.metadata.sourceFile].filter(Boolean),
      processedAt: new Date().toISOString(),
      dailyGridKm: DAILY_GRID_KM,
    },
  };
};

export default function Explorer() {
  const [files, setFiles] = useState<File[]>([]);
  const [irradianceFile, setIrradianceFile] = useState<File | null>(null);
  const file = files[0] ?? null;
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [orbit, setOrbit] = useState<OrbitGeoJson | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [settings, setSettings] = useState<ProcessingSettings>(DEFAULT_SETTINGS);
  const [mapMode, setMapMode] = useState<"maplibre" | "polar">("maplibre");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ stage: "Ожидание файла", percent: 0 });
  const [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const batch = useRef<{ files: File[]; irradianceFile: File | null; index: number; aggregate: ProcessingResult | null; settings: ProcessingSettings } | null>(null);

  useEffect(() => {
    worker.current = new Worker(new URL("../workers/tropomi.worker.ts", import.meta.url), { type: "module" });
    worker.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "PROGRESS") {
        const activeBatch = batch.current;
        setProgress(activeBatch
          ? { stage: `Орбита ${activeBatch.index + 1}/${activeBatch.files.length} · ${message.stage}`, percent: Math.round((activeBatch.index + message.percent / 100) / activeBatch.files.length * 100) }
          : message);
      }
      if (message.type === "INSPECTION_COMPLETE") { setInspection(message.result); setBusy(false); setProgress({ stage: "Инспекция завершена", percent: 100 }); }
      if (message.type === "ORBIT_COMPLETE") { setOrbit(message.orbit); setBusy(false); setProgress({ stage: "Орбита построена", percent: 100 }); }
      if (message.type === "PROCESSING_COMPLETE") {
        const activeBatch = batch.current;
        if (!activeBatch) {
          setResult(message.result); setOrbit(message.result.orbit); setBusy(false); setProgress({ stage: "Обработка завершена", percent: 100 });
          return;
        }
        activeBatch.aggregate = mergeProcessingResult(activeBatch.aggregate, message.result, activeBatch.files.length > 1);
        activeBatch.index++;
        if (activeBatch.index < activeBatch.files.length) {
          const next = activeBatch.files[activeBatch.index];
          setProgress({ stage: `Орбита ${activeBatch.index + 1}/${activeBatch.files.length} · ${next.name}`, percent: Math.round(activeBatch.index / activeBatch.files.length * 100) });
          worker.current?.postMessage({ type: "PROCESS", radianceFile: next, irradianceFile: activeBatch.irradianceFile ?? undefined, settings: activeBatch.settings });
        } else {
          const complete = activeBatch.aggregate;
          batch.current = null;
          if (complete) { setResult(complete); setOrbit(complete.orbit); }
          setBusy(false); setProgress({ stage: `Суточная мозаика: обработано ${activeBatch.files.length} орбит`, percent: 100 });
        }
      }
      if (message.type === "ERROR") { setError(`${message.message} ${message.details ?? ""}`); setBusy(false); }
      if (message.type === "CANCELLED") { setBusy(false); setProgress({ stage: "Операция отменена", percent: 0 }); }
    };
    return () => worker.current?.terminate();
  }, []);

  const lat = useMemo(() => inspection?.candidates.find((c) => c.semanticType === "latitude"), [inspection]);
  const lon = useMemo(() => inspection?.candidates.find((c) => c.semanticType === "longitude"), [inspection]);
  const choose = (next: File[]) => {
    const radiance = next.filter((item) => item.name.toLowerCase().endsWith(".nc") && item.name.includes("_RA_BD1_"));
    const irradiance = next.find((item) => item.name.toLowerCase().endsWith(".nc") && item.name.includes("_IR_UVN_")) ?? null;
    if (!radiance.length) { setError("Выберите один или несколько файлов OFFL L1B_RA_BD1 с расширением .nc"); return; }
    radiance.sort((a, b) => a.name.localeCompare(b.name));
    setFiles(radiance); setIrradianceFile(irradiance); setInspection(null); setOrbit(null); setResult(null); setError("");
    setProgress({ stage: `Выбрано орбит: ${radiance.length}`, percent: 0 });
  };
  const inspect = () => { if (file) { setBusy(true); setError(""); worker.current?.postMessage({ type: "INSPECT", file }); } };
  const extract = () => { if (file && lat && lon) { setBusy(true); setError(""); worker.current?.postMessage({ type: "EXTRACT_ORBIT", file, latitudePath: lat.path, longitudePath: lon.path }); } };
  const process = () => {
    if (!files.length) return;
    setBusy(true); setError(""); setResult(null); setOrbit(null);
    batch.current = { files, irradianceFile, index: 0, aggregate: null, settings };
    setProgress({ stage: `Орбита 1/${files.length} · ${files[0].name}`, percent: 0 });
    worker.current?.postMessage({ type: "PROCESS", radianceFile: files[0], irradianceFile: irradianceFile ?? undefined, settings });
  };
  const download = (value: unknown, name: string) => {
    if (!value) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };
  const setNumber = (key: keyof ProcessingSettings, value: number) => setSettings((current) => ({ ...current, [key]: value }));
  const drop = (event: DragEvent) => { event.preventDefault(); choose(Array.from(event.dataTransfer.files)); };

  return (
    <main>
      <header className="hero">
        <div><p className="eyebrow">SENTINEL-5P · LEVEL-1B · LOCAL-FIRST</p><h1>TROPOMI <span>PMC Explorer</span></h1></div>
        <div className="privacy"><i />Файл остаётся на вашем компьютере</div>
      </header>
      <p className="intro">Экспериментальное обнаружение вероятных полярных мезосферных облаков по данным Sentinel-5P TROPOMI Level-1B.</p>

      <section className="workspace">
        <aside>
          <div className="section-title"><b>01</b><span>ДАННЫЕ ОРБИТЫ</span></div>
          <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={drop} onClick={() => input.current?.click()}>
            <input ref={input} type="file" accept=".nc" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => choose(Array.from(e.target.files ?? []))} />
            <div className="orbit-icon">◎</div>
            {file ? <><strong>{files.length === 1 ? file.name : `${files.length} орбит RA_BD1`}</strong><small>{formatBytes(files.reduce((sum, item) => sum + item.size, 0))} · {irradianceFile ? `IR_UVN: ${irradianceFile.name}` : "IR_UVN не выбран"}</small></> : <><strong>Перетащите RA_BD1 и IR_UVN</strong><small>выберите все .nc выбранного дня одним действием</small></>}
          </div>
          {!file ? <ApiCalendar /> : null}
          <div className="actions">
            <button className="primary" disabled={!file || busy} onClick={inspect}>Инспектировать файл <span>→</span></button>
            <button disabled={!inspection || !lat || !lon || busy} onClick={extract}>Построить орбиту</button>
            <button className="detect" disabled={!inspection || busy} onClick={process}>Найти вероятные PMC</button>
            {busy ? <button onClick={() => { batch.current = null; worker.current?.postMessage({ type: "CANCEL" }); }}>Отмена</button> : null}
          </div>
          <div className="progress"><div><span>{progress.stage}</span><b>{progress.percent}%</b></div><progress value={progress.percent} max="100" /></div>
          {error ? <div className="error">{error}</div> : null}
          <div className="settings">
            <h3>Параметры обнаружения</h3>
            <label>Мин. широта <input type="number" value={settings.minLatitude} onChange={(e) => setNumber("minLatitude", +e.target.value)} /></label>
            <label>SZA максимум <input type="number" value={settings.maxSza} onChange={(e) => setNumber("maxSza", +e.target.value)} /></label>
            <label>Множитель шума <input type="number" step=".1" value={settings.noiseMultiplier} onChange={(e) => setNumber("noiseMultiplier", +e.target.value)} /></label>
            <label>Мин. кластер <input type="number" value={settings.minimumClusterSize} onChange={(e) => setNumber("minimumClusterSize", +e.target.value)} /></label>
          </div>
          <div className="warning"><b>Память браузера</b><p>Большие файлы TROPOMI требуют актуальную 64-битную версию Chrome или Edge.</p></div>
        </aside>

        <section className="main-panel">
          <div className="section-title"><b>02</b><span>ВЕРОЯТНЫЕ ПОЛЯРНЫЕ МЕЗОСФЕРНЫЕ ОБЛАКА</span>
            <div className="projection-switch"><button className={mapMode === "maplibre" ? "active" : ""} onClick={() => setMapMode("maplibre")}>MAPLIBRE</button><button className={mapMode === "polar" ? "active" : ""} onClick={() => setMapMode("polar")}>POLAR</button></div>
            {orbit ? <button className="download" onClick={() => download(orbit, "orbit.geojson")}>↓ ORBIT</button> : null}
          </div>
          {mapMode === "maplibre"
            ? <PmcMap key={String(result?.metadata.processedAt ?? "empty")} orbit={orbit} pixels={result?.pixels ?? null} clusters={result?.clusters ?? null} />
            : <PolarMap pixels={result?.pixels ?? null} singleOrbit={Number(result?.metadata.orbitCount ?? 0) === 1} />}
          <div className="map-status quality-legend"><span><i className="quality low" />0</span><span><i className="quality medium" />0,5</span><span><i className="quality high" />1,0</span><em>NORMALIZED RESIDUAL ALBEDO · 283 NM</em></div>
          {result ? <div className="result-strip">
            <div><b>{result.pixels.features.length}</b><span>пикселей</span></div><div><b>{result.clusters.features.length}</b><span>кластеров</span></div>
            <div><b className="blue-number">{result.pixels.features.filter((feature) => feature.properties.residual < 10e-6).length}</b><span>&lt;10×10⁻⁶</span></div>
            <div><b className="yellow-number">{result.pixels.features.filter((feature) => feature.properties.residual >= 10e-6 && feature.properties.residual < 20e-6).length}</b><span>10–20×10⁻⁶</span></div>
            <div><b className="red-number">{result.pixels.features.filter((feature) => feature.properties.residual >= 20e-6).length}</b><span>≥20×10⁻⁶</span></div>
            <button onClick={() => download(result.pixels, "pmc-pixels.geojson")}>PMC PIXELS ↓</button><button onClick={() => download(result.clusters, "pmc-clusters.geojson")}>PMC CLUSTERS ↓</button><button onClick={() => download(result.metadata, "metadata.json")}>METADATA ↓</button>
          </div> : null}
          {result?.warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
        </section>
      </section>

      <section className="inspector">
        <div className="section-title"><b>03</b><span>СТРУКТУРА NETCDF4 / HDF5</span>{inspection ? <em>{inspection.reader} · {(inspection.durationMs / 1000).toFixed(1)} с</em> : null}</div>
        {inspection ? (
          <div className="inspection-grid">
            <div className="tree-panel"><DatasetTree node={inspection.tree} /></div>
            <div className="candidates"><h3>Кандидаты переменных</h3>{inspection.candidates.slice(0, 12).map((c) => <div key={`${c.semanticType}-${c.path}`}><b>{c.semanticType}</b><code>{c.path}</code><span>{c.score}</span></div>)}</div>
          </div>
        ) : <div className="empty"><span>⌁</span><p>Выберите реальный RA_BD1 и запустите инспекцию.<br />Группы, datasets и кандидаты координат появятся здесь.</p></div>}
      </section>
      <footer><span>ALGORITHM STATUS · <b>MVP / ORBIT INSPECTION</b></span><span>Координаты берутся только из выбранного файла · данные не загружаются на сервер</span></footer>
    </main>
  );
}
