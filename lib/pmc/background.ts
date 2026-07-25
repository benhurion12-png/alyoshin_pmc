import { median, robustSigma } from "./statistics";

function solve(matrix: Float64Array, vector: Float64Array, n: number) {
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(matrix[r * n + i]) > Math.abs(matrix[pivot * n + i])) pivot = r;
    for (let c = i; c < n; c++) { const t = matrix[i * n + c]; matrix[i * n + c] = matrix[pivot * n + c]; matrix[pivot * n + c] = t; }
    { const t = vector[i]; vector[i] = vector[pivot]; vector[pivot] = t; }
    const d = matrix[i * n + i] || 1e-12;
    for (let c = i; c < n; c++) matrix[i * n + c] /= d;
    vector[i] /= d;
    for (let r = 0; r < n; r++) if (r !== i) {
      const f = matrix[r * n + i];
      for (let c = i; c < n; c++) matrix[r * n + c] -= f * matrix[i * n + c];
      vector[r] -= f * vector[i];
    }
  }
  return vector;
}

export function polynomialRegression(x: Float32Array, y: Float32Array, mask: Uint8Array, degree = 4) {
  const n = degree + 1, matrix = new Float64Array(n * n), vector = new Float64Array(n);
  let count = 0;
  for (let i = 0; i < x.length; i++) if (mask[i] && Number.isFinite(x[i]) && Number.isFinite(y[i])) {
    const z = (x[i] - 60) / 25;
    const powers = new Float64Array(n * 2); powers[0] = 1;
    for (let p = 1; p < powers.length; p++) powers[p] = powers[p - 1] * z;
    for (let r = 0; r < n; r++) { vector[r] += y[i] * powers[r]; for (let c = 0; c < n; c++) matrix[r * n + c] += powers[r + c]; }
    count++;
  }
  return count >= n * 2 ? solve(matrix, vector, n) : new Float64Array([median(y), 0, 0, 0, 0]);
}

export function evaluatePolynomial(coeff: Float64Array, x: number) {
  const z = (x - 60) / 25;
  let result = 0;
  for (let i = coeff.length - 1; i >= 0; i--) result = result * z + coeff[i];
  return result;
}

export function iterativeBackground(sza: Float32Array, signal: Float32Array, initialMask: Uint8Array, rows: number, cols: number, maxIterations: number) {
  const residual = new Float32Array(signal.length), background = new Float32Array(signal.length), fitMask = initialMask.slice();
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    for (let col = 0; col < cols; col++) {
      const x = new Float32Array(rows), y = new Float32Array(rows), mask = new Uint8Array(rows);
      for (let row = 0; row < rows; row++) { const i = row * cols + col; x[row] = sza[i]; y[row] = signal[i]; mask[row] = fitMask[i]; }
      const coeff = polynomialRegression(x, y, mask);
      for (let row = 0; row < rows; row++) { const i = row * cols + col; background[i] = evaluatePolynomial(coeff, sza[i]); residual[i] = signal[i] - background[i]; }
    }
    const sample = new Float32Array(residual.length); let n = 0;
    for (let i = 0; i < residual.length; i++) if (fitMask[i]) sample[n++] = residual[i];
    const sigma = robustSigma(sample.subarray(0, n)) || 1e-12;
    let changed = 0;
    for (let i = 0; i < fitMask.length; i++) if (fitMask[i] && residual[i] > 2.5 * sigma) { fitMask[i] = 0; changed++; }
    if (changed < Math.max(3, n * 0.0001)) break;
  }
  return { residual, background };
}

