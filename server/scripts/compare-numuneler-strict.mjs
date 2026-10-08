// compare-numuneler-strict.mjs
//
// STRICT numune karşılaştırma: üretilen g-code ile numuneler/*.cnc dosyasının
// HER satırı birebir karşılaştırılır (satır sayısı + satır sırası + içerik).
// TEK BİR SATIR bile farklıysa o numune FAIL olur ve program exit code 1 ile çıkar.
//
// Geometrik test (compare-numuneler-geom.mjs) bu testin YERİNİ TUTMAZ;
// bu script ana doğruluk ölçütüdür.
//
//   node server/scripts/compare-numuneler-strict.mjs
//
// Satır normalizasyonu (yalnızca boşluk/case):
//   - satır içi whitespace -> tek boşluk, baş/son boşluk atılır
//   - büyük/küçük harf duyarsız
// Koordinat değerleri, G/M kodları, I/J, F, satır sırası — hepsi birebir olmalı.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildKapakGcode } from '../../client/src/lib/gcode/kapak.js';
import { NUMUNE_PRESETS, toPresetDoc } from './seed-numune-presets.js';

// ArtCAM writes a signed epsilon where an arc offset is exactly zero ("I-0.00");
// the sign is not reproducible and means nothing to the machine, so -0.00 == 0.00
// (the same rule as client/src/lib/gcode/artcam.test.js).
const norm = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase().replace(/-0\.00(?![0-9])/g, '0.00');

// Only models that HAVE a final ArtCAM file (numuneler/N NUMARA.cnc) can be
// compared; 4 and 9-14 come from the TABLA panel (see client tabla.test.js).
const refFile = (name) => fileURLToPath(new URL(`../../numuneler/${name}.cnc`, import.meta.url));
const NAMES = NUMUNE_PRESETS.map((d) => d.name).filter((name) => fs.existsSync(refFile(name)));
// A frozen numuneler/artcam/modelN.preset.json wins over the live preset: the
// shop may evolve a recipe (1 NUMARA: carving 56 -> 63) while this check keeps
// proving the generator reproduces the ArtCAM job (same rule as artcam.test.js).
const frozenPreset = (name) => {
  const f = fileURLToPath(new URL(`../../numuneler/artcam/model${parseInt(name, 10)}.preset.json`, import.meta.url));
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};

let passCount = 0;
const failures = [];
const detail = process.argv.includes('--detail');

for (const name of NAMES) {
  const def = NUMUNE_PRESETS.find((d) => d.name === name);
  const frozen = frozenPreset(name);
  const doc = frozen || toPresetDoc(def);
  const w = frozen ? frozen.previewWidth : def.width;
  const h = frozen ? frozen.previewHeight : def.height;

  let genText;
  try {
    genText = buildKapakGcode(w, h, doc);
  } catch (e) {
    failures.push({ name, reason: `ÜRETİM HATASI: ${e.message}` });
    continue;
  }

  const realRaw = fs.readFileSync(
    fileURLToPath(new URL(`../../numuneler/${name}.cnc`, import.meta.url)),
    'utf8'
  );
  const gen = genText.split(/\r?\n/).map(norm).filter(Boolean);
  const ref = realRaw.split(/\r?\n/).map(norm).filter(Boolean);

  // Index-aligned diff: pad the shorter list with nulls so extra lines also show.
  const maxLen = Math.max(gen.length, ref.length);
  const allDiffs = [];
  for (let i = 0; i < maxLen; i++) {
    const r = i < ref.length ? ref[i] : '(YOK — referans daha kısa)';
    const g = i < gen.length ? gen[i] : '(YOK — üretilen daha kısa)';
    if (r !== g) allDiffs.push({ i, r, g });
  }

  if (allDiffs.length > 0) {
    const d0 = allDiffs[0];
    const countNote = gen.length !== ref.length
      ? `satır sayısı farklı — referans ${ref.length}, üretilen ${gen.length}`
      : `satır sayıları eşit (${ref.length})`;
    failures.push({
      name,
      reason: `${countNote}, ilk fark satır ${d0.i + 1}`,
      firstDiff: { line: d0.i + 1, ref: d0.r, gen: d0.g },
      allDiffs,
    });
    continue;
  }
  passCount++;
}

console.log('========================================');
console.log(' STRICT NUMUNE G-CODE TEST (birebir)');
console.log('========================================\n');

for (const f of failures) {
  console.log(`${f.name}`);
  console.log(`  ❌ FAIL — ${f.reason}`);
  if (f.firstDiff) {
    console.log(`  İLK FARK — satır ${f.firstDiff.line}:`);
    console.log(`    REFERANS : ${f.firstDiff.ref}`);
    console.log(`    ÜRETİLEN : ${f.firstDiff.gen}`);
  }
  if (f.allDiffs && detail) {
    console.log(`  TOPLAM ${f.allDiffs.length} satır fark:`);
    f.allDiffs.forEach((d) => {
      console.log(`    satır ${d.i + 1}:`);
      console.log(`      REFERANS : ${d.r}`);
      console.log(`      ÜRETİLEN : ${d.g}`);
    });
  }
  console.log('');
}
for (const name of NAMES) {
  if (!failures.some((f) => f.name === name)) console.log(`${name}\n  ✅ PASS — ${''}birebir aynı\n`);
}

console.log('========================================');
console.log(`SONUÇ: ${passCount}/${NAMES.length} NUMUNE BİREBİR EŞLEŞTİ`);
console.log('========================================');

process.exit(failures.length === 0 ? 0 : 1);
