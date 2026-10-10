// Toolpaths of one part, in the part's own coordinates. Z is measured from the
// machine table (material top = thickness), as on the workshop's machine.
//
// Recipe order (tool by tool on the plate, see gcode.js):
//   1. pocket  — compartments cleared ring by ring, inside out, in depth steps
//   2. round   — T3 rounding: `gap` mm outside the outline / islands, `gap` mm
//                inside every compartment, so no step is left on the wall
//   3. groove  — ball-nose (T2) passes along a line: juice grooves, decorative
//                rings that run a little inside the edge
//   4. vline   — open drawing lines engraved with the V bit
//   5. cut     — through holes first, then the outline with holding tabs
//
// 3D parts (figure trays, part.surface) replace the pocket step with:
//   rough  — flat end mill (T10) z-level rings over the whole surface, leaving a skin
//   bowl   — large ball nose (T7) parallel finishing of the dished compartments
//   semi   — T2 ball nose over the figure (takes the load off the small bit)
//   relief — the small relief ball nose, figure only
import { offset, pathLength, signedArea, simplifyLoop } from './geom.js';
import { ballRaster, contourFinish, roughLevels, wallWaterline } from './surface.js';
import { dishPart } from './dish.js';

export const DEFAULT_RECIPE = {
  thickness: 18,
  // compartments: 'kase' = dished, made to fit the finishing ball (T10 floor + one T7 ring);
  // 'duz' = flat floor, vertical walls, cleared by the pocket bit
  bowlStyle: 'kase',
  spindle: 18000,
  safeAbove: 28, // rapid height above the material top
  clearAbove: 5, // short hop height between passes of the same part
  climb: true,
  minWall: 6,
  pocket: { tool: 6, dia: 6, depth: 10, stepdown: 5, stepoverPct: 45, feed: 5000, plunge: 2000 },
  round: { enabled: true, tool: 3, dia: 14.5, gap: 1, depth: 6, feed: 5000, plunge: 2000 },
  cut: { tool: 6, dia: 6, stepdown: 6, feed: 5000, plunge: 2000, tabs: 4, tabLen: 10, tabHeight: 2 },
  groove: { tool: 2, dia: 10, depth: 3, feed: 4000, plunge: 1500 },
  vline: { tool: 1, depth: 2, feed: 4000, plunge: 2000 },
  d3: {
    rough: { tool: 10, dia: 10, stepdown: 3, stepoverPct: 45, leave: 0.5, feed: 5000, plunge: 2000 },
    bowl: { tool: 7, dia: 30, stepover: 2, feed: 5000, plunge: 2000 },
    semi: { enabled: true, tool: 2, dia: 10, stepover: 1.2, leave: 2, feed: 4500, plunge: 1500 },
    relief: { tool: 13, dia: 6, stepover: 0.6, feed: 3500, plunge: 1000 },
  },
};

/** How far the tools reach outside a part's outline (drives the gap between parts). */
export function toolReach(recipe) {
  const cutR = (Number(recipe.cut.dia) || 0) / 2;
  const roundR = recipe.round.enabled ? (Number(recipe.round.gap) || 0) + (Number(recipe.round.dia) || 0) / 2 : 0;
  return Math.max(cutR, roundR);
}

const levels = (total, step) => {
  const out = [];
  const s = Math.max(0.1, Number(step) || total);
  for (let d = s; d < total - 1e-6; d += s) out.push(d);
  out.push(total);
  return out;
};

/** Orient a loop for the milling direction. materialInside: the kept material is inside the loop. */
function orient(loop, materialInside, climb) {
  const ccw = signedArea(loop) > 0;
  const wantCCW = climb ? materialInside : !materialInside; // CW spindle: climb = material on the left
  return ccw === wantCCW ? loop : loop.slice().reverse();
}

/** Rotate a closed loop so it starts at its point nearest to `from` (inserted on an edge if needed). */
function startNear(loop, from) {
  if (!from) return loop;
  let best = 0, bd = Infinity, bp = loop[0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((from[0] - a[0]) * dx + (from[1] - a[1]) * dy) / L)) : 0;
    const q = [a[0] + t * dx, a[1] + t * dy];
    const d = (q[0] - from[0]) ** 2 + (q[1] - from[1]) ** 2;
    if (d < bd) { bd = d; best = i; bp = t >= 1 ? b : q; }
  }
  const rest = loop.slice(best + 1).concat(loop.slice(0, best + 1));
  if (rest[0] === bp) return rest;
  return [bp, ...rest];
}

const close3 = (loop, z, tol = 0.01) => { const l = simplifyLoop(loop, tol); return [...l, l[0]].map(([x, y]) => [x, y, z]); };

