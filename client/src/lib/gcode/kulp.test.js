// The kulp paths must be the shop's own programs (numbers from the two files
// "43'lük kapak gizli kulp sağ sol 90-110.anc" and "280 boy kulp 2 seferde.anc").
import { describe, it, expect } from 'vitest';
import { buildKulpLines, kulpPasses, kulpProblem } from './kulp.js';
import { guardZ } from './zGuard.js';

const xy = (passes) => passes.flatMap((p) => p.pts).map(([x, y]) => `${+x.toFixed(3)},${+y.toFixed(3)}`);

describe('kulp along a door edge', () => {
  const set = { passes: '-1, 7', dia: 30, approach: 30, z: 4 };

  it('window 900–1100 on the left and right doors of a 2 × 430 pair = the shop program', () => {
    const left = { x: 0, y: 0, w: 430, h: 2000 }, right = { x: 430, y: 0, w: 430, h: 2000 };
    expect(xy(kulpPasses(left, { edge: 'left', mode: 'window', from: 900, to: 1100 }, set)))
      .toEqual(['-30,923', '-1,923', '-1,1077', '-30,1077', '-30,1085', '7,1085', '7,915', '-30,915']);
    expect(xy(kulpPasses(right, { edge: 'right', mode: 'window', from: 900, to: 1100 }, set)))
      .toEqual(['890,1077', '861,1077', '861,923', '890,923', '890,915', '853,915', '853,1085', '890,1085']);
  });

  it('whole length on the left edge, 2 passes = "280 boy kulp 2 seferde"', () => {
    const door = { x: 0, y: 0, w: 600, h: 2826.182 };
    // (the pass between the two ends is drawn as its two ends)
    expect(xy(kulpPasses(door, { edge: 'left', mode: 'full' }, { ...set, passes: '-3, 7' })))
      .toEqual(['-3,2856.182', '-3,-30', '7,-30', '7,2856.182']);
  });

  it('top and bottom edges run along X, measured from the left corner', () => {
    const door = { x: 100, y: 50, w: 500, h: 700 };
    const top = kulpPasses(door, { edge: 'top', mode: 'window', from: 150, to: 350 }, set);
    expect(top[0].pts[0]).toEqual([273, 780]); // 30 above the top edge (750)
    expect(top[0].pts[1]).toEqual([273, 751]); // centre 1 outside the edge
    expect(top[1].pts[1][1]).toBe(743); // second pass 7 inside
  });

  it('G-code: one tool change, down in the air at Z, never below the table', () => {
    const doors = [
      { x: 0, y: 0, w: 430, h: 2000, kulps: [{ edge: 'left', mode: 'window', from: 900, to: 1100 }] },
      { x: 430, y: 0, w: 430, h: 2000, kulps: [{ edge: 'right', mode: 'window', from: 900, to: 1100 }] },
    ];
    const lines = buildKulpLines(doors, set, 46);
    expect(lines.filter((l) => /^M6T/.test(l))).toEqual(['M6T11']);
    expect(lines.slice(0, 4)).toEqual(['M5', 'M6T11', 'M3 S15000', 'G0Z46.00']);
    expect(lines).toContain('G0 X-30.00 Y923.00 Z46.00');
    expect(lines).toContain('G1 Z4.00 F2000.0');
    expect(lines).toContain('G1 X-1.00 Y923.00 F5000.0');
    // every plunge happens outside the door (X < 0 or X > 860)
    let x = null;
    for (const l of lines) {
      const mx = /X(-?[\d.]+)/.exec(l); if (mx) x = Number(mx[1]);
      if (/^G1 Z/.test(l)) expect(x < 0 || x > 860).toBe(true);
    }
    expect(guardZ(lines.join('\n'))).toBe(lines.join('\n'));
  });

  it('refuses a window shorter than the bit', () => {
    const door = { x: 0, y: 0, w: 400, h: 700 };
    expect(kulpProblem(door, { edge: 'left', mode: 'window', from: 300, to: 340 }, set)).toMatch(/kısa/);
    expect(kulpProblem(door, { edge: 'left', mode: 'window', from: 600, to: 800 }, set)).toMatch(/taşıyor/);
    expect(kulpProblem(door, { edge: 'left', mode: 'window', from: 300, to: 500 }, set)).toBe('');
  });
});
