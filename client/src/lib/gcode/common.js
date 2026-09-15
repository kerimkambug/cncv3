// common.js
// Small shared helpers used across every gcode module. Kept dependency-free
// (no DOM, no React) so it can be unit tested or reused server-side.

export function fmt(n) {
  // ArtCAM style: floating-point signed zero shows up as "-0.00" in the real
  // files (e.g. 1_NUMARA.cnc "I-0.00J6.00", 2_NUMARA.cnc "J-0.00"). A tiny
  // negative value rounds to "-0.00" — keep it, the machine treats it as 0.
  return Number(n).toFixed(2);
}

export function fmt3(n) {
  return Number(n).toFixed(3);
}

/**
 * Turns a list of tool rows (each with a stepOffset) into cumulative
 * offsets from the edge, honouring either 'relative' (each row adds to the
 * previous) or 'absolute' (each row's stepOffset IS the offset) mode.
 * @param {Array<{stepOffset:number}>} rows
 * @param {'relative'|'absolute'} mode
 * @returns {number[]} cumulative offset per row, same order as rows
 */
export function computeCumOffsets(rows, mode = 'relative') {
  let cum = 0;
  return rows.map((r) => {
    const step = Number(r.stepOffset) || 0;
    if (mode === 'absolute') {
      cum = step;
    } else {
      cum += step;
    }
    return cum;
  });
}

export function emitRectCutPath(lines, x, y, w, h, radius, targetZ, feed, plunge, safeZ) {
  const x1 = x - radius;
  const y1 = y - radius;
  const x2 = x + w + radius;
  const y2 = y + h + radius;
  lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(safeZ)}`);
  lines.push(`G1 Z${fmt(targetZ)} F${Number(plunge).toFixed(1)}`);
  lines.push(`G1 X${fmt(x2)} F${Number(feed).toFixed(1)}`);
  lines.push(` Y${fmt(y2)} `);
  lines.push(`X${fmt(x1)}  `);
  lines.push(` Y${fmt(y1)} `);
  lines.push(`G0 Z${fmt(safeZ)}`);
}

export const DEFAULT_MACHINE_CONFIG = {
  thickness: 18,
  spindleSpeed: 18000,
  safeZ: 61,
  toolChangeZ: 96,
  homeZ: 96,
  plungeFeed: 3000,
  cutFeed: 6000,
};

export const DEFAULT_PLATE_CONFIG = {
  width: 2100,
  height: 2800,
};
