import { describe, it, expect } from 'vitest';
import { parseDxf } from './dxf.js';
import { buildParts, checkPart } from './parts.js';
import { partToolpaths, DEFAULT_RECIPE, toolReach } from './toolpaths.js';
import { runNest, spacing, platePrograms, DEFAULT_PLATE } from './job.js';
import { bbox, signedArea, offset, intersectionArea, transform, polylineDistance } from './geom.js';
import { sampleDrawing, dxfDoc, circle, lwpoly, crescentPoints } from './sampleDxf.js';

const recipe = structuredClone(DEFAULT_RECIPE);
const sample = () => buildParts(parseDxf(sampleDrawing()), 'ornek');

describe('DXF reading', () => {
  it('reads circles, bulged polylines, ellipses and chains loose LINE/ARC pieces into loops', () => {
    const d = parseDxf(sampleDrawing());
    expect(d.loops).toHaveLength(10);
    expect(d.chains).toHaveLength(1); // the leaf vein
  });

  it('bulges become true arcs (leaf: 300 long, ~140 wide)', () => {
    const leaf = sample().parts.find((p) => p.comps.length === 1 && p.lines.length === 1);
    expect(leaf.width).toBeCloseTo(300, 1);
    expect(leaf.height).toBeCloseTo(139.8, 0);
  });

  it('converts inch drawings to millimetres', () => {
    const d = parseDxf(dxfDoc([circle(0, 0, 1)], { units: 1 }));
    expect(bbox([d.loops[0].pts]).w).toBeCloseTo(50.8, 1);
  });
});

describe('parts from loops', () => {
  it('outline / compartments / lines by nesting depth', () => {
    const { parts } = sample();
    expect(parts).toHaveLength(4);
    const comps = parts.map((p) => p.comps.length).sort();
    expect(comps).toEqual([0, 1, 2, 3]);
    for (const p of parts) {
      const b = bbox([p.outline]);
      expect(b.minX).toBeCloseTo(0, 6);
      expect(b.minY).toBeCloseTo(0, 6);
    }
  });

  it('a compartment on a "DELIK" layer is a through hole', () => {
    const { parts } = buildParts(parseDxf(dxfDoc([circle(0, 0, 100), circle(0, 0, 20, 'DELIK')])));
    expect(parts[0].comps[0].kind).toBe('delik');
  });

  it('flags thin walls and bowls too small for the bit', () => {
    const { parts } = buildParts(parseDxf(dxfDoc([circle(0, 0, 100), circle(0, 0, 97), circle(200, 0, 50), circle(200, 0, 2.5)])));
    const thin = parts.find((p) => p.width > 150);
    expect(checkPart(thin, recipe).join(' ')).toMatch(/Kenar duvarı/);
    const tiny = parts.find((p) => p.width < 150);
    expect(checkPart(tiny, recipe).join(' ')).toMatch(/çok küçük/);
  });
});

describe('recipe toolpaths', () => {
  const round = () => sample().parts.find((p) => p.comps.length === 3);
  const ops = () => partToolpaths(round(), recipe);

  it('order: pocket, T3 rounding, through cut', () => {
    expect(ops().map((o) => [o.kind, o.tool])).toEqual([['pocket', 6], ['round', 3], ['cut', 6]]);
  });

  it('T3 runs 1 mm outside the outline and 1 mm inside every bowl, at its depth', () => {
    const r = ops().find((o) => o.kind === 'round');
    const outer = r.passes.reduce((a, b) => (bbox([a]).w > bbox([b]).w ? a : b));
    expect(bbox([outer]).w).toBeCloseTo(302, 1);
    const bowls = r.passes.filter((p) => p !== outer);
    expect(bowls).toHaveLength(3);
    for (const p of bowls) expect(bbox([p]).w).toBeCloseTo(108, 1);
    expect(r.passes.every((p) => p.every((q) => q[2] === 18 - 6))).toBe(true);
  });

  it('pocket stays a cutter radius inside the bowl and reaches the bowl depth in steps', () => {
    const part = round();
    const pk = ops().find((o) => o.kind === 'pocket');
    const zs = [...new Set(pk.passes.flatMap((p) => p.map((q) => q[2])))].sort((a, b) => a - b);
    expect(zs).toEqual([8, 13]);
    for (const pass of pk.passes) {
      for (const [x, y] of pass) {
        const inside = part.comps.some((c) => {
          const cb = bbox([c.pts]);
          const cx = (cb.minX + cb.maxX) / 2, cy = (cb.minY + cb.maxY) / 2;
          return Math.hypot(x - cx, y - cy) <= 55 - 3 + 0.05;
        });
        expect(inside).toBe(true);
      }
    }
  });

  it('outline cut: climb (CCW) outside by the cutter radius, to Z0, tabs on the last pass', () => {
    const cut = ops().find((o) => o.kind === 'cut');
    const last = cut.passes[cut.passes.length - 1];
    expect(signedArea(last.map(([x, y]) => [x, y]))).toBeGreaterThan(0);
    expect(bbox([last]).w).toBeCloseTo(306, 1);
    const zs = [...new Set(last.map((q) => q[2]))].sort((a, b) => a - b);
    expect(zs).toEqual([0, 2]);
    expect([...new Set(cut.passes.map((p) => Math.max(...p.map((q) => q[2]))))].sort((a, b) => b - a)).toEqual([12, 6, 2]);
  });
});

