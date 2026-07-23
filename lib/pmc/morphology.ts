const neighborhood = (index: number, rows: number, cols: number) => {
  const r = Math.floor(index / cols), c = index % cols, out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
  }
  return out;
};
export function dilate(mask: Uint8Array, rows: number, cols: number) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (mask[i]) for (const n of neighborhood(i, rows, cols)) out[n] = 1;
  return out;
}
export function erode(mask: Uint8Array, rows: number, cols: number) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = neighborhood(i, rows, cols).every((n) => mask[n]) ? 1 : 0;
  return out;
}
export const closing = (mask: Uint8Array, rows: number, cols: number) => erode(dilate(mask, rows, cols), rows, cols);
export const opening = (mask: Uint8Array, rows: number, cols: number) => dilate(erode(mask, rows, cols), rows, cols);

export function connectedComponents(mask: Uint8Array, rows: number, cols: number) {
  const seen = new Uint8Array(mask.length), components: Uint32Array[] = [];
  for (let start = 0; start < mask.length; start++) if (mask[start] && !seen[start]) {
    const queue = new Uint32Array(mask.length), found = new Uint32Array(mask.length); let head = 0, tail = 1, count = 0; queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++]; found[count++] = i;
      for (const n of neighborhood(i, rows, cols)) if (mask[n] && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
    }
    components.push(found.slice(0, count));
  }
  return components;
}
