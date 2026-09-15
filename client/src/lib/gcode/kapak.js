// kapak.js
// Rectangular multi-tool pocket cutting (cabinet doors / "tabla")
import { fmt, computeCumOffsets } from './common.js';
import { computeDerzPositions } from './derz.js';

/**
 * Computes the top-edge curve geometry for a part.
 *
 * Styles:
 *  - 'flat'       : no curve (classic rectangle), returns null.
 *  - 'semicircle' : full half-circle; centre on the mid-width, radius = half the
 *                   inner width, top of the arc sitting at yt.
 *  - 'pointed'    : flattened/sharp arch built from a single circular arc that
 *                   dips `rise` mm below yt at the middle, blending into the
 *                   straight top edge at the two "shoulder" points.
 *
 * Validated against real production files (2_NUMARA.cnc / 3_NUMARA.cnc).
 *
 * @param {number} xl inner-left X
 * @param {number} xr inner-right X
 * @param {number} yt top Y of the straight inner edge (arc top / arch apex height)
 * @param {'flat'|'semicircle'|'pointed'} [topStyle='flat']
 * @param {number} [riseRatio=0.125] - only for 'pointed': rise = innerW * riseRatio
 * @returns {null | {
 *   topStyle: string, xc: number, yc: number, r: number,
 *   xl: number, xr: number, yt: number,
 *   yShoulder: number|null, innerW: number, rise: number,
 *   yEnd: (x:number)=>number,
 * }}
 */
export function computeTopCurve(xl, xr, yt, topStyle = 'flat', riseRatio = 0.125) {
  if (topStyle !== 'semicircle' && topStyle !== 'pointed') return null;

  const innerW = xr - xl;
  const xc = (xl + xr) / 2;
  let r, yc, yShoulder = null, rise = 0;

  if (topStyle === 'semicircle') {
    // Full half-circle: apex at yt, radius = half the inner width.
    r = innerW / 2;
    yc = yt - r;
  } else {
    // 'pointed': rise = innerW * riseRatio (default 0.125);
    // circle passing through shoulders (xl,yt) / (xr,yt) and dipping `rise` at centre.
    rise = innerW * (Number(riseRatio) || 0.125);
    r = ((innerW / 2) ** 2 + rise ** 2) / (2 * rise);
    yc = yt - r;
    yShoulder = yc + Math.sqrt(Math.max(0, r ** 2 - (innerW / 2) ** 2));
  }

  // Top-edge Y at any X across the part (used to end derz / vertical lines on the curve).
  const yEnd = (x) => {
    const rad2 = r ** 2 - (x - xc) ** 2;
    return yc + Math.sqrt(rad2 > 0 ? rad2 : 0);
  };

  return { topStyle, xc, yc, r, xl, xr, yt, yShoulder, innerW, rise, yEnd };
}

/**
 * Emits the G-code for a curved top edge between (xl, yEnd(xl)) and (xr, yEnd(xr)).
 * The arc is emitted as a single G2/G3 full sweep of the top of the circle
 * (semicircle: two quarter arcs; pointed: one shallow arc between the shoulders).
 *
 * @param {Array<string>} lines
 * @param {ReturnType<typeof computeTopCurve>} curve
 * @param {number} z - cutting Z
 * @param {number} [feed] - only used for the introductory G1
 * @returns {Array<string>} lines
 */
export function emitTopCurveGcode(lines, curve, z, feed) {
  if (!curve) return lines;
  const { topStyle, xc, yc, r, xl, xr, yShoulder, yEnd } = curve;

  // I/J are the arc-centre offsets FROM THE ACTUAL ARC START POINT (centre - start),
  // exactly as ArtCAM emits them in the real production files.
  const iOf = (sx) => xc - sx;
  const jOf = (sy) => yc - sy;
  const jz = (n) => fmt(Math.abs(n) < 5e-3 ? 0 : n); // avoid "-0.00"

  if (topStyle === 'semicircle') {
    // Approach along the right edge to yc, then two quarter arcs: right edge ->
    // apex -> left edge (matches 2_NUMARA.cnc: G3X146Y340I-86J0 / G3X60Y254I0J-86).
    lines.push(`G1 X${fmt(xr)} Y${fmt(yEnd(xr))}`);
    lines.push(`G3 X${fmt(xc)} Y${fmt(yc + r)} I${fmt(iOf(xr))} J${jz(jOf(yc))} F${Number(feed || 0).toFixed(1)}`);
    lines.push(`G3 X${fmt(xl)} Y${fmt(yEnd(xl))} I${fmt(iOf(xc))} J${jz(jOf(yc + r))}`);
    return lines;
  }

  // 'pointed': single arc between the two shoulders, apex at yt = yc + r.
  // Sweep right shoulder -> left shoulder over the shallow top
  // (matches 3_NUMARA.cnc: G3X57.00I-89.00J-166.87).
  lines.push(`G1 X${fmt(xr)} Y${fmt(yShoulder)}`);
  lines.push(`G3 X${fmt(xl)} Y${fmt(yShoulder)} I${fmt(iOf(xr))} J${jz(jOf(yShoulder))} F${Number(feed || 0).toFixed(1)}`);
  return lines;
}

