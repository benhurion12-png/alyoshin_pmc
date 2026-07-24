import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Pair, Polygon } from "polygon-clipping";
import type { PmcPointCollection, ResidualFieldCollection } from "@/types/processing";

export type ProjectedMultiPolygon = MultiPolygon;

const EARTH_RADIUS_KM = 6371.0088;
const TOPOLOGY_PRECISION_KM = 0.05;

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

const cleanRing = (coordinates: number[][]) => {
  const cleaned: Pair[] = [];
  for (const [longitude, latitude] of coordinates) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    const projected = projectNorthEqualArea([longitude, latitude]);
    const point: Pair = [
      Math.round(projected[0] / TOPOLOGY_PRECISION_KM) * TOPOLOGY_PRECISION_KM,
      Math.round(projected[1] / TOPOLOGY_PRECISION_KM) * TOPOLOGY_PRECISION_KM,
    ];
    const previous = cleaned.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) cleaned.push(point);
  }
  if (cleaned.length < 3) return null;
  const first = cleaned[0], last = cleaned.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) cleaned.push([...first]);
  return cleaned.length >= 4 && Math.abs(signedRingArea(cleaned)) > 1e-4 ? cleaned : null;
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
  features: PmcPointCollection["features"] | ResidualFieldCollection["features"],
) {
  const polygons: Polygon[] = [];
  for (const feature of features) {
    const rings = feature.geometry.coordinates.map(cleanRing).filter((ring): ring is Pair[] => Boolean(ring));
    if (rings[0]?.length >= 4) polygons.push(rings);
  }
  let merged = current;
  for (let start = 0; start < polygons.length; start += 20) {
    const chunk = polygons.slice(start, start + 20);
    try {
      merged = (merged
        ? polygonClipping.union(merged, ...chunk)
        : polygonClipping.union(chunk[0], ...chunk.slice(1))) as ProjectedMultiPolygon;
    } catch {
      // Near-coincident satellite edges can occasionally defeat the sweep-line
      // topology builder. Retry one footprint at a time; if one still fails,
      // preserve it as a separate component rather than crashing the analysis.
      for (const polygon of chunk) {
        try {
          merged = (merged ? polygonClipping.union(merged, polygon) : [polygon]) as ProjectedMultiPolygon;
        } catch {
          merged = [...(merged ?? []), polygon];
        }
      }
    }
  }
  return merged;
}
