// features.js
// Extra kapak operations that are not a plain offset rectangle, a carving
// profile or a derz grid. Every builder here is PURE geometry: it takes the
// part size, the row and the material thickness and returns part-local
// polylines `[{ x, y, z }, ...]` (z = machine Z, material bottom = 0). The
// G-code emitter (kapak.js) and nesting turn the same polylines into moves, so
// a feature is defined exactly once.
//
//   tarama  — rectangular pocket / area clearing between two offsets
//   sablon  — free toolpaths (ornaments, extension lines) anchored to the
//             nearest door edges, so they follow any door size

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Rectangular pocket (area clearing) with concentric passes.
 *
 * The cleared region is bounded by two offsets measured from the part edge:
 * `stepOffset` is the OUTER boundary of the material to remove and
 * `innerOffset` the inner one (an island that stays; omit / 0 = clear the whole
 * centre, as in model 11). The tool centre stays `toolDiameter/2` inside the
 * region, passes step by `stepover` (default 80% of the diameter, at most the
 * diameter so no ridge is left). Passes run from the inside out, like ArtCAM's
 * offset clearing on the TABLA panel (model 11: 5mm steps around the centre).
 *
 * @param {number} width
 * @param {number} height
 * @param {{stepOffset:number, depth:number, tarama?:{innerOffset?:number, toolDiameter?:number, stepover?:number}}} row
 * @param {number} thickness
 * @returns {Array<Array<{x:number,y:number,z:number}>>}
 */
export function buildTaramaPaths(width, height, row, thickness) {
  const t = row.tarama || {};
  const outer = num(row.stepOffset);
  const inner = num(t.innerOffset, 0);
  const dia = Math.max(0.1, num(t.toolDiameter, 6));
  const r = dia / 2;
  const step = Math.min(dia, Math.max(0.1, num(t.stepover, dia * 0.8)));
  const z = +(thickness - num(row.depth)).toFixed(3);

  // Tool-centre offsets: outermost pass hugs the outer boundary.
  const first = outer + r;
  const halfMin = Math.min(width, height) / 2;
  // Innermost pass: hugs the island, or reaches the centre when there is none.
  const last = inner > outer ? inner - r : halfMin - 1e-6;
  if (last < first - 1e-9) return [];

  const offsets = [];
  for (let o = last; o > first + 1e-9; o -= step) offsets.push(o);
  offsets.push(first);

  // One continuous pass, like ArtCAM's offset clearing on the panel: each ring
  // starts on its top-left corner, and the move to the next (larger) ring is a
  // short diagonal through material that is cleared anyway, so the tool never
  // lifts inside the pocket.
  const path = [];
  offsets.forEach((o) => {
    const x1 = o; const x2 = width - o; const y1 = o; const y2 = height - o;
    if (x2 - x1 < -1e-9 || y2 - y1 < -1e-9) return;
    if (Math.abs(x2 - x1) < 1e-6 || Math.abs(y2 - y1) < 1e-6) {
      // Degenerate ring at the centre: a single slot line.
      path.push({ x: x1, y: y2, z }, { x: x2, y: y1, z });
      return;
    }
    path.push(
      { x: x1, y: y2, z }, { x: x2, y: y2, z }, { x: x2, y: y1, z },
      { x: x1, y: y1, z }, { x: x1, y: y2, z },
    );
  });
  return path.length ? [path] : [];
}

/**
 * Free toolpaths stored as a template drawn on a reference door
 * (`refWidth` x `refHeight`). Each coordinate is anchored to the NEAREST edge of
 * the reference door: a point in the left half keeps its distance from the left
 * edge, one in the right half its distance from the right edge (same for Y).
 * Corner ornaments therefore keep their exact shape on any door size, while a
 * straight line that crosses the middle simply stretches.
 *
 * Template points are stored as [x, y, depth, ax?, ay?] (depth below the top
 * surface, so the same template works for any material thickness). The optional
 * ax / ay say which edge the point follows (0 = left/bottom, 1 = right/top) and
 * override the nearest-edge rule. They are set when the template is extracted:
 * a whole ornament follows the corner it sits in, while the free end of a straight
 * frame line follows the ornament it runs into, so on a bigger door the line
 * stretches and still meets it (TABLA model 13's L-shaped frame lines).
 *
 * @param {number} width
 * @param {number} height
 * @param {{sablon?:{refWidth:number, refHeight:number, paths:Array<Array<number[]>>}}} row
 * @param {number} thickness
 */
