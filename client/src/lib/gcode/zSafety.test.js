// NO program the app writes may send Z below the table (Z0). Every generator is
// run here with the screens' default settings and with awkward sizes, and the
// lowest Z is checked. A generator asked for an impossible depth must refuse
// (throw) rather than write a negative Z.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildKapakGcode } from './kapak.js';
import { calculateNesting, buildNestingPlateGcode } from './nesting.js';
import { buildCamKesimGcode } from './cam.js';
import { buildCamTaramaGcode } from './camTarama.js';
import { buildCircleGcode } from './circle.js';
import { buildDerzGcode } from './derz.js';
import { generatePanjurGcode } from './panjur.js';
import { buildReliefGcodeFromDepthGrid } from './relief.js';
import { guardZ, minZ } from './zGuard.js';

const presets = JSON.parse(fs.readFileSync(new URL('../../../../server/data/presets.json', import.meta.url), 'utf8'));
const MACHINE = { thickness: 18, spindleSpeed: 18000, safeZ: 61, toolChangeZ: 96, homeZ: 96, plungeFeed: 3000, cutFeed: 6000 };
const safe = (g) => {
  expect(g).not.toMatch(/Z\s*-/);
  expect(minZ(g)).toBeGreaterThanOrEqual(0);
};

describe('guardZ', () => {
  it('turns Z-0.000 into Z0.000', () => expect(guardZ('G1 Z-0.000 F100')).toBe('G1 Z0.000 F100'));
  it('refuses a real negative Z', () => expect(() => guardZ('G1 X1 Z-0.5')).toThrow(/tablanın altına/));
});

describe('kapak: every model, many sizes', () => {
  for (const p of presets) {
    it(p.name, () => {
      for (const [w, h] of [[500, 600], [300, 400], [180, 500], [150, 300], [600, 2000], [1200, 2400]]) {
        let g;
        try { g = buildKapakGcode(w, h, p); } catch { continue; }
        safe(g);
      }
    });
  }
});

describe('nesting plate (models + glass doors, outer cut on)', () => {
  it('lowest Z is the table', () => {
    const map = Object.fromEntries(presets.map((p) => [p._id || p.id || p.name, p]));
    map.__cam__ = { ...MACHINE, rows: [], cam: { gozSayisi: 6, kolonSayisi: 2, disMargin: 60, icerGap: 20, oturmaPayi: 10, toolDia: 6, kesimToolNo: '6', taramaToolNo: '6', taramaDepth: 9, stepover: 3 } };
    const parts = [...Object.keys(map).filter((k) => k !== '__cam__').map((id, i) => ({ name: `p${i}`, width: 420, height: 520, qty: 1, presetId: id })),
      { name: 'cam', width: 500, height: 1000, qty: 2, presetId: '__cam__' }];
    const res = calculateNesting({ plateW: 2100, plateH: 2800, edge: 10, gap: 12, rotate: true, parts });
    for (const plate of res.plates) safe(buildNestingPlateGcode(plate, { ...presets[0], ...MACHINE, enableOuterCut: true, cutToolNo: '6' }, map));
  });
});

