// derz.js
// Evenly (or literally) spaced parallel divider lines across a panel, with
// independent "lengthwise" overshoot (how far each line runs past the
// panel in its own direction) and "edge" margin reduction (how much closer
// the outermost lines sit to the edge than the plain margin would place
// them — needed so a round-over bit's point doesn't land exactly on a
// corner).
import { guardZ } from './zGuard.js';
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
 * @param {boolean} [opts.insideFrame=false] - `margin` is a FRAME line (e.g. the inner
 *   V profile), not the first derz: the frame-to-frame span is split into equal
 *   intervals as close to `spacing` as possible and the two lines that would sit
 *   on the frame itself are dropped. Works for any panel width
 *   (1 NUMARA: frame 70, spacing 19 -> 89..203; 3 NUMARA: frame 57, 13.69 -> 70.69..221.31).
 * @param {number} [opts.count] - fixed number of lines (equal split) instead of a spacing
 * @param {boolean} [opts.stagger=false] - lines at the MIDDLE of each equal interval
 *   of the frame-to-frame grid (TABLA model 4: the short upper lines sit halfway
 *   between the long ones)
 * @returns {{positions:number[], exactSpacing:number, span:number, effectiveMargin:number}}
 */
export function computeDerzPositions(opts) {
  const count = Math.floor(Number(opts.count));
  if (count > 0 && !opts._counted) {
    // A fixed line count is just a spacing that yields exactly that many lines.
    const span = (opts.yon === 'dikey' ? opts.width : opts.height) - 2 * (opts.margin - (opts.edgeExtra || 0));
    const intervals = opts.stagger ? count : opts.insideFrame ? count + 1 : Math.max(1, count - 1);
    return computeDerzPositions({ ...opts, spacing: span / intervals, autoFit: true, _counted: true });
  }
  if (opts.stagger) {
    const grid = computeDerzPositions({ ...opts, stagger: false, insideFrame: false, autoFit: true }).positions;
    const mids = grid.slice(1).map((p, i) => (grid[i] + p) / 2);
    return { positions: mids, exactSpacing: grid.length > 1 ? grid[1] - grid[0] : opts.spacing, span: opts.yon === 'dikey' ? opts.width : opts.height, effectiveMargin: opts.margin };
  }
  if (opts.insideFrame) {
    const framed = computeDerzPositions({ ...opts, insideFrame: false, autoFit: true });
    return { ...framed, positions: framed.positions.slice(1, -1) };
  }
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
      // Full precision is kept here. Rounding the position to 3 decimals before
      // the 2-decimal formatting is a double rounding and it does bite: 3 NUMARA's
      // second divider is 84.384615..., which becomes 84.39 via a 3-decimal
      // intermediate while the reference file says 84.38.
      positions.push(effectiveMargin + i * exactSpacing);
    }
  } else {
    for (let pos = effectiveMargin; pos <= span - effectiveMargin + 1e-6; pos += spacing) {
      positions.push(pos);
    }
  }
  return { positions, exactSpacing, span, effectiveMargin };
}

/**
 * Trims one derz line along its own direction (part-local mm). `a`/`b` are the
 * line's start/end as the caller computed them (frame, overshoot, arch...); the
 * row may narrow that:
 *   - derz.lineFromPct / derz.lineToPct: start / end at a percentage of the part
 *     (height for a vertical line, width for a horizontal one) — TABLA model 4's
 *     short upper lines run from 50% to the top;
 *   - derz.stopBox {fromTop, skip}: a vertical line ends `fromTop` mm below the
 *     top edge instead, except the first and last `skip` lines of the row, which
 *     are the box's sides and run on — the kulp box of TABLA model 4
 *     (fromTop 44.5; long lines skip 1, short lines skip 2). Counting lines rather
 *     than millimetres keeps the box on the lines for every door width.
 * @param {number} [index] - the line's index in its row
 * @param {number} [count] - number of lines in the row
 * @returns {[number, number]} trimmed [a, b]
 */
export function trimDerzLine(derz, vertical, pos, a, b, width, height, index = -1, count = 0) {
  const d = derz || {};
  const along = vertical ? height : width;
  let s = a; let e = b;
  const from = Number(d.lineFromPct);
  const to = Number(d.lineToPct);
  if (d.lineFromPct != null && d.lineFromPct !== '' && Number.isFinite(from)) s = (along * from) / 100;
  if (d.lineToPct != null && d.lineToPct !== '' && Number.isFinite(to)) e = (along * to) / 100;
  const box = d.stopBox;
  if (vertical && box && Number(box.fromTop) > 0) {
    const skip = Math.max(0, Math.floor(Number(box.skip) || 0));
    if (index >= skip && index < count - skip) e = Math.min(e, height - Number(box.fromTop));
  }
  return [s, e];
}

/**
 * The horizontal top line of a derz row's stopBox (when `stopBox.line` is set):
 * from the row's first box-side line to its last one, `fromTop` below the top.
 * @returns {{x1:number, x2:number, y:number}|null} part-local
 */
export function derzBoxLine(derz, positions, height) {
  const box = (derz || {}).stopBox;
  if (!box || !box.line || !(Number(box.fromTop) > 0)) return null;
  const skip = Math.max(1, Math.floor(Number(box.skip) || 0));
  if (positions.length < 2 * skip) return null;
  return { x1: positions[skip - 1], x2: positions[positions.length - skip], y: height - Number(box.fromTop) };
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
  return guardZ(lines.join('\n'));
}
