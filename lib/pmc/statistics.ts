export function mean(values: ArrayLike<number>, mask?: Uint8Array) {
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) if ((!mask || mask[i]) && Number.isFinite(values[i])) { sum += values[i]; count++; }
  return count ? sum / count : NaN;
}

export function quickselect(values: Float64Array, k: number) {
  let left = 0, right = values.length - 1;
  while (left < right) {
    const pivot = values[(left + right) >>> 1];
    let i = left, j = right;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) { const t = values[i]; values[i++] = values[j]; values[j--] = t; }
    }
    if (k <= j) right = j; else if (k >= i) left = i; else break;
  }
  return values[k];
}

export function percentile(values: ArrayLike<number>, p: number) {
  const valid = new Float64Array(Array.from(values).filter(Number.isFinite));
  if (!valid.length) return NaN;
  return quickselect(valid, Math.max(0, Math.min(valid.length - 1, Math.round((valid.length - 1) * p))));
}

export const median = (values: ArrayLike<number>) => percentile(values, 0.5);

export function mad(values: ArrayLike<number>, center = median(values)) {
  const deviations = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) deviations[i] = Math.abs(values[i] - center);
  return median(deviations);
}

export const robustSigma = (values: ArrayLike<number>) => 1.4826 * mad(values);
