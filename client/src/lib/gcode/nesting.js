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
import { computeDerzPositions } from './derz.js';
import { validateKapakSize, calculateAdaptiveOffsets, buildCarvingProfile, clampCarvingExit, solveCarveGeometry, computeTopCurve, emitTopCurveGcode } from './kapak.js';

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

function tryPackPlateMaxRects(plate, part, gap, rotate) {
  if (!plate || !Array.isArray(plate.freeRects) || plate.freeRects.length === 0) return false;

  const orientations = [{ w: part.width, h: part.height, rotated: false }];
  if (rotate && !part.lockRotation && part.width !== part.height) {
    orientations.push({ w: part.height, h: part.width, rotated: true });
  }

  let best = null;
  plate.freeRects.forEach((fr) => {
    orientations.forEach((o) => {
      const pw = o.w + gap, ph = o.h + gap;
      if (pw <= fr.w + 1e-9 && ph <= fr.h + 1e-9) {
        const leftoverW = fr.w - pw, leftoverH = fr.h - ph;
        const shortSideFit = Math.min(leftoverW, leftoverH);
        const areaFit = fr.w * fr.h - pw * ph;
        if (!best || areaFit < best.areaFit - 1e-9 || (Math.abs(areaFit - best.areaFit) < 1e-9 && shortSideFit < best.shortSideFit)) {
          best = { x: fr.x, y: fr.y, w: o.w, h: o.h, rotated: o.rotated, areaFit, shortSideFit };
        }
      }
    });
  });
  if (!best) return false;

  const footprint = { x: best.x, y: best.y, w: best.w + gap, h: best.h + gap };
  const newFree = [];
  plate.freeRects.forEach((fr) => {
    if (!rectsIntersect(fr, footprint)) { newFree.push(fr); return; }
    if (footprint.x > fr.x) newFree.push({ x: fr.x, y: fr.y, w: footprint.x - fr.x, h: fr.h });
    if (footprint.x + footprint.w < fr.x + fr.w) newFree.push({ x: footprint.x + footprint.w, y: fr.y, w: (fr.x + fr.w) - (footprint.x + footprint.w), h: fr.h });
    if (footprint.y > fr.y) newFree.push({ x: fr.x, y: fr.y, w: fr.w, h: footprint.y - fr.y });
    if (footprint.y + footprint.h < fr.y + fr.h) newFree.push({ x: fr.x, y: footprint.y + footprint.h, w: fr.w, h: (fr.y + fr.h) - (footprint.y + footprint.h) });
  });
  plate.freeRects = pruneContainedRects(newFree);

  plate.parts.push({ ...part, x: best.x, y: best.y, placedWidth: best.w, placedHeight: best.h, rotated: best.rotated });
  return true;
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
 * Final Z0 Kesim & Ebatlama Sıralaması (Vakum Güvenliği & Top-Right Başlangıç):
 * 1. Kesim kesinlikle plakanın en sağ üst köşesindeki parçadan başlar (en yüksek Y, ardından en yüksek X).
 * 2. Aktif üst banttaki parçalar sağdan sola doğru taranır (vakum tabanının stabilitesi korunur).
 * 3. Her parçanın kesilmesinden sonra kalan parçalar dinamik olarak yeniden değerlendirilir;
 *    kesilen parçaların serbest kalıp uçması veya boşta kalan parçaların yerinden oynaması önlenir.
 */
export function orderPartsVacuumSafeFinalCut(parts, plateW = 2440, plateH = 1220) {
  if (!parts || parts.length <= 1) return parts ? parts.slice() : [];

  const remaining = parts.slice();
  const ordered = [];

  // 1. Aşama: Kesinlikle plakanın en sağ üst köşesindeki parça ile başla
  let firstIdx = 0;
  let bestStartScore = -Infinity;
  for (let i = 0; i < remaining.length; i++) {
    const p = remaining[i];
    const topY = p.y + p.placedHeight;
    const rightX = p.x + p.placedWidth;
    // Y ekseni yüksekliği en öncelikli, ardından en sağdaki X
    const score = topY * 100000 + rightX;
    if (score > bestStartScore) {
      bestStartScore = score;
      firstIdx = i;
    }
  }

  const firstPart = remaining.splice(firstIdx, 1)[0];
  ordered.push(firstPart);

  // 2. Aşama: Kalan parçaları vakum stabilitesi ve sağ-üstten-sola dalga mantığıyla dinamik seç
  while (remaining.length > 0) {
    const lastPart = ordered[ordered.length - 1];
    const lastRightX = lastPart.x + lastPart.placedWidth;
    const lastCenterX = lastPart.x + lastPart.placedWidth / 2;
    const lastCenterY = lastPart.y + lastPart.placedHeight / 2;

    const maxRemainingTopY = Math.max(...remaining.map((p) => p.y + p.placedHeight));
    const avgPartH = remaining.reduce((sum, p) => sum + p.placedHeight, 0) / remaining.length;
    const bandTolerance = Math.max(30, avgPartH * 0.55);

    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const pTopY = p.y + p.placedHeight;
      const pRightX = p.x + p.placedWidth;
      const pCenterX = p.x + p.placedWidth / 2;
      const pCenterY = p.y + p.placedHeight / 2;

      let score = 0;

      // Parça mevcut en üst aktif bantta mı?
      const inActiveBand = (maxRemainingTopY - pTopY) <= bandTolerance;

      if (inActiveBand) {
        // Aktif bant her zaman alt bantlardan önce bitirilir (10M taban)
        score += 10000000;
        // Aktif bant içinde sağdan sola öncelik (yüksek X daha önce)
        score += pRightX * 100;

        // Süreklilik: Önceki kesilen parçanın solundaki komşuyu önceliklendir
        if (pRightX <= lastRightX + 10) {
          score += 5000;
        }
      } else {
        // Alt bantlar: Önce daha yukarıdaki bantlar, sonra sağdakiler
        score += pTopY * 1000 + pRightX * 10;
      }

      // Gezinme mesafesi cezası (yakın parçayı tercih et)
      const dist = Math.hypot(pCenterX - lastCenterX, pCenterY - lastCenterY);
      score -= dist * 2;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const nextPart = remaining.splice(bestIdx, 1)[0];
    ordered.push(nextPart);
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

  const segments = positions.map((pos) => {
    if (!vertical) {
      const y = part.y + pos;
      return { x1: part.x + margin - overshootX, y1: y, x2: part.x + part.placedWidth - margin + overshootX, y2: y };
    }
    const x = part.x + pos;
    const posAbs = part.x + pos;
    const y2 = (curve && posAbs > shapeXl && posAbs < shapeXr)
      ? curve.yEnd(posAbs)
      : part.y + part.placedHeight - margin + overshootY;
    return { x1: x, y1: part.y + frameY, x2: x, y2 };
  });

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
    })
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));
  const usableW = plateW - edge * 2;
  const usableH = plateH - edge * 2;
  const plates = [];

  function newPlate() {
    return {
      number: plates.length + 1,
      width: plateW,
      height: plateH,
      parts: [],
      freeRects: [{ x: edge, y: edge, w: usableW, h: usableH }],
    };
  }

  for (const part of parts) {
    let placed = false;
    for (const plate of plates) {
      if (tryPackPlateMaxRects(plate, part, gap, rotate)) { placed = true; break; }
    }
    if (!placed) {
      const plate = newPlate();
      if (!tryPackPlateMaxRects(plate, part, gap, rotate)) {
        throw new Error(`${part.name} (${part.width}×${part.height}) tek başına bile plakanın kullanılabilir alanına sığmıyor.`);
      }
      plates.push(plate);
    }
  }

  plates.forEach((p) => {
    // Profil / işleme aşaması için standart yakınlık optimizasyonu
    p.parts = orderPartsByProximity(p.parts);
    delete p.freeRects;
  });

  return { plateW, plateH, edge, gap, plates };
}

