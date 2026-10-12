// The kulp paths must be the shop's own programs (numbers from the two files
// "43'lük kapak gizli kulp sağ sol 90-110.anc" and "280 boy kulp 2 seferde.anc").
import { describe, it, expect } from 'vitest';
import { buildKulpLines, flatRadius, kulpMargins, kulpPasses, kulpProblem } from './kulp.js';
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

describe('kulp in a plate (nesting): the 10 mm bit clears first', () => {
  // a kulp bit narrower in the middle (Ø50 foot, Ø36 waist) as drawn in Atölye
  const outline = [{ closed: true, pts: [[0, 0], [25, 0], [25, 3], [18, 8], [18, 12], [23, 16], [23, 19], [7, 19], [7, 70], [0, 70]] }];
  const set = { passes: '-1, 7', dia: 50, z: 4, outline };
  const door = { x: 100, y: 100, w: 430, h: 700, kulps: [{ edge: 'right', mode: 'window', from: 250, to: 450 }] };

  it('the flat band is the bit\'s narrowest radius inside the material', () => {
    expect(flatRadius(set, 18)).toBeCloseTo(18, 1);
    expect(flatRadius({ ...set, outline: null }, 18)).toBe(25); // undrawn bit: a cylinder
  });

  it('the kulp bit only goes down where the 10 mm bit has already cleared its whole head to the kulp height', async () => {
    const { simulate } = await import('../sim/millSim.js');
    const lines = buildKulpLines([door], set, 46, { nest: true, top: 18 });
    expect(lines.filter((l) => /^M6T/.test(l))).toEqual(['M6T10', 'M6T11']);
    const t10 = lines.slice(0, lines.indexOf('M6T11') - 1).join('\n');
    const { grid } = simulate(t10, { top: 18, cell: 0.5, box: { x0: 400, y0: 200, x1: 700, y1: 700 }, tools: { 10: { type: 'flat', dia: 10, name: 'T10' } } });
    const zAt = (x, y) => grid.z[Math.floor((y - grid.y0) / grid.cell) * grid.w + Math.floor((x - grid.x0) / grid.cell)];
    // every point the kulp bit goes down or comes up at: a hole of its full radius, down to Z4
    const passes = kulpPasses(door, door.kulps[0], set, { nest: true });
    for (const [px, py] of [passes[0].pts[0], passes.at(-1).pts.at(-1)]) {
      for (let a = 0; a < 360; a += 15) for (const r of [0, 10, 20, 24.5]) {
        expect(zAt(px + r * Math.cos((a * Math.PI) / 180), py + r * Math.sin((a * Math.PI) / 180))).toBeLessThanOrEqual(4.01);
      }
    }
    // the band the kulp bit would leave flat is cleared too: 15 mm from its deepest pass, inside the door, mid-window
    expect(zAt(530 - 7 - 15, 450)).toBeLessThanOrEqual(4.01);
    // …but the profile is left for the kulp bit (beyond its narrowest radius)
    expect(zAt(530 - 7 - 19.5, 450)).toBeCloseTo(18, 3);
  });

  it('nesting keeps the room the kulp work really touches past the edges', () => {
    // a window: the holes (Ø52) centred 27 mm outside the right edge reach 53 mm, +1
    const m = kulpMargins(door, door.kulps, set);
    expect(m.right).toBe(54);
    expect([m.left, m.top, m.bottom]).toEqual([0, 0, 0]);
    // whole length: it goes down beyond both ends too
    const full = kulpMargins(door, [{ edge: 'left', mode: 'full' }], set);
    expect(full.left).toBe(28); // the head 25 + the bit 1 mm outside the edge, +1 (the holes are beyond the ends)
    expect(full.top).toBeGreaterThanOrEqual(53);
    expect(full.bottom).toBeGreaterThanOrEqual(53);
    expect(full.right).toBe(0);
    // a window right at the top corner, where the bit goes down: the room goes round the corner
    const corner = kulpMargins(door, [{ edge: 'right', mode: 'window', from: 500, to: 700 }], set);
    expect(corner.top).toBe(2); // the hole (radius 26) centred 25 below the top reaches 1 mm past it, +1
  });
});
