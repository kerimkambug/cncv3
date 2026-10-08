// kapak.test.js
// Vitest port of the kapak.js assertions from smoke.test.js (+ the former
// _qa_gcode.mjs manual checks): ramp geometry, bit-angle sensitivity,
// tool offsets, and per-operation (tool/row type) coverage.
// Run with: cd client && npm test
import { describe, it, expect } from 'vitest';
import {
  buildKapakGcode,
  validateKapakSize,
  buildCarvingProfile,
  buildRoundedRectProfile,
  computeTopCurve,
  emitTopCurveGcode,
  carveExitDistance,
  carveHalfAngle,
  carveRampRatio,
  solveCarveGeometry,
  clampCarvingExit,
  validateCarvingWarnings,
  calculateAdaptiveOffsets,
} from './kapak.js';

// Modal-format helpers: ArtCAM omits an axis word when it is unchanged on that
// line, so these matchers read the numbers, not the spacing.
const axisVal = (line, axis) => {
  const m = line.match(new RegExp(`${axis}(-?[\\d.]+)`));
  return m ? parseFloat(m[1]) : null;
};
const lineHasXY = (lines, x, y) =>
  lines.some((l) => axisVal(l, 'X') === x && axisVal(l, 'Y') === y);
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const standardRows = [
  { toolNo: '7', depth: 2.5, stepOffset: 53, name: 'yuvarlama' },
  { toolNo: '2', depth: 2.0, stepOffset: 16, name: 'balmumu' },
  { toolNo: '9', depth: 5.5, stepOffset: 9, name: 'tabla 1' },
  { toolNo: '9', depth: 5.5, stepOffset: 8, name: 'tabla 2' },
  { toolNo: '12', depth: 5.5, stepOffset: 5, name: '135 bıçak' },
];
const baseCfg = {
  rows: standardRows,
  thickness: 18,
  spindleSpeed: 18000,
  plungeFeed: 3000,
  cutFeed: 6000,
  safeZ: 61,
  toolChangeZ: 96,
  homeZ: 96,
};

// Real production carving lines (1_NUMARA.cnc T1, lines 42-56 after the lead-in)
const realCarving = [
  'G1 Z12.00',
  'G1 X242.00 Y350.00 Z18.00',
  'X236.00 Y344.00 Z12.00',
  'X56.00',
  'X50.00 Y350.00 Z18.00',
  'X56.00 Y344.00 Z12.00',
  ' Y56.00',
  'X50.00 Y50.00 Z18.00',
  'X56.00 Y56.00 Z12.00',
  'X236.00',
  'X242.00 Y50.00 Z18.00',
  'X236.00 Y56.00 Z12.00',
  ' Y344.00',
];

