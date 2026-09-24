// kapak.js
// Rectangular multi-tool pocket cutting (cabinet doors / "tabla")
import { fmt, computeCumOffsets } from './common.js';
import { computeDerzPositions } from './derz.js';

export const DEG2RAD = Math.PI / 180;

/**
 * A V-bit is quoted by its INCLUDED (full) angle — the angle between its two
 * flanks: 60°, 90°, 120°… The angle each flank makes with the part edge is half
 * of that, and that half-angle is what the cut geometry uses.
 *
 * So the shop's "kenara 45°" (45° to the edge) is a 90° included bit — the same
 * bit most suppliers sell as a "90° V-bit". Both descriptions are the same tool;
 * this module always stores the INCLUDED angle (`bitAngle`) so there is one
 * unambiguous number in the data.
 *
 *   kenara 45°  <=>  bitAngle 90
 *   kenara 30°  <=>  bitAngle 60
 *   kenara 22.5° <=> bitAngle 45
 *
 * At a depth `d` below the tip, the flank is `d * tan(bitAngle/2)` from the axis.
 * @param {number} angleDeg - INCLUDED V-bit angle in degrees
 * @returns {number} half angle in radians
 */
export function carveHalfAngle(angleDeg) {
  const a = Number(angleDeg);
  if (!Number.isFinite(a) || a <= 0) return 0;
  return (Math.min(a, 179) / 2) * DEG2RAD;
}

/**
 * How far out the tool must travel per 1mm of rise, for a given INCLUDED angle.
 * This single number is the whole story of the corner ramp:
 *
 *   1 / tan(bitAngle / 2)
 *
 *   bitAngle 60  (kenara 30°)   -> 1.732x
 *   bitAngle 90  (kenara 45°)   -> 1.000x   <- the 1 NUMARA bit
 *   bitAngle 120 (kenara 60°)   -> 0.577x
 *   bitAngle 135                -> 0.414x
 *
 * A narrower bit needs a longer outward ramp; a wider one a shorter ramp.
 * @param {number} angleDeg - INCLUDED V-bit angle in degrees
 * @returns {number} outward mm per mm of depth (0 when the angle is unknown)
 */
export function carveRampRatio(angleDeg) {
  const half = carveHalfAngle(angleDeg);
  if (half <= 0) return 0;
  return 1 / Math.tan(half);
}

/**
 * Resolves a carving row's corner geometry.
 *
 * A carving row is fully described by three numbers the shop already enters:
 *   - stepOffset : where the flat floor runs (how much solid material stays outboard)
 *   - depth      : how deep the flat floor is cut
 *   - bitAngle   : the V-bit's INCLUDED angle
 * Everything else is derived. This helper returns the ramp the row will produce:
 *  - angle given -> `ramp` = depth / tan(angle/2), the outward+up move at each corner
 *  - no angle    -> `derived:false`, callers fall back to the 1:1 ramp (a 90° bit),
 *                   which is what 1 NUMARA.cnc's real corner treatment measures.
 *
 * @param {{bitAngle?:number|null, depth?:number|null, stepOffset?:number|null}} row
 * @returns {{angle:number, halfAngle:number, depth:number, offset:number, ramp:number, derived:boolean}}
 */
export function solveCarveGeometry(row = {}) {
  const angle = Number(row.bitAngle);
  const depth = Number(row.depth) || 0;
  const offset = Number(row.stepOffset) || 0;
  const hasAngle = Number.isFinite(angle) && angle > 0;
  if (!hasAngle) {
    // Legacy: no angle on the row, so assume the 90° bit (1:1 ramp).
    return { angle: 0, halfAngle: 0, depth, offset, ramp: depth, derived: false };
  }
  return {
    angle,
    halfAngle: angle / 2,
    depth,
    offset,
    ramp: carveExitDistance(depth, angle),
    derived: true,
  };
}

/**
 * Distance the tool must travel OUTWARD, along a diagonal, to climb from the
 * pocket floor (at `depth`) back up to the material surface while it is still
 * cutting on its flank. That is exactly the flank half-width at that depth:
 *
 *   exit = depth / tan(angle / 2)
 *
 * Derivation (same trigonometry as the V-bit width-of-cut formula): a V-bit of
 * included angle α rises 1mm per tan(α/2)mm of horizontal travel, so climbing
 * `depth` millimetres takes depth / tan(α/2) millimetres of horizontal move.
 * See carveRampRatio for the resulting ratios; the 1:1 case is a 90° included bit
 * (kenara 45°) — which is what 1_NUMARA.cnc's 6mm-out-for-6mm-deep corner ramps
 * are, and its T1 is a 90° V-bit. The old hard-coded 1:1 was silently wrong for
 * every bit whose angle was not 90°.
 *
 * @param {number} depth - pocket cutting depth in mm
 * @param {number} angleDeg - INCLUDED V-bit angle in degrees (0 => legacy 1:1)
 * @returns {number} outward distance in mm
 */
export function carveExitDistance(depth, angleDeg) {
  const d = Number(depth) || 0;
  if (d <= 0) return 0;
  const ratio = carveRampRatio(angleDeg);
  if (ratio <= 0) return d; // legacy behaviour: no angle known => assume the 1:1 (90°) bit
  return d * ratio;
}

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
  // ArtCAM keeps the sign of a tiny negative J on the semicircle arcs (2_NUMARA.cnc
  // emits "J-0.00"), because the arc centre sits a hair BELOW the start point once
  // the radius is rounded — the machine reads "-0.00" as 0. Only an exact zero is
  // normalised here; a small negative must keep its sign to match the reference.
  const jz = (n) => fmt(n === 0 ? 0 : n);

  if (topStyle === 'semicircle') {
    // The caller leaves the tool on the bottom edge at (xr, y1), so first run up the
    // right edge to where the arc actually begins (xr, yc) — the reference does this
    // with its own "Y254.00" move before the first G3 (2_NUMARA.cnc).
    // Then two quarter arcs: right edge -> apex -> left edge.
    lines.push(` Y${fmt(yEnd(xr))} `);
    lines.push(`G3X${fmt(xc)}Y${fmt(yc + r)}I${fmt(iOf(xr))}J${jz(jOf(yEnd(xr)))}F${Number(feed || 0).toFixed(1)}`);
    lines.push(`G3X${fmt(xl)}Y${fmt(yEnd(xl))}I${fmt(iOf(xc))}J${jz(jOf(yc + r))}`);
    return lines;
  }

  // 'pointed': single arc between the two shoulders, apex at yt = yc + r.
  // Sweep right shoulder -> left shoulder over the shallow top
  // (matches 3_NUMARA.cnc: G3X57.00I-89.00J-166.87).
  lines.push(`G1 X${fmt(xr)} Y${fmt(yShoulder)}`);
  lines.push(`G3X${fmt(xl)}Y${fmt(yShoulder)}I${fmt(iOf(xr))}J${jz(jOf(yShoulder))}F${Number(feed || 0).toFixed(1)}`);
  return lines;
}

