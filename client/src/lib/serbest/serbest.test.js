import { describe, it, expect } from 'vitest';
import { parseDxf } from '../cerezlik/dxf.js';
import { simulate } from '../sim/millSim.js';
import { toSimTools, defaultMagazine } from '../sim/toolMagazine.js';
import { buildSerbestProgram, layersOf, placeDrawing, guessOp } from './serbest.js';

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
  const cfg = { KESIM: { op: 'kesim', tool: '6' }, CEP: { op: 'cep', tool: '6', depth: 5 }, VCIZGI: { op: 'vcizgi', tool: '1', depth: 2 } };

  it('lists layers and guesses operations from their names', () => {
    expect(layersOf(drawing).map((l) => l.name).sort()).toEqual(['CEP', 'KESIM', 'VCIZGI']);
    expect(guessOp('CEP')).toBe('cep');
    expect(guessOp('V-CIZGI')).toBe('vcizgi');
    expect(guessOp('KESIM')).toBe('kesim');
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
    const out = buildSerbestProgram(placed, cfg, { thickness: 18, tools });
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

  it('through cuts come last, the hole before the outline', () => {
    const placed = placeDrawing(drawing, { mode: 'solAlt' }, cfg);
    const g = buildSerbestProgram(placed, cfg, { thickness: 18, tools }).gcode.split('\n');
    const firstZ0 = g.findIndex((l) => /Z0\.000/.test(l));
    const pocket = g.findIndex((l) => /Z13\.000/.test(l));
    expect(pocket).toBeGreaterThan(0);
    expect(pocket).toBeLessThan(firstZ0);
  });
});
