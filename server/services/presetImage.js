// The picture of a kapak model: its program for a 300 × 400 mm door is cut into
// a virtual sheet by the simulation (with the workshop's tools) and the machined
// result is rendered from above, lit from the upper left. Used by the CLI script
// (server/scripts/render-preset-images.mjs) and by the site's "Görselleri yenile".
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = (p) => import(pathToFileURL(path.join(here, '../../client/src/lib', p)).href);
const { buildKapakGcode } = await lib('gcode/kapak.js');
const { simulate } = await lib('sim/millSim.js');
const { normalizeMagazine, toSimTools } = await lib('sim/toolMagazine.js');

const DOOR_W = 300, DOOR_H = 400; // mm
const IMG_W = 300, IMG_H = 400; // px (the gallery cards are 3:4)

/** Simulation tools from a stored tool list (Atölye → Bıçaklar); none = built-in table. */
export function simToolsFrom(magazine) {
  return magazine ? toSimTools(normalizeMagazine(magazine)) : {};
}

/**
 * @returns {{dataUrl:string, cuttingMm:number} | null}  null: the model does not fit a 300 × 400 door
 */
export function renderPresetImage(preset, tools = {}) {
  const top = Number(preset.thickness) || 18;
  let gcode;
  try { gcode = buildKapakGcode(DOOR_W, DOOR_H, preset); } catch { return null; }
  const { grid, stats } = simulate(gcode, { top, cell: 0.25, box: { x0: -2, y0: -2, x1: DOOR_W + 2, y1: DOOR_H + 2 }, tools });
  return { dataUrl: pngDataUrl(IMG_W, IMG_H, render(grid, top)), cuttingMm: stats.cuttingMm };
}

function pngDataUrl(w, h, rgb) {
  const T = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let x = 0xffffffff; for (const v of b) x = T[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** Top view of the machined door, shaded by its surface normal (supersampled 2×). */
function render(grid, top) {
  const { w, h, z, cell } = grid;
  const pad = 14; // px border around the door
  const sx = (IMG_W - 2 * pad) / DOOR_W, sy = (IMG_H - 2 * pad) / DOOR_H;
  const s = Math.min(sx, sy);
  const ox = (IMG_W - DOOR_W * s) / 2, oy = (IMG_H - DOOR_H * s) / 2;
  const L = [-0.55, 0.5, 0.67]; const Ln = Math.hypot(...L); L.forEach((v, i) => { L[i] = v / Ln; });
  const zAt = (x, y) => {
    const i = Math.min(w - 2, Math.max(1, Math.floor((x - grid.x0) / cell))), j = Math.min(h - 2, Math.max(1, Math.floor((y - grid.y0) / cell)));
    return [i, j];
  };
  const rgb = Buffer.alloc(IMG_W * IMG_H * 3);
  const SS = 2;
  for (let py = 0; py < IMG_H; py++) for (let px = 0; px < IMG_W; px++) {
    let r = 0, g = 0, b = 0;
    for (let a = 0; a < SS; a++) for (let c = 0; c < SS; c++) {
      const x = (px + (a + 0.5) / SS - ox) / s, y = DOOR_H - (py + (c + 0.5) / SS - oy) / s;
      if (x < 0 || y < 0 || x > DOOR_W || y > DOOR_H) { r += 29; g += 33; b += 43; continue; }
      const [i, j] = zAt(x, y);
      const k = j * w + i;
      const nx = -(z[k + 1] - z[k - 1]) / (2 * cell), ny = -(z[k + w] - z[k - w]) / (2 * cell);
      const nl = Math.hypot(nx, ny, 1);
      const lam = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / nl);
      const depth = Math.min(1, (top - z[k]) / 12);
      const v = 0.3 + 0.78 * lam - 0.12 * depth;
      r += Math.min(255, 236 * v); g += Math.min(255, 226 * v); b += Math.min(255, 208 * v);
    }
    const o = (py * IMG_W + px) * 3;
    rgb[o] = r / (SS * SS); rgb[o + 1] = g / (SS * SS); rgb[o + 2] = b / (SS * SS);
  }
  // a thin edge line around the door
  for (let px = Math.round(ox); px <= Math.round(ox + DOOR_W * s); px++) for (const py of [Math.round(oy), Math.round(oy + DOOR_H * s)]) {
    const o = (Math.min(IMG_H - 1, py) * IMG_W + Math.min(IMG_W - 1, px)) * 3; rgb[o] = 120; rgb[o + 1] = 104; rgb[o + 2] = 84;
  }
  for (let py = Math.round(oy); py <= Math.round(oy + DOOR_H * s); py++) for (const px of [Math.round(ox), Math.round(ox + DOOR_W * s)]) {
    const o = (Math.min(IMG_H - 1, py) * IMG_W + Math.min(IMG_W - 1, px)) * 3; rgb[o] = 120; rgb[o + 1] = 104; rgb[o + 2] = 84;
  }
  return rgb;
}
