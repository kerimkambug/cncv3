// Compare generated g-code for every numune preset against numuneler/*.cnc
import fs from 'node:fs';
import { fileStore } from '../store/fileStore.js';
import { buildKapakGcode } from '../../client/src/lib/gcode/kapak.js';

function tokens(l) {
  return (l.match(/[A-Za-z][-+]?[0-9]+(\.[0-9]+)?|[A-Za-z]+/g) || []).map((t) =>
    /^-?[0-9]/.test(t) ? t : t.toUpperCase()
  );
}

const presets = await fileStore.list();
const list = Array.isArray(presets) ? presets : presets.presets || [];
const names = ['1 NUMARA', '2 NUMARA', '3 NUMARA', '5 NUMARA', '6 NUMARA', '7 NUMARA', '8 NUMARA'];

for (const name of names) {
  const p = list.find((x) => x.name === name);
  if (!p) { console.log(`\n=== ${name}: PRESET YOK ===`); continue; }
  const w = p.width || p.previewWidth || 292;
  const h = p.height || p.previewHeight || 400;
  let gcode;
  try { gcode = buildKapakGcode(w, h, p); } catch (e) { console.log(`\n=== ${name}: HATA ${e.message} ===`); continue; }
  const gen = gcode.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const real = fs.readFileSync(new URL(`../../numuneler/${name}.cnc`, import.meta.url), 'utf8');
  const ref = real.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const refKey = new Map(ref.map((l, i) => [tokens(l).join(','), i]));
  let matched = 0;
  const unmatched = [];
  for (const l of gen) (refKey.has(tokens(l).join(',')) ? matched++ : unmatched.push(l));
  console.log(`\n=== ${name} (${w}x${h}) — üretilen ${gen.length} satır, gerçek ${ref.length}, birebir: ${matched}/${gen.length} ===`);
  unmatched.forEach((l) => console.log('  ÜRETİLEN: ' + l));
}
