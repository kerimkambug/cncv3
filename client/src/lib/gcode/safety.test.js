// safety.test.js
// Regression tests for the P0 (physical CNC safety) and P1 (correctness) fixes.
//
// These all lock in behaviour that would otherwise reach real machinery:
//   * nesting gap vs. cutting-tool diameter
//   * circle / ring inner diameter vs. tool diameter
//   * numeric values where ZERO is legitimate
//   * CSV parsing with the Turkish decimal comma
//
// Run with:  cd client && npm test
import { describe, it, expect } from 'vitest';

import {
  toFiniteNumber,
  numOr,
  resolveNestingGap,
  validateNestingGap,
  validateCircleGeometry,
  validateDepthAgainstThickness,
} from '../../../../shared/gcode/validation.js';
import { parseNestImportText, detectColumnSeparator, parseNumberCell } from '../../../../shared/nest/csvImport.js';

import { buildCircleGcode, resolveCircleParams } from './circle.js';
import { calculateNesting, buildNestingPlateGcode, minPartSpacing } from './nesting.js';
import { calculateCompensatedZ, buildReliefGcodeFromDepthGrid } from './relief.js';

describe('numeric validation — zero must survive', () => {
  it('toFiniteNumber returns null (not a default) for absent/blank/invalid', () => {
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('abc')).toBeNull();
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
  });

  it('toFiniteNumber PRESERVES zero and negative zero', () => {
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber('0')).toBe(0);
    expect(toFiniteNumber(0.0)).toBe(0);
    expect(Object.is(toFiniteNumber(-0), -0)).toBe(true);
  });

  it('numOr keeps a legitimate zero instead of the fallback', () => {
    // The whole point: `Number(0) || 5` is 5, which silently changed a 0mm
    // depth/offset/margin into 5.
    expect(numOr(0, 5)).toBe(0);
    expect(numOr('0', 5)).toBe(0);
    expect(numOr('0.0', 6)).toBe(0);
    expect(numOr(0, 6)).toBe(0);
  });

  it('numOr still falls back for genuinely missing values', () => {
    expect(numOr(undefined, 5)).toBe(5);
    expect(numOr(null, 5)).toBe(5);
    expect(numOr('', 5)).toBe(5);
    expect(numOr('abc', 5)).toBe(5);
  });

  it('numOr accepts negative numbers (valid for offsets/coordinates)', () => {
    expect(numOr(-12.5, 0)).toBe(-12.5);
  });
});

