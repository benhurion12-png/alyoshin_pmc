"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map } from "maplibre-gl";
import type { PmcPointCollection } from "@/types/processing";

const MLS_FOOTPRINT_RADIUS_KM = 90;
const endpoint = process.env.NODE_ENV === "development" ? "/api/earthdata-mls" : "/.netlify/functions/earthdata-mls";

type Sample = { latitude: number; longitude: number; temperature: number; altitudeKm: number; pressureHpa: number; precisionK: number; timeUtc: string };
type Properties = Sample & { distanceKm: number };
type Collection = GeoJSON.FeatureCollection<GeoJSON.Polygon, Properties>;

const observationDate = (sourceFiles: string[]) => {
  const match = sourceFiles.map((name) => name.match(/_RA_BD1_(\d{4})(\d{2})(\d{2})T/)).find(Boolean);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
};
const center = (ring: number[][]) => {
  const points = ring.slice(0, -1);
  const latitude = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const reference = points[0][0];
  const longitude = points.reduce((sum, p) => {
    let lon = p[0];
    while (lon - reference > 180) lon -= 360;
    while (lon - reference < -180) lon += 360;
    return sum + lon;
  }, 0) / points.length;
  return [longitude, latitude] as const;
};
const distanceKm = (a: readonly number[], b: readonly number[]) => {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};
const collocate = (pixels: PmcPointCollection, samples: Sample[]): Collection => ({
  type: "FeatureCollection",
  features: pixels.features.flatMap((pixel) => {
    const pixelCenter = center(pixel.geometry.coordinates[0]);
    let nearest: Sample | null = null;
    let nearestDistance = Infinity;
    for (const sample of samples) {
      const distance = distanceKm(pixelCenter, [sample.longitude, sample.latitude]);
      if (distance < nearestDistance) { nearest = sample; nearestDistance = distance; }
    }
    return nearest && nearestDistance <= MLS_FOOTPRINT_RADIUS_KM
      ? [{ type: "Feature" as const, geometry: pixel.geometry, properties: { ...nearest, distanceKm: nearestDistance } }]
      : [];
  }),
});

