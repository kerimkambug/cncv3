// derz.js
// Evenly (or literally) spaced parallel divider lines across a panel, with
// independent "lengthwise" overshoot (how far each line runs past the
// panel in its own direction) and "edge" margin reduction (how much closer
// the outermost lines sit to the edge than the plain margin would place
// them — needed so a round-over bit's point doesn't land exactly on a
// corner).
import { fmt } from './common.js';

/**
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {'dikey'|'yatay'} opts.yon
 * @param {number} opts.margin
 * @param {number} opts.spacing - desired spacing
 * @param {number} opts.overshoot - lengthwise overshoot past the panel edge
 * @param {number} opts.edgeExtra - shrinks the effective margin for the outermost lines
 * @param {boolean} opts.autoFit - if true, spacing is auto-rounded to fit evenly edge-to-edge
 * @returns {{positions:number[], exactSpacing:number, span:number, effectiveMargin:number}}
 */
export function computeDerzPositions(opts) {
  const { width, height, yon, margin, spacing, edgeExtra = 0, autoFit = true } = opts;
  const span = yon === 'dikey' ? width : height;
  const effectiveMargin = margin - edgeExtra;
  const availableLength = span - 2 * effectiveMargin;

  if (availableLength <= 0) {
    return { positions: [], exactSpacing: spacing, span, effectiveMargin };
  }

  let positions = [];
  let exactSpacing = spacing;

  if (autoFit) {
    const numIntervals = Math.max(1, Math.round(availableLength / spacing));
    exactSpacing = availableLength / numIntervals;
    for (let i = 0; i <= numIntervals; i++) {
      positions.push(+(effectiveMargin + i * exactSpacing).toFixed(3));
    }
  } else {
    for (let pos = effectiveMargin; pos <= span - effectiveMargin + 1e-6; pos += spacing) {
      positions.push(+pos.toFixed(3));
    }
  }
  return { positions, exactSpacing, span, effectiveMargin };
}

export function buildDerzGcode(opts, cfg) {
  const { width, height, yon, toolNo, depth, overshoot, outerFrame } = opts;
  const { positions } = computeDerzPositions(opts);
  if (positions.length === 0) throw new Error('Bu ayarlarla hiç çizgi üretilmedi.');

  const z = +(cfg.thickness - depth).toFixed(3);
  const lines = ['makro'];
  lines.push(`M6T${toolNo}`);
  lines.push(`M3 S${cfg.spindleSpeed}`);

  positions.forEach((pos, i) => {
    let x1, y1, x2, y2;
    if (yon === 'dikey') {
      x1 = pos; x2 = pos;
      y1 = -overshoot; y2 = height + overshoot;
    } else {
      y1 = pos; y2 = pos;
      x1 = -overshoot; x2 = width + overshoot;
    }
    if (i === 0) {
      lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(cfg.safeZ)}`);
    } else {
      lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} `);
    }
    lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
    lines.push(`G1 X${fmt(x2)} Y${fmt(y2)}   F${cfg.cutFeed.toFixed(1)}`);
    lines.push(`G0   Z${fmt(cfg.safeZ)}`);
  });

  if (outerFrame) {
    lines.push(`G0 X0.00 Y0.00 `);
    lines.push(`G1   Z0.00 F${cfg.plungeFeed.toFixed(1)}`);
    lines.push(`G1 X${fmt(width)} Y0.00   F${cfg.cutFeed.toFixed(1)}`);
    lines.push(` Y${fmt(height)} `);
    lines.push(`X0.00  `);
    lines.push(` Y0.00 `);
    lines.push(`G0   Z${fmt(cfg.safeZ)}`);
  }

  lines.push(`G0 X0.00 Y0.00 Z${fmt(cfg.homeZ)}`);
  lines.push(`G0Z${fmt(cfg.homeZ)}`);
  lines.push('X0.00Y0.00');
  lines.push('M5');
  lines.push('M16');
  lines.push('M30');
  return lines.join('\n');
}