export function adaptiveThreshold(residual: Float32Array, sza: Float32Array, valid: Uint8Array, binSize: number, multiplier: number) {
  const bins = Math.ceil(90 / binSize), samples: number[][] = Array.from({ length: bins }, () => []);
  for (let i = 0; i < residual.length; i++) if (valid[i]) samples[Math.min(bins - 1, Math.floor(sza[i] / binSize))].push(residual[i]);
  const sigma = new Float32Array(bins);
  const fallback = robustSigma(residual) || 1e-12;
  for (let b = 0; b < bins; b++) if (samples[b].length >= 10) sigma[b] = robustSigma(samples[b]) || fallback;
  for (let b = 0; b < bins; b++) if (!sigma[b]) {
    let distance = 1;
    while (distance < bins && !sigma[Math.max(0, b - distance)] && !sigma[Math.min(bins - 1, b + distance)]) distance++;
    sigma[b] = sigma[Math.max(0, b - distance)] || sigma[Math.min(bins - 1, b + distance)] || fallback;
  }
  const threshold = new Float32Array(residual.length);
  for (let i = 0; i < threshold.length; i++) threshold[i] = multiplier * sigma[Math.min(bins - 1, Math.floor(sza[i] / binSize))];
  return threshold;
}

// Digitized from Wu et al. (2026), Figure 5. The plotted curves are the final
// detection thresholds in residual-albedo units (axis is ×10⁻⁶ sr⁻¹).
// The digitized coefficients represent the final 2.2 × Threshold curves.
// Do not apply the empirical multiplier again: doing so makes detections below
// 10 × 10⁻⁶ sr⁻¹ impossible, contradicting the blue PMC pixels in Figure 7.
const ARTICLE_THRESHOLD_COEFFICIENTS = [
  [9.10672716e-4, -4.17282790e-2, 6.44562562],
  [1.75435299e-3, -1.10785342e-1, 5.94616993],
  [3.03516903e-3, -3.02755739e-1, 12.8398066],
] as const;

export function articleThreshold(sza: Float32Array, valid: Uint8Array, cols: number) {
  const threshold = new Float32Array(sza.length);
  for (let index = 0; index < threshold.length; index++) {
    if (!valid[index]) { threshold[index] = NaN; continue; }
    const binnedRow = index % cols;
    const group = binnedRow < 8 ? 0 : binnedRow < 25 ? 1 : 2;
    const [a, b, c] = ARTICLE_THRESHOLD_COEFFICIENTS[group];
    const angle = Math.max(30, Math.min(85, sza[index]));
    threshold[index] = (a * angle * angle + b * angle + c) * 1e-6;
  }
  return threshold;
}

export function iterativeArticleBackground(
  sza: Float32Array,
  signals: [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array],
  initialMask: Uint8Array,
  rows: number,
  cols: number,
  maxIterations: number,
  wavelengths: [number, number, number, number, number],
) {
  const residuals = signals.map(() => new Float32Array(sza.length)) as typeof signals;
  const backgrounds = signals.map(() => new Float32Array(sza.length)) as typeof signals;
  const fitMask = initialMask.slice();
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    for (let col = 0; col < cols; col++) {
      const x = new Float32Array(rows), mask = new Uint8Array(rows);
      const columnSignals = signals.map(() => new Float32Array(rows)) as typeof signals;
      for (let row = 0; row < rows; row++) {
        const index = row * cols + col;
        x[row] = sza[index]; mask[row] = fitMask[index];
        signals.forEach((signal, band) => { columnSignals[band][row] = signal[index]; });
      }
      const coefficients = columnSignals.map((signal) => polynomialRegression(x, signal, mask));
      for (let row = 0; row < rows; row++) {
        const index = row * cols + col;
        signals.forEach((signal, band) => {
          backgrounds[band][index] = evaluatePolynomial(coefficients[band], sza[index]);
          residuals[band][index] = signal[index] - backgrounds[band][index];
        });
      }
    }
    const threshold = articleThreshold(sza, fitMask, cols);
    let changed = 0;
    for (let index = 0; index < fitMask.length; index++) {
      if (!fitMask[index]) continue;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let band = 0; band < wavelengths.length; band++) {
        const x = wavelengths[band], y = residuals[band][index];
        sx += x; sy += y; sxx += x * x; sxy += x * y;
      }
      const slope = (wavelengths.length * sxy - sx * sy) / (wavelengths.length * sxx - sx * sx);
      if (residuals[0][index] > threshold[index]
        && residuals[0][index] > 0 && residuals[1][index] > 0 && residuals[2][index] > 0
        && residuals[0][index] > residuals[2][index] && slope < 0) {
        fitMask[index] = 0;
        changed++;
      }
    }
    if (!changed) break;
  }
  return { residuals, backgrounds };
}
