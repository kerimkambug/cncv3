// Models 4 and 9-14 have no per-model ArtCAM file: their only source is the TABLA
// panel (numuneler/TABLA MODELLERİMİZ pano şeklinde.anc, 1390 x 2100, 4 x 4 doors
// of 347.5 x ~462.5). This test cuts each preset on the panel's door size and
// checks, pass by pass, that every ArtCAM toolpath of that door has a twin in
// ours (same tool, same depth, same extent within 0.6 mm) and vice versa.
//
// Passes are compared by extent, not line by line: the panel was posted with a
// different post-processor (N numbers, R arcs), so only the cut geometry is
// comparable. Known, harmless differences are listed per model below.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildKapakGcode } from './kapak.js';
import { REPO_ROOT } from '../../../scripts/extractArtcamFixtures.mjs';

const ANC = readFileSync(join(REPO_ROOT, 'numuneler/TABLA MODELLERİMİZ pano şeklinde.anc'), 'latin1').split(/\r?\n/);
const PRESETS = JSON.parse(readFileSync(join(REPO_ROOT, 'server/data/presets.json'), 'utf8'));

/** G-code -> cutting passes; a pass ends on a rapid or a lift above the surface. R arcs are interpolated. */
function passesOf(lines, dx = 0, dy = 0) {
  let T = null; let x = 0; let y = 0; let z = 30; let mode = 0; const out = []; let cur = null;
  const flush = () => { if (cur && cur.pts.length > 1) out.push(cur); cur = null; };
  for (const raw of lines) {
    const l = raw.replace(/^N\d+\s*/, ''); let m;
    if ((m = l.match(/M6\s*T(\d+)/))) { flush(); T = +m[1]; }
    if ((m = l.match(/\bG0?([0123])\b/)) || (m = l.match(/^G([0123])(?=[XYZ])/))) mode = +m[1];
    const px = x; const py = y;
    if ((m = l.match(/X(-?[\d.]+)/))) x = +m[1];
    if ((m = l.match(/Y(-?[\d.]+)/))) y = +m[1];
    if ((m = l.match(/Z(-?[\d.]+)/))) z = +m[1];
    if (!/[XYZ]/.test(l)) continue;
    if (z > 18 + 1e-6 || mode === 0) { flush(); continue; }
    if (z >= 18 - 1e-6 && !cur) continue;
    if (!cur) cur = { T, pts: [[px - dx, py - dy, z]] };
    const rm = l.match(/R(-?[\d.]+)/);
    if ((mode === 2 || mode === 3) && rm) {
      const R = +rm[1]; const ar = Math.abs(R); const ddx = x - px; const ddy = y - py; const d = Math.hypot(ddx, ddy);
      if (d > 1e-9 && ar >= d / 2 - 1e-6) {
        const h = Math.sqrt(Math.max(0, ar * ar - (d * d) / 4)); const sg = ((mode === 3) === (R > 0)) ? 1 : -1;
        const cx = (px + x) / 2 + sg * h * (-ddy / d); const cy = (py + y) / 2 + sg * h * (ddx / d);
        let a0 = Math.atan2(py - cy, px - cx); let a1 = Math.atan2(y - cy, x - cx);
        if (mode === 3) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
        const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * ar) / 0.5));
        for (let i = 1; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; cur.pts.push([cx + ar * Math.cos(a) - dx, cy + ar * Math.sin(a) - dy, z]); }
      }
    }
    cur.pts.push([x - dx, y - dy, z]);
  }
  flush();
  return out.map((p) => {
    const xs = p.pts.map((q) => q[0]); const ys = p.pts.map((q) => q[1]);
    return { T: p.T, zmin: Math.min(...p.pts.map((q) => q[2])), bb: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] };
  });
}

const COLS = [0, 347.5, 695, 1042.5, 1390];
const ROWS = [1850, 1388, 925, 463, 0];
const PANEL = passesOf(ANC);

