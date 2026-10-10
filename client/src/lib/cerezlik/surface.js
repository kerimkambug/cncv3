// Height-map machining for 3D trays (figure + dished compartments).
//
// A grid holds the TARGET surface height (machine Z, table = 0, material top =
// thickness) on square cells. Everything else is derived from it:
//   roughing   — flat end mill, z-level rings, leaves `leave` mm on the surface
//   finishing  — ball nose, parallel passes, tip height from a drop-cutter on
//                the whole map, so a pass never gouges a neighbouring wall or
//                the figure, whatever region it was asked to finish.
// All heights share one reference, so a figure can never end up sunk or proud
// by mistake: its top is placed relative to the material top by definition.
import { offset, union } from './geom.js';

export function makeGrid(x0, y0, w, h, cell, fill = 0) {
  return { x0, y0, w, h, cell, z: new Float32Array(w * h).fill(fill) };
}

export const cx = (g, i) => g.x0 + (i + 0.5) * g.cell;
export const cy = (g, j) => g.y0 + (j + 0.5) * g.cell;

/** Cells whose centre lies inside the polygons (even-odd). */
export function maskPolys(g, polys) {
  const m = new Uint8Array(g.w * g.h);
  for (let j = 0; j < g.h; j++) {
    const y = cy(g, j);
    const xs = [];
    for (const p of polys) {
      for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
        const [xa, ya] = p[a], [xb, yb] = p[b];
        if ((ya > y) !== (yb > y)) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
      }
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cell - 0.5));
      const i1 = Math.min(g.w - 1, Math.floor((xs[k + 1] - g.x0) / g.cell - 0.5));
      for (let i = i0; i <= i1; i++) m[j * g.w + i] = 1;
    }
  }
  return m;
}

/** Euclidean distance (in cells) from every set cell to the nearest unset cell (Felzenszwalb). */
export function edt(mask, w, h) {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const zz = new Float64Array(Math.max(w, h) + 1);
  const out = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) out[k] = mask[k] ? INF : 0;
  const pass = (n) => {
    let k = 0;
    v[0] = 0; zz[0] = -INF; zz[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= zz[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; zz[k] = s; zz[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (zz[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) f[j] = out[j * w + i];
    pass(h);
    for (let j = 0; j < h; j++) out[j * w + i] = d[j];
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) f[i] = out[j * w + i];
    pass(w);
    for (let i = 0; i < w; i++) out[j * w + i] = Math.sqrt(d[i]);
  }
  return out;
}

/** Max over a disk of radius r cells (flat end mill footprint). Outside the grid counts as `outside`. */
export function maxDisk(z, w, h, r, outside) {
  const R = Math.max(0, Math.round(r));
  const out = new Float32Array(w * h).fill(-Infinity);
  // sliding max of half-width hw along each row, cached per half-width
  const rowMax = new Map();
  const rowsFor = (hw) => {
    if (rowMax.has(hw)) return rowMax.get(hw);
    const m = new Float32Array(w * h);
    const dq = new Int32Array(w);
    for (let j = 0; j < h; j++) {
      const base = j * w;
      // monotonic deque: sliding max over [i - hw, i + hw]
      let head = 0, tail = 0, next = 0;
      for (let i = 0; i < w; i++) {
        const hi = Math.min(w - 1, i + hw);
        for (; next <= hi; next++) {
          while (tail > head && z[base + dq[tail - 1]] <= z[base + next]) tail--;
          dq[tail++] = next;
        }
        while (dq[head] < i - hw) head++;
        let mx = z[base + dq[head]];
        if ((i - hw < 0 || i + hw >= w) && outside > mx) mx = outside;
        m[base + i] = mx;
      }
    }
    rowMax.set(hw, m);
    return m;
  };
  for (let dj = -R; dj <= R; dj++) {
    const hw = Math.floor(Math.sqrt(R * R - dj * dj));
    const m = rowsFor(hw);
    for (let j = 0; j < h; j++) {
      const jj = j + dj;
      const base = j * w;
      if (jj < 0 || jj >= h) { for (let i = 0; i < w; i++) if (outside > out[base + i]) out[base + i] = outside; continue; }
      const src = jj * w;
      for (let i = 0; i < w; i++) if (m[src + i] > out[base + i]) out[base + i] = m[src + i];
    }
  }
  return out;
}

/** Set cells → polygon shapes [{outer, holes}] in mm (union of cell runs). */
export function maskToShapes(g, mask) {
  const rects = [];
  for (let j = 0; j < g.h; j++) {
    let i = 0;
    while (i < g.w) {
      if (!mask[j * g.w + i]) { i++; continue; }
      const s = i;
      while (i < g.w && mask[j * g.w + i]) i++;
      const x0 = g.x0 + s * g.cell, x1 = g.x0 + i * g.cell, y0 = g.y0 + j * g.cell, y1 = y0 + g.cell;
      rects.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    }
  }
  return rects.length ? union(rects) : [];
}

/** Ball-nose drop-cutter kernel: offsets within radius R (mm) and the ball's height drop there. */
function ballKernel(g, R) {
  const rc = R / g.cell;
  const n = Math.ceil(rc);
  const k = [];
  for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
    const d = Math.hypot(di, dj) * g.cell;
    if (d <= R) k.push(di, dj, Math.sqrt(R * R - d * d) - R);
  }
  return {
    di: Int32Array.from(k.filter((_, i) => i % 3 === 0)),
    dj: Int32Array.from(k.filter((_, i) => i % 3 === 1)),
    dz: Float32Array.from(k.filter((_, i) => i % 3 === 2)),
  };
}

/** Tip height of a ball of radius R centred over cell (i, j): it rests on the surface, never below. */
function dropAt(g, K, i, j, outside) {
  let best = -Infinity;
  const { di, dj, dz } = K;
  for (let k = 0; k < dz.length; k++) {
    const ii = i + di[k], jj = j + dj[k];
    const s = ii < 0 || jj < 0 || ii >= g.w || jj >= g.h ? outside : g.z[jj * g.w + ii];
    const t = s + dz[k];
    if (t > best) best = t;
  }
  return best;
}

/** Max-pooled copy (coarser, never lower) to speed up big ball-nose tools. */
export function pooled(g, f) {
  if (f <= 1) return g;
  const w = Math.ceil(g.w / f), h = Math.ceil(g.h / f);
  const p = makeGrid(g.x0, g.y0, w, h, g.cell * f, -Infinity);
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const k = Math.floor(j / f) * w + Math.floor(i / f);
    if (g.z[j * g.w + i] > p.z[k]) p.z[k] = g.z[j * g.w + i];
  }
  return p;
}

