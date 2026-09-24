// _compare_all.mjs
// Üretilen (site motoru) g-code'u numuneler/ altındaki ArtCAM NİHAİ dosyalarla
// tüm 7 model için (292x400) karşılaştır. Model tanımları
// server/scripts/seed-numune-presets.js içindeki NUMUNE_PRESETS'ten gelir.
//
// DİKKAT: bu script METİN TOKEN karşılaştırması yapar, geometri değil. ArtCAM
// modal yazımda değişmeyen ekseni atlar ("G1 Y330.00" tek başına, "X89.00"
// tek başına) ve -0.00 gibi yuvarlama artıklarını korur; bu yüzden geometrik
// olarak birebir olan geçişler bile burada düşük yüzde gösterir.
// GERÇEK doğruluk ölçütü: server/scripts/compare-numuneler-geom.mjs (modal
// durum simülasyonu ile hamle/feed karşılaştırması). 7/7 numune orada eşleşiyor.
// Bu script yalnızca "hangi satırlar hiç görülmemiş" taraması için kullanılır.
import fs from 'fs';
import { buildKapakGcode } from './kapak.js';
import { NUMUNE_PRESETS, toPresetDoc } from '../../../../server/scripts/seed-numune-presets.js';

const base = new URL('../../../..', import.meta.url);
const W = 292, H = 400;

const norm = (s) => s.replace(/\s+/g, '').toUpperCase();
const readCnc = (n) =>
  fs.readFileSync(new URL(`numuneler/${n} NUMARA.cnc`, base), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// Sadece motor (kontrol) satırlarını çıkart, XY(ve Z/F) hareket satırlarını bırak.
const META = /^(MAKRO|M30|M16|M5|M6T\d+|M3S\d+|X0\.00Y0\.00)$/;
const isMotion = (l) => /^(G0|G1|G2|G3|X|Y|Z)/.test(l) && !/^G0Z46\.00$/.test(l);

function motionLines(lines) {
  return lines
    .map(norm)
    .filter((l) => !META.test(l))
    .filter(isMotion)
    .filter((l) => !/^G0Z?46\.00$/.test(l) && l !== 'Z46.00');
}

const summary = [];
for (const def of NUMUNE_PRESETS) {
  const num = def.name.split(' ')[0];
  const doc = toPresetDoc(def);
  const got = buildKapakGcode(W, H, doc).split('\n').map((l) => l.trim()).filter(Boolean);
  const real = readCnc(num);

  const realM = motionLines(real);
  const gotM = motionLines(got);

  const gotSet = new Set(gotM);
  const realSet = new Set(realM);
  const matchedReal = realM.filter((l) => gotSet.has(l));
  const extraGot = gotM.filter((l) => !realSet.has(l));

  const pct = realM.length ? ((matchedReal.length / realM.length) * 100).toFixed(0) : '0';
  const missing = realM.filter((l) => !gotSet.has(l));

  summary.push({ num, name: def.name, realCount: realM.length, gotCount: gotM.length, matched: matchedReal.length, pct, missing, extraGot });
}

console.log('\n================  SITE MOTORU  vs  ARTCAM NİHAİ (292x400)  ================\n');
for (const s of summary) {
  const flag = s.pct >= 100 ? 'TAM' : s.pct >= 70 ? 'YAKIN' : 'FARKLI';
  console.log(`### ${s.name}  [${flag}]  eşleşme=${s.matched}/${s.realCount} (%${s.pct})`);
  console.log(`    motor satır=${s.gotCount}, nihai satır=${s.realCount}`);
  if (s.missing.length) console.log(`    NİHAİ'de olup motorda OLMAYAN (${s.missing.length}): ${s.missing.slice(0, 16).join(' | ')}`);
  if (s.extraGot.length) console.log(`    motorda olup NİHAİ'de OLMAYAN (${s.extraGot.length}): ${s.extraGot.slice(0, 16).join(' | ')}`);
  console.log('');
}

const totReal = summary.reduce((a, s) => a + s.realCount, 0);
const totMatch = summary.reduce((a, s) => a + s.matched, 0);
console.log(`TOPLAM: ${totMatch}/${totReal} (%${((totMatch / totReal) * 100).toFixed(1)})`);
