// circle.js
// Solid-circle and ring (annulus) cutting. Two production fixes are baked
// in here, both discovered against real hardware output:
//  1. The circle's CENTER must be computed from the NOMINAL radius only —
//     adding the tool radius to the center offset (as well as to the
//     toolpath radius) double-compensates and shifts the whole circle.
//  2. In ring mode, the INNER circle is cut before the OUTER one, so the
//     part stays anchored to the surrounding stock while the hole is cut
//     (cutting the outer perimeter first frees the part and lets it shift).
import { fmt } from './common.js';

/**
 * @param {object} p - { mode:'solid'|'ring', outerDia, innerDia, left, bottom, toolDia, toolNo, depth }
 * @returns {object} resolved geometry: { centerX, centerY, outerR, innerR, toolR }
 */
export function resolveCircleParams(p) {
  const toolR = p.toolDia / 2;
  const nominalR = p.outerDia / 2;
  const centerX = p.left + nominalR;
  const centerY = p.bottom + nominalR;
  const outerR = nominalR + toolR;
  const innerR = p.mode === 'ring' ? (p.innerDia / 2 - toolR) : null;
  return { centerX, centerY, outerR, innerR, toolR };
}

export function buildCircleGcode(p, cfg) {
  const { centerX, centerY, outerR, innerR } = resolveCircleParams(p);
  const z = +(cfg.thickness - p.depth).toFixed(3);
  const lines = ['makro'];
  lines.push(`M6T${p.toolNo}`);
  lines.push(`M3 S${cfg.spindleSpeed}`);

  // Full circle as two 180° arcs (G2, clockwise). Most controllers reject a
  // single G2/G3 whose start/end point are identical, so we split the
  // circle at the 3 o'clock / 9 o'clock points. I/J are incremental
  // (relative to the arc's own start point), pointing toward the center.
  function cutLoop(r) {
    const startX = centerX + r, startY = centerY;
    const midX = centerX - r, midY = centerY;
    lines.push(`G0 X${fmt(startX)} Y${fmt(startY)} Z${fmt(cfg.safeZ)}`);
    lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
    lines.push(`G2 X${fmt(midX)} Y${fmt(midY)} I${fmt(-r)} J0.00   F${cfg.cutFeed.toFixed(1)}`);
    lines.push(`G2 X${fmt(startX)} Y${fmt(startY)} I${fmt(r)} J0.00`);
    lines.push(`G0   Z${fmt(cfg.safeZ)}`);
  }

  if (p.mode === 'ring') {
    cutLoop(innerR); // inner first — keeps the ring anchored
  }
  cutLoop(outerR);

  lines.push('M5');
  lines.push(`G0 X0.00 Y0.00 Z${fmt(cfg.homeZ)}`);
  lines.push(`G0Z${fmt(cfg.homeZ)}`);
  lines.push('X0.00Y0.00');
  lines.push('M5');
  lines.push('M16');
  lines.push('M30');
  return lines.join('\n');
}
