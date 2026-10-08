// nesting.js
// Nesting & Toolpath Motoru:
// 1. MaxRects tabanlı otomatik yerleşim (plaka paketleme) + döndürme kilidi
// 2. İşleme (Profil/Motif) ve Dış Kesim (Ebatlama) ayrımı:
//    - Aşama 1 (Ön Kesim / Çizme - İşleme Öncesi): 6mm kesim bıçağıyla (3mm dışarıdan), 1.5mm derinliğe ön çizme.
//    - Aşama 2 (İşleme): Tanımlı bıçak sırası (T7, T2, T9 vs.) ile kapak motifi/profili işlenir.
//    - Aşama 3 (Final Kesim - İşleme Sonrası): 6mm kesim bıçağıyla Z0'a kadar inilerek parça plakadan ayrılır.
// 3. Sıralama: Sağ en üstteki parçadan sola doğru, satır satır yukarıdan aşağıya (sağdan sola).
import { fmt, computeCumOffsets, emitRectCutPath } from './common.js';
import { numOr, toFiniteNumber, validateNestingGap, validateDepthAgainstThickness } from '../../../../shared/gcode/validation.js';
import { parseNestImportText } from '../../../../shared/nest/csvImport.js';
export { parseNestImportText };
import { computeDerzPositions, trimDerzLine, derzBoxLine } from './derz.js';
import { parseGcode } from './gcodeToDxf.js';
import { buildCamPartProgram } from './camTarama.js';
import { rowNeedsOffset } from './features.js';
import { calculateAdaptiveOffsets, computeTopCurve, buildKapakGcode } from './kapak.js';

function rectsIntersect(a, b) {
  return a.x < b.x + b.w - 1e-9 && a.x + a.w > b.x + 1e-9 && a.y < b.y + b.h - 1e-9 && a.y + a.h > b.y + 1e-9;
}
function rectContains(a, b) {
  return a.x <= b.x + 1e-9 && a.y <= b.y + 1e-9 && a.x + a.w >= b.x + b.w - 1e-9 && a.y + a.h >= b.y + b.h - 1e-9;
}
function pruneContainedRects(rects) {
  const valid = rects.filter((r) => r.w > 1e-6 && r.h > 1e-6);
  const out = [];
  for (let i = 0; i < valid.length; i++) {
    const ri = valid[i];
    let contained = false;
    for (let j = 0; j < valid.length; j++) {
      if (i === j) continue;
      const rj = valid[j];
      if (rj.w < ri.w - 1e-9 || rj.h < ri.h - 1e-9) continue;
      if (rectContains(rj, ri)) { contained = true; break; }
    }
    if (!contained) out.push(ri);
  }
  return out;
}

// --- MaxRects packing -------------------------------------------------------
// A placement is scored by a heuristic (lower = better):
//   bssf : best short side fit   bl  : bottom-left (lowest y, then x)
//   blsf : best long side fit    baf : best area fit
const HEURISTICS = ['bssf', 'blsf', 'baf', 'bl'];

function placementScore(fr, pw, ph, heuristic) {
  const lw = fr.w - pw; const lh = fr.h - ph;
  const short = Math.min(lw, lh); const long = Math.max(lw, lh);
  switch (heuristic) {
    case 'blsf': return [long, short];
    case 'baf': return [fr.w * fr.h - pw * ph, short];
    case 'bl': return [fr.y + ph, fr.x];
    default: return [short, long];
  }
}
const better = (a, b) => !b || a[0] < b[0] - 1e-9 || (Math.abs(a[0] - b[0]) <= 1e-9 && a[1] < b[1] - 1e-9);

/** Best spot for `part` on `plate` (or null). The footprint carries the gap on its right/top side. */
function findPlacement(plate, part, gap, rotate, heuristic) {
  const orientations = [{ w: part.width, h: part.height, rotated: false }];
  if (rotate && !part.lockRotation && part.width !== part.height) {
    orientations.push({ w: part.height, h: part.width, rotated: true });
  }
  let best = null;
  for (const fr of plate.freeRects) {
    for (const o of orientations) {
      const pw = o.w + gap; const ph = o.h + gap;
      if (pw > fr.w + 1e-9 || ph > fr.h + 1e-9) continue;
      const score = placementScore(fr, pw, ph, heuristic);
      if (better(score, best && best.score)) best = { x: fr.x, y: fr.y, w: o.w, h: o.h, rotated: o.rotated, score };
    }
  }
  return best;
}

function commitPlacement(plate, part, place, gap) {
  const footprint = { x: place.x, y: place.y, w: place.w + gap, h: place.h + gap };
  const newFree = [];
  plate.freeRects.forEach((fr) => {
    if (!rectsIntersect(fr, footprint)) { newFree.push(fr); return; }
    if (footprint.x > fr.x) newFree.push({ x: fr.x, y: fr.y, w: footprint.x - fr.x, h: fr.h });
    if (footprint.x + footprint.w < fr.x + fr.w) newFree.push({ x: footprint.x + footprint.w, y: fr.y, w: (fr.x + fr.w) - (footprint.x + footprint.w), h: fr.h });
    if (footprint.y > fr.y) newFree.push({ x: fr.x, y: fr.y, w: fr.w, h: footprint.y - fr.y });
    if (footprint.y + footprint.h < fr.y + fr.h) newFree.push({ x: fr.x, y: footprint.y + footprint.h, w: fr.w, h: (fr.y + fr.h) - (footprint.y + footprint.h) });
  });
  plate.freeRects = pruneContainedRects(newFree);
  plate.parts.push({ ...part, x: place.x, y: place.y, placedWidth: place.w, placedHeight: place.h, rotated: place.rotated });
}

/**
 * Packs every part in `order` onto as many plates as needed.
 * strategy 'firstFit': each part, in order, goes to the first plate it fits on.
 * strategy 'global'  : plates are filled one at a time; at every step the
 *   remaining part with the best-scoring spot is placed (the order only breaks ties).
 */
