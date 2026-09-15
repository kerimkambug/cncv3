// _rapor_karsilastirma.mjs
// Site motor (kapak.js) vs ArtCAM "NİHAİ" .cnc referansları — 292x400.
// Başlıklı rapor: başlangıç/bitiş blokları, bounding box, Z derinlikleri,
// G02/G03 yay farkları. Presetler server/scripts/seed-numune-presets.js'ten.
//
// Çalıştırma:  node client/src/lib/gcode/_rapor_karsilastirma.mjs
import fs from 'fs';
import { buildKapakGcode } from './kapak.js';
import { NUMUNE_PRESETS, toPresetDoc } from '../../../../server/scripts/seed-numune-presets.js';

const base = new URL('../../../..', import.meta.url);
const W = 292, H = 400;

const norm = (s) => s.replace(/\s+/g, '').toUpperCase();
const readCnc = (n) =>
  fs.readFileSync(new URL(`numuneler/${n} NUMARA.cnc`, base), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// --- Yardımcılar ---
const isMotion = (s) => /^(G0|G1|G2|G3|X|Y|Z)/.test(s);

// Bounding box: hareket satırlarındaki X/Y değerlerinden
function bbox(lines) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const raw of lines) {
    const s = norm(raw);
    const mx = s.match(/X(-?\d+(?:\.\d+)?)/);
    const my = s.match(/Y(-?\d+(?:\.\d+)?)/);
    if (mx) { const v = +mx[1]; minX = Math.min(minX, v); maxX = Math.max(maxX, v); }
    if (my) { const v = +my[1]; minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
  }
  const f = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
  return { minX: f(minX), maxX: f(maxX), minY: f(minY), maxY: f(maxY) };
}

// Z değerleri: tüm Z geçişleri (dalma derinlikleri + güvenli seviye)
function zValues(lines) {
  const zs = new Set();
  for (const raw of lines) {
    const s = norm(raw);
    const mz = s.match(/Z(-?\d+(?:\.\d+)?)/);
    if (mz) zs.add((+mz[1]).toFixed(2));
  }
  return [...zs].sort((a, b) => +b - +a); // büyükten küçüğe (güvenli -> derin)
}

// G02/G03 yay özeti: tip + yarıçap@merkez
function arcs(lines) {
  const out = [];
  for (const raw of lines) {
    const s = norm(raw);
    const m = s.match(/^(G[23])X(-?[\d.]+)Y(-?[\d.]+)I(-?[\d.]+)J(-?[\d.]+)/);
    if (m) {
      const x = +m[2], y = +m[3], i = +m[4], j = +m[5];
      out.push({ type: m[1], r: +Math.hypot(i, j).toFixed(2), cx: +(x + i).toFixed(2), cy: +(y + j).toFixed(2) });
    }
  }
  return out;
}

// Kontrol blokları: T (takım), S (devir), G90/G21, bitiş kodları
function blocks(lines) {
  const tools = [], spindles = [];
  let hasG90 = false, hasG21 = false;
  const enders = new Set();
  for (const raw of lines) {
    const s = norm(raw);
    if (/^M6T\d+/.test(s)) tools.push(s);
    if (/^(?:G\d)?M3S\d+/.test(s)) spindles.push(s);
    if (/^G90/.test(s)) hasG90 = true;
    if (/^G21/.test(s)) hasG21 = true;
    for (const e of ['M30', 'M16', 'M5', 'M6T1']) if (s.includes(e)) enders.add(e);
  }
  return { tools: [...new Set(tools)], spindles: [...new Set(spindles)], hasG90, hasG21, hasEnd: enders.has('M30') };
}

// Metin düzeyi yay/çizgi farkı (basit)
function kindCount(lines) {
  let g0 = 0, g1 = 0, g2 = 0, g3 = 0;
  for (const raw of lines) {
    const s = norm(raw);
    if (/^G0\b/.test(s)) g0++;
    else if (/^G1\b/.test(s)) g1++;
    else if (/^G2/.test(s)) g2++;
    else if (/^G3/.test(s)) g3++;
  }
  return { g0, g1, g2, g3 };
}

