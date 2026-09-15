// _focus.mjs — odaklanmış doğrulama: 2/3/8/1 NUMARA sapmalarının düzeldiğini ölç.
//   node client/src/lib/gcode/_focus.mjs
import fs from 'fs';
import { buildKapakGcode } from './kapak.js';
import { NUMUNE_PRESETS, toPresetDoc } from '../../../../server/scripts/seed-numune-presets.js';

const base = new URL('../../../..', import.meta.url);
const W = 292, H = 400;
const readCnc = (n) =>
  fs.readFileSync(new URL(`numuneler/${n} NUMARA.cnc`, base), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const norm = (s) => s.replace(/\s+/g, '').toUpperCase();

// Both readCnc(n) and out(n) return NORMALISED lines (whitespace-stripped,
// upper-case) so the regexes below can assume a single canonical form.
function out(num) {
  const def = NUMUNE_PRESETS.find((d) => d.name.startsWith(num));
  return buildKapakGcode(W, H, toPresetDoc(def))
    .split('\n').map((l) => l.trim()).filter(Boolean).map(norm);
}

// --- 1) derz alt başlangıç Y değerleri (G0 X.. Y.. Z.. satırı) ---
console.log('\n=== dikey derz çizgileri: alt başlangıç Y ve üst bitiş Y ===');
for (const n of ['1', '2', '3']) {
  const real = readCnc(n).map(norm);
  const got = out(n).map(norm);
  const pick = (lines) => lines
    .filter((l) => /^G0X/.test(l) && /Y\d/.test(l))
    .map((l) => { const m = l.match(/^G0X(-?[\d.]+)Y(-?[\d.]+)/); return m ? { x: +m[1], y: +m[2] } : null; })
    .filter(Boolean);
  const r = pick(real), g = pick(got);
  const low = (a) => Math.min(...a.map((p) => p.y));
  const high = (a) => Math.max(...a.map((p) => p.y));
  console.log(`  ${n} NUMARA  nihai altY=${low(r).toFixed(2)}  motor altY=${low(g).toFixed(2)}  ` +
    `${low(r).toFixed(2) === low(g).toFixed(2) ? '✓' : '✗'}   (nihai en üst G0 Y=${high(r).toFixed(2)}, motor=${high(g).toFixed(2)})`);
}

// --- 2) derz çizgilerinin bitiş Y'leri (G1 X.. Y.. ) ---
console.log('\n=== dikey derz bitiş Y (G1) ===');
for (const n of ['2', '3']) {
  const ys = (lines) => lines.map((l) => { const m = l.match(/^G1X[\d.]+Y([\d.]+)/); return m ? +m[1] : null; }).filter((v) => v !== null);
  const r = [...new Set(ys(readCnc(n).map(norm)))].sort((a, b) => a - b);
  const g = [...new Set(ys(out(n).map(norm)))].sort((a, b) => a - b);
  const same = r.join(',') === g.join(',');
  console.log(`  ${n} NUMARA  nihai [${r.join(', ')}]  motor [${g.join(', ')}]  ${same ? '✓' : '✗'}`);
}

// --- 3) T6 köşe yayları: yarıçap@merkez (1 NUMARA) ---
console.log('\n=== 1 NUMARA T6 köşe yayları (yarıçap@merkez) ===');
const arcSet = (lines) => {
  const set = new Set();
  for (const s of lines) {
    const m = s.match(/^G[23]X(-?[\d.]+)Y(-?[\d.]+)I(-?[\d.]+)J(-?[\d.]+)/);
    if (!m) continue;
    const [x, y, i, j] = [+m[1], +m[2], +m[3], +m[4]];
    set.add(`R${Math.hypot(i, j).toFixed(2)}@(${(x + i).toFixed(2)},${(y + j).toFixed(2)}):${s.slice(0, 2)}`);
  }
  return set;
};
{
  const r = arcSet(readCnc('1').map(norm));
  const g = arcSet(out('1'));
  const common = [...r].filter((v) => g.has(v));
  console.log(`  nihai ${r.size} yay / motor ${g.size} yay → ortak ${common.length}`);
  console.log(`  nihai : ${[...r].join(' | ')}`);
  console.log(`  motor : ${[...g].join(' | ')}`);
}

// --- 4) 8 NUMARA G2 köşe yayları ---
console.log('\n=== 8 NUMARA T8 köşe yayları (G2, yarıçap@merkez) ===');
{
  const only = (lines) => lines.filter((s) => /^G2/.test(s));
  const r = arcSet(only(readCnc('8').map(norm)));
  const g = arcSet(only(out('8')));
  const common = [...r].filter((v) => g.has(v));
  console.log(`  nihai ${r.size} / motor ${g.size} → ortak ${common.length}  ${common.length === r.size && r.size === g.size ? '✓ TAM' : '✗'}`);
  console.log(`  nihai : ${[...r].join(' | ')}`);
  console.log(`  motor : ${[...g].join(' | ')}`);
}
