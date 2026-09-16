// _g3.mjs — 2 NUMARA üretilen G3 (kemer) satırları ve derz alt Y'si.
import { buildKapakGcode, computeTopCurve } from './kapak.js';
import { NUMUNE_PRESETS, toPresetDoc } from '../../../../server/scripts/seed-numune-presets.js';

const def = NUMUNE_PRESETS.find((d) => d.name === '2 NUMARA');
const gcode = buildKapakGcode(292, 400, toPresetDoc(def));
const lines = gcode.split('\n').map((l) => l.trim());

console.log('--- Üretilen G3 (kemer) satırları ---');
for (const l of lines) {
  if (!/^G3/.test(l)) continue;
  const m = l.match(/^G3 X(-?[\d.]+) Y(-?[\d.]+) I(-?[\d.]+) J(-?[\d.]+)/);
  if (!m) { console.log('  ' + l); continue; }
  const sx = +m[1], sy = +m[2], i = +m[3], j = +m[4];
  console.log('  start=(' + sx + ',' + sy + ') I=' + i + ' J=' + j + ' R=' + Math.hypot(i, j).toFixed(2) + ' merkez=(' + (sx + i) + ',' + (sy + j) + ')');
}

console.log('\n--- REFERANS (2 NUMARA.cnc) ---');
console.log('  G1 X232.00 / Y254.00  -> yay başlangıcı (232,254)');
console.log('  G3 X146 Y340 I-86 J0   -> R=86  merkez=(232-86,254-0)=(146,254)');
console.log('  G3 X60 Y254 I0 J-86    -> R=86  merkez=(146+0,340-86)=(146,254)  AYNI MERKEZ ✓');

console.log('\n--- derz blokları ---');
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^G0 X(-?[\d.]+) Y(-?[\d.]+) Z/);
  if (!m) continue;
  if (!/^G1\s+Z/.test(lines[i + 1] || '')) continue;
  const mc = (lines[i + 2] || '').match(/^G1 X(-?[\d.]+) Y(-?[\d.]+)/);
  if (!mc) continue;
  console.log('  G0 X' + m[1] + ' Y' + m[2] + ' -> G1 X' + mc[1] + ' Y' + mc[2] + '   (alt=' + m[2] + ' üst=' + mc[2] + ')');
}
console.log('  REFERANS: alt=60.00');

console.log('\n--- curve(60,232,340,semicircle) ---');
const c = computeTopCurve(60, 232, 340, 'semicircle');
console.log('  xc=' + c.xc + ' yc=' + c.yc + ' r=' + c.r + ' yt=' + c.yt + ' innerW=' + c.innerW);