describe('cam, daire, derz, panjur, rölyef (screen defaults)', () => {
  const cam = { width: 500, height: 1000, gozSayisi: 6, kolonSayisi: 2, disMargin: 60, icerGap: 20, oturmaPayi: 10, thickness: 18, spindleSpeed: 18000, toolDia: 6, kesimToolNo: '6', taramaToolNo: '6', taramaDepth: 9, stepover: 3, plungeFeed: 3000, cutFeed: 5000, safeZ: 61, homeZ: 96 };
  it('cam kesim + tarama', () => { safe(buildCamKesimGcode(cam)); safe(buildCamTaramaGcode(cam)); });
  it('daire: through cut stops at Z0, deeper than the material is refused', () => {
    const p = { mode: 'solid', outerDia: 500, innerDia: 400, left: 0, bottom: 0, toolDia: 6, toolNo: '6', depth: 18 };
    safe(buildCircleGcode(p, MACHINE));
    let g = null;
    try { g = buildCircleGcode({ ...p, depth: 25 }, MACHINE); } catch { /* refused: fine */ }
    if (g) safe(g);
  });
  it('derz', () => safe(buildDerzGcode({ width: 500, height: 500, yon: 'dikey', margin: 60, spacing: 60, edgeExtra: 0, autoFit: true, toolNo: '1', depth: 2, overshoot: 1, outerFrame: false }, MACHINE)));
  it('panjur', () => {
    const c = { width: 200, height: 200, offset: 60, offsetMode: 'normal', offsetLeft: 60, offsetRight: 60, offsetBottom: 60, offsetTop: 60, centerFlat: 0, direction: 'y', pitch: 40.5, exitGap: 0.45, stepover: 0.468, startZ: 17.937, endZ: 3.105, feed: 20000, plunge: 3000, toolNo: '14', spindle: 12000, groundEntry: true, exitCut: 4, t4Z: 0, drillTool: '4', drillSpindle: 12000, exitToolDia: 4, t14TipDia: 2, t14BodyDia: 12, t14Height: 65, safeZ: 30, toolChangeZ: 30, homeZ: 30 };
    safe(generatePanjurGcode(c).gcode);
  });
  it('rölyef with outer cut', () => {
    const grid = new Float32Array(16 * 16).map((_, k) => ((k % 16) / 15) * ((k / 16 | 0) / 15));
    const g = buildReliefGcodeFromDepthGrid(grid, 16, 16, {
      width: 200, height: 200, thickness: 18, maxDepth: 12, stepover: 2, resolution: 16, toolType: 'ball', toolDia: 6, toolNo: '1',
      spindleSpeed: 18000, plungeFeed: 1200, cutFeed: 4000, safeZ: 25, homeZ: 60, direction: 'x', enableOuterCut: true,
    }).gcode;
    safe(g);
  });
});

describe('çerezlik: every model, figure tray, text', async () => {
  const { CATALOG, catalogPart, defaultParams } = await import('../cerezlik/catalog.js');
  const { DEFAULT_RECIPE } = await import('../cerezlik/toolpaths.js');
  const { runNest, platePrograms } = await import('../cerezlik/job.js');
  const { sampleShell } = await import('../cerezlik/figure.js');
  const { figureTrayPart } = await import('../cerezlik/figureTray.js');
  const recipe = { ...structuredClone(DEFAULT_RECIPE), bowlStyle: 'duz' };
  const plate = { width: 2100, height: 2800, margin: 10, extraGap: 2, angleStep: 90, cell: 4, seconds: 0.2 };

  it('all catalog models at max sizes and depths', () => {
    const parts = CATALOG.map((m, i) => ({ ...catalogPart(m, Object.fromEntries(m.params.map((p) => [p.k, p.max]))), id: `m${i}`, qty: 1 }));
    for (const prog of platePrograms(runNest(parts, recipe, plate), parts, recipe)) safe(prog.gcode);
  });

  it('figure tray', () => {
    const part = { ...figureTrayPart(sampleShell(200), { cell: 0.8 }, 18), id: 'f', qty: 1 };
    for (const prog of platePrograms(runNest([part], recipe, plate), [part], recipe)) safe(prog.gcode);
  });

  it('a depth deeper than the material is refused, never written', () => {
    const thin = { ...recipe, thickness: 8 };
    const m = CATALOG.find((x) => x.id === 'cerez-izgara');
    const part = { ...catalogPart(m, { ...defaultParams(m), d: 15 }), id: 'x', qty: 1 };
    let progs = null;
    try { progs = platePrograms(runNest([part], thin, plate), [part], thin); } catch (e) { expect(e.message).toMatch(/tablanın altına/); }
    if (progs) progs.forEach((p) => safe(p.gcode));
  });
});
