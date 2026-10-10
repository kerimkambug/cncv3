// Re-export shim: the Z guard lives in shared/gcode/zGuard.js so the server's
// generators use the very same check.
export { guardZ, minZ } from '../../../../shared/gcode/zGuard.js';