const eq = (a, b) => a.toFixed(2) === b.toFixed(2);

// ============================================================
//  HAM DÖKÜM MODU: -raw  verilirse, her model için referans ve
//  üretilen G-code'un TAM içeriğini alt alta bir txt dosyasına yazar.
//  Kullanım:  node _rapor_karsilastirma.mjs --raw [cikti.txt]
// ============================================================
const argv = process.argv.slice(2);
const rawMode = argv.includes('--raw');

if (rawMode) {
  const outArg = argv.find((a) => a !== '--raw');
  const projRoot = new URL('../../../..', import.meta.url); // proj/ kökü
  const outPath = outArg
    ? new URL(outArg.replace(/\\/g, '/'), projRoot)
    : new URL('karsilastirma-ham-veri.txt', projRoot);
  const chunks = [];
  chunks.push('='.repeat(78));
  chunks.push('  HAM VERİ — numuneler/ referansları  vs  site motoru üretimi (292x400)');
  chunks.push('='.repeat(78));
  for (const def of NUMUNE_PRESETS) {
    const num = def.name.split(' ')[0];
    const real = readCnc(num);
    const got = buildKapakGcode(W, H, toPresetDoc(def)).split('\n');
    chunks.push('');
    chunks.push('#'.repeat(78));
    chunks.push(`#  ${def.name}   (topStyle=${def.cfg.topStyle})`);
    chunks.push('#'.repeat(78));
    chunks.push('');
    chunks.push(`----- nihai${num}  (numuneler/${num} NUMARA.cnc) -----`);
    chunks.push(...real);
    chunks.push('');
    chunks.push(`----- uretilen${num}  (site motoru cikti) -----`);
    chunks.push(...got);
    chunks.push('');
  }
  chunks.push('='.repeat(78));
  fs.writeFileSync(outPath, chunks.join('\n'), 'utf8');
  console.log(`Ham veri yazildi: ${outPath.pathname || outPath}`);
  process.exit(0);
}

console.log('\n' + '='.repeat(78));
console.log('  KARŞILAŞTIRMA RAPORU — SİTE MOTORU vs ARTCAM NİHAİ  (292 x 400 mm)');
console.log('='.repeat(78));

