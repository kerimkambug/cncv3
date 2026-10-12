// The deep end of the panjurs: the T14 cone is wider at the surface than at its
// tip, so every panjur's cut stops short: at the surface the cone ends exactly
// where the next panjur starts (the exit gap is cut, no ridge left, the next
// panjur untouched) or exactly on the frame (see deepEndPullback).
import { describe, it, expect } from 'vitest';
import { deepEndPullback, generatePanjurGcode, panjurGroups, t14RadiusAtDepth } from './panjur.js';
import { simulate } from '../sim/millSim.js';

const base = {
  width: 400, height: 300, offsetMode: 'normal', direction: 'y', offset: 60,
  offsetLeft: 60, offsetRight: 60, offsetBottom: 60, offsetTop: 60, centerFlat: 0,
  pitch: 40.5, exitGap: 0.45, stepover: 0.468, edgeInset: 'auto', startZ: 17.937, endZ: 3.105,
  t14TipDia: 2, t14BodyDia: 12, t14Height: 65,
};
const coneAtDeepest = t14RadiusAtDepth(base, base.startZ - base.endZ); // ≈ 2.14 mm

describe('panjur deep end', () => {
  it('every panjur stops short so its cone ends on the next panjur\'s start; the pitch and the starts stay', () => {
    const g = panjurGroups(base);
    expect(deepEndPullback(base)).toBeCloseTo(coneAtDeepest, 6);
    expect(g.groups[0].start).toBe(60);
    for (let i = 0; i + 1 < g.groups.length; i++) {
      // the cone at the surface ends exactly where the next panjur starts
      expect(g.groups[i].end + coneAtDeepest).toBeCloseTo(g.groups[i + 1].start, 6);
      expect(g.groups[i + 1].start - g.groups[i].face).toBeCloseTo(0.45, 6);
    }
    // and the last one exactly on the frame line
    expect(g.groups.at(-1).end + coneAtDeepest).toBeCloseTo(240, 6);
  });

  it('with the centre flat: the half before it stops on it, the half after starts on it', () => {
    const g = panjurGroups({ ...base, offsetMode: 'detailed', centerFlat: 40 });
    const lower = g.groups.filter((x) => x.side === 'start'), upper = g.groups.filter((x) => x.side === 'end');
    expect(lower.at(-1).end + coneAtDeepest).toBeCloseTo(130, 6);
    expect(upper[0].start).toBeCloseTo(170, 6);
    expect(upper.at(-1).end + coneAtDeepest).toBeCloseTo(240, 6);
  });

  it('a hand-set edge inset is used instead of the cone', () => {
    expect(deepEndPullback({ ...base, edgeInset: 3 })).toBeCloseTo(3, 6);
    expect(deepEndPullback({ ...base, edgeInset: 0 })).toBe(0);
  });

  it('cut: the cone does not reach the next panjur', () => {
    const g = panjurGroups(base);
    const gcode = generatePanjurGcode({ ...base, feed: 20000, plunge: 3000, toolNo: '14', spindle: 12000, groundEntry: false, exitCut: 4, drillTool: '4', drillSpindle: 12000, exitToolDia: 4, safeZ: 30, toolChangeZ: 30, homeZ: 30 }).gcode;
    const { grid } = simulate(gcode, { top: 18, cell: 0.05, tools: { 14: { type: 'taper', dia: 12, tipDia: 2, angle: 8.8, name: 'T14' } }, box: { x0: 150, y0: 50, x1: 250, y1: 250 } });
    const next = g.groups[1].start;
    const zAt = (y) => grid.z[Math.floor((y - grid.y0) / grid.cell) * grid.w + Math.floor((200 - grid.x0) / grid.cell)];
    // the exit gap between them is cut: no ridge left at the surface
    for (let y = next - 0.45; y < next - 0.15; y += 0.05) expect(zAt(y)).toBeLessThan(17.5);
    // …and the next panjur is not entered (the cone used to run ~1.7 mm into it, well below its surface)
    expect(zAt(next + 1)).toBeGreaterThan(17.5);
  });
});

describe('panjur deep end with the T4 opening (kesimli)', () => {
  it('the opening runs through from 3 mm in the old panjur to past the next one\'s start: no wall left between', () => {
    const c = { ...base, feed: 20000, plunge: 3000, toolNo: '14', spindle: 12000, groundEntry: true, exitCut: 4, t4Feed: 5000, t4Step: 6, drillTool: '4', drillSpindle: 12000, exitToolDia: 4, safeZ: 30, toolChangeZ: 30, homeZ: 30 };
    const g = panjurGroups(c);
    const gcode = generatePanjurGcode(c).gcode;
    const tools = { 14: { type: 'taper', dia: 12, tipDia: 2, angle: 8.8, name: 'T14' }, 4: { type: 'flat', dia: 4, name: 'T4' } };
    const { grid } = simulate(gcode, { top: 18, cell: 0.05, tools, box: { x0: 150, y0: 50, x1: 250, y1: 250 } });
    const zAt = (y) => grid.z[Math.floor((y - grid.y0) / grid.cell) * grid.w + Math.floor((200 - grid.x0) / grid.cell)];
    const surfaceEnd = g.groups[0].face; // where the panjur ends on the surface
    for (let y = surfaceEnd - 2.9; y <= g.groups[1].start + 0.4; y += 0.1) expect(zAt(y)).toBeLessThan(0.05);
  });
});
