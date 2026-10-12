// Solid of a simulated part that has hollows under its surface (a kulp bit, a
// T-slot cutter: see grid.voids in millSim.js). A height map alone cannot show
// them, so the part is built column by column: every column is a stack of solid
// stretches; each stretch gets its top and bottom face, and wherever two
// neighbouring columns differ at some height a wall stands between them. The
// result is closed (an STL a slicer accepts) and shows every overhang.
//
// Parts without hollows keep the smooth height-map surface (SimPanel, gridToStl).

// a column at or below this height was cut through to the table
const THROUGH_Z = 0.02;

/** Growable list of triangle corners (x, y, z, …). */
function triangles() {
  let buf = new Float32Array(1 << 16), n = 0;
  const push = (...v) => {
    if (n + v.length > buf.length) { const b = new Float32Array(buf.length * 2); b.set(buf); buf = b; }
    for (const x of v) buf[n++] = x;
  };
  return { push, done: () => buf.subarray(0, n) };
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
 * Triangles of the simulated part, every `stride`-th column (both ways).
 * @param {{x0:number,y0:number,w:number,h:number,cell:number,z:Float32Array,voids?:Map}} grid
 * @param {number} [stride=1]
 * @returns {Float32Array} x,y,z of 3 corners per triangle, outward-facing (counter-clockwise from outside)
 */
export function dexelTriangles(grid, stride = 1) {
  const S = Math.max(1, Math.round(stride));
  const W = Math.floor((grid.w - 1) / S) + 1, H = Math.floor((grid.h - 1) / S) + 1;
  const cs = grid.cell * S;
  const X = (i) => grid.x0 + (i * S + 0.5) * grid.cell - cs / 2; // left edge of column i
  const Y = (j) => grid.y0 + (j * S + 0.5) * grid.cell - cs / 2;
  const voids = grid.voids || new Map();

  // the solid stretches of every column (empty: cut through)
  const solid = new Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = Math.min(grid.h - 1, j * S) * grid.w + Math.min(grid.w - 1, i * S);
    const top = grid.z[k];
    let list = top > THROUGH_Z ? [[0, top]] : [];
    const v = voids.get(k);
    if (v && list.length) list = minus(list, v);
    solid[j * W + i] = list;
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? [] : solid[j * W + i]);
  const plain = (s) => s.length === 1 && s[0][0] <= 1e-6; // one stretch standing on the table

  const t = triangles();
  const up = (x0, x1, y0, y1, z) => t.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
  const down = (x0, x1, y0, y1, z) => t.push(x0, y0, z, x1, y1, z, x1, y0, z, x0, y0, z, x0, y1, z, x1, y1, z);
  // wall at x = xe between y0…y1, z0…z1, facing +x (dir 1) or −x (dir −1)
  const wallX = (xe, y0, y1, z0, z1, dir) => (dir > 0
    ? t.push(xe, y0, z0, xe, y1, z0, xe, y1, z1, xe, y0, z0, xe, y1, z1, xe, y0, z1)
    : t.push(xe, y1, z0, xe, y0, z0, xe, y0, z1, xe, y1, z0, xe, y0, z1, xe, y1, z1));
  const wallY = (ye, x0, x1, z0, z1, dir) => (dir > 0
    ? t.push(x1, ye, z0, x0, ye, z0, x0, ye, z1, x1, ye, z0, x0, ye, z1, x1, ye, z1)
    : t.push(x0, ye, z0, x1, ye, z0, x1, ye, z1, x0, ye, z0, x1, ye, z1, x0, ye, z1));

  for (let j = 0; j < H; j++) {
    const y0 = Y(j), y1 = Y(j + 1);
    // tops and bottoms; plain columns merged along the row (same top / any top for the bottom)
    for (let i = 0; i < W;) {
      const s = at(i, j);
      if (!s.length) { i++; continue; }
      if (!plain(s)) {
        for (const [m0, m1] of s) { up(X(i), X(i + 1), y0, y1, m1); down(X(i), X(i + 1), y0, y1, m0); }
        i++; continue;
      }
      let k = i;
      while (k < W && plain(at(k, j))) k++;
      for (let a = i; a < k;) {
        const zt = at(a, j)[0][1];
        let b = a + 1;
        while (b < k && Math.abs(at(b, j)[0][1] - zt) < 1e-4) b++;
        up(X(a), X(b), y0, y1, zt);
        a = b;
      }
      down(X(i), X(k), y0, y1, 0);
      i = k;
    }
    // walls toward the east neighbour (and the west edge of the part)
    for (let i = -1; i < W; i++) {
      const A = at(i, j), B = at(i + 1, j), xe = X(i + 1);
      for (const [a, b] of minus(A, B)) wallX(xe, y0, y1, a, b, 1);
      for (const [a, b] of minus(B, A)) wallX(xe, y0, y1, a, b, -1);
    }
  }
  // walls toward the north neighbour (and the south edge)
  for (let j = -1; j < H; j++) {
    const ye = Y(j + 1);
    for (let i = 0; i < W; i++) {
      const A = at(i, j), B = at(i, j + 1);
      for (const [a, b] of minus(A, B)) wallY(ye, X(i), X(i + 1), a, b, 1);
      for (const [a, b] of minus(B, A)) wallY(ye, X(i), X(i + 1), a, b, -1);
    }
  }
  return t.done();
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