describe('kapak: tool offsets', () => {
  const model1Cfg = {
    thickness: 18, spindleSpeed: 18000, safeZ: 61, toolChangeZ: 96, homeZ: 96,
    plungeFeed: 3000, cutFeed: 6000,
    rows: [
      { toolNo: 7, depth: 2.5, stepOffset: 52, name: '30mm yuvarlama' },
      { toolNo: 2, depth: 2, stepOffset: 16, name: '10mm balmumu' },
      { toolNo: 9, depth: 5.5, stepOffset: 9, name: '20mm tabla' },
      { toolNo: 9, depth: 5.5, stepOffset: 8, name: '20mm tabla' },
      { toolNo: 12, depth: 5.5, stepOffset: 5, name: '135 bicak' },
    ],
  };

  it('emits the row stepOffset as the first cut coordinates (T7 offset 52)', () => {
    const g = buildKapakGcode(500, 500, model1Cfg);
    expect(g).toContain('X52.00 Y52.00');
  });

  it('skips the redundant M6T9 between consecutive same-tool rows', () => {
    const g = buildKapakGcode(500, 500, model1Cfg);
    const lines = g.split('\n');
    const t9idx = lines.findIndex((l) => l === 'M6T9');
    const after = lines.slice(t9idx + 1);
    const secondM6T9 = after.findIndex((l) => l === 'M6T9');
    const nextX = after.findIndex((l) => l.startsWith('G0 X85.00'));
    expect(secondM6T9 === -1 || secondM6T9 > nextX).toBe(true);
  });

  it('honours mixed offset + derz presets in one program', () => {
    const mixed = buildKapakGcode(500, 500, {
      ...baseCfg,
      rows: [
        { toolNo: '7', depth: 2.5, stepOffset: 53, operation: 'offset' },
        { toolNo: '12', depth: 2, stepOffset: 60, operation: 'derz', derz: { yon: 'dikey', margin: 9, spacing: 60, autoFit: true, overshoot: 1 } },
      ],
    });
    expect(mixed).toContain('M6T7');
    expect(mixed).toContain('X53.00 Y53.00');
    expect(mixed).toContain('M6T12');
    expect(mixed).toContain('Z16.00');
    expect(mixed).toContain('Y447.00');
    expect(mixed).not.toContain('Y-1.00');
  });

  it('applies derz overshoot only on the TOP end of a vertical line', () => {
    const mixedOverflow = buildKapakGcode(500, 500, {
      ...baseCfg,
      rows: [
        { toolNo: '7', depth: 2.5, stepOffset: 53, operation: 'offset' },
        { toolNo: '12', depth: 2, stepOffset: 60, operation: 'derz', derz: { yon: 'dikey', margin: 0, spacing: 60, autoFit: true, overshootY: 5, overshootX: 2 } },
      ],
    });
    expect(mixedOverflow).toContain('Y452.00');
    expect(mixedOverflow).toContain('Y53.00');
  });

  it('per-row feed: each pass carries its OWN feed, plunge keeps plungeFeed', () => {
    const feedG = buildKapakGcode(292, 400, {
      ...baseCfg, cutFeed: 5000, safeZ: 46, toolChangeZ: 46, homeZ: 46, offsetMode: 'absolute',
      rows: [
        { toolNo: '6', depth: 2, stepOffset: 53, operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 67, operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 62, operation: 'offset' },
        { toolNo: '7', depth: 4, stepOffset: 74, feed: 10000, operation: 'offset' },
      ],
    });
    expect(feedG).toMatch(/G1 X218\.00\s+F10000\.0/);
    expect(feedG).toMatch(/X239\.00\s+F5000\.0/);
    expect(feedG).toMatch(/G1\s+Z14\.00 F3000\.0/);
  });

  it('adaptive offsets: symmetric shrink on narrow parts, innermost row skipped', () => {
    const big = calculateAdaptiveOffsets(500, 500, standardRows);
    expect(big[0].leftOffset).toBe(53);
    expect(big[0].rightOffset).toBe(53);
    expect(big[1].leftOffset).toBe(69);
    expect(big.every((r) => !r.skipped)).toBe(true);

    const narrow180 = calculateAdaptiveOffsets(180, 500, standardRows);
    expect(narrow180[0].leftOffset).toBe(52);
    expect(narrow180[0].rightOffset).toBe(52);
    expect(narrow180[0].bottomOffset).toBe(53);
    expect(narrow180[4].skipped).toBe(true);

    const narrow150 = calculateAdaptiveOffsets(150, 500, standardRows);
    expect(narrow150[0].leftOffset).toBe(37);
    expect(narrow150.slice(0, 4).every((r) => !r.skipped)).toBe(true);
    expect(narrow150[4].skipped).toBe(true);
  });

  it('skipped rows in narrow kapak gcode do not emit their tool', () => {
    const narrowGcode = buildKapakGcode(150, 500, baseCfg);
    expect(narrowGcode).toContain('M6T7');
    expect(narrowGcode).toContain('M6T2');
    expect(narrowGcode).toContain('M6T9');
    expect(narrowGcode).not.toContain('M6T12');
  });

  it('size validation accepts a valid panel and rejects a missing tool row', () => {
    const rows = [{ name: 'kaba', toolNo: 2, depth: 10, stepOffset: 5 }];
    expect(validateKapakSize(500, 500, rows)).toBe(null);
    expect(validateKapakSize(500, 500, [])).toBeTypeOf('string');
    expect(validateKapakSize(500, 500, [{ name: 'x', depth: 10, stepOffset: 5 }])).toBeTypeOf('string');
  });

  it('rejects the geometry mistakes that would put metal below the table', () => {
    const base = { name: 'pocket', toolNo: 2, depth: 6, stepOffset: 50 };
    // depth > thickness would cut through the plate into the bed
    expect(validateKapakSize(500, 500, [base], 'relative', 18)).toBe(null);
    expect(validateKapakSize(500, 500, [{ ...base, depth: 25 }], 'relative', 18)).toBeTypeOf('string');
    // depth <= 0 removes nothing (or lifts the bit above the surface)
    expect(validateKapakSize(500, 500, [{ ...base, depth: 0 }], 'relative', 18)).toBeTypeOf('string');
    expect(validateKapakSize(500, 500, [{ ...base, depth: -3 }], 'relative', 18)).toBeTypeOf('string');
    // non-numeric tool number
    expect(validateKapakSize(500, 500, [{ ...base, toolNo: 'T' }])).toBeTypeOf('string');
    // negative relative step offset runs the pass off the stock (absolute is exempt)
    expect(validateKapakSize(500, 500, [{ ...base, stepOffset: -5 }], 'relative')).toBeTypeOf('string');
    expect(validateKapakSize(500, 500, [{ ...base, stepOffset: -5 }], 'absolute')).toBe(null);
    // without a thickness argument the depth check is simply skipped (back-compat)
    expect(validateKapakSize(500, 500, [{ ...base, depth: 25 }])).toBe(null);
  });
});

