// Polygon helpers for the çerezlik module. A polygon is an array of [x, y]
// points, implicitly closed (the last point is NOT a copy of the first).
import ClipperLib from 'clipper-lib';

const SCALE = 1000; // Clipper works on integers: 0.001 mm resolution

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return -a / 2;
}

export const area = (pts) => Math.abs(signedArea(pts));

export function bbox(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function pointInPolygon([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Is polygon `inner` inside `outer`? (inner smaller, a vertex test is enough for non-crossing loops) */
export function polygonInside(inner, outer) {
  if (area(inner) >= area(outer)) return false;
  // use a few vertices so one point lying exactly on the boundary cannot fool us
  let votes = 0;
  const n = inner.length, k = Math.min(n, 5);
  for (let i = 0; i < k; i++) if (pointInPolygon(inner[Math.floor((i * n) / k)], outer)) votes++;
  return votes * 2 > k;
}

export const ensureCCW = (pts) => (signedArea(pts) < 0 ? pts.slice().reverse() : pts);
export const ensureCW = (pts) => (signedArea(pts) > 0 ? pts.slice().reverse() : pts);

export function transform(pts, angleDeg, dx = 0, dy = 0) {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s + dx, x * s + y * c + dy]);
}

export function pathLength(pts, closed = true) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return len;
}

const toClip = (pts) => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const fromClip = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);

/**
 * Offsets closed polygons by `delta` mm (positive = grow) with round joins.
 * By default the input is one outer loop plus hole loops in any orientation
 * (the largest is taken as the outer). With `keepOrientation` the loops are
 * used as given (CCW = material, CW = hole), e.g. to offset an earlier result
 * again. Returns loops with outers CCW and holes CW.
 */
export function offset(polys, delta, { arcTol = 0.02, keepOrientation = false } = {}) {
  const co = new ClipperLib.ClipperOffset(2, arcTol * SCALE);
  const paths = polys.filter((p) => p.length >= 3).map(toClip);
  if (!paths.length) return [];
  let fixed = paths;
  if (!keepOrientation) {
    const sorted = paths.map((p) => ({ p, a: Math.abs(ClipperLib.Clipper.Area(p)) })).sort((a, b) => b.a - a.a);
    fixed = sorted.map(({ p }, idx) => (ClipperLib.Clipper.Orientation(p) === (idx === 0) ? p : p.slice().reverse()));
  }
  co.AddPaths(fixed, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, delta * SCALE);
  return out.map(fromClip).filter((p) => p.length >= 3);
}

/** Area of the overlap between two polygon sets (used by tests and the layout check). */
export function intersectionArea(a, b) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(a.map(toClip), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(b.map(toClip), ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (SCALE * SCALE);
}

/** Shortest distance between two polylines (closed loops). */
export function polylineDistance(a, b) {
  let best = Infinity;
  const segDist = (p, q1, q2) => {
    const dx = q2[0] - q1[0], dy = q2[1] - q1[1];
    const L = dx * dx + dy * dy;
    let t = L ? ((p[0] - q1[0]) * dx + (p[1] - q1[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (q1[0] + t * dx), p[1] - (q1[1] + t * dy));
  };
  const one = (P, Q) => {
    for (const p of P) for (let i = 0; i < Q.length; i++) {
      const d = segDist(p, Q[i], Q[(i + 1) % Q.length]);
      if (d < best) best = d;
    }
  };
  one(a, b); one(b, a);
  return best;
}

/** Drops consecutive duplicates and collinear points (tolerance in mm). */
export function cleanLoop(pts, tol = 0.001) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > tol) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= tol) out.pop();
  return out;
}

/** Douglas–Peucker on an open polyline (keeps both ends). */
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = L ? Math.abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / L : Math.hypot(pts[k][0] - x1, pts[k][1] - y1);
      if (d > bd) { bd = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/** Simplifies a closed loop: fewer points, shape within `tol` mm. */
export function simplifyLoop(pts, tol = 0.02) {
  if (pts.length < 8) return pts;
  // split at the vertex farthest from the first so both halves are proper polylines
  let far = 0, fd = -1;
  pts.forEach((p, k) => { const d = (p[0] - pts[0][0]) ** 2 + (p[1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = k; } });
  const a = dp(pts.slice(0, far + 1), tol);
  const b = dp(pts.slice(far).concat([pts[0]]), tol);
  return a.concat(b.slice(1, -1));
}

function clipExec(type, subject, clip) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject.filter((p) => p.length >= 3).map(toClip), ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip.filter((p) => p.length >= 3).map(toClip), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return tree;
}

/** PolyTree → shapes [{outer, holes}] (outer CCW, holes CW). Islands inside holes become shapes of their own. */
function shapes(tree) {
  const out = [];
  const walk = (node) => {
    for (const ch of node.Childs()) {
      if (ch.IsHole()) continue;
      out.push({ outer: ensureCCW(fromClip(ch.Contour())), holes: ch.Childs().map((h) => ensureCW(fromClip(h.Contour()))) });
      for (const h of ch.Childs()) walk(h);
    }
  };
  walk(tree);
  return out;
}

/** Union of loops (nonzero; give every loop CCW). Returns shapes [{outer, holes}]. */
export const union = (loops) => shapes(clipExec(ClipperLib.ClipType.ctUnion, loops.map(ensureCCW), []));

/** subject − clip, both as CCW loops. Returns shapes [{outer, holes}]. */
export const difference = (subject, clip) => shapes(clipExec(ClipperLib.ClipType.ctDifference, subject.map(ensureCCW), clip.map(ensureCCW)));

/** subject ∩ clip. Returns shapes [{outer, holes}]. */
export const intersect = (subject, clip) => shapes(clipExec(ClipperLib.ClipType.ctIntersection, subject.map(ensureCCW), clip.map(ensureCCW)));

/**
 * Rounds the corners of one shape: convex corners by `r` (shrink then grow back),
 * concave corners by `rIn` (grow then shrink). Returns shapes.
 */
export function roundShape(outer, holes = [], r = 0, rIn = 0) {
  let loops = [outer, ...holes];
  if (r > 0) loops = offset(offset(loops, -r), r, { keepOrientation: true });
  if (rIn > 0) loops = offset(offset(loops, rIn, { keepOrientation: true }), -rIn, { keepOrientation: true });
  return shapes(clipExec(ClipperLib.ClipType.ctUnion, loops, []));
}
