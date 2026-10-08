import { describe, it, expect } from 'vitest';
import {
  buildTaramaPaths, buildSablonPaths, buildUzatmaPaths, decodeSablonPath, encodeSablonPath,
} from './features.js';
import { computeDerzPositions, trimDerzLine, derzBoxLine } from './derz.js';
import { buildKapakGcode } from './kapak.js';

const cfg = (rows) => ({
  thickness: 18, spindleSpeed: 18000, safeZ: 46, toolChangeZ: 46, homeZ: 46, plungeFeed: 3000, cutFeed: 6000,
  offsetMode: 'absolute', topStyle: 'flat', rows,
});

describe('tarama (pocket)', () => {
  const row = { stepOffset: 108.5, depth: 6, tarama: { innerOffset: 0, toolDiameter: 10, stepover: 5 } };
  const [path] = buildTaramaPaths(347.5, 462.5, row, 18);

  it('is one continuous pass at the pocket depth', () => {
    expect(buildTaramaPaths(347.5, 462.5, row, 18)).toHaveLength(1);
    expect(path.every((p) => p.z === 12)).toBe(true);
  });

  it('outermost ring keeps the tool radius inside the boundary (108.5 + 5 = 113.5)', () => {
    expect(Math.min(...path.map((p) => p.x))).toBeCloseTo(113.5, 6);
    expect(Math.max(...path.map((p) => p.x))).toBeCloseTo(347.5 - 113.5, 6);
    expect(Math.min(...path.map((p) => p.y))).toBeCloseTo(113.5, 6);
  });

  it('leaves an island when innerOffset is given', () => {
    const [ring] = buildTaramaPaths(400, 600, { stepOffset: 60, depth: 3, tarama: { innerOffset: 90, toolDiameter: 6 } }, 18);
    // outermost ring at 60 + 3 = 63, innermost at 90 - 3 = 87 (never closer to the centre)
    expect(Math.max(...ring.map((p) => p.x))).toBeCloseTo(400 - 63, 6);
    expect(Math.min(...ring.map((p) => p.y))).toBeCloseTo(63, 6);
    expect(ring.every((p) => p.x <= 87 + 1e-9 || p.x >= 400 - 87 - 1e-9 || p.y <= 87 + 1e-9 || p.y >= 600 - 87 - 1e-9)).toBe(true);
  });

  it('returns nothing when the band is narrower than the tool', () => {
    expect(buildTaramaPaths(400, 600, { stepOffset: 60, depth: 3, tarama: { innerOffset: 64, toolDiameter: 6 } }, 18)).toEqual([]);
  });
});

describe('sablon (anchored template)', () => {
  const sablon = { refWidth: 300, refHeight: 400, paths: [[[10, 20, 2], [290, 380, 2]], [[200, 50, 1, 0, 0]]] };

  it('reproduces the template on the reference door', () => {
    const [a, b] = buildSablonPaths(300, 400, { sablon }, 18);
    expect(a.map((p) => [p.x, p.y, p.z])).toEqual([[10, 20, 16], [290, 380, 16]]);
    expect([b[0].x, b[0].y]).toEqual([200, 50]);
  });

  it('keeps distances to the nearest edges on a bigger door, unless a point is pinned', () => {
    const [a, b] = buildSablonPaths(500, 700, { sablon }, 18);
    expect(a.map((p) => [p.x, p.y])).toEqual([[10, 20], [490, 680]]);
    expect([b[0].x, b[0].y]).toEqual([200, 50]); // ax = 0: follows the left edge although it is in the right half
  });

  it('depth follows the material thickness', () => {
    expect(buildSablonPaths(300, 400, { sablon }, 19)[0][0].z).toBe(17);
  });

  it('string encoding round-trips (0.01 mm)', () => {
    const pts = [[1.234, 5.678, 2, 1, 0], [3, 4, 0.5, undefined, undefined]];
    const back = decodeSablonPath(encodeSablonPath(pts));
    expect(back[0]).toEqual([1.23, 5.68, 2, 1, 0]);
    expect(back[1]).toEqual([3, 4, 0.5, undefined, undefined]);
  });
});

