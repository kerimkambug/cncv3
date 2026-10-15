// 2D carving styles for a DXF logo on the flat top of a figure tray. The logo
// stays at the material surface; the tool carves into it.
//
// Flat end mill styles (Serbest Kesim's pocket logic: the bit's centre runs its
// radius inside the outline, islands stay standing):
//   cep       — pocket, offset rings inside out
//   cepZigzag — pocket, parallel passes plus one ring along the wall
//   cepDoku   — pocket, then a V pattern cut into its floor
//   cepPah    — pocket, then a V bevel along its top edge (sharp corners)
//   hat       — the bit's centre on every line: a channel one bit wide
// With `corners`, what the flat bit cannot reach (strokes narrower than it,
// inside corners) is V carved down to the pocket floor.
//
// V bit styles:
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
import { area, bbox, clipLines, differenceOriented, evenOddShapes, offset, pathLength, simplifyLoop, union } from './geom.js';
import { edt, makeGrid, maskPolys } from './surface.js';
import { simplify3, thin, traceSkeleton } from './textCarve.js';
import { levels, ringPasses } from './toolpaths.js';

export const LOGO_STYLES = [
  ['cep', 'Düz cep · offset halkalar (Serbest Kesim gibi)'],
  ['cepZigzag', 'Düz cep · paralel tarama'],
  ['cepDoku', 'Düz cep + desenli taban (V)'],
  ['cepPah', 'Düz cep + V pah (keskin kenar)'],
  ['hat', 'Çizgi üstü kanal (düz bıçak)'],
  ['vcarve', 'V oyma (merkezden, derinlik çizgi enine göre)'],
  ['kontur', 'Çizgi takibi (tek V geçiş)'],
  ['tarama', 'V tarama'],
  ['kabartma', '3D kabartma (rölyef bıçağı)'],
];

/** Styles cut mainly with the flat end mill. */
export const FLAT_STYLES = ['cep', 'cepZigzag', 'cepDoku', 'cepPah', 'hat'];

export const FLAT_BITS = [[4, 4], [6, 6], [8, 8], [10, 10]]; // [slot, Ø]

export const HATCH_PATTERNS = [
  ['bant', 'Bant: dış hattan içteki hatta dik çizgiler'],
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
  flatClear: true, flatTool: 4, flatDia: 4, // flat end mill (pockets, wide V-carving floors)
  cepDepth: 3, stepdown: 3, stepoverPct: 45, // flat pockets
  zigAngle: 0, // parallel pocket direction
  corners: true, // V bit takes what the flat bit cannot reach
  chamfer: 1, // cepPah: V bevel depth on the top edge
  lineDepth: 1, // kontur / tarama
  hatch: 'bant', hatchStep: 3, hatchAngle: 45, outline: true,
  toCentre: false, // band hatching: shapes with no inner line hatched towards their centre (stars…)
  islandGap: 1, // band hatching: clear margin around islands in the band (letters stay readable)
};

const NUMERIC = ['maxDepth', 'ringStep', 'floorStep', 'flatDia', 'lineDepth', 'hatchStep', 'angle', 'cepDepth', 'stepdown', 'stepoverPct', 'chamfer'];
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

/** First crossing of the ray p + t·u (t > 0) with a loop, or Infinity. */
function rayHit(p, u, loop) {
  let best = Infinity;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[j], b = loop[i];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = u[0] * ey - u[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = a[0] - p[0], wy = a[1] - p[1];
    const t = (wx * ey - wy * ex) / den, sgm = (wx * u[1] - wy * u[0]) / den;
    if (t > 1e-6 && sgm >= 0 && sgm <= 1 && t < best) best = t;
  }
  return best;
}

/**
 * Band hatching: every region is the band between an outline and the line
 * inside it (its large holes). From points `step` apart along the outline a
 * line runs inwards, square to it, up to that inner line; small islands in
 * the band (letters…) interrupt it. A region with no inner line is hatched
 * from its outline towards its centre.
 */
