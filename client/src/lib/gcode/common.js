// common.js
// Re-export shim: the canonical copy of these shared helpers lives in
// shared/gcode/common.js so the server can import the same primitives without
// reaching into the client source tree. Client-side modules keep importing
// './common.js' exactly as before.

export {
  fmt, fmt3, computeCumOffsets, emitRectCutPath,
  DEFAULT_MACHINE_CONFIG, DEFAULT_PLATE_CONFIG,
} from '../../../../shared/gcode/common.js';

/** Z levels of a through cut: every `stepdown` mm down to Z0 (stepdown 0 / empty = one pass at Z0). */
export function cutLevels(thickness, stepdown) {
  const st = Number(stepdown);
  if (!(st > 0) || st >= thickness) return [0];
  const out = [];
  for (let z = thickness - st; z > 1e-6; z -= st) out.push(+z.toFixed(3));
  out.push(0);
  return out;
}
