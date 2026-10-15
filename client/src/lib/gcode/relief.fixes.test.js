import { describe, it, expect } from 'vitest';
import { buildReliefGcodeFromDepthGrid, simplifyPathPoints, cutLevels, makeDropCutter } from './relief.js';
import { simulate } from '../sim/millSim.js';
import { reliefMachineZ } from '../../../../shared/gcode/reliefConvention.js';

// 60 × 40 mm relief, 0.25 mm grid: a steep step (a wall) and a ramp — where a
// per-point slope correction let the ball bite into the wall
const W = 60, H = 40, cols = 241, rows = 161;
const grid = new Float32Array(cols * rows);
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const x = (c / (cols - 1)) * W;
  grid[r * cols + c] = x < 20 ? 0.2 : x < 30 ? 1 : Math.max(0.2, 1 - (x - 30) / 30); // low, high plateau, ramp down
}
const cfg = { width: W, height: H, thickness: 18, maxDepth: 6, stepover: 0.8, resolution: 0.4, toolType: 'ballnose', toolDia: 6, toolNo: '13', safeZ: 25, homeZ: 40 };
const surface = (x, y) => reliefMachineZ(grid[Math.round((1 - y / H) * (rows - 1)) * cols + Math.round((x / W) * (cols - 1))], 18, 6);

function gouges(gcode) {
  const { grid: g } = simulate(gcode, { top: 18, cell: 0.2, box: { x0: 0, y0: 0, x1: W, y1: H }, tools: { 13: { type: 'ball', dia: 6, name: 'T13' } } });
  let worst = 0;
  for (let j = 0; j < g.h; j += 2) for (let i = 0; i < g.w; i += 2) {
    const x = g.x0 + (i + 0.5) * g.cell, y = g.y0 + (j + 0.5) * g.cell;
    worst = Math.max(worst, surface(x, y) - g.z[j * g.w + i]);
  }
  return worst;
}

describe('relief generator fixes', () => {
  for (const direction of ['x', 'y', 'cross']) {
    it(`${direction} raster never cuts below the relief surface (drop-cutter, 2D simplification, safe smoothing)`, () => {
      const { gcode } = buildReliefGcodeFromDepthGrid(grid, cols, rows, { ...cfg, direction });
      expect(gouges(gcode)).toBeLessThan(0.06);
    }, 60000);
  }

  it('cross: the tool lifts between the X and the Y pass', () => {
    const { gcode } = buildReliefGcodeFromDepthGrid(grid, cols, rows, { ...cfg, direction: 'cross' });
    const lines = gcode.split('\n');
    // the Y pass starts at X0 Y0 with a rapid at safe height, right after a lift
    const lifts = lines.filter((l) => /^G0 Z25/.test(l)).length;
    expect(lifts).toBeGreaterThanOrEqual(2);
    // approaches at safe height: the header's home move + one per pass, never a feed across the part
    const approaches = lines.filter((l) => /^G0 X.*Z25/.test(l)).length;
    expect(approaches).toBe(3);
  });

  it('simplifier: a Y-direction line keeps the points the straight move would cut into', () => {
    const pts = [{ x: 5, y: 0, z: 10 }, { x: 5, y: 1, z: 10.005 }, { x: 5, y: 2, z: 7 }];
    const out = simplifyPathPoints(pts, 0.01);
    expect(out).toHaveLength(3); // dropping the middle one would cut ~1.5 mm into it
  });

  it('drop-cutter: next to a wall the ball rests on the wall top, not on the floor', () => {
    const drop = makeDropCutter(grid, cols, rows, cfg);
    // 1 mm left of the plateau's edge (x = 20): the ball (R3) touches the high side
    expect(drop(19, 20)).toBeGreaterThan(surface(19, 20) + 1);
  });

  it('outer cut: optional step-down, one pass by default', () => {
    expect(cutLevels(18, 0)).toEqual([0]);
    expect(cutLevels(18, 6)).toEqual([12, 6, 0]);
    expect(cutLevels(18, 5)).toEqual([13, 8, 3, 0]);
    const { gcode } = buildReliefGcodeFromDepthGrid(grid, cols, rows, { ...cfg, enableOuterCut: true, outerCutStepdown: 6 });
    expect(gcode).toMatch(/G1 Z12\.000/);
    expect(gcode).toMatch(/G1 Z6\.000/);
    expect(gcode).toMatch(/G1 Z0\.000/);
  });
});