function packAll(order, makePlate, gap, rotate, heuristic, strategy) {
  const plates = [];
  if (strategy === 'global') {
    let remaining = order.slice();
    while (remaining.length) {
      const plate = makePlate(plates.length + 1);
      for (;;) {
        let best = null; let bestIdx = -1;
        remaining.forEach((part, i) => {
          const pl = findPlacement(plate, part, gap, rotate, heuristic);
          if (pl && better(pl.score, best && best.score)) { best = pl; bestIdx = i; }
        });
        if (!best) break;
        commitPlacement(plate, remaining[bestIdx], best, gap);
        remaining.splice(bestIdx, 1);
      }
      if (!plate.parts.length) return null; // a part fits on no empty plate
      plates.push(plate);
    }
    return plates;
  }
  for (const part of order) {
    let done = false;
    for (const plate of plates) {
      const pl = findPlacement(plate, part, gap, rotate, heuristic);
      if (pl) { commitPlacement(plate, part, pl, gap); done = true; break; }
    }
    if (!done) {
      const plate = makePlate(plates.length + 1);
      const pl = findPlacement(plate, part, gap, rotate, heuristic);
      if (!pl) return null;
      commitPlacement(plate, part, pl, gap);
      plates.push(plate);
    }
  }
  return plates;
}

/**
 * Quality of a packing, lower = better: fewest plates first; then the last
 * plate packed into the smallest corner (its bounding area — what is left is
 * one big reusable offcut); then the same over all plates.
 */
function packingCost(plates) {
  const bbox = (pl) => {
    let w = 0; let h = 0;
    pl.parts.forEach((p) => { w = Math.max(w, p.x + p.placedWidth); h = Math.max(h, p.y + p.placedHeight); });
    return w * h;
  };
  return [plates.length, bbox(plates[plates.length - 1]), plates.reduce((s, pl) => s + bbox(pl), 0)];
}
const cheaper = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - 1e-6) return true;
    if (a[i] > b[i] + 1e-6) return false;
  }
  return false;
};

/** Small seeded PRNG (mulberry32), so the same input always gives the same nest. */
function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Smallest axis-aligned clearance between any two placed parts on a plate.
 *
 * Returns the smallest gap along X or Y between two rectangles that OVERLAP on
 * the other axis (i.e. the real separation the cutter would have to cross).
 * Diagonal-only neighbours are ignored — a part corner-to-corner across empty
 * plate does not put two toolpaths in conflict.
 *
 * @param {Array<{x:number,y:number,placedWidth:number,placedHeight:number}>} parts
 * @returns {number|null} null when fewer than two parts are placed
 */
export function minPartSpacing(parts) {
  if (!Array.isArray(parts) || parts.length < 2) return null;
  let min = Infinity;
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i];
    for (let j = i + 1; j < parts.length; j++) {
      const b = parts[j];
      // Overlap on Y => the X separation is what matters (and vice versa).
      const overlapY = a.y < b.y + b.placedHeight && a.y + a.placedHeight > b.y;
      const overlapX = a.x < b.x + b.placedWidth && a.x + a.placedWidth > b.x;
      if (overlapY) {
        const gapX = a.x + a.placedWidth <= b.x
          ? b.x - (a.x + a.placedWidth)
          : a.x - (b.x + b.placedWidth);
        if (gapX >= 0) min = Math.min(min, gapX);
      }
      if (overlapX) {
        const gapY = a.y + a.placedHeight <= b.y
          ? b.y - (a.y + a.placedHeight)
          : a.y - (b.y + b.placedHeight);
        if (gapY >= 0) min = Math.min(min, gapY);
      }
    }
  }
  return Number.isFinite(min) ? min : null;
}

function orderPartsByProximity(parts) {
  if (parts.length <= 2) return parts.slice();
  const remaining = parts.slice();
  const ordered = [];
  let cx = 0, cy = 0;
  while (remaining.length) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const px = p.x + p.placedWidth / 2, py = p.y + p.placedHeight / 2;
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    ordered.push(chosen);
    cx = chosen.x + chosen.placedWidth / 2;
    cy = chosen.y + chosen.placedHeight / 2;
  }
  return ordered;
}

/**
 * Final Z0 kesim (ve ön çizme) sıralaması — satır satır, sağdan sola:
 *   1. En üstteki satır: en sağ üstteki parçadan başlanır, satır sağdan sola
 *      bitirilir.
 *   2. Sonra bir alt satıra inilir, yine en sağdan başlanır.
 *   3. En son sol alttaki parça kesilir.
 * Bir "satır": kalan parçalar içinde üst kenarı en yüksek olan parça ile, üst
 * kenarı o parçanın alt kenarından yukarıda kalan (yani onun yüksekliğinde
 * başlayan) bütün parçalar. Satır içinde sağ kenarı büyük olan önce; aynı
 * sütunda üst üste duranlarda üstteki önce.
 */
export function orderPartsVacuumSafeFinalCut(parts) {
  if (!parts || parts.length <= 1) return parts ? parts.slice() : [];
  const top = (p) => p.y + p.placedHeight;
  const right = (p) => p.x + p.placedWidth;
  const EPS = 0.5;
  let remaining = parts.slice();
  const ordered = [];
  while (remaining.length) {
    // the row is led by the highest part (rightmost on a tie)
    const lead = remaining.reduce((best, p) => (
      top(p) > top(best) + EPS || (Math.abs(top(p) - top(best)) <= EPS && right(p) > right(best)) ? p : best
    ));
    const row = remaining.filter((p) => top(p) > lead.y + EPS);
    row.sort((a, b) => (Math.abs(right(b) - right(a)) > EPS ? right(b) - right(a) : top(b) - top(a)));
    ordered.push(...row);
    remaining = remaining.filter((p) => !row.includes(p));
  }
  return ordered;
}

/** Geriye dönük uyumluluk takma adı */
export function orderPartsTopRightToLeft(parts) {
  return orderPartsVacuumSafeFinalCut(parts);
}

/**
 * @param {object} opts - { plateW, plateH, edge, gap, rotate, parts }
 * @returns {{plates: Array}}
 */