function simplify3(pts, tol = 0.01) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = out[out.length - 1], b = pts[k], c = pts[k + 1];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const L = Math.hypot(...ac) || 1;
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.hypot(...cr) / L > tol) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Ball-nose finishing: parallel passes along X over the cells of `region`,
 * stepping `stepover` mm in Y, zig-zag. Tip heights come from a drop-cutter
 * on the whole map; stretches that would only skim the untouched top are left
 * out. Neighbouring stretches are joined with a (drop-cutter) link move.
 * @returns {number[][][]} passes of [x, y, z]
 */
export function ballRaster(g, region, { R, stepover, top, outside = top, poolTo = 0, leave = 0 }) {
  // leave > 0: run `leave` mm above the surface everywhere (semi-finishing).
  // A ball of radius R over the surface grown by L has its tip exactly where a
  // ball of radius R + L would, lifted by L.
  const Rd = R + leave;
  const f = poolTo > g.cell ? Math.max(1, Math.round(poolTo / g.cell)) : 1;
  const G = pooled(g, f);
  const reg = f > 1 ? poolMask(region, g, f, G) : region;
  const K = ballKernel(G, Rd);
  const at = (x, y) => Math.min(top, dropAtXY(G, Rd, x, y, outside) + leave);
  // rows of the (pooled) grid closest to each pass
  let jMin = G.h, jMax = -1, iMin = G.w, iMax = -1;
  for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) if (reg[j * G.w + i]) {
    if (j < jMin) jMin = j; if (j > jMax) jMax = j; if (i < iMin) iMin = i; if (i > iMax) iMax = i;
  }
  if (jMax < 0) return [];
  const passes = [];
  const y0 = cy(G, jMin), y1 = cy(G, jMax);
  const lines = Math.max(1, Math.ceil((y1 - y0) / stepover));
  let flip = false;
  const skim = top - 0.02;
  let cur = null, last = null;
  const link = (a, b) => {
    // straight move, every point from the exact drop-cutter (safe over walls)
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / G.cell));
    const pts = [a];
    for (let s = 1; s < n; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / n, y = a[1] + ((b[1] - a[1]) * s) / n;
      pts.push([x, y, +at(x, y).toFixed(3)]);
    }
    pts.push(b);
    return refine(pts, at).slice(1, -1);
  };
  for (let L = 0; L <= lines; L++) {
    const y = y0 + ((y1 - y0) * L) / lines;
    const j = Math.min(G.h - 1, Math.max(0, Math.round((y - G.y0) / G.cell - 0.5)));
    const row = [];
    for (let i = iMin; i <= iMax; i++) {
      if (!reg[j * G.w + i]) { row.push(null); continue; }
      const z = Math.min(top, dropAt(G, K, i, j, outside) + leave);
      row.push(z < skim ? [cx(G, i), cy(G, j), +z.toFixed(3)] : null);
    }
    if (flip) row.reverse();
    flip = !flip;
    // split into stretches
    for (const p of row) {
      if (p) {
        if (!cur) {
          const near = last && Math.hypot(p[0] - last[0], p[1] - last[1]) <= Math.max(3 * stepover, 4);
          if (near && passes.length) { cur = passes[passes.length - 1]; cur.push(...link(last, p)); } else { cur = []; passes.push(cur); }
        }
        cur.push(p);
        last = p;
      } else cur = null;
    }
    cur = null;
  }
  return passes.map((p) => simplifyAbove(refine(p, at), 0.005)).filter((p) => p.length > 1);
}

