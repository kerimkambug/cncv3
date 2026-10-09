// True-shape nesting on a raster. Every part is rasterised (per allowed angle)
// into the grid cells its keep-out polygon touches; a part may be placed where
// none of its cells is taken. Because the masks follow the real outline, parts
// slide into each other's concave gaps instead of sitting in bounding boxes.
//
// Safety: the keep-out polygon is the outline grown by half the required gap.
// A cell is marked when its square touches that polygon, so two parts whose
// cells do not overlap are at least `gap` apart — however coarse the grid.
//
// Pure data in / out (no DOM, no Clipper) so it runs in a Web Worker.

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rot = (pts, deg) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};

/**
 * Raster mask of polygons (even-odd) sampled at cell centres. The polygons must
 * already be grown by ~0.71 cell so that every cell touching the true shape is
 * caught (see module comment).
 */
export function rasterize(polys, cell) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const hc = Math.max(1, Math.ceil((maxY - minY) / cell));
  const rows = [];
  let wc = 0, filled = 0;
  for (let r = 0; r < hc; r++) {
    const y = minY + (r + 0.5) * cell;
    const xs = [];
    for (const p of polys) {
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i], [xj, yj] = p[j];
        if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    const spans = [];
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.ceil((xs[k] - minX) / cell - 0.5);
      const b = Math.floor((xs[k + 1] - minX) / cell - 0.5);
      if (b < a) continue;
      const last = spans[spans.length - 1];
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
      else spans.push([a, b]);
      wc = Math.max(wc, b + 1);
      filled += b - a + 1;
    }
    rows.push(spans);
  }
  // rows used as a quick filter: the widest single spans
  const probes = rows.map((sp, r) => [r, sp.reduce((m, [a, b]) => Math.max(m, b - a + 1), 0)])
    .sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, len]) => len > 0);
  const flat = rows.flatMap((sp, r) => sp.map(([a, b]) => [r, a, b])).sort((p, q) => (q[2] - q[1]) - (p[2] - p[1]));
  return { rows, hc, wc, minX, minY, filled, probes, flat: Int32Array.from(flat.flat()) };
}

/** Longest run of free cells in each row (cheap row filter for find()). */
function rowRuns(occ, Wc, y) {
  let best = 0, run = 0;
  const base = y * Wc;
  for (let x = 0; x < Wc; x++) {
    if (occ[base + x]) run = 0;
    else if (++run > best) best = run;
  }
  return best;
}

const STRIDE = 3;

class Plate {
  /** Empty plate with the edge band blocked; later plates are copies of it. */
  static template(Wc, Hc, blocked) {
    const occ = new Uint8Array(Wc * Hc);
    const prev = Wc < 32767 ? new Int16Array(Wc * Hc) : new Int32Array(Wc * Hc);
    const maxRun = new Int32Array(Hc);
    for (let y = 0; y < Hc; y++) {
      const base = y * Wc;
      let p = -1;
      for (let x = 0; x < Wc; x++) {
        if (blocked(x, y)) { occ[base + x] = 1; p = x; }
        prev[base + x] = p;
      }
      maxRun[y] = rowRuns(occ, Wc, y);
    }
    return { Wc, Hc, occ, prev, maxRun };
  }

  constructor(t) {
    this.Wc = t.Wc; this.Hc = t.Hc;
    this.occ = t.occ.slice();
    this.prev = t.prev.slice();
    this.maxRun = t.maxRun.slice();
    this.placements = [];
    this.extent = 0; // highest row reached by a part (primary axis)
    this.filled = 0;
  }

  /**
   * -1 if the mask fits at (px, py); otherwise the next px worth trying.
   * The spans are checked widest first (mask.flat): a collision shows up sooner
   * and the jump past the blocking cell is longer.
   */
  collide(mask, px, py) {
    const { Wc, prev } = this;
    const f = mask.flat;
    for (let k = 0; k < f.length; k += 3) {
      const x1 = px + f[k + 2];
      if (x1 >= Wc) return Wc;
      const p = prev[(py + f[k]) * Wc + x1];
      if (p >= px + f[k + 1]) return p - f[k + 1] + 1;
    }
    return -1;
  }

  /** Leftmost px where the mask fits in row py, or -1. */
  rowFit(mask, py) {
    for (const [r, len] of mask.probes) if (this.maxRun[py + r] < len) return -1;
    let px = 0;
    while (px + mask.wc <= this.Wc) {
      const j = this.collide(mask, px, py);
      if (j < 0) return px;
      px = Math.max(px + 1, j);
    }
    return -1;
  }

  /**
   * Lowest (then leftmost) free position whose top stays below `maxTop`.
   * Rows are probed every STRIDE rows, then the rows just below a hit are
   * refined — a gap narrower than the stride in height can be missed, which
   * costs little and makes the search several times faster.
   */
  find(mask, maxTop) {
    const lastY = Math.min(this.Hc - mask.hc, maxTop - mask.hc);
    if (lastY < 0) return null;
    let hit = -1, hitX = -1, tested = -1;
    for (let py = 0; py <= lastY; py += STRIDE) {
      const px = this.rowFit(mask, py);
      if (px >= 0) { hit = py; hitX = px; break; }
      tested = py;
    }
    if (hit < 0 && tested < lastY) {
      const px = this.rowFit(mask, lastY);
      if (px >= 0) { hit = lastY; hitX = px; }
    }
    if (hit < 0) return null;
    for (let py = tested + 1; py < hit; py++) {
      const px = this.rowFit(mask, py);
      if (px >= 0) return [px, py];
    }
    return [hitX, hit];
  }

