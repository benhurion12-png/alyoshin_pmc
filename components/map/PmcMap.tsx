"use client";

import { useEffect, useRef } from "react";
import maplibregl, { GeoJSONSource, Map } from "maplibre-gl";
import type { OrbitGeoJson } from "@/types/netcdf";
import type { PmcClusterCollection, PmcPointCollection } from "@/types/processing";

export default function PmcMap({ orbit, pixels, clusters }: { orbit: OrbitGeoJson | null; pixels: PmcPointCollection | null; clusters: PmcClusterCollection | null }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new maplibregl.Map({
      container: container.current,
      center: [0, 35],
      zoom: 1.25,
      renderWorldCopies: false,
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
      const coordinates = orbit.features[0]?.geometry.coordinates[0] ?? [];
      if (coordinates.length) {
        const bounds = coordinates.reduce((b, c) => b.extend(c as [number, number]), new maplibregl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number]));
        instance.fitBounds(bounds, { padding: 50, maxZoom: 4, duration: 900 });
      }
    };
    if (instance.isStyleLoaded()) apply(); else instance.once("load", apply);
  }, [orbit]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !pixels || !clusters) return;
    const apply = () => {
      instance.setRenderWorldCopies(false);
      for (const layer of ["pmc-pixel-outline", "pmc-pixels", "pmc-cluster-outline", "pmc-cluster-fill"]) if (instance.getLayer(layer)) instance.removeLayer(layer);
      for (const source of ["pmc-pixels", "pmc-clusters"]) if (instance.getSource(source)) instance.removeSource(source);
      instance.addSource("pmc-pixels", { type: "geojson", data: pixels });
      instance.addSource("pmc-clusters", { type: "geojson", data: clusters });
      instance.addLayer({
        id: "pmc-pixels", type: "fill", source: "pmc-pixels",
        paint: {
          "fill-color": ["match", ["get", "qualityLevel"], "high", "#ef3340", "medium", "#ffd84d", "#2f80ed"],
          "fill-opacity": .9,
          "fill-outline-color": ["match", ["get", "qualityLevel"], "high", "#ff8b91", "medium", "#fff0a3", "#82b7ff"],
        },
      });
      instance.addLayer({
        id: "pmc-pixel-outline", type: "line", source: "pmc-pixels",
        paint: {
          "line-color": ["match", ["get", "qualityLevel"], "high", "#ff2338", "medium", "#e9b900", "#1268d6"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, .7, 6, 1.6],
          "line-opacity": .95,
        },
      });
      const popup = (event: maplibregl.MapLayerMouseEvent) => {
        const p = event.features?.[0]?.properties; if (!p) return;
        new maplibregl.Popup().setLngLat(event.lngLat).setHTML(`<strong>Вероятный PMC · ${String(p.qualityLevel).toUpperCase()}</strong><br>Residual: ${Number(p.residual).toExponential(3)}<br>Порог: ${Number(p.threshold).toExponential(3)}<br>S/N: ${Number(p.signalToNoise).toFixed(2)}<br>Detection score: ${Number(p.detectionScore).toFixed(2)}<br>Пикселей в кластере: ${p.pixelCount}`).addTo(instance);
      };
      instance.off("click", "pmc-pixels", popup);
      instance.on("click", "pmc-pixels", popup);
      if (clusters.features.length) {
        const largest = clusters.features.reduce((best, feature) => feature.properties.pixelCount > best.properties.pixelCount ? feature : best);
        instance.flyTo({ center: largest.properties.centroid, zoom: 4.8, duration: 900 });
      }
    };
    if (instance.isStyleLoaded()) apply(); else instance.once("load", apply);
  }, [pixels, clusters]);

  return <div ref={container} className="map" aria-label="Карта орбиты TROPOMI" />;
}
