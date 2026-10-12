// Serbest Kesim: any DXF drawing → toolpaths, the ArtCAM way: the user picks
// vectors (lines, closed shapes) and gives the selection an operation and a
// tool. A vector may be in several operations (a V line, then the cut).
//
//   1. place:      the drawing is turned (0/90/180/270°) and moved so its lower
//                  left corner (or its centre) sits on the machine zero or on a
//                  given X/Y
//   2. operations: [{ op, tool, depth, …, items:[vector ids] }] — cut with
//                  automatic inside / outside, outside, inside, on the line,
//                  pocket, V line; the tool's real diameter offsets the path
//   3. program:    the workshop's own dialect (cerezlik/gcode.js): tools grouped,
//                  through cuts last, small parts before big ones, holding tabs
// Pure: no React, no DOM.
import { offset, signedArea, area as polyArea, pointInPolygon } from '../cerezlik/geom.js';
import { levels, orient, close3, ringPasses, addTabs } from '../cerezlik/toolpaths.js';
import { buildPlateProgram } from '../cerezlik/gcode.js';
import { profile } from '../sim/millSim.js';

export const OPS = {
  kesim: 'Kesim (iç/dış otomatik)',
  dis: 'Dıştan kontur',
  ic: 'İçten kontur',
  hat: 'Hat üstü',
  cep: 'Cep boşaltma',
  vcizgi: 'V çizgi (tek paso)',
};

/** Default depth per operation: a pocket or a line never goes through by default (null = through). */
export const OP_DEPTH = { kesim: null, dis: null, ic: null, hat: 3, cep: 5, vcizgi: 2 };

export const DEFAULT_OP = { op: 'kesim', tool: '6', depth: null, stepdown: 6, feed: 5000, plunge: 1500, tabs: 4, tabLen: 10, tabHeight: 2, stepoverPct: 45 };

/** The drawing's layers with what they hold (for "select a layer"). */
export function layersOf(drawing) {
  const m = new Map();
  for (const l of drawing.loops) { const e = m.get(l.layer) || { name: l.layer, closed: 0, open: 0 }; e.closed++; m.set(l.layer, e); }
  for (const c of drawing.chains) { const e = m.get(c.layer) || { name: c.layer, closed: 0, open: 0 }; e.open++; m.set(c.layer, e); }
  return [...m.values()];
}

function bboxOf(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return Number.isFinite(x0) ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Turns and moves the drawing; every vector gets a stable id: K0, K1… for closed
 * shapes, A0, A1… for open lines (same file → same ids, so operations keep their vectors).
 * @param {{mode:'solAlt'|'merkez'|'ozel', x?:number, y?:number, rot?:0|90|180|270}} place
 *        solAlt: lower left corner on the zero; merkez: centre on the zero;
 *        ozel: lower left corner on (x, y)
 */
export function placeDrawing(drawing, place) {
  const rot = ((Number(place.rot) || 0) % 360 + 360) % 360;
  const turn = ([x, y]) => (rot === 90 ? [-y, x] : rot === 180 ? [-x, -y] : rot === 270 ? [y, -x] : [x, y]);
  const loops = drawing.loops.map((l, i) => ({ id: `K${i}`, layer: l.layer, closed: true, pts: l.pts.map(turn) }));
  const chains = drawing.chains.map((c, i) => ({ id: `A${i}`, layer: c.layer, closed: false, pts: c.pts.map(turn) }));
  const box = bboxOf([...loops, ...chains].map((p) => p.pts));
  if (!box) return { loops, chains, box: null };
  let dx, dy;
  if (place.mode === 'merkez') { dx = -(box.x0 + box.x1) / 2; dy = -(box.y0 + box.y1) / 2; }
  else if (place.mode === 'ozel') { dx = (Number(place.x) || 0) - box.x0; dy = (Number(place.y) || 0) - box.y0; }
  else { dx = -box.x0; dy = -box.y0; }
  const mv = ([x, y]) => [+(x + dx).toFixed(4), +(y + dy).toFixed(4)];
  const withBox = (v) => { const pts = v.pts.map(mv); return { ...v, pts, box: bboxOf([pts]) }; };
  return {
    loops: loops.map(withBox),
    chains: chains.map(withBox),
    box: { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy, w: box.w, h: box.h },
  };
}

/** Distance from the tool's axis where it cuts at `depth` below its tip (its width at that depth / 2). */
export function cutRadius(tool, depth) {
  if (!tool) return 3;
  const R = Number(tool.dia) / 2 || 3;
  if (tool.type === 'flat' || !(depth > 0)) return tool.type === 'flat' ? R : Math.min(R, 0.5);
  if (profile(tool, R) <= depth) return R;
  let lo = 0, hi = R;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (profile(tool, m) <= depth) lo = m; else hi = m; }
  return lo;
}

/** Closed shapes with their nesting depth among themselves (0 = outermost; odd = a hole in the shape around it). */
function nestDepths(loops) {
  const items = loops.map((l) => ({ ...l, a: polyArea(l.pts) }));
  for (const it of items) {
    it.depth = items.filter((o) => o !== it && o.a > it.a && pointInPolygon(it.pts[0], o.pts)).length;
  }
  return items;
}

/**
 * @param {object} placed  result of placeDrawing
 * @param {Array<{name?:string, op:string, tool:string, depth:number|null, stepdown:number, feed:number, plunge:number,
 *                tabs:number, tabLen:number, tabHeight:number, stepoverPct?:number, items:string[]}>} ops
 * @param {{thickness:number, spindle?:number, tools:object}} o  tools: simulation tools by number (the magazine)
 * @returns {{gcode:string, minutes:number, preview:Array, warnings:string[]}}
 */
