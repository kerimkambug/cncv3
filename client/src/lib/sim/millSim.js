// Material-removal simulation of a 3-axis program on a height map.
//
// The stock is a grid of columns (cell × cell) whose height starts at the
// material top. Every move of the program is swept with the real shape of the
// tool loaded at that moment: wherever the tool passes, each column is cut down
// to the tool's lower surface there. What is left is the part as the machine
// will make it — ridges, scallops, steps and gouges included.
//
// Tools that are narrower higher up than lower down (a kulp bit, a T-slot
// cutter: drawn in Atölye → Bıçaklar) cut UNDER the surface: the material
// above their head stays. A column then also keeps a list of its hollow
// stretches (`grid.voids`: column index → [[from, to], …] below its top), and
// such a tool cuts with its full side view, height by height.
import { parseGcode } from '../gcode/gcodeToDxf.js';
import { dexelTriangles, trianglesToStl } from './dexelMesh.js';

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
    // drawn shape (kulp, tabla…): [[distance from axis, height above tip], …] by distance
    case 'custom': {
      const P = tool.profile;
      if (!P || !P.length) return 0;
      if (d >= P[P.length - 1][0]) return P[P.length - 1][1];
      let lo = 0, hi = P.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m][0] <= d) lo = m; else hi = m; }
      const [d0, h0] = P[lo], [d1, h1] = P[hi];
      return d1 > d0 ? h0 + ((h1 - h0) * (d - d0)) / (d1 - d0) : Math.min(h0, h1);
    }
    default: return 0; // flat end mill
  }
}

/** Distance from the axis where the tool's lower surface rises `depth` above its tip (≤ its radius). */
function reach(tool, depth) {
  const Rmax = tool.dia / 2;
  if (!(depth > 0)) return 0;
  if (tool.type === 'custom') return Rmax; // a drawn shape need not rise steadily outwards
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
 * The tool's side view as its radius at every height above the tip, from a drawn
 * outline (Atölye → Bıçaklar, DXF): the widest point of the drawing at that height.
 * Above the drawing the shank goes on with the drawing's top width.
 * @param {{pts:number[][],closed:boolean}[]} outline  axis at x=0, tip at y=0
 * @returns {{dh:number, r:Float32Array, rTop:number, undercut:boolean} | null}
 */
export function silhouette(outline, dh = 0.05) {
  const segs = [];
  let H = 0;
  for (const o of outline || []) {
    const n = o.pts.length;
    for (let i = 0; i + 1 < n; i++) segs.push([o.pts[i], o.pts[i + 1]]);
    if (o.closed && n > 2) segs.push([o.pts[n - 1], o.pts[0]]);
    for (const [, y] of o.pts) H = Math.max(H, y);
  }
  if (!segs.length || !(H > 0)) return null;
  const K = Math.ceil(H / dh);
  const r = new Float32Array(K + 1);
  for (let k = 0; k <= K; k++) {
    const y = Math.min(H, k * dh);
    let best = 0;
    for (const [[x0, y0], [x1, y1]] of segs) {
      if (y < Math.min(y0, y1) - 1e-9 || y > Math.max(y0, y1) + 1e-9) continue;
      if (Math.abs(y1 - y0) < 1e-9) { best = Math.max(best, Math.abs(x0), Math.abs(x1)); continue; }
      best = Math.max(best, Math.abs(x0 + ((x1 - x0) * (y - y0)) / (y1 - y0)));
    }
    r[k] = best;
  }
  // narrower higher up than somewhere below (more than a hair): the tool undercuts
  let widest = 0, undercut = false;
  for (let k = 0; k <= K; k++) { if (r[k] < widest - 0.05) undercut = true; widest = Math.max(widest, r[k]); }
  return { dh, r, rTop: r[K], undercut };
}

/**
 * For a tool that undercuts: at distance d from the axis, the heights above the tip
 * the tool fills, as [from, to] stretches (to = Infinity: up the shank).
 * Looked up by d in 0.02 mm steps.
 */
function undercutTable(sil, R) {
  const dd = 0.02, nb = Math.ceil(R / dd) + 1;
  const bins = new Array(nb);
  const { dh, r, rTop } = sil, K = r.length - 1;
  for (let b = 0; b < nb; b++) {
    const d = b * dd, list = [];
    let from = -1;
    for (let k = 0; k <= K; k++) {
      // a stretch runs from its first to its last sample inside the tool
      if (r[k] >= d) { if (from < 0) from = k; } else if (from >= 0) { list.push([from * dh, (k - 1) * dh]); from = -1; }
    }
    if (from >= 0) list.push([from * dh, rTop >= d ? Infinity : K * dh]);
    bins[b] = list;
  }
  return (d2) => { const b = Math.round(Math.sqrt(d2) / dd); return b < nb ? bins[b] : null; };
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
  const stats = { cuttingMm: 0, rapidCuts: 0, belowTable: 0, byTool: {}, emptySlots: [] };
  let started = false;
  const tables = new Map();
  // hollow stretches under the top of a column (only tools that undercut make them)
  const voids = new Map();
  // a column's top came down: a hollow it now reaches opens up (its floor becomes the top)
  const settle = (idx) => {
    const list = voids.get(idx);
    if (!list) return;
    while (list.length && list[list.length - 1][1] >= z[idx] - 1e-6) z[idx] = Math.min(z[idx], list.pop()[0]);
    if (!list.length) voids.delete(idx);
  };
  // the tool fills heights a…b of column idx
  const carve = (idx, a, b) => {
    if (a < 0) a = 0;
    if (a >= z[idx]) return;
    if (b >= z[idx]) { z[idx] = a; settle(idx); return; }
    const list = voids.get(idx) || [];
    let lo = a, hi = b;
    const kept = [];
    for (const v of list) {
      if (v[1] < lo - 1e-6 || v[0] > hi + 1e-6) kept.push(v);
      else { lo = Math.min(lo, v[0]); hi = Math.max(hi, v[1]); }
    }
    kept.push([lo, hi]);
    kept.sort((p, q) => p[0] - q[0]);
    voids.set(idx, kept);
    settle(idx);
  };
  for (const s of segs) {
    // the first move starts from an unknown position (the parser assumes 0,0,0): not a cut
    if (!started) { started = true; if (!s.from.x && !s.from.y && !s.from.z) continue; }
    const zMin = Math.min(s.from.z, s.to.z);
    if (zMin >= top) continue; // in the air
    const tool = toolOf(s.tool);
    if (!tables.has(tool)) {
      const sil = tool.type === 'custom' && tool.outline ? silhouette(tool.outline) : null;
      tables.set(tool, { hOf: profileTable(tool), fills: sil && sil.undercut ? undercutTable(sil, tool.dia / 2) : null });
    }
    const { hOf, fills } = tables.get(tool);
    if (s.type === 'G0') stats.rapidCuts++;
    if (zMin < 0) stats.belowTable++;
    const L = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y, s.to.z - s.from.z);
    stats.cuttingMm += L;
    const key = tool.name;
    if (tool.empty && !stats.emptySlots.includes(key)) stats.emptySlots.push(key);
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
          const idx = j * w + i;
          const zt = az + (bz - az) * t;
          if (fills) {
            // a tool that undercuts: every stretch of its side view at this distance
            const list = fills(d2);
            if (list) for (const [h0, h1] of list) carve(idx, zt + h0, zt + h1);
            continue;
          }
          const v = zt + hOf(d2);
          if (v < z[idx]) { z[idx] = v; if (voids.size) settle(idx); }
        }
      }
    }
  }
  for (let k = 0; k < z.length; k++) if (z[k] < 0) z[k] = 0; // the table
  const grid = { x0: b.x0, y0: b.y0, w, h, cell, z };
  if (voids.size) grid.voids = voids;
  return { grid, stats };
}

