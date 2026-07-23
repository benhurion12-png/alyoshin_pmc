"use client";

import { useEffect, useRef } from "react";
import maplibregl, { GeoJSONSource, Map } from "maplibre-gl";
import type { OrbitGeoJson } from "@/types/netcdf";

export default function PmcMap({ orbit }: { orbit: OrbitGeoJson | null }) {
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

  return <div ref={container} className="map" aria-label="Карта орбиты TROPOMI" />;
}
