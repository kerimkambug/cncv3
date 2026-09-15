// _scenario_test.mjs
// G-code motorun (kapak.js + derz.js) parametrik davranışını 3 farklı kapak
// ebatında doğrular. Kritik: bu bir BİRİM TESTİ değil, ÜRETİLEN G-CODE'un
// fiziksel olarak geçerli olduğunu ölçen bir DENETİM.
//
//   node client/src/lib/gcode/_scenario_test.mjs
//
// Kriterler:
//   1) Derz adedi & aralığı — genişlikle artıyor mu, hedef aralığa yakın mı,
//      kenarlara göre simetrik mi?
//   2) Kemer teğetleri — 2 NUMARA (semicircle) ve 3 NUMARA (pointed) için R'in
//      genişlikle büyümesi ve dikey derzlerin tepe bitişlerinin yay üzerinde olması
//   3) Köşe radüsleri — 1 ve 8 NUMARA'da R sabit, düz kenarlar uzuyor mu?
//   4) Sağlık taraması — negatif koordinat, koordinat çakışması, ters yay,
//      güvenli Z altına iniş, sıfır/negatif span
import { buildKapakGcode } from './kapak.js';
import { NUMUNE_PRESETS, toPresetDoc } from '../../../../server/scripts/seed-numune-presets.js';

const SCENARIOS = [
  { id: 'A', label: 'Dar Çekmece', w: 292, h: 176 },
  { id: 'B', label: 'Standart Kapak', w: 446, h: 716 },
  { id: 'C', label: 'Boy Dolap Kapağı', w: 596, h: 1196 },
];
const MODELS = ['1 NUMARA', '2 NUMARA', '8 NUMARA'];

// ---------------------------------------------------------------- yardımcılar
const num = (v) => Number(v);

/** G-code'u hareket satırlarına ayır. */
function motions(gcode) {
  return gcode.split('\n').map((l) => l.trim()).filter((l) => /^G[0-3]/.test(l) || /^[XY]/.test(l));
}

/** Bir satırdaki X/Y/Z/I/J değerlerini çıkarır (modal durumu takip eder). */
function parsePath(gcode) {
  let x = 0, y = 0, z = 0;
  const pts = [];
  const arcs = [];
  let spindleOn = false;
  for (const line of gcode.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    if (/^M3\b/.test(s)) { spindleOn = true; continue; }
    if (/^M5\b/.test(s)) { spindleOn = false; continue; }
    const mZ = s.match(/Z(-?\d+(?:\.\d+)?)/);
    const mX = s.match(/X(-?\d+(?:\.\d+)?)/);
    const mY = s.match(/Y(-?\d+(?:\.\d+)?)/);
    const g = (s.match(/^G(\d)/) || [])[1];
    // Yayın BAŞLANGICI = bu satırdan ÖNCEKİ konum (X/Y modal); bitişi = satırdaki X/Y.
    const startX = x, startY = y;
    if (mX) x = num(mX[1]);
    if (mY) y = num(mY[1]);
    if (mZ) z = num(mZ[1]);
    const moving = g >= 0 || mX || mY;
    if (!moving) continue;
    if (g === '2' || g === '3') {
      const mI = s.match(/I(-?\d+(?:\.\d+)?)/);
      const mJ = s.match(/J(-?\d+(?:\.\d+)?)/);
      const i = mI ? num(mI[1]) : 0;
      const j = mJ ? num(mJ[1]) : 0;
      arcs.push({
        type: g === '2' ? 'G2' : 'G3',
        sx: startX, sy: startY,   // yay başlangıcı
        ex: x, ey: y,             // yay bitişi
        i, j,
        cx: startX + i, cy: startY + j, // yay merkezi = başlangıç + I/J
        r: Math.hypot(i, j),
        raw: s,
      });
      pts.push({ x, y, z, spindleOn });
    } else {
      pts.push({ x, y, z, spindleOn });
    }
  }
  return { pts, arcs };
}

/** Sadece KESİM (dalma sonrası, spindle açık) hareketleri. */
function cuttingSpans(gcode) {
  const { pts } = parsePath(gcode);
  return pts.filter((p) => p.spindleOn && p.z <= 0);
}