/**
 * Single source of truth for one placed part's derz (divider) geometry.
 *
 * Mirrors kapak.js's rules so a nested part is cut exactly like the same part cut
 * standalone:
 *  - the divider MARGIN builds on the cumulative offset of the last offset row
 *    (unless derz.respectPreviousOffset is false),
 *  - a VERTICAL divider starts on the bottom frame edge the FIRST offset row cut
 *    (rows[0]'s cumulative offset) with NO bottom overshoot — overshooting there
 *    would drive the tool into the neighbouring part in a nest,
 *  - a vertical divider ends on the arch (topStyle != flat) when its X lies inside
 *    the arc, otherwise at the top margin + overshootY,
 *  - a HORIZONTAL divider runs from margin - overshootX to width - margin + overshootX.
 *
 * @param {object} part - a placed part ({x, y, placedWidth, placedHeight})
 * @param {object} row - the derz tool row (row.derz carries the options)
 * @param {Array} offsetRows - the OFFSET-only rows (derz/carving removed), in order
 * @param {{prevOffset:number, topStyle?:string, riseRatio?:number}} ctx
 * @returns {{vertical:boolean, positions:number[], segments:Array<{x1:number,y1:number,x2:number,y2:number}>}}
 */
export function buildPartDerzGeometry(part, row, offsetRows = [], ctx = {}) {
  const derz = row.derz || {};
  const prevOffset = numOr(ctx.prevOffset, 0);
  const margin = prevOffset + numOr(derz.margin, 0);
  const opts = {
    width: part.placedWidth,
    height: part.placedHeight,
    yon: derz.yon || 'dikey',
    margin,
    spacing: numOr(derz.spacing, null) ?? numOr(row.stepOffset, 60),
    autoFit: derz.autoFit !== false,
    insideFrame: derz.insideFrame === true,
    stagger: derz.stagger === true,
    count: numOr(derz.count, null),
    edgeExtra: numOr(derz.edgeExtra, 0),
  };
  const positions = computeDerzPositions(opts).positions;
  const vertical = (derz.yon || 'dikey') === 'dikey';
  // A derz overshoot of 0 is meaningful ("stop on the frame edge"); numOr keeps
  // it instead of the old `|| 0`-style coercion that also swallowed an explicit 0.
  const overshootX = numOr(derz.overshootX ?? derz.overshoot, 0);
  const overshootY = numOr(derz.overshootY ?? derz.overshoot, 0);

  // The bottom frame edge is the FIRST offset row's contour, not the derz margin
  // box (kapak.js: rows[0].stepOffset).
  const firstOffsetCum = offsetRows.length
    ? computeCumOffsets([offsetRows[0]], 'relative')[0]
    : 0;
  const startYOverride = Number.isFinite(Number(derz.startY)) ? Number(derz.startY) : null;
  const frameY = startYOverride != null ? startYOverride : firstOffsetCum;

  // The arch belongs to the OUTERMOST offset contour, so the curve is built from
  // that rectangle — using the derz margin would shrink the radius.
  const shapeOffset = firstOffsetCum;
  const shapeXl = part.x + shapeOffset;
  const shapeXr = part.x + part.placedWidth - shapeOffset;
  const shapeYt = part.y + part.placedHeight - shapeOffset;
  const curve = (ctx.topStyle && ctx.topStyle !== 'flat')
    ? computeTopCurve(shapeXl, shapeXr, shapeYt, ctx.topStyle, ctx.riseRatio)
    : null;

  const W = part.placedWidth;
  const H = part.placedHeight;
  const segments = positions.map((pos) => {
    if (!vertical) {
      const y = part.y + pos;
      const [s, e] = trimDerzLine(derz, false, pos, margin - overshootX, W - margin + overshootX, W, H, positions.indexOf(pos), positions.length);
      return { x1: part.x + s, y1: y, x2: part.x + e, y2: y };
    }
    const x = part.x + pos;
    const posAbs = part.x + pos;
    // Same top end as kapak.js: arch, else startY mirrored, else margin + overshoot.
    const y2 = (curve && posAbs > shapeXl && posAbs < shapeXr)
      ? curve.yEnd(posAbs)
      : part.y + (startYOverride != null ? H - startYOverride : H - margin + overshootY);
    const [s, e] = trimDerzLine(derz, true, pos, frameY, y2 - part.y, W, H, positions.indexOf(pos), positions.length);
    return { x1: x, y1: part.y + s, x2: x, y2: part.y + e };
  });
  const box = derzBoxLine(derz, positions, H);
  if (box) segments.push({ x1: part.x + box.x1, y1: part.y + box.y, x2: part.x + box.x2, y2: part.y + box.y });

  return { vertical, positions, segments, margin };
}

