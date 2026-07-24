"use client";

import { useMemo, useRef } from "react";
import { geoGraticule10, geoPath, geoStereographic } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import type { PmcPointCollection } from "@/types/processing";

type WorldTopology = Parameters<typeof feature>[0];
const color = (quality: string) => quality === "high" ? "#ef3340" : quality === "medium" ? "#ffd84d" : "#2f80ed";

export default function PolarMap({ pixels }: { pixels: PmcPointCollection | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 900, height = 720;
  const { landPath, graticulePath, pixelPaths, projection } = useMemo(() => {
    const projection = geoStereographic()
      .rotate([0, -90])
      .clipAngle(89.999)
      .scale(330)
      .translate([width / 2, height / 2]);
    const path = geoPath(projection);
    const topology = world as unknown as { objects: { countries: Parameters<typeof feature>[1] } };
    const land = feature(world as unknown as WorldTopology, topology.objects.countries);
    return {
      projection,
      landPath: path(land) ?? "",
      graticulePath: path(geoGraticule10()) ?? "",
      pixelPaths: pixels?.features.map((item) => ({ d: path(item) ?? "", quality: item.properties.qualityLevel })) ?? [],
    };
  }, [pixels]);

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
        <circle cx={width / 2} cy={height / 2} r="330" fill="#a9d9e6" stroke="#6ee7ef" strokeWidth="2" />
        <path d={graticulePath} fill="none" stroke="#dff7fa" strokeOpacity=".38" strokeWidth=".7" />
        <path d={landPath} fill="#f1f0eb" stroke="#bacbd0" strokeWidth=".5" />
        {pixelPaths.map((item, index) => <path key={index} d={item.d} fill={color(item.quality)} stroke={color(item.quality)} strokeWidth=".7" opacity=".92" />)}
        {pole ? <circle cx={pole[0]} cy={pole[1]} r="3" fill="#ffffff" /> : null}
        <text x="28" y="38" fill="#78e8ef" fontFamily="monospace" fontSize="15" letterSpacing="3">NORTH POLAR STEREOGRAPHIC · PMC</text>
        <text x="28" y={height - 25} fill="#8299a6" fontFamily="monospace" fontSize="11">70°N–90°N · LONGITUDE RADIAL</text>
      </svg>
      <div className="map-export"><button onClick={() => download("png")}>↓ PNG</button><button onClick={() => download("svg")}>↓ SVG</button></div>
    </div>
  );
}
