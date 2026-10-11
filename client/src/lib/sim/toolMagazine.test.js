import { describe, it, expect } from 'vitest';
import { simulate, TOOL_TABLE } from './millSim.js';
import { defaultMagazine, loadTool, normalizeMagazine, toSimTools, toolProblem } from './toolMagazine.js';

const at = (grid, x, y) => grid.z[Math.floor((y - grid.y0) / grid.cell) * grid.w + Math.floor((x - grid.x0) / grid.cell)];
const box = { x0: -20, y0: -20, x1: 120, y1: 120 };
const pass = 'M6T4\nG0 X10 Y50 Z30\nG1 Z12 F1000\nG1 X90\nG0 Z30';

describe('tool library + magazine', () => {
  it('starts as the built-in table: T1…T12 loaded, same shapes', () => {
    const tools = toSimTools(defaultMagazine());
    expect(Object.keys(tools)).toHaveLength(12);
    expect(tools[12]).toMatchObject({ type: 'v', dia: 80, angle: 135 });
    expect(tools[5]).toMatchObject({ type: 'roundover', dia: 14.5, flat: 1 });
    expect(tools[13]).toBeUndefined(); // beyond the magazine: built-in table
  });

  it('the simulation cuts with the tool loaded in the slot', () => {
    const m = defaultMagazine();
    m.library.push({ id: 'x', name: 'Ø20 düz', type: 'flat', dia: '20' });
    const { grid } = simulate(pass, { top: 18, cell: 0.25, box, tools: toSimTools(loadTool(m, 4, 'x')) });
    expect(at(grid, 50, 59.6)).toBeCloseTo(12, 3); // inside the 10 mm radius (T4 Ø4 would not reach)
    expect(at(grid, 50, 60.6)).toBeCloseTo(18, 3);
  });

  it('a tool lives in one slot; loading it elsewhere empties the old one', () => {
    const m = loadTool(defaultMagazine(), 7, 'b4');
    expect(m.slots[7]).toBe('b4');
    expect(m.slots[4]).toBeNull();
  });

  it('empty or half-entered slots are reported by the simulation', () => {
    const m = defaultMagazine();
    m.slots[4] = null;
    const { stats } = simulate(pass, { top: 18, cell: 0.5, box, tools: toSimTools(m) });
    expect(stats.emptySlots).toEqual(['T4 (yuva boş)']);
    expect(toolProblem({ type: 'v', dia: 20 })).toMatch(/Açı/);
    expect(toolProblem({ type: 'flat', dia: '' })).toMatch(/Çap/);
  });

  it('normalize drops slots pointing at deleted tools and keeps the slot count', () => {
    const m = normalizeMagazine({ ...defaultMagazine(), library: defaultMagazine().library.filter((t) => t.id !== 'b2'), slotCount: 8 });
    expect(m.slots[2]).toBeNull();
    expect(Object.keys(m.slots)).toHaveLength(8);
    expect(TOOL_TABLE[2]).toBeDefined(); // the built-in table itself is untouched
  });
});
