import { describe, it, expect } from 'vitest';
import { parseDxf } from '../cerezlik/dxf.js';
import { simulate } from '../sim/millSim.js';
import { toSimTools, defaultMagazine } from '../sim/toolMagazine.js';
import { buildSerbestProgram, layersOf, placeDrawing } from './serbest.js';

// a 200 × 100 plate drawn at (1000, 500): Ø40 hole, a 60 × 30 pocket, one open line
const L = (layer, a, b, c, d) => ['0', 'LINE', '8', layer, '10', a, '20', b, '11', c, '21', d].join('\n');
const CIRCLE = (layer, x, y, r) => ['0', 'CIRCLE', '8', layer, '10', x, '20', y, '40', r].join('\n');
const RECT = (layer, x0, y0, x1, y1) => [L(layer, x0, y0, x1, y0), L(layer, x1, y0, x1, y1), L(layer, x1, y1, x0, y1), L(layer, x0, y1, x0, y0)].join('\n');
const DXF = ['0', 'SECTION', '2', 'ENTITIES',
  RECT('KESIM', 1000, 500, 1200, 600), CIRCLE('KESIM', 1050, 550, 20),
  RECT('CEP', 1110, 535, 1170, 565), L('VCIZGI', 1010, 590, 1190, 590),
  '0', 'ENDSEC', '0', 'EOF'].join('\n');
const tools = toSimTools(defaultMagazine()); // T6 Ø6 düz, T1 90° V …
const at = (grid, x, y) => grid.z[Math.floor((y - grid.y0) / grid.cell) * grid.w + Math.floor((x - grid.x0) / grid.cell)];