export function calculateNesting(opts) {
  const { plateW, plateH, edge = 0, gap = 0, rotate = true, parts: inputParts } = opts;
  const gapCfg = opts.gapSafety || {};

  if (!Number.isFinite(plateW) || !Number.isFinite(plateH) || plateW <= 0 || plateH <= 0) {
    throw new Error('Geçerli bir plaka ölçüsü gir.');
  }
  if (edge * 2 >= plateW || edge * 2 >= plateH) {
    throw new Error('Dış kenar boşluğu plakayı kullanılmaz hale getiriyor.');
  }
  if (!inputParts || inputParts.length === 0) {
    throw new Error('En az bir geçerli parça ekle.');
  }

  // PHYSICAL SAFETY GATE (server-side equivalent runs in the generator too).
  // When the outer cut is enabled every part gets a toolpath expanded by the
  // cutter radius on all four sides. Two parts closer together than one full
  // cutter diameter therefore have overlapping compensated paths and the tool
  // cuts into the neighbour. This is checked BEFORE any packing happens.
  if (inputParts.length > 1) {
    const gapErr = validateNestingGap({
      partGap: gap,
      cutToolDia: gapCfg.cutToolDia,
      outerCutEnabled: gapCfg.outerCutEnabled !== false,
      safetyMargin: gapCfg.safetyMargin,
    });
    if (gapErr) throw new Error(gapErr);
  }

  // Her giriş satırını qty adet gerçek parçaya aç (qty yoksa/geçersizse 1 kabul edilir).
  const parts = inputParts
    .flatMap((p) => {
      const qty = Number.isFinite(Number(p.qty)) && Number(p.qty) > 0 ? Math.floor(Number(p.qty)) : 1;
      return Array.from({ length: qty }, (_, i) => ({ ...p, qty, copyIndex: i }));
    });
  const usableW = plateW - edge * 2;
  const usableH = plateH - edge * 2;

  // The usable area is extended by one gap on the right/top: every footprint
  // carries its gap on those sides, and the last part's gap may run into the
  // edge margin — so the margin is `edge` on all four sides, not edge + gap.
  const makePlate = (number) => ({
    number, width: plateW, height: plateH, parts: [],
    freeRects: [{ x: edge, y: edge, w: usableW + gap, h: usableH + gap }],
  });

  // A part that fits on no empty plate is an input error, whatever the order.
  for (const part of parts) {
    if (!findPlacement(makePlate(1), part, gap, rotate, 'bssf')) {
      throw new Error(`${part.name} (${part.width}×${part.height}) tek başına bile plakanın kullanılabilir alanına sığmıyor.`);
    }
  }

  // Like a CAM nester: try many layouts and keep the one with the fewest plates
  // and the most compact last plate. Orders x placement rules x fill strategies,
  // then random reorderings until the variant/time budget runs out.
  const by = (key) => parts.slice().sort((a, b) => key(b) - key(a));
  const orders = [
    by((p) => p.width * p.height),
    by((p) => Math.max(p.width, p.height)),
    by((p) => p.height),
    by((p) => p.width),
    by((p) => p.width + p.height),
    by((p) => Math.min(p.width, p.height)),
  ];
  const maxVariants = Math.max(1, Number(opts.maxVariants) || 2000);
  const timeBudgetMs = Number(opts.timeBudgetMs) || 1500;
  const started = Date.now();
  const rand = seededRandom(parts.length * 7919 + Math.round(usableW + usableH));
  let best = null; let bestCost = null; let tried = 0; let bestLabel = '';
  const attempt = (order, heuristic, strategy, label) => {
    tried++;
    const plates = packAll(order, makePlate, gap, rotate, heuristic, strategy);
    if (!plates) return;
    const cost = packingCost(plates);
    if (!best || cheaper(cost, bestCost)) { best = plates; bestCost = cost; bestLabel = `${label} / ${heuristic} / ${strategy}`; }
  };
  outer: for (const strategy of ['firstFit', 'global']) {
    for (const heuristic of HEURISTICS) {
      for (let i = 0; i < orders.length; i++) {
        if (tried >= maxVariants || (best && Date.now() - started > timeBudgetMs)) break outer;
        attempt(orders[i], heuristic, strategy, `sıra${i + 1}`);
      }
    }
  }
  // random perturbations of the best-known orders (swap neighbours, shuffle blocks)
  while (tried < maxVariants && Date.now() - started <= timeBudgetMs) {
    const base = orders[Math.floor(rand() * orders.length)].slice();
    const swaps = 1 + Math.floor(rand() * Math.max(1, base.length / 3));
    for (let k = 0; k < swaps; k++) {
      const i = Math.floor(rand() * base.length); const j = Math.min(base.length - 1, i + 1 + Math.floor(rand() * 3));
      [base[i], base[j]] = [base[j], base[i]];
    }
    attempt(base, HEURISTICS[Math.floor(rand() * HEURISTICS.length)], rand() < 0.5 ? 'firstFit' : 'global', 'karışık');
  }
  const plates = best;

  plates.forEach((p) => {
    // Profil / işleme aşaması için standart yakınlık optimizasyonu
    p.parts = orderPartsByProximity(p.parts);
    delete p.freeRects;
  });

  const partArea = parts.reduce((s, p) => s + p.width * p.height, 0);
  const search = {
    variants: tried,
    ms: Date.now() - started,
    best: bestLabel,
    // share of the used plates covered by parts (the rest is fire / offcut)
    utilization: partArea / (plates.length * plateW * plateH),
  };
  return { plateW, plateH, edge, gap, plates, search };
}

/** Returns an error string if any tool row is missing required fields, else null. */
function validateRows(rows, label) {
  if (!rows || rows.length === 0) return null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.toolNo === '' || r.toolNo === undefined || r.toolNo === null) return `${label}: bir satırda Tool No eksik.`;
    if (!Number.isFinite(r.depth)) return `${label}: ${r.name || 'bir bıçak'} için derinlik eksik.`;
    if (rowNeedsOffset(r) && !Number.isFinite(r.stepOffset)) return `${label}: ${r.name || 'bir bıçak'} için adım offset eksik.`;
  }
  return null;
}

/**
 * Validates the default ("Ayarlar") tool rows AND every per-part preset actually
 * referenced in presetMap (parça bazlı model ataması — bkz. resolvePartCfg).
 * @param {object} defaultCfg - the cfg currently active in "Ayarlar/Bıçaklar" (fallback for parts with no override)
 * @param {object} presetMap - { [presetId]: cfg } — only presets actually assigned to a part need to be here
 */
export function validateNestingResult(nestingResult, defaultCfg, presetMap = {}) {
  const defaultErr = validateRows(defaultCfg?.rows, 'Ayarlardaki bıçaklar');
  if (defaultErr) return defaultErr;
  for (const key of Object.keys(presetMap || {})) {
    const preset = presetMap[key];
    if (preset?.cam) continue; // checked per part below
    const err = validateRows(preset?.rows, preset?.name ? `"${preset.name}" modeli` : 'Seçili model');
    if (err) return err;
  }
  // A glass door must fit ITS size: try each cam part's program.
  for (const plate of nestingResult?.plates || []) {
    for (const part of plate.parts || []) {
      const pc = presetMap && part.presetId ? presetMap[part.presetId] : null;
      if (!pc || !pc.cam) continue;
      try {
        partProgram(part, { ...defaultCfg, ...pc });
      } catch (e) {
        return `Cam kapak "${part.name}" (${part.width}x${part.height}): ${e.message}`;
      }
    }
  }
  return null;
}

/**
 * Resolves the full cfg (thickness/rows/offsetMode/topStyle/feeds/...) that should
 * drive a placed part's toolpaths: its own assigned preset (part.presetId) if one
 * was chosen and exists in presetMap, otherwise the plate-wide default cfg
 * ("Ayarlar" panelindeki aktif ayar — dropdown'da boş bırakılırsa bu kullanılır).
 */
export function resolvePartCfg(part, defaultCfg, presetMap) {
  if (part && part.presetId && presetMap && presetMap[part.presetId]) {
    return presetMap[part.presetId];
  }
  return defaultCfg;
}

/**
 * Groups a plate's placed parts by which cfg (preset) drives their toolpaths,
 * preserving each group's first-appearance order on the plate. Used so a single
 * plate can mix parts that each carve/offset with a completely different model.
 * @returns {Array<{key:string, cfg:object, parts:Array}>}
 */