/**
 * Compartment pocket: concentric rings from the centre outwards. Consecutive
 * rings closer than ~1 step are linked with a feed move instead of a lift.
 * Returns passes ([[x,y,z]...]); a pass is cut without lifting.
 */
function pocketPasses(comp, recipe) {
  const p = recipe.pocket;
  const r = (Number(p.dia) || 6) / 2;
  const step = Math.max(0.2, ((Number(p.stepoverPct) || 45) / 100) * 2 * r);
  const rings = [];
  let cur = offset([comp.pts, ...comp.islands], -r, { arcTol: 0.05 });
  while (cur.length && rings.length < 2000) {
    rings.push(cur);
    cur = offset(cur, -step, { keepOrientation: true, arcTol: 0.1 });
  }
  if (!rings.length) return [];
  const top = Number(recipe.thickness);
  const passes = [];
  for (const d of levels(Math.min(Number(comp.depth ?? p.depth) || 0, top), p.stepdown)) {
    passes.push(...ringPasses(rings, +(top - d).toFixed(3), step, recipe.climb));
  }
  return passes;
}

/** Concentric rings (outermost first in `rings`) cut inside out at height z. */
function ringPasses(rings, z, step, climb) {
  const passes = [];
  let pass = null, last = null;
  for (let i = rings.length - 1; i >= 0; i--) {
    for (const loop0 of rings[i]) {
      const loop = startNear(orient(loop0, signedArea(loop0) < 0, climb), last);
      const linkOk = pass && last && Math.hypot(loop[0][0] - last[0], loop[0][1] - last[1]) <= step * 1.2 + 0.05;
      if (!linkOk) { if (pass) passes.push(pass); pass = []; }
      pass.push(...close3(loop, z, 0.03));
      last = loop[0];
    }
  }
  if (pass) passes.push(pass);
  return passes;
}

/** Height map of a 3D part for the current material: depth below top → machine Z. */
function heights(surface, top) {
  const g = surface.grid;
  const z = new Float32Array(g.z.length);
  for (let k = 0; k < z.length; k++) z[k] = top - g.z[k];
  return { ...g, z };
}

const cache3d = new WeakMap();

/** Rough + finish ops of a 3D part (cached per part and recipe). */
function surfaceOps(part, recipe) {
  const d3 = { ...DEFAULT_RECIPE.d3, ...(recipe.d3 || {}) };
  const key = JSON.stringify(['v7', recipe.thickness, recipe.climb, d3]);
  const hit = cache3d.get(part.surface);
  if (hit && hit.key === key) return hit.ops;
  const top = Number(recipe.thickness);
  const H = heights(part.surface, top);
  const ops = [];
  // rough: z levels, rings inside the region the tool centre may visit
  const rg = d3.rough;
  const r = (Number(rg.dia) || 10) / 2;
  const step = Math.max(0.5, ((Number(rg.stepoverPct) || 45) / 100) * 2 * r);
  const roughPasses = [];
  for (const lv of roughLevels(H, { r, stepdown: Number(rg.stepdown) || 5, leave: Number(rg.leave) || 0, top })) {
    for (const sh of lv.shapes) {
      const loops = [sh.outer, ...sh.holes].map((l) => simplifyLoop(l, 0.1)).filter((l) => l.length >= 3);
      const rings = [];
      let cur = offset(loops, -0.01, { keepOrientation: true });
      while (cur.length && rings.length < 4000) {
        rings.push(cur);
        cur = offset(cur, -step, { keepOrientation: true, arcTol: 0.1 });
      }
      roughPasses.push(...ringPasses(rings, lv.z, step, recipe.climb));
    }
  }
  if (roughPasses.length) ops.push({ kind: 'rough', tool: rg.tool, feed: rg.feed, plunge: rg.plunge, passes: roughPasses });
  // finishing
  const bw = d3.bowl;
  // each compartment on its own: rings along the wall, evenly spaced over the curve
  const bowlPasses = part.comps
    .filter((c) => c.kind === 'cep3d' && !c.figure)
    .flatMap((c) => contourFinish(H, [c.pts, ...(c.islands || [])], { R: (Number(bw.dia) || 30) / 2, stepover: Number(bw.stepover) || 2, top, climb: recipe.climb, step: 1.5, simplifyTol: 0.015 }));
  // a compartment deeper than the ball radius has a vertical wall above the
  // floor ring's reach: waterline rings at the same offset finish it
  const Rb = (Number(bw.dia) || 30) / 2;
  for (const c of part.comps.filter((x) => x.kind === 'cep3d' && !x.figure)) {
    const D = Number(c.depth ?? part.figureParams?.depth ?? 0);
    if (!(D > 0)) continue;
    bowlPasses.push(...wallWaterline(H, [c.pts, ...(c.islands || [])], { R: Rb, stepdown: Number(bw.stepover) || 2, top, zMin: top - D + Rb, climb: recipe.climb, step: 1.5 }));
  }
  if (bowlPasses.length) ops.push({ kind: 'bowl', tool: bw.tool, feed: bw.feed, plunge: bw.plunge, passes: bowlPasses });
  if (d3.semi.enabled) {
    // T2 semi-finish stays `leave` mm above the figure: the relief bit then
    // finishes the whole figure, always cutting that even layer
    const sm = d3.semi;
    const semi = ballRaster(H, part.surface.recessMask, { R: (Number(sm.dia) || 10) / 2, stepover: Number(sm.stepover) || 1.2, top, leave: Number(sm.leave ?? 2) });
    if (semi.length) ops.push({ kind: 'semi', tool: sm.tool, feed: sm.feed, plunge: sm.plunge, passes: semi });
  }
  const rl = d3.relief;
  const relief = ballRaster(H, part.surface.recessMask, { R: (Number(rl.dia) || 6) / 2, stepover: Number(rl.stepover) || 0.6, top });
  // the figure's surrounding wall: waterline rings over its full height (a raster
  // crossing a steep wall leaves it ribbed and the top of it untouched)
  for (const c of part.comps.filter((x) => x.kind === 'cep3d' && x.figure)) {
    const recessDepth = Number(part.figureParams?.figTop || 0) + Number(part.figureParams?.figH || 0);
    if (recessDepth > 0) relief.push(...wallWaterline(H, [c.pts], { R: (Number(rl.dia) || 6) / 2, stepdown: Math.max(0.2, Number(rl.stepover) || 0.6), top, zMin: top - recessDepth, climb: recipe.climb }));
  }
  if (relief.length) ops.push({ kind: 'relief', tool: rl.tool, feed: rl.feed, plunge: rl.plunge, passes: relief });
  cache3d.set(part.surface, { key, ops });
  return ops;
}