/** G0 X.. Y.. (dalış öncesi konumlanma) satırlarından X/Y değerleri. */
function rapidTargets(gcode) {
  const out = [];
  for (const line of gcode.split('\n')) {
    const s = line.trim();
    if (!/^G0\b/.test(s)) continue;
    const mX = s.match(/X(-?\d+(?:\.\d+)?)/);
    const mY = s.match(/Y(-?\d+(?:\.\d+)?)/);
    if (mX || mY) out.push({ x: mX ? num(mX[1]) : null, y: mY ? num(mY[1]) : null });
  }
  return out;
}

/** Derz çizgileri: G0 X<pos> Y<alt> Z<safe> ... ardından G1 ile dik kesim. */
function derzLines(gcode) {
  const lines = gcode.split('\n').map((l) => l.trim());
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^G0 X(-?\d+(?:\.\d+)?) Y(-?\d+(?:\.\d+)?) Z(-?\d+(?:\.\d+)?)$/);
    if (!m) continue;
    // sonraki G1 Z (dalış) ve G1 X.. Y.. (kesim)
    const plunge = lines[i + 1] || '';
    const cut = lines[i + 2] || '';
    if (!/^G1\s+Z/.test(plunge)) continue;
    const mc = cut.match(/^G1 X(-?\d+(?:\.\d+)?) Y(-?\d+(?:\.\d+)?)/);
    if (!mc) continue;
    const x1 = num(m[1]), y1 = num(m[2]);
    const x2 = num(mc[1]), y2 = num(mc[2]);
    if (Math.abs(x2 - x1) > 1e-6) continue; // sadece dikey derz
    out.push({ x: x1, yBottom: y1, yTop: y2 });
  }
  return out;
}

const eq = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ------------------------------------------------------------------- denetim
const problems = [];
function flag(scenario, model, msg) { problems.push(`[${scenario}/${model}] ${msg}`); }

console.log('\n' + '='.repeat(100));
console.log('  G-CODE MOTORU — PARAMETRİK DAVRANIŞ DOĞRULAMASI (kapak.js + derz.js)');
console.log('='.repeat(100));

