// 3D figures for trays: a normalised height field on its own pixel grid.
//   { w, h, data: Float32Array (0..1, row 0 = bottom), mask: Uint8Array }
// Sources: STL (looked at from above), a grey-scale depth map image, or the
// built-in sample shell.

function finish(w, h, data, threshold) {
  let mn = Infinity, mx = -Infinity;
  for (let k = 0; k < data.length; k++) if (Number.isFinite(data[k])) { if (data[k] < mn) mn = data[k]; if (data[k] > mx) mx = data[k]; }
  const span = mx - mn || 1;
  const out = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let k = 0; k < data.length; k++) {
    if (!Number.isFinite(data[k])) continue;
    const v = (data[k] - mn) / span;
    if (v > threshold) { out[k] = v; mask[k] = 1; }
  }
  return { w, h, data: out, mask };
}

/** Grey-scale depth map (ImageData: white = high). Dark background below `threshold` is not part of the figure. */
export function figureFromImageData(img, { threshold = 0.04, invert = false } = {}) {
  const { width: w, height: h, data: px } = img;
  const d = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const k = ((h - 1 - r) * w + c) * 4; // flip: row 0 = bottom
    const a = px[k + 3] / 255;
    let v = ((0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2]) / 255) * a;
    if (invert) v = a ? 1 - v : 0;
    d[r * w + c] = v;
  }
  // images keep their absolute scale: black = 0 (background), white = 1
  const mask = new Uint8Array(w * h);
  for (let k = 0; k < d.length; k++) if (d[k] > threshold) mask[k] = 1; else d[k] = 0;
  return { w, h, data: d, mask };
}

/** Triangles of an STL (binary or ASCII) as a flat Float32Array [x,y,z × 3 per triangle]. */
export function parseStl(buffer) {
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(512, bytes.length)));
  const dv = new DataView(buffer);
  const isBinary = bytes.length >= 84 && 84 + dv.getUint32(80, true) * 50 === bytes.length;
  if (!isBinary && /^\s*solid/.test(head)) {
    const text = new TextDecoder().decode(bytes);
    const nums = [];
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let m;
    while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
    return Float32Array.from(nums);
  }
  const n = dv.getUint32(80, true);
  const out = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(o + k * 4, true);
  }
  return out;
}

/**
 * STL seen from above (+Z up) → height field. `res` = pixels on the longer side.
 * The flat base plate many relief STLs carry is dropped by `threshold`.
 */
export function figureFromStl(buffer, { res = 700, threshold = 0.02 } = {}) {
  const tri = parseStl(buffer);
  if (tri.length < 9) throw new Error('STL dosyasında üçgen bulunamadı.');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < tri.length; k += 3) {
    if (tri[k] < x0) x0 = tri[k]; if (tri[k] > x1) x1 = tri[k];
    if (tri[k + 1] < y0) y0 = tri[k + 1]; if (tri[k + 1] > y1) y1 = tri[k + 1];
  }
  const s = res / Math.max(x1 - x0, y1 - y0, 1e-6);
  const w = Math.max(2, Math.ceil((x1 - x0) * s)), h = Math.max(2, Math.ceil((y1 - y0) * s));
  const z = new Float32Array(w * h).fill(-Infinity);
  for (let t = 0; t < tri.length; t += 9) {
    const ax = (tri[t] - x0) * s, ay = (tri[t + 1] - y0) * s, az = tri[t + 2];
    const bx = (tri[t + 3] - x0) * s, by = (tri[t + 4] - y0) * s, bz = tri[t + 5];
    const qx = (tri[t + 6] - x0) * s, qy = (tri[t + 7] - y0) * s, qz = tri[t + 8];
    const den = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy);
    if (Math.abs(den) < 1e-12) continue; // vertical walls add nothing seen from above
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, qx))), i1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, qx)));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by, qy))), j1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, qy)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = i + 0.5, py = j + 0.5;
      const l1 = ((by - qy) * (px - qx) + (qx - bx) * (py - qy)) / den;
      const l2 = ((qy - ay) * (px - qx) + (ax - qx) * (py - qy)) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const zz = l1 * az + l2 * bz + l3 * qz;
      const k = j * w + i;
      if (zz > z[k]) z[k] = zz;
    }
  }
  return finish(w, h, z, threshold);
}