export function buildSablonPaths(width, height, row, thickness) {
  const s = row.sablon || {};
  const rw = num(s.refWidth, width);
  const rh = num(s.refHeight, height);
  const mapX = (x, ax) => ((ax ?? (x <= rw / 2 ? 0 : 1)) === 0 ? x : width - (rw - x));
  const mapY = (y, ay) => ((ay ?? (y <= rh / 2 ? 0 : 1)) === 0 ? y : height - (rh - y));
  return (s.paths || []).map(decodeSablonPath).map((p) => p.map(([x, y, d, ax, ay]) => ({
    x: mapX(x, ax),
    y: mapY(y, ay),
    z: +(thickness - num(d)).toFixed(3),
  })));
}

/**
 * A template path is stored either as an array of [x, y, depth, ax?, ay?]
 * points or — compactly, so presets.json stays small and readable — as one
 * string of space-separated "x,y,depth,ax,ay" points.
 * @param {string|Array<number[]>} p
 * @returns {Array<number[]>}
 */
export function decodeSablonPath(p) {
  if (typeof p !== 'string') return p;
  return p.trim().split(/\s+/).map((pt) => pt.split(',').map((v) => (v === '' ? undefined : Number(v))));
}

/** Inverse of decodeSablonPath (2 decimals = 0.01 mm). */
export function encodeSablonPath(points) {
  const f = (v) => String(Math.round(v * 100) / 100);
  return points.map(([x, y, d, ax, ay]) => [f(x), f(y), f(d), ax ?? '', ay ?? ''].join(',')).join(' ');
}

/**
 * Extension lines (uzatma): from each corner of the frame rectangle at
 * `stepOffset`, a straight line out to the part edge (`overshoot` mm past it).
 * `yon: 'dikey'` runs the frame's vertical sides on to the top and bottom edges,
 * `'yatay'` its horizontal sides to the left and right edges. TABLA model 9: the
 * 47.5 mm V frame continues to the top and bottom edges.
 */
export function buildUzatmaPaths(width, height, row, thickness) {
  const u = row.uzatma || {};
  const o = num(row.stepOffset);
  const os = num(u.overshoot, 0.5);
  const z = +(thickness - num(row.depth)).toFixed(3);
  const L = (x1, y1, x2, y2) => [{ x: x1, y: y1, z }, { x: x2, y: y2, z }];
  if (u.yon === 'yatay') {
    return [L(o, o, -os, o), L(width - o, o, width + os, o), L(width - o, height - o, width + os, height - o), L(o, height - o, -os, height - o)];
  }
  return [L(o, height - o, o, height + os), L(width - o, height - o, width - o, height + os), L(width - o, o, width - o, -os), L(o, o, o, -os)];
}

/** Operations whose geometry comes from this module. */
export const FEATURE_BUILDERS = {
  tarama: buildTaramaPaths,
  sablon: buildSablonPaths,
  uzatma: buildUzatmaPaths,
};

/** sablon carries its own position; every other row needs its offset. */
export const rowNeedsOffset = (row) => !(row && row.operation === 'sablon');

export const isFeatureRow = (row) => Object.prototype.hasOwnProperty.call(FEATURE_BUILDERS, row && row.operation);

/**
 * @returns {Array<Array<{x:number,y:number,z:number}>>} polylines for a feature row
 */
export function buildFeaturePaths(width, height, row, thickness) {
  const fn = FEATURE_BUILDERS[row.operation];
  return fn ? fn(width, height, row, thickness) : [];
}