describe('kapak: bit-angle sensitivity (V-carve math)', () => {
  it('derives the half-angle from the included bit angle', () => {
    expect(carveHalfAngle(90)).toBeCloseTo(Math.PI / 4, 9);
    expect(carveHalfAngle(90)).toBeCloseTo(2 * carveHalfAngle(45), 9);
  });

  it('ramp ratio follows tan(included/2): 60°=0.577, 90°=1, 120°=1.732, 135°=2.414', () => {
    expect(carveRampRatio(90)).toBeCloseTo(1, 9);
    expect(carveRampRatio(60)).toBeCloseTo(0.5774, 3);
    expect(carveRampRatio(120)).toBeCloseTo(1.7321, 3);
    expect(carveRampRatio(135)).toBeCloseTo(2.4142, 3);
  });

  it('exit distance scales with depth and angle', () => {
    expect(carveExitDistance(6, 60)).toBeCloseTo(3.4641, 3);
    expect(carveExitDistance(6, 90)).toBeCloseTo(6, 6);
    expect(carveExitDistance(6, 120)).toBeCloseTo(10.3923, 3);
    // ArtCAM TABLA panel, model 12: T12 (135°) at 8.1mm depth steps out 19.5mm
    expect(carveExitDistance(8.1, 135)).toBeCloseTo(19.555, 2);
    expect(carveExitDistance(6, 0)).toBe(6); // legacy rows keep the 1:1 ramp
  });

  it('solveCarveGeometry derives the ramp from depth+angle, flags derived', () => {
    expect(solveCarveGeometry({ bitAngle: 135, depth: 6 }).ramp).toBeCloseTo(14.4853, 3);
    const noAngle = solveCarveGeometry({ depth: 6, stepOffset: 56 });
    expect(noAngle.derived).toBe(false);
  });
});