  place(mask, px, py) {
    const { Wc, occ, prev } = this;
    for (let r = 0; r < mask.hc; r++) {
      const y = py + r;
      const base = y * Wc;
      const spans = mask.rows[r];
      if (!spans.length) continue;
      for (const [a, b] of spans) for (let x = px + a; x <= px + b; x++) occ[base + x] = 1;
      // prev changes from the first new cell up to the next cell that was already taken
      const from = px + spans[0][0];
      const lastNew = px + spans[spans.length - 1][1];
      let p = from > 0 ? prev[base + from - 1] : -1;
      for (let x = from; x < Wc; x++) {
        if (occ[base + x]) {
          if (x > lastNew && prev[base + x] === x) break;
          p = x;
        }
        prev[base + x] = p;
      }
      this.maxRun[y] = rowRuns(occ, Wc, y);
    }
    this.extent = Math.max(this.extent, py + mask.hc);
    this.filled += mask.filled;
  }
}

/**
 * @param {object} o
 * @param {number} o.plateW, o.plateH   plate size (mm)
 * @param {number} o.inset              keep-out polygons must stay this far inside the plate edge (mm)
 * @param {number} o.cell               grid size (mm)
 * @param {Array<{id:string, polys:number[][][], qty:number, area:number}>} o.items
 *        polys: keep-out polygon(s) in part coordinates, ALREADY grown by 0.71·cell
 * @param {number[]} o.angles           allowed rotations (degrees)
 * @param {number} [o.timeLimit=3000]   ms for the variant search
 * @param {number} [o.maxVariants=400]
 * @param {(p:{variant:number, best:object})=>void} [o.onProgress]
 */
export function nest(o) {
  const t0 = Date.now();
  const cell = o.cell;
  // sweep along the plate's long side: the free remainder stays one big strip
  const transpose = o.plateW > o.plateH;
  const W = transpose ? o.plateH : o.plateW, H = transpose ? o.plateW : o.plateH;
  const Wc = Math.floor(W / cell), Hc = Math.floor(H / cell);
  const inset = o.inset;
  const blocked = (x, y) => x * cell < inset || (x + 1) * cell > W - inset || y * cell < inset || (y + 1) * cell > H - inset;

  const template = Plate.template(Wc, Hc, blocked);
  // masks per item and angle
  const masks = new Map();
  for (const it of o.items) {
    const list = [];
    for (const ang of o.angles) {
      let polys = it.polys.map((p) => rot(p, ang));
      if (transpose) polys = polys.map((p) => p.map(([x, y]) => [y, x]));
      const m = rasterize(polys, cell);
      m.angle = ang;
      list.push(m);
    }
    masks.set(it.id, list);
  }
  const units = o.items.flatMap((it) => Array.from({ length: Math.max(0, it.qty | 0) }, () => it));

  const run = (order) => {
    const plates = [];
    const unplaced = [];
    const empty = () => new Plate(template);
    for (const it of order) {
      let done = false;
      for (let pi = 0; pi <= plates.length && !done; pi++) {
        const fresh = pi === plates.length;
        const plate = fresh ? empty() : plates[pi];
        let best = null;
        for (const m of masks.get(it.id)) {
          // only positions whose top is not above the best so far can win
          const pos = plate.find(m, best ? best.py + best.m.hc : Hc);
          if (!pos) continue;
          const [px, py] = pos;
          const top = py + m.hc;
          if (!best || top < best.py + best.m.hc || (top === best.py + best.m.hc && px < best.px)) best = { m, px, py };
        }
        if (best) {
          plate.place(best.m, best.px, best.py);
          plate.placements.push({ id: it.id, m: best.m, px: best.px, py: best.py });
          if (fresh) plates.push(plate);
          done = true;
        } else if (fresh) {
          unplaced.push(it.id);
          done = true;
        }
      }
    }
    const last = plates[plates.length - 1];
    const score = plates.length * 1e7 + (last ? last.extent * 1e3 - (last.filled / (Wc * Hc)) : 0);
    return { plates, unplaced, score };
  };

  const byArea = units.slice().sort((a, b) => b.area - a.area);
  const rand = rng(o.seed || 12345);
  let best = run(byArea);
  let variants = 1;
  const limit = o.timeLimit ?? 3000, maxV = o.maxVariants ?? 400;
  while (variants < maxV && Date.now() - t0 < limit && units.length > 1) {
    // perturb the area order: a few random swaps, biased towards neighbours
    const order = (variants % 3 === 0 ? best.order || byArea : byArea).slice();
    const swaps = 1 + Math.floor(rand() * Math.max(1, order.length / 4));
    for (let s = 0; s < swaps; s++) {
      const i = Math.floor(rand() * order.length);
      const j = Math.min(order.length - 1, Math.max(0, i + Math.round((rand() - 0.5) * 8)));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const res = run(order);
    res.order = order;
    variants++;
    if (res.score < best.score) best = res;
    if (o.onProgress && variants % 5 === 0) o.onProgress({ variant: variants });
  }

  // back to part transforms in plate millimetres: p' = rot(angle)·p + (dx, dy)
  const plates = best.plates.map((pl) => ({
    placements: pl.placements.map(({ id, m, px, py }) => {
      // mask cell (0,0) corner = (minX, minY) of the rotated (and maybe transposed) polygon.
      // Transposed: q = M·R·p placed at q + t  →  real = M(q + t) = R·p + M·t
      const tx = px * cell - m.minX, ty = py * cell - m.minY;
      return transpose ? { id, angle: m.angle, dx: ty, dy: tx } : { id, angle: m.angle, dx: tx, dy: ty };
    }),
    usedLength: pl.extent * cell,
  }));
  return { plates, unplaced: best.unplaced, variants, ms: Date.now() - t0, transpose };
}