for (const def of NUMUNE_PRESETS) {
  const num = def.name.split(' ')[0];
  const doc = toPresetDoc(def);
  const real = readCnc(num);
  const got = buildKapakGcode(W, H, doc).split('\n').map((l) => l.trim()).filter(Boolean);

  const rb = blocks(real), gb = blocks(got);
  const rbb = bbox(real), gbb = bbox(got);
  const rz = zValues(real), gz = zValues(got);
  const ra = arcs(real), ga = arcs(got);
  const rk = kindCount(real), gk = kindCount(got);

  console.log('\n' + '-'.repeat(78));
  console.log(`## ${def.name}   (topStyle=${def.cfg.topStyle}, ${def.cfg.rows.length} işlem satırı)`);
  console.log('-'.repeat(78));

  // 1) Başlangıç / bitiş blokları
  console.log('  [1] BAŞLANGIÇ / BİTİŞ BLOKLARI');
  console.log(`      Başlık        : nihai "${real[0]}"  |  motor "${got[0]}"`);
  console.log(`      Takım (M6T)   : nihai [${rb.tools.join(', ')}]  |  motor [${gb.tools.join(', ')}]  ${rb.tools.join()===gb.tools.join() ? '✓' : '✗'}`);
  console.log(`      Devir (S)     : nihai [${rb.spindles.join(', ')}]  |  motor [${gb.spindles.join(', ')}]  ${rb.spindles.join()===gb.spindles.join() ? '✓' : '✗'}`);
  console.log(`      G90/G21       : nihai G90=${rb.hasG90} G21=${rb.hasG21}  |  motor G90=${gb.hasG90} G21=${gb.hasG21}  ${(rb.hasG90===gb.hasG90 && rb.hasG21===gb.hasG21) ? '✓' : '✗'}`);
  console.log(`      M30 (bitiş)   : nihai ${rb.hasEnd ? '✓' : '✗'}  |  motor ${gb.hasEnd ? '✓' : '✗'}  ${rb.hasEnd===gb.hasEnd ? '✓' : '✗'}`);

  // 2) Geometri / bounding box
  console.log('  [2] GEOMETRİ ve KOORDİNAT SINIRLARI (bounding box)');
  console.log(`      X aralığı     : nihai ${rbb.minX} .. ${rbb.maxX}   |  motor ${gbb.minX} .. ${gbb.maxX}   ${(eq(+rbb.minX,+gbb.minX)&&eq(+rbb.maxX,+gbb.maxX)) ? '✓' : '✗'}`);
  console.log(`      Y aralığı     : nihai ${rbb.minY} .. ${rbb.maxY}   |  motor ${gbb.minY} .. ${gbb.maxY}   ${(eq(+rbb.minY,+gbb.minY)&&eq(+rbb.maxY,+gbb.maxY)) ? '✓' : '✗'}`);
  const realArcsF = ra.map(a=>`R${a.r}@(${a.cx},${a.cy})`), gotArcsF = ga.map(a=>`R${a.r}@(${a.cx},${a.cy})`);
  const rset = new Set(realArcsF), gset = new Set(gotArcsF);
  const arcCommon = [...gset].filter(x=>rset.has(x)).length;
  console.log(`      Yay geo       : nihai ${ra.length} / motor ${ga.length} → aynı(yarıçap@merkez) ${arcCommon}`);
  console.log(`      Nihai R'ler   : [${[...new Set(ra.map(a=>a.r))].join(', ') || '-'}]  |  Motor R'ler: [${[...new Set(ga.map(a=>a.r))].join(', ') || '-'}]`);

  // 3) Z derinlikleri
  console.log('  [3] Z DERİNLİKLERİ ve GEÇİŞLER');
  console.log(`      Nihai Z seviyeleri : [${rz.join(', ')}]`);
  console.log(`      Motor Z seviyeleri : [${gz.join(', ')}]`);
  console.log(`      Güvenli Z (max)    : nihai ${rz[0] ?? '-'}  |  motor ${gz[0] ?? '-'}   ${eq(+rz[0],+gz[0]) ? '✓' : '✗'}`);
  console.log(`      En derin Z (min)   : nihai ${rz[rz.length-1] ?? '-'}  |  motor ${gz[gz.length-1] ?? '-'}   ${eq(+rz[rz.length-1],+gz[gz.length-1]) ? '✓' : '✗'}`);

  // 4) Farklar / sapmalar
  console.log('  [4] FARKLAR / SAPMALAR');
  console.log(`      Hareket türü  : nihai G0=${rk.g0} G1=${rk.g1} G2=${rk.g2} G3=${rk.g3}  |  motor G0=${gk.g0} G1=${gk.g1} G2=${gk.g2} G3=${gk.g3}`);
  const missingArcs = [...rset].filter(x=>!gset.has(x));
  const extraArcs = [...gset].filter(x=>!rset.has(x));
  if (missingArcs.length) console.log(`      Nihai'de olup motorda OLMAYAN yay (${missingArcs.length}): ${missingArcs.slice(0,6).join(' | ')}`);
  if (extraArcs.length)   console.log(`      Motorda olup nihai'de OLMAYAN yay (${extraArcs.length}): ${extraArcs.slice(0,6).join(' | ')}`);
  if (!missingArcs.length && !extraArcs.length) console.log(`      Yay farkı yok — tüm yay geometrisi birebir aynı ✓`);
  console.log(`      Satır sayısı  : nihai ${real.length}  |  motor ${got.length}`);
}

console.log('\n' + '='.repeat(78) + '\n');
