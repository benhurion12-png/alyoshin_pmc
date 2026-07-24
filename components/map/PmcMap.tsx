"use client";

import { useEffect, useRef } from "react";
import maplibregl, { GeoJSONSource, Map } from "maplibre-gl";
import type { OrbitGeoJson } from "@/types/netcdf";
import type { PmcClusterCollection, PmcPointCollection, ResidualFieldCollection } from "@/types/processing";

export default function PmcMap({ orbit, field, pixels, clusters }: { orbit: OrbitGeoJson | null; field: ResidualFieldCollection | null; pixels: PmcPointCollection | null; clusters: PmcClusterCollection | null }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new maplibregl.Map({
      container: container.current,
      center: [0, 35],
      zoom: 1.25,
      renderWorldCopies: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
      },
    });
    map.current.addControl(new maplibregl.NavigationControl(), "top-right");
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !orbit) return;
    const apply = () => {
      instance.setRenderWorldCopies(false);
      const source = instance.getSource("orbit-footprint") as GeoJSONSource | undefined;
      if (source) source.setData(orbit);
      else {
        instance.addSource("orbit-footprint", { type: "geojson", data: orbit });
        instance.addLayer({ id: "orbit-fill", type: "fill", source: "orbit-footprint", paint: { "fill-color": "#8bf3ff", "fill-opacity": 0.045 } });
        instance.addLayer({ id: "orbit-outline", type: "line", source: "orbit-footprint", paint: { "line-color": "#8bf3ff", "line-width": 2 } });
      }
      instance.setPaintProperty("orbit-fill", "fill-opacity", 0.025);
      if (pixels?.features.length) {
        instance.setLayoutProperty("orbit-fill", "visibility", "none");
        instance.setLayoutProperty("orbit-outline", "visibility", "none");
      } else {
        instance.setLayoutProperty("orbit-fill", "visibility", "visible");
        instance.setLayoutProperty("orbit-outline", "visibility", "visible");
      }
      const coordinates = orbit.features[0]?.geometry.coordinates[0] ?? [];
      if (coordinates.length) {
        const bounds = coordinates.reduce((b, c) => b.extend(c as [number, number]), new maplibregl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number]));
        instance.fitBounds(bounds, { padding: 50, maxZoom: 4, duration: 900 });
      }
    };
    if (instance.isStyleLoaded()) apply(); else instance.once("load", apply);
  }, [orbit, pixels]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !field || !pixels || !clusters) return;
    const apply = () => {
      instance.setRenderWorldCopies(false);
      if (clusters.features.length) {
        const largest = clusters.features.reduce((best, feature) => feature.properties.pixelCount > best.properties.pixelCount ? feature : best);
        const [centerLon, centerLat] = largest.properties.centroid;
        if (Number.isFinite(centerLon) && Number.isFinite(centerLat)) instance.jumpTo({ center: [centerLon, centerLat], zoom: 5.2 });
      }
      for (const layer of ["pmc-pixel-outline", "pmc-pixels", "residual-field", "pmc-cluster-outline", "pmc-cluster-fill"]) if (instance.getLayer(layer)) instance.removeLayer(layer);
      for (const source of ["pmc-pixels", "residual-field", "pmc-clusters"]) if (instance.getSource(source)) instance.removeSource(source);
      instance.addSource("residual-field", { type: "geojson", data: field });
      instance.addSource("pmc-pixels", { type: "geojson", data: pixels });
      instance.addSource("pmc-clusters", { type: "geojson", data: clusters });
      instance.addLayer({
        id: "residual-field", type: "fill", source: "residual-field",
        layout: { visibility: "none" },
        paint: {
          "fill-color": ["interpolate", ["linear"], ["get", "detectionScore"], 0, "#150087", .15, "#163ecb", .3, "#008de5", .45, "#00d3c0", .6, "#4ddd4b", .75, "#ffe000", .9, "#ff5500", 1, "#ffffff"],
          "fill-opacity": .82,
          "fill-outline-color": "rgba(0,0,0,0)",
        },
      });
      instance.addLayer({
        id: "pmc-pixels", type: "fill", source: "pmc-pixels",
        paint: {
          "fill-color": ["interpolate", ["linear"], ["get", "detectionScore"], 0, "#1600a8", .2, "#006cff", .4, "#00d8d2", .6, "#4ee329", .75, "#ffe600", .9, "#ff5600", 1, "#a80000"],
          "fill-opacity": 0.88,
          "fill-outline-color": ["interpolate", ["linear"], ["get", "detectionScore"], 0, "#1600a8", .5, "#20d080", 1, "#a80000"],
        },
      });
      instance.addLayer({
        id: "pmc-pixel-outline", type: "line", source: "pmc-pixels",
        paint: {
          "line-color": ["interpolate", ["linear"], ["get", "detectionScore"], 0, "#1600a8", .5, "#20d080", 1, "#a80000"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, .7, 6, 1.6],
          "line-opacity": 0,
        },
      });
      const popup = (event: maplibregl.MapLayerMouseEvent) => {
        const p = event.features?.[0]?.properties; if (!p) return;
        new maplibregl.Popup().setLngLat(event.lngLat).setHTML(`<strong>Вероятный PMC · ${String(p.qualityLevel).toUpperCase()}</strong><br>Residual: ${Number(p.residual).toExponential(3)}<br>Порог: ${Number(p.threshold).toExponential(3)}<br>S/N: ${Number(p.signalToNoise).toFixed(2)}<br>Detection score: ${Number(p.detectionScore).toFixed(2)}<br>Пикселей в кластере: ${p.pixelCount}`).addTo(instance);
      };
      instance.off("click", "pmc-pixels", popup);
      instance.on("click", "pmc-pixels", popup);
    };
    if (instance.isStyleLoaded()) apply(); else instance.once("load", apply);
  }, [field, pixels, clusters]);

  const savePng = () => {
    const canvas = map.current?.getCanvas(); if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "pmc-maplibre-map.png"; anchor.click(); URL.revokeObjectURL(url);
    }, "image/png");
  };

  return <div className="map-wrap"><div ref={container} className="map" aria-label="Карта орбиты TROPOMI" /><div className="map-export"><button onClick={savePng}>↓ PNG</button></div></div>;
}