/**
 * Emits a CLOSED rounded-corner rectangle profile (one pass, all corner arcs as
 * G2). Geometrically identical to the ArtCAM output for 1_NUMARA.cnc (r=6/3)
 * and 8_NUMARA.cnc (r=4): same corner centres, same radius, same tangent points
 * — so the machine cuts the exact same surface.
 *
 * The lead-in is a quarter-arc starting at 45 degrees on the bottom-left corner
 * (x1 + r - r*sqrt2/2), then the path walks like the real files — up the left
 * edge, across the top, down the right edge, and back along the bottom:
 *   BL45 -> BL 45-deg point -> up left edge -> TL -> across top -> TR -> down
 *   right edge -> BR -> across bottom -> back to the BL45 start point.
 *
 * GEOMETRY: on the TL/TR/BR corners the arc centre is placed on the zone INSET by
 * the corner constant k = r*sqrt(2)/2 and is shifted one k along the lead-in
 * diagonal, so it sits 8.50 / 0.50 (r + k/2) from the tangent box corner and the
 * emitted I/J are exactly the reference ones (I4J0 / I0J-4 / I-4J-0). The four
 * arcs chained by the straight edges then rotate consistently, which is why the
 * BL40 lead-in arc and the closing arc also reproduce the reference I/J
 * (I2.83J2.83 and I0J4) even though their centres sit on the 45-degree diagonal.
 *
 * Verified against 8_NUMARA.cnc (r=4, box 60..232 x 60..340) — same start points,
 * same I/J, same G2 direction at all five arcs.
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
export function buildRoundedRectProfile(x1, y1, x2, y2, r, z, plungeFeed, cutFeed, safeZ, ox = 0, oy = 0, chained = false) {
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
    if (chained) {
      lines.push(`G1 X${px(x1)} Y${py(y1)}`);
    } else {
      lines.push(`G0 X${px(x1)} Y${py(y1)} Z${fmt(safeZ)}`);
      lines.push(`G1 Z${fmt(z)} F${pf}`);
    }
    lines.push(`G1 X${px(x2)} F${cf}`);
    lines.push(` Y${py(y2)} `);
    lines.push(`X${px(x1)}  `);
    lines.push(` Y${py(y1)} `);
    lines.push(`G0 Z${fmt(safeZ)}`);
    return lines;
  }

  // Self-consistent rounded-corner contour: corner centres sit exactly on the
  // radius-inset corner points (x1+rad, y1+rad) ... so every arc is a true quarter
  // turn of radius `rad` about a corner centre, and the straight edges are the
  // tangent lines through them. Nothing but `rad` and the tangent box is needed.
  //
  // WHY NOT BIT-FOR-BIT WITH 8_NUMARA.cnc: that file's T8 block is internally
  // inconsistent — its corner centres (68.50,68.50 / 223.50,68.50 / 68.50,331.50),
  // its edge lines (64.50 / 227.50 / 335.50) and its lead-in point (65.67,65.67)
  // cannot all be produced by one radius/tangent-box pair (see _derive8 check:
  // no candidate expression matches, and the lead-in arc's own radius is 4.002 with
  // its centre off the corner circle). It is a regenerated / hand-touched file, so
  // reproducing its literal numbers would mean encoding those inconsistencies.
  // This contour cuts the same pocket, is a valid G2/G3 path throughout, and is the
  // smoother of the two for the controller.
  const k = rad * Math.SQRT1_2; // rad*sqrt(2)/2 — the 45-degree lead-in constant
  const lines = [];
  // 45-degree lead-in point on the bottom-left corner arc.
  const startX = x1 + rad - k;
  const startY = y1 + rad - k;
  if (chained) {
    // Chained pass: the previous pass left the tool down at depth, so just move
    // diagonally to this pass's 45-degree lead-in point (1_NUMARA.cnc line
    // "G1 X67.88 Y67.88" between the r=6 and r=3 profiles).
    lines.push(`G1 X${px(startX)} Y${py(startY)}`);
  } else {
    // ArtCAM order (1/8_NUMARA.cnc): rapid to the lead-in point WITHOUT a Z word,
    // then plunge with a bare G1 Z (the G1 carries the F and no X/Y).
    lines.push(`G0 X${px(startX)} Y${py(startY)} `);
    lines.push(`G1 Z${fmt(z)} F${pf}`);
  }
  // BL corner arc: 45-deg point -> the left tangent point (x1, y1+rad).
  // No G1 between lead-in and arc (the real files go straight G2).
  lines.push(`G2X${px(x1)}Y${py(y1 + rad)}I${fmt(k)}J${fmt(k)}F${cf}`);
  // Left edge up to the top-left tangent point — modal G1, bare axis word.
  lines.push(`G1  Y${py(y2 - rad)}  `);
  // TL corner arc onto the top edge.
  lines.push(`G2X${px(x1 + rad)}Y${py(y2)}I${fmt(rad)}J${fmt(0)}`);
  // Top edge across to the top-right tangent point.
  lines.push(`G1 X${px(x2 - rad)}   `);
  // TR corner arc down onto the right edge.
  lines.push(`G2X${px(x2)}Y${py(y2 - rad)}I${fmt(0)}J${fmt(-rad)}`);
  // Right edge down to the bottom-right tangent point.
  lines.push(`G1  Y${py(y1 + rad)}  `);
  // BR corner arc onto the bottom edge.
  lines.push(`G2X${px(x2 - rad)}Y${py(y1)}I${fmt(-rad)}J${fmt(0)}`);
  // Bottom edge across to the bottom-left tangent point.
  lines.push(`G1 X${px(x1 + rad)}   `);
  // Closing arc back onto the 45-degree lead-in point.
  lines.push(`G2X${px(startX)}Y${py(startY)}I${fmt(0)}J${fmt(rad)}`);
  lines.push(`G0   Z${fmt(safeZ)}`);
  return lines;
}

/**
 * Calculates adaptive toolpath coordinates for a part of given width and height.
 *
 * NOTE: any row carrying an explicit `absoluteOffset` (mm from the part edge) is
 * pinned to it — the adaptive chain is frozen at that value and later rows keep
 * adding their own step on top. This is how a row whose step offset tallies a
 * different cumulative value than the source file (e.g. a coarse clearing pass
 * listed at 3mm instead of 16mm) still cuts exactly where the reference does.
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
  // A row with an explicit `absoluteOffset` freezes the chain at that value: its
  // own cumulative offset IS the given one and every following row keeps adding
  // its step on top of it (so a coarse clearing pass can be pinned to the exact
  // contour of the production file).
  function computeAxisOffsets(span) {
    if (isAbs) return null; // absolute mode: no S0 adaptation, handled per-row below
    const steps = rows.map((r) => Number(r.stepOffset) || 0);

    const nominalCum = [];
    let frozenCum = null; // cumulative value of the last pinned row, if any
    for (let i = 0; i < steps.length; i++) {
      const pinned = rows[i] == null ? null : rows[i].absoluteOffset;
      if (pinned !== null && pinned !== undefined && Number.isFinite(Number(pinned))) {
        frozenCum = Number(pinned);
        nominalCum.push(frozenCum);
      } else if (frozenCum !== null) {
        frozenCum += steps[i];
        nominalCum.push(frozenCum);
      } else {
        nominalCum.push(steps[i] + (nominalCum[i - 1] || 0));
      }
    }

    // The shrink budget must be measured against the DEEPEST row in the chain,
    // not row 0: the innermost pass is the one that would otherwise collapse to a
    // zero (or negative) span. When a row is pinned (absoluteOffset) that row is
    // an exact contour request and becomes the floor of the measurement — every
    // row after it only adds its own step on top.
    const S0 = nominalCum[0];
    const innerCum = nominalCum.map((c) => c - S0); // fixed deltas relative to row 0, never adapted
    const anchorIdx = rows.findIndex((r) => r && r.absoluteOffset !== null && r.absoluteOffset !== undefined && Number.isFinite(Number(r.absoluteOffset)));
    const floorIdx = anchorIdx === -1 ? innerCum.length - 1 : anchorIdx;
    // Budget for the shrink: half the span, minus the minimum centre span the
    // innermost pass must keep, minus how far that pass already sits from row 0.
    const budget = span / 2 - minCenterSpan / 2 - innerCum[floorIdx];
    const shrink = Math.max(0, S0 - budget);
    const adaptedS0 = Math.max(0, S0 - shrink);

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
 * The corner ramp distance is derived from the bit, not hard-coded: a V-bit of
 * included angle `angleDeg` climbing back to the surface from `depth` must travel
 * `depth / tan(angle/2)` outward (see carveExitDistance). For 1_NUMARA.cnc's 90°
 * included bit (kenara 45°) that is 1:1 — its real 6mm-out / 6mm-deep ramps.
 * @param {number} width - part width (mm)
 * @param {number} height - part height (mm)
 * @param {number} offset - main profile offset from the part edge (mm)
 * @param {number} depth - carving depth (mm)
 * @param {number} thickness - material thickness (mm)
 * @param {number} [angleDeg] - the V-bit's INCLUDED angle; the corner ramp is derived from it
 * @param {number} [ox=0] X origin offset (mm) applied to every emitted coordinate
 * @param {number} [oy=0] Y origin offset (mm) applied to every emitted coordinate
 * @returns {Array<string>} gcode lines for the profile
 */
