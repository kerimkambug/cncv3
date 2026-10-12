import { describe, it, expect } from 'vitest';
import { simulate, gridToStl } from './millSim.js';
import { dexelTriangles } from './dexelMesh.js';

// T-slot cutter: head Ø20 × 4 mm, neck Ø6 up to 12 mm, shank Ø12 above
const tslot = { type: 'custom', dia: 20, name: 'T15', profile: [[0, 0], [10, 0]], outline: [{ closed: true, pts: [[0, 0], [10, 0], [10, 4], [3, 4], [3, 12], [6, 12], [6, 30], [0, 30]] }] };
const box = { x0: 0, y0: 0, x1: 60, y1: 40 };
const run = () => simulate('M6T15\nG0 X-30 Y20 Z30\nG0 Z8\nG1 X90 F1000\nG0 Z30', { top: 18, cell: 0.5, box, tools: { 15: tslot } }).grid;

/** Volume enclosed by a triangle list (divergence theorem): only right for a closed, outward-facing surface. */
const volume = (t) => { let v = 0; for (let k = 0; k < t.length; k += 9) v += t[k] * (t[k + 4] * t[k + 8] - t[k + 5] * t[k + 7]) - t[k + 1] * (t[k + 3] * t[k + 8] - t[k + 5] * t[k + 6]) + t[k + 2] * (t[k + 3] * t[k + 7] - t[k + 4] * t[k + 6]); return v / 6; };
/** The material the grid holds: every column's solid height × its area. */
const held = (g) => { let v = 0; for (let k = 0; k < g.z.length; k++) { let m = g.z[k]; for (const [a, b] of g.voids?.get(k) || []) m -= b - a; v += m; } return v * g.cell * g.cell; };

describe('part with hollows under the surface (dexel solid)', () => {
  it('is closed and faces outwards: the volume it encloses is the material left', () => {
    const g = run();
    expect(g.voids.size).toBeGreaterThan(0);
    const t = dexelTriangles(g);
    expect(volume(t)).toBeCloseTo(held(g), 3);
    // the T groove: 60 × 40 × 18 block minus the slot (6 wide 8…18) and the head hollow (20 wide 8…12), roughly
    expect(held(g)).toBeLessThan(60 * 40 * 18 - 60 * (6 * 10 + 14 * 4) * 0.9);
  });

  it('shows the overhang: over the head hollow there is a face looking down at 12 mm', () => {
    const t = dexelTriangles(run());
    let found = false;
    for (let k = 0; k < t.length && !found; k += 9) {
      const flat = Math.abs(t[k + 2] - 12) < 0.01 && Math.abs(t[k + 5] - 12) < 0.01 && Math.abs(t[k + 8] - 12) < 0.01;
      const nz = (t[k + 3] - t[k]) * (t[k + 7] - t[k + 1]) - (t[k + 4] - t[k + 1]) * (t[k + 6] - t[k]);
      if (flat && nz < 0) found = true;
    }
    expect(found).toBe(true);
  });

  it('the STL download uses it', () => {
    const buf = gridToStl(run(), 0.5);
    const n = new DataView(buf).getUint32(80, true);
    expect(buf.byteLength).toBe(84 + n * 50);
    expect(n).toBe(dexelTriangles(run()).length / 9);
  });
});