describe('nesting gap vs cutting tool diameter', () => {
  it('resolveNestingGap requires at least one full tool diameter', () => {
    expect(resolveNestingGap({ partGap: 5, cutToolDia: 6 }).required).toBe(6);
    expect(resolveNestingGap({ partGap: 5, cutToolDia: 6 }).ok).toBe(false);
    expect(resolveNestingGap({ partGap: 6, cutToolDia: 6 }).ok).toBe(true);
    expect(resolveNestingGap({ partGap: 7, cutToolDia: 6 }).ok).toBe(true);
  });

  it('resolveNestingGap supports a configurable safety margin', () => {
    expect(resolveNestingGap({ partGap: 6, cutToolDia: 6, safetyMargin: 2 }).required).toBe(8);
    expect(resolveNestingGap({ partGap: 6, cutToolDia: 6, safetyMargin: 2 }).ok).toBe(false);
    expect(resolveNestingGap({ partGap: 8, cutToolDia: 6, safetyMargin: 2 }).ok).toBe(true);
  });

  it('gap < tool diameter is rejected with an explanatory message', () => {
    const err = validateNestingGap({ partGap: 5, cutToolDia: 6 });
    expect(err).toBeTruthy();
    expect(err).toContain('5mm');
    expect(err).toContain('6mm');
  });

  it('gap == tool diameter is accepted (toolpaths touch, never overlap)', () => {
    expect(validateNestingGap({ partGap: 6, cutToolDia: 6 })).toBeNull();
  });

  it('gap > tool diameter is accepted', () => {
    expect(validateNestingGap({ partGap: 12, cutToolDia: 6 })).toBeNull();
  });

  it('different tool diameters change the requirement', () => {
    expect(validateNestingGap({ partGap: 8, cutToolDia: 6 })).toBeNull();
    expect(validateNestingGap({ partGap: 8, cutToolDia: 12 })).toBeTruthy();
    expect(validateNestingGap({ partGap: 12, cutToolDia: 12 })).toBeNull();
  });

  it('outer cut DISABLED accepts a small gap (no compensated path exists)', () => {
    expect(validateNestingGap({ partGap: 1, cutToolDia: 6, outerCutEnabled: false })).toBeNull();
  });

  it('zero gap with outer cut enabled is still rejected when parts vary', () => {
    expect(validateNestingGap({ partGap: 0, cutToolDia: 6 })).toBeTruthy();
  });

  it('a single part has no neighbour to collide with', () => {
    // calculateNesting only runs the gap gate when more than one part exists.
    const single = calculateNesting({
      plateW: 1220, plateH: 2440, edge: 10, gap: 1, rotate: false,
      parts: [{ name: 'Tek', width: 500, height: 500, qty: 1 }],
      gapSafety: { cutToolDia: 6, outerCutEnabled: true },
    });
    expect(single.plates[0].parts.length).toBe(1);
  });

  it('calculateNesting rejects gap < toolDia BEFORE packing', () => {
    expect(() => calculateNesting({
      plateW: 1220, plateH: 2440, edge: 10, gap: 5, rotate: true,
      parts: [
        { name: 'A', width: 500, height: 500, qty: 1 },
        { name: 'B', width: 500, height: 500, qty: 1 },
      ],
      gapSafety: { cutToolDia: 6, outerCutEnabled: true },
    })).toThrow(/kesim bıçağı çapından/i);
  });

  it('calculateNesting accepts gap == toolDia and gap > toolDia', () => {
    const make = (gap) => calculateNesting({
      plateW: 1220, plateH: 2440, edge: 10, gap, rotate: true,
      parts: [
        { name: 'A', width: 500, height: 500, qty: 1 },
        { name: 'B', width: 500, height: 500, qty: 1 },
      ],
      gapSafety: { cutToolDia: 6, outerCutEnabled: true },
    });
    expect(make(6).plates.length).toBeGreaterThan(0);
    expect(make(20).plates.length).toBeGreaterThan(0);
  });

  it('rotated parts are placed with the same safety rule', () => {
    const res = calculateNesting({
      plateW: 1220, plateH: 2440, edge: 10, gap: 6, rotate: true,
      parts: [
        { name: 'Yatay', width: 800, height: 300, qty: 2 },
        { name: 'Dikey', width: 300, height: 800, qty: 2 },
      ],
      gapSafety: { cutToolDia: 6, outerCutEnabled: true },
    });
    // Whatever orientation was chosen, the real clearance must be >= toolDia.
    res.plates.forEach((plate) => {
      const spacing = minPartSpacing(plate.parts);
      if (spacing !== null) expect(spacing).toBeGreaterThanOrEqual(6 - 1e-6);
    });
  });

  it('multiple presets / nested parts keep the gap safety rule', () => {
    const res = calculateNesting({
      plateW: 2440, plateH: 1220, edge: 10, gap: 8, rotate: true,
      parts: [
        { name: 'M1', width: 292, height: 400, qty: 3, presetId: 'p1' },
        { name: 'M2', width: 292, height: 400, qty: 3, presetId: 'p2' },
      ],
      gapSafety: { cutToolDia: 8, outerCutEnabled: true },
    });
    res.plates.forEach((plate) => {
      const spacing = minPartSpacing(plate.parts);
      if (spacing !== null) expect(spacing).toBeGreaterThanOrEqual(8 - 1e-6);
    });
  });

  it('minPartSpacing measures the real clearance between neighbours', () => {
    expect(minPartSpacing([
      { x: 0, y: 0, placedWidth: 100, placedHeight: 100 },
      { x: 106, y: 0, placedWidth: 100, placedHeight: 100 },
    ])).toBeCloseTo(6, 9);
    // Diagonal-only neighbours (no overlap on either axis) do not conflict.
    expect(minPartSpacing([
      { x: 0, y: 0, placedWidth: 100, placedHeight: 100 },
      { x: 200, y: 200, placedWidth: 100, placedHeight: 100 },
    ])).toBeNull();
    expect(minPartSpacing([{ x: 0, y: 0, placedWidth: 10, placedHeight: 10 }])).toBeNull();
  });

  it('generator rejects an overlapping plate even if it was built by hand', () => {
    // Bypass the UI entirely: two parts 5mm apart with a 6mm cutter.
    const plate = {
      number: 1,
      width: 2440,
      height: 1220,
      parts: [
        { name: 'A', x: 10, y: 10, placedWidth: 500, placedHeight: 500 },
        { name: 'B', x: 515, y: 10, placedWidth: 500, placedHeight: 500 },
      ],
    };
    expect(() => buildNestingPlateGcode(plate, {
      thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 6000,
      safeZ: 61, toolChangeZ: 96, homeZ: 96,
      enableOuterCut: true, cutToolNo: '6', cutToolDia: 6, preCutDepth: 1.5,
      rows: [{ toolNo: '7', depth: 2.5, stepOffset: 52 }],
    })).toThrow(/Güvenli olmayan nesting/i);
  });

  it('generator allows the same plate when the outer cut is off', () => {
    const plate = {
      number: 1,
      width: 2440,
      height: 1220,
      parts: [
        { name: 'A', x: 10, y: 10, placedWidth: 500, placedHeight: 500 },
        { name: 'B', x: 515, y: 10, placedWidth: 500, placedHeight: 500 },
      ],
    };
    const g = buildNestingPlateGcode(plate, {
      thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 6000,
      safeZ: 61, toolChangeZ: 96, homeZ: 96,
      enableOuterCut: false,
      rows: [{ toolNo: '7', depth: 2.5, stepOffset: 52 }],
    });
    expect(g).toContain('M6T7');
  });
});