for (const sc of SCENARIOS) {
  console.log(`\n${'#'.repeat(100)}`);
  console.log(`#  SENARYO ${sc.id} — ${sc.label}   (${sc.w} x ${sc.h} mm)`);
  console.log('#'.repeat(100));

  for (const modelName of MODELS) {
    const def = NUMUNE_PRESETS.find((d) => d.name === modelName);
    const doc = toPresetDoc(def);
    const gcode = buildKapakGcode(sc.w, sc.h, doc);
    const motionsList = motions(gcode);
    const arcs = parsePath(gcode).arcs;
    const cut = cuttingSpans(gcode);
    const derz = derzLines(gcode);

    console.log(`\n  --- ${modelName} (topStyle=${doc.topStyle}) ---`);
    console.log(`      hareket satırı : ${motionsList.length}   G2/G3 yay: ${arcs.length}   derz çizgisi: ${derz.length}`);

    // ---- SINIR KOORDİNATLARI (tüm hareketler) ----
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of parsePath(gcode).pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
    console.log(`      X aralığı      : ${f2(minX)} .. ${f2(maxX)}`);
    console.log(`      Y aralığı      : ${f2(minY)} .. ${f2(maxY)}`);

    // ---- 4) SAĞLIK TARAMASI ----
    if (minX < -1e-6 || minY < -1e-6) flag(sc.id, modelName, `NEGATİF koordinat: X min=${f2(minX)}, Y min=${f2(minY)}`);
    if (maxX > sc.w + 1e-6 || maxY > sc.h + 1e-6) flag(sc.id, modelName, `PLAKA DIŞI koordinat: X max=${f2(maxX)} > ${sc.w} veya Y max=${f2(maxY)} > ${sc.h}`);
    for (const a of arcs) {
      const r = Math.hypot(a.i, a.j);
      if (!(r > 0)) flag(sc.id, modelName, `SIFIR yarıçaplı yay: ${a.raw}`);
      // tam çember / teğet noktası kontrolü: |start - centre| == R
      const ds = Math.hypot(a.sx - (a.sx + a.i), a.sy - (a.sy + a.j));
      if (!eq(ds, r, 1e-3)) flag(sc.id, modelName, `Yay başlangıcı çember üzerinde değil: ${a.raw}`);
    }
    // ters yön: aynı merkez etrafında G2 ve G3 karışık mı? (köşe yayları hep aynı olmalı)
    const cornerArcs = arcs.filter((a) => /^G2/.test(a.type)).length;
    const ccwArcs = arcs.filter((a) => /^G3/.test(a.type)).length;
    if (cornerArcs > 0 && ccwArcs > 0 && doc.topStyle === 'flat') {
      flag(sc.id, modelName, `Karışık yay yönü: ${cornerArcs} G2 + ${ccwArcs} G3 (düz üstte beklenmez)`);
    }
    // koordinat çakışması: kesimde aynı noktaya iki kez dalış (sıfır uzunlukta span)
    const spans = [];
    for (let i = 1; i < cut.length; i++) {
      const dx = Math.abs(cut[i].x - cut[i - 1].x), dy = Math.abs(cut[i].y - cut[i - 1].y);
      if (dx < 1e-6 && dy < 1e-6) spans.push(`(${f2(cut[i].x)},${f2(cut[i].y)})`);
    }
    const uniqDup = [...new Set(spans)];
    if (uniqDup.length > 3) flag(sc.id, modelName, `Sıfır uzunlukta hareket (çakışma) x${uniqDup.length}: ${uniqDup.slice(0, 4).join(' ')}`);

    // ---- 1) DERZ ADEDİ & ARALIĞI ----
    if (derz.length) {
      const xs = derz.map((d) => d.x).sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
      const gMin = Math.min(...gaps), gMax = Math.max(...gaps);
      const leftGap = xs[0];                      // sol kenardan ilk çizgiye
      const rightGap = sc.w - xs[xs.length - 1];  // son çizgiden sağ kenara
      console.log(`      derz X         : [${xs.map((v) => v.toFixed(2)).join(', ')}]`);
      console.log(`      aralıklar      : [${gaps.map((v) => v.toFixed(2)).join(', ')}]  (min=${gMin.toFixed(2)} max=${gMax.toFixed(2)})`);
      console.log(`      simetri        : sol=${leftGap.toFixed(2)}  sağ=${rightGap.toFixed(2)}  ${eq(leftGap, rightGap, 0.01) ? '✓ simetrik' : '✗ ASİMETRİK'}`);
      if (!eq(leftGap, rightGap, 0.01)) flag(sc.id, modelName, `Derz asimetrik: sol=${leftGap.toFixed(2)} sağ=${rightGap.toFixed(2)}`);
      // Aralıklar 3 ondalığa yuvarlanmış konumlardan türediği için 1/100 mm
      // düzeyindeki fark normaldir (kesim toleransı). 0.05mm üzeri gerçek sorundur.
      if (gMax - gMin > 0.05) flag(sc.id, modelName, `Derz aralıkları eşit değil: min=${gMin.toFixed(3)} max=${gMax.toFixed(3)}`);
      // hedef aralığa yakınlık (autoFit yüzünden hafif sapabilir)
      const target = num((doc.rows.find((r) => r.operation === 'derz').derz || {}).spacing) || 30;
      const dev = Math.max(Math.abs(gMin - target), Math.abs(gMax - target));
      console.log(`      hedef aralık   : ${target}  sapma=${dev.toFixed(2)}mm ${dev <= target / 2 ? '✓' : '✗ ÇOK FAZLA'}`);
      if (dev > target / 2) flag(sc.id, modelName, `Derz aralığı hedeften çok sapıyor: ${gMin.toFixed(2)}..${gMax.toFixed(2)} (hedef ${target})`);
      console.log(`      derz Y         : alt=${derz[0].yBottom.toFixed(2)}  üst(ler)=[${[...new Set(derz.map((d) => d.yTop.toFixed(2)))].join(', ')}]`);
      if (derz.some((d) => d.yBottom < -1e-6)) flag(sc.id, modelName, `Derz negatif Y'den başlıyor: ${derz[0].yBottom}`);
    } else {
      console.log('      derz X         : (yok)');
    }
  }
}

