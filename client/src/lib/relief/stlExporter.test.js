import { describe, it, expect } from 'vitest';
import { exportDepthGridToSTL } from './stlExporter.js';

// parse a binary STL into its triangles
async function triangles(blob) {
  const view = new DataView(await blob.arrayBuffer());
  const n = view.getUint32(80, true);
  expect(view.byteLength).toBe(84 + n * 50); // the header count matches what was written
  const tris = [];
  for (let k = 0; k < n; k++) {
    const o = 84 + k * 50 + 12, p = [];
    for (let v = 0; v < 3; v++) p.push([0, 1, 2].map((a) => view.getFloat32(o + v * 12 + a * 4, true)));
    tris.push(p);
  }
  return tris;
}

describe('relief STL export', () => {
  it('is watertight: every edge is shared by exactly two triangles, in opposite directions', async () => {
    const cols = 7, rows = 5, grid = new Float32Array(cols * rows).map((_, i) => (i % 3) / 2);
    const tris = await triangles(exportDepthGridToSTL(grid, cols, rows, 60, 40, 5, 2));
    const key = (a, b) => `${a.join(',')}>${b.join(',')}`;
    const edges = new Map();
    for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.set(key(p, q), (edges.get(key(p, q)) || 0) + 1);
    for (const [k, n] of edges) {
      expect(n).toBe(1);
      const [p, q] = k.split('>');
      expect(edges.get(`${q}>${p}`)).toBe(1);
    }
  });

  it('the bottom faces down', async () => {
    const tris = await triangles(exportDepthGridToSTL(new Float32Array(9).fill(0.5), 3, 3, 10, 10, 5, 2));
    const bottom = tris.filter((t) => t.every((p) => p[2] === 0));
    expect(bottom.length).toBe(8);
    for (const [a, b, c] of bottom) {
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      expect(nz).toBeLessThan(0);
    }
  });
});
