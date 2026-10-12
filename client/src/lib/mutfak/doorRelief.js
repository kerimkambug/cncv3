// The surface of a real door for the kitchen preview: the model's own program
// for the door's size is cut into a virtual sheet (the same simulation as
// "Simüle et"), and the result becomes two textures for the door front:
//   normal — the slopes of every groove, profile and pocket (lighting)
//   shade  — darker where the cut is deeper (ambient occlusion)
import { buildKapakGcode } from '../gcode/kapak.js';
import { generatePanjurGcode, panjurSimTools } from '../gcode/panjur.js';
import { simulate } from '../sim/millSim.js';
import { buildKulpLines } from '../gcode/kulp.js';

/** The Panjur screen's own defaults (T14 conical ball raster, 40.5 mm slats, 60 mm frame). */
export const PANJUR = {
  offset: 60, offsetMode: 'normal', offsetLeft: 60, offsetRight: 60, offsetBottom: 60, offsetTop: 60, centerFlat: 0,
  direction: 'y', pitch: 40.5, exitGap: 0.45, stepover: 0.468, edgeInset: 'auto', t14TipDia: 3, t14BodyDia: 8, t14Height: 30,
  startZ: 17.937, endZ: 3.105, feed: 20000, plunge: 3000, toolNo: '14', spindle: 12000, groundEntry: false, exitCut: 4,
  t4Step: 6, t4Extend: 0, t4Feed: 5000, drillTool: '4', drillSpindle: 12000, exitToolDia: 4, safeZ: 30, toolChangeZ: 30, homeZ: 30,
};

/**
 * @param {object} preset  kapak model (rows, thickness, offsetMode, topStyle…)
 * @param {number} w       door width (mm)
 * @param {number} h       door height (mm)
 * @param {object} [tools] simulation tools (the workshop magazine)
 * @param {{edge:string, settings:object}|null} [kulp] a hidden kulp the whole length of that edge
 * @returns {{w:number, h:number, normal:Uint8Array, shade:Uint8Array} | null}  null: the model does not fit this door
 */
export function doorRelief(preset, w, h, tools = {}, kulp = null) {
  if (!preset || (!preset.panjur && (!Array.isArray(preset.rows) || !preset.rows.length))) return null;
  const top = Number(preset.thickness) || 18;
  let gcode;
  try {
    if (preset.panjur) {
      const pc = { ...PANJUR, ...preset.panjur, width: w, height: h };
      gcode = generatePanjurGcode(pc).gcode;
      tools = { ...tools, ...panjurSimTools(pc) }; // the panjur's own relief bit
    } else gcode = buildKapakGcode(w, h, preset);
  } catch { return null; }
  // the hidden kulp, cut as on a single door (the kulp bit goes down beside it)
  if (kulp && kulp.edge) {
    gcode += `\n${buildKulpLines([{ x: 0, y: 0, w, h, kulps: [{ edge: kulp.edge, mode: 'full' }] }], kulp.settings, 30, { top }).join('\n')}`;
  }
  // ~0.8 mm per pixel, coarser on big doors (≤ ~600k pixels)
  const cell = Math.max(0.8, Math.sqrt((w * h) / 6e5));
  const { grid } = simulate(gcode, { top, cell, box: { x0: 0, y0: 0, x1: w, y1: h }, tools });
  const { w: gw, h: gh } = grid;
  // a light blur (~1 mm) so a groove narrower than a screen pixel does not break
  // up into moiré when the door is seen from across the room
  const z = blur(blur(grid.z, gw, gh), gw, gh);
  const normal = new Uint8Array(gw * gh * 4), shade = new Uint8Array(gw * gh * 4);
  const at = (i, j) => z[Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))];
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      let dx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell), dy = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
      // steep walls (a pointed bit's flank) are capped at ~60°: still read as an edge, no harsh flicker
      const sl = Math.hypot(dx, dy), cap = sl > 1.7 ? 1.7 / sl : 1;
      dx *= cap; dy *= cap;
      const l = Math.hypot(dx, dy, 1), k = (j * gw + i) * 4;
      normal[k] = ((-dx / l) * 0.5 + 0.5) * 255;
      normal[k + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      normal[k + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      normal[k + 3] = 255;
      const depth = Math.max(0, top - at(i, j));
      const v = 255 * (1 - Math.min(0.5, depth * 0.05));
      shade[k] = shade[k + 1] = shade[k + 2] = v; shade[k + 3] = 255;
    }
  }
  return { w: gw, h: gh, normal, shade };
}

/** 3×3 box blur of a height grid (edges clamp). */
function blur(src, w, h) {
  const out = new Float32Array(src.length);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let sum = 0;
      for (let b = -1; b <= 1; b++) {
        const jj = Math.min(h - 1, Math.max(0, j + b)) * w;
        for (let a = -1; a <= 1; a++) sum += src[jj + Math.min(w - 1, Math.max(0, i + a))];
      }
      out[j * w + i] = sum / 9;
    }
  }
  return out;
}