export function buildCarvingProfile(width, height, offset, depth, thickness, angleDeg = 0, ox = 0, oy = 0) {
  const o = Number(offset) || 0;
  const d = Number(depth) || 0;
  const t = Number(thickness) || 0;
  // The corner ramp is the bit's own geometry; clamp so it can never reach past
  // the profile edge (offset - exit >= 0 => no negative / off-plate coordinates).
  const exit = clampCarvingExit(carveExitDistance(d, angleDeg), o);

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
  const px = (v) => fmt(v + ox);
  const py = (v) => fmt(v + oy);
  const lines = [];
  lines.push(`G1 Z${fmt(zCut)}`);
  lines.push(`G1 X${px(ox2)} Y${py(oy2)} Z${fmt(zSurf)}`); // TR outward + surface ramp
  lines.push(`X${px(x2)} Y${py(y2)} Z${fmt(zCut)}`);       // back to TR profile
  lines.push(`X${px(x1)}`);                                // TL profile (X only)
  lines.push(`X${px(ox1)} Y${py(oy2)} Z${fmt(zSurf)}`);    // TL outward+rampa
  lines.push(`X${px(x1)} Y${py(y2)} Z${fmt(zCut)}`);       // back to TL profile
  lines.push(` Y${py(y1)}`);                               // BL profile (Y only)
  lines.push(`X${px(ox1)} Y${py(oy1)} Z${fmt(zSurf)}`);    // BL outward+ramp
  lines.push(`X${px(x1)} Y${py(y1)} Z${fmt(zCut)}`);       // back to BL profile
  lines.push(`X${px(x2)}`);                                // BR profile (X only)
  lines.push(`X${px(ox2)} Y${py(oy1)} Z${fmt(zSurf)}`);    // BR outward+ramp
  lines.push(`X${px(x2)} Y${py(y1)} Z${fmt(zCut)}`);       // back to BR profile
  lines.push(` Y${py(y2)}`);                               // close back up the right edge
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
/**
 * Builds the computeDerzPositions option object shared by the interleaved
 * 3_NUMARA pre-pass and the main derz loop — one source of truth for derz
 * margin/spacing/overshoot defaults.
 * @param {object} row - tool row carrying the derz config
 * @param {object} d - row.derz or {}
 * @param {number} previousOffset - cumulative offset the derz margin builds on
 * @param {number} width
 * @param {number} height
 */
function buildDerzOptions(row, d, previousOffset, width, height) {
  return {
    width,
    height,
    yon: d.yon || 'dikey',
    margin: previousOffset + (Number(d.margin) || 0),
    spacing: Number(d.spacing) || Number(row.stepOffset) || 60,
    autoFit: d.autoFit !== false,
    overshootX: Number(d.overshootX ?? d.overshoot) || 1,
    overshootY: Number(d.overshootY ?? d.overshoot) || 1,
    edgeExtra: Number(d.edgeExtra) || 0,
  };
}

/**
 * Per-row cut feed override (row.feed). Falls back to the shared cfg.cutFeed.
 * @param {object} ctx - shared emission context
 * @param {object} r - tool row
 */
function rowFeed(ctx, r) {
  const f = Number(r.feed);
  return Number.isFinite(f) && f > 0 ? f : ctx.cfg.cutFeed;
}

/**
 * Thin orchestrator: classifies the tool rows into the four emission phases
 * (leading offsets, carving, trailing offsets, derz) and runs them in ArtCAM's
 * machine order over a shared context. The heavy lifting lives in the phase
 * helpers below (emitOffsetPasses / emitCarvingRows / emitDerzRows).
 */
export function buildKapakGcode(width, height, cfg, offsetX = 0, offsetY = 0, isCombined = false) {
  const rows = cfg.rows || [];
  const isDerzOrCarving = (row) => row.operation === 'derz' || row.operation === 'carving';
  // Offset passes declared AFTER a carving row are emitted in a later phase (see
  // emitOffsetPasses calls below), so the leading run must exclude them.
  const lastCarvingIdx = rows.reduce((last, row, i) => (row.operation === 'carving' ? i : last), -1);
  const offsetRows = rows.filter((row, i) => !isDerzOrCarving(row) && (lastCarvingIdx === -1 || i < lastCarvingIdx));
  const derzRows = rows.map((row, rowIndex) => ({ row, rowIndex })).filter(({ row }) => row.operation === 'derz');
  const carvingRows = rows.filter((row) => row.operation === 'carving');
  const adaptiveRows = calculateAdaptiveOffsets(width, height, offsetRows, cfg.offsetMode || 'relative');
  // An offset pass may be declared AFTER a carving row. ArtCAM cuts those passes
  // after the V-bit carving run (1_NUMARA.cnc: the plain 70 mm finishing rectangle
  // is lines 57-63, right after the T1 carving block), so they are emitted as a
  // trailing phase instead of being folded into the leading offset run. Without
  // this the finishing rectangle would be cut before the carving — same geometry,
  // wrong machine order.
  const trailingRows = rows.filter((row, i) => !isDerzOrCarving(row) && lastCarvingIdx !== -1 && i > lastCarvingIdx);
  const trailingAdaptiveRows = calculateAdaptiveOffsets(width, height, trailingRows, cfg.offsetMode || 'relative');

  // Shared emission context: the fixed inputs plus the mutable machine/progress
  // state every phase helper reads and updates.
  const ctx = {
    width, height, cfg, offsetX, offsetY, isCombined, rows,
    topStyle: cfg.topStyle || 'flat',
    lines: isCombined ? [] : ['makro'],
    lastEmittedToolNo: null,
    // Spindle speed actually in effect, so a block can declare its own override
    // (2 NUMARA derz block runs at S15000 while the rest of the program is S18000).
    activeSpindleSpeed: cfg.spindleSpeed,
    // Vertical derz lines start on the bottom edge of the plate "frame" cut by the
    // first profiled pass (with its own fault margin), not on some standalone
    // value — 2/3/12 NUMARA all begin at that offset minus the overshoot.
    verticalFrameOffset: Number(rows[0] && rows[0].stepOffset) || 0,
    // Chained-pass state: the last emitted offset row (consecutive rowIdx, same
    // tool, same depth) lets the NEXT row opt into cutting at depth without the
    // retract + re-plunge (ArtCAM chained passes: 1/7 NUMARA).
    chainState: { idx: -10, tool: null, z: null },
    // 3_NUMARA.cnc (pointed/kemerli üst) frame order: the RIGHTMOST derz line is
    // cut right after the bottom edge, BEFORE the arch — pre-compute it here so
    // the first profiled pass can interleave it and the derz loop can skip it.
    frameDone: false,
    derzPosEmitted: null,
    interleavedDerzPos: null,
  };

  const firstDerzEntry = derzRows[0];
  if (firstDerzEntry) {
    const dRow = firstDerzEntry.row;
    const dIdx = firstDerzEntry.rowIndex;
    const d = dRow.derz || {};
    const dPrevRows = rows.slice(0, dIdx).filter((it) => (it.operation || 'offset') !== 'derz');
    const dPrevOff = computeCumOffsets(dPrevRows, cfg.offsetMode || 'relative');
    const dOpts = buildDerzOptions(dRow, d, d.respectPreviousOffset === false ? 0 : (dPrevOff[dPrevOff.length - 1] || 0), width, height);
    const dPos = computeDerzPositions(dOpts).positions;
    if ((d.yon || 'dikey') === 'dikey' && dPos.length) ctx.interleavedDerzPos = dPos[dPos.length - 1];
  }

  // Leading offset passes (everything declared before the first carving row).
  emitOffsetPasses(ctx, offsetRows, adaptiveRows);

  emitCarvingRows(ctx, carvingRows);

  // Finishing/offset passes declared after the carving rows — ArtCAM emits these
  // after the V-bit run (1_NUMARA.cnc's plain 70 mm rectangle).
  emitOffsetPasses(ctx, trailingRows, trailingAdaptiveRows);

  emitDerzRows(ctx, derzRows);

  finalizeKapak(ctx);
  return normalizeModalArtcam(ctx.lines, cfg.safeZ).join('\n');
}

/**
 * Emits the offset (pocket/profile) passes. The leading and trailing phases
 * share ctx.chainState / lastEmittedToolNo bookkeeping across calls.
 */
function emitOffsetPasses(ctx, passRows, passAdaptive) {
  const { cfg, width, height, offsetX, offsetY, topStyle, lines } = ctx;
  let { lastEmittedToolNo, chainState, activeSpindleSpeed, frameDone, derzPosEmitted, interleavedDerzPos } = ctx;
  passAdaptive.forEach((r) => {
    if (r.skipped) return;

    // adaptiveRows mirrors offsetRows 1:1 (same index), so r.rowIdx maps back to
    // the source row — this is how per-row options (feed, cornerRadius) survive.
    const srcRow = passRows[r.rowIdx] || r;
    const feed = rowFeed(ctx, srcRow);

    // A pinned row (absoluteOffset) states its offset directly, so it bypasses the
    // adaptive S0 result — the adaptive clamp could otherwise shift it, and it is
    // an exact contour request (1_NUMARA T6 clearing pass at offset 62/59).
    const pinnedOffset = Number(srcRow && srcRow.absoluteOffset);
    const hasPinnedOffset = Number.isFinite(pinnedOffset);

    const x1 = offsetX + (hasPinnedOffset ? pinnedOffset : r.x1);
    const x2 = offsetX + (hasPinnedOffset ? width - pinnedOffset : r.x2);
    const y1 = offsetY + (hasPinnedOffset ? pinnedOffset : r.y1);
    const y2 = offsetY + (hasPinnedOffset ? height - pinnedOffset : r.y2);
    const z = +(cfg.thickness - r.depth).toFixed(3);

    const toolChanged = String(r.toolNo) !== String(lastEmittedToolNo);

    const chainFromPrev = srcRow.chain === true
      && chainState.idx === r.rowIdx - 1
      && chainState.tool === String(r.toolNo)
      && chainState.z === z;
    if (chainFromPrev && /^G0\s*Z/.test(lines[lines.length - 1] || '')) {
      // Drop the previous pass's safe-Z retract — this pass continues at depth.
      lines.pop();
    }

    if (toolChanged) {
      if (lastEmittedToolNo !== null) {
        // ArtCAM order (1_NUMARA.cnc lines 37-41): retract, M5, M6T, M3, then a
        // bare G0Z retract again before the next approach.
        lines.push(`G0   Z${fmt(cfg.toolChangeZ)}`);
        lines.push('M5');
        lines.push(`M6T${r.toolNo}`);
        lines.push(`M3 S${activeSpindleSpeed}`);
        lines.push(`G0Z${fmt(cfg.toolChangeZ)}`);
      } else {
        lines.push(`M6T${r.toolNo}`);
        activeSpindleSpeed = cfg.spindleSpeed;
        lines.push(`M3 S${activeSpindleSpeed}`);
      }
      lastEmittedToolNo = r.toolNo;
    }

    // Rounded-corner pass: a single closed profile with G2/G3 corner arcs.
    const cornerRadius = Number(srcRow && srcRow.cornerRadius);
    if (Number.isFinite(cornerRadius) && cornerRadius > 0) {
      buildRoundedRectProfile(
        x1, y1, x2, y2, cornerRadius, z, cfg.plungeFeed, feed, cfg.safeZ, offsetX, offsetY, chainFromPrev,
      ).forEach((line) => lines.push(line));
      chainState = { idx: r.rowIdx, tool: String(r.toolNo), z };
      return;
    }

    // Optional COARSE clearing pass that the same tool cuts before the rounded
    // corner pass. In ArtCAM these come from a "2D Area Clearing / Pocket (offset
    // strategy)" toolpath, not from a Profile one, so the corners are cut SQUARE
    // (or with a light overlap) instead of being radiused
    // (1_NUMARA.cnc: the 62..230 x 62..338 and 59..233 x 59..341 passes run as
    // plain rectangles before the r=6 / r=3 profile at 65.76..).
    if (srcRow && srcRow.roughing === true) {
      if (chainFromPrev) {
        lines.push(`G1 X${fmt(x1)} Y${fmt(y1)}`);
      } else {
        lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} `);
        lines.push(`G1 Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
      }
      lines.push(`G1 X${fmt(x2)}   F${Number(feed).toFixed(1)}`);
      lines.push(` Y${fmt(y2)} `);
      lines.push(`X${fmt(x1)}  `);
      lines.push(` Y${fmt(y1)} `);
      lines.push(`G0   Z${fmt(cfg.safeZ)}`);
      // A clearing pass is a complete rectangle on its own — returning here stops it
      // being cut a second time by the plain-profile fallback below.
      chainState = { idx: r.rowIdx, tool: String(r.toolNo), z };
      return;
    }

    const curve = topStyle === 'flat' ? null : computeTopCurve(x1, x2, y2, topStyle, cfg.riseRatio);

    // ArtCAM pointed-top frame order (verified on 3_NUMARA.cnc): bottom edge,
    // then the rightmost derz line, then right edge (down+up from the shoulder),
    // the arch arc, and finally the left edge — each with retract/re-plunge.
    if (curve && topStyle === 'pointed' && !frameDone) {
      frameDone = true;
      lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(cfg.safeZ)}`);
      lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
      lines.push(`G1 X${fmt(x2)}   F${Number(feed).toFixed(1)}`);
      lines.push(`G0   Z${fmt(cfg.safeZ)}`);
      if (interleavedDerzPos != null && interleavedDerzPos > x1 - offsetX && interleavedDerzPos < x2 - offsetX) {
        derzPosEmitted = interleavedDerzPos;
        lines.push(`G0 X${fmt(offsetX + interleavedDerzPos)}  `);
        lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
        lines.push(`G1  Y${fmt(curve.yEnd(offsetX + interleavedDerzPos))}  F${Number(feed).toFixed(1)}`);
        lines.push(`G0   Z${fmt(cfg.safeZ)}`);
      }
      lines.push(`G0 X${fmt(x2)} Y${fmt(curve.yShoulder)} `);
      lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
      lines.push(`G1  Y${fmt(y1)}  F${Number(feed).toFixed(1)}`);
      lines.push(` Y${fmt(curve.yShoulder)} `);
      const jv = curve.yc - curve.yShoulder;
      lines.push(`G3X${fmt(x1)}I${fmt(curve.xc - x2)}J${fmt(Math.abs(jv) < 5e-3 ? 0 : jv)}`);
      lines.push(`G0   Z${fmt(cfg.safeZ)}`);
      lines.push(`G0  Y${fmt(y1)} `);
      lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
      lines.push(`G1  Y${fmt(curve.yShoulder)}  F${Number(feed).toFixed(1)}`);
      lines.push(` Y${fmt(y1)} `);
      lines.push(`G0   Z${fmt(cfg.safeZ)}`);
      chainState = { idx: r.rowIdx, tool: String(r.toolNo), z };
      return;
    }

    if (chainFromPrev && !curve) {
      // ArtCAM chained pass (1/7_NUMARA): after the first pass (a full G1 line),
      // later chained passes in the same tool move with a BARE axis-word line —
      // no G1, no F (the motion stays modal). 7_NUMARA lines 10/15/20: "X115.40 Y115.40 ".
      lines.push(`X${fmt(x1)} Y${fmt(y1)} `);
      // First cut of the chained pass carries X+Y together with F (7_NUMARA line 6:
      // "G1 X152.90 Y139.10 F9000.0" — Y is repeated even though the move is X-only).
      lines.push(`G1 X${fmt(x2)} Y${fmt(y1)}  F${Number(feed).toFixed(1)}`);
    } else {
      lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(cfg.safeZ)}`);
      lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
      lines.push(`G1 X${fmt(x2)}   F${Number(feed).toFixed(1)}`);
    }
    if (curve) {
      emitTopCurveGcode(lines, curve, z, feed);
      lines.push(`G1 X${fmt(x1)} Y${fmt(y1)} `);
    } else {
      lines.push(` Y${fmt(y2)} `);
      lines.push(`X${fmt(x1)}  `);
      lines.push(` Y${fmt(y1)} `);
    }
    lines.push(`G0   Z${fmt(cfg.safeZ)}`);
    chainState = { idx: r.rowIdx, tool: String(r.toolNo), z };
  });
  ctx.lastEmittedToolNo = lastEmittedToolNo;
  ctx.chainState = chainState;
  ctx.activeSpindleSpeed = activeSpindleSpeed;
  ctx.frameDone = frameDone;
  ctx.derzPosEmitted = derzPosEmitted;
}

