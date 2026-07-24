export type SpatialInput = {
  rows: number;
  cols: number;
  latitude: Float32Array;
  longitude: Float32Array;
  latitudeBounds?: Float32Array;
  longitudeBounds?: Float32Array;
  sza: Float32Array;
  signals: [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  qualityMask?: Uint8Array;
};

const unwrap = (longitude: number, reference: number) => {
  let value = longitude;
  while (value - reference > 180) value -= 360;
  while (value - reference < -180) value += 360;
  return value;
};

const groupsFor = (cols: number) => {
  if (cols !== 77) {
    const groups: number[][] = [];
    for (let col = 0; col + 1 < cols; col += 2) groups.push([col, col + 1]);
    return groups;
  }
  const groups: number[][] = [];
  for (let col = 5; col <= 35; col += 2) groups.push([col, col + 1]);
  groups.push([37, 38, 39]);
  for (let col = 40; col <= 70; col += 2) groups.push([col, col + 1]);
  return groups;
};

const pixelWeight = (input: SpatialInput, index: number) => {
  if (!input.latitudeBounds || !input.longitudeBounds) return 1;
  const offset = index * 4;
  if (input.latitudeBounds.length < offset + 4 || input.longitudeBounds.length < offset + 4) return 1;
  const reference = input.longitudeBounds[offset];
  let minLat = 90, maxLat = -90, minLon = Infinity, maxLon = -Infinity;
  for (let corner = 0; corner < 4; corner++) {
    const lat = input.latitudeBounds[offset + corner];
    const lon = unwrap(input.longitudeBounds[offset + corner], reference);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 1;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  }
  return Math.max(1e-8, (maxLat - minLat) * (maxLon - minLon) * Math.cos((minLat + maxLat) * Math.PI / 360));
};

export function spatialBin(input: SpatialInput): SpatialInput {
  const columnGroups = groupsFor(input.cols);
  const outputRows = Math.floor(input.rows / 2);
  const outputCols = columnGroups.length;
  const size = outputRows * outputCols;
  const latitude = new Float32Array(size);
  const longitude = new Float32Array(size);
  const sza = new Float32Array(size);
  const signals = input.signals.map(() => new Float32Array(size)) as SpatialInput["signals"];
  const qualityMask = new Uint8Array(size);
  const latitudeBounds = new Float32Array(size * 4);
  const longitudeBounds = new Float32Array(size * 4);

  for (let outputRow = 0; outputRow < outputRows; outputRow++) {
    for (let outputCol = 0; outputCol < outputCols; outputCol++) {
      const outputIndex = outputRow * outputCols + outputCol;
      const members: number[] = [];
      for (let row = outputRow * 2; row < outputRow * 2 + 2; row++) {
        for (const col of columnGroups[outputCol]) members.push(row * input.cols + col);
      }
      const valid = members.filter((index) =>
        (!input.qualityMask || input.qualityMask[index] === 1)
        && Number.isFinite(input.latitude[index])
        && Number.isFinite(input.longitude[index])
        && input.signals.every((signal) => Number.isFinite(signal[index])),
      );
      if (!valid.length) {
        latitude[outputIndex] = longitude[outputIndex] = sza[outputIndex] = NaN;
        signals.forEach((signal) => { signal[outputIndex] = NaN; });
        continue;
      }
      const reference = input.longitude[valid[0]];
      let totalWeight = 0, sumLat = 0, sumLon = 0, sumSza = 0;
      const sumSignals = new Float64Array(signals.length);
      let minLat = 90, maxLat = -90, minLon = Infinity, maxLon = -Infinity;
      for (const index of valid) {
        const weight = pixelWeight(input, index);
        const lon = unwrap(input.longitude[index], reference);
        totalWeight += weight;
        sumLat += input.latitude[index] * weight;
        sumLon += lon * weight;
        sumSza += input.sza[index] * weight;
        input.signals.forEach((signal, band) => { sumSignals[band] += signal[index] * weight; });
        if (input.latitudeBounds && input.longitudeBounds) {
          for (let corner = 0; corner < 4; corner++) {
            const lat = input.latitudeBounds[index * 4 + corner];
            const cornerLon = unwrap(input.longitudeBounds[index * 4 + corner], reference);
            if (Number.isFinite(lat) && Number.isFinite(cornerLon)) {
              minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
              minLon = Math.min(minLon, cornerLon); maxLon = Math.max(maxLon, cornerLon);
            }
          }
        }
      }
      latitude[outputIndex] = sumLat / totalWeight;
      longitude[outputIndex] = sumLon / totalWeight;
      sza[outputIndex] = sumSza / totalWeight;
      signals.forEach((signal, band) => { signal[outputIndex] = sumSignals[band] / totalWeight; });
      qualityMask[outputIndex] = 1;
      if (!Number.isFinite(minLat)) {
        minLat = latitude[outputIndex] - .03; maxLat = latitude[outputIndex] + .03;
        minLon = longitude[outputIndex] - .06; maxLon = longitude[outputIndex] + .06;
      }
      latitudeBounds.set([minLat, minLat, maxLat, maxLat], outputIndex * 4);
      longitudeBounds.set([minLon, maxLon, maxLon, minLon], outputIndex * 4);
    }
  }
  return { rows: outputRows, cols: outputCols, latitude, longitude, latitudeBounds, longitudeBounds, sza, signals, qualityMask };
}
