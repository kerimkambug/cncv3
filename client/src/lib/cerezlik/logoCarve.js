// 2D carving styles for a DXF logo on the flat top of a figure tray. The logo
// stays at the material surface; the tool carves into it.
//
//   vcarve  — V carving "from the centre": the V bit follows inset rings of the
//             region, each at depth = inset / tan(angle/2), so narrow strokes are
//             shallow and sharp, wide ones deeper, up to `maxDepth`. Beyond that
//             the floor is flat: a flat end mill clears it where it fits and the
//             V bit finishes the strip along the walls.
//   kontur  — single-line engraving: every outline once, at a fixed depth.
//   tarama  — the region is hatched with V grooves at a fixed depth: parallel,
//             cross, radial (sun rays from the centre), rings or offset contours,
//             with the outline traced around it.
//
// `fill` picks what is carved: 'koyu' = the drawn (filled) areas, 'acik' = the
// gaps inside the logo (letters cut out of a dark ring become V grooves).
//
// Passes are [[x, y, depth]...] in the part's coordinates, depth below the top.
import { bbox, clipLines, differenceOriented, evenOddShapes, offset, simplifyLoop, union } from './geom.js';
import { edt, makeGrid, maskPolys } from './surface.js';
import { simplify3, thin, traceSkeleton } from './textCarve.js';

export const LOGO_STYLES = [
  ['kabartma', '3D kabartma (rölyef bıçağı)'],
  ['vcarve', 'V oyma (merkezden, derinlik çizgi enine göre)'],
  ['kontur', 'Çizgi takibi (tek V geçiş)'],
  ['tarama', 'Tarama (V ile doku)'],
];

export const HATCH_PATTERNS = [
  ['paralel', 'Paralel çizgi'],
  ['capraz', 'Çapraz (ızgara)'],
  ['isinsal', 'Işınsal (merkezden güneş)'],
  ['halka', 'Eş merkezli halkalar'],
  ['kontur', 'Şekli izleyen konturlar'],
];

export const LOGO_DEFAULTS = {
  fill: 'koyu', // 'koyu' | 'acik'
  tool: 1, angle: 90, // V bit
  maxDepth: 3, // V carving: deepest point (flat floor beyond)
  ringStep: 0.3, // V carving: inset between wall rings (the centre-line pass takes the ridge they leave)
  floorStep: 0.4, // V rings on the flat floor
  flatClear: true, flatTool: 6, flatDia: 6, // flat end mill for wide floors
  lineDepth: 1, // kontur / tarama
  hatch: 'paralel', hatchStep: 3, hatchAngle: 45, outline: true,
};

const cot = (deg) => 1 / Math.tan(((deg / 2) * Math.PI) / 180);
const closedPass = (loop, d) => { const l = simplifyLoop(loop, 0.01); return [...l, l[0]].map(([x, y]) => [x, y, d]); };
const shapeLoops = (shs) => shs.flatMap((s) => [s.outer, ...s.holes]);

/** The region to carve, as shapes (outers CCW, holes CW). */
export function logoRegions(loops, fill = 'koyu') {
  const dark = evenOddShapes(loops);
  if (fill !== 'acik') return dark;
  // the gaps: inside the logo's outer silhouette, outside the drawn areas
  const hull = union(dark.map((s) => s.outer)).map((s) => s.outer);
  return differenceOriented(hull, shapeLoops(dark));
}

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
  // ridge cells: no 4-neighbour is a full cell further from the outline (off the
  // axis the distance grows by one cell per cell inwards), and above the flat floor
  const ridge = new Uint8Array(g.w * g.h);
  for (let j = 1; j < g.h - 1; j++) for (let i = 1; i < g.w - 1; i++) {
    const q = j * g.w + i;
    if (!m[q] || d[q] < 1 || d[q] - 0.5 > capCells + 1) continue;
    const up = Math.max(d[q + 1], d[q - 1], d[q + g.w], d[q - g.w]) - d[q];
    if (up < 0.75) ridge[q] = 1;
  }
  const sk = thin(ridge, g.w, g.h);
  const toPt = (q) => {
    const i = q % g.w, j = (q / g.w) | 0;
    return [g.x0 + (i + 0.5) * c, g.y0 + (j + 0.5) * c, Math.min(o.maxDepth, Math.max(0.02, (d[q] - 0.5) * c * k))];
  };
  return traceSkeleton(sk, g.w, g.h)
    .filter((path) => path.length >= 3)
    .map((path) => simplify3(path.map(toPt), 0.02));
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
    vPasses.push(...rings);
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