/**
 * Emits a CLOSED rounded-corner rectangle profile (one pass, counter-clockwise,
 * all corner arcs as G2). Geometrically identical to the ArtCAM output for
 * 1_NUMARA.cnc (r=6/3) and 8_NUMARA.cnc (r=4): same corner centres, same
 * radius, same tangent points — so the machine cuts the exact same surface.
 *
 * The lead-in starts on the bottom-left corner arc at 45 degrees
 * (x1 - r + r*sqrt2/2), exactly where ArtCAM starts it, then walks the profile
 * CCW: BL -> up left edge -> TL -> across top -> TR -> down right edge -> BR ->
 * across bottom -> back to the BL start point.
 *
 * @param {number} x1 inner-left X of the rectangle (tangent box)
 * @param {number} y1 inner-bottom Y
 * @param {number} x2 inner-right X
 * @param {number} y2 inner-top Y
 * @param {number} r corner radius (mm, > 0)
 * @param {number} z cutting Z
 * @param {number} plungeFeed
 * @param {number} cutFeed
 * @param {number} safeZ
 * @param {number} [ox=0] X origin offset
 * @param {number} [oy=0] Y origin offset
 * @returns {Array<string>} gcode lines (G0 lead-in + G1/G2 profile)
 */
export function buildRoundedRectProfile(x1, y1, x2, y2, r, z, plungeFeed, cutFeed, safeZ, ox = 0, oy = 0) {
  const rr = Number(r) || 0;
  const px = (v) => fmt(v + ox);
  const py = (v) => fmt(v + oy);
  const pf = Number(plungeFeed).toFixed(1);
  const cf = Number(cutFeed).toFixed(1);
  // If the two sides are too short for the requested radius, clamp it so the
  // arcs still meet (never emit inverted/negative spans).
  const maxR = Math.min((x2 - x1) / 2, (y2 - y1) / 2);
  const rad = Math.max(0, Math.min(rr, maxR));
  if (rad <= 1e-6) {
    // Degenerate: fall back to a square profile (same path as a flat offset pass).
    const lines = [];
    lines.push(`G0 X${px(x1)} Y${py(y1)} Z${fmt(safeZ)}`);
    lines.push(`G1 Z${fmt(z)} F${pf}`);
    lines.push(`G1 X${px(x2)} F${cf}`);
    lines.push(` Y${py(y2)} `);
    lines.push(`X${px(x1)}  `);
    lines.push(` Y${py(y1)} `);
    lines.push(`G0 Z${fmt(safeZ)}`);
    return lines;
  }

  // Corner arc centres (tangent box inset by the radius).
  const cblx = x1 + rad, cbly = y1 + rad;
  const ctlx = x1 + rad, ctly = y2 - rad;
  const ctrx = x2 - rad, ctry = y2 - rad;
  const cbrx = x2 - rad, cbry = y1 + rad;

  // Corner-arc start point on the bottom-left (45 deg): the ArtCAM lead-in.
  const k = rad * Math.SQRT1_2; // rad * sqrt(2)/2
  const startX = cblx - k;
  const startY = cbly - k;

  const lines = [];
  lines.push(`G0 X${px(startX)} Y${py(startY)} Z${fmt(safeZ)}`);
  lines.push(`G1 Z${fmt(z)} F${pf}`);
  // Corner arc: from the 225-deg point to the LEFT tangent point (cblx, y1).
  lines.push(`G2 X${px(cblx)} Y${py(y1)} I${fmt(k)} J${fmt(k)} F${cf}`);
  // Left edge up to the top-left tangent point (x1, ctly).
  lines.push(`G1 Y${py(ctly)} `);
  // TL corner arc: left tangent -> top tangent (ctlx, y2).
  lines.push(`G2 X${px(ctlx)} Y${py(y2)} I${fmt(0)} J${fmt(rad)} `);
  // Top edge across to the top-right tangent point (ctrx, y2).
  lines.push(`G1 X${px(ctrx)} `);
  // TR corner arc: top tangent -> right tangent (x2, ctry).
  lines.push(`G2 X${px(x2)} Y${py(ctry)} I${fmt(rad)} J${fmt(0)} `);
  // Right edge down to the bottom-right tangent point (x2, cbry).
  lines.push(`G1 Y${py(cbry)} `);
  // BR corner arc: right tangent -> bottom tangent (cbrx, y1).
  lines.push(`G2 X${px(cbrx)} Y${py(y1)} I${fmt(0)} J${fmt(-rad)} `);
  // Bottom edge across to the bottom-left tangent point (cblx, y1).
  lines.push(`G1 X${px(cblx)} `);
  // BL corner arc: bottom tangent -> back to the 45-deg start point (closes the loop).
  lines.push(`G2 X${px(startX)} Y${py(startY)} I${fmt(-k)} J${fmt(-k)} `);
  lines.push(`G0 Z${fmt(safeZ)}`);
  return lines;
}

