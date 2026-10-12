// The surface of a simulated part (3D view and STL).
//
// A part is a grid of columns. Most of it is a height map: one top per column.
// A kulp bit or a T-slot cutter leaves hollows UNDER the surface (grid.voids in
// millSim.js), which a height map cannot show: there every column is a stack of
// solid stretches, a signed distance is sampled from them on a 3D lattice
// (positive inside the material, exact along each column) and the surface is
// drawn through it with marching cubes — overhangs and hollows included.
import { edgeTable, triTable } from './mcTables.js';

// a column at or below this height was cut through to the table
const THROUGH_Z = 0.02;
// outside the stock: the surface sits right on the outermost column
const BIG = 1e4;
// tiles of T × T cells: those near a hollow are drawn with marching cubes
const T = 32;
// the cube's edges (corner pairs), in the order the tables use; corner offsets are in partSurface
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

/** Growable float list. */
function floats() {
  let buf = new Float32Array(1 << 18), n = 0;
  return {
    push(a, b, c) {
      if (n + 3 > buf.length) { const g = new Float32Array(buf.length * 2); g.set(buf); buf = g; }
      buf[n++] = a; buf[n++] = b; buf[n++] = c;
    },
    done: () => buf.slice(0, n),
  };
}

/** A minus B, both sorted lists of [from, to]. */
function minus(A, B) {
  const out = [];
  for (let [a0, a1] of A) {
    for (const [b0, b1] of B) {
      if (b1 <= a0 || b0 >= a1) continue;
      if (b0 > a0) out.push([a0, Math.min(b0, a1)]);
      a0 = Math.max(a0, b1);
      if (a0 >= a1) break;
    }
    if (a1 - a0 > 1e-4) out.push([a0, a1]);
  }
  return out;
}

/**
 * The whole surface of a simulated part, every `stride`-th column.
 *
 * Most of the part is a smooth height map (the top of each column, the sides
 * down to the table, the bottom open where it was cut through). Tiles near a
 * hollow are drawn with marching cubes instead; both meet on the same column
 * points, so there is no seam.
 *
 * @param {{x0:number,y0:number,w:number,h:number,cell:number,z:Float32Array,voids?:Map}} grid
 * @param {number} [stride=1]
 * @returns {{vertices:Float32Array, index:Uint32Array, sides:Float32Array, mc:{positions:Float32Array, normals:Float32Array}}}
 *   vertices + index: the height-map top; sides: its walls and bottom (triangle list);
 *   mc: the marching-cubes tiles (triangle list with normals). Everything faces outwards.
 */