/** Returns an error string if any tool row is missing required fields, else null. */
function validateRows(rows, label) {
  if (!rows || rows.length === 0) return null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.toolNo === '' || r.toolNo === undefined || r.toolNo === null) return `${label}: bir satırda Tool No eksik.`;
    if (!Number.isFinite(r.depth)) return `${label}: ${r.name || 'bir bıçak'} için derinlik eksik.`;
    if (!Number.isFinite(r.stepOffset)) return `${label}: ${r.name || 'bir bıçak'} için adım offset eksik.`;
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
    const err = validateRows(preset?.rows, preset?.name ? `"${preset.name}" modeli` : 'Seçili model');
    if (err) return err;
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
 * Emits adaptive profile milling passes for all defined tool rows.
 */
function emitAdaptiveProfilePasses(lines, plate, cfg, { thickness, plungeFeed, cutFeed, safeZ, toolChangeZ, spindleSpeed }) {
  if (!cfg.rows || cfg.rows.length === 0) return;
  let lastEmittedToolNo = null;
  const topStyle = cfg.topStyle || 'flat';

  // Only plain offset rows participate in the (cumulative) offset chain; derz and
  // carving rows are handled separately and must not shift the offset sequence.
  const offsetRows = cfg.rows.filter((r) => (r.operation || 'offset') !== 'derz' && r.operation !== 'carving');
  // Cumulative offset per offset row — the derz "respectPreviousOffset" margin
  // sits on top of the deepest offset row's cumulative value.
  const offsetCums = offsetRows.length ? computeCumOffsets(offsetRows, cfg.offsetMode || 'relative') : [];

  offsetRows.forEach((r, rowIdx) => {
    const z = +(thickness - r.depth).toFixed(3);
    const validPartCoords = getAdaptiveRowPartCoords(
      plate.parts,
      offsetRows,
      rowIdx,
      cfg.offsetMode || 'relative'
    );

    if (validPartCoords.length > 0) {
      const toolChanged = String(r.toolNo) !== String(lastEmittedToolNo);

      if (toolChanged) {
        if (lastEmittedToolNo !== null) {
          lines.push(`G0Z${fmt(toolChangeZ)}`);
          lines.push('M5');
        }
        lines.push(`M6T${r.toolNo}`);
        lines.push(`M3 S${spindleSpeed}`);
        lastEmittedToolNo = r.toolNo;
      }

      validPartCoords.forEach((coords) => {
        const curve = topStyle === 'flat' ? null : computeTopCurve(coords.x1, coords.x2, coords.y2, topStyle, cfg.riseRatio);
        lines.push(`G0 X${fmt(coords.x1)} Y${fmt(coords.y1)} Z${fmt(safeZ)}`);
        lines.push(`G1   Z${fmt(z)} F${plungeFeed.toFixed(1)}`);
        lines.push(`G1 X${fmt(coords.x2)}   F${cutFeed.toFixed(1)}`);
        if (curve) {
          emitTopCurveGcode(lines, curve, z, cutFeed);
          lines.push(`G1 X${fmt(coords.x1)} Y${fmt(coords.y1)} F${cutFeed.toFixed(1)}`);
        } else {
          lines.push(` Y${fmt(coords.y2)} `);
          lines.push(`X${fmt(coords.x1)}  `);
          lines.push(` Y${fmt(coords.y1)} `);
        }
        lines.push(`G0   Z${fmt(safeZ)}`);
      });
    }
  });

  // Carving rows: single closed profile line (V-bit) at a fixed offset, with an
  // outward diagonal corner ramp back to the surface — per part.
  cfg.rows.filter((r) => r.operation === 'carving').forEach((r) => {
    // Carving = closed V-bit profile with mandatory corner sharpening. The row gives
    // where (stepOffset) and how deep (depth); the bit angle derives the corner ramp.
    const geo = solveCarveGeometry(r);
    const depth = Number(r.depth) || 0;
    const offset = Number(r.stepOffset) || 0;
    // Clamp so the corner ramp can never step past the profile edge (no off-plate negatives).
    const exit = clampCarvingExit(geo.ramp, offset);
    const toolChanged = String(r.toolNo) !== String(lastEmittedToolNo);
    if (toolChanged) {
      if (lastEmittedToolNo !== null) {
        lines.push(`G0Z${fmt(toolChangeZ)}`);
        lines.push('M5');
      }
      lines.push(`M6T${r.toolNo}`);
      lines.push(`M3 S${spindleSpeed}`);
      lastEmittedToolNo = r.toolNo;
    }
    plate.parts.forEach((part) => {
      lines.push(`G0 X${fmt(part.x + part.placedWidth - offset)} Y${fmt(part.y + part.placedHeight - offset)} Z${fmt(safeZ)}`);
      buildCarvingProfile(part.placedWidth, part.placedHeight, offset, depth, thickness, geo.angle).forEach((line) => {
        const fed = /^G1 Z/.test(line) ? `${line} F${plungeFeed.toFixed(1)}` : `${line} F${cutFeed.toFixed(1)}`;
        lines.push(fed.replace(/X(-?[\d.]+)/g, (m, n) => `X${fmt(Number(n) + part.x)}`).replace(/Y(-?[\d.]+)/g, (m, n) => `Y${fmt(Number(n) + part.y)}`));
      });
      lines.push(`G0 Z${fmt(safeZ)}`);
    });
  });

  const offsetRowsForDerz = offsetRows;
  // Derz rows: evenly spaced divider lines INSIDE each part, driven by the row's
  // own derz options (yon/margin/spacing/autoFit/overshoot/edgeExtra) — the
  // nesting counterpart of kapak.js's derz block. Each part's lines are computed
  // on the part's own placed size and offset by the part's plate position.
  cfg.rows.filter((r) => r.operation === 'derz').forEach((r) => {
    const derz = r.derz || {};
    const toolChanged = String(r.toolNo) !== String(lastEmittedToolNo);
    if (toolChanged) {
      if (lastEmittedToolNo !== null) {
        lines.push(`G0Z${fmt(toolChangeZ)}`);
        lines.push('M5');
      }
      lines.push(`M6T${r.toolNo}`);
      lines.push(`M3 S${spindleSpeed}`);
      lastEmittedToolNo = r.toolNo;
    }
    const z = +(thickness - (Number(r.depth) || 0)).toFixed(3);
    const rowFeedVal = Number(r.feed);
    const feed = Number.isFinite(rowFeedVal) && rowFeedVal > 0 ? rowFeedVal : cutFeed;
    // "Önceki offset sınırlarına uy": derz margin sits on top of the deepest
    // offset row's cumulative offset (same rule as kapak.js).
    const prevOffset = derz.respectPreviousOffset === false ? 0 : (offsetCums[offsetCums.length - 1] || 0);
    // Derz geometry is NOT recomputed here: buildPartDerzGeometry is the single
    // source of truth shared by the G-code, the DXF and the on-screen preview, so
    // all three place every divider identically (kapak.js uses the same helper
    // rules: vertical lines start on the bottom frame edge cut by the FIRST
    // offset row — never with a bottom overshoot, which in a nest would run into
    // the neighbouring part — and end on the arch when the top is curved).
    plate.parts.forEach((part) => {
      const geo = buildPartDerzGeometry(part, r, offsetRowsForDerz, {
        prevOffset,
        topStyle: cfg.topStyle,
        riseRatio: cfg.riseRatio,
      });
      geo.segments.forEach((s) => {
        lines.push(`G0 X${fmt(s.x1)} Y${fmt(s.y1)} Z${fmt(safeZ)}`);
        lines.push(`G1   Z${fmt(z)} F${plungeFeed.toFixed(1)}`);
        lines.push(`G1 X${fmt(s.x2)} Y${fmt(s.y2)}   F${feed.toFixed(1)}`);
        lines.push(`G0   Z${fmt(safeZ)}`);
      });
    });
  });

  if (lastEmittedToolNo !== null) {
    lines.push(`G0Z${fmt(toolChangeZ)}`);
    lines.push('M5');
  }
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
  const finalCutParts = orderPartsVacuumSafeFinalCut(
    plate.parts,
    plate.width || cfg.plateWidth || 2440,
    plate.height || cfg.plateHeight || 1220
  );

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
  const profileGroups = groupNestingPartsByPreset(plate.parts, cfg, presetMap);
  profileGroups.forEach((group) => {
    emitAdaptiveProfilePasses(lines, { parts: group.parts }, group.cfg, getMachineParams(group.cfg));
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
  let rapidMm = 0;
  let toolChanges = 0;
  let cutMinTotal = 0;
  let plungeMinTotal = 0;

  // Süre, her parçanın KENDİ modelinin bıçak sırası + kendi feed'leriyle hesaplanır
  // (buildNestingPlateGcode'un ürettiği gerçek sıralamayla tutarlı olması için).
  result.plates.forEach((plate) => {
    const groups = groupNestingPartsByPreset(plate.parts, cfg, presetMap);
    groups.forEach((group) => {
      const groupCutFeed = Math.max(1, group.cfg.cutFeed || 6000);
      const groupPlungeFeed = Math.max(1, group.cfg.plungeFeed || 3000);
      let cx = 0;
      let cy = 0;

      // Yalnızca offset satırları işlenir ve SATIR DİZİSİ offset'e göre verilir
      // (derz/carving satırları hem profil çizmez hem indeksi kaydırırdı).
      const estOffsetRows = (group.cfg.rows || []).filter((r) => (r.operation || 'offset') !== 'derz' && r.operation !== 'carving');
      estOffsetRows.forEach((r, rowIdx) => {
        let usedInGroup = false;
        const rowDepth = numOr(r.depth, 2);
        const validCoords = getAdaptiveRowPartCoords(
          group.parts,
          estOffsetRows,
          rowIdx,
          group.cfg.offsetMode || 'relative'
        );

        validCoords.forEach(({ x1, y1, w, h }) => {
          usedInGroup = true;
          plungeMinTotal += rowDepth / groupPlungeFeed;
          cutMinTotal += (2 * (w + h)) / groupCutFeed;
          rapidMm += Math.hypot(x1 - cx, y1 - cy);
          cx = x1;
          cy = y1;
        });

        if (usedInGroup) toolChanges++;
      });
    });
  });

  let outerCutMin = 0;
  if (cfg.enableOuterCut !== false) {
    toolChanges += 2;
    const outerPerimeterTotal = result.plates.reduce(
      (s, plate) =>
        s +
        plate.parts.reduce((s2, part) => {
          const cutToolRadius = numOr(cfg.cutToolDia, 6) / 2;
          const w = part.placedWidth + 2 * cutToolRadius;
          const h = part.placedHeight + 2 * cutToolRadius;
          return s2 + 2 * (w + h);
        }, 0),
      0
    );
    outerCutMin = (2 * outerPerimeterTotal) / Math.max(1, cfg.cutFeed || 6000);
  }

  const rapidMinTotal = rapidMm / ASSUMED_RAPID_MM_MIN;
  const toolChangeMinTotal = (toolChanges * TOOLCHANGE_SECONDS) / 60;

  const totalMin = cutMinTotal + plungeMinTotal + outerCutMin + rapidMinTotal + toolChangeMinTotal;
  return totalMin;
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

  // 3. Motif / Profil Takım Yolları (Adaptif Offsetli) — her grup kendi modeliyle
  profileGroups.forEach((group) => {
    const label = groupLabel(group);
    // Derz satırları burada DIŞARIDA: onlar dikdörtgen profil değil, aşağıda
    // kendi bloklarında doğru biçimde tek tek çizgi (LINE) olarak çizilir.
    // Carving satırları da ayrı tutulur: adaptif zincir onların dağılımına göre
    // hesaplanır, bu yüzden indeks eşleşmesi bozulmamalıdır.
    const rectRows = (group.cfg.rows || []).filter((r) => (r.operation || 'offset') === 'offset');
    rectRows.forEach((r, rowIdx) => {
      const layerName = `4_ISLEME_${label}T${r.toolNo || rowIdx + 1}`;
      // rectRows is the OFFSET-only list, so it must be the row list handed to
      // getAdaptiveRowPartCoords too — passing group.cfg.rows with a filtered index
      // shifted every contour by the derz/carving rows sitting before it.
      const validCoords = getAdaptiveRowPartCoords(
        group.parts,
        rectRows,
        rowIdx,
        group.cfg.offsetMode || 'relative'
      );
      validCoords.forEach(({ x1, y1, x2, y2 }) => {
        addRectLines(layerName, x1, y1, x2, y2);
      });
    });
    // Carving profilleri: sabit offset'li kapalı V-bıçak profili (dikdörtgen).
    (group.cfg.rows || []).filter((r) => r.operation === 'carving').forEach((r, cIdx) => {
      const layerName = `4_ISLEME_${label}T${r.toolNo || cIdx + 1}`;
      const o = Number(r.stepOffset) || 0;
      group.parts.forEach((part) => {
        addRectLines(layerName, part.x + o, part.y + o, part.x + part.placedWidth - o, part.y + part.placedHeight - o);
      });
    });
  });

  // Derz satırları: G-code ile BİREBİR aynı geometri (buildPartDerzGeometry),
  // böylece kontrol/ölçüm gerçek kesimi görür.
  profileGroups.forEach((group) => {
    const label = groupLabel(group);
    const groupOffsetRows = (group.cfg.rows || []).filter((rr) => (rr.operation || 'offset') !== 'derz' && rr.operation !== 'carving');
    const groupOffsetCums = groupOffsetRows.length ? computeCumOffsets(groupOffsetRows, group.cfg.offsetMode || 'relative') : [];
    (group.cfg.rows || []).filter((rr) => rr.operation === 'derz').forEach((r, derzIdx) => {
      const layerName = `4_ISLEME_${label}T${r.toolNo || derzIdx + 1}`;
      const derz = r.derz || {};
      const prevOffset = derz.respectPreviousOffset === false ? 0 : (groupOffsetCums[groupOffsetCums.length - 1] || 0);
      group.parts.forEach((part) => {
        buildPartDerzGeometry(part, r, groupOffsetRows, {
          prevOffset,
          topStyle: group.cfg.topStyle,
          riseRatio: group.cfg.riseRatio,
        }).segments.forEach((s) => addLine(layerName, s.x1, s.y1, s.x2, s.y2));
      });
    });
  });

  lines.push(
    '0', 'ENDSEC',
    '0', 'EOF'
  );

  return lines.join('\n');
}