/**
 * Calculates adaptive toolpath coordinates for a part of given width and height.
 *
 * Rules:
 * 1. Normal offset system is preserved (e.g. 53 -> 16 -> 9 -> 8 -> 5).
 * 2. If a part is narrow and does not fit nominal offsets symmetrically, the problematic
 *    side's base offset is reduced by 10mm (e.g. 53 -> 43), while the safe side stays at 53mm.
 * 3. Subsequent inner step offsets (16 -> 9 -> 8 -> 5) remain unchanged.
 * 4. For each tool row, if the cut rectangle does not physically fit (spanX <= 0 or spanY <= 0),
 *    that specific pass is skipped without generating invalid/inverted coordinates.
 *
 * @param {number} width - Part width (mm)
 * @param {number} height - Part height (mm)
 * @param {Array<{toolNo:string|number, depth:number, stepOffset:number, name?:string}>} rows
 * @param {'relative'|'absolute'} [offsetMode='relative']
 * @returns {Array<{
 *   rowIdx: number,
 *   toolNo: string|number,
 *   depth: number,
 *   name: string,
 *   skipped: boolean,
 *   leftOffset: number,
 *   rightOffset: number,
 *   bottomOffset: number,
 *   topOffset: number,
 *   x1: number|null,
 *   x2: number|null,
 *   y1: number|null,
 *   y2: number|null,
 *   spanX: number,
 *   spanY: number
 * }>}
 */
/**
 * Calculates adaptive toolpath coordinates for a part of given width and height.
 *
 * Rules (confirmed with the shop):
 * 1. Ölçüye göre akıllı kısıtlama: sadece S0 (ilk/dış offset) esner. İç bıçakların
 *    aralarındaki adımlar (delta'lar — stepOffset[1], stepOffset[2], ...) HİÇBİR ZAMAN
 *    değişmez; sadece S0 küçülerek tüm zincir içeri/dışarı kayar. S0 dar parçada iç
 *    bıçakların (özellikle en içteki motifin) tam ve net kalmasına öncelik verecek
 *    şekilde otomatik küçülür — asla nominal değerinin üstüne çıkmaz.
 * 2. X ve Y ekseni tamamen bağımsız hesaplanır. Bir eksen dar olduğu için S0 orada
 *    küçülürken diğer eksen genişse kendi nominal S0 değerinde kalır.
 * 3. Karşılıklı kenarlar HER ZAMAN simetriktir (sol=sağ, alt=üst) — asimetrik kayma
 *    yok, parça her zaman merkezli işlenir.
 * 4. Adapte edilmiş S0 ile bile bir bıçağın (genelde en içteki) payı kalmıyorsa
 *    (span <= 0), o bıçak sorunsuzca atlanır (skipped=true) — hata vermez.
 *
 * "Mutlak" modda offsetler zaten birbirinden bağımsız/sabit ölçülerdir (kullanıcı
 * doğrudan kenardan mesafe olarak girmiştir), o yüzden esnetme uygulanmaz — sadece
 * sığmayan satırlar tek tek atlanır.
 *
 * @param {number} width - Part width (mm)
 * @param {number} height - Part height (mm)
 * @param {Array<{toolNo:string|number, depth:number, stepOffset:number, name?:string}>} rows
 * @param {'relative'|'absolute'} [offsetMode='relative']
 * @param {number} [minCenterSpan=0] - en içteki geçerli bıçağın bırakması gereken minimum güvenli pay (mm)
 * @returns {Array<{
 *   rowIdx: number, toolNo: string|number, depth: number, name: string, skipped: boolean,
 *   leftOffset: number, rightOffset: number, bottomOffset: number, topOffset: number,
 *   x1: number|null, x2: number|null, y1: number|null, y2: number|null,
 *   spanX: number, spanY: number
 * }>}
 */
export function calculateAdaptiveOffsets(width, height, rows, offsetMode = 'relative', minCenterSpan = 0) {
  if (!rows || rows.length === 0) return [];
  const isAbs = offsetMode === 'absolute';

  // Adapts S0 (row 0's offset) for ONE axis so the innermost row keeps a
  // positive (or minCenterSpan-safe) span, while every delta after row 0
  // stays exactly as specified. Returns the single symmetric offset to use
  // for BOTH sides of that axis, per row.
  function computeAxisOffsets(span) {
    if (isAbs) return null; // absolute mode: no S0 adaptation, handled per-row below

    const nominalCum = computeCumOffsets(rows, 'relative');
    const S0 = nominalCum[0];
    const innerCum = nominalCum.map((c) => c - S0); // fixed deltas relative to row 0, never adapted
    const lastInnerCum = innerCum[innerCum.length - 1];

    const maxAllowedS0 = (span - minCenterSpan) / 2 - lastInnerCum;
    const adaptedS0 = Math.max(0, Math.min(S0, maxAllowedS0));

    return innerCum.map((ic) => adaptedS0 + ic); // symmetric cumulative offset per row
  }

  const xOffsets = computeAxisOffsets(width);
  const yOffsets = computeAxisOffsets(height);

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let cumX, cumY;

    if (isAbs) {
      cumX = Number(r.stepOffset) || 0;
      cumY = Number(r.stepOffset) || 0;
    } else {
      cumX = xOffsets[i];
      cumY = yOffsets[i];
    }

    const x1 = cumX, x2 = width - cumX;
    const y1 = cumY, y2 = height - cumY;
    const spanX = x2 - x1;
    const spanY = y2 - y1;
    const fits = spanX > minCenterSpan - 1e-9 && spanY > minCenterSpan - 1e-9 && spanX > 0 && spanY > 0;

    results.push({
      rowIdx: i,
      toolNo: r.toolNo,
      depth: r.depth,
      name: r.name || '',
      skipped: !fits,
      leftOffset: cumX,
      rightOffset: cumX,
      bottomOffset: cumY,
      topOffset: cumY,
      x1: fits ? x1 : null,
      x2: fits ? x2 : null,
      y1: fits ? y1 : null,
      y2: fits ? y2 : null,
      spanX,
      spanY,
    });
  }

  return results;
}

