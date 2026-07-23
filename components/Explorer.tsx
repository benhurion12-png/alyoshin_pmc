"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import DatasetTree from "@/components/inspection/DatasetTree";
import type { InspectionResult, OrbitGeoJson } from "@/types/netcdf";
import type { WorkerResponse } from "@/types/worker";
import { DEFAULT_SETTINGS, type ProcessingResult, type ProcessingSettings } from "@/types/processing";

const PmcMap = dynamic(() => import("@/components/map/PmcMap"), { ssr: false });
const formatBytes = (n: number) => new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(n / 1024 / 1024) + " МБ";

export default function Explorer() {
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [orbit, setOrbit] = useState<OrbitGeoJson | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [settings, setSettings] = useState<ProcessingSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ stage: "Ожидание файла", percent: 0 });
  const [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    worker.current = new Worker(new URL("../workers/tropomi.worker.ts", import.meta.url), { type: "module" });
    worker.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "PROGRESS") setProgress(message);
      if (message.type === "INSPECTION_COMPLETE") { setInspection(message.result); setBusy(false); setProgress({ stage: "Инспекция завершена", percent: 100 }); }
      if (message.type === "ORBIT_COMPLETE") { setOrbit(message.orbit); setBusy(false); setProgress({ stage: "Орбита построена", percent: 100 }); }
      if (message.type === "PROCESSING_COMPLETE") { setResult(message.result); setOrbit(message.result.orbit); setBusy(false); setProgress({ stage: "Обработка завершена", percent: 100 }); }
      if (message.type === "ERROR") { setError(`${message.message} ${message.details ?? ""}`); setBusy(false); }
      if (message.type === "CANCELLED") { setBusy(false); setProgress({ stage: "Операция отменена", percent: 0 }); }
    };
    return () => worker.current?.terminate();
  }, []);

  const lat = useMemo(() => inspection?.candidates.find((c) => c.semanticType === "latitude"), [inspection]);
  const lon = useMemo(() => inspection?.candidates.find((c) => c.semanticType === "longitude"), [inspection]);
  const choose = (next: File | undefined) => {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".nc")) { setError("Выберите файл NetCDF с расширением .nc"); return; }
    setFile(next); setInspection(null); setOrbit(null); setResult(null); setError(""); setProgress({ stage: "Файл выбран локально", percent: 0 });
  };
  const inspect = () => { if (file) { setBusy(true); setError(""); worker.current?.postMessage({ type: "INSPECT", file }); } };
  const extract = () => { if (file && lat && lon) { setBusy(true); setError(""); worker.current?.postMessage({ type: "EXTRACT_ORBIT", file, latitudePath: lat.path, longitudePath: lon.path }); } };
  const process = () => { if (file) { setBusy(true); setError(""); worker.current?.postMessage({ type: "PROCESS", radianceFile: file, settings }); } };
  const download = (value: unknown, name: string) => {
    if (!value) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };
  const setNumber = (key: keyof ProcessingSettings, value: number) => setSettings((current) => ({ ...current, [key]: value }));
  const drop = (event: DragEvent) => { event.preventDefault(); choose(event.dataTransfer.files[0]); };

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
            <input ref={input} type="file" accept=".nc" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => choose(e.target.files?.[0])} />
            <div className="orbit-icon">◎</div>
            {file ? <><strong>{file.name}</strong><small>{formatBytes(file.size)} · локальный File API</small></> : <><strong>Перетащите RA_BD1 .nc</strong><small>или нажмите, чтобы выбрать файл</small></>}
          </div>
          <div className="actions">
            <button className="primary" disabled={!file || busy} onClick={inspect}>Инспектировать файл <span>→</span></button>
            <button disabled={!inspection || !lat || !lon || busy} onClick={extract}>Построить орбиту</button>
            <button className="detect" disabled={!inspection || busy} onClick={process}>Найти вероятные PMC</button>
            {busy ? <button onClick={() => worker.current?.postMessage({ type: "CANCEL" })}>Отмена</button> : null}
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
          <div className="section-title"><b>02</b><span>ВЕРОЯТНЫЕ ПОЛЯРНЫЕ МЕЗОСФЕРНЫЕ ОБЛАКА</span>{orbit ? <button className="download" onClick={() => download(orbit, "orbit.geojson")}>↓ ORBIT</button> : null}</div>
          <PmcMap key={String(result?.metadata.processedAt ?? "empty")} orbit={orbit} pixels={result?.pixels ?? null} clusters={result?.clusters ?? null} />
          <div className="map-status quality-legend"><span><i className="cyan" />ОРБИТАЛЬНЫЙ СЛЕД</span><span><i className="quality low" />НИЗКИЙ</span><span><i className="quality medium" />СРЕДНИЙ</span><span><i className="quality high" />ВЫСОКИЙ</span><em>MAPLIBRE · OPENSTREETMAP</em></div>
          {result ? <div className="result-strip">
            <div><b>{result.pixels.features.length}</b><span>пикселей</span></div><div><b>{result.clusters.features.length}</b><span>кластеров</span></div>
            <div><b className="blue-number">{result.pixels.features.filter((feature) => feature.properties.qualityLevel === "low").length}</b><span>низкий</span></div>
            <div><b className="yellow-number">{result.pixels.features.filter((feature) => feature.properties.qualityLevel === "medium").length}</b><span>средний</span></div>
            <div><b className="red-number">{result.pixels.features.filter((feature) => feature.properties.qualityLevel === "high").length}</b><span>высокий</span></div>
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