/** Holding tabs on a closed 3D pass: the stretches inside a tab rise to `tabZ`. */
function addTabs(pass, count, len, tabZ) {
  if (!count || len <= 0) return pass;
  const xy = pass.map(([x, y]) => [x, y]);
  const L = pathLength(xy, false);
  if (L < count * len * 2) return pass;
  const spacing = L / count;
  const tabs = Array.from({ length: count }, (_, i) => [spacing * (i + 0.5) - len / 2, spacing * (i + 0.5) + len / 2]);
  const inTab = (s) => tabs.some(([a, b]) => s > a && s < b);
  const out = [pass[0]];
  let s = 0;
  for (let i = 1; i < pass.length; i++) {
    const [x0, y0, z0] = pass[i - 1], [x1, y1, z1] = pass[i];
    const segL = Math.hypot(x1 - x0, y1 - y0);
    // split the segment at every tab edge it crosses
    const cuts = tabs.flatMap(([a, b]) => [a, b]).filter((c) => c > s && c < s + segL).sort((a, b) => a - b);
    let prevT = 0;
    for (const c of [...cuts.map((c) => (c - s) / segL), 1]) {
      const px = x0 + (x1 - x0) * c, py = y0 + (y1 - y0) * c;
      const zBase = z0 + (z1 - z0) * c;
      const mid = s + segL * ((prevT + c) / 2);
      const z = inTab(mid) ? Math.max(zBase, tabZ) : zBase;
      const lastPt = out[out.length - 1];
      if (Math.abs(lastPt[2] - z) > 1e-6) out.push([lastPt[0], lastPt[1], z]); // vertical step into / out of the tab
      out.push([px, py, z]);
      prevT = c;
    }
    s += segL;
  }
  return out;
}

/**
 * All operations of one part. Each op: {kind, tool, feed, plunge, passes}.
 * Part coordinates are local (outline bbox at the origin).
 */
const dishCache = new WeakMap();

/**
 * The part as it will be machined: with dished compartments ('kase') every
 * flat pocket of a catalog model or a DXF drawing becomes a bowl made for the
 * finishing ball. Cached per part and recipe.
 */
