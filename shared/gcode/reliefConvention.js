// shared/gcode/reliefConvention.js
// THE canonical definition of the relief Z coordinate system.
//
// Two relief implementations exist in this repository:
//
//   1. client/src/lib/gcode/relief.js  — buildReliefGcodeFromDepthGrid()
//      ACTIVE. This is what the ReliefGenerator UI calls (generateGcode) in the
//      browser; there is no fetch() to the relief API anywhere in client/src.
//
//   2. server/services/reliefGcode.js  — generateReliefGcodeFromGrid()
//      Reachable only via POST /api/relief/generate, which NO frontend code
//      calls. It has its own test suite (server/services/reliefGcode.test.js)
//      that passes. Treated as a LEGACY/unwired endpoint: retained, documented,
//      and pinned to the shared convention below rather than deleted, because a
//      deployment may drive it headlessly.
//
// They are NOT byte-identical, and the differences are recorded here so nobody
// has to rediscover them:
//
//   | aspect            | client (active)                 | server (legacy)          |
//   |-------------------|---------------------------------|--------------------------|
//   | grid layout       | FLAT buffer, cols*rows          | ARRAY OF ROWS            |
//   | sampling          | bilinear + gradient             | nearest row/col          |
//   | ballnose comp.    | yes (calculateCompensatedZ)     | no                       |
//   | Z smoothing       | smoothZTrack + simplify         | none                     |
//   | direction         | x / y / cross (cross = both)    | x / y only               |
//   | outer cut         | inline, same tool feed          | emitRectCutPath helper   |
//   | stepover source   | physical mm, independent of grid| derived from grid extent |
//
// What they MUST agree on — and now do, by importing this module — is the
// coordinate convention below. Anything that changes it must change it here.

/**
 * ZERO-TO-MATERIAL CONVENTION (identical in both relief generators):
 *
 *   Z0                = the machine table / material BOTTOM (vacuum bed).
 *   Z = thickness     = the material TOP surface, uncut.
 *   depthRatio 0      = the deepest point of the relief.
 *   depthRatio 1      = the top surface, untouched.
 *
 * The two generators DO disagree on one thing, and it is a real semantic
 * difference rather than a bug in either:
 *
 *   client depthGrid value: 0 = deepest, 1 = top surface
 *   server depthGrid value: 0 = top surface, 1 = deepest
 *
 * The client reads an image where black (0) means "carve deepest" and white
 * (255) means "leave the surface", which is how the depth-map file is authored.
 * The server's grid came from an internal pipeline where 1 already meant "full
 * depth". Both are therefore expressed through the SAME helper by passing the
 * value that means "1 = top surface", which is what the convention below is
 * defined in terms of.
 *
 * The cut moves DOWN from the top surface and the toolpath Z is:
 *
 *     Z = thickness - (1 - surfaceRatio) * maxDepth
 *
 * so surfaceRatio 0 is the deepest cut (thickness - maxDepth) and surfaceRatio
 * 1 is the untouched top surface (thickness). This stays strictly above Z0 as
 * long as maxDepth < thickness (see validateDepthAgainstThickness in
 * validation.js).
 *
 * The STL exporter uses the SAME physical axes but a different ORIGIN for
 * presentation: it models a solid whose bottom face sits at Z=0 and whose upper
 * relief surface is at `baseThickness + depthRatio * maxDepth` (see
 * stlExporter.js getPoint). That is a MODEL in its own right — the exported
 * solid's height above its own base — not a machine coordinate. Machine Z and
 * STL Z are related by:
 *
 *     machineZ(surfaceRatio) = thickness - (1 - surfaceRatio) * maxDepth
 *     stlZ(surfaceRatio)     = baseThickness + (1 - surfaceRatio) * maxDepth
 *
 * and the UI is what keeps them physically consistent: ReliefGenerator passes
 * `min(maxDepth, thickness * 0.92)` as the STL maxDepth and
 * `thickness - thatMaxDepth` as its baseThickness, so the STL's own base
 * thickness equals the uncut material left under the deepest cut. For the same
 * depthRatio the two surfaces are then congruent.
 *
 * This module exists so that convention is written down ONCE.
 */

/** Fraction of the material thickness that must remain below the deepest cut. */
export const RELIEF_KEEP_OUT_MM = 1;

/**
 * Machine Z for a relief sample.
 * @param {number} surfaceRatio - 1 = top surface, 0 = deepest cut
 * @param {number} thickness - material top, in machine Z
 * @param {number} maxDepth - depth of the deepest cut, measured DOWN from top
 * @returns {number} machine Z for the sample
 */
export function reliefMachineZ(surfaceRatio, thickness, maxDepth) {
  const r = Math.max(0, Math.min(1, Number(surfaceRatio)));
  // surfaceRatio 1 = untouched top (Z = thickness).
  // surfaceRatio 0 = deepest cut  (Z = thickness - maxDepth).
  return Number(thickness) - (1 - r) * Number(maxDepth);
}

/**
 * STL model Z for a relief sample (solid sits on its own Z=0 base).
 * @param {number} surfaceRatio - 1 = top surface, 0 = deepest cut
 * @param {number} baseThickness - solid base height under the deepest cut
 * @param {number} maxDepth
 * @returns {number}
 */
export function reliefStlZ(surfaceRatio, baseThickness, maxDepth) {
  const r = Math.max(0, Math.min(1, Number(surfaceRatio)));
  return Number(baseThickness) + (1 - r) * Number(maxDepth);
}