describe('uzatma (extension lines)', () => {
  it('runs the frame verticals on past the top and bottom edges (TABLA model 9)', () => {
    const lines = buildUzatmaPaths(347.5, 462, { stepOffset: 47.5, depth: 2.5, uzatma: { yon: 'dikey', overshoot: 0.5 } }, 18);
    expect(lines).toHaveLength(4);
    const ends = lines.map((l) => [l[0].x, l[0].y, l[1].x, l[1].y]);
    expect(ends).toContainEqual([47.5, 47.5, 47.5, -0.5]);
    expect(ends).toContainEqual([300, 414.5, 300, 462.5]);
  });
});

describe('derz extras', () => {
  it('count: one line in the middle', () => {
    expect(computeDerzPositions({ width: 300, height: 500, yon: 'yatay', margin: 0, count: 1, insideFrame: true }).positions).toEqual([250]);
  });

  it('stagger: lines halfway between the equal-split lines (TABLA model 4 short lines)', () => {
    const pos = computeDerzPositions({ width: 347.5, height: 462, yon: 'dikey', margin: 0, spacing: 28.96, stagger: true }).positions;
    expect(pos).toHaveLength(12);
    expect(pos[0]).toBeCloseTo(347.5 / 24, 6);
    expect(pos[11]).toBeCloseTo(347.5 - 347.5 / 24, 6);
  });

  it('lineFromPct trims the start, stopBox stops all but the first/last `skip` lines', () => {
    const d = { lineFromPct: 50, stopBox: { fromTop: 44.5, skip: 2 } };
    expect(trimDerzLine(d, true, 14.5, 0, 462, 347.5, 462, 0, 12)).toEqual([231, 462]);
    expect(trimDerzLine(d, true, 72.4, 0, 462, 347.5, 462, 2, 12)).toEqual([231, 417.5]);
    expect(trimDerzLine(d, true, 333, 0, 462, 347.5, 462, 11, 12)).toEqual([231, 462]);
  });

  it('stopBox.line spans the box sides', () => {
    const pos = [10, 20, 30, 40, 50, 60];
    expect(derzBoxLine({ stopBox: { fromTop: 44.5, skip: 2, line: true } }, pos, 462)).toEqual({ x1: 20, x2: 50, y: 417.5 });
    expect(derzBoxLine({ stopBox: { fromTop: 44.5, skip: 2 } }, pos, 462)).toBeNull();
  });
});

describe('kapak integration', () => {
  it('a trimmed / horizontal first divider writes its own Y (never inherits the last Y)', () => {
    const g = buildKapakGcode(300, 500, cfg([
      { toolNo: '5', operation: 'offset', stepOffset: 0, absoluteOffset: 0, depth: 5 },
      { toolNo: '5', operation: 'derz', depth: 5, derz: { yon: 'yatay', margin: 0, count: 1, insideFrame: true, overshootX: 0, respectPreviousOffset: false } },
    ])).split('\n');
    // the rectangle ends at Y0; the mid line must approach with its own Y250
    const i = g.findIndex((l) => /^G0 X0\.00 Y250\.00/.test(l));
    expect(i).toBeGreaterThan(0);
    expect(g[i + 1]).toMatch(/^G1\s+Z13\.00/);
    expect(g[i + 2]).toMatch(/^G1 X300\.00/);
  });

  it('a feature on the tool already in the spindle needs no extra tool change', () => {
    const g = buildKapakGcode(347.5, 462, cfg([
      { toolNo: '1', operation: 'offset', stepOffset: 47.5, absoluteOffset: 47.5, depth: 2.5 },
      { toolNo: '12', operation: 'carving', stepOffset: 69.3, depth: 8, bitAngle: 135 },
      { toolNo: '1', operation: 'uzatma', stepOffset: 47.5, depth: 2.5, uzatma: { yon: 'dikey' } },
    ]));
    expect((g.match(/M6T/g) || []).length).toBe(2);
    expect(g.indexOf('M6T12')).toBeGreaterThan(g.lastIndexOf('X47.50'));
  });

  it('feature rows do not shift the offset chain or the derz frame', () => {
    const rows = [
      { toolNo: '1', operation: 'offset', stepOffset: 60, absoluteOffset: 60, depth: 3 },
      { toolNo: '1', operation: 'derz', depth: 2, derz: { yon: 'dikey', margin: 60, spacing: 30, insideFrame: true, respectPreviousOffset: false } },
    ];
    const plain = buildKapakGcode(300, 400, cfg(rows)).split('\n');
    const withFeature = buildKapakGcode(300, 400, cfg([...rows, { toolNo: '10', operation: 'tarama', stepOffset: 100, depth: 3, tarama: { toolDiameter: 10 } }])).split('\n');
    // identical up to the program tail (which starts with the return to X0 Y0)
    const body = plain.slice(0, plain.lastIndexOf('G0 X0.00 Y0.00'));
    expect(withFeature.slice(0, body.length)).toEqual(body);
    expect(withFeature).toContain('M6T10');
  });
});