function bandLines(regions, o) {
  const out = [];
  const step = Math.max(0.3, o.hatchStep);
  for (const sh of regions) {
    const outerA = area(sh.outer);
    const inner = sh.holes.filter((h) => area(h) > 0.05 * outerA); // the inner line(s); smaller holes are islands
    const islands = sh.holes.filter((h) => area(h) <= 0.05 * outerA);
    if (!inner.length && !o.toCentre) continue; // only the band between two lines is hatched
    const ob = bbox([sh.outer]);
    const centre = [(ob.minX + ob.maxX) / 2, (ob.minY + ob.maxY) / 2];
    const loop = simplifyLoop(sh.outer, 0.05);
    const L = pathLength(loop);
    const n = Math.max(3, Math.round(L / step));
    // points along the outline, and the outline's direction smoothed over ±1.5 steps
    const cum = [0];
    for (let i = 1; i <= loop.length; i++) cum.push(cum[i - 1] + Math.hypot(loop[i % loop.length][0] - loop[i - 1][0], loop[i % loop.length][1] - loop[i - 1][1]));
    const at = (s) => {
      s = ((s % L) + L) % L;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const a = loop[i - 1], b = loop[i % loop.length], t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    const segs = [];
    for (let k = 0; k < n; k++) {
      const s = (k * L) / n;
      const p = at(s), q0 = at(s - 1.5 * step), q1 = at(s + 1.5 * step);
      const tx = q1[0] - q0[0], ty = q1[1] - q0[1], tl = Math.hypot(tx, ty) || 1;
      let u = [-ty / tl, tx / tl]; // left of a CCW outline = inwards
      let reach;
      if (inner.length) {
        reach = Math.min(...inner.map((h) => rayHit(p, u, h)));
        if (!Number.isFinite(reach)) continue;
      } else {
        u = [centre[0] - p[0], centre[1] - p[1]];
        reach = Math.hypot(u[0], u[1]);
        u = [u[0] / reach, u[1] / reach];
      }
      segs.push([[p[0] - u[0] * 0.05, p[1] - u[1] * 0.05], [p[0] + u[0] * (reach + 0.05), p[1] + u[1] * (reach + 0.05)]]);
    }
    // islands (letters…) keep a clear margin; the outer and inner lines are met exactly
    const gap = Math.max(0, Number(o.islandGap) || 0);
    const grown = gap && islands.length ? offset(islands.map((h) => h.slice().reverse()), gap, { keepOrientation: true }) : islands.map((h) => h.slice().reverse());
    const clip = shapeLoops(differenceOriented([sh.outer, ...inner], grown));
    out.push(...clipLines(segs, clip));
  }
  return out;
}

function hatchLines(regions, o) {
  if (o.hatch === 'bant') return bandLines(regions, o);
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
 * Flat end mill pocket of every region, Serbest Kesim's way: the bit's centre
 * runs `r` inside the outline (islands stay standing), rings inside out — or,
 * with `zigzag`, parallel passes and one ring along the wall at each level.
 * `residual` = what the bit cannot reach (strokes narrower than it, inside corners).
 */
function flatPocket(regions, o, zigzag) {
  const r = o.flatDia / 2;
  const step = Math.max(0.2, (o.stepoverPct / 100) * o.flatDia);
  const zs = levels(o.cepDepth, o.stepdown);
  const passes = [];
  const reached = [];
  let skipped = 0;
  for (const sh of regions) {
    const inset = offset([sh.outer, ...sh.holes], -r, { keepOrientation: true, arcTol: 0.05 });
    if (!inset.length) { skipped++; continue; }
    reached.push(...offset(inset, r, { keepOrientation: true, arcTol: 0.02 }));
    if (!zigzag) {
      const rings = [];
      let cur = inset;
      while (cur.length && rings.length < 4000) { rings.push(cur); cur = offset(cur, -step, { keepOrientation: true, arcTol: 0.1 }); }
      for (const z of zs) passes.push(...ringPasses(rings, z, step, true));
    } else {
      const b = bbox(inset);
      const a = (o.zigAngle * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, R = Math.hypot(b.w, b.h) / 2 + step;
      const lines = [];
      let flip = false;
      for (let t = -R + step / 2; t <= R; t += step) {
        const px = cx - uy * t, py = cy + ux * t;
        const l = [[px - ux * R, py - uy * R], [px + ux * R, py + uy * R]];
        lines.push(flip ? l.reverse() : l);
        flip = !flip;
      }
      const segs = clipLines(lines, inset);
      for (const z of zs) {
        for (const sgm of segs) passes.push(sgm.map(([x, y]) => [x, y, z]));
        for (const l of inset) passes.push(closedPass(l, z)); // the wall, cleanly
      }
    }
  }
  const residual = differenceOriented(shapeLoops(regions), reached).filter((sh) => area(sh.outer) > 0.3);
  return { passes, skipped, residual };
}

/**
 * The carving of a logo.
 * @param {number[][][]} loops  the logo's closed outlines, part coordinates
 * @param {string} style  see LOGO_STYLES (all but 'kabartma')
 * @returns {{ ops: {kind, tool, passes}[], regions, warnings: string[], maxDepth: number }}
 */
export function logoCarve(loops, style, opts = {}) {
  const o = { ...LOGO_DEFAULTS, ...opts };
  for (const k of NUMERIC) o[k] = Number(o[k]) || LOGO_DEFAULTS[k];
  for (const k of ['hatchAngle', 'zigAngle']) o[k] = Number.isFinite(Number(o[k])) && o[k] !== '' ? Number(o[k]) : LOGO_DEFAULTS[k];
  o.ringStep = Math.max(0.03, o.ringStep);
  o.floorStep = Math.max(0.1, o.floorStep);
  const regions = logoRegions(loops, o.fill);
  const warnings = [];
  const ops = [];
  const preview = []; // what the preview stamps: see logoDepth
  if (!regions.length) return { ops, regions, preview, warnings: ['Oyulacak alan bulunamadı.'], maxDepth: 0, opts: o };
  const r = o.flatDia / 2;
  const flatOp = (passes) => { if (passes.length) { ops.push({ kind: 'logoClear', tool: Number(o.flatTool), passes }); preview.push({ type: 'flat', r, passes }); } };
  const vOp = (passes) => { if (passes.length) { ops.push({ kind: 'logo', tool: Number(o.tool), passes }); preview.push({ type: 'v', angle: o.angle, passes }); } };

  if (FLAT_STYLES.includes(style)) {
    const D = o.cepDepth;
    if (style === 'hat') {
      // the flat bit's centre on every line: a channel one bit wide
      const passes = [];
      for (const sh of regions) for (const l of [sh.outer, ...sh.holes]) for (const d of levels(D, o.stepdown)) passes.push(closedPass(l, d));
      flatOp(orderPasses(passes));
    } else {
      const pk = flatPocket(regions, o, style === 'cepZigzag');
      flatOp(pk.passes);
      if (pk.skipped) warnings.push(`${pk.skipped} bölge T${o.flatTool} Ø${o.flatDia} için çok dar${o.corners ? '; V bıçak oyuyor' : ', atlandı'}.`);
      const v = [];
      if (o.corners && pk.residual.length) {
        // what the flat bit cannot reach (narrow strokes, inside corners): V carved down to the pocket floor
        const vc = vcarve(pk.residual, { ...o, maxDepth: D, flatClear: false });
        v.push(...vc.vPasses);
        preview.push({ type: 'vexact', regions: pk.residual, maxDepth: D, angle: o.angle });
      }
      if (style === 'cepPah') {
        // V along the pocket's top edge: a bevel round the logo and sharp corners at the surface
        for (const sh of regions) for (const l of [sh.outer, ...sh.holes]) v.push(closedPass(l, o.chamfer));
      }
      if (style === 'cepDoku') {
        // pattern on the pocket floor: V lines `lineDepth` below it. The cone widens up to
        // the material top, so a line keeps that radius from the walls or it gouges them.
        const reach = (D + o.lineDepth) / cot(o.angle) + 0.2;
        const floor = differenceOriented(offset(shapeLoops(regions), -reach, { keepOrientation: true }), []);
        if (!floor.length) warnings.push(`Desen için taban yeterince geniş değil: duvardan ${reach.toFixed(1)} mm uzak kalması gerekiyor.`);
        const lines = o.hatch === 'kontur'
          ? floor.flatMap((sh) => { const out = []; for (let s2 = o.hatchStep; ; s2 += o.hatchStep) { const ring = offset([sh.outer, ...sh.holes], -s2, { keepOrientation: true, arcTol: 0.02 }); if (!ring.length) break; out.push(...ring.map((l) => [...l, l[0]])); } return out; })
          : hatchLines(floor, { ...o, islandGap: 0 });
        for (const l of lines) v.push(l.map(([x, y]) => [x, y, D + o.lineDepth]));
      }
      vOp(orderPasses(v));
    }
  } else if (style === 'vcarve') {
    const { vPasses, clearPasses } = vcarve(regions, o);
    flatOp(orderPasses(clearPasses));
    if (vPasses.length) ops.push({ kind: 'logo', tool: Number(o.tool), passes: vPasses });
    preview.push({ type: 'vexact', regions, maxDepth: o.maxDepth, angle: o.angle });
  } else {
    const d = o.lineDepth;
    const passes = [];
    if (style === 'kontur') {
      for (const sh of regions) for (const l of [sh.outer, ...sh.holes]) passes.push(closedPass(l, d));
    } else {
      if (o.hatch === 'kontur') {
        for (const sh of regions) {
          for (let s2 = o.hatchStep; ; s2 += o.hatchStep) {
            const ring = offset([sh.outer, ...sh.holes], -s2, { keepOrientation: true, arcTol: 0.02 });
            if (!ring.length) break;
            for (const l of ring) passes.push(closedPass(l, d));
          }
        }
      } else {
        for (const l of hatchLines(regions, o)) passes.push(l.map(([x, y]) => [x, y, d]));
      }
      if (o.outline) for (const sh of regions) for (const l of [sh.outer, ...sh.holes]) passes.push(closedPass(l, d));
    }
    vOp(orderPasses(passes));
    const lineW = (2 * d) / cot(o.angle);
    if (style === 'tarama' && o.hatchStep <= lineW) warnings.push(`Tarama aralığı (${o.hatchStep} mm) V izinin eninden (${lineW.toFixed(1)} mm) dar: çizgiler birleşip düz bir yüzey olur.`);
  }
  let maxDepth = 0;
  for (const op of ops) for (const p of op.passes) for (const q of p) if (q[2] > maxDepth) maxDepth = q[2];
  return { ops, regions, preview, warnings, maxDepth, opts: o };
}

/**
 * Depth the carving leaves on a grid (for the preview): flat passes cut a disk
 * of the bit's radius, V passes their groove, V carving its exact surface
 * (min(depth, distance to the outline × cot)).
 */
export function logoDepth(g, carve) {
  const out = new Float32Array(g.w * g.h);
  const raise = (i, v) => { if (v > out[i]) out[i] = v; };
  for (const pv of carve.preview || []) {
    if (pv.type === 'vexact') {
      const k = cot(pv.angle);
      const m = maskPolys(g, shapeLoops(pv.regions));
      const d = edt(m, g.w, g.h);
      for (let i = 0; i < out.length; i++) if (m[i]) raise(i, Math.min(pv.maxDepth, (d[i] - 0.5) * g.cell * k + g.cell * k * 0.5));
      continue;
    }
    // passes grouped by depth: distance to the nearest pass of a group
    const groups = new Map();
    for (const p of pv.passes) {
      let dd = 0;
      for (const q of p) if (q[2] > dd) dd = q[2];
      const key = Math.round(dd * 20) / 20;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const k = pv.type === 'v' ? cot(pv.angle) : 0;
    for (const [dd, passes] of groups) {
      const free = new Uint8Array(g.w * g.h).fill(1);
      for (const p of passes) {
        for (let i = 1; i < p.length; i++) {
          const [x0, y0] = p[i - 1], [x1, y1] = p[i];
          const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (g.cell * 0.5)));
          for (let t = 0; t <= n; t++) {
            const ci = Math.floor((x0 + ((x1 - x0) * t) / n - g.x0) / g.cell), cj = Math.floor((y0 + ((y1 - y0) * t) / n - g.y0) / g.cell);
            if (ci >= 0 && cj >= 0 && ci < g.w && cj < g.h) free[cj * g.w + ci] = 0;
          }
        }
      }
      const dist = edt(free, g.w, g.h);
      for (let i = 0; i < out.length; i++) {
        const dmm = dist[i] * g.cell;
        if (pv.type === 'flat') { if (dmm <= pv.r) raise(i, dd); } else raise(i, Math.max(0, dd - dmm * k));
      }
    }
  }
  return out;
}
