// Kulp in nesting: the room past a kulp edge stays free, a part turned by 90°
// gets its kulp on its own (turned) edge, and the 10 mm clearing comes before
// the kulp bit, both before the final cut.
import { describe, it, expect } from 'vitest';
import { calculateNesting, buildNestingPlateGcode } from './nesting.js';
import { kulpMargins } from './kulp.js';
import { toolSequence } from './toolOrder.js';

const kulp = { passes: '-1, 7', dia: 50, z: 4 };
const cfg = {
  rows: [{ toolNo: '6', depth: 3, stepOffset: 60 }],
  thickness: 18, spindleSpeed: 18000, safeZ: 46, toolChangeZ: 96, homeZ: 96, plungeFeed: 3000, cutFeed: 6000,
  enableOuterCut: true, cutToolNo: '6', cutToolDia: 6, preCutDepth: 1.5, kulp,
};
const right = [{ edge: 'right', mode: 'window', from: 250, to: 450 }];

describe('kulp in nesting', () => {
  it('nothing is placed in the room past a kulp edge', () => {
    const parts = [
      { name: 'K', width: 430, height: 700, qty: 2, lockRotation: true, kulps: right },
      { name: 'D', width: 430, height: 700, qty: 4, lockRotation: true },
    ];
    const nest = calculateNesting({ plateW: 2100, plateH: 2800, edge: 10, gap: 8, rotate: false, parts, kulp, gapSafety: { cutToolDia: 6 } });
    const room = kulpMargins(right, kulp).right;
    for (const plate of nest.plates) {
      for (const k of plate.parts.filter((p) => p.kulps?.length)) {
        expect(k.placedWidth).toBe(430); // the door itself, not its room
        const zone = { x0: k.x + k.placedWidth, x1: k.x + k.placedWidth + room, y0: k.y, y1: k.y + k.placedHeight };
        for (const o of plate.parts) {
          if (o === k) continue;
          const overlap = o.x < zone.x1 && o.x + o.placedWidth > zone.x0 && o.y < zone.y1 && o.y + o.placedHeight > zone.y0;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('a part turned by 90° gets its kulp on its own edge, turned with it', () => {
    // the door 430 wide, 700 high lies turned: its right edge is at the bottom of its place
    const plate = { number: 1, width: 2100, height: 2800, parts: [
      { name: 'K', width: 430, height: 700, x: 100, y: 100, placedWidth: 700, placedHeight: 430, rotated: true, kulps: right },
    ] };
    const g = buildNestingPlateGcode(plate, cfg).split('\n');
    const from = g.indexOf('M6T11'), to = g.findIndex((l, i) => i > from && /^M6T/.test(l));
    const cuts = g.slice(from, to).filter((l) => /^G1 X.*Y/.test(l)).map((l) => ({ x: +/X(-?[\d.]+)/.exec(l)[1], y: +/Y(-?[\d.]+)/.exec(l)[1] }));
    // passes along the bottom edge (y 100): 1 mm outside, then 7 mm inside
    expect(cuts.some((c) => Math.abs(c.y - 99) < 0.01)).toBe(true);
    expect(cuts.some((c) => Math.abs(c.y - 107) < 0.01)).toBe(true);
    // the window 250…450 up the door's own edge runs along X from its left end
    const along = cuts.filter((c) => Math.abs(c.y - 107) < 0.01).map((c) => c.x);
    expect(Math.min(...along)).toBeCloseTo(100 + 250 + 25, 6);
    expect(Math.max(...along)).toBeCloseTo(100 + 450 - 25, 6);
  });

  it('order: models, 10 mm clearing, kulp bit, final cut last', () => {
    const plate = { number: 1, width: 2100, height: 2800, parts: [
      { name: 'K', width: 430, height: 700, x: 100, y: 100, placedWidth: 430, placedHeight: 700, rotated: false, kulps: right },
      { name: 'D', width: 430, height: 700, x: 700, y: 100, placedWidth: 430, placedHeight: 700, rotated: false },
    ] };
    const seq = toolSequence(buildNestingPlateGcode(plate, cfg));
    expect(seq.indexOf('10')).toBeGreaterThan(-1);
    expect(seq.indexOf('11')).toBeGreaterThan(seq.indexOf('10'));
    expect(seq[seq.length - 1]).toBe('6');
    expect(seq.filter((t) => t === '11')).toHaveLength(1);
  });

  it('refused when a model on the plate also uses the kulp bit\'s number', () => {
    const plate = { number: 1, width: 2100, height: 2800, parts: [
      { name: 'K', width: 430, height: 700, x: 100, y: 100, placedWidth: 430, placedHeight: 700, rotated: false, kulps: right },
    ] };
    expect(() => buildNestingPlateGcode(plate, { ...cfg, rows: [{ toolNo: '11', depth: 3, stepOffset: 60 }] })).toThrow(/T11/);
  });
});