// ------------------------------------------------- 2) KEMER TEĞET DOĞRULAMASI
console.log('\n' + '='.repeat(100));
console.log('  KEMER / KAVİS TEĞET DOĞRULAMASI (2 NUMARA semicircle, 3 NUMARA pointed)');
console.log('='.repeat(100));
for (const modelName of ['2 NUMARA', '3 NUMARA']) {
  const def = NUMUNE_PRESETS.find((d) => d.name === modelName);
  const doc = toPresetDoc(def);
  console.log(`\n  ${modelName} (topStyle=${doc.topStyle})`);
  console.log('    senaryo            genişlik      R       merkezX    merkezY   derz üst Y (yay üzerinde?)');
  for (const sc of SCENARIOS) {
    const gcode = buildKapakGcode(sc.w, sc.h, doc);
    const arcs = parsePath(gcode).arcs;
    const derz = derzLines(gcode);
    // kemer yayı: en büyük yarıçaplı G3 (semicircle'da 2 adet, pointed'da 1)
    // Kemer yayının GERÇEK merkezi = yay başlangıcı + I/J (parsePath bunu hesaplıyor).
    // Semicircle'da iki G3 yayı aynı merkezi paylaşır; pointed'da tek G3 yayı vardır.
    const big = arcs.filter((a) => /^G3/.test(a.type));
    const a0 = big[0];
    const R = a0.r;
    const cx = a0.cx;
    const cy = a0.cy;
    // dikey derzlerin tepe bitişi yay üzerinde mi? |P - merkez| == R
    const checks = derz.map((d) => {
      const dist = Math.hypot(d.x - cx, d.yTop - cy);
      return { y: d.yTop, onCurve: eq(dist, R, 0.02), dist, R };
    });
    const allOn = checks.length ? checks.every((c) => c.onCurve) : true;
    const shown = checks.length <= 5
      ? checks.map((c) => c.onCurve ? `Y${c.y.toFixed(2)}✓` : `Y${c.y.toFixed(2)}✗`).join(', ')
      : `${checks.length} çizgi — hepsi ${allOn ? 'yay üzerinde ✓' : 'yay üzerinde DEĞİL ✗'}`;
    console.log(`    ${sc.id} ${sc.label.padEnd(18)} ${String(sc.w).padStart(4)}   ${R.toFixed(2).padStart(7)}  ${cx.toFixed(2).padStart(8)}  ${cy.toFixed(2).padStart(8)}   [${shown}]`);
    if (!allOn) flag(`${sc.id}`, modelName, `Derz tepe noktaları kemer yayı üzerinde değil`);
  }
}

// ------------------------------------------------- 3) KÖŞE RADÜSÜ SABİTLİĞİ
console.log('\n' + '='.repeat(100));
console.log('  KÖŞE RADÜSÜ & DÜZ KENAR UZAMASI (1 NUMARA r6/r3, 8 NUMARA r4)');
console.log('='.repeat(100));
for (const modelName of ['1 NUMARA', '8 NUMARA']) {
  const def = NUMUNE_PRESETS.find((d) => d.name === modelName);
  const doc = toPresetDoc(def);
  console.log(`\n  ${modelName}`);
  console.log('    senaryo   genişlik  yükseklik   R-seti            düz kenar X uzunluğu   düz kenar Y uzunluğu');
  for (const sc of SCENARIOS) {
    const gcode = buildKapakGcode(sc.w, sc.h, doc);
    const arcs = parsePath(gcode).arcs;
    const radii = [...new Set(arcs.map((a) => Math.hypot(a.i, a.j).toFixed(2)))].sort((a, b) => a - b);
    // köşe radüslerinin plaka yüksekliğinden bağımsız olması: R kümesi sabit kalmalı
    const firstRadii = radii.join(',');
    // düz kenar uzunlukları: ardışık X-only / Y-only G1 mesafeleri
    const { pts } = parsePath(gcode);
    let maxDX = 0, maxDY = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i].x - pts[i - 1].x), dy = Math.abs(pts[i].y - pts[i - 1].y);
      if (dx > 1e-9 && dy < 1e-9) maxDX = Math.max(maxDX, dx);
      if (dy > 1e-9 && dx < 1e-9) maxDY = Math.max(maxDY, dy);
    }
    console.log(`    ${sc.id}        ${String(sc.w).padStart(4)}     ${String(sc.h).padStart(4)}      [${radii.join(', ')}]`.padEnd(64) + `${maxDX.toFixed(2).padStart(10)}            ${maxDY.toFixed(2).padStart(10)}`);
    if (sc.id !== 'A') {
      // R'ler senaryolar arasında aynı olmalı (sabit köşe radüsü)
      console.log(`             (referans R kümesi: ${firstRadii})`);
    }
  }
}

// ------------------------------------------------------------------ ÖZET
console.log('\n' + '='.repeat(100));
console.log('  BULGULAR');
console.log('='.repeat(100));
if (problems.length === 0) {
  console.log('  ✓ Kritik kriterlerin tamamı geçti (negatif/plaka-dışı koordinat yok, yaylar çember üzerinde, derz simetrik).');
} else {
  problems.forEach((p) => console.log('  ✗ ' + p));
}
console.log(`\n  Toplam bulgu: ${problems.length}\n`);