export function buildSerbestProgram(placed, ops, { thickness, spindle = 18000, tools = {} }) {
  const top = Number(thickness) || 18;
  const warnings = [];
  const parts = []; // one "part" per path: through cuts are ordered by its area
  const add = (op, area) => parts.push({ id: `p${parts.length}`, op, area });
  const byId = new Map([...placed.loops, ...placed.chains].map((v) => [v.id, v]));

  ops.forEach((o, k) => {
    const c = { ...DEFAULT_OP, ...o };
    const label = c.name || `İşlem ${k + 1}`;
    const vecs = (c.items || []).map((id) => byId.get(id)).filter(Boolean);
    if (!vecs.length) { warnings.push(`${label}: vektör yok.`); return; }
    const tool = tools[Number(c.tool)];
    if (!tool) { warnings.push(`${label}: T${c.tool} magazinde yok, atlandı.`); return; }
    if (tool.empty) warnings.push(`${label}: T${c.tool} yuvası boş/eksik — Ø6 düz varsayıldı.`);
    const depth = Math.min(top, Math.max(0.1, Number(c.depth ?? top) || top));
    const through = depth >= top - 1e-6;
    const zs = c.op === 'vcizgi' ? [+(top - depth).toFixed(3)] : levels(depth, c.stepdown).map((d) => +(top - d).toFixed(3));
    const r = cutRadius(tool, depth);
    const base = { tool: String(c.tool), feed: Number(c.feed) || 5000, plunge: Number(c.plunge) || 1500 };
    const loops = vecs.filter((v) => v.closed);
    const chains = vecs.filter((v) => !v.closed);
    if (tool.type !== 'flat' && ['kesim', 'dis', 'ic', 'cep'].includes(c.op)) {
      warnings.push(`${label}: T${c.tool} düz uçlu değil — ofset bıçağın ${depth} mm derinlikteki genişliğine göre (${(2 * r).toFixed(1)} mm) alındı.`);
    }

    // open lines: always on the line
    for (const ch of chains) add({ kind: c.op === 'vcizgi' ? 'vline' : 'groove', ...base, passes: zs.map((z) => ch.pts.map(([x, y]) => [x, y, z])) }, 0);
    if (!loops.length) return;

    if (c.op === 'hat' || c.op === 'vcizgi') {
      for (const l of loops) add({ kind: c.op === 'vcizgi' ? 'vline' : 'groove', ...base, passes: zs.map((z) => close3(l.pts, z)) }, 0);
      return;
    }

    if (c.op === 'cep') {
      // each outer shape with the shapes inside it (islands) left standing; rings from the inside out
      const nested = nestDepths(loops);
      const step = Math.max(0.2, ((Number(c.stepoverPct) || 45) / 100) * 2 * r);
      for (const outer of nested.filter((n) => n.depth % 2 === 0)) {
        const islands = nested.filter((n) => n.depth === outer.depth + 1 && pointInPolygon(n.pts[0], outer.pts)).map((n) => n.pts);
        const rings = [];
        let cur = offset([outer.pts, ...islands], -r, { arcTol: 0.05 });
        while (cur.length && rings.length < 4000) { rings.push(cur); cur = offset(cur, -step, { keepOrientation: true, arcTol: 0.1 }); }
        if (!rings.length) { warnings.push(`${label}: bir cep T${c.tool} için çok dar, atlandı.`); continue; }
        add({ kind: 'pocket', ...base, passes: zs.flatMap((z) => ringPasses(rings, z, step, true)) }, outer.a);
      }
      return;
    }

    // contours: kesim = holes inside, outlines outside (among the picked shapes); dis / ic forced
    for (const l of nestDepths(loops)) {
      const outside = c.op === 'dis' ? true : c.op === 'ic' ? false : l.depth % 2 === 0;
      const off = offset([l.pts], outside ? r : -r, { arcTol: 0.03 }).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
      if (!off) { warnings.push(`${label}: bir kapalı şekil T${c.tool} (Ø${(2 * r).toFixed(1)}) için çok küçük, atlandı.`); continue; }
      const loop = orient(off, outside, true);
      const tabZ = Math.max(0, Number(c.tabHeight) || 0);
      // holding tabs only where the cut goes through and only on outlines (holes fall out)
      const passes = zs.map((z) => {
        const p = close3(loop, z);
        return through && outside && z < tabZ - 1e-6 ? addTabs(p, Number(c.tabs) || 0, Number(c.tabLen) || 0, tabZ) : p;
      });
      add({ kind: 'cut', ...base, passes }, l.a);
    }
  });

  if (!parts.length) return { gcode: '', minutes: 0, preview: [], warnings: summarize(warnings.length ? warnings : ['Vektör seçip bir işlem oluşturun.']) };
  const lib = new Map(parts.map((p) => [p.id, { ops: [p.op], area: p.area }]));
  const plate = { placements: parts.map((p) => ({ id: p.id, angle: 0, dx: 0, dy: 0 })) };
  const out = buildPlateProgram(plate, lib, { thickness: top, spindle, safeAbove: 28, clearAbove: 5 });
  return { ...out, warnings: summarize(warnings) };
}

/** The same warning once, with how many times it happened. */
function summarize(list) {
  const n = new Map();
  for (const w of list) n.set(w, (n.get(w) || 0) + 1);
  return [...n].map(([w, k]) => (k > 1 ? `${w} (${k}×)` : w));
}