export function partSurface(grid, stride = 1) {
  const S = Math.max(1, Math.round(stride));
  const W = Math.floor((grid.w - 1) / S) + 1, H = Math.floor((grid.h - 1) / S) + 1;
  const cs = grid.cell * S;
  const X = (i) => grid.x0 + (i * S + 0.5) * grid.cell;
  const Y = (j) => grid.y0 + (j * S + 0.5) * grid.cell;
  const src = (i, j) => Math.min(grid.h - 1, j * S) * grid.w + Math.min(grid.w - 1, i * S);
  const vertices = new Float32Array(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = (j * W + i) * 3;
    vertices[k] = X(i); vertices[k + 1] = Y(j); vertices[k + 2] = grid.z[src(i, j)];
  }

  // cell (i, j) spans columns i…i+1, j…j+1; cells −1 and W−1 / H−1 reach the empty column beyond the stock
  const TW = Math.ceil(Math.max(1, W - 1) / T), TH = Math.ceil(Math.max(1, H - 1) / T);
  const mcTile = new Uint8Array(TW * TH);
  const voids = grid.voids;
  if (voids && voids.size) {
    for (const g of voids.keys()) {
      const i = Math.round((g % grid.w) / S), j = Math.round(Math.floor(g / grid.w) / S);
      for (let jj = j - 2; jj <= j + 1; jj++) for (let ii = i - 2; ii <= i + 1; ii++) {
        if (ii < 0 || jj < 0 || ii > W - 2 || jj > H - 2) continue;
        mcTile[Math.floor(jj / T) * TW + Math.floor(ii / T)] = 1;
      }
    }
  }
  const clampI = (i) => Math.max(0, Math.min(W - 2, i)), clampJ = (j) => Math.max(0, Math.min(H - 2, j));
  const inTile = (i, j) => mcTile[Math.floor(clampJ(j) / T) * TW + Math.floor(clampI(i) / T)] === 1;

  // ---- height map: top, sides, bottom
  const through = (p) => vertices[p * 3 + 2] <= THROUGH_Z;
  const hole = (i, j) => { const a = j * W + i; return through(a) && through(a + 1) && through(a + W) && through(a + W + 1); };
  const index = new Uint32Array(Math.max(0, (W - 1) * (H - 1) * 6));
  let o = 0;
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    if (hole(i, j) || inTile(i, j)) continue;
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    index[o++] = a; index[o++] = b; index[o++] = d; index[o++] = a; index[o++] = d; index[o++] = c;
  }
  const sides = floats();
  const put = (p, z) => sides.push(vertices[p * 3], vertices[p * 3 + 1], z ?? vertices[p * 3 + 2]);
  // a side wall between edge columns a → b, from their tops down to the table
  const wall = (a, b) => { put(a); put(a, 0); put(b, 0); put(a); put(b, 0); put(b); };
  for (let i = 0; i < W - 1; i++) if (!inTile(i, -1)) wall(i, i + 1);
  for (let j = 0; j < H - 1; j++) if (!inTile(W - 1, j)) wall(j * W + W - 1, (j + 1) * W + W - 1);
  for (let i = 0; i < W - 1; i++) if (!inTile(i, H - 1)) wall((H - 1) * W + i + 1, (H - 1) * W + i);
  for (let j = 0; j < H - 1; j++) if (!inTile(-1, j)) wall((j + 1) * W, j * W);
  // the bottom, one strip per row of cells, open where the part is cut through
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1;) {
      if (hole(i, j) || inTile(i, j)) { i++; continue; }
      let k = i;
      while (k < W - 1 && !hole(k, j) && !inTile(k, j)) k++;
      const p0 = j * W + i, p1 = j * W + k, p2 = (j + 1) * W + k, p3 = (j + 1) * W + i;
      put(p0, 0); put(p2, 0); put(p1, 0); put(p0, 0); put(p3, 0); put(p2, 0);
      i = k;
    }
  }

  // ---- marching cubes over the marked tiles
  const pos = floats(), nor = floats();
  if (mcTile.includes(1)) {
    let top = 0;
    for (let k = 0; k < grid.z.length; k++) if (grid.z[k] > top) top = grid.z[k];
    const dz = Math.min(cs, 0.5); // a kulp profile is read every half millimetre at least
    const z0 = -dz, NZ = Math.ceil((top + dz) / dz) + 2;
    const C = 2 * Math.max(cs, dz); // distances are capped: only the neighbourhood of the surface matters
    // signed distance along a column (positive in the material) at every lattice height, into f[at…at+NZ)
    // returns the column's top for a plain column (one stretch on the table; 0 = none), −1 for one with hollows
    const fillColumn = (f, at, i, j) => {
      if (i < 0 || j < 0 || i >= W || j >= H) { f.fill(-BIG, at, at + NZ); return 0; }
      const g = src(i, j), zTop = grid.z[g];
      if (zTop <= THROUGH_Z) { f.fill(-C, at, at + NZ); return 0; }
      let list = [[0, zTop]];
      const vs = voids.get(g);
      if (vs) list = minus(list, vs);
      const plain = list.length === 1 && list[0][0] <= 1e-6;
      const n = list.length;
      for (let k = 0; k < NZ; k++) {
        const z = z0 + k * dz;
        let d = -Infinity;
        for (let m = 0; m < n; m++) {
          const m0 = list[m][0], m1 = list[m][1];
          const s = z < m0 ? z - m0 : z > m1 ? m1 - z : (z - m0 < m1 - z ? z - m0 : m1 - z);
          if (s > d) d = s;
        }
        f[at + k] = d > C ? C : d < -C ? -C : d;
      }
      return plain ? list[0][1] : -1;
    };
    // corner c of a cube: offsets in the tile's field (filled per tile below)
    const cx = [0, 1, 1, 0, 0, 1, 1, 0], cy = [0, 0, 1, 1, 0, 0, 1, 1], cz = [0, 0, 0, 0, 1, 1, 1, 1];
    const ea = EDGES.map(([a]) => a), eb = EDGES.map(([, b]) => b);
    const px = new Float32Array(12), py = new Float32Array(12), pz = new Float32Array(12);
    const nx = new Float32Array(12), ny = new Float32Array(12), nz = new Float32Array(12);
    const val = new Float32Array(8);
    for (let tj = 0; tj < TH; tj++) for (let ti = 0; ti < TW; ti++) {
      if (!mcTile[tj * TW + ti]) continue;
      // the tile's cells; on the stock's edge also the cells out to the empty column beyond
      let i0 = ti * T, i1 = Math.min(W - 2, ti * T + T - 1), j0 = tj * T, j1 = Math.min(H - 2, tj * T + T - 1);
      if (i0 === 0) i0 = -1;
      if (i1 === W - 2) i1 = W - 1;
      if (j0 === 0) j0 = -1;
      if (j1 === H - 2) j1 = H - 1;
      // the tile's field: columns i0−1 … i1+2 (one more each way for the normals)
      const bi = i0 - 1, bj = j0 - 1, NI = i1 - i0 + 4, NJ = j1 - j0 + 4;
      const f = new Float32Array(NI * NJ * NZ);
      const tops = new Float32Array(NI * NJ);
      for (let jj = 0; jj < NJ; jj++) for (let ii = 0; ii < NI; ii++) tops[jj * NI + ii] = fillColumn(f, (jj * NI + ii) * NZ, bi + ii, bj + jj);
      const cap = (v) => (v > C ? C : v < -C ? -C : v); // keep the outside's BIG out of the slope
      // outward normal at lattice point q = (ii, jj, k): against the rise of the distance
      // (corners lie inside the tile's field, one column short of its border: no clamping across)
      const G = new Float32Array(3);
      const grad = (q, k) => {
        G[0] = -(cap(f[q + NZ]) - cap(f[q - NZ])) / cs;
        G[1] = -(cap(f[q + NI * NZ]) - cap(f[q - NI * NZ])) / cs;
        G[2] = -(cap(f[k < NZ - 1 ? q + 1 : q]) - cap(f[k > 0 ? q - 1 : q])) / dz;
      };
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const ii = i - bi, jj = j - bj;
        // plain columns change sign only at the table and between their tops: skip the rest
        const t00 = tops[jj * NI + ii], t10 = tops[jj * NI + ii + 1], t01 = tops[(jj + 1) * NI + ii], t11 = tops[(jj + 1) * NI + ii + 1];
        let kA = 0, kB = NZ - 2;
        if (t00 >= 0 && t10 >= 0 && t01 >= 0 && t11 >= 0) {
          kA = Math.max(0, Math.floor((Math.min(t00, t10, t01, t11) - z0) / dz) - 1);
          kB = Math.min(NZ - 2, Math.ceil((Math.max(t00, t10, t01, t11) - z0) / dz) + 1);
        }
        for (let k = 0; k < NZ - 1; k++) {
          if (k > 1 && k < kA) k = kA; // the table level (k 0…1) is always looked at
          if (k > kB) break;
          let ci = 0;
          for (let c = 0; c < 8; c++) {
            const v = f[((jj + cy[c]) * NI + ii + cx[c]) * NZ + k + cz[c]];
            val[c] = v;
            if (v < 0) ci |= 1 << c;
          }
          const bits = edgeTable[ci];
          if (!bits) continue;
          for (let e = 0; e < 12; e++) {
            if (!(bits & (1 << e))) continue;
            const a = ea[e], b = eb[e];
            const t = val[a] / (val[a] - val[b]);
            const ax = i + cx[a], ay = j + cy[a], az = k + cz[a], bx = i + cx[b], by = j + cy[b], bz = k + cz[b];
            px[e] = X(ax) + (X(bx) - X(ax)) * t;
            py[e] = Y(ay) + (Y(by) - Y(ay)) * t;
            pz[e] = z0 + (az + (bz - az) * t) * dz;
            grad(((ay - bj) * NI + ax - bi) * NZ + az, az);
            const gax = G[0], gay = G[1], gaz = G[2];
            grad(((by - bj) * NI + bx - bi) * NZ + bz, bz);
            nx[e] = gax + (G[0] - gax) * t;
            ny[e] = gay + (G[1] - gay) * t;
            nz[e] = gaz + (G[2] - gaz) * t;
          }
          for (let n = ci * 16; triTable[n] !== -1; n += 3) {
            const p = triTable[n];
            let q = triTable[n + 1], r = triTable[n + 2];
            // wind every triangle to face out of the material
            const ux = px[q] - px[p], uy = py[q] - py[p], uz = pz[q] - pz[p], wx = px[r] - px[p], wy = py[r] - py[p], wz = pz[r] - pz[p];
            const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
            if (fx * (nx[p] + nx[q] + nx[r]) + fy * (ny[p] + ny[q] + ny[r]) + fz * (nz[p] + nz[q] + nz[r]) < 0) { const s = q; q = r; r = s; }
            for (let m = 0; m < 3; m++) {
              const e = m === 0 ? p : m === 1 ? q : r;
              pos.push(px[e], py[e], pz[e]);
              const l = Math.sqrt(nx[e] * nx[e] + ny[e] * ny[e] + nz[e] * nz[e]) || 1;
              nor.push(nx[e] / l, ny[e] / l, nz[e] / l);
            }
          }
        }
      }
    }
  }
  return { vertices, index: index.slice(0, o), sides: sides.done(), mc: { positions: pos.done(), normals: nor.done() } };
}

/** All of partSurface() as one triangle list (for an STL). */
export function partTriangles(surface) {
  const { vertices: V, index: I, sides, mc } = surface;
  const out = new Float32Array(I.length * 3 + sides.length + mc.positions.length);
  let o = 0;
  for (let k = 0; k < I.length; k++) { out[o++] = V[I[k] * 3]; out[o++] = V[I[k] * 3 + 1]; out[o++] = V[I[k] * 3 + 2]; }
  out.set(sides, o); o += sides.length;
  out.set(mc.positions, o);
  return out;
}

/** Binary STL from a triangle list (normals from the corner order). */
export function trianglesToStl(tri) {
  const n = tri.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let k = 0; k < tri.length; k += 9) {
    const ux = tri[k + 3] - tri[k], uy = tri[k + 4] - tri[k + 1], uz = tri[k + 5] - tri[k + 2];
    const vx = tri[k + 6] - tri[k], vy = tri[k + 7] - tri[k + 1], vz = tri[k + 8] - tri[k + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / nl, true); dv.setFloat32(o + 4, ny / nl, true); dv.setFloat32(o + 8, nz / nl, true); o += 12;
    for (let c = 0; c < 9; c++) { dv.setFloat32(o, tri[k + c], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}