// a column at or below this height was cut through to the table
const THROUGH_Z = 0.02;

/** Binary STL of the simulated stock (top surface, sides, bottom), resampled to `stlCell`. */

export function gridToStl(grid, stlCell = 0.8) {
  const f = Math.max(1, Math.ceil(stlCell / grid.cell - 1e-9));
  // hollows under the surface: the part is built column by column (dexelMesh.js)
  if (grid.voids && grid.voids.size) return trianglesToStl(dexelTriangles(grid, f));
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
  // a cell cut through to the table (Z0 all round) is a hole: no top, no bottom
  const through = (i, j) => Z[j * (W + 1) + i] <= THROUGH_Z;
  const hole = (i, j) => through(i, j) && through(i + 1, j) && through(i, j + 1) && through(i + 1, j + 1);
  // the cells kept, and the bottom as runs of kept cells per row
  let kept = 0;
  const runs = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W;) {
      if (hole(i, j)) { i++; continue; }
      let k = i;
      while (k < W && !hole(k, j)) k++;
      runs.push([j, i, k]);
      kept += k - i;
      i = k;
    }
  }
  const total = 2 * kept + 4 * (W + H) + 2 * runs.length;
  const buf = new ArrayBuffer(84 + total * 50);
  const dv = new DataView(buf);
  let o = 84, tris = 0;
  const tri = (a, b2, d) => {
    const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    for (const v of [nx, ny, nz, ...a, ...b2, ...d]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
    tris++;
  };
  const P = (i, j) => [X(i), Y(j), Z[j * (W + 1) + i]];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (hole(i, j)) continue;
    const a = P(i, j), b2 = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
    tri(a, b2, cc); tri(a, cc, d);
  }
  // sides down to Z0
  const B = (i, j) => [X(i), Y(j), 0];
  for (let i = 0; i < W; i++) { tri(B(i, 0), B(i + 1, 0), P(i + 1, 0)); tri(B(i, 0), P(i + 1, 0), P(i, 0)); tri(B(i + 1, H), B(i, H), P(i, H)); tri(B(i + 1, H), P(i, H), P(i + 1, H)); }
  for (let j = 0; j < H; j++) { tri(B(0, j + 1), B(0, j), P(0, j)); tri(B(0, j + 1), P(0, j), P(0, j + 1)); tri(B(W, j), B(W, j + 1), P(W, j + 1)); tri(B(W, j), P(W, j + 1), P(W, j)); }
  // the bottom: one strip per row of cells, open where the part is cut through
  for (const [j, i, k] of runs) { tri(B(i, j), B(k, j + 1), B(k, j)); tri(B(i, j), B(i, j + 1), B(k, j + 1)); }
  dv.setUint32(80, tris, true);
  return buf;
}
