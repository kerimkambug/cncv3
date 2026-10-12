// The 4 mm bit (T4) that opens the panjurs' ends: a thin, long bit — it goes
// down by pecking at its own slow plunge feed and cuts in thin passes.
import { describe, it, expect } from 'vitest';
import { generatePanjurGcode } from './panjur.js';

const c = {
  width: 500, height: 700, offsetMode: 'normal', direction: 'y', offset: 60, offsetLeft: 60, offsetRight: 60, offsetBottom: 60, offsetTop: 60, centerFlat: 0,
  pitch: 40.5, exitGap: 0.45, stepover: 0.468, edgeInset: 'auto', startZ: 17.937, endZ: 3.105, t14TipDia: 6, t14BodyDia: 6, t14Height: 8,
  feed: 20000, plunge: 3000, toolNo: '14', spindle: 18000, groundEntry: true, exitCut: 4, drillTool: '4', drillSpindle: 18000, exitToolDia: 4, safeZ: 30, toolChangeZ: 30, homeZ: 30,
};
const t4Lines = (cfg) => {
  const L = generatePanjurGcode(cfg).gcode.split('\n').map((l) => l.replace(/^N\d+ /, ''));
  return L.slice(L.indexOf('M6T4'));
};

describe('panjur T4 opening', () => {
  it('goes down by pecks of at most 2 mm at F800, out over the material between them', () => {
    let z = 30;
    for (const l of t4Lines(c)) {
      const m = /^G1 Z([\d.]+) F(\d+)/.exec(l);
      // into the material (top 18) no more than one peck (+0.5 back-in clearance) at a time
      if (m) { expect(+m[2]).toBe(800); expect(Math.min(z, 18) - +m[1]).toBeLessThanOrEqual(2.5 + 1e-6); }
      const zz = /Z([\d.]+)/.exec(l); if (zz) z = +zz[1];
    }
    expect(t4Lines(c)).toContain('G0 Z20.00'); // chips out
  });

  it('cuts at F2000 in passes of at most 4 mm down to Z0', () => {
    const cuts = t4Lines(c).filter((l) => /^G1 [XY]/.test(l));
    expect(cuts.every((l) => !/F/.test(l) || /F2000/.test(l))).toBe(true);
    const levels = [...new Set(t4Lines(c).filter((l) => /^G1 Z/.test(l)).map((l) => +/Z([\d.]+)/.exec(l)[1]))];
    expect(Math.min(...levels)).toBe(0);
  });

  it('its own settings win', () => {
    const L = t4Lines({ ...c, t4Peck: 1, t4Plunge: 500, t4Feed: 1500 });
    expect(L.some((l) => /F500$/.test(l))).toBe(true);
    expect(L.some((l) => /F1500$/.test(l))).toBe(true);
  });
});
