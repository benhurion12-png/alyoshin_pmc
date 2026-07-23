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
      const source = instance.getSource("orbit-footprint") as GeoJSONSource | undefined;
      if (source) source.setData(orbit);
      else {
        instance.addSource("orbit-footprint", { type: "geojson", data: orbit });
        instance.addLayer({ id: "orbit-fill", type: "fill", source: "orbit-footprint", paint: { "fill-color": "#8bf3ff", "fill-opacity": 0.22 } });
        instance.addLayer({ id: "orbit-outline", type: "line", source: "orbit-footprint", paint: { "line-color": "#8bf3ff", "line-width": 2 } });
      }
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
      const update = (id: string, data: GeoJSON.FeatureCollection) => {
        const source = instance.getSource(id) as GeoJSONSource | undefined;
        if (source) source.setData(data); else instance.addSource(id, { type: "geojson", data });
      };
      update("pmc-pixels", pixels); update("pmc-clusters", clusters);
      if (!instance.getLayer("pmc-pixels")) instance.addLayer({
        id: "pmc-pixels", type: "circle", source: "pmc-pixels",
        paint: { "circle-radius": 4, "circle-color": ["interpolate", ["linear"], ["get", "signalToNoise"], 2, "#f5d45c", 5, "#ff7a45", 10, "#ff3d68"], "circle-opacity": .82 },
      });
      if (!instance.getLayer("pmc-cluster-fill")) instance.addLayer({
        id: "pmc-cluster-fill", type: "fill", source: "pmc-clusters",
        paint: { "fill-color": ["interpolate", ["linear"], ["get", "detectionScore"], 0, "#ffe970", 1, "#ff356d"], "fill-opacity": .22 },
      });
      if (!instance.getLayer("pmc-cluster-outline")) instance.addLayer({ id: "pmc-cluster-outline", type: "line", source: "pmc-clusters", paint: { "line-color": "#ffca54", "line-width": 2 } });
      const popup = (event: maplibregl.MapLayerMouseEvent) => {
        const p = event.features?.[0]?.properties; if (!p) return;
        new maplibregl.Popup().setLngLat(event.lngLat).setHTML(`<strong>Вероятный PMC</strong><br>Residual: ${Number(p.residual).toExponential(3)}<br>Порог: ${Number(p.threshold).toExponential(3)}<br>S/N: ${Number(p.signalToNoise).toFixed(2)}<br>Detection score: ${Number(p.detectionScore).toFixed(2)}<br>Пикселей: ${p.pixelCount}`).addTo(instance);
      };
      instance.on("click", "pmc-pixels", popup);
    };
    if (instance.isStyleLoaded()) apply(); else instance.once("load", apply);
  }, [pixels, clusters]);

  return <div ref={container} className="map" aria-label="Карта орбиты TROPOMI" />;
}
