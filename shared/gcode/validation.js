// shared/gcode/validation.js
// Physically-safe numeric + geometry validation, shared by client and server.
//
// WHY THIS EXISTS (CNC safety, not style):
// The generators turn user numbers straight into machine motion. Two failure
// classes were reaching the G-code and would have cut real material:
//
//   1. `Number(v) || default` — a legitimate ZERO (depth 0, offset 0, a 0mm
//      margin) is falsy, so it silently became the default. `Number(0) || 5`
//      is 5. A user asking for a 0mm stepover got 5mm.
//   2. Geometry that cannot physically exist after tool compensation — an
//      inner circle smaller than the cutter, or two nested parts closer than
//      the cutter diameter. These produced inverted/negative toolpaths.
//
// Everything here is dependency-free and pure so both the browser bundle and
// the Node server can import the exact same rule.

/**
 * Finite-number parse that PRESERVES a legitimate zero.
 *
 * Returns `null` when the value is absent, blank, or not a finite number, so
 * the caller decides what "missing" means (default vs. rejection) instead of
 * this helper silently substituting a number.
 *
 * @param {*} value
 * @returns {number|null}
 */
export function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Like toFiniteNumber, but a missing value yields `fallback`. Use this where a
 * field genuinely may be omitted and the historical default is part of the
 * machine's proven behaviour. A present zero is still returned as 0.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
export function numOr(value, fallback) {
  const n = toFiniteNumber(value);
  return n === null ? fallback : n;
}

/**
 * Resolves the effective outer-cut gap between two nested parts.
 *
 * Physical rule: the toolpath for a part is its nominal rectangle EXPANDED by
 * the cutter radius on every side (emitRectCutPath). Two adjacent parts
 * therefore need a nominal gap of at least one full cutter DIAMETER so the two
 * compensated toolpaths touch at worst and never interpenetrate. A smaller gap
 * makes the tool cut into the neighbouring part.
 *
 * @param {object} opts
 * @param {number} opts.partGap - nominal clearance the user asked for (mm)
 * @param {number} opts.cutToolDia - outer cutting tool diameter (mm)
 * @param {number} [opts.safetyMargin=0] - extra clearance on top of the diameter
 * @returns {{required:number, ok:boolean, effectiveGap:number}}
 */
export function resolveNestingGap({ partGap, cutToolDia, safetyMargin = 0 }) {
  const gap = numOr(partGap, 0);
  const dia = numOr(cutToolDia, 0);
  const extra = Math.max(0, numOr(safetyMargin, 0));
  const required = dia + extra;
  return {
    required,
    ok: gap >= required,
    effectiveGap: gap,
  };
}

/**
 * Validates the nesting layout against the outer cutting tool BEFORE any
 * toolpath is generated.
 *
 * Returns an error string when the layout is physically unsafe, otherwise
 * `null`. Callers should surface the string verbatim — it names the numbers so
 * the operator can see exactly which value to change.
 *
 * @param {object} opts
 * @param {number} opts.partGap
 * @param {number} opts.cutToolDia
 * @param {boolean} [opts.outerCutEnabled=true] - when off, no outer toolpath
 *   exists and the gap only has to be non-negative
 * @param {number} [opts.safetyMargin=0]
 * @returns {string|null}
 */
export function validateNestingGap({ partGap, cutToolDia, outerCutEnabled = true, safetyMargin = 0 }) {
  const gap = toFiniteNumber(partGap);
  const dia = toFiniteNumber(cutToolDia);

  if (gap === null || gap < 0) {
    return 'Parça aralığı (gap) 0 veya daha büyük bir sayı olmalı.';
  }
  if (!outerCutEnabled) return null;

  // Without a known tool diameter there is nothing to compare against: the
  // caller did not opt into the outer-cut safety check. The GENERATOR still
  // enforces the rule (it always knows cutToolDia) so an unsafe layout cannot
  // reach the machine — this path just avoids inventing a diameter here.
  if (dia === null || dia <= 0) return null;

  const { required } = resolveNestingGap({ partGap: gap, cutToolDia: dia, safetyMargin });
  if (gap < required) {
    return (
      `Parça aralığı (${gap}mm) kesim bıçağı çapından (${dia}mm) küçük olamaz — `
      + `dış kesim bıçağı ${dia}mm çapında olduğu için iki parçanın birbirine girmemesi adına `
      + `en az ${required}mm aralık gerekir.`
    );
  }
  return null;
}