export function groupNestingPartsByPreset(parts, defaultCfg, presetMap = {}) {
  const groups = [];
  const indexByKey = new Map();
  (parts || []).forEach((part) => {
    const hasOverride = !!(part && part.presetId && presetMap && presetMap[part.presetId]);
    const key = hasOverride ? part.presetId : '__default__';
    if (!indexByKey.has(key)) {
      indexByKey.set(key, groups.length);
      groups.push({ key, cfg: resolvePartCfg(part, defaultCfg, presetMap), parts: [] });
    }
    groups[indexByKey.get(key)].parts.push(part);
  });
  return groups;
}

function getMachineParams(cfg) {
  // numOr (NOT `Number(x) || default`) — a legitimate zero must survive. A
  // spindle speed of 0 is still nonsense, but plungeFeed/cutFeed/safeZ are
  // validated explicitly where they are used rather than silently replaced.
  return {
    thickness: numOr(cfg.thickness, 18),
    plungeFeed: numOr(cfg.plungeFeed, 3000),
    cutFeed: numOr(cfg.cutFeed, 6000),
    safeZ: numOr(cfg.safeZ, 61),
    toolChangeZ: numOr(cfg.toolChangeZ, 96),
    homeZ: numOr(cfg.homeZ, 96),
    spindleSpeed: numOr(cfg.spindleSpeed, 18000),
  };
}

/**
 * Calculates adaptive toolpath bounding coordinates for a given tool row across parts on a plate.
 * Returns array of { part, adRow, x1, y1, x2, y2, w, h } for parts where the row is not skipped.
 */
// NOTE: `rows` MUST be the OFFSET-only row list (derz/carving rows removed) and
// `rowIdx` its index inside that list — the nesting counterpart of kapak.js, where
// an explicit `absoluteOffset` pins a row to an exact contour and the adaptive S0
// shrink must NOT move it. Passing the full cfg.rows with a filtered index was
// shifting every contour by however many derz/carving rows came before it.
export function getAdaptiveRowPartCoords(parts, rows, rowIdx, offsetMode = 'relative') {
  if (!parts || !rows || !rows[rowIdx]) return [];
  const coords = [];
  const pinned = Number(rows[rowIdx] && rows[rowIdx].absoluteOffset);
  const hasPinned = Number.isFinite(pinned);
  parts.forEach((part) => {
    const adaptiveRows = calculateAdaptiveOffsets(
      part.placedWidth,
      part.placedHeight,
      rows,
      offsetMode
    );
    const adRow = adaptiveRows[rowIdx];
    if (!adRow || adRow.skipped) return;

    const offX = hasPinned ? pinned : adRow.leftOffset;
    const offY = hasPinned ? pinned : adRow.bottomOffset;
    const x1 = part.x + offX;
    const y1 = part.y + offY;
    const x2 = part.x + part.placedWidth - offX;
    const y2 = part.y + part.placedHeight - offY;
    coords.push({
      part,
      adRow,
      x1,
      y1,
      x2,
      y2,
      w: x2 - x1,
      h: y2 - y1,
    });
  });
  return coords;
}

/**
 * Emits outer cut rectangle toolpath passes for vacuum-safe ordered parts.
 */
function emitOuterCutPass(lines, parts, cutToolRadius, targetZ, feed, plunge, safeZ) {
  parts.forEach((part) => {
    emitRectCutPath(
      lines,
      part.x,
      part.y,
      part.placedWidth,
      part.placedHeight,
      cutToolRadius,
      targetZ,
      feed,
      plunge,
      safeZ
    );
  });
}

/**
 * Splits a combined (isCombined) kapak program into its tool blocks.
 * @returns {Array<{tool:string, head:string[], body:string[]}>}
 */
function splitToolBlocks(programLines) {
  const blocks = [];
  let cur = null;
  programLines.forEach((l, i) => {
    const m = /^M6T(\S+)/.exec(l);
    if (m) { cur = { tool: m[1], head: [l], body: [] }; blocks.push(cur); return; }
    // The M5 that closes a block right before the next tool change belongs to the change.
    if (l === 'M5' && /^M6T/.test(programLines[i + 1] || '')) return;
    if (!cur) return;
    if (!cur.body.length && (/^M3 S/.test(l) || /^G0Z/.test(l))) cur.head.push(l);
    else cur.body.push(l);
  });
  return blocks;
}

/**
 * Stage 2 of a plate: every part is cut by EXACTLY the program Tek Ölçü would
 * give it (buildKapakGcode on the part's placed size, shifted to its plate
 * position) — offsets, absolute/pinned offsets, rounded corners, roughing,
 * carving, derz, tarama, şablon... nothing is re-implemented here. The
 * per-part programs are then merged tool block by tool block, so the whole plate
 * still needs one tool change per block instead of one per part: block k of
 * every part is cut before block k+1 of any part. Each part's block starts with
 * a full X/Y/Z approach, so no move depends on where the previous part ended.
 */
function emitPartProgramsByTool(lines, parts, cfg) {
  if (!hasToolpaths(cfg) || !parts.length) return;
  const perPart = parts.map((part) => splitToolBlocks(partProgram(part, cfg).split('\n')));
  // Key = tool + its occurrence index, so a tool used twice (T6 ... T1 ... T6)
  // keeps two separate blocks. Order = first appearance over all parts.
  const order = [];
  const byKey = new Map();
  perPart.forEach((blocks, partIdx) => {
    const seen = {};
    blocks.forEach((b) => {
      seen[b.tool] = (seen[b.tool] || 0) + 1;
      const key = `${b.tool}#${seen[b.tool]}`;
      if (!byKey.has(key)) { byKey.set(key, { head: b.head, bodies: [] }); order.push(key); }
      byKey.get(key).bodies.push({ partIdx, body: b.body });
    });
  });
  const { toolChangeZ } = getMachineParams(cfg);
  let current = null;
  order.forEach((key) => {
    const blk = byKey.get(key);
    const tool = key.split('#')[0];
    // Two blocks in a row on the same tool (cam: tarama then iç kesim, both T6)
    // stay separate phases but need no tool change between them.
    if (tool !== current) {
      if (current !== null) lines.push('M5');
      blk.head.forEach((l) => lines.push(l));
      current = tool;
    }
    blk.bodies.forEach(({ body }) => body.forEach((l) => lines.push(l)));
  });
  lines.push(`G0Z${fmt(toolChangeZ)}`);
  lines.push('M5');
}

