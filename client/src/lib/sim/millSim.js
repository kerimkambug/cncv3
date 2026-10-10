// Material-removal simulation of a 3-axis program on a height map.
//
// The stock is a grid of columns (cell × cell) whose height starts at the
// material top. Every move of the program is swept with the real shape of the
// tool loaded at that moment: wherever the tool passes, each column is cut down
// to the tool's lower surface there. What is left is the part as the machine
// will make it — ridges, scallops, steps and gouges included.
import { parseGcode } from '../gcode/gcodeToDxf.js';

/** The workshop's tools (see the tool table): profile type and size. */
export const TOOL_TABLE = {
  // V bits: the cone keeps widening at the same angle up the whole cutting length
  1: { type: 'v', dia: 60, angle: 90, name: 'T1 90° V' },
  2: { type: 'ball', dia: 10, name: 'T2 Ø10 küre' },
  3: { type: 'roundover', dia: 14.5, name: 'T3 sivri yuvarlama' },
  4: { type: 'flat', dia: 4, name: 'T4 Ø4 düz' },
  // point-cutting roundover bits: concave quarter-round flank; T5 has a ~1 mm flat at the tip
  5: { type: 'roundover', dia: 14.5, flat: 1, name: 'T5 düz uçlu yuvarlama' },
  6: { type: 'flat', dia: 6, name: 'T6 Ø6 düz' },
  7: { type: 'ball', dia: 30, name: 'T7 Ø30 küre' },
  8: { type: 'flat', dia: 8, name: 'T8 Ø8 düz' },
  9: { type: 'flat', dia: 22, name: 'T9 tabla bıçağı' },
  10: { type: 'flat', dia: 10, name: 'T10 Ø10 düz' },
  11: { type: 'flat', dia: 10, name: 'T11 kulp' },
  12: { type: 'v', dia: 80, angle: 135, name: 'T12 135° V' },
  13: { type: 'ball', dia: 6, name: 'T13 rölyef' },
  14: { type: 'taper', dia: 12, tipDia: 2, angle: 8.8, name: 'T14 konik (panjur)' },
};

/** Height of the tool's lower surface above its tip, at distance d from its axis (Infinity outside it). */
export function profile(tool, d) {
  const R = tool.dia / 2;
  if (d > R) return Infinity;
  switch (tool.type) {
    case 'ball': return R - Math.sqrt(Math.max(0, R * R - d * d));
    case 'v': return d / Math.tan(((tool.angle || 90) / 2) * Math.PI / 180);
    // tapered ball: round tip of tipDia, then a cone of included angle `angle`
    case 'taper': {
      const r = (tool.tipDia || 2) / 2;
      if (d <= r) return r - Math.sqrt(Math.max(0, r * r - d * d));
      return r + (d - r) / Math.tan(((tool.angle || 10) / 2) * Math.PI / 180);
    }
    // roundover: quarter-round flank starting at the tip (sharp, or a small flat of `flat` mm)
    case 'roundover': {
      const f = (tool.flat || 0) / 2, Rr = R - f;
      if (d <= f) return 0;
      const u = d - f;
      return Math.sqrt(Math.max(0, Rr * Rr - (Rr - u) * (Rr - u)));
    }
    default: return 0; // flat end mill
  }
}

/** Distance from the axis where the tool's lower surface rises `depth` above its tip (≤ its radius). */
function reach(tool, depth) {
  const Rmax = tool.dia / 2;
  if (!(depth > 0)) return 0;
  if (profile(tool, Rmax) <= depth) return Rmax;
  let lo = 0, hi = Rmax;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (profile(tool, m) <= depth) lo = m; else hi = m; }
  return hi;
}

/** Profile as a lookup table over d² (no sqrt / trig per cell): fast and accurate to ~0.001 mm. */
function profileTable(tool) {
  const R = tool.dia / 2, R2 = R * R, N = 4096;
  const t = new Float32Array(N + 2);
  for (let k = 0; k <= N + 1; k++) t[k] = profile(tool, Math.sqrt(Math.min(1, k / N) * R2));
  const s = N / R2;
  return (d2) => { const f = d2 * s, k = f | 0; return k >= N ? (k === N ? t[N] : Infinity) : t[k] + (t[k + 1] - t[k]) * (f - k); };
}

/**
 * @param {string} text  G-code
 * @param {object} o
 * @param {number} o.top        material top (Z)
 * @param {number} [o.cell=0.4] grid size (mm)
 * @param {object} [o.tools]    tool table override
 * @param {{x0,y0,x1,y1}} [o.box] stock area (default: everything the tools touch)
 * @returns {{grid, stats}}
 */
