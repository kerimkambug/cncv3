// A DXF logo V carved into the flat top of a figure tray, at tray size (the
// drawing shrinks to ~150–200 mm, so its strokes are 1–2 mm wide). Of the styles
// tried (flat-bit pockets, raised logo on a pocketed background, textured
// floors, 135° V, hatching…) this is the one that came out clean.
//
// V carving "from the centre": the V bit follows inset rings of each drawn
// area, each at depth = inset / tan(angle/2), so every stroke is cut exactly to
// its outline at the surface; narrow strokes are shallow and sharp, wide ones
// deeper, up to `maxDepth`. Beyond that the floor is flat: a flat end mill
// clears it where it fits and the V bit finishes the strip along the walls. A
// centre-line pass at the exact depth takes the ridge the rings leave.
//
// Passes are [[x, y, depth]...] in the part's coordinates, depth below the top.
import { bbox, evenOddShapes, offset, simplifyLoop } from './geom.js';
import { edt, makeGrid, maskPolys } from './surface.js';
import { simplify3, thin, traceSkeleton } from './textCarve.js';

export const FLAT_BITS = [[4, 4], [6, 6], [8, 8], [10, 10]]; // [slot, Ø]

export const LOGO_DEFAULTS = {
  tool: 1, angle: 90, // V bit (a wider angle loses the fine strokes at tray size)
  maxDepth: 3, // deepest point (flat floor beyond)
  ringStep: 0.3, // inset between wall rings (the centre-line pass takes the ridge they leave)
  floorStep: 0.4, // V rings on the flat floor
  flatClear: true, flatTool: 4, flatDia: 4, // flat end mill for wide floors
};

const NUMERIC = ['maxDepth', 'ringStep', 'floorStep', 'flatDia', 'angle'];
const cot = (deg) => 1 / Math.tan(((deg / 2) * Math.PI) / 180);
const closedPass = (loop, d) => { const l = simplifyLoop(loop, 0.01); return [...l, l[0]].map(([x, y]) => [x, y, d]); };
const shapeLoops = (shs) => shs.flatMap((s) => [s.outer, ...s.holes]);

/** Nearest-neighbour order of passes (each may be reversed if open). */
function orderPasses(passes) {
  const left = passes.slice();
  const out = [];
  let at = [0, 0];
  while (left.length) {
    let bi = 0, bd = Infinity, rev = false;
    for (let i = 0; i < left.length; i++) {
      const p = left[i], a = p[0], b = p[p.length - 1];
      const da = (a[0] - at[0]) ** 2 + (a[1] - at[1]) ** 2;
      if (da < bd) { bd = da; bi = i; rev = false; }
      const closed = a[0] === b[0] && a[1] === b[1];
      if (!closed) { const db = (b[0] - at[0]) ** 2 + (b[1] - at[1]) ** 2; if (db < bd) { bd = db; bi = i; rev = true; } }
    }
    const p = left.splice(bi, 1)[0];
    const q = rev ? p.slice().reverse() : p;
    out.push(q);
    at = q[q.length - 1];
  }
  return out;
}

/**
 * Centre lines of the region (its medial axis where it is narrower than the
 * flat floor), each point at the depth that puts both V flanks on the outline:
 * the pass that finishes the bottom of every groove the wall rings leave.
 */
function centreLines(regions, o, k) {
  const loops = shapeLoops(regions);
  const b = bbox(loops);
  const c = Math.max(0.08, Math.sqrt((b.w * b.h) / 3.5e6)); // keeps the grid under ~3.5 M cells
  const g = makeGrid(b.minX - 2 * c, b.minY - 2 * c, Math.ceil(b.w / c) + 4, Math.ceil(b.h / c) + 4, c);
  const m = maskPolys(g, loops);
  const d = edt(m, g.w, g.h);
  const capCells = o.maxDepth / k / c;
  // the region thinned to its centre lines (as the V-carved text does); stretches
  // over the flat floor are left out, the floor rings cover them
  const sk = thin(m, g.w, g.h);
  for (let q = 0; q < sk.length; q++) if (sk[q] && d[q] - 0.5 > capCells + 1) sk[q] = 0;
  const toPt = (q) => {
    const i = q % g.w, j = (q / g.w) | 0;
    return [g.x0 + (i + 0.5) * c, g.y0 + (j + 0.5) * c, Math.min(o.maxDepth, Math.max(0.02, (d[q] - 0.5) * c * k))];
  };
  const len = (p) => p.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
  return traceSkeleton(sk, g.w, g.h)
    .filter((path) => path.length >= 2)
    .map((path) => simplify3(path.map(toPt), 0.02))
    .filter((p) => len(p) >= 0.4); // specks: the rings already cut them
}