describe('circle / ring inner diameter vs tool diameter', () => {
  it('innerDia < toolDia is rejected (no negative inner radius reaches G-code)', () => {
    const err = validateCircleGeometry({ mode: 'ring', outerDia: 100, innerDia: 5, toolDia: 6 });
    expect(err).toBeTruthy();
    expect(err).toContain('5mm');
    expect(err).toContain('6mm');
    expect(() => buildCircleGcode(
      { mode: 'ring', outerDia: 100, innerDia: 5, left: 0, bottom: 0, toolDia: 6, toolNo: 6, depth: 18 },
      { thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 6000, safeZ: 61, homeZ: 96 },
    )).toThrow(/bıçak çapından/i);
  });

  it('innerDia == toolDia is rejected (compensated inner radius is exactly 0)', () => {
    expect(validateCircleGeometry({ mode: 'ring', outerDia: 100, innerDia: 6, toolDia: 6 })).toBeTruthy();
    expect(() => buildCircleGcode(
      { mode: 'ring', outerDia: 100, innerDia: 6, left: 0, bottom: 0, toolDia: 6, toolNo: 6, depth: 18 },
      { thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 6000, safeZ: 61, homeZ: 96 },
    )).toThrow();
  });

  it('innerDia > toolDia is accepted and produces a positive inner radius', () => {
    expect(validateCircleGeometry({ mode: 'ring', outerDia: 100, innerDia: 20, toolDia: 6 })).toBeNull();
    const geo = resolveCircleParams({ mode: 'ring', outerDia: 100, innerDia: 20, left: 0, bottom: 0, toolDia: 6 });
    expect(geo.innerR).toBeCloseTo(7, 9); // 10 - 3
    expect(geo.outerR).toBeCloseTo(53, 9); // 50 + 3
  });

  it('outerDia <= innerDia is rejected', () => {
    expect(validateCircleGeometry({ mode: 'ring', outerDia: 50, innerDia: 50, toolDia: 6 })).toBeTruthy();
    expect(validateCircleGeometry({ mode: 'ring', outerDia: 50, innerDia: 60, toolDia: 6 })).toBeTruthy();
  });

  it('a solid circle is unaffected by the ring rules', () => {
    expect(validateCircleGeometry({ mode: 'solid', outerDia: 500, toolDia: 6 })).toBeNull();
  });

  it('invalid tool diameter is rejected for every mode', () => {
    expect(validateCircleGeometry({ mode: 'solid', outerDia: 500, toolDia: 0 })).toBeTruthy();
    expect(validateCircleGeometry({ mode: 'solid', outerDia: 500, toolDia: NaN })).toBeTruthy();
  });

  it('a valid ring still emits inner-then-outer, unchanged', () => {
    const g = buildCircleGcode(
      { mode: 'ring', outerDia: 500, innerDia: 100, left: 0, bottom: 0, toolDia: 6, toolNo: 6, depth: 18 },
      { thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 6000, safeZ: 61, homeZ: 96 },
    );
    const innerIdx = g.indexOf('G2 X297.00'); // 250 + (50-3) = 297 -> inner first
    const outerIdx = g.indexOf('G2 X503.00'); // 250 + (250+3) = 503 -> outer second
    expect(innerIdx).toBeGreaterThan(-1);
    expect(outerIdx).toBeGreaterThan(innerIdx);
  });
});

