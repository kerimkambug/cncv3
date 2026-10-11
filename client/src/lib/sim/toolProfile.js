// Custom tool shapes (kulp, tabla bıçağı…) drawn in AutoCAD.
//
// The drawing is the tool's side view (its silhouette, or only the right half
// of it), tip down. What the simulation needs is the tool's lower surface: for
// every distance d from the axis, how high above the tip the tool's lowest
// point at d is. That is the lower envelope of the drawing, taken on both
// sides of the axis.
import { parseDxf } from '../cerezlik/dxf.js';

const SAMPLES = 240;

/** Every straight piece of the drawing (arcs are already short chords). */
function segmentsOf(polys) {
  const segs = [];
  for (const p of polys) {
    const n = p.pts.length;
    for (let i = 0; i + 1 < n; i++) segs.push([p.pts[i], p.pts[i + 1]]);
    if (p.closed && n > 2) segs.push([p.pts[n - 1], p.pts[0]]);
  }
  return segs;
}

/** Lowest Y where the drawing crosses the vertical line x = X (Infinity if it does not). */
function lowestAt(segs, X) {
  let best = Infinity;
  for (const [[x0, y0], [x1, y1]] of segs) {
    if ((X < Math.min(x0, x1) - 1e-9) || (X > Math.max(x0, x1) + 1e-9)) continue;
    const y = Math.abs(x1 - x0) < 1e-9 ? Math.min(y0, y1) : y0 + ((y1 - y0) * (X - x0)) / (x1 - x0);
    if (y < best) best = y;
  }
  return best;
}

/** Drops points that lie (within `tol`) on the straight line between the points kept around them. */
function simplify(pts, tol = 0.005) {
  const out = [pts[0]];
  let start = 0;
  const fits = (a, c) => {
    const [ax, ay] = pts[a], [cx, cy] = pts[c];
    for (let i = a + 1; i < c; i++) {
      const [bx, by] = pts[i];
      if (Math.abs(ay + ((cy - ay) * (bx - ax)) / (cx - ax || 1) - by) > tol) return false;
    }
    return true;
  };
  for (let i = 2; i < pts.length; i++) {
    if (!fits(start, i)) { start = i - 1; out.push(pts[start]); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Tool profile from a drawing.
 * Axis: X=0 of the drawing when the drawing reaches it (a half profile drawn
 * from the axis, or a whole silhouette centred on 0); otherwise the middle of
 * the drawing (a whole silhouette drawn anywhere).
 * @param {{loops:{pts:number[][],closed:boolean}[], chains:{pts:number[][],closed:boolean}[]}} drawing
 * @returns {{profile:number[][], dia:number, height:number, axis:'x0'|'center'}}
 */
export function profileFromDrawing(drawing) {
  const segs = segmentsOf([...drawing.loops, ...drawing.chains]);
  if (!segs.length) throw new Error('Çizimde çizgi yok.');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of segs) for (const [x, y] of s) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const span = maxX - minX;
  const nearZero = Math.max(0.05, span * 0.01);
  const reachesAxis = minX <= nearZero && maxX >= -nearZero;
  const axisX = reachesAxis ? 0 : (minX + maxX) / 2;
  const R = Math.max(Math.abs(maxX - axisX), Math.abs(minX - axisX));
  if (!(R > 0.05)) throw new Error('Çizim çok dar; bıçağın yan görünüşünü çizin.');

  // lower envelope over both sides; nudge the ends inwards so the outer edge still counts
  const raw = [];
  for (let k = 0; k <= SAMPLES; k++) {
    const d = Math.min(R * (k / SAMPLES), R - 1e-6);
    const y = Math.min(lowestAt(segs, axisX + d), lowestAt(segs, axisX - d));
    raw.push([R * (k / SAMPLES), y]);
  }
  // gaps (a side that was not drawn here): take the neighbours' value
  for (let k = 0; k < raw.length; k++) {
    if (Number.isFinite(raw[k][1])) continue;
    let a = k - 1; while (a >= 0 && !Number.isFinite(raw[a][1])) a--;
    let b = k + 1; while (b < raw.length && !Number.isFinite(raw[b][1])) b++;
    const ya = a >= 0 ? raw[a][1] : raw[b]?.[1], yb = b < raw.length ? raw[b][1] : ya;
    raw[k][1] = Math.min(ya ?? Infinity, yb ?? Infinity);
  }
  if (!raw.every(([, y]) => Number.isFinite(y))) throw new Error('Bıçağın alt hattı okunamadı.');
  const tip = Math.min(...raw.map(([, y]) => y));
  const profile = simplify(raw.map(([d, y]) => [+d.toFixed(3), +(y - tip).toFixed(3)]));
  // the drawing itself, axis at 0 and tip at 0, for the preview (at most ~600 points)
  const polys = [...drawing.loops, ...drawing.chains];
  const total = polys.reduce((n, p) => n + p.pts.length, 0);
  const step = Math.max(1, Math.ceil(total / 600));
  const outline = polys.map((p) => ({
    closed: !!p.closed,
    pts: p.pts.filter((_, i) => i % step === 0 || i === p.pts.length - 1).map(([x, y]) => [+(x - axisX).toFixed(2), +(y - tip).toFixed(2)]),
  }));
  return { profile, outline, dia: +(2 * R).toFixed(3), height: +(maxY - tip).toFixed(2), axis: reachesAxis ? 'x0' : 'center' };
}

/** Tool profile straight from a DXF file's text. */
export function profileFromDxf(text) {
  const drawing = parseDxf(text);
  return { ...profileFromDrawing(drawing), warnings: drawing.warnings };
}
