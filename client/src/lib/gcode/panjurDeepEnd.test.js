// The deep end of the panjurs: the T14 cone may bite only `deepEndBite` mm (default 1)
// into the frame and the centre flat at the surface (see deepEndPullback).
import { describe, it, expect } from 'vitest';
import { deepEndPullback, panjurGroups, t14RadiusAtDepth } from './panjur.js';

const base = {
  width: 400, height: 300, offsetMode: 'normal', direction: 'y', offset: 60,
  offsetLeft: 60, offsetRight: 60, offsetBottom: 60, offsetTop: 60, centerFlat: 0,
  pitch: 40.5, exitGap: 0.45, stepover: 0.468, edgeInset: 'auto', startZ: 17.937, endZ: 3.105,
  t14TipDia: 2, t14BodyDia: 12, t14Height: 65,
};
const coneAtDeepest = t14RadiusAtDepth(base, base.startZ - base.endZ); // ≈ 2.14 mm

describe('panjur deep end', () => {
  it('the last panjur stops so the cone bites 1 mm into the frame by default', () => {
    const g = panjurGroups(base);
    expect(deepEndPullback(base)).toBeCloseTo(coneAtDeepest - 1, 6);
    expect(g.groups.at(-1).end + coneAtDeepest - 240).toBeCloseTo(1, 6);
    expect(g.groups[0].start).toBe(60); // the shallow side is not moved
  });
  it('the bite is set by hand; a bite larger than the cone changes nothing', () => {
    expect(panjurGroups({ ...base, deepEndBite: 0 }).groups.at(-1).end + coneAtDeepest).toBeCloseTo(240, 6);
    expect(panjurGroups({ ...base, deepEndBite: 5 }).groups.at(-1).end).toBeCloseTo(240, 6);
  });
  it('the half before the centre flat ends early too; the half after it starts on the flat', () => {
    const g = panjurGroups({ ...base, offsetMode: 'detailed', centerFlat: 40 });
    const lower = g.groups.filter((x) => x.side === 'start'), upper = g.groups.filter((x) => x.side === 'end');
    expect(lower.at(-1).end + coneAtDeepest - 130).toBeCloseTo(1, 6);
    expect(upper[0].start).toBeCloseTo(170, 6);
    expect(upper.at(-1).end + coneAtDeepest - 240).toBeCloseTo(1, 6);
  });
  it('a hand-set edge inset is used instead of the cone', () => {
    expect(deepEndPullback({ ...base, edgeInset: 3 })).toBeCloseTo(2, 6);
    expect(deepEndPullback({ ...base, edgeInset: 0 })).toBe(0);
  });
});
