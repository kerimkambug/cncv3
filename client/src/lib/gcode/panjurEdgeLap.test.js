// The Ø4 edge lap: one lap at edgeLapZ around every panjur block takes off the
// little triangles a ball leaves at each panjur's start by the frame — and with
// a centre flat it goes round the two blocks separately, never into the flat.
// Also: 'x' panjurs on a non-square door stay on the door.
import { describe, it, expect } from 'vitest';
import { generatePanjurGcode, panjurGroups } from './panjur.js';
import { simulate } from '../sim/millSim.js';

const base = {
  width: 200, height: 200, offsetMode: 'normal', direction: 'y', offset: 60, offsetLeft: 60, offsetRight: 60, offsetBottom: 60, offsetTop: 60, centerFlat: 0,
  pitch: 40.5, exitGap: 0.45, stepover: 0.468, startZ: 17.5, endZ: 3.105, feed: 20000, plunge: 3000, spindle: 18000, toolNo: '14', groundEntry: false,
  exitCut: 4, drillTool: '4', exitToolDia: 4, drillSpindle: 12000, safeZ: 30, toolChangeZ: 30, homeZ: 30, thickness: 18,
  t14TipDia: 3, t14BodyDia: 3, t14Height: 30, edgeInset: 'auto',
};
const tools = { 14: { type: 'ball', dia: 3 }, 4: { type: 'flat', dia: 4 } };

function cutBox(gcode) {
  let z = 99, x = 0, y = 0; const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const l of gcode.split('\n')) {
    const mx = /X(-?[\d.]+)/.exec(l), my = /Y(-?[\d.]+)/.exec(l), mz = /Z(-?[\d.]+)/.exec(l);
    if (mx) x = +mx[1]; if (my) y = +my[1]; if (mz) z = +mz[1];
    if (z < 18) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); }
  }
  return b;
}