function poolMask(m, g, f, G) {
  const out = new Uint8Array(G.w * G.h);
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (m[j * g.w + i]) out[Math.floor(j / f) * G.w + Math.floor(i / f)] = 1;
  return out;
}

/**
 * Flat end-mill roughing: for every z level, the tool centre may go where the
 * whole footprint stays `leave` above the target surface. Returns the region
 * shapes per level (the caller turns them into rings).
 * @returns {Array<{z:number, shapes:Array<{outer, holes}>}>}
 */
export function roughLevels(g, { r, stepdown, leave, top, outside = top }) {
  const T = maxDisk(g.z, g.w, g.h, r / g.cell, outside);
  let lowest = Infinity;
  for (let k = 0; k < g.z.length; k++) if (g.z[k] < lowest) lowest = g.z[k];
  const out = [];
  const floor = lowest + leave;
  for (let z = top - stepdown; ; z -= stepdown) {
    const zz = Math.max(z, floor);
    const m = new Uint8Array(g.w * g.h);
    let any = false;
    for (let k = 0; k < m.length; k++) if (T[k] + leave <= zz + 1e-6) { m[k] = 1; any = true; }
    if (any) out.push({ z: +zz.toFixed(3), shapes: maskToShapes(g, m) });
    if (zz <= floor + 1e-6) break;
  }
  // flat floors (large areas at one depth): one more ring set exactly at that
  // depth, so the floor is finished by the end mill and the ball nose only has
  // the curves to do
  const hist = new Map();
  for (let k = 0; k < g.z.length; k++) {
    if (g.z[k] >= top - 0.01) continue;
    const key = Math.round(g.z[k] * 100);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const minCells = 400 / (g.cell * g.cell); // ≥ 4 cm² of flat floor
  // no skin left here, so the footprint check is one and a half cells wider: the rings run on the
  // edges of the allowed cells, and the cutter must not reach a single cell beyond them
  const Tf = maxDisk(g.z, g.w, g.h, r / g.cell + 1.5, outside);
  for (const [key, n] of [...hist].sort((p, q) => q[0] - p[0])) {
    if (n < minCells) continue;
    const zf = key / 100;
    const m = new Uint8Array(g.w * g.h);
    let any = false;
    for (let k = 0; k < m.length; k++) if (Tf[k] <= zf + 0.005 && g.z[k] >= zf - 0.005) { m[k] = 1; any = true; }
    if (any) out.push({ z: +zf.toFixed(3), shapes: maskToShapes(g, m), floor: true });
  }
  return out;
}

/** Ball tip height with the ball centred exactly at (x, y): it rests on every cell centre within R. */
function dropAtXY(g, R, x, y, outside) {
  const R2 = R * R;
  const i0 = Math.floor((x - R - g.x0) / g.cell), i1 = Math.ceil((x + R - g.x0) / g.cell);
  const j0 = Math.floor((y - R - g.y0) / g.cell), j1 = Math.ceil((y + R - g.y0) / g.cell);
  let best = -Infinity;
  for (let j = j0; j <= j1; j++) {
    const dy = g.y0 + (j + 0.5) * g.cell - y, dy2 = dy * dy;
    if (dy2 > R2) continue;
    const inRow = j >= 0 && j < g.h;
    for (let i = i0; i <= i1; i++) {
      const dx = g.x0 + (i + 0.5) * g.cell - x, d2 = dx * dx + dy2;
      if (d2 > R2) continue;
      const sz = inRow && i >= 0 && i < g.w ? g.z[j * g.w + i] : outside;
      const t = sz + Math.sqrt(R2 - d2) - R;
      if (t > best) best = t;
    }
  }
  return best;
}

/**
 * The machine moves in straight lines between points; where the surface rises
 * above such a line between two points, add the midpoint (repeatedly), so no
 * straight move dips below the surface. Then drop points that add nothing.
 */
function refine(pts, tipAt, tol = 0.005) {
  const out = [pts[0]];
  const split = (a, b, depth) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const need = tipAt(mx, my);
    if (depth < 5 && need > (a[2] + b[2]) / 2 + tol) {
      const m = [mx, my, +need.toFixed(3)];
      split(a, m, depth + 1);
      split(m, b, depth + 1);
    } else out.push(b);
  };
  for (let k = 1; k < pts.length; k++) split(out[out.length - 1], pts[k], 0);
  return out;
}

