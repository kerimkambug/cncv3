// nesting.js
// Nesting & Toolpath Motoru:
// 1. MaxRects tabanlı otomatik yerleşim (plaka paketleme) + döndürme kilidi
// 2. İşleme (Profil/Motif) ve Dış Kesim (Ebatlama) ayrımı:
//    - Aşama 1 (Ön Kesim / Çizme - İşleme Öncesi): 6mm kesim bıçağıyla (3mm dışarıdan), 1.5mm derinliğe ön çizme.
//    - Aşama 2 (İşleme): Tanımlı bıçak sırası (T7, T2, T9 vs.) ile kapak motifi/profili işlenir.
//    - Aşama 3 (Final Kesim - İşleme Sonrası): 6mm kesim bıçağıyla Z0'a kadar inilerek parça plakadan ayrılır.
// 3. Sıralama: Sağ en üstteki parçadan sola doğru, satır satır yukarıdan aşağıya (sağdan sola).
import { fmt, computeCumOffsets, emitRectCutPath } from './common.js';
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
export function calculateNesting(opts) {
  const { plateW, plateH, edge = 0, gap = 0, rotate = true, parts: inputParts } = opts;

  if (!Number.isFinite(plateW) || !Number.isFinite(plateH) || plateW <= 0 || plateH <= 0) {
    throw new Error('Geçerli bir plaka ölçüsü gir.');
  }
  if (edge * 2 >= plateW || edge * 2 >= plateH) {
    throw new Error('Dış kenar boşluğu plakayı kullanılmaz hale getiriyor.');
  }
  if (!inputParts || inputParts.length === 0) {
    throw new Error('En az bir geçerli parça ekle.');
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
  return {
    thickness: Number(cfg.thickness) || 18,
    plungeFeed: Number(cfg.plungeFeed) || 3000,
    cutFeed: Number(cfg.cutFeed) || 6000,
    safeZ: Number(cfg.safeZ) || 61,
    toolChangeZ: Number(cfg.toolChangeZ) || 96,
    homeZ: Number(cfg.homeZ) || 96,
    spindleSpeed: cfg.spindleSpeed || 18000,
  };
}

/**
 * Calculates adaptive toolpath bounding coordinates for a given tool row across parts on a plate.
 * Returns array of { part, adRow, x1, y1, x2, y2, w, h } for parts where the row is not skipped.
 */
export function getAdaptiveRowPartCoords(parts, rows, rowIdx, offsetMode = 'relative') {
  if (!parts || !rows || !rows[rowIdx]) return [];
  const coords = [];
  parts.forEach((part) => {
    const adaptiveRows = calculateAdaptiveOffsets(
      part.placedWidth,
      part.placedHeight,
      rows,
      offsetMode
    );
    const adRow = adaptiveRows[rowIdx];
    if (!adRow || adRow.skipped) return;

    const x1 = part.x + adRow.leftOffset;
    const y1 = part.y + adRow.bottomOffset;
    const x2 = part.x + part.placedWidth - adRow.rightOffset;
    const y2 = part.y + part.placedHeight - adRow.topOffset;
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
    const overshootX = Number(derz.overshootX ?? derz.overshoot) || 1;
    const overshootY = Number(derz.overshootY ?? derz.overshoot) || 1;
    const vertical = (derz.yon || 'dikey') === 'dikey';

    plate.parts.forEach((part) => {
      const opts = {
        width: part.placedWidth,
        height: part.placedHeight,
        yon: derz.yon || 'dikey',
        margin: prevOffset + (Number(derz.margin) || 0),
        spacing: Number(derz.spacing) || Number(r.stepOffset) || 60,
        autoFit: derz.autoFit !== false,
        edgeExtra: Number(derz.edgeExtra) || 0,
      };
      const positions = computeDerzPositions(opts).positions;
      positions.forEach((pos) => {
        const x1 = vertical ? part.x + pos : part.x - overshootX;
        const y1 = vertical ? part.y - overshootY : part.y + pos;
        const x2 = vertical ? x1 : part.x + part.placedWidth + overshootX;
        const y2 = vertical ? part.y + part.placedHeight + overshootY : y1;
        lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(safeZ)}`);
        lines.push(`G1   Z${fmt(z)} F${plungeFeed.toFixed(1)}`);
        lines.push(`G1 X${fmt(x2)} Y${fmt(y2)}   F${feed.toFixed(1)}`);
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
  const cutToolDia = Number(cfg.cutToolDia) || 6;
  const cutToolRadius = cutToolDia / 2; // 6mm bıçak için 3mm
  const preCutDepth = Number(cfg.preCutDepth) || 1.5; // 1.5mm ön çizme derinliği
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
 * Parses a pasted/imported parts list in either CSV form or legacy TXT form.
 * @returns {{parts: Array<{name,width,height,qty}>, errors: number[]}}
 */
export function parseNestImportText(text) {
  const lines = text.split(/\r?\n/);
  const parts = [];
  const errors = [];

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    if (line.includes(',') || line.includes(';')) {
      const cells = line.split(/[,;]/).map((c) => c.trim()).filter((c) => c.length > 0);
      const nums = cells.map((c) => parseFloat(c.replace(',', '.')));
      const numericCells = cells.filter((c, i) => Number.isFinite(nums[i]));

      if (numericCells.length < 2) {
        if (index > 0 || !/genişlik|width|yükseklik|height|isim|ad/i.test(line)) errors.push(index + 1);
        return;
      }

      let name, width, height, qty = 1;
      if (cells.length >= 4 && !Number.isFinite(nums[0])) {
        name = cells[0];
        width = nums[1];
        height = nums[2];
        qty = parseInt(cells[3], 10) || 1;
      } else {
        width = nums[0];
        height = nums[1];
        qty = cells.length >= 3 ? (parseInt(cells[2], 10) || 1) : 1;
        name = `${width}×${height}`;
      }

      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || qty <= 0) {
        errors.push(index + 1);
        return;
      }
      parts.push({ name, width, height, qty });
      return;
    }

    // Legacy TXT: 500-454-2 => 500mm x 454mm, qty 2
    const match = line.match(/^(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+)$/);
    if (!match) { errors.push(index + 1); return; }

    const width = parseFloat(match[1].replace(',', '.'));
    const height = parseFloat(match[2].replace(',', '.'));
    const qty = parseInt(match[3], 10);
    if (width <= 0 || height <= 0 || qty <= 0) { errors.push(index + 1); return; }
    parts.push({ name: `${width}×${height}`, width, height, qty });
  });

  return { parts, errors };
}

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

      (group.cfg.rows || []).forEach((r, rowIdx) => {
        let usedInGroup = false;
        const rowDepth = Number(r.depth) || 2;
        const validCoords = getAdaptiveRowPartCoords(
          group.parts,
          group.cfg.rows,
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
          const cutToolRadius = (Number(cfg.cutToolDia) || 6) / 2;
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
  const plateW = Number(plate.width) || Number(cfg.plateWidth) || 2440;
  const plateH = Number(plate.height) || Number(cfg.plateHeight) || 1220;
  const cutToolDia = Number(cfg.cutToolDia) || 6;
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
    const rectRows = (group.cfg.rows || []).filter((r) => (r.operation || 'offset') !== 'derz');
    rectRows.forEach((r, rowIdx) => {
      const layerName = `4_ISLEME_${label}T${r.toolNo || rowIdx + 1}`;
      const validCoords = getAdaptiveRowPartCoords(
        group.parts,
        group.cfg.rows,
        rowIdx,
        group.cfg.offsetMode || 'relative'
      );
      validCoords.forEach(({ x1, y1, x2, y2 }) => {
        addRectLines(layerName, x1, y1, x2, y2);
      });
    });
  });

  // Derz satırları: her parçanın kendi ölçüsüne göre hesaplanan eşit aralıklı
  // bölme çizgileri — G-code üretimindekiyle aynı parametreler (DXF kontrolü de
  // gerçek kesimi görsün diye).
  profileGroups.forEach((group) => {
    const label = groupLabel(group);
    const groupOffsetRows = (group.cfg.rows || []).filter((rr) => (rr.operation || 'offset') !== 'derz' && rr.operation !== 'carving');
    const groupOffsetCums = groupOffsetRows.length ? computeCumOffsets(groupOffsetRows, group.cfg.offsetMode || 'relative') : [];
    (group.cfg.rows || []).filter((rr) => rr.operation === 'derz').forEach((r, derzIdx) => {
      const layerName = `4_ISLEME_${label}T${r.toolNo || derzIdx + 1}`;
      const derz = r.derz || {};
      const prevOffset = derz.respectPreviousOffset === false ? 0 : (groupOffsetCums[groupOffsetCums.length - 1] || 0);
      const vertical = (derz.yon || 'dikey') === 'dikey';
      group.parts.forEach((part) => {
        const opts = {
          width: part.placedWidth,
          height: part.placedHeight,
          yon: derz.yon || 'dikey',
          margin: prevOffset + (Number(derz.margin) || 0),
          spacing: Number(derz.spacing) || Number(r.stepOffset) || 60,
          autoFit: derz.autoFit !== false,
          edgeExtra: Number(derz.edgeExtra) || 0,
        };
        computeDerzPositions(opts).positions.forEach((pos) => {
          if (vertical) {
            addLine(layerName, part.x + pos, part.y, part.x + pos, part.y + part.placedHeight);
          } else {
            addLine(layerName, part.x, part.y + pos, part.x + part.placedWidth, part.y + pos);
          }
        });
      });
    });
  });

  lines.push(
    '0', 'ENDSEC',
    '0', 'EOF'
  );

  return lines.join('\n');
}

