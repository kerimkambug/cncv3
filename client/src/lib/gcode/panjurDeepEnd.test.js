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
const coneAtDeepest = t14RadiusAtDepth(base, 18 - base.endZ); // ≈ 2.07 mm: from the deepest tip to the top (18)
const shallowRow = t14RadiusAtDepth(base, 18 - base.startZ); // the first row's ball at the surface

describe('panjur deep end', () => {
  it('every panjur stops short so its cone ends on the next panjur\'s start; the pitch and the starts stay', () => {
    const g = panjurGroups(base);
    expect(deepEndPullback(base)).toBeCloseTo(coneAtDeepest, 6);
    expect(g.groups[0].start).toBeCloseTo(60 + shallowRow, 6); // the first row's ball stays off the frame
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
    expect(upper[0].start).toBeCloseTo(170 + shallowRow, 6);
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

describe('the shop\'s new relief bit (Ø3 tip, Ø8 root, 30 mm cone)', () => {
  it('the cone still ends on the next panjur\'s start and on the frame; the simulation\'s T14 is the same bit', async () => {
    const { TOOL_TABLE } = await import('../sim/millSim.js');
    const c = { ...base, t14TipDia: 3, t14BodyDia: 8, t14Height: 30, feed: 20000, plunge: 3000, toolNo: '14', spindle: 12000, groundEntry: false, exitCut: 4, drillTool: '4', drillSpindle: 12000, exitToolDia: 4, safeZ: 30, toolChangeZ: 30, homeZ: 30 };
    const cone = t14RadiusAtDepth(c, 18 - c.endZ);
    expect(cone).toBeCloseTo(2.62, 2); // the cone tangent to the Ø3 ball, 14.9 mm up
    // the simulation's T14: Ø8, Ø3 tip, the same flank angle as the 30 mm cone
    expect(TOOL_TABLE[14]).toMatchObject({ type: 'taper', dia: 8, tipDia: 3 });
    expect(Math.tan(((TOOL_TABLE[14].angle / 2) * Math.PI) / 180)).toBeCloseTo(2.5 / 30, 3);
    const g = panjurGroups(c);
    expect(g.groups[0].end + cone).toBeCloseTo(g.groups[1].start, 6);
    expect(g.groups.at(-1).end + cone).toBeCloseTo(240, 6);
    const { grid } = simulate(generatePanjurGcode(c).gcode, { top: 18, cell: 0.05, tools: { 14: TOOL_TABLE[14] }, box: { x0: 150, y0: 50, x1: 250, y1: 250 } });
    const zAt = (y) => grid.z[Math.floor((y - grid.y0) / grid.cell) * grid.w + Math.floor((200 - grid.x0) / grid.cell)];
    const next = g.groups[1].start;
    for (let y = next - 0.45; y < next - 0.15; y += 0.05) expect(zAt(y)).toBeLessThan(17.5); // the gap is cut
    expect(zAt(next + 1)).toBeGreaterThan(17.5); // the next panjur is not entered
  });

  it('the cut stops on the frame line on all four sides (the bit steps in before going deeper)', async () => {
    const { TOOL_TABLE } = await import('../sim/millSim.js');
    const c = { ...base, t14TipDia: 3, t14BodyDia: 8, t14Height: 30, feed: 20000, plunge: 3000, toolNo: '14', spindle: 12000, groundEntry: false, exitCut: 4, drillTool: '4', drillSpindle: 12000, exitToolDia: 4, safeZ: 30, toolChangeZ: 30, homeZ: 30 };
    const { grid } = simulate(generatePanjurGcode(c).gcode, { top: 18, cell: 0.05, tools: { 14: TOOL_TABLE[14] }, box: { x0: 50, y0: 50, x1: 350, y1: 250 } });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) {
      if (grid.z[j * grid.w + i] >= 17.99) continue;
      const x = grid.x0 + (i + 0.5) * grid.cell, y = grid.y0 + (j + 0.5) * grid.cell;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    expect(x0).toBeGreaterThan(60 - 0.03); expect(x1).toBeLessThan(340 + 0.03);
    expect(y0).toBeGreaterThan(60 - 0.03); expect(y1).toBeLessThan(240 + 0.03);
  });
});

describe('straight edges (edgeInset "duz", the default)', () => {
  it('every row runs between the same two X; the bit never passes the frame, even on a board thicker than 18', () => {
    const c = { ...base, edgeInset: 'duz', endZ: 5, t14TipDia: 3, t14BodyDia: 3, t14Height: 30, feed: 20000, plunge: 3000, toolNo: '14', spindle: 18000, groundEntry: false, exitCut: 4, drillTool: '4', drillSpindle: 12000, exitToolDia: 4, safeZ: 30, toolChangeZ: 30, homeZ: 30 };
    const gcode = generatePanjurGcode(c).gcode;
    const xs = new Set(gcode.split('\n').filter((l) => / G1 X/.test(l)).map((l) => l.match(/X([\d.]+)/)[1]));
    expect([...xs].sort()).toEqual(['338.50', '61.50']); // Ø3 ball: 1.5 in from both frame lines
    for (const top of [18, 18.3]) {
      const { grid } = simulate(gcode, { top, cell: 0.05, tools: { 14: { type: 'ball', dia: 3, name: 'b' } }, box: { x0: 50, y0: 50, x1: 350, y1: 250 } });
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) {
        if (grid.z[j * grid.w + i] >= top - 0.01) continue;
        const x = grid.x0 + (i + 0.5) * grid.cell, y = grid.y0 + (j + 0.5) * grid.cell;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      expect(x0).toBeGreaterThan(60 - 0.03); expect(x1).toBeLessThan(340 + 0.03);
      expect(y0).toBeGreaterThan(60 - 0.03); expect(y1).toBeLessThan(240 + 0.03);
    }
  });
});