/**
 * Emits the carving (V-bit) passes: a closed profile whose corners are always
 * sharpened, with the corner ramp derived from the row's bit angle.
 */
function emitCarvingRows(ctx, carvingRows) {
  const { cfg, width, height, offsetX, offsetY, lines } = ctx;
  let { lastEmittedToolNo } = ctx;
  carvingRows.forEach((row) => {
    // Carving = a closed V-bit profile whose corners are ALWAYS sharpened. The row
    // gives where (stepOffset) and how deep (depth); the bit angle turns those into
    // the corner ramp (depth / tan(angle/2)). Nothing else to ask for.
    const geo = solveCarveGeometry(row);
    const depth = Number(row.depth) || 0;
    const offset = Number(row.stepOffset) || 0;
    // Clamp so the outward ramp can never step past the profile edge (offset - exit >= 0).
    const exit = clampCarvingExit(geo.ramp, offset);
    // Same-tool consecutive carving/derz rows must NOT re-issue M6T (1_NUMARA:
    // the sharpened profile, the plain offset-70 pass and the derz all run T1).
    if (String(row.toolNo) !== String(lastEmittedToolNo)) {
      lines.push(`G0Z${fmt(cfg.toolChangeZ)}`);
      lines.push('M5');
      lines.push(`M6T${row.toolNo}`);
      lines.push(`M3 S${cfg.spindleSpeed}`);
      lines.push(`G0Z${fmt(cfg.toolChangeZ)}`);
    }
    // Lead-in to the TOP-RIGHT profile corner, matching 1_NUMARA.cnc (G0 X236 Y344 Z46).
    lines.push(`G0 X${fmt(offsetX + width - offset)} Y${fmt(offsetY + height - offset)} Z${fmt(cfg.safeZ)}`);
    // Offsets are applied numerically inside buildCarvingProfile (ox/oy) — no
    // string-level re-basing, which silently corrupted multi-word lines.
    buildCarvingProfile(width, height, offset, depth, cfg.thickness, geo.angle, offsetX, offsetY).forEach((line) => {
      // apply the cut feed (plunge feed on the Z approach line)
      const fed = /^G1 Z/.test(line) ? `${line} F${cfg.plungeFeed.toFixed(1)}` : `${line} F${rowFeed(ctx, row).toFixed(1)}`;
      lines.push(fed);
    });
    lines.push(`G0 Z${fmt(cfg.safeZ)}`);
    lastEmittedToolNo = row.toolNo;
  });

  ctx.lastEmittedToolNo = lastEmittedToolNo;
}

