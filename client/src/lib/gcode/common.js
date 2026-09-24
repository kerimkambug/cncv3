// common.js
// Re-export shim: the canonical copy of these shared helpers lives in
// shared/gcode/common.js so the server can import the same primitives without
// reaching into the client source tree. Client-side modules keep importing
// './common.js' exactly as before.

export {
  fmt, fmt3, computeCumOffsets, emitRectCutPath,
  DEFAULT_MACHINE_CONFIG, DEFAULT_PLATE_CONFIG,
} from '../../../../shared/gcode/common.js';
