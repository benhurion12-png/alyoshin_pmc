"use client";

import { useMemo, useRef } from "react";
import { geoGraticule10, geoPath, geoStereographic } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import type { PmcPointCollection, ResidualFieldCollection } from "@/types/processing";

type WorldTopology = Parameters<typeof feature>[0];
const color = (value: number) => value >= .9 ? "#a80000" : value >= .75 ? "#ff9d00" : value >= .6 ? "#ffe600" : value >= .4 ? "#35db61" : value >= .2 ? "#00bde8" : "#1648d8";

export default function PolarMap({ field, singleOrbit = false }: { field: ResidualFieldCollection | PmcPointCollection | null; singleOrbit?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 900, height = 720;
  const { landPath, graticulePath, fieldPaths, projection } = useMemo(() => {
    const projection = geoStereographic()
      .rotate([0, -90])
      .clipAngle(singleOrbit ? 20 : 40)
      .scale(singleOrbit ? 1860 : 900)
      .translate([width / 2, height / 2]);
    const path = geoPath(projection);
    const topology = world as unknown as { objects: { countries: Parameters<typeof feature>[1] } };
    const land = feature(world as unknown as WorldTopology, topology.objects.countries);
    // d3-geo uses the spherical ring convention opposite to RFC 7946.
    // Reverse the small GeoJSON pixel rings so it draws the pixel, not its complement.
    const polarField = field?.features.map((item) => ({
      ...item,
      geometry: {
        ...item.geometry,
        coordinates: item.geometry.coordinates.map((ring) => [...ring].reverse()),
      },
    })) ?? [];
    return {
      projection,
      landPath: path(land) ?? "",
      graticulePath: path(geoGraticule10()) ?? "",
      fieldPaths: polarField.map((item, index) => ({
        d: path(item) ?? "",
        value: field?.features[index].properties.detectionScore ?? 0,
      })),
    };
  }, [field, singleOrbit]);

  const download = (format: "svg" | "png") => {
    const svg = svgRef.current; if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    if (format === "svg") {
      const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "pmc-polar-map.svg"; anchor.click(); URL.revokeObjectURL(url);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = width * 2; canvas.height = height * 2;
      const context = canvas.getContext("2d"); if (!context) return;
      context.scale(2, 2); context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
        anchor.href = url; anchor.download = "pmc-polar-map.png"; anchor.click(); URL.revokeObjectURL(url);
      });
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  };

  const pole = projection([0, 90]);
  return (
    <div className="polar-wrap">
      <svg ref={svgRef} className="polar-map" viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
        <rect width={width} height={height} fill="#07131d" />
        <circle cx={width / 2} cy={height / 2} r="328" fill="#a9d9e6" stroke="#6ee7ef" strokeWidth="2" />
        <path d={graticulePath} fill="none" stroke="#dff7fa" strokeOpacity=".38" strokeWidth=".7" />
        <path d={landPath} fill="#f1f0eb" stroke="#bacbd0" strokeWidth=".5" />
        {fieldPaths.map((item, index) => <path key={`field-${index}`} d={item.d} fill={color(item.value)} stroke="none" opacity=".88" />)}
        {pole ? <circle cx={pole[0]} cy={pole[1]} r="3" fill="#ffffff" /> : null}
        <text x="28" y="38" fill="#78e8ef" fontFamily="monospace" fontSize="15" letterSpacing="3">NORTH POLAR STEREOGRAPHIC · PMC</text>
        <text x="28" y={height - 25} fill="#8299a6" fontFamily="monospace" fontSize="11">{singleOrbit ? "70°N–90°N · NATIVE 2×2 / 2×3 BINS" : "50°N–90°N · DAILY 7.5 KM GRID"}</text>
      </svg>
      <div className="map-export"><button onClick={() => download("png")}>↓ PNG</button><button onClick={() => download("svg")}>↓ SVG</button></div>
    </div>
  );
}