/**
 * Contour finishing of one dished compartment with a ball nose: rings that
 * follow the compartment wall, from the rim inwards. The rings are spaced so
 * that the distance ALONG THE SURFACE between two rings is `stepover` — close
 * together on the curved part near the wall, wider on the flat floor — so the
 * finish is even everywhere and no roughing step survives. Rings are joined by
 * short feed moves (no lifts); every point's height comes from the full
 * resolution drop-cutter, so it never digs into the surface.
 * @param {number[][][]} loops  compartment outline (+ islands), mm
 * @returns {number[][][]} passes of [x, y, z]
 */
export function contourFinish(g, loops, { R, stepover, top, outside = top, climb = true, maxOffset = Infinity, step = 1, simplifyTol = 0.02, stopAtFloor = true, keep = null }) {
  const mask = maskPolys(g, loops);
  const exact = wallDistance(g, mask, loops, R + 2);
  // average surface height by distance from the wall (0.1 mm buckets)
  const B = 0.1;
  let maxD = 0;
  // distance to the wall polygon itself (cell centre distance minus half a cell), as the tray was designed
  const wd = (k) => exact[k];
  for (let k = 0; k < mask.length; k++) if (mask[k] && wd(k) > maxD) maxD = wd(k);
  if (maxD <= 0) return [];
  const nB = Math.ceil(maxD / B) + 1;
  const sum = new Float64Array(nB), cnt = new Uint32Array(nB);
  for (let k = 0; k < mask.length; k++) if (mask[k]) { const b = Math.min(nB - 1, Math.floor(wd(k) / B)); sum[b] += g.z[k]; cnt[b]++; }
  // profile per bucket; empty buckets (the map is discrete) interpolated linearly between their neighbours
  const prof = new Float64Array(nB);
  const filled = [];
  for (let b = 0; b < nB; b++) if (cnt[b]) { prof[b] = sum[b] / cnt[b]; filled.push(b); }
  if (!filled.length) return [];
  for (let b = 0; b < nB; b++) {
    if (cnt[b]) continue;
    let lo = -1, hi = -1;
    for (const f of filled) { if (f < b) lo = f; else { hi = f; break; } }
    prof[b] = lo < 0 ? prof[hi] : hi < 0 ? prof[lo] : prof[lo] + ((prof[hi] - prof[lo]) * (b - lo)) / (hi - lo);
  }
  const p = (x) => (x < 0 ? top : prof[Math.min(nB - 1, Math.floor(x / B))]);
  const tip = (d) => {
    let best = -Infinity;
    for (let t = -R; t <= R; t += B) { const v = p(d + t) + Math.sqrt(Math.max(0, R * R - t * t)) - R; if (v > best) best = v; }
    return Math.min(top, best);
  };
  // ring offsets with an even spacing along the surface. The rings stop where
  // the ball reaches the flat floor: the floor itself is finished by the flat
  // end mill at its exact depth (roughing floor pass), not by the ball.
  const floorZ = prof[nB - 1];
  const offs = [];
  let d = 0;
  while (d < maxD && tip(d) >= top - 0.02) d += 0.1; // first ring: where the ball starts to cut
  d = Math.max(0, d - stepover / 2);
  for (let guard = 0; d <= Math.min(maxD + R, maxOffset) && guard < 5000; guard++) {
    offs.push(d);
    const z0 = tip(d);
    if (stopAtFloor && z0 <= floorZ + 0.02) break; // this ring already runs on the floor
    let e = d;
    do { e += 0.05; } while (Math.hypot(e - d, tip(e) - z0) < stepover && e < maxD + R);
    d = e;
  }
  if (stopAtFloor && offs.length) {
    // the floor ring exactly where the ball first touches the floor: with a floor
    // radius equal to the ball radius this ring alone is the whole curve
    let lo = offs.length > 1 ? offs[offs.length - 2] : 0, hi = offs[offs.length - 1];
    if (tip(hi) <= floorZ + 0.03) {
      for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (tip(m) <= floorZ + 0.03) hi = m; else lo = m; }
      offs[offs.length - 1] = hi;
    }
  }
  if (stopAtFloor && offs.length > 1) {
    // Which rings are really needed? Cross-section check: the ball's outline at
    // each ring (shank above the centre) against the wall profile. With a floor
    // radius equal to the ball radius the ring at the floor alone reproduces the
    // whole curve; a larger radius needs a few rings higher up.
    const dF = offs[offs.length - 1];
    const cover = (set, x) => {
      let c = Infinity;
      for (const dr of set) {
        const t = tip(dr);
        const u = x - dr;
        const h = u < -R ? t + R : u > R ? Infinity : t + R - Math.sqrt(Math.max(0, R * R - u * u));
        if (h < c) c = h;
      }
      return c;
    };
    const worst = (set) => {
      let w = 0;
      // the last 0.2 mm lip at the very top edge is below the resolution of the map; T3 rounds it anyway
      for (let x = 0; x <= dF; x += 0.1) if (p(x) < top - 0.5) w = Math.max(w, Math.min(top, cover(set, x)) - p(x));
      return w;
    };
    const chosen = [dF];
    // 0.25 mm: above the cross-section's own discretisation error (a floor radius equal
    // to the ball radius measures ~0.18 here and machines to a few hundredths)
    for (let k = offs.length - 2; k >= 0 && worst(chosen) > 0.25; k--) chosen.push(offs[k]);
    offs.splice(0, offs.length, ...chosen.sort((u, v) => u - v));
  }
  const at = (x, y) => Math.min(top, dropAtXY(g, R, x, y, outside));
  const passes = [];
  let pass = null, prev = null;
  const append = (seq) => {
    const near = prev && Math.hypot(seq[0][0] - prev[0], seq[0][1] - prev[1]) <= stepover * 3 + 2;
    if (pass && near) {
      // feed link, heights from the drop-cutter (safe over anything in between)
      const n = Math.max(2, Math.ceil(Math.hypot(seq[0][0] - prev[0], seq[0][1] - prev[1]) / 0.5));
      const link = [prev];
      for (let k = 1; k < n; k++) {
        const x = prev[0] + ((seq[0][0] - prev[0]) * k) / n, y = prev[1] + ((seq[0][1] - prev[1]) * k) / n;
        link.push([x, y, +at(x, y).toFixed(3)]);
      }
      link.push(seq[0]);
      pass.push(...refine(link, at).slice(1, -1));
    } else {
      pass = [];
      passes.push(pass);
    }
    pass.push(...seq);
    prev = seq[seq.length - 1];
  };
  for (const o of offs) {
    const rings = offset(loops, -o);
    if (!rings.length) break;
    for (const ring0 of rings) {
      // climb milling: material outside the ring → clockwise
      const ccw = ring0.reduce((acc, q, i) => { const r = ring0[(i + 1) % ring0.length]; return acc + (q[0] * r[1] - r[0] * q[1]); }, 0) > 0;
      const ring = ccw === !climb ? ring0 : ring0.slice().reverse();
      const pts = [];
      for (let i = 0; i < ring.length; i++) {
        const p0 = ring[i], p1 = ring[(i + 1) % ring.length];
        const n = Math.max(1, Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / step));
        for (let k = 0; k < n; k++) pts.push([p0[0] + ((p1[0] - p0[0]) * k) / n, p0[1] + ((p1[1] - p0[1]) * k) / n]);
      }
      if (keep) {
        // only the stretches that still have material to take (rest machining)
        const flags = pts.map(([x, y]) => keep(x, y));
        if (!flags.some(Boolean)) continue;
        // start at the beginning of a kept stretch so no stretch is split in two
        let st = flags.findIndex((f, i) => f && !flags[(i - 1 + flags.length) % flags.length]);
        if (st < 0) st = 0;
        const rot = [...pts.slice(st), ...pts.slice(0, st)], rf = [...flags.slice(st), ...flags.slice(0, st)];
        let run = [];
        rot.forEach((q, i) => {
          if (rf[i]) run.push(q);
          if ((!rf[i] || i === rot.length - 1) && run.length > 1) { append(refine(run.map(([x, y]) => [x, y, +at(x, y).toFixed(3)]), at)); run = []; }
          else if (!rf[i]) run = [];
        });
        continue;
      }
      // start next to where the previous ring ended
      let st = 0;
      if (prev) { let bd = Infinity; pts.forEach((q, i) => { const dd = (q[0] - prev[0]) ** 2 + (q[1] - prev[1]) ** 2; if (dd < bd) { bd = dd; st = i; } }); }
      append(refine([...pts.slice(st), ...pts.slice(0, st), pts[st]].map(([x, y]) => [x, y, +at(x, y).toFixed(3)]), at));
    }
  }
  return passes.map((q) => simplifyAbove(q, simplifyTol)).filter((q) => q.length > 1);
}