describe('kapak: carving ramp geometry', () => {
  // ArtCAM's feed is MODAL: only the plunge line and the first corner move carry an
  // F word, the rest continue the feed already in effect. The reference block in
  // this file is the 1_NUMARA.cnc geometry, so the comparison strips the feeds
  // from both sides and stays a pure GEOMETRY check (which coordinates, in which
  // order, at which Z). Feed handling itself is covered by artcam.test.js, which
  // compares whole programs byte-for-byte against the ArtCAM reference.
  const stripFeed = (l) => l.replace(/\s*F[\d.]+/g, '').trim();

  it('matches 1_NUMARA.cnc lines 43-55 coordinate-for-coordinate at 90° (1:1 ramp)', () => {
    const carvingLines = buildCarvingProfile(292, 400, 56, 6, 18);
    expect(carvingLines.map(stripFeed)).toEqual(realCarving.map(stripFeed));
    expect(carvingLines.filter((l) => l.includes('Z18.00')).length).toBe(4);
    expect(carvingLines.filter((l) => l.includes('Z12.00')).length).toBe(5);
  });

  it('no angle falls back to the 1:1 ramp (assumes the 90° bit)', () => {
    expect(buildCarvingProfile(292, 400, 56, 6, 18).join('\n'))
      .toBe(buildCarvingProfile(292, 400, 56, 6, 18, 90).join('\n'));
  });

  it('a 135° included bit (T12) derives a 2.414x ramp from the angle', () => {
    // 8mm deep -> 19.31mm out, oi = 70 - 19.31 = 50.69 (ArtCAM panel: ~19.3mm at 8mm)
    const wide135 = buildCarvingProfile(292, 400, 70, 8, 18, 135);
    expect(wide135.some((l) => l.includes('X241.31 Y349.31 Z18.00'))).toBe(true);
    expect(wide135.filter((l) => l.includes('Z10.00')).length).toBe(5);
  });

  it('a 60° included bit derives a 0.577x ramp from the angle', () => {
    const narrow60 = buildCarvingProfile(292, 400, 20, 6, 18, 60);
    expect(narrow60.some((l) => l.includes('X275.46 Y383.46 Z18.00'))).toBe(true);
  });

  it('clamps the ramp to the offset when it would leave the plate', () => {
    const clamped135 = buildCarvingProfile(292, 400, 5, 6, 18, 135);
    expect(clamped135.some((l) => /X-|Y-/.test(l))).toBe(false);
    expect(clamped135.some((l) => l.includes('X0.00 Y0.00 Z18.00'))).toBe(true);

    const clampedCarving = buildCarvingProfile(200, 200, 5, 15, 18);
    expect(clampedCarving.some((l) => /X-|Y-/.test(l))).toBe(false);
    expect(clampedCarving.some((l) => l.includes('X3.00 Y0.00 Z18.00') || l.includes('X0.00 Y3.00 Z18.00') || l.includes('X0.00 Y0.00 Z18.00'))).toBe(true);
  });

  it('clampCarvingExit keeps the normal case and clamps the degenerate one', () => {
    expect(clampCarvingExit(15, 5)).toBe(5);
    expect(clampCarvingExit(6, 56)).toBe(6);
    expect(clampCarvingExit(0, 56)).toBe(0);
  });

  it('offset === exit boundary (oi = 0) does not crash and stays non-negative', () => {
    const boundary = buildCarvingProfile(292, 400, 6, 6, 18);
    expect(Array.isArray(boundary)).toBe(true);
    expect(boundary.length).toBeGreaterThan(0);
    expect(boundary.some((l) => /X-|Y-/.test(l))).toBe(false);
    expect(boundary.some((l) => l.includes('X0.00 Y0.00 Z18.00'))).toBe(true);
  });

  it('emits advisory warnings for unsafe ramps, silent for safe rows', () => {
    expect(validateCarvingWarnings([{ operation: 'carving', depth: 15, stepOffset: 5 }]).length).toBe(1);
    expect(validateCarvingWarnings([{ operation: 'carving', depth: 6, stepOffset: 56 }]).length).toBe(0);
    expect(validateCarvingWarnings([{ operation: 'carving', depth: 6, stepOffset: 10, bitAngle: 135 }]).length).toBe(1);
    expect(validateCarvingWarnings([{ operation: 'carving', depth: 6, stepOffset: 10, bitAngle: 90 }]).length).toBe(0);
    expect(validateCarvingWarnings([{ operation: 'carving', depth: 0, stepOffset: 56, bitAngle: 90 }]).length).toBe(1);
  });

  it('carving rows in buildKapakGcode emit the closed profile with feeds', () => {
    const carvingG = buildKapakGcode(292, 400, {
      ...baseCfg,
      rows: [{ toolNo: '1', depth: 6, stepOffset: 56, operation: 'carving' }],
    });
    expect(carvingG).toContain('M6T1');
    expect(carvingG).toContain('G0 X236.00 Y344.00 Z61.00');
    expect(carvingG).toContain('G1 X242.00 Y350.00 Z18.00 F6000.0');
  });

  it('uses the row depth as-is (Z12.00 at depth 6) even with a bit angle', () => {
    const carvingDerivedG = buildKapakGcode(292, 400, {
      ...baseCfg,
      rows: [{ toolNo: '1', depth: 6, stepOffset: 56, operation: 'carving', bitAngle: 90 }],
    });
    // The plunge line carries the plunge feed (F is modal, and 3000 differs from
    // the 6000 cut feed, so it must be written). ArtCAM writes it as "G1   Z12.00",
    // with the two extra spaces that align the Z word with a two-axis G1.
    expect(carvingDerivedG).toContain('G1   Z12.00 F3000.0');
  });
});

