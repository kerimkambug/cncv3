// Geometric comparison: simulate modal state (G0/G1, X/Y/Z, feed) for generated
// and real files, then compare the cutting-path point sequences. Handles modal
// omission, line splits, signed zeros and feed repetition — only real geometry
// differences show up.
import fs from 'node:fs';
import { fileStore } from '../store/fileStore.js';
import { buildKapakGcode } from '../../client/src/lib/gcode/kapak.js';

function num(s) { const v = parseFloat(s); return Object.is(v, -0) ? 0 : v; }

/** Parse g-code into a list of moves: {g, x, y, z, feed}. */
function parse(text) {
  const moves = [];
  let g = 0, x = 0, y = 0, z = 0, feed = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || /^(makro|M5|M16|M30|M3|M6)/i.test(line)) continue;
    const gm = line.match(/^G([0-3])/i);
    if (gm) g = parseInt(gm[1], 10);
    const xm = line.match(/X(-?[\d.]+)/i), ym = line.match(/Y(-?[\d.]+)/i), zm = line.match(/Z(-?[\d.]+)/i), fm = line.match(/F(-?[\d.]+)/i);
    if (fm) feed = num(fm[1]);
    const nx = xm ? num(xm[1]) : x, ny = ym ? num(ym[1]) : y, nz = zm ? num(zm[1]) : z;
    const moved = xm || ym || zm;
    if (moved && (g === 1)) moves.push({ g, x: nx, y: ny, z: nz, feed });
    if (moved) { x = nx; y = ny; z = nz; }
  }
  return moves;
}

function cmp(a, b, tol = 0.02) {
  if (a.length !== b.length) return `hamle sayısı farklı: ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    for (const k of ['x', 'y', 'z']) {
      if (Math.abs(a[i][k] - b[i][k]) > tol) return `hamle ${i + 1}: ${k.toUpperCase()} ${a[i][k]} vs ${b[i][k]}`;
    }
    const af = a[i].feed ?? a[0].feed, bf = b[i].feed ?? b[0].feed;
    if (af != null && bf != null && Math.abs(af - bf) > 0.01) return `hamle ${i + 1}: F ${af} vs ${bf}`;
  }
  return null;
}

const presets = await fileStore.list();
const list = Array.isArray(presets) ? presets : presets.presets || [];
const names = ['1 NUMARA', '2 NUMARA', '3 NUMARA', '5 NUMARA', '6 NUMARA', '7 NUMARA', '8 NUMARA'];

let okAll = true;
for (const name of names) {
  const p = list.find((x) => x.name === name);
  if (!p) { console.log(`${name}: PRESET YOK`); okAll = false; continue; }
  const w = p.width || p.previewWidth || 292;
  const h = p.height || p.previewHeight || 400;
  let genText;
  try { genText = buildKapakGcode(w, h, p); } catch (e) { console.log(`${name}: ÜRETİM HATASI ${e.message}`); okAll = false; continue; }
  const realText = fs.readFileSync(new URL(`../../numuneler/${name}.cnc`, import.meta.url), 'utf8');
  const gm = parse(genText), rm = parse(realText);
  if (process.argv.includes('--moves')) {
    console.log(`--- ${name} GERÇEK (${rm.length}) ---`); rm.forEach((m, i) => console.log(i + ' ' + JSON.stringify(m)));
    console.log(`--- ${name} ÜRETİLEN (${gm.length}) ---`); gm.forEach((m, i) => console.log(i + ' ' + JSON.stringify(m)));
    continue;
  }
  const diff = cmp(gm, rm);
  if (diff) { console.log(`❌ ${name}: ${diff} (üretilen ${gm.length} hamle, gerçek ${rm.length} hamle)`); okAll = false; }
  else console.log(`✅ ${name}: GEOMETRİK EŞLEŞME (${gm.length} kesim hamlesi, feed dahil)`);
}
console.log(okAll ? '\nTÜM NUMUNELER GEOMETRİK OLARAK EŞLEŞİYOR' : '\nFARKLAR VAR — yukarıya bak');