/**
 * Material a set of ball-nose passes leaves above the target, per cell
 * (the ball's swept envelope minus the surface). Used to send the small ball
 * only where the big one could not reach.
 */
export function leftover(g, passes, R, top) {
  const env = new Float32Array(g.z.length).fill(top);
  const r = Math.ceil(R / g.cell);
  for (const p of passes) {
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[k + 1] || a;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(0.3, g.cell)));
      for (let s = 0; s < n; s++) {
        const x = a[0] + ((b[0] - a[0]) * s) / n, y = a[1] + ((b[1] - a[1]) * s) / n, z = a[2] + ((b[2] - a[2]) * s) / n;
        const ci = Math.floor((x - g.x0) / g.cell), cj = Math.floor((y - g.y0) / g.cell);
        for (let dj = -r; dj <= r; dj++) {
          const j = cj + dj; if (j < 0 || j >= g.h) continue;
          const dy = g.y0 + (j + 0.5) * g.cell - y;
          for (let di = -r; di <= r; di++) {
            const i = ci + di; if (i < 0 || i >= g.w) continue;
            const dx = g.x0 + (i + 0.5) * g.cell - x, d2 = dx * dx + dy * dy;
            if (d2 > R * R) continue;
            const zz = z + R - Math.sqrt(R * R - d2);
            const kk = j * g.w + i; if (zz < env[kk]) env[kk] = zz;
          }
        }
      }
    }
  }
  for (let k = 0; k < env.length; k++) env[k] = Math.max(0, env[k] - g.z[k]);
  return env;
}

