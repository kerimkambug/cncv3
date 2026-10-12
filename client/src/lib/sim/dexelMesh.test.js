import { describe, it, expect } from 'vitest';
import { simulate } from './millSim.js';
import { partSurface, partTriangles, trianglesToStl } from './dexelMesh.js';

// T-slot cutter: head Ø20 × 4 mm, neck Ø6 up to 12 mm, shank Ø12 above
const tslot = { type: 'custom', dia: 20, name: 'T15', profile: [[0, 0], [10, 0]], outline: [{ closed: true, pts: [[0, 0], [10, 0], [10, 4], [3, 4], [3, 12], [6, 12], [6, 30], [0, 30]] }] };
const box = { x0: 0, y0: 0, x1: 60, y1: 40 };
const run = () => simulate('M6T15\nG0 X-30 Y20 Z30\nG0 Z8\nG1 X90 F1000\nG0 Z30', { top: 18, cell: 0.25, box, tools: { 15: tslot } }).grid;

/** Volume enclosed by a triangle list (divergence theorem): only right for a closed, outward-facing surface. */
const volume = (t) => { let v = 0; for (let k = 0; k < t.length; k += 9) v += t[k] * (t[k + 4] * t[k + 8] - t[k + 5] * t[k + 7]) - t[k + 1] * (t[k + 3] * t[k + 8] - t[k + 5] * t[k + 6]) + t[k + 2] * (t[k + 3] * t[k + 7] - t[k + 4] * t[k + 6]); return v / 6; };
/** The material the grid holds: every column's solid height × its area. */
const held = (g) => { let v = 0; for (let k = 0; k < g.z.length; k++) { let m = g.z[k]; for (const [a, b] of g.voids?.get(k) || []) m -= b - a; v += m; } return v * g.cell * g.cell; };

const all = (g, s = 1) => partTriangles(partSurface(g, s));
const mcOf = (g, s = 1) => partSurface(g, s).mc;

describe('part with hollows under the surface (height map + marching-cubes tiles)', () => {
  it('is closed and faces outwards: the volume it encloses is the material left', () => {
    const g = run();
    expect(g.voids.size).toBeGreaterThan(0);
    const t = all(g);
    // the outer columns sit half a cell inside the stock edge: within that rim
    expect(volume(t) / held(g)).toBeGreaterThan(0.97);
    expect(volume(t) / held(g)).toBeLessThan(1.01);
    // and the same on a coarser lattice (the 3D view's)
    expect(volume(all(g, 3)) / held(g)).toBeGreaterThan(0.95);
  });

  it('shows the overhang: right over the head hollow the surface looks down at 12 mm', () => {
    const { positions: t, normals: n } = mcOf(run());
    let found = false;
    for (let k = 0; k < t.length && !found; k += 3) {
      // a point over the hollow (y 24…29), at its ceiling, with a normal pointing down
      if (t[k + 1] > 24 && t[k + 1] < 29 && Math.abs(t[k + 2] - 12) < 0.05 && n[k + 2] < -0.9) found = true;
    }
    expect(found).toBe(true);
  });

  it('the slot walls are smooth: no stair steps along the round head', () => {
    // away from the stock's own sides, every vertex at the floor height of the hollow (z 8)
    // lies within the head's reach (|y−20| ≤ 10 + a cell)
    const t = all(run());
    for (let k = 0; k < t.length; k += 3) {
      if (Math.abs(t[k + 2] - 8) < 0.01 && t[k] > 1 && t[k] < 59 && t[k + 1] > 1 && t[k + 1] < 39) expect(Math.abs(t[k + 1] - 20)).toBeLessThan(10.3);
    }
  });

  it('a part without hollows is the plain height map: no marching cubes, still closed', () => {
    const g = simulate(['M6T6', 'G0 X10 Y20 Z30', 'G1 Z10 F1000', 'G1 X50', 'G0 Z30'].join('\n'), { top: 18, cell: 0.25, box }).grid;
    const s = partSurface(g);
    expect(s.mc.positions.length).toBe(0);
    expect(volume(partTriangles(s)) / held(g)).toBeGreaterThan(0.97);
  });

  it('writes a valid STL', () => {
    const buf = trianglesToStl(all(run(), 2));
    const n = new DataView(buf).getUint32(80, true);
    expect(n).toBeGreaterThan(100);
    expect(buf.byteLength).toBe(84 + n * 50);
  });
});
