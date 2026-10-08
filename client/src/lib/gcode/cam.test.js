// Glass door ("cam kapak") against the ArtCAM job in numuneler/cam/
// (366 x 1284, one column of 4 openings, 60 mm frame, 20 mm çıta, 10 mm oturma
// payı, T6, tarama 9 mm deep, openings cut through).
//
// ArtCAM orders and rounds its passes differently (it starts the tarama in the
// middle of each çıta and turns R3 corners), so the programs are compared by
// what they REMOVE: the area swept by the 6 mm tool at each depth, on a 0.5 mm
// grid. And in nesting, every glass door's tarama must run before any glass
// door's through-cut.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { REPO_ROOT } from '../../../scripts/extractArtcamFixtures.mjs';
import { parseGcode } from './gcodeToDxf.js';
import { buildCamPartProgram } from './camTarama.js';
import { buildNestingPlateGcode } from './nesting.js';

const W = 366;
const H = 1284;
const CAM = {
  gozSayisi: 4, kolonSayisi: 1, disMargin: 60, icerGap: 20, oturmaPayi: 10,
  taramaDepth: 9, stepover: 3, toolDia: 6, taramaToolNo: '6', kesimToolNo: '6',
};
const MACHINE = { thickness: 18, spindleSpeed: 18000, safeZ: 30.1, homeZ: 30.1, plungeFeed: 3000, cutFeed: 5000 };
const ref = (n) => readFileSync(join(REPO_ROOT, 'numuneler/cam', n), 'latin1');

/** Cells (0.5 mm) swept by a 6 mm tool, per cut depth. */
function swept(text) {
  const G = 0.5; const r = 3; const nx = Math.ceil(W / G); const byZ = new Map();
  for (const s of parseGcode(text).segments) {
    if (s.type === 'G0' || s.to.z >= 18) continue;
    const z = s.to.z.toFixed(2);
    if (!byZ.has(z)) byZ.set(z, new Set());
    const cells = byZ.get(z);
    const L = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y); const n = Math.max(1, Math.ceil(L / G));
    for (let k = 0; k <= n; k++) {
      const cx = s.from.x + ((s.to.x - s.from.x) * k) / n; const cy = s.from.y + ((s.to.y - s.from.y) * k) / n;
      for (let iy = Math.floor((cy - r) / G); iy <= Math.ceil((cy + r) / G); iy++) {
        for (let ix = Math.floor((cx - r) / G); ix <= Math.ceil((cx + r) / G); ix++) {
          if (Math.hypot(ix * G + G / 2 - cx, iy * G + G / 2 - cy) <= r) cells.add(iy * nx + ix);
        }
      }
    }
  }
  return byZ;
}

describe('cam kapak vs ArtCAM (numuneler/cam)', () => {
  const ours = swept(buildCamPartProgram(W, H, { ...MACHINE, ...CAM }));
  const artcam = new Map([...swept(ref('366x1284 4goz tarama.cnc')), ...swept(ref('366x1284 4goz kesim.cnc'))]);

  it('cuts at the same depths (tarama Z9, kesim Z0)', () => {
    expect([...ours.keys()].sort()).toEqual([...artcam.keys()].sort());
  });

  for (const z of ['9.00', '0.00']) {
    it(`removes the same area at Z${z}`, () => {
      const a = artcam.get(z); const b = ours.get(z);
      const onlyA = [...a].filter((c) => !b.has(c)).length;
      const onlyB = [...b].filter((c) => !a.has(c)).length;
      expect(onlyA).toBe(0);
      expect(onlyB).toBe(0);
    });
  }
});

describe('nesting: glass doors', () => {
  const camCfg = { ...MACHINE, rows: [], name: 'Cam kapak', cam: { ...CAM, gozSayisi: 6, kolonSayisi: 2 } };
  const plate = {
    width: 2100, height: 2800,
    parts: [
      { name: 'Cam', width: 500, height: 1000, x: 10, y: 10, placedWidth: 500, placedHeight: 1000, rotated: false, presetId: 'cam' },
      { name: 'Cam', width: 500, height: 1000, x: 530, y: 10, placedWidth: 1000, placedHeight: 500, rotated: true, presetId: 'cam' },
    ],
  };
  const lines = buildNestingPlateGcode(plate, { ...MACHINE, rows: [], enableOuterCut: true }, { cam: camCfg }).split('\n');

  it('every tarama runs before any through-cut, with no tool change in between', () => {
    const tarama = lines.map((l, i) => (/Z9\.00/.test(l) ? i : -1)).filter((i) => i >= 0);
    const throughCuts = lines.map((l, i) => (/^G1 Z0\.00/.test(l) ? i : -1)).filter((i) => i >= 0);
    // 2 doors x 6 openings, then the outer cut's 2 parts
    expect(throughCuts.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...tarama)).toBeLessThan(throughCuts[0]);
    const between = lines.slice(Math.max(...tarama), throughCuts[0]);
    expect(between.some((l) => /^M6T/.test(l))).toBe(false);
  });
});