/** Like simplify3, but a point is only dropped when the replacing line passes over it (never below). */
function simplifyAbove(pts, tol) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let a = 0;
  for (let k = 2; k <= pts.length; k++) {
    // can a → k-1 skip everything in between?
    let ok = k < pts.length;
    if (ok) {
      const A = pts[a], B = pts[k];
      const L2 = (B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2;
      for (let m = a + 1; m < k && ok; m++) {
        const P = pts[m];
        const t = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * (B[0] - A[0]) + (P[1] - A[1]) * (B[1] - A[1])) / L2)) : 0;
        const lx = A[0] + (B[0] - A[0]) * t, ly = A[1] + (B[1] - A[1]) * t, lz = A[2] + (B[2] - A[2]) * t;
        if (Math.hypot(P[0] - lx, P[1] - ly) > tol || lz < P[2] - 1e-4 || lz > P[2] + tol) ok = false;
      }
    }
    if (!ok) { out.push(pts[k - 1]); a = k - 1; }
  }
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Distance (mm) from every set cell to the region's boundary polygon. Within
 * `band` mm of the wall it is the exact distance to the polygon edges — a
 * near-vertical wall profile turns a few hundredths of a mm of distance error
 * into tenths of height — further in the (cheaper) distance transform is used.
 */
export function wallDistance(g, mask, loops, band) {
  const dist = edt(mask, g.w, g.h);
  const segs = [];
  for (const l of loops) for (let i = 0; i < l.length; i++) { const a = l[i], b = l[(i + 1) % l.length]; segs.push([a[0], a[1], b[0], b[1]]); }
  const S = Math.max(2, band);
  const hash = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const s of segs) {
    const i0 = Math.floor(Math.min(s[0], s[2]) / S), i1 = Math.floor(Math.max(s[0], s[2]) / S);
    const j0 = Math.floor(Math.min(s[1], s[3]) / S), j1 = Math.floor(Math.max(s[1], s[3]) / S);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(s); }
  }
  const out = new Float32Array(g.w * g.h);
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const k = j * g.w + i;
    if (!mask[k]) continue;
    const approx = Math.max(0, (dist[k] - 0.5) * g.cell);
    if (approx > band) { out[k] = approx; continue; }
    const x = g.x0 + (i + 0.5) * g.cell, y = g.y0 + (j + 0.5) * g.cell;
    const hi = Math.floor(x / S), hj = Math.floor(y / S);
    let best = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const s of hash.get(key(hi + a, hj + b)) || []) {
        const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / L)) : 0;
        const d = Math.hypot(x - (s[0] + t * dx), y - (s[1] + t * dy));
        if (d < best) best = d;
      }
    }
    out[k] = Number.isFinite(best) ? best : approx;
  }
  return out;
}