/**
 * Clamps a carving corner-sharpen distance so the outward diagonal ramp stays
 * inside the plate/profile. The tool can never step further out than the
 * profile offset itself: `oi = offset - exit` must stay >= 0.
 * @param {number} rawExit - requested exit distance (mm)
 * @param {number} offset - main profile offset (mm)
 * @returns {number} safe exit distance (>= 0, <= offset)
 */
export function clampCarvingExit(rawExit, offset) {
  const o = Number(offset) || 0;
  const e = Number(rawExit);
  if (!Number.isFinite(e) || e <= 0) return 0;
  return Math.min(e, Math.max(0, o));
}

/**
 * Builds a "carving" profile: a single closed profile line (V-bit), NOT a pocket.
 * The main pass runs at a fixed offset (e.g. 56) at the carving depth; at every
 * corner the tool steps DIAGONALLY outwards (offset - sharpenDistance) AND ramps
 * back to the surface (Z = thickness) at the same time, then returns to the
 * profile — matching the verified 1_NUMARA.cnc corner treatment.
 *
 * Confirmed on 1_NUMARA.cnc: corner exit distance == carving depth (6mm <-> 6mm)
 * on all 4 corners. That 1:1 ratio is NOT yet confirmed as a general rule — pass
 * `cornerSharpenDistance` to override; when null/undefined it defaults to `depth`.
 * (Kerim should confirm whether the exit distance is always equal to the depth or
 * a separate parameter.)
 *
 * @param {number} width - part width (mm)
 * @param {number} height - part height (mm)
 * @param {number} offset - main profile offset from the part edge (mm)
 * @param {number} depth - carving depth (mm)
 * @param {number} thickness - material thickness (mm)
 * @param {number} [cornerSharpenDistance] - diagonal exit distance; null => depth
 * @returns {Array<string>} gcode lines for the profile
 */