/** Built-in sample: a scallop shell (fan with ribs, two ears at the hinge). */
export function sampleShell(n = 520) {
  const w = n, h = Math.round(n * 0.92);
  const d = new Float32Array(w * h).fill(NaN);
  const hx = w / 2, hy = h * 0.1, R = h * 0.86;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = (i + 0.5 - hx) / R, y = (j + 0.5 - hy) / R;
    const rho = Math.hypot(x, y), th = Math.atan2(x, y); // 0 = straight up
    let v = NaN;
    if (Math.abs(th) < 1.15) {
      const edge = 0.97 + 0.03 * Math.cos(th * 30);
      if (rho < edge && rho > 0.02) {
        const dome = Math.sqrt(Math.max(0, 1 - (rho / edge) ** 2));
        const ribs = 0.5 + 0.5 * Math.cos(th * 30);
        const fan = Math.min(1, rho / 0.25);
        v = 0.25 + 0.5 * dome * (0.6 + 0.4 * Math.cos(th * 0.8)) + 0.22 * ribs * fan * (0.4 + 0.6 * dome) + 0.03 * Math.sin(rho * 60) * fan;
      }
    }
    // ears either side of the hinge
    if (Number.isNaN(v) && y > -0.06 && y < 0.16 && Math.abs(x) < 0.3) {
      v = 0.18 + 0.1 * (1 - Math.abs(x) / 0.3) + 0.04 * Math.cos(x * 70);
    }
    d[j * w + i] = v;
  }
  for (let k = 0; k < d.length; k++) if (Number.isNaN(d[k])) d[k] = 0;
  const out = { w, h, data: new Float32Array(w * h), mask: new Uint8Array(w * h) };
  let mx = 0;
  for (let k = 0; k < d.length; k++) mx = Math.max(mx, d[k]);
  for (let k = 0; k < d.length; k++) if (d[k] > 0) { out.data[k] = d[k] / mx; out.mask[k] = 1; }
  return out;
}

/** Rotate a figure by 90° steps (counter-clockwise). */
export function rotateFigure(f, quarter) {
  const q = ((quarter % 4) + 4) % 4;
  if (!q) return f;
  const w = q % 2 ? f.h : f.w, h = q % 2 ? f.w : f.h;
  const data = new Float32Array(w * h), mask = new Uint8Array(w * h);
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
    let ii, jj;
    if (q === 1) { ii = f.h - 1 - j; jj = i; } else if (q === 2) { ii = f.w - 1 - i; jj = f.h - 1 - j; } else { ii = j; jj = f.w - 1 - i; }
    data[jj * w + ii] = f.data[j * f.w + i];
    mask[jj * w + ii] = f.mask[j * f.w + i];
  }
  return { w, h, data, mask };
}

/** Bilinear value and nearest mask at (u, v) ∈ [0,1]² (v up). */
export function sampleFigure(f, u, v) {
  const x = u * f.w - 0.5, y = v * f.h - 0.5;
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const at = (a, b) => (a < 0 || b < 0 || a >= f.w || b >= f.h ? 0 : f.data[b * f.w + a]);
  const val = at(i, j) * (1 - fx) * (1 - fy) + at(i + 1, j) * fx * (1 - fy) + at(i, j + 1) * (1 - fx) * fy + at(i + 1, j + 1) * fx * fy;
  const mi = Math.round(x), mj = Math.round(y);
  const m = mi >= 0 && mj >= 0 && mi < f.w && mj < f.h ? f.mask[mj * f.w + mi] : 0;
  return { val, m };
}