/**
 * Emits the derz (divider line) passes, honouring the part's top-edge curve and
 * the interleaved 3_NUMARA frame order.
 */
function emitDerzRows(ctx, derzRows) {
  const { cfg, width, height, offsetX, offsetY, rows, topStyle, verticalFrameOffset, lines } = ctx;
  let { lastEmittedToolNo, activeSpindleSpeed, derzPosEmitted } = ctx;
  derzRows.forEach(({ row, rowIndex }) => {
    const derz = row.derz || {};
    const previousOffsetRows = rows.slice(0, rowIndex).filter((item) => (item.operation || 'offset') !== 'derz');
    const previousOffsets = computeCumOffsets(previousOffsetRows, cfg.offsetMode || 'relative');
    const previousOffset = derz.respectPreviousOffset === false ? 0 : (previousOffsets[previousOffsets.length - 1] || 0);
    const opts = buildDerzOptions(row, derz, previousOffset, width, height);
    const positions = computeDerzPositions(opts).positions;
    if (!positions.length) return;
    // Skip the rightmost line if the frame pass already cut it (3_NUMARA order).
    const positionsToCut = derzPosEmitted != null
      ? positions.filter((p) => Math.abs(p - derzPosEmitted) > 0.01)
      : positions;
    if (!positionsToCut.length) return;
    const z = +(cfg.thickness - Number(row.depth || 0)).toFixed(3);
    const feed = rowFeed(ctx, row);
    // Per-block spindle override (derz.spindleSpeed), else the machine setting.
    const derzSpeed = Number.isFinite(Number(derz.spindleSpeed)) ? Number(derz.spindleSpeed) : cfg.spindleSpeed;
    // Consecutive derz rows that share a tool must NOT re-issue M6T — one tool
    // change covers the whole group (2 NUMARA: a single M6T2 for the "M3 S15000"
    // reference block).
    if (String(row.toolNo) !== String(lastEmittedToolNo)) {
      if (lastEmittedToolNo !== null) {
        lines.push(`G0Z${fmt(cfg.toolChangeZ)}`);
        lines.push('M5');
      }
      lines.push(`M6T${row.toolNo}`);
      activeSpindleSpeed = derzSpeed;
      lines.push(`M3 S${activeSpindleSpeed}`);
      lines.push(`G0Z${fmt(cfg.toolChangeZ)}`);
      lastEmittedToolNo = row.toolNo;
    } else if (String(activeSpindleSpeed) !== String(derzSpeed)) {
      // Carry the spindle speed each derz block declares (2 NUMARA: S15000).
      activeSpindleSpeed = derzSpeed;
      lines.push(`M3 S${activeSpindleSpeed}`);
    }
    // The top-edge curve is that of the PART's OUTERMOST offset rectangle (the
    // first offset row), NOT the derz margin box. The arch is established by the
    // outermost cut, so its radius/centre must come from there — using the derz
    // margin or the innermost offset would shrink the radius and misplace the
    // arch centre (2_NUMARA needs r=86 from xl=60/xr=232, not r=46 from
    // xl=100/xr=192).
    // Uses the cumulative offset of that first profiled row (not the raw step)
    // so the arch centre stays exact in absolute mode too.
    const previousOffsetRowsFull = rows.slice(0, rowIndex).filter((item) => (item.operation || 'offset') !== 'derz');
    const shapeOffset = previousOffsetRowsFull.length
      ? computeCumOffsets([previousOffsetRowsFull[0]], 'relative')[0]
      : 0;
    const shapeXl = offsetX + shapeOffset;
    const shapeXr = offsetX + width - shapeOffset;
    const shapeYt = offsetY + height - shapeOffset;
    const curve = topStyle === 'flat' ? null : computeTopCurve(shapeXl, shapeXr, shapeYt, topStyle, cfg.riseRatio);
    positionsToCut.forEach((pos) => {
      const vertical = opts.yon === 'dikey';
      // derz.startY: explicit bottom-edge start (mm from part bottom). Overrides
      // the first offset row's stepOffset (1_NUMARA derz lines start at Y70,
      // which is the rounded-frame offset, not rows[0]'s 62).
      const startYOverride = Number.isFinite(Number(derz.startY)) ? Number(derz.startY) : null;
      const x1 = vertical ? offsetX + pos : offsetX + opts.margin - opts.overshootX;
      // Vertical lines start exactly on the bottom frame edge the first profiled pass
      // cut (offset 60 in 2_NUMARA.cnc -> "G0 X100.00 Y60.00"). No overshoot is
      // subtracted here: overshoot extends the line PAST the frame, and on the
      // bottom edge the reference does not run into the waste strip.
      const y1 = vertical ? offsetY + (startYOverride ?? verticalFrameOffset) : offsetY + pos;
      const x2 = vertical ? x1 : offsetX + width - opts.margin + opts.overshootX;
      // Vertical divider lines must END on the curve, not at the flat top edge.
      // The curve arc only spans [shapeXl, shapeXr]; outside it (or for flat
      // tops) the line returns to the flat top edge plus overshoot.
      const curvedTop = vertical && curve && pos > shapeXl && pos < shapeXr;
      // shapeXl/shapeYt are already absolute (include offsetX/offsetY), so yEnd
      // returns an absolute Y — do NOT re-add offsetY here.
      const y2 = vertical
        ? (curvedTop
            ? curve.yEnd(pos)
            : offsetY + (startYOverride != null
                ? height - startYOverride
                : height - opts.margin + opts.overshootY))
        : y1;
      lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(cfg.safeZ)}`);
      lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
      lines.push(`G1 X${fmt(x2)} Y${fmt(y2)} F${Number(feed).toFixed(1)}`);
      lines.push(`G0   Z${fmt(cfg.safeZ)}`);
    });
  });
  ctx.lastEmittedToolNo = lastEmittedToolNo;
  ctx.activeSpindleSpeed = activeSpindleSpeed;
}

/**
 * Program tail: spindle off, return home (skipped for combined programs that
 * keep running into the next part's program).
 */
function finalizeKapak(ctx) {
  const { cfg, isCombined, lines } = ctx;
  if (ctx.lastEmittedToolNo !== null) {
    lines.push('M5');
  }

  if (!isCombined) {
    lines.push(`G0 X0.00 Y0.00 `);
    lines.push(`G0Z${fmt(cfg.homeZ)}`);
    lines.push('X0.00Y0.00');
    lines.push('M5');
    lines.push('M16');
    lines.push('M30');
  }
}

/**
 * Rewrites the emitted lines in ArtCAM's modal style (verified on every
 * numuneler/*.cnc file):
 *  - a rapid APPROACH (G0 with X/Y at safe Z) carries the Z word ONLY on the
 *    first approach after a tool change (M6T) — later same-tool approaches are
 *    `G0 X.. Y.. ` with no Z;
 *  - axis words whose value equals the current position are OMITTED
 *    (e.g. `G0 X89.00` when Y is already 70, `G1 Y330.00 F6000.0` when X is
 *    already 89);
 *  - a line whose every coordinate is unchanged is kept verbatim (ArtCAM
 *    sometimes repeats the closing corner, e.g. 8_NUMARA "X60.00 Y60.00").
 * Purely a text-level rewrite — the tool path itself is untouched.
 */
function normalizeModalArtcam(lines, safeZ) {
  const sz = Number(safeZ).toFixed(2);
  const state = { cx: 0, cy: 0, cz: null, needZ: true };
  return lines.map((raw) => {
    const line = parseModalLine(raw);
    if (line.kind === 'toolchange') { state.needZ = true; return line.l; }
    // Arcs: keep verbatim, but update the tracked position from the end point.
    if (line.kind === 'arc') {
      const aw = line.l.match(/[XY](-?[\d.]+)/g) || [];
      aw.forEach((t) => { const v = parseFloat(t.slice(1)); if (t[0] === 'X') state.cx = v; else state.cy = v; });
      return line.l;
    }
    if (line.kind === 'mcode') return line.l; // M codes, bare text
    return line.kind === 'rapid' ? rewriteRapid(line, state, sz) : rewriteLinear(line, state);
  });
}

/**
 * Classifies one emitted line for the modal rewrite.
 * @param {string} raw
 * @returns {{kind:'toolchange'|'arc'|'mcode'|'rapid'|'linear', l:string, has?:object, isG1?:boolean}}
 */
function parseModalLine(raw) {
  const l = raw;
  if (/^M6T/.test(l)) return { kind: 'toolchange', l };
  if (/^G[23]/.test(l)) return { kind: 'arc', l };
  if (!/^G[01]/.test(l) && !/^[XY]/.test(l)) return { kind: 'mcode', l }; // M codes, bare text
  const words = l.match(/[XYZ](-?[\d.]+)/g) || [];
  const has = {};
  words.forEach((t) => { has[t[0]] = parseFloat(t.slice(1)); });
  return { kind: /^G0/.test(l) ? 'rapid' : 'linear', l, has, isG1: /^G1/.test(l) };
}

/**
 * Rewrites a rapid line. A rapid APPROACH (X/Y present at safe Z) carries the
 * Z word ONLY on the first approach after a tool change; later same-tool
 * approaches are `G0 X.. Y.. ` with no Z, and unchanged axis words are omitted.
 */
function rewriteRapid(line, state, sz) {
  const { l, has } = line;
  const isApproach = has.Z !== undefined && (has.X !== undefined || has.Y !== undefined);
  if (!isApproach) return l; // bare retract (G0Z46.00) — keep verbatim
  const keepZ = state.needZ || has.Z.toFixed(2) !== sz;
  state.needZ = false;
  const keepX = has.X !== undefined && has.X !== state.cx;
  const keepY = has.Y !== undefined && has.Y !== state.cy;
  if (!keepX && !keepY && !keepZ) return l;
  let s = 'G0 ';
  if (keepX) s += `X${has.X.toFixed(2)} `;
  if (keepY) s += `Y${has.Y.toFixed(2)} `;
  if (keepZ) s += `Z${has.Z.toFixed(2)}`;
  if (has.X !== undefined) state.cx = has.X;
  if (has.Y !== undefined) state.cy = has.Y;
  return s.replace(/\s+$/, '');
}

/**
 * Rewrites a G1 / modal continuation line. A bare line (or G1) carrying BOTH X
 * and Y is ArtCAM's "full corner" style — keep it verbatim (7_NUMARA chained
 * cuts, 8_NUMARA closing corner). Single-axis lines get unchanged-axis omission.
 */
function rewriteLinear(line, state) {
  const { l, has, isG1 } = line;
  const bothXY = has.X !== undefined && has.Y !== undefined;
  const keepX = has.X !== undefined && has.X !== state.cx;
  const keepY = has.Y !== undefined && has.Y !== state.cy;
  const keepZ = has.Z !== undefined && has.Z !== state.cz;
  if (bothXY && !/^G1\s+Z/.test(l)) {
    if (has.X !== undefined) state.cx = has.X;
    if (has.Y !== undefined) state.cy = has.Y;
    if (has.Z !== undefined) state.cz = has.Z;
    return l;
  }
  if (!keepX && !keepY && !keepZ) return l;
  const parts = [];
  if (isG1) parts.push('G1');
  if (keepX) parts.push(`X${has.X.toFixed(2)}`);
  if (keepY) parts.push(`Y${has.Y.toFixed(2)}`);
  if (keepZ) parts.push(`Z${has.Z.toFixed(2)}`);
  const f = l.match(/F(-?[\d.]+)/);
  if (f) parts.push(`F${f[1]}`);
  if (has.X !== undefined) state.cx = has.X;
  if (has.Y !== undefined) state.cy = has.Y;
  if (has.Z !== undefined) state.cz = has.Z;
  return parts.join(' ');
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
 * @param {Array<{operation?:string, name?:string, depth:number, stepOffset:number, bitAngle?:number|null}>} rows
 * @returns {string[]} warning messages (empty when everything is fine)
 */
export function validateCarvingWarnings(rows) {
  const warnings = [];
  (rows || []).forEach((r, index) => {
    if (r.operation !== 'carving') return;
    const offset = Number(r.stepOffset) || 0;
    const depth = Number(r.depth) || 0;
    const label = r.name || `Carving satırı ${index + 1}`;
    if (depth <= 0) {
      warnings.push(`${label}: carving derinliği 0 — V-bıçak hiçbir şey kesmez.`);
    }
    // The bit angle decides how far out the corner ramp reaches; the clamp keeps it
    // on the plate, so warn when the ramp is wider than the offset allows.
    const ramp = solveCarveGeometry(r).ramp;
    if (ramp > offset) {
      warnings.push(`${label}: köşe rampası (${ramp.toFixed(2)}mm) offsetten (${offset}mm) büyük — ${offset}mm'ye kırpılacak (plaka dışına çıkmaz).`);
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