describe('depth vs material thickness', () => {
  it('rejects a cut that would go through to the table', () => {
    expect(validateDepthAgainstThickness({ depth: 18, thickness: 18, keepOut: 1 })).toBeTruthy();
  });

  it('accepts a depth that leaves material behind', () => {
    expect(validateDepthAgainstThickness({ depth: 15, thickness: 18, keepOut: 1 })).toBeNull();
  });

  it('depth 0 is valid (surface pass) and never coerced to a default', () => {
    expect(validateDepthAgainstThickness({ depth: 0, thickness: 18, keepOut: 1 })).toBeNull();
    expect(numOr(0, 5)).toBe(0);
  });

  it('relief maxDepth = 0 produces no cut below the surface', () => {
    const flat = new Float32Array([0, 0, 0, 0]);
    const g = buildReliefGcodeFromDepthGrid(flat, 2, 2, {
      width: 100, height: 100, thickness: 18, maxDepth: 0, stepover: 50, resolution: 50,
      toolType: 'flat', toolDia: 4, toolNo: '1', spindleSpeed: 18000,
      plungeFeed: 1200, cutFeed: 4000, safeZ: 25, homeZ: 60, direction: 'x',
    });
    expect(g.gcode).toContain('Z18.000');
    expect(g.gcode).not.toMatch(/Z1[0-6]\.\d{3}/);
  });

  it('relief maxDepth > 0 cuts into the material by exactly that much', () => {
    const deep = new Float32Array([0, 0, 0, 0]);
    const g = buildReliefGcodeFromDepthGrid(deep, 2, 2, {
      width: 100, height: 100, thickness: 18, maxDepth: 4, stepover: 50, resolution: 50,
      toolType: 'flat', toolDia: 4, toolNo: '1', spindleSpeed: 18000,
      plungeFeed: 1200, cutFeed: 4000, safeZ: 25, homeZ: 60, direction: 'x',
    });
    expect(g.gcode).toContain('Z14.000'); // 18 - 4
  });

  it('relief rejects a depth that would reach the table', () => {
    expect(() => buildReliefGcodeFromDepthGrid(new Float32Array([0, 0]), 2, 1, {
      width: 100, height: 100, thickness: 18, maxDepth: 18, stepover: 50, resolution: 50,
      toolType: 'flat', toolDia: 4, toolNo: '1', spindleSpeed: 18000,
      plungeFeed: 1200, cutFeed: 4000, safeZ: 25, homeZ: 60, direction: 'x',
    })).toThrow(/geçersiz/i);
  });

  it('ballnose compensation still keys off the real depths', () => {
    const z = calculateCompensatedZ(0, 0, 0, { thickness: 18, maxDepth: 5, toolType: 'flat' });
    expect(z).toBe(13);
  });

  it('an array-of-rows depth grid is REJECTED instead of writing ZNaN', () => {
    // Regression: a ragged/row-shaped grid made sampleDepthGridUV return
    // undefined depths and the generator emitted "G1 ZNaN" into the program.
    expect(() => buildReliefGcodeFromDepthGrid([[0, 0], [0, 0]], 2, 2, {
      width: 100, height: 100, thickness: 18, maxDepth: 4, stepover: 50, resolution: 50,
      toolType: 'flat', toolDia: 4, toolNo: '1', spindleSpeed: 18000,
      plungeFeed: 1200, cutFeed: 4000, safeZ: 25, homeZ: 60, direction: 'x',
    })).toThrow(/SATIR DİZİSİ|düz/i);
  });

  it('a wrongly-sized or non-numeric grid is rejected', () => {
    const cfg = {
      width: 100, height: 100, thickness: 18, maxDepth: 4, stepover: 50, resolution: 50,
      toolType: 'flat', toolDia: 4, toolNo: '1', spindleSpeed: 18000,
      plungeFeed: 1200, cutFeed: 4000, safeZ: 25, homeZ: 60, direction: 'x',
    };
    expect(() => buildReliefGcodeFromDepthGrid(new Float32Array([0, 0, 0]), 2, 2, cfg)).toThrow(/uyuşmuyor/i);
    expect(() => buildReliefGcodeFromDepthGrid(new Float32Array([0, NaN, 0, 0]), 2, 2, cfg)).toThrow(/geçersiz değer/i);
  });

  it('a valid relief program never contains NaN in any axis word', () => {
    const g = buildReliefGcodeFromDepthGrid(new Float32Array([0, 0.5, 1, 0]), 2, 2, {
      width: 100, height: 100, thickness: 18, maxDepth: 4, stepover: 50, resolution: 50,
      toolType: 'flat', toolDia: 4, toolNo: '1', spindleSpeed: 18000,
      plungeFeed: 1200, cutFeed: 4000, safeZ: 25, homeZ: 60, direction: 'x',
    });
    expect(g.gcode).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe('CSV / parts-list import', () => {
  it('detects the column separator from the file, not per row', () => {
    expect(detectColumnSeparator('Kapak;500,5;454,2;2')).toBe(';');
    expect(detectColumnSeparator('Kapak,500.5,454.2,2')).toBe(',');
    expect(detectColumnSeparator('Kapak\t500.5\t454.2\t2')).toBe('\t');
  });

  it('parses Turkish decimal comma with a semicolon separator', () => {
    const { parts, decimal } = parseNestImportText('Kapak;500,5;454,2;2');
    expect(decimal).toBe(',');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ name: 'Kapak', width: 500.5, height: 454.2, qty: 2 });
  });

  it('parses 500.5 with a comma separator (Anglo style)', () => {
    const { parts, decimal } = parseNestImportText('Kapak,500.5,454.2,2');
    expect(decimal).toBe('.');
    expect(parts[0]).toMatchObject({ name: 'Kapak', width: 500.5, height: 454.2, qty: 2 });
  });

  it('parses 500,5 / 500.50 / 500,50 equivalently', () => {
    expect(parseNestImportText('A;500,5;454;1').parts[0].width).toBe(500.5);
    expect(parseNestImportText('A,500.50,454,1').parts[0].width).toBe(500.5);
    expect(parseNestImportText('A;500,50;454;1').parts[0].width).toBe(500.5);
  });

  it('parses semicolon-delimited rows without a name', () => {
    const { parts } = parseNestImportText('500,5;454,2;2');
    expect(parts[0]).toMatchObject({ width: 500.5, height: 454.2, qty: 2 });
    expect(parts[0].name).toBe('500.5×454.2');
  });

  it('parses comma-delimited rows without a name', () => {
    const { parts } = parseNestImportText('500.5,454.2,2');
    expect(parts[0]).toMatchObject({ width: 500.5, height: 454.2, qty: 2 });
  });

  it('defaults qty to 1 when the column is absent', () => {
    expect(parseNestImportText('A;500;454').parts[0].qty).toBe(1);
    expect(parseNestImportText('500;454').parts[0].qty).toBe(1);
  });

  it('honours quoted values containing the column separator', () => {
    const { parts } = parseNestImportText('"Kapak; özel";500;454;1');
    expect(parts[0].name).toBe('Kapak; özel');
    expect(parts[0].width).toBe(500);
  });

  it('honours escaped quotes inside a quoted field', () => {
    const { parts } = parseNestImportText('"Ka""pak";500;454;1');
    expect(parts[0].name).toBe('Ka"pak');
  });

  it('skips blank rows and comment rows', () => {
    const { parts, errors } = parseNestImportText('\n#yorum\nA;500;454;1\n\n   \n');
    expect(parts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('reports malformed rows by line number and keeps the good ones', () => {
    const { parts, errors } = parseNestImportText('A;500;454;1\nbozuk satır\nB;300;200;1');
    expect(parts).toHaveLength(2);
    expect(errors).toEqual([2]);
  });

  it('rejects zero / negative dimensions', () => {
    expect(parseNestImportText('A;0;454;1').errors).toEqual([1]);
    expect(parseNestImportText('A;-5;454;1').errors).toEqual([1]);
  });

  it('rejects a non-positive qty', () => {
    expect(parseNestImportText('A;500;454;0').errors).toEqual([1]);
  });

  it('still parses the legacy "500-454-2" TXT form', () => {
    const { parts } = parseNestImportText('500-454-2');
    expect(parts[0]).toMatchObject({ width: 500, height: 454, qty: 2 });
  });

  it('skips a header row on the first line only', () => {
    const { parts, errors } = parseNestImportText('isim;genişlik;yükseklik;adet\nA;500;454;2');
    expect(parts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('parseNumberCell follows the file decimal mark and rejects junk', () => {
    expect(parseNumberCell('500,5', ',')).toBe(500.5);
    expect(parseNumberCell('500.5', '.')).toBe(500.5);
    expect(Number.isNaN(parseNumberCell('abc', ','))).toBe(true);
    expect(Number.isNaN(parseNumberCell('', ','))).toBe(true);
  });

  it('does not silently reinterpret a comma-decimal file as columns', () => {
    // The old split(/[,;]/) produced ["Kapak","500","5","454","2","2"] here.
    const { parts } = parseNestImportText('Kapak;500,5;454,2;2');
    expect(parts[0].width).toBe(500.5);
    expect(parts[0].height).toBe(454.2);
    expect(parts[0].qty).toBe(2);
    expect(parts).toHaveLength(1);
  });
});
