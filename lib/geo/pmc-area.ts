import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Pair, Polygon } from "polygon-clipping";
import type { PmcPointCollection } from "@/types/processing";

export type ProjectedMultiPolygon = MultiPolygon;

const EARTH_RADIUS_KM = 6371.0088;

export function projectNorthEqualArea([longitude, latitude]: [number, number]) {
  const lambda = longitude * Math.PI / 180;
  const phi = Math.max(-90, Math.min(90, latitude)) * Math.PI / 180;
  const rho = 2 * EARTH_RADIUS_KM * Math.sin((Math.PI / 2 - phi) / 2);
  return [rho * Math.sin(lambda), -rho * Math.cos(lambda)] as [number, number];
}

const signedRingArea = (ring: Pair[]) => {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    twiceArea += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return twiceArea / 2;
};

export function multiPolygonAreaKm2(multiPolygon: ProjectedMultiPolygon | null) {
  if (!multiPolygon) return 0;
  return multiPolygon.reduce((total, polygon) => {
    if (!polygon.length) return total;
    const outer = Math.abs(signedRingArea(polygon[0]));
    const holes = polygon.slice(1).reduce((sum, ring) => sum + Math.abs(signedRingArea(ring)), 0);
    return total + Math.max(0, outer - holes);
  }, 0);
}

export function unionPmcFootprints(
  current: ProjectedMultiPolygon | null,
  features: PmcPointCollection["features"],
) {
  const polygons: Polygon[] = features
    .map((feature) => feature.geometry.coordinates.map((ring) =>
      ring.map(([longitude, latitude]) => projectNorthEqualArea([longitude, latitude])) as Pair[],
    ))
    .filter((polygon) => polygon[0]?.length >= 4);
  let merged = current;
  for (let start = 0; start < polygons.length; start += 250) {
    const chunk = polygons.slice(start, start + 250);
    merged = (merged
      ? polygonClipping.union(merged, ...chunk)
      : polygonClipping.union(chunk[0], ...chunk.slice(1))) as ProjectedMultiPolygon;
  }
  return merged;
}