function hatchLines(regions, o) {
  const loops = shapeLoops(regions);
  const b = bbox(loops);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const R = Math.hypot(b.w, b.h) / 2 + o.hatchStep;
  const step = Math.max(0.3, o.hatchStep);
  const lines = [];
  const parallel = (deg) => {
    const a = (deg * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    let flip = false;
    for (let t = -R; t <= R; t += step) {
      const px = cx - uy * t, py = cy + ux * t;
      const l = [[px - ux * R, py - uy * R], [px + ux * R, py + uy * R]];
      lines.push(flip ? l.reverse() : l);
      flip = !flip;
    }
  };
  if (o.hatch === 'paralel') parallel(o.hatchAngle);
  else if (o.hatch === 'capraz') { parallel(o.hatchAngle); parallel(o.hatchAngle + 90); }
  else if (o.hatch === 'isinsal') {
    // rays `step` apart at half the radius; every other ray starts further out so the centre does not clog
    const n = Math.max(8, Math.round((Math.PI * R) / step));
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + (o.hatchAngle * Math.PI) / 180;
      const r0 = i % 4 === 0 ? 0 : i % 2 === 0 ? R * 0.15 : R * 0.3;
      lines.push([[cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)], [cx + R * Math.cos(a), cy + R * Math.sin(a)]]);
    }
  } else if (o.hatch === 'halka') {
    for (let rr = step / 2; rr <= R; rr += step) {
      const n = Math.max(24, Math.ceil((2 * Math.PI * rr) / 0.5));
      lines.push(Array.from({ length: n + 1 }, (_, i) => { const a = (2 * Math.PI * i) / n; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; }));
    }
  }
  return clipLines(lines, loops);
}

/**
 * The carving of a logo.
 * @param {number[][][]} loops  the logo's closed outlines, part coordinates
 * @param {object} style  'vcarve' | 'kontur' | 'tarama'
 * @returns {{ ops: {kind, tool, passes}[], regions, warnings: string[], maxDepth: number }}
 */
export function logoCarve(loops, style, opts = {}) {
  const o = { ...LOGO_DEFAULTS, ...opts };
  for (const k of ['maxDepth', 'ringStep', 'floorStep', 'flatDia', 'lineDepth', 'hatchStep', 'hatchAngle', 'angle']) o[k] = Number(o[k]) || LOGO_DEFAULTS[k];
  o.ringStep = Math.max(0.03, o.ringStep);
  o.floorStep = Math.max(0.1, o.floorStep);
  const regions = logoRegions(loops, o.fill);
  const warnings = [];
  const ops = [];
  let maxDepth = 0;
  if (!regions.length) return { ops, regions, warnings: ['Oyulacak alan bulunamadı.'], maxDepth };
  if (style === 'vcarve') {
    const { vPasses, clearPasses } = vcarve(regions, o);
    if (clearPasses.length) ops.push({ kind: 'logoClear', tool: Number(o.flatTool), passes: orderPasses(clearPasses) });
    ops.push({ kind: 'logo', tool: Number(o.tool), passes: vPasses });
    for (const p of vPasses) for (const q of p) if (q[2] > maxDepth) maxDepth = q[2];
  } else {
    const d = o.lineDepth;
    const passes = [];
    if (style === 'kontur') {
      for (const sh of regions) for (const l of [sh.outer, ...sh.holes]) passes.push(closedPass(l, d));
    } else {
      if (o.hatch === 'kontur') {
        for (const sh of regions) {
          for (let s = o.hatchStep; ; s += o.hatchStep) {
            const ring = offset([sh.outer, ...sh.holes], -s, { keepOrientation: true, arcTol: 0.02 });
            if (!ring.length) break;
            for (const l of ring) passes.push(closedPass(l, d));
          }
        }
      } else {
        for (const l of hatchLines(regions, o)) passes.push(l.map(([x, y]) => [x, y, d]));
      }
      if (o.outline) for (const sh of regions) for (const l of [sh.outer, ...sh.holes]) passes.push(closedPass(l, d));
    }
    ops.push({ kind: 'logo', tool: Number(o.tool), passes: orderPasses(passes) });
    maxDepth = d;
    const lineW = 2 * d / cot(o.angle);
    if (style === 'tarama' && o.hatchStep <= lineW) warnings.push(`Tarama aralığı (${o.hatchStep} mm) V izinin eninden (${lineW.toFixed(1)} mm) dar: çizgiler birleşip düz bir yüzey olur.`);
  }
  return { ops, regions, warnings, maxDepth, opts: o };
}

/**
 * Depth the carving leaves on a grid (for the preview): exact for V carving
 * (min(maxDepth, distance to the outline × cot)), and for lines the V groove
 * profile around them.
 */
export function logoDepth(g, carve, style) {
  const o = carve.opts || LOGO_DEFAULTS;
  const k = cot(o.angle);
  const out = new Float32Array(g.w * g.h);
  if (!carve.regions.length) return out;
  if (style === 'vcarve') {
    const m = maskPolys(g, shapeLoops(carve.regions));
    const d = edt(m, g.w, g.h);
    for (let i = 0; i < out.length; i++) if (m[i]) out[i] = Math.min(o.maxDepth, (d[i] - 0.5) * g.cell * k + g.cell * k * 0.5);
    return out;
  }
  // grooves: distance to the nearest pass
  const notLine = new Uint8Array(g.w * g.h).fill(1);
  const op = carve.ops.find((x) => x.kind === 'logo');
  for (const p of op ? op.passes : []) {
    for (let i = 1; i < p.length; i++) {
      const [x0, y0] = p[i - 1], [x1, y1] = p[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (g.cell * 0.5)));
      for (let t = 0; t <= n; t++) {
        const ci = Math.floor((x0 + ((x1 - x0) * t) / n - g.x0) / g.cell), cj = Math.floor((y0 + ((y1 - y0) * t) / n - g.y0) / g.cell);
        if (ci >= 0 && cj >= 0 && ci < g.w && cj < g.h) notLine[cj * g.w + ci] = 0;
      }
    }
  }
  const dist = edt(notLine, g.w, g.h);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, o.lineDepth - dist[i] * g.cell * k);
  return out;
}
