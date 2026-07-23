import type { OrbitGeoJson } from "@/types/netcdf";

type NumericArray = ArrayLike<number>;

const valid = (lon: number, lat: number) =>
  Number.isFinite(lon) && Number.isFinite(lat) && lat >= -90 && lat <= 90 && lon >= -360 && lon <= 360;

const normalizeLon = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;

export function buildOrbitFootprint(lat: NumericArray, lon: NumericArray, shape: number[]): OrbitGeoJson {
  const rows = shape.at(-2) ?? 0;
  const cols = shape.at(-1) ?? 0;
  if (!rows || !cols || lat.length < rows * cols || lon.length < rows * cols) throw new Error("Размеры latitude/longitude несовместимы.");
  const offset = lat.length - rows * cols;
  const edge: number[] = [];
  const stepRow = Math.max(1, Math.floor(rows / 240));
  const stepCol = Math.max(1, Math.floor(cols / 120));
  for (let c = 0; c < cols; c += stepCol) edge.push(offset + c);
  for (let r = 0; r < rows; r += stepRow) edge.push(offset + r * cols + cols - 1);
  for (let c = cols - 1; c >= 0; c -= stepCol) edge.push(offset + (rows - 1) * cols + c);
  for (let r = rows - 1; r >= 0; r -= stepRow) edge.push(offset + r * cols);
  const coordinates = edge
    .map((i) => [normalizeLon(Number(lon[i])), Number(lat[i])])
    .filter(([x, y]) => valid(x, y));
  if (coordinates.length < 4) throw new Error("В файле недостаточно корректных координат.");
  coordinates.push([...coordinates[0]]);
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { geometryApproximate: false }, geometry: { type: "Polygon", coordinates: [coordinates] } }],
  };
}
