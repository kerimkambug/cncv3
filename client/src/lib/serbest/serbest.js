// Serbest Kesim: any DXF drawing → toolpaths, one operation and one tool per layer.
//
//   1. place:   the drawing is turned (0/90/180/270°) and moved so its lower
//               left corner (or its centre) sits on the machine zero or on a
//               given X/Y
//   2. layers:  each layer gets an operation (cut with automatic inside /
//               outside, outside, inside, on the line, pocket, V line) and a
//               tool from the workshop magazine — its real diameter offsets
//               the path
//   3. program: the workshop's own dialect (cerezlik/gcode.js): tools grouped,
//               through cuts last, small parts before big ones, holding tabs
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
  yok: '— işleme',
};

/** Guess an operation from the layer's name (the user can change it). */
export function guessOp(layer) {
  const n = String(layer || '').toLowerCase();
  if (/cep|pocket|bosalt|boşalt|tarama/.test(n)) return 'cep';
  if (/v[-_ ]?(cizgi|çizgi|oyma)|gravur|yazi|yazı|engrave/.test(n)) return 'vcizgi';
  if (/hat|line|cizgi|çizgi|kanal/.test(n)) return 'hat';
  if (/^(defpoints|olcu|ölçü|dim|text|yazilar)$/.test(n)) return 'yok';
  return 'kesim';
}

export const DEFAULT_LAYER = { op: 'kesim', tool: '6', depth: null, stepdown: 6, feed: 5000, plunge: 1500, tabs: 4, tabLen: 10, tabHeight: 2, stepoverPct: 45 };

/** The drawing's layers with what they hold. */
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
 * Turns and moves the drawing (layers set to 'yok' do not count for the size).
 * @param {{mode:'solAlt'|'merkez'|'ozel', x?:number, y?:number, rot?:0|90|180|270}} place
 *        solAlt: lower left corner on the zero; merkez: centre on the zero;
 *        ozel: lower left corner on (x, y)
 */