describe('true-shape nesting', () => {
  const plate = { ...DEFAULT_PLATE, width: 1200, height: 1000, seconds: 1 };

  function placedOutlines(parts, res) {
    const byId = new Map(parts.map((p) => [p.id, p]));
    return res.plates.map((pl) => pl.placements.map((pc) => transform(byId.get(pc.id).outline, pc.angle, pc.dx, pc.dy)));
  }

  it('keeps every outline at least the tool gap apart and inside the plate edge rule', () => {
    const parts = sample().parts.map((p, i) => ({ ...p, id: `p${i}`, qty: 3 }));
    const res = runNest(parts, recipe, plate);
    expect(res.unplaced).toEqual([]);
    expect(res.plates.reduce((s, p) => s + p.placements.length, 0)).toBe(12);
    const { gap, edge } = spacing(recipe, plate);
    expect(gap).toBe(toolReach(recipe) + 2);
    for (const outlines of placedOutlines(parts, res)) {
      for (let i = 0; i < outlines.length; i++) {
        const b = bbox([outlines[i]]);
        expect(b.minX).toBeGreaterThanOrEqual(edge - 1e-6);
        expect(b.minY).toBeGreaterThanOrEqual(edge - 1e-6);
        expect(b.maxX).toBeLessThanOrEqual(plate.width - edge + 1e-6);
        expect(b.maxY).toBeLessThanOrEqual(plate.height - edge + 1e-6);
        for (let j = i + 1; j < outlines.length; j++) {
          const bi = bbox([outlines[j]]);
          if (bi.minX > b.maxX + gap || bi.maxX < b.minX - gap || bi.minY > b.maxY + gap || bi.maxY < b.minY - gap) continue;
          expect(polylineDistance(outlines[i], outlines[j])).toBeGreaterThanOrEqual(gap - 0.05);
        }
      }
    }
  });

  it('wide plates are swept along their long side and still stay valid', () => {
    const parts = sample().parts.map((p, i) => ({ ...p, id: `p${i}`, qty: 2 }));
    const wide = { ...plate, width: 2400, height: 800 };
    const res = runNest(parts, recipe, wide);
    expect(res.transpose).toBe(true);
    const grown = placedOutlines(parts, res).flat().map((o) => offset([o], spacing(recipe, wide).gap / 2 - 0.05));
    for (let i = 0; i < grown.length; i++) for (let j = i + 1; j < grown.length; j++) {
      expect(intersectionArea(grown[i], grown[j])).toBeLessThan(0.01);
    }
  });

  it('concave parts interlock: some bounding boxes overlap', () => {
    const { parts } = buildParts(parseDxf(dxfDoc([lwpoly(crescentPoints(0, 0))])), 'hilal');
    const list = [{ ...parts[0], id: 'c', qty: 8 }];
    const res = runNest(list, recipe, { ...plate, width: 900, height: 900, angleStep: 15, seconds: 1.5 });
    const outs = placedOutlines(list, res)[0];
    let overlap = false;
    for (let i = 0; i < outs.length && !overlap; i++) for (let j = i + 1; j < outs.length; j++) {
      const a = bbox([outs[i]]), b = bbox([outs[j]]);
      if (a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY) { overlap = true; break; }
    }
    expect(overlap).toBe(true);
  });
});

describe('plate G-code', () => {
  it('machine dialect, tool order and safe depths', () => {
    const parts = sample().parts.map((p, i) => ({ ...p, id: `p${i}`, qty: 1 }));
    const res = runNest(parts, recipe, { ...DEFAULT_PLATE, width: 1200, height: 1000, seconds: 0.3 });
    const [prog] = platePrograms(res, parts, recipe);
    const lines = prog.gcode.trim().split('\n');
    expect(lines[0]).toBe('makro');
    expect(lines.slice(-3)).toEqual(['M5', 'M16', 'M30']);
    expect(lines.filter((l) => l.startsWith('M6T'))).toEqual(['M6T6', 'M6T3', 'M6T1', 'M6T6']);
    const zs = lines.map((l) => /Z(-?[\d.]+)/.exec(l)).filter(Boolean).map((m) => +m[1]);
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBe(46);
    expect(prog.minutes).toBeGreaterThan(1);
  });
});

describe('built-in catalog', async () => {
  const { CATALOG, catalogPart, defaultParams } = await import('./catalog.js');
  const { pointInPolygon } = await import('./geom.js');

  const variants = (m) => {
    const d = defaultParams(m);
    const lo = Object.fromEntries(m.params.map((p) => [p.k, p.min]));
    const hi = Object.fromEntries(m.params.map((p) => [p.k, p.max]));
    return [d, { ...d, ...lo }, { ...d, ...hi }];
  };

  for (const model of CATALOG) {
    it(`${model.name}: compartments inside the outline, apart from each other, toolpaths build`, () => {
      for (const params of variants(model)) {
        const part = catalogPart(model, params);
        expect(part.outline.length).toBeGreaterThanOrEqual(4);
        expect(part.width).toBeGreaterThan(50);
        for (const c of part.comps) {
          expect(c.pts.every((pt) => pointInPolygon(pt, part.outline))).toBe(true);
          expect(polylineDistance(c.pts, part.outline)).toBeGreaterThan(5);
        }
        for (let i = 0; i < part.comps.length; i++) for (let j = i + 1; j < part.comps.length; j++) {
          // a groove's island may hold a hole: then the hole sits inside the island
          const a = part.comps[i], b = part.comps[j];
          const nested = [...a.islands, ...b.islands].some((isl) => pointInPolygon((a.islands.includes(isl) ? b : a).pts[0], isl));
          if (nested) continue;
          expect(intersectionArea([a.pts], [b.pts])).toBeLessThan(0.01);
          expect(polylineDistance(a.pts, b.pts)).toBeGreaterThan(5);
        }
        const ops = partToolpaths(part, recipe);
        expect(ops.find((o) => o.kind === 'cut').passes.length).toBeGreaterThan(0);
      }
    });
  }
});