/**
 * Rotates one G-code line of a part program by 90° clockwise inside a part of
 * original width `w`, then shifts it to (ox, oy): (x, y) -> (ox + y, oy + w - x),
 * arc offsets (i, j) -> (j, -i). A quarter turn sends each axis to exactly one
 * axis, so even a modal line naming only X (or only Y) stays correct, and a
 * rotation keeps G2/G3 directions.
 */
function rotatePartLine(line, w, ox, oy) {
  const words = {};
  const re = /([XYIJ])(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(line))) words[m[1]] = Number(m[2]);
  if (!Object.keys(words).length) return line;
  const head = (/^\s*(G\d+)/.exec(line) || [])[1];
  const z = /Z-?\d+(?:\.\d+)?/.exec(line);
  const f = /F-?\d+(?:\.\d+)?/.exec(line);
  const out = [];
  if (head) out.push(head);
  if (words.Y !== undefined) out.push(`X${fmt(ox + words.Y)}`);
  if (words.X !== undefined) out.push(`Y${fmt(oy + w - words.X)}`);
  if (z) out.push(z[0]);
  if (words.J !== undefined) out.push(`I${fmt(words.J)}`);
  if (words.I !== undefined) out.push(`J${fmt(words.I === 0 ? 0 : -words.I)}`);
  if (f) out.push(f[0]);
  return out.join(' ');
}

/**
 * The combined (no header / no tail) program of one placed part in plate
 * coordinates. A part the packer turned by 90° is cut as ITSELF, turned: its
 * program is built on the part's own width x height and rotated, so an arched
 * top, the derz direction and corner ornaments stay where the model puts them
 * instead of being re-laid-out on the swapped size.
 */
export function partProgram(part, cfg) {
  const fullCfg = { ...cfg, ...getMachineParams(cfg) };
  const w = part.rotated ? numOr(part.width, part.placedHeight) : part.placedWidth;
  const h = part.rotated ? numOr(part.height, part.placedWidth) : part.placedHeight;
  if (cfg.cam) {
    // Glass door: tarama + iç kesim, built locally and then placed.
    const local = buildCamPartProgram(w, h, { ...fullCfg, ...cfg.cam });
    return local.split('\n').map((l) => (part.rotated
      ? rotatePartLine(l, w, part.x, part.y)
      : shiftPartLine(l, part.x, part.y))).join('\n');
  }
  if (!part.rotated) return buildKapakGcode(w, h, fullCfg, part.x, part.y, true);
  return buildKapakGcode(w, h, fullCfg, 0, 0, true)
    .split('\n')
    .map((l) => rotatePartLine(l, w, part.x, part.y))
    .join('\n');
}

/** Moves one G-code line by (ox, oy) (arc offsets are relative and stay). */
function shiftPartLine(line, ox, oy) {
  return line
    .replace(/X(-?\d+(?:\.\d+)?)/g, (_, v) => `X${fmt(Number(v) + ox)}`)
    .replace(/Y(-?\d+(?:\.\d+)?)/g, (_, v) => `Y${fmt(Number(v) + oy)}`);
}

/** Whether a cfg cuts anything inside the part (kapak rows or a glass door). */
function hasToolpaths(cfg) {
  return !!(cfg && (cfg.cam || (cfg.rows && cfg.rows.length)));
}

/**
 * The cutting moves (no rapids) of one placed part, in plate coordinates, read
 * back from the part's real program (partProgram). The plate DXF and the
 * on-screen preview both draw from this, so they show exactly what is cut.
 * @returns {Array<{from:{x,y,z}, to:{x,y,z}, type:string, tool:string|null}>}
 */
export function partToolpathSegments(part, cfg) {
  if (!hasToolpaths(cfg)) return [];
  return parseGcode(partProgram(part, cfg)).segments.filter((sgm) => sgm.type !== 'G0');
}

/**
 * Builds one plate's G-code:
 * - AŞAMA 1 (Ön Kesim / Çizme): Eğer dış kesim açıksa, işlemeden önce 6mm kesim bıçağıyla 3mm dıştan 1.5mm derinliğe ön çizme yapar.
 * - AŞAMA 2 (İşleme): Eski sistemdeki tanımlı tüm bıçaklar sırayla motifleri işler.
 * - AŞAMA 3 (Final Kesim): Eğer dış kesim açıksa, işleme bittikten sonra 6mm kesim bıçağıyla Z0'a kadar tam kesim yapar.
 */