function vcarve(regions, o) {
  const k = cot(o.angle); // depth per mm of inset
  const capInset = o.maxDepth / k;
  const vPasses = [], clearPasses = [];
  const r = o.flatDia / 2;
  for (const sh of regions) {
    const loops = [sh.outer, ...sh.holes];
    const rings = [];
    // walls: inset rings, each at the depth that puts the V flank on the outline
    for (let s = o.ringStep; s < capInset + 1e-9; s += o.ringStep) {
      const ring = offset(loops, -s, { keepOrientation: true, arcTol: 0.01 });
      if (!ring.length) break;
      for (const l of ring) rings.push(closedPass(l, Math.min(o.maxDepth, s * k)));
    }
    // flat floor at maxDepth
    const floorReach = o.flatClear ? capInset + r + o.floorStep : Infinity;
    for (let s = capInset + o.floorStep; s < floorReach; s += o.floorStep) {
      const ring = offset(loops, -s, { keepOrientation: true, arcTol: 0.02 });
      if (!ring.length) break;
      for (const l of ring) rings.push(closedPass(l, o.maxDepth));
    }
    // rings around a speck are too small to matter (the centre line covers them)
    vPasses.push(...rings.filter((p) => p.length > 3 && p.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0) >= 0.5));
    if (o.flatClear) {
      let cur = offset(loops, -(capInset + r), { keepOrientation: true, arcTol: 0.05 });
      const step = 0.45 * o.flatDia;
      const levels = [];
      for (let d = 3; d < o.maxDepth - 1e-6; d += 3) levels.push(d);
      levels.push(o.maxDepth);
      const rr = [];
      while (cur.length && rr.length < 2000) { rr.push(cur); cur = offset(cur, -step, { keepOrientation: true, arcTol: 0.1 }); }
      // inside out at every level
      for (const d of levels) for (let i = rr.length - 1; i >= 0; i--) for (const l of rr[i]) clearPasses.push(closedPass(l, d));
    }
  }
  vPasses.push(...orderPasses(centreLines(regions, o, k)));
  return { vPasses, clearPasses };
}

/**
 * The V carving of a logo.
 * @param {number[][][]} loops  the logo's closed outlines (filled even-odd), part coordinates
 * @returns {{ ops: {kind, tool, passes}[], regions, maxDepth: number, opts }}
 */
export function logoCarve(loops, opts = {}) {
  const o = { ...LOGO_DEFAULTS, ...opts };
  for (const k of NUMERIC) o[k] = Number(o[k]) || LOGO_DEFAULTS[k];
  o.ringStep = Math.max(0.03, o.ringStep);
  o.floorStep = Math.max(0.1, o.floorStep);
  const regions = evenOddShapes(loops);
  const ops = [];
  if (!regions.length) return { ops, regions, maxDepth: 0, opts: o };
  const { vPasses, clearPasses } = vcarve(regions, o);
  if (clearPasses.length) ops.push({ kind: 'logoClear', tool: Number(o.flatTool), passes: orderPasses(clearPasses) });
  if (vPasses.length) ops.push({ kind: 'logo', tool: Number(o.tool), passes: vPasses });
  let maxDepth = 0;
  for (const op of ops) for (const p of op.passes) for (const q of p) if (q[2] > maxDepth) maxDepth = q[2];
  return { ops, regions, maxDepth, opts: o };
}

/** Depth the carving leaves on a grid (for the preview): min(maxDepth, distance to the outline × cot). */
export function logoDepth(g, carve) {
  const out = new Float32Array(g.w * g.h);
  if (!carve.regions.length) return out;
  const k = cot(carve.opts.angle);
  const m = maskPolys(g, shapeLoops(carve.regions));
  const d = edt(m, g.w, g.h);
  for (let i = 0; i < out.length; i++) if (m[i]) out[i] = Math.min(carve.opts.maxDepth, (d[i] - 0.5) * g.cell * k + g.cell * k * 0.5);
  return out;
}
