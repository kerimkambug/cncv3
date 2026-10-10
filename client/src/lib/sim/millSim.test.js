import { describe, it, expect } from 'vitest';
import { simulate, gridToStl, profile, TOOL_TABLE } from './millSim.js';

const at = (grid, x, y) => grid.z[Math.floor((y - grid.y0) / grid.cell) * grid.w + Math.floor((x - grid.x0) / grid.cell)];
const box = { x0: -20, y0: -20, x1: 120, y1: 120 };

describe('material removal simulation', () => {
  it('flat end mill: a level pass cuts exactly its depth, its own width', () => {
    const g = 'M6T10\nG0 X10 Y50 Z30\nG1 Z12 F1000\nG1 X90\nG0 Z30';
    const { grid, stats } = simulate(g, { top: 18, cell: 0.25, box });
    expect(at(grid, 50, 50)).toBeCloseTo(12, 3);
    expect(at(grid, 50, 54.6)).toBeCloseTo(12, 3); // inside the 5 mm radius
    expect(at(grid, 50, 55.6)).toBeCloseTo(18, 3); // outside it
    expect(stats.belowTable).toBe(0);
  });

  it('135° V keeps widening: 8 mm deep → ~38.6 mm wide groove (no 20 mm limit)', () => {
    const g = 'M6T12\nG0 X10 Y50 Z30\nG1 Z10 F1000\nG1 X90\nG0 Z30';
    const { grid } = simulate(g, { top: 18, cell: 0.25, box });
    const half = 8 * Math.tan((67.5 * Math.PI) / 180); // 19.3 mm
    expect(at(grid, 50, 50 + half - 1)).toBeLessThan(18);
    expect(at(grid, 50, 50 + half + 1)).toBeCloseTo(18, 3);
    expect(at(grid, 50, 50 + 9.66)).toBeCloseTo(14, 1); // half way down the flank
  });

  it('ball nose leaves its own round profile', () => {
    const g = 'M6T7\nG0 X10 Y50 Z30\nG1 Z8 F1000\nG1 X90\nG0 Z30';
    const { grid } = simulate(g, { top: 18, cell: 0.25, box });
    expect(at(grid, 50, 50)).toBeCloseTo(8, 2);
    // within the grid's own sampling (0.25 mm cells on a slope)
    expect(Math.abs(at(grid, 50, 60) - (8 + profile(TOOL_TABLE[7], 10)))).toBeLessThan(0.15);
  });

  it('the first move from the unknown start position is not a cut', () => {
    const g = 'M6T6\nG0 X50 Y50 Z30\nG0 Z30';
    const { grid } = simulate(g, { top: 18, cell: 0.5, box });
    expect(Math.min(...grid.z)).toBe(18);
  });

  it('roundover bits: T3 pointed, T5 with a 1 mm flat tip', () => {
    expect(profile(TOOL_TABLE[3], 0)).toBe(0);
    expect(profile(TOOL_TABLE[3], 0.5)).toBeGreaterThan(2); // the flank rises steeply from the point
    expect(profile(TOOL_TABLE[5], 0.5)).toBe(0); // flat
    // 14.5 mm wide: passes 14.5 mm apart leave a round bead between them
    expect(profile(TOOL_TABLE[3], 7.25)).toBeCloseTo(7.25, 6);
    expect(profile(TOOL_TABLE[5], 7.25)).toBeCloseTo(6.75, 6);
  });

  it('STL: binary, closed box around the surface', () => {
    const { grid } = simulate('M6T10\nG0 X10 Y50 Z30\nG1 Z12\nG1 X90\nG0 Z30', { top: 18, cell: 0.5, box });
    const buf = gridToStl(grid, 1);
    const n = new DataView(buf).getUint32(80, true);
    expect(buf.byteLength).toBe(84 + n * 50);
    expect(n).toBeGreaterThan(1000);
  });
});