describe('panjur: Ø4 edge lap', () => {
  it('takes off what the ball leaves above the lap Z, and never cuts the frame', () => {
    const leftAbove = (cfg) => {
      const { grid: g } = simulate(generatePanjurGcode(cfg).gcode, { top: 18, cell: 0.1, box: { x0: 50, y0: 50, x1: 150, y1: 150 }, tools });
      let above = 0, frame = 0;
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
        const x = g.x0 + (i + 0.5) * g.cell, y = g.y0 + (j + 0.5) * g.cell, z = g.z[j * g.w + i];
        const inside = x > 60.05 && x < 139.95 && y > 60.05 && y < 139.95;
        if (inside && z > 17.65) above++;
        if (!(x > 59.9 && x < 140.1 && y > 59.9 && y < 140.1) && z < 17.99) frame++;
      }
      return { above: above * 0.01, frame };
    };
    const without = leftAbove(base);
    const withLap = leftAbove({ ...base, edgeLap: true, edgeLapZ: 17.6 });
    expect(without.above).toBeGreaterThan(20);
    expect(withLap.above).toBeLessThan(4); // only the Ø4's own R2 at the area's four outer corners
    expect(withLap.frame).toBe(0);
  }, 60000);

  it('changes to the Ø4 after the panjurs (no ground entry) and laps at the given Z', () => {
    const lines = generatePanjurGcode({ ...base, edgeLap: true, edgeLapZ: 17.6 }).gcode.split('\n');
    const m6 = lines.filter((l) => /M6T/.test(l));
    expect(m6.map((l) => l.replace(/^N\d+ /, ''))).toEqual(['M6T14', 'M6T4']);
    const t4 = lines.findIndex((l) => /M6T4/.test(l));
    expect(lines[t4 - 2]).toMatch(/M5$/); // spindle stopped before the change
    expect(lines.slice(t4).some((l) => /G1 Z17\.60/.test(l))).toBe(true);
  });

  it('with ground entry the T4 is already in: no second change', () => {
    const lines = generatePanjurGcode({ ...base, groundEntry: true, edgeLap: true, edgeLapZ: 17.6 }).gcode.split('\n');
    expect(lines.filter((l) => /M6T4/.test(l))).toHaveLength(1);
  });

  it('a lap deeper than the panjurs\' start is refused; the same level (or empty) is fine', () => {
    expect(() => generatePanjurGcode({ ...base, edgeLap: true, edgeLapZ: 17.4 })).toThrow(/başlangıç/);
    expect(() => generatePanjurGcode({ ...base, edgeLap: true, edgeLapZ: 18 })).toThrow();
    expect(generatePanjurGcode({ ...base, edgeLap: true, edgeLapZ: 17.5 }).gcode).toMatch(/G1 Z17\.50 F800/);
    expect(generatePanjurGcode({ ...base, edgeLap: true, edgeLapZ: '' }).gcode).toMatch(/G1 Z17\.50 F800/);
  });

  it('at the start level: nothing left above it by the frame, and nothing cut under it', () => {
    const sim = (cfg) => simulate(generatePanjurGcode(cfg).gcode, { top: 18, cell: 0.1, box: { x0: 50, y0: 50, x1: 150, y1: 150 }, tools }).grid;
    const a = sim(base), b = sim({ ...base, edgeLap: true, edgeLapZ: '' });
    let above = 0, deeper = 0;
    for (let k = 0; k < a.z.length; k++) {
      const x = a.x0 + ((k % a.w) + 0.5) * a.cell, y = a.y0 + (Math.floor(k / a.w) + 0.5) * a.cell;
      if (x > 60.05 && x < 139.95 && y > 60.05 && y < 139.95 && b.z[k] > 17.55) above++;
      if (b.z[k] < Math.min(a.z[k], 17.5) - 0.01) deeper++; // the lap only takes what stands above 17.5
    }
    expect(above * 0.01).toBeLessThan(4); // the Ø4's R2 at the area's outer corners
    expect(deeper).toBe(0);
  }, 60000);

  it('centre flat: a lap around each block, the flat untouched', () => {
    const cfg = { ...base, height: 300, offsetMode: 'detailed', centerFlat: 60, edgeLap: true, edgeLapZ: 17.6 };
    const g0 = panjurGroups(cfg);
    expect(g0.blocks).toHaveLength(2);
    const flat0 = g0.blocks[0].end, flat1 = g0.blocks[1].start;
    expect(flat1 - flat0).toBeCloseTo(60, 6);
    const { grid: g } = simulate(generatePanjurGcode(cfg).gcode, { top: 18, cell: 0.1, box: { x0: 50, y0: 50, x1: 150, y1: 250 }, tools });
    let touched = 0;
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const y = g.y0 + (j + 0.5) * g.cell;
      if (y > flat0 + 0.05 && y < flat1 - 0.05 && g.z[j * g.w + i] < 17.99) touched++;
    }
    expect(touched).toBe(0);
  }, 60000);

  it('series: rasters, then laps; the Ø4 is taken once', () => {
    const covers = [0, 210];
    const out = [];
    let n = 1;
    covers.forEach((x, i) => { const r = generatePanjurGcode({ ...base, edgeLap: true, edgeLapZ: 17.6 }, x, 0, true, n, { phase: 'raster', t14Header: i === 0 }); out.push(r.gcode); n = r.nextN; });
    covers.forEach((x, i) => { const r = generatePanjurGcode({ ...base, edgeLap: true, edgeLapZ: 17.6 }, x, 0, true, n, { phase: 'lap', t14Header: false, t4Header: false, lapHeader: i === 0 }); out.push(r.gcode); n = r.nextN; });
    const text = out.join('\n');
    expect((text.match(/M6T/g) || []).length).toBe(2);
    expect((text.match(/G1 Z17\.60/g) || []).length).toBe(2); // one lap per door
  });
});

describe('panjur: x direction on a non-square door', () => {
  it('stays on the door (it used to take the along span across: cut past the top)', () => {
    const b = cutBox(generatePanjurGcode({ ...base, width: 400, height: 200, direction: 'x' }).gcode);
    expect(b.y1).toBeLessThanOrEqual(140 + 1e-6);
    expect(b.y0).toBeGreaterThanOrEqual(60 - 1e-6);
    expect(b.x1).toBeLessThanOrEqual(340 + 1e-6);
  });
});

describe('panjur: lead-out off the deep corner', () => {
  it('every panjur leaves its last row away from both walls before it lifts', () => {
    const lines = generatePanjurGcode({ ...base, edgeLap: false }).gcode.split('\n');
    const gs = panjurGroups(base).groups;
    let seen = 0;
    lines.forEach((l, k) => {
      if (!/G0 Z30/.test(l) || !/ G1 /.test(lines[k - 1] || '')) return;
      const lead = lines[k - 1], row = lines[k - 2];
      const x = +lead.match(/X([\d.]+)/)[1], z = +lead.match(/Z([\d.]+)/)[1], xRow = +row.match(/X([\d.]+)/)[1];
      expect(Math.abs(x - xRow)).toBeCloseTo(1, 6); // 1 mm in from the wall it ended at
      expect(Math.min(x - 60, 140 - x)).toBeGreaterThan(2.4); // ball clear of the frame
      expect(z).toBeCloseTo(base.endZ + 1, 1);
      seen++;
    });
    expect(seen).toBe(gs.length);
  });
});