export default function MlsTemperatureMap({ pixels, sourceFiles, active }: { pixels: PmcPointCollection | null; sourceFiles: string[]; active: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const [data, setData] = useState<Collection | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [resolvedDate, setResolvedDate] = useState("");
  const date = useMemo(() => observationDate(sourceFiles), [sourceFiles]);
  const range = useMemo(() => {
    const values = data?.features.map((feature) => feature.properties.temperature) ?? [];
    return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
  }, [data]);

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new maplibregl.Map({
      container: container.current, center: [0, 70], zoom: 1.4, renderWorldCopies: false,
      style: { version: 8, sources: { basemap: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": .5 } }] },
    });
    map.current.addControl(new maplibregl.NavigationControl(), "top-right");
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => map.current?.resize());
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (!pixels?.features.length || !date) {
      setData(null);
      setProgress(pixels ? "Не удалось определить дату TROPOMI." : "Сначала запустите обнаружение серебристых облаков.");
      return;
    }
    const controller = new AbortController();
    const worker = new Worker(new URL("../../workers/mls.worker.ts", import.meta.url), { type: "module" });
    const load = async () => {
      try {
        setError(""); setData(null); setResolvedDate("");
        const requested = date.toISOString().slice(0, 10);
        setProgress("Поиск ближайших Aura MLS Temperature и GPH…");
        const responses = await Promise.all(["temperature", "gph"].map((product) =>
          fetch(`${endpoint}?product=${product}&date=${requested}`, { signal: controller.signal }),
        ));
        for (const response of responses) if (!response.ok) throw new Error(await response.text());
        const dates = responses.map((response) => response.headers.get("X-MLS-Date") || requested);
        if (dates[0] !== dates[1]) throw new Error("Для Temperature и GPH найдены разные даты Aura MLS.");
        setResolvedDate(dates[0]);
        setProgress("Чтение профилей и выбор температуры на высоте 83 км…");
        const [temperatureBlob, gphBlob] = await Promise.all(responses.map((response) => response.blob()));
        worker.onmessage = ({ data: message }: MessageEvent<{ type: string; samples?: Sample[]; message?: string }>) => {
          if (message.type === "error") { setError(message.message || "Ошибка чтения Aura MLS."); setProgress(""); return; }
          const samples = message.samples ?? [];
          const matched = collocate(pixels, samples);
          setData(matched);
          setProgress(matched.features.length
            ? `Готово: ${matched.features.length} PMC-пикселей · ${samples.length} качественных профилей MLS.`
            : `Aura MLS загружен (${samples.length} профилей), но PMC-пиксели не пересекают измерительный след MLS.`);
        };
        worker.postMessage({
          temperatureFile: new File([temperatureBlob], "mls-temperature.he5"),
          gphFile: new File([gphBlob], "mls-gph.he5"),
        });
      } catch (cause) {
        if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : String(cause)); setProgress(""); }
      }
    };
    void load();
    return () => { controller.abort(); worker.terminate(); };
  }, [date, pixels]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !data || !range) return;
    const spread = Math.max(0.01, range.max - range.min);
    const colorScale: maplibregl.ExpressionSpecification = ["interpolate", ["linear"], ["get", "temperature"],
      range.min, "#123cff", range.min + spread * .25, "#00b7ff", range.min + spread * .5, "#39db72",
      range.min + spread * .75, "#ffe32b", range.max, "#f22b24"];
    const apply = () => {
      const source = instance.getSource("mls-pmc-temperature") as GeoJSONSource | undefined;
      if (source) source.setData(data);
      else {
        instance.addSource("mls-pmc-temperature", { type: "geojson", data });
        instance.addLayer({ id: "mls-pmc-temperature-pixels", type: "fill", source: "mls-pmc-temperature", paint: { "fill-color": colorScale, "fill-opacity": .9, "fill-outline-color": "#e4fbff" } });
        instance.on("click", "mls-pmc-temperature-pixels", (event) => {
          const p = event.features?.[0]?.properties;
          if (!p) return;
          new maplibregl.Popup().setLngLat(event.lngLat).setHTML(
            `<strong>${Number(p.temperature).toFixed(2)} K</strong><br>Aura MLS · ${Number(p.altitudeKm).toFixed(2)} км<br>Давление: ${Number(p.pressureHpa).toFixed(4)} hPa<br>Точность: ±${Number(p.precisionK).toFixed(2)} K<br>Профиль MLS: ${Number(p.distanceKm).toFixed(1)} км`,
          ).addTo(instance);
        });
      }
      instance.setPaintProperty("mls-pmc-temperature-pixels", "fill-color", colorScale);
      if (data.features.length) {
        const coordinates = data.features.flatMap((feature) => feature.geometry.coordinates[0]);
        const bounds = coordinates.reduce((box, coordinate) => box.extend(coordinate as [number, number]), new maplibregl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number]));
        instance.fitBounds(bounds, { padding: 70, maxZoom: 6, duration: 700 });
      }
    };
    if (instance.isStyleLoaded()) apply(); else instance.once("load", apply);
  }, [data, range]);

  return <div className="sofie-panel">
    <div className="sofie-toolbar"><b>AURA MLS V006 · {resolvedDate || (date ? `ПОИСК К ${date.toISOString().slice(0, 10)}` : "ОЖИДАНИЕ TROPOMI")}</b><span>{progress}</span></div>
    <div className="map-wrap"><div ref={container} className="map" aria-label="Температура Aura MLS только в PMC-пикселях" />{!data?.features.length ? <div className="sofie-empty">{progress || "Ожидание данных…"}</div> : null}</div>
    {range ? <div className="temperature-legend"><b>{range.min.toFixed(1)} K</b><i /><b>{range.max.toFixed(1)} K</b><span>{data?.features.length} PMC-пикселей · кликните для точного значения</span></div> : null}
    {error ? <div className="error">{error}</div> : null}
    <p className="sofie-note">Температура ML2T выбрана по давлению уровня ML2GPH, высота которого ближе всего к 83 км. Окрашены только обнаруженные TROPOMI PMC-пиксели в пределах 90 км от центра профиля — характерного вдольтрассового полуследа MLS; остальные температуры атмосферы не показаны.</p>
  </div>;
}