export function buildCarvingProfile(width, height, offset, depth, thickness, cornerSharpenDistance = null) {
  const o = Number(offset) || 0;
  const d = Number(depth) || 0;
  const t = Number(thickness) || 0;
  // Raw request, then clamp so the outward corner ramp can NEVER reach past the
  // profile edge (offset - exit >= 0 => no negative / off-plate coordinates).
  const rawExit = cornerSharpenDistance === null || cornerSharpenDistance === undefined
    ? d
    : Number(cornerSharpenDistance);
  const exit = clampCarvingExit(rawExit, o);

  const zCut = +(t - d).toFixed(3);       // cutting depth
  const zSurf = +t.toFixed(3);            // back at the surface = 0 depth
  const oi = o - exit;                    // outer diagonal corner offset (56 - 6 = 50; clamped >= 0)

  const x1 = o;                // inner profile left
  const x2 = width - o;        // inner profile right
  const y1 = o;                // inner profile bottom
  const y2 = height - o;       // inner profile top
  const ox1 = oi;              // outer diagonal left
  const ox2 = width - oi;      // outer diagonal right
  const oy1 = oi;              // outer diagonal bottom
  const oy2 = height - oi;     // outer diagonal top
  // Verified order on 1_NUMARA.cnc (lines 42-56): start at the TOP-RIGHT profile
  // corner, then walk the 4 corners CLOCKWISE (TR -> TL -> BL -> BR), each corner
  // doing an outward diagonal ramp to the surface (Z=thickness) and immediately
  // returning to the profile at the cutting depth. Matches byte-for-byte.
  const lines = [];
  lines.push(`G1 Z${fmt(zCut)}`);
  lines.push(`G1 X${fmt(ox2)} Y${fmt(oy2)} Z${fmt(zSurf)}`); // TR outward + surface ramp
  lines.push(`X${fmt(x2)} Y${fmt(y2)} Z${fmt(zCut)}`);       // back to TR profile
  lines.push(`X${fmt(x1)}`);                                  // TL profile (X only)
  lines.push(`X${fmt(ox1)} Y${fmt(oy2)} Z${fmt(zSurf)}`);    // TL outward＋rampa
  lines.push(`X${fmt(x1)} Y${fmt(y2)} Z${fmt(zCut)}`);       // back to TL profile
  lines.push(` Y${fmt(y1)}`);                                 // BL profile (Y only)
  lines.push(`X${fmt(ox1)} Y${fmt(oy1)} Z${fmt(zSurf)}`);    // BL outward+ramp
  lines.push(`X${fmt(x1)} Y${fmt(y1)} Z${fmt(zCut)}`);       // back to BL profile
  lines.push(`X${fmt(x2)}`);                                  // BR profile (X only)
  lines.push(`X${fmt(ox2)} Y${fmt(oy1)} Z${fmt(zSurf)}`);    // BR outward+ramp
  lines.push(`X${fmt(x2)} Y${fmt(y1)} Z${fmt(zCut)}`);       // back to BR profile
  lines.push(` Y${fmt(y2)}`);                                 // close back up the right edge
  return lines;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {object} cfg - machine config (thickness, spindleSpeed, safeZ, toolChangeZ, homeZ, plungeFeed, cutFeed)
 * @param {Array<{toolNo:string|number, depth:number, stepOffset:number}>} cfg.rows
 * @param {'relative'|'absolute'} [cfg.offsetMode]
 * @param {number} [offsetX]
 * @param {number} [offsetY]
 * @param {boolean} [isCombined=false] - true ise M30 komutunu çıkart (birleştirilmiş g-code için)
 * @returns {string} full gcode program
 */
export function buildKapakGcode(width, height, cfg, offsetX = 0, offsetY = 0, isCombined = false) {
  const rows = cfg.rows || [];
  const isDerzOrCarving = (row) => row.operation === 'derz' || row.operation === 'carving';
  const offsetRows = rows.filter((row) => !isDerzOrCarving(row));
  const derzRows = rows.map((row, rowIndex) => ({ row, rowIndex })).filter(({ row }) => row.operation === 'derz');
  const carvingRows = rows.filter((row) => row.operation === 'carving');
  const adaptiveRows = calculateAdaptiveOffsets(width, height, offsetRows, cfg.offsetMode || 'relative');
  const topStyle = cfg.topStyle || 'flat';
  const lines = isCombined ? [] : ['makro'];
  let lastEmittedToolNo = null;

  // Per-row cut feed override (row.feed). Falls back to the shared cfg.cutFeed.
  const rowFeed = (r) => {
    const f = Number(r.feed);
    return Number.isFinite(f) && f > 0 ? f : cfg.cutFeed;
  };

  adaptiveRows.forEach((r) => {
    if (r.skipped) return;

    // adaptiveRows mirrors offsetRows 1:1 (same index), so r.rowIdx maps back to
    // the source row — this is how per-row options (feed, cornerRadius) survive.
    const srcRow = offsetRows[r.rowIdx] || r;
    const feed = rowFeed(srcRow);

    const x1 = offsetX + r.x1;
    const x2 = offsetX + r.x2;
    const y1 = offsetY + r.y1;
    const y2 = offsetY + r.y2;
    const z = +(cfg.thickness - r.depth).toFixed(3);

    const toolChanged = String(r.toolNo) !== String(lastEmittedToolNo);

    if (toolChanged) {
      if (lastEmittedToolNo !== null) {
        lines.push(`G0Z${fmt(cfg.toolChangeZ)}`);
        lines.push('M5');
      }
      lines.push(`M6T${r.toolNo}`);
      lines.push(`M3 S${cfg.spindleSpeed}`);
      lastEmittedToolNo = r.toolNo;
    }

    // Rounded-corner pass: a single closed profile with G2/G3 corner arcs.
    const cornerRadius = Number(srcRow && srcRow.cornerRadius);
    if (Number.isFinite(cornerRadius) && cornerRadius > 0) {
      buildRoundedRectProfile(x1, y1, x2, y2, cornerRadius, z, cfg.plungeFeed, feed, cfg.safeZ).forEach((line) => lines.push(line));
      return;
    }

    const curve = topStyle === 'flat' ? null : computeTopCurve(x1, x2, y2, topStyle, cfg.riseRatio);

    lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(cfg.safeZ)}`);
    lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
    lines.push(`G1 X${fmt(x2)}   F${Number(feed).toFixed(1)}`);
    if (curve) {
      emitTopCurveGcode(lines, curve, z, feed);
      lines.push(`G1 X${fmt(x1)} Y${fmt(y1)} F${Number(feed).toFixed(1)}`);
    } else {
      lines.push(` Y${fmt(y2)} `);
      lines.push(`X${fmt(x1)}  `);
      lines.push(` Y${fmt(y1)} `);
    }
    lines.push(`G0   Z${fmt(cfg.safeZ)}`);
  });

  carvingRows.forEach((row) => {
    const depth = Number(row.depth) || 0;
    const offset = Number(row.stepOffset) || 0;
    // Clamp here too (single source of truth is clampCarvingExit) so the ramp never
    // leaves the plate when cornerSharpenDistance >= offset.
    const exit = clampCarvingExit(
      row.cornerSharpenDistance === null || row.cornerSharpenDistance === undefined
        ? depth
        : Number(row.cornerSharpenDistance),
      offset,
    );
    lines.push(`M6T${row.toolNo}`);
    lines.push(`M3 S${cfg.spindleSpeed}`);
    if (row.cornerSharpen === false) {
      // Plain closed profile at depth, no corner sharpening ramps.
      const x1 = offsetX + offset;
      const x2 = offsetX + width - offset;
      const y1 = offsetY + offset;
      const y2 = offsetY + height - offset;
      const z = +(cfg.thickness - depth).toFixed(3);
      lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(cfg.safeZ)}`);
      lines.push(`G1 Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
      lines.push(`G1 X${fmt(x2)} Y${fmt(y1)} F${cfg.cutFeed.toFixed(1)}`);
      lines.push(`G1 X${fmt(x2)} Y${fmt(y2)}`);
      lines.push(`G1 X${fmt(x1)} Y${fmt(y2)}`);
      lines.push(`G1 X${fmt(x1)} Y${fmt(y1)}`);
      lines.push(`G0 Z${fmt(cfg.safeZ)}`);
    } else {
      // Lead-in to the TOP-RIGHT profile corner, matching 1_NUMARA.cnc (G0 X236 Y344 Z46).
      lines.push(`G0 X${fmt(offsetX + width - offset)} Y${fmt(offsetY + height - offset)} Z${fmt(cfg.safeZ)}`);
      buildCarvingProfile(width, height, offset, depth, cfg.thickness, exit).forEach((line) => {
        // re-base the profile's absolute coords by the panel offset, and apply the cut feed
        const fed = /^G1 Z/.test(line) ? `${line} F${cfg.plungeFeed.toFixed(1)}` : `${line} F${cfg.cutFeed.toFixed(1)}`;
        lines.push(offsetX === 0 && offsetY === 0 ? fed : fed.replace(/X(-?[\d.]+)/g, (m, n) => `X${fmt(Number(n) + offsetX)}`).replace(/Y(-?[\d.]+)/g, (m, n) => `Y${fmt(Number(n) + offsetY)}`));
      });
      lines.push(`G0 Z${fmt(cfg.safeZ)}`);
    }
    lastEmittedToolNo = row.toolNo;
  });

  derzRows.forEach(({ row, rowIndex }) => {
    const derz = row.derz || {};
    const previousOffsetRows = rows.slice(0, rowIndex).filter((item) => (item.operation || 'offset') !== 'derz');
    const previousOffsets = computeCumOffsets(previousOffsetRows, cfg.offsetMode || 'relative');
    const previousOffset = derz.respectPreviousOffset === false ? 0 : (previousOffsets[previousOffsets.length - 1] || 0);
    const opts = {
      width,
      height,
      yon: derz.yon || 'dikey',
      margin: previousOffset + (Number(derz.margin) || 0),
      spacing: Number(derz.spacing) || Number(row.stepOffset) || 60,
      autoFit: derz.autoFit !== false,
      overshootX: Number(derz.overshootX ?? derz.overshoot) || 1,
      overshootY: Number(derz.overshootY ?? derz.overshoot) || 1,
      edgeExtra: Number(derz.edgeExtra) || 0,
    };
    const positions = computeDerzPositions(opts).positions;
    if (!positions.length) return;
    const z = +(cfg.thickness - Number(row.depth || 0)).toFixed(3);
    const feed = rowFeed(row);
    lines.push(`M6T${row.toolNo}`);
    lines.push(`M3 S${cfg.spindleSpeed}`);
    // The top-edge curve is that of the PART's OUTERMOST offset rectangle (the
    // first offset row), NOT the derz margin box. The arch is established by the
    // outermost cut, so its radius/centre must come from there — using the derz
    // margin or the innermost offset would shrink the radius and misplace the
    // arch centre (2_NUMARA needs r=86 from xl=60/xr=232, not r=46 from
    // xl=100/xr=192).
    const previousOffsetRowsFull = rows.slice(0, rowIndex).filter((item) => (item.operation || 'offset') !== 'derz');
    const shapeOffset = previousOffsetRowsFull.length
      ? computeCumOffsets([previousOffsetRowsFull[0]], 'relative')[0]
      : 0;
    const shapeXl = offsetX + shapeOffset;
    const shapeXr = offsetX + width - shapeOffset;
    const shapeYt = offsetY + height - shapeOffset;
    const curve = topStyle === 'flat' ? null : computeTopCurve(shapeXl, shapeXr, shapeYt, topStyle, cfg.riseRatio);
    positions.forEach((pos) => {
      const vertical = opts.yon === 'dikey';
      const x1 = vertical ? offsetX + pos : offsetX + opts.margin - opts.overshootX;
      const y1 = vertical ? offsetY + opts.margin - opts.overshootY : offsetY + pos;
      const x2 = vertical ? x1 : offsetX + width - opts.margin + opts.overshootX;
      // Vertical divider lines must END on the curve, not at the flat top edge.
      // The curve arc only spans [shapeXl, shapeXr]; outside it (or for flat
      // tops) the line returns to the flat top edge plus overshoot.
      const curvedTop = vertical && curve && pos > shapeXl && pos < shapeXr;
      // shapeXl/shapeYt are already absolute (include offsetX/offsetY), so yEnd
      // returns an absolute Y — do NOT re-add offsetY here.
      const y2 = vertical
        ? (curvedTop ? curve.yEnd(pos) : offsetY + height - opts.margin + opts.overshootY)
        : y1;
      lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(cfg.safeZ)}`);
      lines.push(`G1 Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
      lines.push(`G1 X${fmt(x2)} Y${fmt(y2)} F${Number(feed).toFixed(1)}`);
      lines.push(`G0 Z${fmt(cfg.safeZ)}`);
    });
  });

  if (lastEmittedToolNo !== null) {
    lines.push(`G0Z${fmt(cfg.toolChangeZ)}`);
    lines.push('M5');
  }

  if (!isCombined) {
    lines.push(`G0 X0.00 Y0.00 Z${fmt(cfg.homeZ)}`);
    lines.push(`G0Z${fmt(cfg.homeZ)}`);
    lines.push('X0.00Y0.00');
    lines.push('M5');
    lines.push('M16');
    lines.push('M30');
  }

  return lines.join('\n');
}

/**
 * Exports a visual DXF check file for a Kapak preset. The file is deliberately
 * layered so the shop can inspect nominal, offset, and derz geometry in CAD.
 */
export function buildKapakPresetDxf(width, height, cfg = {}) {
  const rows = cfg.rows || [];
  const topStyle = cfg.topStyle || 'flat';
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '2', '0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS'];
  const layerName = (row, index) => `${row.operation === 'derz' ? 'DERZ' : row.operation === 'carving' ? 'CARVING' : 'OFFSET'}_T${row.toolNo || index + 1}_${index + 1}`;
  const layers = ['0_NOMINAL', ...rows.map(layerName)];
  layers.forEach((layer, index) => lines.push('0', 'LAYER', '2', layer, '70', '0', '62', String((index % 6) + 1), '6', 'CONTINUOUS'));
  lines.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  function addLine(layer, x1, y1, x2, y2) { lines.push('0', 'LINE', '8', layer, '10', Number(x1).toFixed(3), '20', Number(y1).toFixed(3), '30', '0.000', '11', Number(x2).toFixed(3), '21', Number(y2).toFixed(3), '31', '0.000'); }
  // DXF ARC is always stored as a counter-clockwise sweep from group 50 to 51.
  // For a clockwise sweep we swap the endpoints (DXF has no explicit direction flag).
  function addArc(layer, cx, cy, radius, startDeg, endDeg, clockwise = false) {
    const s = clockwise ? endDeg : startDeg;
    const e = clockwise ? startDeg : endDeg;
    lines.push('0', 'ARC', '8', layer, '10', Number(cx).toFixed(3), '20', Number(cy).toFixed(3), '30', '0.000', '40', Number(radius).toFixed(3), '50', Number(s).toFixed(4), '51', Number(e).toFixed(4), '210', '0.0', '220', '0.0', '230', '1.0');
  }
  // Rectangle whose TOP edge follows the curved-top geometry (arc drawn on the layer).
  function addCurvedRect(layer, x1, y1, x2, y2, curve) {
    addLine(layer, x1, y1, x2, y1);
    addLine(layer, x2, y1, x2, curve ? curve.yEnd(x2) : y2);
    addLine(layer, x1, y1, x1, curve ? curve.yEnd(x1) : y2);
    if (curve) {
      const angleAt = (x, y) => (Math.atan2(y - curve.yc, x - curve.xc) * 180) / Math.PI;
      if (curve.topStyle === 'semicircle') {
        // Full half-circle over the top: CCW from the right edge (0deg) to the left (180deg).
        addArc(layer, curve.xc, curve.yc, curve.r, 0, 180, false);
      } else if (curve.topStyle === 'pointed') {
        // Shallow arch: CCW from the left shoulder to the right shoulder.
        addArc(layer, curve.xc, curve.yc, curve.r, angleAt(curve.xl, curve.yShoulder), angleAt(curve.xr, curve.yShoulder), false);
      }
    } else {
      addLine(layer, x2, y2, x1, y2);
    }
  }
  const nominalCurve = topStyle === 'flat' ? null : computeTopCurve(0, width, height, topStyle, cfg.riseRatio);
  addCurvedRect('0_NOMINAL', 0, 0, width, height, nominalCurve);
  let offsetRows = 0;
  rows.forEach((row, index) => {
    const layer = layers[index + 1];
    if (row.operation === 'derz') {
      const derz = row.derz || {};
      const base = offsetRows;
      const yon = derz.yon || 'dikey';
      const margin = (derz.respectPreviousOffset === false ? 0 : base) + (Number(derz.margin) || 0);
      const overshootX = Number(derz.overshootX ?? derz.overshoot) || 1;
      const overshootY = Number(derz.overshootY ?? derz.overshoot) || 1;
      const spacing = Number(derz.spacing) || Number(row.stepOffset) || 60;
      const available = (yon === 'dikey' ? width : height) - margin * 2;
      const count = derz.autoFit === false ? Math.max(0, Math.floor(available / spacing) + 1) : Math.max(0, Math.round(available / spacing) + 1);
      const exact = count > 1 ? available / (count - 1) : spacing;
      const derzCurve = topStyle === 'flat' ? null : computeTopCurve(margin, width - margin, height - margin, topStyle, cfg.riseRatio);
      for (let i = 0; i < count; i++) {
        const pos = margin + i * exact;
        if (yon === 'dikey') {
          // Vertical divider ends on the curve, not the flat top edge.
          const topY = derzCurve && pos > derzCurve.xl && pos < derzCurve.xr ? derzCurve.yEnd(pos) : height - margin + overshootY;
          addLine(layer, pos, margin - overshootY, pos, topY);
        } else {
          addLine(layer, margin - overshootX, pos, width - margin + overshootX, pos);
        }
      }
    } else if (row.operation === 'carving') {
      // Closed single-line carving profile (V-bit) with outward corner ramps.
      const o = Number(row.stepOffset) || 0;
      const x1 = o; const x2 = width - o; const y1 = o; const y2 = height - o;
      addLine(layer, x1, y1, x2, y1);
      addLine(layer, x2, y1, x2, y2);
      addLine(layer, x2, y2, x1, y2);
      addLine(layer, x1, y2, x1, y1);
    } else {
      offsetRows += Number(row.stepOffset) || 0;
      const x1 = offsetRows; const x2 = width - offsetRows; const y1 = offsetRows; const y2 = height - offsetRows;
      const rowRadius = Number(row.cornerRadius);
      if (Number.isFinite(rowRadius) && rowRadius > 0) {
        // Rounded-corner pass: 4 corner arcs + 4 straight edges (mirrors the g-code).
        const r = Math.max(0, Math.min(rowRadius, Math.min((x2 - x1) / 2, (y2 - y1) / 2)));
        addLine(layer, x1, y1 + r, x1, y2 - r);
        addLine(layer, x2, y1 + r, x2, y2 - r);
        addLine(layer, x1 + r, y1, x2 - r, y1);
        addLine(layer, x1 + r, y2, x2 - r, y2);
        addArc(layer, x1 + r, y1 + r, r, 180, 270, false); // BL
        addArc(layer, x1 + r, y2 - r, r, 90, 180, false);  // TL
        addArc(layer, x2 - r, y2 - r, r, 0, 90, false);    // TR
        addArc(layer, x2 - r, y1 + r, r, 270, 360, false); // BR
      } else {
        const rowCurve = topStyle === 'flat' ? null : computeTopCurve(x1, x2, y2, topStyle, cfg.riseRatio);
        addCurvedRect(layer, x1, y1, x2, y2, rowCurve);
      }
    }
  });
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

/**
 * Validates a size against a tool-row set before generating gcode.
 * Only validates missing configuration fields (not narrow dimensions).
 * @returns {string|null} an error message, or null if valid
 */
export function validateKapakSize(width, height, rows, offsetMode = 'relative') {
  if (!rows || rows.length === 0) return 'En az bir bıçak tanımla.';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.toolNo === '' || r.toolNo === undefined || r.toolNo === null) return 'Bir satırda Tool No eksik.';
    if (!Number.isFinite(r.depth)) return `${r.name || 'bir bıçak'} için derinlik eksik.`;
    if (!Number.isFinite(r.stepOffset)) return `${r.name || 'bir bıçak'} için adım offset eksik.`;
  }
  return null;
}

/**
 * Non-fatal warnings for carving rows. Unlike validateKapakSize (which returns
 * an error and blocks generation), these are advisory: the geometry is always
 * clamped safe, but the shop should know a corner ramp got trimmed.
 * @param {Array<{operation?:string, name?:string, depth:number, stepOffset:number, cornerSharpenDistance?:number|null, cornerSharpen?:boolean}>} rows
 * @returns {string[]} warning messages (empty when everything is fine)
 */
export function validateCarvingWarnings(rows) {
  const warnings = [];
  (rows || []).forEach((r, index) => {
    if (r.operation !== 'carving' || r.cornerSharpen === false) return;
    const offset = Number(r.stepOffset) || 0;
    const rawExit = r.cornerSharpenDistance === null || r.cornerSharpenDistance === undefined
      ? Number(r.depth) || 0
      : Number(r.cornerSharpenDistance);
    if (rawExit > offset) {
      const label = r.name || `Carving satırı ${index + 1}`;
      warnings.push(`${label}: carving köşe mesafesi (${rawExit}mm) offsetten (${offset}mm) büyük — köşe rampası ${offset}mm'ye kırpılacak (plaka dışına çıkmaz).`);
    }
  });
  return warnings;
}

/** Parses a batch line like "327-656" or "327-656-2" (trailing qty ignored). */
export function parseBatchLine(line) {
  const parts = line.trim().split('-').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const w = parseFloat(parts[0]);
  const h = parseFloat(parts[1]);
  if (Number.isNaN(w) || Number.isNaN(h)) return null;
  return { width: w, height: h, raw: line.trim() };
}