describe('nesting: a rotated part is cut as itself, turned', async () => {
  const { partToolpathSegments } = await import('./nesting.js');
  const presets = JSON.parse((await import('node:fs')).readFileSync(new URL('../../../../server/data/presets.json', import.meta.url), 'utf8'));
  const key = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

  for (const name of ['4 NUMARA', '3 NUMARA', '14 NUMARA', '1 NUMARA']) {
    it(`${name}: rotated segments = unrotated segments turned 90° clockwise`, () => {
      const cfg = presets.find((p) => p.name === name);
      const W = 400; const H = 600;
      const flat = partToolpathSegments({ x: 0, y: 0, width: W, height: H, placedWidth: W, placedHeight: H, rotated: false }, cfg);
      const turned = partToolpathSegments({ x: 1000, y: 50, width: W, height: H, placedWidth: H, placedHeight: W, rotated: true }, cfg);
      expect(turned.length).toBe(flat.length);
      const expected = new Set(flat.map((s) => key({ x: 1000 + s.to.y, y: 50 + W - s.to.x })));
      const got = turned.map((s) => key(s.to));
      const misses = got.filter((k) => !expected.has(k));
      expect(misses.length).toBeLessThanOrEqual(Math.ceil(got.length * 0.002)); // arc sampling may differ by rounding
      // and everything stays on the placed rectangle
      turned.forEach((s) => {
        expect(s.to.x).toBeGreaterThanOrEqual(1000 - 0.6);
        expect(s.to.x).toBeLessThanOrEqual(1000 + H + 0.6);
      });
    });
  }
});

describe('nesting: final cut order', async () => {
  const { orderPartsVacuumSafeFinalCut } = await import('./nesting.js');
  const P = (name, x, y, w = 400, h = 500) => ({ name, x, y, placedWidth: w, placedHeight: h });

  it('row by row from the top, each row right to left, bottom-left last', () => {
    const parts = [];
    for (const [r, y] of [['alt', 10], ['orta', 520], ['ust', 1030]]) {
      for (const [c, x] of [['sol', 10], ['orta', 420], ['sag', 830]]) parts.push(P(`${r}-${c}`, x, y));
    }
    expect(orderPartsVacuumSafeFinalCut(parts.reverse()).map((p) => p.name)).toEqual([
      'ust-sag', 'ust-orta', 'ust-sol', 'orta-sag', 'orta-orta', 'orta-sol', 'alt-sag', 'alt-orta', 'alt-sol',
    ]);
  });

  it('a tall part and two stacked small ones beside it form one row; the upper one goes first', () => {
    const order = orderPartsVacuumSafeFinalCut([
      P('kucuk-alt', 10, 10, 300, 240), P('uzun', 320, 10, 400, 500), P('kucuk-ust', 10, 260, 300, 240),
    ]).map((p) => p.name);
    expect(order).toEqual(['uzun', 'kucuk-ust', 'kucuk-alt']);
  });
});