export function preparePart(part, recipe) {
  if (recipe.bowlStyle !== 'kase' || part.surface || !part.comps.some((c) => c.kind === 'cep')) return part;
  const ballR = (Number(recipe.d3?.bowl?.dia) || DEFAULT_RECIPE.d3.bowl.dia) / 2;
  const depth = Math.min(Number(recipe.pocket.depth) || 0, Number(recipe.thickness) - 3);
  const key = JSON.stringify([ballR, depth]);
  const hit = dishCache.get(part);
  if (hit && hit.key === key) return hit.part;
  const dished = dishPart(part, { depth, ballR });
  dishCache.set(part, { key, part: dished });
  return dished;
}

export function partToolpaths(part0, recipe) {
  const part = preparePart(part0, recipe);
  const top = Number(recipe.thickness);
  const ops = [];
  const climb = recipe.climb;

  // 1. pockets (3D parts: rough + finishing from the height map)
  if (part.surface) ops.push(...surfaceOps(part, recipe));
  const pocketPassesAll = part.comps.filter((c) => c.kind === 'cep').flatMap((c) => pocketPasses(c, recipe));
  if (pocketPassesAll.length) ops.push({ kind: 'pocket', tool: recipe.pocket.tool, feed: recipe.pocket.feed, plunge: recipe.pocket.plunge, passes: pocketPassesAll });

  // 2. T3 rounding
  const rd = recipe.round;
  if (rd.enabled) {
    const z = +(top - (Number(rd.depth) || 0)).toFixed(3);
    const gap = Number(rd.gap) || 0;
    const loops = [];
    for (const l of offset([part.outline], gap)) loops.push(orient(l, true, climb));
    for (const c of part.comps) {
      if (c.kind === 'cep3d' && !c.roundable) continue; // a dished bowl has no vertical edge to round
      for (const l of offset([c.pts], -gap)) loops.push(orient(l, false, climb));
      if (c.kind === 'cep') for (const isl of c.islands) for (const l of offset([isl], gap)) loops.push(orient(l, true, climb));
    }
    if (loops.length) ops.push({ kind: 'round', tool: rd.tool, feed: rd.feed, plunge: rd.plunge, passes: loops.map((l) => close3(l, z)) });
  }

  // 3. ball-nose grooves (closed loops or open lines; depth per groove, else the recipe's)
  const gr = recipe.groove || DEFAULT_RECIPE.groove;
  if (part.grooves && part.grooves.length) {
    const passes = part.grooves.map((g) => {
      const z = +(top - (Number(g.depth ?? gr.depth) || 0)).toFixed(3);
      return g.closed ? close3(g.pts, z) : g.pts.map(([x, y]) => [x, y, z]);
    });
    ops.push({ kind: 'groove', tool: gr.tool, feed: gr.feed, plunge: gr.plunge, passes });
  }

  // 4. engraving lines
  if (part.lines.length) {
    const z = +(top - (Number(recipe.vline.depth) || 0)).toFixed(3);
    ops.push({ kind: 'vline', tool: recipe.vline.tool, feed: recipe.vline.feed, plunge: recipe.vline.plunge, passes: part.lines.map((l) => l.map(([x, y]) => [x, y, z])) });
  }

  // 4b. V-carved text: depth follows the stroke width (computed when the text was set)
  if (part.carve && part.carve.length) {
    ops.push({
      kind: 'vcarve',
      tool: part.text?.tool ?? recipe.vline.tool,
      feed: recipe.vline.feed,
      plunge: recipe.vline.plunge,
      passes: part.carve.map((p) => p.map(([x, y, d]) => [x, y, +(top - d).toFixed(3)])),
    });
  }

  // 5. through cuts: holes, then the outline (with tabs on the passes below the tab top)
  const c = recipe.cut;
  const rc = (Number(c.dia) || 6) / 2;
  const bottom = 0; // through cuts stop at the table: never below Z0
  const cutDepths = levels(top - bottom, c.stepdown).map((d) => +(top - d).toFixed(3));
  const holePasses = [];
  for (const comp of part.comps.filter((k) => k.kind === 'delik')) {
    const loops = offset([comp.pts], -rc).map((l) => orient(l, false, climb));
    for (const z of cutDepths) for (const l of loops) holePasses.push(close3(l, z));
  }
  const outer = offset([part.outline], rc).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
  const outlinePasses = [];
  if (outer) {
    const loop = orient(outer, true, climb);
    const tabZ = Math.max(bottom, Number(c.tabHeight) || 0);
    for (const z of cutDepths) {
      const pass = close3(loop, z);
      outlinePasses.push(z < tabZ - 1e-6 ? addTabs(pass, Number(c.tabs) || 0, Number(c.tabLen) || 0, tabZ) : pass);
    }
  }
  ops.push({ kind: 'cut', tool: c.tool, feed: c.feed, plunge: c.plunge, passes: [...holePasses, ...outlinePasses] });
  return ops;
}