export function placeDrawing(drawing, place, layerCfg = {}) {
  const used = (layer) => (layerCfg[layer]?.op || guessOp(layer)) !== 'yok';
  const rot = ((Number(place.rot) || 0) % 360 + 360) % 360;
  const turn = ([x, y]) => (rot === 90 ? [-y, x] : rot === 180 ? [-x, -y] : rot === 270 ? [y, -x] : [x, y]);
  const loops = drawing.loops.map((l) => ({ ...l, pts: l.pts.map(turn) }));
  const chains = drawing.chains.map((c) => ({ ...c, pts: c.pts.map(turn) }));
  const box = bboxOf([...loops, ...chains].filter((p) => used(p.layer)).map((p) => p.pts)) || bboxOf([...loops, ...chains].map((p) => p.pts));
  if (!box) return { loops, chains, box: null };
  let dx, dy;
  if (place.mode === 'merkez') { dx = -(box.x0 + box.x1) / 2; dy = -(box.y0 + box.y1) / 2; }
  else if (place.mode === 'ozel') { dx = (Number(place.x) || 0) - box.x0; dy = (Number(place.y) || 0) - box.y0; }
  else { dx = -box.x0; dy = -box.y0; }
  const mv = ([x, y]) => [+(x + dx).toFixed(4), +(y + dy).toFixed(4)];
  const L = loops.map((l) => ({ ...l, pts: l.pts.map(mv) }));
  const C = chains.map((c) => ({ ...c, pts: c.pts.map(mv) }));
  return { loops: L, chains: C, box: { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy, w: box.w, h: box.h } };
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

/** Loops of one layer with their nesting depth (0 = outermost; odd = a hole in the loop around it). */
function nestDepths(loops) {
  const items = loops.map((l) => ({ ...l, a: polyArea(l.pts) }));
  for (const it of items) {
    it.depth = items.filter((o) => o !== it && o.a > it.a && pointInPolygon(it.pts[0], o.pts)).length;
  }
  return items;
}

/**
 * @param {object} placed   result of placeDrawing
 * @param {object} layerCfg { [layer]: {op, tool, depth, stepdown, feed, plunge, tabs, tabLen, tabHeight, stepoverPct} }
 * @param {{thickness:number, spindle?:number, tools:object}} o  tools: simulation tools by number (the magazine)
 * @returns {{gcode:string, minutes:number, preview:Array, warnings:string[]}}
 */
export function buildSerbestProgram(placed, layerCfg, { thickness, spindle = 18000, tools = {} }) {
  const top = Number(thickness) || 18;
  const warnings = [];
  const parts = []; // one "part" per path: through cuts are ordered by its area
  const add = (op, area) => parts.push({ id: `p${parts.length}`, op, area });
  const layerNames = [...new Set([...placed.loops, ...placed.chains].map((p) => p.layer))];

  for (const layer of layerNames) {
    const c = { ...DEFAULT_LAYER, op: guessOp(layer), ...(layerCfg[layer] || {}) };
    if (c.op === 'yok') continue;
    const tool = tools[Number(c.tool)];
    if (!tool) { warnings.push(`${layer}: T${c.tool} magazinde yok, katman atlandı.`); continue; }
    if (tool.empty) warnings.push(`${layer}: T${c.tool} yuvası boş/eksik — Ø6 düz varsayıldı.`);
    const depth = Math.min(top, Math.max(0.1, Number(c.depth ?? top) || top));
    const through = depth >= top - 1e-6;
    const zs = c.op === 'vcizgi' ? [+(top - depth).toFixed(3)] : levels(depth, c.stepdown).map((d) => +(top - d).toFixed(3));
    const r = cutRadius(tool, depth);
    const base = { tool: String(c.tool), feed: Number(c.feed) || 5000, plunge: Number(c.plunge) || 1500 };
    const loops = placed.loops.filter((l) => l.layer === layer);
    const chains = placed.chains.filter((l) => l.layer === layer);
    if (tool.type !== 'flat' && ['kesim', 'dis', 'ic', 'cep'].includes(c.op)) {
      warnings.push(`${layer}: T${c.tool} düz uçlu değil — kontur ofseti bıçağın ${depth} mm derinlikteki genişliğine göre (${(2 * r).toFixed(1)} mm) alındı.`);
    }

    // open lines: always cut on the line
    for (const ch of chains) {
      const passes = zs.map((z) => ch.pts.map(([x, y]) => [x, y, z]));
      add({ kind: c.op === 'vcizgi' ? 'vline' : 'groove', ...base, passes }, 0);
    }
    if (!loops.length) continue;

    if (c.op === 'hat' || c.op === 'vcizgi') {
      for (const l of loops) add({ kind: c.op === 'vcizgi' ? 'vline' : 'groove', ...base, passes: zs.map((z) => close3(l.pts, z)) }, 0);
      continue;
    }

    if (c.op === 'cep') {
      // each outer loop with its holes (islands) cleared, rings from the inside out
      const nested = nestDepths(loops);
      const step = Math.max(0.2, ((Number(c.stepoverPct) || 45) / 100) * 2 * r);
      for (const o of nested.filter((n) => n.depth % 2 === 0)) {
        const islands = nested.filter((n) => n.depth === o.depth + 1 && pointInPolygon(n.pts[0], o.pts)).map((n) => n.pts);
        const rings = [];
        let cur = offset([o.pts, ...islands], -r, { arcTol: 0.05 });
        while (cur.length && rings.length < 4000) { rings.push(cur); cur = offset(cur, -step, { keepOrientation: true, arcTol: 0.1 }); }
        if (!rings.length) { warnings.push(`${layer}: bir cep T${c.tool} için çok dar, atlandı.`); continue; }
        const passes = zs.flatMap((z) => ringPasses(rings, z, step, true));
        add({ kind: 'pocket', ...base, passes }, o.a);
      }
      continue;
    }

    // contours: kesim = holes inside, outlines outside; dis / ic forced
    for (const l of nestDepths(loops)) {
      const outside = c.op === 'dis' ? true : c.op === 'ic' ? false : l.depth % 2 === 0;
      const off = offset([l.pts], outside ? r : -r, { arcTol: 0.03 }).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
      if (!off) { warnings.push(`${layer}: bir kapalı şekil T${c.tool} (Ø${(2 * r).toFixed(1)}) için çok küçük, atlandı.`); continue; }
      const loop = orient(off, outside, true);
      const tabZ = Math.max(0, Number(c.tabHeight) || 0);
      // holding tabs only where the cut goes through and only on outlines (holes fall out)
      const passes = zs.map((z) => {
        const p = close3(loop, z);
        return through && outside && z < tabZ - 1e-6 ? addTabs(p, Number(c.tabs) || 0, Number(c.tabLen) || 0, tabZ) : p;
      });
      add({ kind: 'cut', ...base, passes }, l.a);
    }
  }

  if (!parts.length) return { gcode: '', minutes: 0, preview: [], warnings: summarize([...warnings, 'İşlenecek bir şey yok: katmanlara işlem atayın.']) };
  const lib = new Map(parts.map((p) => [p.id, { ops: [p.op], area: p.area }]));
  const plate = { placements: parts.map((p) => ({ id: p.id, angle: 0, dx: 0, dy: 0 })) };
  const recipe = { thickness: top, spindle, safeAbove: 28, clearAbove: 5 };
  const out = buildPlateProgram(plate, lib, recipe);
  return { ...out, warnings: summarize(warnings) };
}

/** The same warning once, with how many times it happened. */
function summarize(list) {
  const n = new Map();
  for (const w of list) n.set(w, (n.get(w) || 0) + 1);
  return [...n].map(([w, k]) => (k > 1 ? `${w} (${k}×)` : w));
}