export function buildNestingPlateGcode(plate, cfg, presetMap = {}) {
  const lines = ['makro'];

  const { thickness, plungeFeed, cutFeed, safeZ, homeZ, toolChangeZ, spindleSpeed } = getMachineParams(cfg);

  // Dış Kesim / Ebatlama Parametreleri
  const doOuterCut = cfg.enableOuterCut !== false; // Varsayılan: Açık
  const cutToolNo = cfg.cutToolNo || '6';
  const cutToolDia = numOr(cfg.cutToolDia, 6);
  const cutToolRadius = cutToolDia / 2; // 6mm bıçak için 3mm
  const preCutDepth = numOr(cfg.preCutDepth, 1.5); // 1.5mm ön çizme derinliği

  // GENERATOR-LEVEL SAFETY GATE. The UI validates too, but the generator must
  // never be the weak link: a caller that builds a plate directly (script, API,
  // test, a future headless pipeline) gets the same rejection. Two parts whose
  // nominal gap is under one cutter diameter have overlapping compensated outer
  // paths — the tool would cut into the neighbouring part.
  if (doOuterCut && plate.parts && plate.parts.length > 1) {
    const spacing = minPartSpacing(plate.parts);
    if (spacing !== null && spacing < cutToolDia - 1e-6) {
      throw new Error(
        `Güvenli olmayan nesting: parçalar arası en küçük boşluk ${spacing.toFixed(2)}mm, `
        + `kesim bıçağı çapı ${cutToolDia}mm. Dış kesim bıçağı ${cutToolDia}mm çapında olduğu için `
        + `iki parçanın telafi edilmiş takım yolları çakışır. Parça aralığını en az ${cutToolDia}mm yap.`
      );
    }
  }

  // Pre-cut must stay above the table and below the top surface.
  const depthErr = validateDepthAgainstThickness({ depth: preCutDepth, thickness, keepOut: 0 });
  if (depthErr) throw new Error(`Ön çizme derinliği geçersiz: ${depthErr}`);

  const preCutZ = +(thickness - preCutDepth).toFixed(3);
  const finalCutZ = 0.00; // Z0 tabana kadar tam kesim

  // Final Kesim Parçaları: Vakum güvenliği & Sağ-Üstten-Sola sıralı
  const finalCutParts = orderPartsVacuumSafeFinalCut(plate.parts);

  // 1. AŞAMA: İŞLEME ÖNCESİ ÖN ÇİZME / ÖN KESİM (1.5 mm)
  if (doOuterCut) {
    lines.push(`M6T${cutToolNo}`);
    lines.push(`M3 S${spindleSpeed}`);
    emitOuterCutPass(lines, finalCutParts, cutToolRadius, preCutZ, cutFeed, plungeFeed, safeZ);
    lines.push(`G0Z${fmt(toolChangeZ)}`);
    lines.push('M5');
  }

  // 2. AŞAMA: İŞLEME / PROFİL BIÇAKLARI (ADAPTİF OFFSET DESTEKLİ)
  // Her parça KENDİ atanmış modelinin (preset) bıçak sırasıyla işlenir — dropdown'da
  // özel bir model seçilmemişse "Ayarlar"daki aktif cfg (yukarıdaki thickness/feeds/...)
  // kullanılır. Aynı plakada farklı modeller (farklı offset/derz/carving zincirleri)
  // birbirini etkilemeden art arda işlenir.
  // Glass doors come after the kapak models: their through-cut openings free
  // loose scraps, so every other part is machined before that happens.
  const profileGroups = groupNestingPartsByPreset(plate.parts, cfg, presetMap);
  const ordered = [...profileGroups.filter((g) => !g.cfg.cam), ...profileGroups.filter((g) => g.cfg.cam)];
  ordered.forEach((group) => {
    emitPartProgramsByTool(lines, group.parts, { ...group.cfg, ...getMachineParams(group.cfg) });
  });

  // 3. AŞAMA: İŞLEME SONRASI FİNAL KESİM / EBATLAMA (Z0'A KADAR)
  if (doOuterCut) {
    lines.push(`M6T${cutToolNo}`);
    lines.push(`M3 S${spindleSpeed}`);
    emitOuterCutPass(lines, finalCutParts, cutToolRadius, finalCutZ, cutFeed, plungeFeed, safeZ);
    lines.push(`G0Z${fmt(toolChangeZ)}`);
    lines.push('M5');
  }

  // Bitiş ve Home
  lines.push(`G0 X0.00 Y0.00 Z${fmt(homeZ)}`);
  lines.push(`G0Z${fmt(homeZ)}`);
  lines.push('X0.00Y0.00');
  lines.push('M5');
  lines.push('M16');
  lines.push('M30');
  return lines.join('\n');
}

/**
 * (Re-exported from shared/nest/csvImport.js — the parsing rules live there so
 * the client, the server and the tests all share one definition. The old
 * `split(/[,;]/)` implementation could not tell a Turkish decimal comma from a
 * column separator and mis-assigned every column of "Kapak;500,5;454,2;2".)
 */

const ASSUMED_RAPID_MM_MIN = 15000;
const TOOLCHANGE_SECONDS = 6;

export function estimateNestingTime(result, cfg, presetMap = {}) {
  if (!result || !cfg) return 0;
  // Read off the plates' real programs, so every operation (carving, derz,
  // tarama, şablon, glass doors, outer cuts) and every feed is counted.
  return result.plates.reduce((sum, plate) => {
    try {
      return sum + estimateGcodeMinutes(buildNestingPlateGcode(plate, cfg, presetMap));
    } catch {
      return sum; // an unsafe plate is reported elsewhere; it has no runtime
    }
  }, 0);
}

/**
 * Machining time of a G-code program in minutes: feed moves at their modal F
 * (3D length, so plunges and ramps count), rapids at ASSUMED_RAPID_MM_MIN, and
 * TOOLCHANGE_SECONDS per M6.
 */
export function estimateGcodeMinutes(text) {
  let x = 0; let y = 0; let z = 0; let mode = 0; let f = 6000; let min = 0;
  const AXIS = { X: /X(-?\d+(?:\.\d+)?)/, Y: /Y(-?\d+(?:\.\d+)?)/, Z: /Z(-?\d+(?:\.\d+)?)/ };
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const l = raw.toUpperCase();
    if (/M0*6/.test(l)) min += TOOLCHANGE_SECONDS / 60;
    const g = /(?:^|[^A-Z])G0*([0-3])(?![0-9])/.exec(l);
    if (g) mode = Number(g[1]);
    const fm = /F(\d+(?:\.\d+)?)/.exec(l);
    if (fm) f = Math.max(1, Number(fm[1]));
    const v = (k, cur) => { const m = AXIS[k].exec(l); return m ? Number(m[1]) : cur; };
    const nx = v('X', x); const ny = v('Y', y); const nz = v('Z', z);
    const d = Math.hypot(nx - x, ny - y, nz - z);
    if (d > 0) min += mode === 0 ? d / ASSUMED_RAPID_MM_MIN : d / f;
    x = nx; y = ny; z = nz;
  });
  return min;
}

/**
 * Generates an AutoCAD R12/2000 compatible ASCII DXF string for a nesting plate.
 * Organizes geometries into separate layers for easy CAM import (Alphacam, ArtCAM, Aspire, AutoCAD):
 * - 0_PLAKA: Plaka dış sınırları (Plate outer boundary)
 * - 1_PARCALAR: Nominal parça dış sınırları (Part contours)
 * - 2_ETIKETLER: Parça adları ve ölçüleri (Part text labels)
 * - 3_DIS_KESIM: Dış kesim / ebatlama takım yolları (Outer cut offset paths)
 * - 4_ISLEME_T{toolNo}: Bıçak bazında motif/profil takım yolları (Milling/profile toolpaths)
 */