/**
 * Validates a circle (or ring) cut against the tool that will cut it.
 *
 * Physical rule: the OUTER toolpath runs at nominalR + toolR, so the tool's
 * centre circle is bigger than the part — that is correct, the tool hangs
 * outside. The INNER (ring) toolpath runs at innerDia/2 - toolR, because the
 * tool must stay INSIDE the hole. When innerDia <= toolDia this compensated
 * radius is <= 0: the tool cannot fit through the hole, and the generator
 * would emit an arc with a zero or negative radius.
 *
 * The requested dimensions are NEVER silently changed. The geometry is
 * rejected so the operator fixes the drawing.
 *
 * @param {object} opts
 * @param {'solid'|'ring'} opts.mode
 * @param {number} opts.outerDia
 * @param {number} opts.innerDia
 * @param {number} opts.toolDia
 * @returns {string|null} error string, or null when the geometry is cuttable
 */
export function validateCircleGeometry({ mode = 'solid', outerDia, innerDia, toolDia }) {
  const dia = toFiniteNumber(toolDia);
  const outer = toFiniteNumber(outerDia);
  const inner = toFiniteNumber(innerDia);

  if (dia === null || dia <= 0) {
    return 'Bıçak çapı geçerli bir pozitif sayı olmalı.';
  }
  if (outer === null || outer <= 0) {
    return 'Dış çap geçerli bir pozitif sayı olmalı.';
  }
  // The outer toolpath stands off by the tool radius, so a solid disc is
  // always cuttable once the tool diameter is valid — only the INNER ring
  // toolpath can degenerate.
  if (mode === 'ring') {
    if (inner === null || inner <= 0) {
      return 'Halka modunda iç çap geçerli bir pozitif sayı olmalı.';
    }
    if (inner >= outer) {
      return `İç çap (${inner}mm) dış çaptan (${outer}mm) küçük olmalı.`;
    }
    const innerToolpathR = inner / 2 - dia / 2;
    if (innerToolpathR <= 0) {
      return (
        `İç çap (${inner}mm) bıçak çapından (${dia}mm) büyük olmalı — `
        + `${dia}mm bıçak ${inner}mm delikten geçemez. `
        + `İç takım yolu yarıçapı ${(inner / 2 - dia / 2).toFixed(2)}mm olurdu (geçersiz).`
      );
    }
  }
  return null;
}

/**
 * Validates a relief / carving depth against the material thickness.
 *
 * Physical rule: Z0 is the machine table, material top is Z = thickness. A cut
 * depth measured DOWN from the top surface must stay strictly above the table
 * or the tool cuts into the spoilboard/vacuum bed.
 *
 * @param {object} opts
 * @param {number} opts.depth - positive depth measured down from the top
 * @param {number} opts.thickness
 * @param {number} [opts.keepOut=1] - material that must remain below the cut
 * @returns {string|null}
 */
export function validateDepthAgainstThickness({ depth, thickness, keepOut = 1 }) {
  const d = toFiniteNumber(depth);
  const t = toFiniteNumber(thickness);
  if (d === null || d < 0) return 'Derinlik 0 veya daha büyük bir sayı olmalı.';
  if (t === null || t <= 0) return 'Malzeme kalınlığı geçerli bir pozitif sayı olmalı.';
  if (d > t - keepOut) {
    return (
      `Derinlik (${d}mm) malzeme kalınlığı için fazla (${t}mm, en az ${keepOut}mm taşıyıcı pay kalmalı) — `
      + `maksimum ${Math.max(0, t - keepOut)}mm olabilir.`
    );
  }
  return null;
}
