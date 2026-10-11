import { describe, it, expect } from 'vitest';
import { profile, simulate } from './millSim.js';
import { profileFromDxf } from './toolProfile.js';
import { simShape, toolProblem } from './toolMagazine.js';

/** Minimal ASCII DXF: one closed LWPOLYLINE per point list. */
function dxf(...polys) {
  const ents = polys.map((pts) => [
    '0', 'LWPOLYLINE', '8', '0', '90', String(pts.length), '70', '1',
    ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)]),
  ].join('\n'));
  return ['0', 'SECTION', '2', 'ENTITIES', ...ents, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}
const at = (grid, x, y) => grid.z[Math.floor((y - grid.y0) / grid.cell) * grid.w + Math.floor((x - grid.x0) / grid.cell)];
const tool = (text) => { const p = profileFromDxf(text); return { type: 'custom', ...p }; };

describe('custom tool profile from an AutoCAD drawing', () => {
  it('half profile from the axis (stepped tabla bit): Ø24, flat Ø10 tip, 3 mm step', () => {
    const t = tool(dxf([[0, 0], [5, 0], [5, 3], [12, 3], [12, 20], [0, 20]]));
    expect(t.dia).toBeCloseTo(24, 3);
    expect(t.height).toBeCloseTo(20, 3);
    expect(profile(t, 2)).toBeCloseTo(0, 3);
    expect(profile(t, 8)).toBeCloseTo(3, 3);
    expect(profile(t, 12.5)).toBe(Infinity);
    expect(toolProblem(t)).toBe('');
  });

  it('whole silhouette drawn anywhere (kulp: Ø20 disc on a Ø6 neck): axis = its middle, the disc bottom cuts', () => {
    const t = tool(dxf([[90, 50], [110, 50], [110, 54], [103, 54], [103, 75], [97, 75], [97, 54], [90, 54]]));
    expect(t.axis).toBe('center');
    expect(t.dia).toBeCloseTo(20, 3);
    expect(profile(t, 0)).toBeCloseTo(0, 3);
    expect(profile(t, 9.5)).toBeCloseTo(0, 3);
  });

  it('a V drawn as a whole silhouette around X=0 matches the built-in V', () => {
    const t = tool(dxf([[0, 0], [10, 10], [10, 25], [-10, 25], [-10, 10]]));
    expect(t.axis).toBe('x0');
    expect(profile(t, 4)).toBeCloseTo(profile({ type: 'v', dia: 20, angle: 90 }, 4), 3);
  });

  it('the simulation carves the drawn shape', () => {
    const t = tool(dxf([[0, 0], [5, 0], [5, 3], [12, 3], [12, 20], [0, 20]]));
    const g = 'M6T9\nG0 X10 Y50 Z30\nG1 Z10 F1000\nG1 X90\nG0 Z30';
    const { grid } = simulate(g, { top: 18, cell: 0.25, box: { x0: -20, y0: -20, x1: 120, y1: 120 }, tools: { 9: { ...simShape(t), name: 'T9 tabla' } } });
    expect(at(grid, 50, 50)).toBeCloseTo(10, 2); // centre: the Ø10 flat tip
    expect(at(grid, 50, 58)).toBeCloseTo(13, 2); // on the step
    expect(at(grid, 50, 62.5)).toBeCloseTo(18, 2); // outside the Ø24
  });

  it('LINE + ARC drawing (as AutoCAD saves it): flat Ø8 tip stays flat, R6 flank follows the arc', () => {
    const L = (a, b, c, d) => ['0', 'LINE', '8', '0', '10', a, '20', b, '11', c, '21', d].join('\n');
    const A = (x, y, r, s, e) => ['0', 'ARC', '8', '0', '10', x, '20', y, '40', r, '50', s, '51', e].join('\n');
    const text = ['0', 'SECTION', '2', 'ENTITIES', L(0, 0, 4, 0), A(4, 6, 6, 270, 360), L(10, 6, 10, 12), L(10, 12, 4, 12), L(4, 12, 4, 40), L(4, 40, 0, 40), '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const t = tool(text);
    expect(t.dia).toBeCloseTo(20, 2);
    expect(t.height).toBeCloseTo(40, 2);
    expect(profile(t, 3.9)).toBeCloseTo(0, 2);
    expect(profile(t, 7)).toBeCloseTo(6 - Math.sqrt(36 - 9), 1); // on the arc
    expect(t.outline[0].pts.length).toBeGreaterThan(5);
  });

  it('a custom tool without a drawing is not usable', () => {
    expect(toolProblem({ type: 'custom', name: 'kulp' })).toMatch(/DXF/);
  });
});