export function buildNestingPlateDxf(plate, cfg = {}, presetMap = {}) {
  const plateW = numOr(plate.width, null) ?? numOr(cfg.plateWidth, 2440);
  const plateH = numOr(plate.height, null) ?? numOr(cfg.plateHeight, 1220);
  const cutToolDia = numOr(cfg.cutToolDia, 6);
  const cutToolRadius = cutToolDia / 2;
  const doOuterCut = cfg.enableOuterCut !== false;
  const profileGroups = groupNestingPartsByPreset(plate.parts, cfg, presetMap);
  // Plakada tek model varsa katman adları eskisi gibi kalır (4_ISLEME_T7); birden
  // fazla model karışıksa hangi katmanın hangi modele ait olduğunu ayırt etmek için
  // katman adının başına kısa bir model etiketi eklenir (4_ISLEME_1_NUMARA_T1 gibi).
  const multiModel = profileGroups.length > 1;
  const safeLayerTag = (label) => String(label || 'Model').replace(/[^A-Za-z0-9ığüşöçİĞÜŞÖÇ_-]+/g, '_').slice(0, 24);
  const groupLabel = (group) => {
    if (!multiModel) return '';
    const tag = group.key === '__default__' ? 'AYARLAR' : safeLayerTag(group.cfg?.name || group.key);
    return `${tag}_`;
  };

  const lines = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER',
    '1', 'AC1009',
    '9', '$INSUNITS',
    '70', '4',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'TABLES',
    '0', 'TABLE',
    '2', 'LAYER',
    '70', '6',
    '0', 'LAYER',
    '2', '0',
    '70', '0',
    '62', '7',
    '6', 'CONTINUOUS',
  ];

  function addLayerDef(name, color) {
    lines.push(
      '0', 'LAYER',
      '2', name,
      '70', '0',
      '62', String(color),
      '6', 'CONTINUOUS'
    );
  }

  addLayerDef('0_PLAKA', 7); // White / Light Gray
  addLayerDef('1_PARCALAR', 3); // Green
  addLayerDef('2_ETIKETLER', 2); // Yellow
  if (doOuterCut) {
    addLayerDef(`3_DIS_KESIM_T${cfg.cutToolNo || '6'}`, 1); // Red
  }
  profileGroups.forEach((group) => {
    const label = groupLabel(group);
    (group.cfg.rows || []).forEach((r, idx) => {
      const color = (idx % 6) + 4; // Cyan, Blue, Magenta...
      addLayerDef(`4_ISLEME_${label}T${r.toolNo || idx + 1}`, color);
    });
  });

  lines.push(
    '0', 'ENDTAB',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES'
  );

  function addLine(layer, x1, y1, x2, y2) {
    lines.push(
      '0', 'LINE',
      '8', layer,
      '10', x1.toFixed(3),
      '20', y1.toFixed(3),
      '30', '0.000',
      '11', x2.toFixed(3),
      '21', y2.toFixed(3),
      '31', '0.000'
    );
  }

  function addRectLines(layer, x1, y1, x2, y2) {
    const pts = [
      [x1, y1, x2, y1],
      [x2, y1, x2, y2],
      [x2, y2, x1, y2],
      [x1, y2, x1, y1],
    ];
    pts.forEach(([lx1, ly1, lx2, ly2]) => {
      lines.push(
        '0', 'LINE',
        '8', layer,
        '10', lx1.toFixed(3),
        '20', ly1.toFixed(3),
        '30', '0.000',
        '11', lx2.toFixed(3),
        '21', ly2.toFixed(3),
        '31', '0.000'
      );
    });
  }

  function addText(layer, x, y, text, height = 14) {
    lines.push(
      '0', 'TEXT',
      '8', layer,
      '10', x.toFixed(3),
      '20', y.toFixed(3),
      '30', '0.000',
      '40', height.toFixed(1),
      '1', String(text),
      '72', '1',
      '11', x.toFixed(3),
      '21', y.toFixed(3),
      '31', '0.000',
      '73', '2'
    );
  }

  // 1. Plaka Dış Sınırı
  addRectLines('0_PLAKA', 0, 0, plateW, plateH);

  // 2. Parçalar, Etiketler ve Dış Kesim
  (plate.parts || []).forEach((part, idx) => {
    const px1 = part.x;
    const py1 = part.y;
    const px2 = part.x + part.placedWidth;
    const py2 = part.y + part.placedHeight;

    // Parça Konturu
    addRectLines('1_PARCALAR', px1, py1, px2, py2);

    // Parça Yazısı
    const cx = px1 + part.placedWidth / 2;
    const cy = py1 + part.placedHeight / 2;
    const textH = Math.max(8, Math.min(22, Math.min(part.placedWidth, part.placedHeight) / 14));
    const label = `${idx + 1}. ${part.name || 'Parca'} (${part.placedWidth}x${part.placedHeight})${part.rotated ? ' [R]' : ''}`;
    addText('2_ETIKETLER', cx, cy, label, textH);

    // Dış Kesim Hattı (Bıçak yarıçapı kadar dışarıdan)
    if (doOuterCut) {
      const cutLayer = `3_DIS_KESIM_T${cfg.cutToolNo || '6'}`;
      const ox1 = px1 - cutToolRadius;
      const oy1 = py1 - cutToolRadius;
      const ox2 = px2 + cutToolRadius;
      const oy2 = py2 + cutToolRadius;
      addRectLines(cutLayer, ox1, oy1, ox2, oy2);
    }
  });

  // 3. Motif / profil takım yolları — DXF, parçanın GERÇEK G-code'undan çizilir
  // (buildKapakGcode -> parseGcode): offset, mutlak offset, köşe yayları, kaba
  // boşaltma, carving rampaları, derz, tarama, şablon... kesilen her şey
  // birebir görünür, ayrı bir geometri kopyası yoktur. Her takım kendi katmanında.
  profileGroups.forEach((group) => {
    const label = groupLabel(group);
    group.parts.forEach((part) => {
      partToolpathSegments(part, group.cfg).forEach((sgm) => {
        addLine(`4_ISLEME_${label}T${sgm.tool || '?'}`, sgm.from.x, sgm.from.y, sgm.to.x, sgm.to.y);
      });
    });
  });

  lines.push(
    '0', 'ENDSEC',
    '0', 'EOF'
  );

  return lines.join('\n');
}