describe('kapak: row-type coverage (offset / derz / carving / rounded / curved top)', () => {
  it('offset rows emit M6T and the offset profile', () => {
    const g = buildKapakGcode(292, 400, {
      ...baseCfg, rows: [{ toolNo: '7', depth: 2.5, stepOffset: 60, operation: 'offset' }],
    });
    expect(g).toContain('M6T7');
    expect(g).toContain('X60.00 Y60.00');
  });

  it('derz rows emit the divider lines for the sample preset', () => {
    const sampleG = buildKapakGcode(292, 400, {
      ...baseCfg, safeZ: 46, toolChangeZ: 46, homeZ: 46, cutFeed: 5000, offsetMode: 'absolute', topStyle: 'semicircle',
      rows: [
        { toolNo: '9', depth: 3, stepOffset: 60, operation: 'offset' },
        { toolNo: '9', depth: 3, stepOffset: 55, operation: 'offset' },
        { toolNo: '2', depth: 2, stepOffset: 100, operation: 'derz', derz: { yon: 'dikey', margin: 100, spacing: 30, autoFit: true, overshootY: 0, respectPreviousOffset: false } },
      ],
    });
    ['X100.00', 'X130.67', 'X161.33', 'X192.00'].every((x) => expect(sampleG).toContain(`G0 ${x} `));
  });

  it('rounded rows emit G2 corner arcs (row.cornerRadius)', () => {
    const roundedG = buildKapakGcode(292, 400, {
      ...baseCfg, safeZ: 46, toolChangeZ: 46, homeZ: 46, cutFeed: 9000,
      rows: [{ toolNo: '8', depth: 5.5, stepOffset: 60, cornerRadius: 4, feed: 9000, operation: 'offset' }],
    });
    expect(roundedG).toContain('M6T8');
    expect(roundedG).toMatch(/^G2/m);
    const rrProfile = buildRoundedRectProfile(60, 60, 232, 340, 4, 12.5, 3000, 9000, 46);
    expect(rrProfile.length).toBe(12);
    expect(rrProfile.filter((l) => l.startsWith('G2')).length).toBe(5);
    expect(lineHasXY(rrProfile, 232, 336)).toBe(true);
    expect(lineHasXY(rrProfile, 64, 340)).toBe(true);
  });

  it('rounded-rect clamps an oversized radius and falls back to a square at r=0', () => {
    const rrClamped = buildRoundedRectProfile(0, 0, 4, 100, 90, 12, 3000, 9000, 46);
    expect(lineHasXY(rrClamped, 2, 0) || lineHasXY(rrClamped, 0, 2)).toBe(true);
    expect(buildRoundedRectProfile(0, 0, 100, 100, 0, 12, 3000, 9000, 46).every((l) => !l.startsWith('G2'))).toBe(true);
  });

  it('semicircle tops replace the flat edge with two G3 quarter arcs', () => {
    const semi = computeTopCurve(60, 232, 340, 'semicircle');
    expect(semi.xc).toBeCloseTo(146, 9);
    expect(semi.r).toBeCloseTo(86, 9);
    expect(semi.yc).toBeCloseTo(254, 9);
    const semiLines = emitTopCurveGcode([], semi, 12, 6000);
    expect(semiLines.filter((l) => l.startsWith('G3')).length).toBe(2);
    const arc1 = semiLines[1];
    expect(axisVal(arc1, 'X')).toBe(146);
    expect(axisVal(arc1, 'Y')).toBe(340);
    expect(axisVal(arc1, 'I')).toBe(-86);

    const curvedG = buildKapakGcode(292, 400, {
      ...baseCfg, topStyle: 'semicircle',
      rows: [{ toolNo: '7', depth: 2.5, stepOffset: 60, operation: 'offset' }],
    });
    expect(curvedG).toContain('G3');
  });

  it('pointed tops end derz dividers on the arch curve (3_NUMARA match)', () => {
    const pointed = computeTopCurve(57, 235, 400 - 57, 'pointed');
    expect(pointed.innerW).toBeCloseTo(178, 9);
    expect(pointed.rise).toBeCloseTo(22.25, 9);
    expect(pointed.yEnd(70.69)).toBeCloseTo(327.36, 2);
    expect(Number.isFinite(pointed.yEnd(-1e6))).toBe(true);

    const derzCurveG = buildKapakGcode(292, 400, {
      ...baseCfg, safeZ: 46, toolChangeZ: 46, homeZ: 46, cutFeed: 8000, topStyle: 'pointed', riseRatio: 0.125,
      rows: [
        { toolNo: '3', depth: 5, stepOffset: 57, feed: 8000, operation: 'offset' },
        { toolNo: '3', depth: 5, stepOffset: 70.69, feed: 8000, operation: 'derz', derz: { yon: 'dikey', margin: 70.69, spacing: 13.69, autoFit: true, overshootY: 0, respectPreviousOffset: false } },
      ],
    });
    // A vertical divider is a pure Y move, so ArtCAM drops the unchanged X word:
    // "G1  Y327.36  F8000.0" (see the ArtCAM comparison in artcam.test.js).
    expect(derzCurveG.replace(/\s+/g, ' ')).toContain('G1 Y327.36 F8000.0');
    expect(derzCurveG).toContain('Y332.68');
    expect(derzCurveG).toContain('Y336.83');
  });
});