export function simulate(text, { top, cell = 0.4, tools = {}, box = null } = {}) {
  tools = { ...TOOL_TABLE, ...tools };
  const segs = parseGcode(text, { includeRapids: true }).segments;
  const toolOf = (t) => tools[Number(t)] || { type: 'flat', dia: 6, name: `T${t} (tabloda yok)` };
  // stock area
  let b = box;
  if (!b) {
    b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const s of segs) {
      if (Math.min(s.from.z, s.to.z) >= top) continue;
      const R = toolOf(s.tool).dia / 2;
      b.x0 = Math.min(b.x0, s.from.x - R, s.to.x - R); b.x1 = Math.max(b.x1, s.from.x + R, s.to.x + R);
      b.y0 = Math.min(b.y0, s.from.y - R, s.to.y - R); b.y1 = Math.max(b.y1, s.from.y + R, s.to.y + R);
    }
    b = { x0: b.x0 - 5, y0: b.y0 - 5, x1: b.x1 + 5, y1: b.y1 + 5 };
  }
  const w = Math.ceil((b.x1 - b.x0) / cell), h = Math.ceil((b.y1 - b.y0) / cell);
  const z = new Float32Array(w * h).fill(top);
  const stats = { cuttingMm: 0, rapidCuts: 0, belowTable: 0, byTool: {} };
  let started = false;
  const tables = new Map();
  for (const s of segs) {
    // the first move starts from an unknown position (the parser assumes 0,0,0): not a cut
    if (!started) { started = true; if (!s.from.x && !s.from.y && !s.from.z) continue; }
    const zMin = Math.min(s.from.z, s.to.z);
    if (zMin >= top) continue; // in the air
    const tool = toolOf(s.tool);
    if (!tables.has(tool)) tables.set(tool, profileTable(tool));
    const hOf = tables.get(tool);
    if (s.type === 'G0') stats.rapidCuts++;
    if (zMin < 0) stats.belowTable++;
    const L = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y, s.to.z - s.from.z);
    stats.cuttingMm += L;
    const key = tool.name;
    stats.byTool[key] = (stats.byTool[key] || 0) + L;
    // Swept cut: the move is split into pieces (one piece when Z is constant, 1 mm pieces
    // when it changes); every column near a piece is cut once, by the tool at the point of
    // the piece closest to it — exact for level moves, within hundredths on sloped ones.
    // only the part of the tool that reaches below the material top can cut: for a long
    // V cone that is far less than its full width (keeps the sweep fast)
    const zLow = Math.min(s.from.z, s.to.z);
    const R = reach(tool, top - zLow) + cell, R2 = R * R;
    const dzTotal = Math.abs(s.to.z - s.from.z);
    const lenXY = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
    const pieces = dzTotal < 1e-6 ? 1 : Math.max(1, Math.ceil(Math.max(lenXY, dzTotal) / Math.max(cell, 0.5)));
    for (let p = 0; p < pieces; p++) {
      const t0 = p / pieces, t1 = (p + 1) / pieces;
      const ax = s.from.x + (s.to.x - s.from.x) * t0, ay = s.from.y + (s.to.y - s.from.y) * t0, az = s.from.z + (s.to.z - s.from.z) * t0;
      const bx = s.from.x + (s.to.x - s.from.x) * t1, by = s.from.y + (s.to.y - s.from.y) * t1, bz = s.from.z + (s.to.z - s.from.z) * t1;
      if (Math.min(az, bz) >= top) continue;
      const ux = bx - ax, uy = by - ay, uu = ux * ux + uy * uy;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - b.x0) / cell)), i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + R - b.x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - R - b.y0) / cell)), j1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) + R - b.y0) / cell));
      for (let j = j0; j <= j1; j++) {
        const py = b.y0 + (j + 0.5) * cell - ay;
        for (let i = i0; i <= i1; i++) {
          const px = b.x0 + (i + 0.5) * cell - ax;
          let t = uu > 0 ? (px * ux + py * uy) / uu : 0;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const dx = px - ux * t, dy = py - uy * t, d2 = dx * dx + dy * dy;
          if (d2 > R2) continue;
          const v = az + (bz - az) * t + hOf(d2);
          const idx = j * w + i;
          if (v < z[idx]) z[idx] = v;
        }
      }
    }
  }
  for (let k = 0; k < z.length; k++) if (z[k] < 0) z[k] = 0; // the table
  return { grid: { x0: b.x0, y0: b.y0, w, h, cell, z }, stats };
}

/** Binary STL of the simulated stock (top surface, sides, bottom), resampled to `stlCell`. */
export function gridToStl(grid, stlCell = 0.8) {
  const f = Math.max(1, Math.ceil(stlCell / grid.cell - 1e-9));
  const W = Math.floor(grid.w / f), H = Math.floor(grid.h / f);
  const c = grid.cell * f;
  const hz = (i, j) => {
    // average of the block (keeps edges honest without spikes)
    let s = 0, n = 0;
    for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) { const ii = i * f + a, jj = j * f + b; if (ii < grid.w && jj < grid.h) { s += grid.z[jj * grid.w + ii]; n++; } }
    return n ? s / n : 0;
  };
  const Z = new Float32Array((W + 1) * (H + 1));
  for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) Z[j * (W + 1) + i] = hz(Math.min(W - 1, i), Math.min(H - 1, j));
  const X = (i) => grid.x0 + i * c, Y = (j) => grid.y0 + j * c;
  const tris = 2 * W * H + 4 * (W + H) + 2;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris, true);
  let o = 84;
  const tri = (a, b2, d) => {
    const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    for (const v of [nx, ny, nz, ...a, ...b2, ...d]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  };
  const P = (i, j) => [X(i), Y(j), Z[j * (W + 1) + i]];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const a = P(i, j), b2 = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
    tri(a, b2, cc); tri(a, cc, d);
  }
  // sides down to Z0 and the bottom
  const B = (i, j) => [X(i), Y(j), 0];
  for (let i = 0; i < W; i++) { tri(B(i, 0), B(i + 1, 0), P(i + 1, 0)); tri(B(i, 0), P(i + 1, 0), P(i, 0)); tri(B(i + 1, H), B(i, H), P(i, H)); tri(B(i + 1, H), P(i, H), P(i + 1, H)); }
  for (let j = 0; j < H; j++) { tri(B(0, j + 1), B(0, j), P(0, j)); tri(B(0, j + 1), P(0, j), P(0, j + 1)); tri(B(W, j), B(W, j + 1), P(W, j + 1)); tri(B(W, j), P(W, j + 1), P(W, j)); }
  tri(B(0, 0), B(W, H), B(W, 0)); tri(B(0, 0), B(0, H), B(W, H));
  return buf;
}