describe('nesting: variant search', async () => {
  const { calculateNesting, minPartSpacing } = await import('./nesting.js');
  let t = 11; const r = () => { t = (t * 1103515245 + 12345) % 2147483648; return t / 2147483648; };
  const orders = Array.from({ length: 25 }, () => Array.from({ length: 6 + Math.floor(r() * 20) }, (_, i) => ({
    name: `p${i}`, width: 150 + Math.round(r() * 800), height: 200 + Math.round(r() * 1400), qty: 1 + Math.floor(r() * 3), lockRotation: r() < 0.15,
  })));
  const base = { plateW: 2100, plateH: 2800, edge: 10, gap: 12, rotate: true };

  it('never uses more plates than a single pass, and saves plates on some orders', () => {
    let saved = 0;
    orders.forEach((parts) => {
      const one = calculateNesting({ ...base, parts, maxVariants: 1 }).plates.length;
      const many = calculateNesting({ ...base, parts }).plates.length;
      expect(many).toBeLessThanOrEqual(one);
      if (many < one) saved++;
    });
    expect(saved).toBeGreaterThan(0);
  });

  it('keeps margins, gaps and locked orientations; places every part exactly once', () => {
    orders.forEach((parts) => {
      const res = calculateNesting({ ...base, parts });
      const placed = res.plates.flatMap((pl) => pl.parts);
      expect(placed.length).toBe(parts.reduce((s, p) => s + p.qty, 0));
      res.plates.forEach((pl) => {
        pl.parts.forEach((p) => {
          expect(p.x).toBeGreaterThanOrEqual(10 - 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(10 - 1e-6);
          expect(p.x + p.placedWidth).toBeLessThanOrEqual(2090 + 1e-6);
          expect(p.y + p.placedHeight).toBeLessThanOrEqual(2790 + 1e-6);
          if (p.lockRotation) expect(p.rotated).toBe(false);
        });
        const g = minPartSpacing(pl.parts);
        if (g !== null) expect(g).toBeGreaterThanOrEqual(12 - 1e-6);
      });
    });
  });

  it('is deterministic for the same order (variant budget, not the clock, ends the search)', () => {
    const parts = orders[3];
    const a = calculateNesting({ ...base, parts, maxVariants: 300, timeBudgetMs: 60000 });
    const b = calculateNesting({ ...base, parts, maxVariants: 300, timeBudgetMs: 60000 });
    expect(JSON.stringify(a.plates)).toBe(JSON.stringify(b.plates));
  });
});

describe('every preset moves exactly with its plate position (nesting)', async () => {
  const { parseGcode } = await import('./gcodeToDxf.js');
  const presets = JSON.parse((await import('node:fs')).readFileSync(new URL('../../../../server/data/presets.json', import.meta.url), 'utf8'));
  for (const p of presets) {
    it(`${p.name}: program at (1000, 300) = program at (0, 0) shifted by (1000, 300)`, () => {
      const a = parseGcode(buildKapakGcode(500, 600, p, 0, 0, true)).segments;
      const b = parseGcode(buildKapakGcode(500, 600, p, 1000, 300, true)).segments;
      expect(b.length).toBe(a.length);
      a.forEach((s, i) => {
        expect(b[i].to.x - s.to.x).toBeCloseTo(1000, 2);
        expect(b[i].to.y - s.to.y).toBeCloseTo(300, 2);
      });
    });
  }
});

describe('narrow doors: frames move out on the narrow axis only', async () => {
  const { parseGcode } = await import('./gcodeToDxf.js');
  const { planNarrowDoor } = await import('./kapak.js');
  const presets = JSON.parse((await import('node:fs')).readFileSync(new URL('../../../../server/data/presets.json', import.meta.url), 'utf8'));
  const m1 = presets.find((p) => p.name === '1 NUMARA');
  const m4 = presets.find((p) => p.name === '4 NUMARA');
  const cuts = (g) => parseGcode(g).segments.filter((s) => s.type !== 'G0');
  // the carving V (T1 at 6 mm) runs exactly on the first offset
  const carvingBox = (g) => {
    const s = cuts(g).filter((x) => x.tool === '1' && Math.abs(x.to.z - 12) < 1e-6);
    return [Math.min(...s.map((x) => x.to.x)), Math.min(...s.map((x) => x.to.y))];
  };

  it('500 x 180: long side keeps 63, the 180 side goes to 46 (66 mm panel setting -> 43)', () => {
    expect(carvingBox(buildKapakGcode(500, 180, m1))).toEqual([63, 46]);
    expect(carvingBox(buildKapakGcode(500, 180, { ...m1, narrowMinPanel: 66 }))).toEqual([63, 43]);
    expect(carvingBox(buildKapakGcode(180, 500, m1))).toEqual([46, 63]);
  });

  it('steps between frames are kept (carving 63 -> inner V +14 on both axes)', () => {
    const plan = planNarrowDoor(500, 180, m1);
    expect(plan.dx).toBe(0);
    expect(plan.dy).toBeCloseTo(17, 6);
    const t1 = cuts(buildKapakGcode(500, 180, m1)).filter((x) => x.tool === '1' && Math.abs(x.to.z - 12) < 1e-6 && x.from.z === x.to.z);
    expect(Math.min(...t1.map((x) => x.to.y))).toBeCloseTo(46, 2); // carving line
    expect(Math.max(...t1.filter((x) => x.to.y < 90).map((x) => x.to.y))).toBeCloseTo(60, 2); // inner V = 77 - 17
  });

  it('first offset never below the minimum; what does not fit is dropped and cleared inside', () => {
    const g = buildKapakGcode(500, 80, m1);
    const plan = planNarrowDoor(500, 80, m1);
    expect(plan.dy).toBeCloseTo(33, 6); // 63 -> 30 (narrowMinFirst)
    expect(plan.dropped).toBeGreaterThan(0);
    expect(plan.cfg.rows.some((r) => r.name === 'dar kapak: iç tarama')).toBe(true);
    const all = cuts(g);
    all.forEach((s) => {
      expect(s.to.y).toBeGreaterThanOrEqual(0);
      expect(s.to.y).toBeLessThanOrEqual(80);
    });
    // no 2.5 mm derz left on such a door
    expect(all.some((s) => Math.abs(s.to.z - 15.5) < 1e-6)).toBe(false);
  });

  it('edge rows (model 4 edge profile at offset 0) and normal doors are untouched', () => {
    const edge = cuts(buildKapakGcode(500, 180, m4)).filter((s) => s.tool === '5');
    expect(Math.min(...edge.map((s) => s.to.y))).toBeCloseTo(0, 6);
    expect(planNarrowDoor(500, 600, m1)).toBeNull();
    expect(buildKapakGcode(500, 180, { ...m1, narrowAdapt: false })).not.toBe(buildKapakGcode(500, 180, m1));
    expect(planNarrowDoor(500, 180, { ...m1, narrowAdapt: false })).toBeNull();
  });

  it('a narrow door still moves exactly with its plate position (nesting)', () => {
    const a = parseGcode(buildKapakGcode(500, 180, m1, 0, 0, true)).segments;
    const b = parseGcode(buildKapakGcode(500, 180, m1, 700, 250, true)).segments;
    expect(b.length).toBe(a.length);
    a.forEach((s, i) => {
      expect(b[i].to.x - s.to.x).toBeCloseTo(700, 2);
      expect(b[i].to.y - s.to.y).toBeCloseTo(250, 2);
    });
  });
});