/**
 * Waterline finishing of a steep wall with a ball nose: the ball's centre runs
 * R mm inside the wall, ring after ring, stepping down `stepdown` mm each time
 * from just under the top to `zMin` — so a vertical (or steep) wall is touched
 * over its whole height, which a single pass at the bottom or a raster across
 * it cannot do. Every point also respects the drop-cutter, so nothing inside
 * (a figure, a floor rising) is ever cut into.
 */
export function wallWaterline(g, loops, { R, stepdown, top, zMin, outside = top, climb = true, step = 1 }) {
  if (zMin >= top - 0.05) return [];
  const rings = offset(loops, -(R + 0.02));
  if (!rings.length) return [];
  const at = (x, y) => Math.min(top, dropAtXY(g, R, x, y, outside));
  const levels = [];
  for (let z = top - stepdown; z > zMin + 1e-6; z -= stepdown) levels.push(+z.toFixed(3));
  levels.push(+zMin.toFixed(3));
  const passes = [];
  for (const ring0 of rings) {
    const ccw = ring0.reduce((acc, q, i) => { const r = ring0[(i + 1) % ring0.length]; return acc + (q[0] * r[1] - r[0] * q[1]); }, 0) > 0;
    const ring = ccw === !climb ? ring0 : ring0.slice().reverse();
    const pts = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    pts.push(pts[0]);
    const floorAt = pts.map(([x, y]) => at(x, y));
    const pass = [];
    for (const lv of levels) {
      const tipAt = (x, y) => Math.max(lv, at(x, y));
      const seq = refine(pts.map(([x, y], k) => [x, y, +Math.max(lv, floorAt[k]).toFixed(3)]), tipAt);
      // skip a level that is entirely in the air above what is already cut
      if (seq.every((q) => q[2] >= top - 0.02)) continue;
      pass.push(...seq); // levels follow each other at the ring start: a straight step down
    }
    if (pass.length > 1) passes.push(simplifyAbove(pass, 0.01));
  }
  return passes;
}
