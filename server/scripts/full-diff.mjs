// FULL honest diff: generate gcode from each preset (292x400) and compare
// line-by-line against numuneler/*.cnc. Prints the real files and generated
// files side by side for every mismatch.
import fs from 'node:fs';
import { fileStore } from '../store/fileStore.js';
import { buildKapakGcode } from '../../client/src/lib/gcode/kapak.js';

const presets = await fileStore.list();
const list = Array.isArray(presets) ? presets : presets.presets || [];
const names = ['1 NUMARA', '2 NUMARA', '3 NUMARA', '5 NUMARA', '6 NUMARA', '7 NUMARA', '8 NUMARA'];

function norm(lines) {
  return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function tokens(l) {
  return (l.match(/[A-Za-z][-+]?[0-9]+(\.[0-9]+)?|[A-Za-z]+/g) || []).map((t) => {
    // -0.00 == 0.00 (ArtCAM'in isaretli sifiri yuvarlama artikari)
    if (/^-?[0-9]/.test(t)) { const v = parseFloat(t); return String(Object.is(v, -0) || v === 0 ? 0 : v); }
    return t.toUpperCase();
  });
}

for (const name of names) {
  const p = list.find((x) => x.name === name);
  if (!p) { console.log(`\n##### ${name}: PRESET YOK`); continue; }
  const w = p.width || p.previewWidth || 292;
  const h = p.height || p.previewHeight || 400;
  const gen = norm(buildKapakGcode(w, h, p).split('\n'));
  const real = norm(fs.readFileSync(new URL(`../../numuneler/${name}.cnc`, import.meta.url), 'utf8').split('\n'));

  const realSet = new Map();
  real.forEach((l, i) => { const k = tokens(l).join(','); if (!realSet.has(k)) realSet.set(k, i + 1); });
  const genSet = new Map();
  gen.forEach((l, i) => { const k = tokens(l).join(','); if (!genSet.has(k)) genSet.set(k, i + 1); });

  const onlyGen = [], onlyReal = [];
  for (const l of gen) {
    const k = tokens(l).join(',');
    if (!realSet.has(k)) onlyGen.push(l);
  }
  for (const l of real) {
    const k = tokens(l).join(',');
    if (!genSet.has(k)) onlyReal.push(l);
  }

  console.log(`\n##### ${name} (${w}x${h}) — üretilen ${gen.length} satır / gerçek ${real.length} satır`);
  console.log(`-- sadece ÜRETİLENE özgü (${onlyGen.length}):`);
  onlyGen.forEach((l) => console.log('   G: ' + l));
  console.log(`-- sadece GERÇEK dosyada olan (${onlyReal.length}):`);
  onlyReal.forEach((l) => console.log('   R: ' + l));

  // Order check for the shared lines
  const sGen = [...new Set(gen.map((l) => tokens(l).join(',')).filter((k) => realSet.has(k)))];
  const sReal = [...new Set(real.map((l) => tokens(l).join(',')).filter((k) => genSet.has(k)))];
  let orderOk = sGen.length === sReal.length;
  if (orderOk) for (let i = 0; i < sGen.length; i++) { if (sGen[i] !== sReal[i]) { orderOk = false; console.log(`   SIRA FARKI @${i}: G:${sGen[i]}  R:${sReal[i]}`); break; } }
  console.log(`   ortak satır sırası: ${orderOk ? 'AYNI' : 'FARKLI'}`);
}
