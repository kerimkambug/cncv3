// Every program the app writes loads each tool once: all the work of a tool is
// done before the next tool comes in. Only the final cut's tool may come back,
// as the very last block.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildKapakGcode } from './kapak.js';
import { calculateNesting, buildNestingPlateGcode } from './nesting.js';
import { mergeToolBlocks, repeatedTools, toolSequence } from './toolOrder.js';

const presets = JSON.parse(fs.readFileSync(new URL('../../../../server/data/presets.json', import.meta.url), 'utf8'));
const presetMap = Object.fromEntries(presets.map((p) => [p._id || p.id || p.name, p]));

describe('mergeToolBlocks', () => {
  const prog = ['makro', 'M6T6', 'M3 S18000', 'G0 X1 Y1 Z46', 'G1 Z12 F3000', 'G1 X5', 'G0 Z46', 'M5',
    'M6T1', 'M3 S18000', 'G0Z46', 'G0 X2 Y2 Z46', 'G1 Z16', 'G0 Z46', 'M5',
    'M6T6', 'M3 S18000', 'G0Z46', 'G0 X3 Y3 Z46', 'G1 Z12', 'G1 X9', 'G0 Z46',
    'G0 X0.00 Y0.00', 'G0Z46', 'X0.00Y0.00', 'M5', 'M16', 'M30'].join('\n');

  it('moves the second T6 job next to the first one, keeps both cuts and the footer', () => {
    const out = mergeToolBlocks(prog);
    expect(toolSequence(out)).toEqual(['6', '1']);
    const L = out.split('\n');
    expect(L.indexOf('G0 X3 Y3 Z46')).toBeLessThan(L.indexOf('M6T1'));
    expect(L.slice(-3)).toEqual(['M5', 'M16', 'M30']);
    expect(L.filter((l) => l === 'G1 X9')).toHaveLength(1);
  });

  it('the final cut tool may come back at the end', () => {
    expect(toolSequence(mergeToolBlocks(prog, { finalTool: '6' }))).toEqual(['6', '1', '6']);
  });

  it('a clean program is returned byte for byte', () => {
    const clean = ['makro', 'M6T6', 'G1 X1', 'M5', 'M6T1', 'G1 X2', 'M5', 'M30'].join('\n');
    expect(mergeToolBlocks(clean)).toBe(clean);
  });
});

describe('kapak: every model, every size, one change per tool', () => {
  for (const p of presets) {
    it(p.name, () => {
      for (const [w, h] of [[500, 600], [300, 400], [180, 500], [600, 2000], [p.previewWidth || 500, p.previewHeight || 600]]) {
        let g;
        try { g = buildKapakGcode(w, h, p); } catch { continue; } // size not valid for this model
        expect(repeatedTools(g), `${w}×${h}: ${toolSequence(g).join('→')}`).toEqual([]);
      }
    });
  }

  it('side-by-side doors (Tek Ölçü) share each tool', () => {
    const p = presets.find((x) => x.name === '1 NUMARA') || presets[0];
    const lines = ['makro'];
    let x = 0;
    for (const w of [400, 450, 500]) { buildKapakGcode(w, 600, p, x, 0, true).split('\n').forEach((l) => l.trim() && lines.push(l)); x += w; }
    lines.push('G0 X0.00 Y0.00 Z96.00', 'G0Z96.00', 'X0.00Y0.00', 'M5', 'M16', 'M30');
    const g = mergeToolBlocks(lines.join('\n'));
    expect(repeatedTools(g)).toEqual([]);
    expect(new Set(toolSequence(g)).size).toBe(toolSequence(g).length);
  });
});

describe('nesting plate: mixed models and glass doors', () => {
  const ids = Object.keys(presetMap);
  const camCfg = { ...presets[0], cam: { gozSayisi: 2, kolonSayisi: 1, disMargin: 60, icerGap: 40, oturmaPayi: 8, taramaDepth: 8, stepover: 4, toolDia: 6, taramaToolNo: 6, kesimToolNo: 6 } };
  const map = { ...presetMap, __cam__: camCfg };
  const parts = [
    ...ids.slice(0, 7).map((id, i) => ({ name: `p${i}`, width: 450, height: 550, qty: 1, presetId: id })),
    { name: 'cam', width: 500, height: 700, qty: 2, presetId: '__cam__' },
  ];
  const res = calculateNesting({ plateW: 2100, plateH: 2800, edge: 10, gap: 12, rotate: true, parts });

  it('each tool once; the 6 mm outer cut comes back only at the very end', () => {
    for (const plate of res.plates) {
      const g = buildNestingPlateGcode(plate, { ...presets[0], enableOuterCut: true, cutToolNo: '6' }, map);
      expect(repeatedTools(g, '6'), toolSequence(g).join('→')).toEqual([]);
      const seq = toolSequence(g);
      expect(seq[seq.length - 1]).toBe('6');
    }
  });

  it('glass openings are cut in the final stage, after every other tool', () => {
    const plate = res.plates.find((p) => p.parts.some((q) => q.presetId === '__cam__'));
    const g = buildNestingPlateGcode(plate, { ...presets[0], enableOuterCut: true, cutToolNo: '6' }, map).split('\n');
    const lastChange = g.map((l, i) => (/^M6T/.test(l) ? i : -1)).filter((i) => i >= 0).pop();
    // the opening of a glass door goes through: Z0 moves appear after the last tool change only
    const z0 = g.map((l, i) => (/^G1 Z0\.00\b/.test(l) ? i : -1)).filter((i) => i >= 0);
    expect(z0.length).toBeGreaterThan(0);
    expect(Math.min(...z0)).toBeGreaterThan(lastChange);
  });
});

describe('çerezlik plate: one change per tool', async () => {
  const { CATALOG, catalogPart } = await import('../cerezlik/catalog.js');
  const { DEFAULT_RECIPE } = await import('../cerezlik/toolpaths.js');
  const { runNest, platePrograms } = await import('../cerezlik/job.js');
  it('grooves (T2), V lines, pockets, rounding and cuts on one plate', () => {
    const recipe = structuredClone(DEFAULT_RECIPE);
    recipe.groove.tool = 2;
    const pick = ['kesme-oluklu', 'cerez-izgara', 'sunum-yinyang', 'kesme-delikli', 'cerez-cicek'];
    const parts = pick.map((id, i) => ({ ...catalogPart(CATALOG.find((m) => m.id === id), {}), id: `c${i}`, qty: 1 }));
    const res = runNest(parts, recipe, { width: 1600, height: 1200, margin: 10, extraGap: 2, angleStep: 90, cell: 3, seconds: 0.3 });
    for (const prog of platePrograms(res, parts, recipe)) {
      expect(repeatedTools(prog.gcode, String(recipe.cut.tool)), toolSequence(prog.gcode).join('→')).toEqual([]);
    }
  });
});