describe('Serbest Kesim', () => {
  const drawing = parseDxf(DXF);
  // the user picks vectors, as in ArtCAM: here by layer, to keep the test short
  const pick = (placed, layer) => [...placed.loops, ...placed.chains].filter((v) => v.layer === layer).map((v) => v.id);
  const opsFor = (placed) => [
    { name: 'kesim', op: 'kesim', tool: '6', items: pick(placed, 'KESIM') },
    { name: 'cep', op: 'cep', tool: '6', depth: 5, items: pick(placed, 'CEP') },
    { name: 'v', op: 'vcizgi', tool: '1', depth: 2, items: pick(placed, 'VCIZGI') },
  ];
  const cfg = {};

  it('lists layers; every vector has a stable id', () => {
    expect(layersOf(drawing).map((l) => l.name).sort()).toEqual(['CEP', 'KESIM', 'VCIZGI']);
    const p = placeDrawing(drawing, { mode: 'solAlt' });
    expect(p.loops.map((l) => l.id)).toEqual(['K0', 'K1', 'K2']);
    expect(p.chains.map((c) => c.id)).toEqual(['A0']);
  });

  it('only the picked vectors are machined', () => {
    const placed = placeDrawing(drawing, { mode: 'solAlt' });
    const hole = placed.loops.find((l) => l.box.w < 50 && l.layer === 'KESIM');
    const out = buildSerbestProgram(placed, [{ op: 'kesim', tool: '6', items: [hole.id] }], { thickness: 18, tools });
    // one Ø40 shape cut alone is an outline: cut outside (Ø46 path), nothing else
    const xs = out.gcode.match(/X(-?[\d.]+)/g).map((v) => Number(v.slice(1))).filter((x) => x !== 0); // (the final X0 home move)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(46, 0);
  });

  it('moves the lower left corner to zero, the centre to zero, or to a given point; turns by 90°', () => {
    expect(placeDrawing(drawing, { mode: 'solAlt' }, cfg).box).toMatchObject({ x0: 0, y0: 0, x1: 200, y1: 100 });
    expect(placeDrawing(drawing, { mode: 'merkez' }, cfg).box).toMatchObject({ x0: -100, y0: -50, x1: 100, y1: 50 });
    expect(placeDrawing(drawing, { mode: 'ozel', x: 30, y: 40 }, cfg).box).toMatchObject({ x0: 30, y0: 40, x1: 230, y1: 140 });
    const t = placeDrawing(drawing, { mode: 'solAlt', rot: 90 }, cfg).box;
    expect([t.x1 - t.x0, t.y1 - t.y0]).toEqual([100, 200]);
  });

  it('cuts the outline outside and the hole inside with the real tool radius, through, with tabs; pocket and V line at depth', () => {
    const placed = placeDrawing(drawing, { mode: 'ozel', x: 20, y: 20 }, cfg);
    const out = buildSerbestProgram(placed, opsFor(placed), { thickness: 18, tools });
    expect(out.warnings).toEqual([]);
    expect(out.gcode.startsWith('makro')).toBe(true);
    expect(out.gcode).toMatch(/M30/);
    const { grid, stats } = simulate(out.gcode, { top: 18, cell: 0.25, box: { x0: 0, y0: 0, x1: 260, y1: 160 }, tools });
    expect(stats.belowTable).toBe(0);
    expect(stats.rapidCuts).toBe(0);
    expect(at(grid, 18, 70)).toBeCloseTo(0, 1);            // just outside the plate's left edge (x=20): cut through
    expect(at(grid, 21, 70)).toBeCloseTo(18, 1);           // just inside: the plate stays
    expect(at(grid, 70 + 18, 70)).toBeCloseTo(0, 1);       // the Ø40 hole's edge: cut through (the slug drops out)
    expect(at(grid, 70, 70)).toBeCloseTo(18, 1);           // its centre is the slug, never touched
    expect(at(grid, 70 + 21, 70)).toBeCloseTo(18, 1);      // just outside the hole
    expect(at(grid, 160, 70)).toBeCloseTo(13, 1);          // pocket floor (5 mm)
    expect(at(grid, 128, 70)).toBeCloseTo(18, 1);          // pocket wall stays
    expect(at(grid, 120, 110)).toBeCloseTo(16, 1);         // V line 2 mm deep
    // tabs: somewhere along the outline the cut stops 2 mm above the table
    let tab = false;
    for (let x = 30; x < 210; x += 0.5) if (Math.abs(at(grid, x, 17) - 2) < 0.2) tab = true;
    expect(tab).toBe(true);
  });

  it('pocket, ArtCAM selection logic: two nested shapes → only the band between them, with the tool clearance', () => {
    const d = parseDxf(['0', 'SECTION', '2', 'ENTITIES', RECT('0', 0, 0, 200, 200), RECT('0', 50, 50, 150, 150), '0', 'ENDSEC', '0', 'EOF'].join('\n'));
    const placed = placeDrawing(d, { mode: 'solAlt' });
    const out = buildSerbestProgram(placed, [{ op: 'cep', tool: '6', depth: 5, items: placed.loops.map((l) => l.id) }], { thickness: 18, tools });
    const { grid, stats } = simulate(out.gcode, { top: 18, cell: 0.25, box: { x0: -10, y0: -10, x1: 210, y1: 210 }, tools });
    expect(stats.belowTable).toBe(0);
    expect(at(grid, 25, 100)).toBeCloseTo(13, 1);   // the band is cleared
    expect(at(grid, 100, 100)).toBeCloseTo(18, 1);  // the inner shape stays (island)
    expect(at(grid, 51, 100)).toBeCloseTo(18, 1);   // no overcut into the island
    expect(at(grid, -1, 100)).toBeCloseTo(18, 1);   // nor outside the outer shape
    expect(at(grid, 0.4, 100)).toBeCloseTo(13, 1);  // the band reaches the outer edge
    expect(at(grid, 49.6, 100)).toBeCloseTo(13, 1); // and the island's edge
  });

  it('pocket: a square and the 4 shapes inside it → everything inside the square but outside the 4', () => {
    const shapes = [[30, 30], [120, 30], [30, 120], [120, 120]].map(([x, y]) => RECT('0', x, y, x + 50, y + 50));
    const d = parseDxf(['0', 'SECTION', '2', 'ENTITIES', RECT('0', 0, 0, 200, 200), ...shapes, '0', 'ENDSEC', '0', 'EOF'].join('\n'));
    const placed = placeDrawing(d, { mode: 'solAlt' });
    const out = buildSerbestProgram(placed, [{ op: 'cep', tool: '6', depth: 4, items: placed.loops.map((l) => l.id) }], { thickness: 18, tools });
    const { grid } = simulate(out.gcode, { top: 18, cell: 0.25, box: { x0: -10, y0: -10, x1: 210, y1: 210 }, tools });
    expect(at(grid, 100, 100)).toBeCloseTo(14, 1);  // the cross between the shapes
    expect(at(grid, 15, 15)).toBeCloseTo(14, 1);    // the frame around them
    for (const [x, y] of [[55, 55], [145, 55], [55, 145], [145, 145]]) expect(at(grid, x, y)).toBeCloseTo(18, 1); // the 4 shapes stay
    expect(at(grid, 30.6, 55)).toBeCloseTo(18, 1);  // no overcut into a shape
    expect(at(grid, 29.4, 55)).toBeCloseTo(14, 1);  // cleared right up to it
  });

  it('through cuts come last, the hole before the outline', () => {
    const placed = placeDrawing(drawing, { mode: 'solAlt' }, cfg);
    const g = buildSerbestProgram(placed, opsFor(placed), { thickness: 18, tools }).gcode.split('\n');
    const firstZ0 = g.findIndex((l) => /Z0\.000/.test(l));
    const pocket = g.findIndex((l) => /Z13\.000/.test(l));
    expect(pocket).toBeGreaterThan(0);
    expect(pocket).toBeLessThan(firstZ0);
  });
});