function panelDoor(model) {
  const r = Math.floor((model - 1) / 4); const c = (model - 1) % 4;
  const X0 = COLS[c]; const Y0 = ROWS[r + 1]; const W = 347.5; const H = ROWS[r] - ROWS[r + 1];
  const passes = passesOf(ANC, X0, Y0).filter((s) => {
    const cx = (s.bb[0] + s.bb[1]) / 2; const cy = (s.bb[2] + s.bb[3]) / 2;
    if (cx < 0 || cx > W || cy < 0 || cy > H) return false;
    // T6 panel grid cuts and the engraved "MODEL N" labels are not part of the door
    if (s.T === 6 && (s.bb[1] - s.bb[0] < 1 || s.bb[3] - s.bb[2] < 1) && (s.bb[0] < 1 || s.bb[1] > W - 1 || s.bb[2] < 1 || s.bb[3] > H - 1)) return false;
    if (model === 4 && s.T === 1 && s.bb[0] > 320 && s.bb[3] < 120) return false; // vertical label
    // The kulp slot (T10 + T11) is a separate job, not part of the presets yet.
    if (model === 4 && (s.T === 10 || s.T === 11)) return false;
    return !(s.T === 1 && s.bb[1] - s.bb[0] < 140 && s.bb[3] < 35 && s.bb[2] > 5);
  });
  return { W, H, passes };
}

const same = (a, b) => a.T === b.T && Math.abs(a.zmin - b.zmin) < 0.06 && a.bb.every((v, i) => Math.abs(v - b.bb[i]) < 0.6);

function compare(model) {
  const { W, H, passes: ref } = panelDoor(model);
  const preset = PRESETS.find((p) => p.name === `${model} NUMARA`);
  const ours = passesOf(buildKapakGcode(W, H, preset).split('\n'));
  const used = new Set(); const missing = [];
  ref.forEach((a) => { const i = ours.findIndex((b, k) => !used.has(k) && same(a, b)); if (i >= 0) used.add(i); else missing.push(a); });
  return { ref, ours, missing, extra: ours.filter((b, k) => !used.has(k)) };
}

describe('TABLA panosu: model 4, 9-14 presetleri ArtCAM yollarıyla eşleşir', () => {
  it('panel parses (sanity)', () => { expect(PANEL.length).toBeGreaterThan(200); });

  for (const model of [4, 10, 11, 12, 13]) {
    it(`model ${model}: every ArtCAM pass has a twin and vice versa`, () => {
      const { ref, missing, extra } = compare(model);
      expect(ref.length).toBeGreaterThan(0);
      expect(missing).toEqual([]);
      expect(extra).toEqual([]);
    });
  }

  it('model 9: all passes match except the plain T12 rectangle ArtCAM cuts separately (our carving pass cuts the same rectangle)', () => {
    const { missing, extra } = compare(9);
    expect(extra).toEqual([]);
    expect(missing).toHaveLength(1);
    expect(missing[0].T).toBe(12);
    expect(missing[0].bb.map((v) => Math.round(v))).toEqual([69, 278, 69, 393]);
  });

  it('model 14: same carved area (passes split where ArtCAM touches the surface without lifting)', () => {
    const { ref, ours, missing, extra } = compare(14);
    const union = (list) => list.reduce((u, s) => [Math.min(u[0], s.bb[0]), Math.max(u[1], s.bb[1]), Math.min(u[2], s.bb[2]), Math.max(u[3], s.bb[3])], [1e9, -1e9, 1e9, -1e9]);
    // the unmatched passes on both sides cover the same area...
    union(missing).forEach((v, i) => expect(Math.abs(v - union(extra)[i])).toBeLessThan(0.6));
    // ...and the whole door is carved to the same depth over the same extent
    union(ref).forEach((v, i) => expect(Math.abs(v - union(ours)[i])).toBeLessThan(0.6));
    expect(Math.min(...ours.map((s) => s.zmin))).toBeCloseTo(Math.min(...ref.map((s) => s.zmin)), 2);
  });
});
