// panjur.js
// Panjur Kapak: Otomatik geometri bölme, çift takımlı (T14 konik ballnose + T4 zemin çıkışı)
// raster işleme ve ISO G-code üretimi (1708.html referans motoru).

function fmt(n) {
  return Number(n).toFixed(2);
}

function fmtN(v) {
  let s = Number(v).toFixed(4);
  s = s.replace(/0+$/, '');
  if (s.endsWith('.') === false && !s.includes('.')) s += '.';
  return s;
}

/**
 * Verilen ölçü, offset ve kademe ayarlarına göre panjur gruplarını hesaplar.
 * @param {object} c
 */
export function panjurGroups(c) {
  const crossSpan = c.direction === 'y' ? c.width : c.height;
  const alongSpan = c.direction === 'y' ? c.height : c.width;
  const crossStart = c.direction === 'y' ? c.offsetLeft : c.offsetBottom;
  const crossEnd = c.direction === 'y' ? c.width - c.offsetRight : c.height - c.offsetTop;
  const alongStart = c.direction === 'y' ? c.offsetBottom : c.offsetLeft;
  const alongEnd = c.direction === 'y' ? c.height - c.offsetTop : c.width - c.offsetRight;
  const usableAlong = alongEnd - alongStart;

  if (crossStart < 0 || crossEnd <= crossStart) {
    throw new Error('Sağ/sol veya alt/üst offsetler kullanılabilir enine alan bırakmıyor.');
  }
  if (usableAlong <= 0) {
    throw new Error('Alt/üst veya sol/sağ offsetler kullanılabilir boy bırakmıyor.');
  }
  if (c.pitch <= 0) {
    throw new Error('Panjur kademesi 0’dan büyük olmalı.');
  }
  if (c.exitGap < 0) {
    throw new Error('Rölyef çıkış payı negatif olamaz.');
  }
  if (c.pitch <= c.exitGap) {
    throw new Error('Panjur kademesi, çıkış payından büyük olmalı.');
  }

  const flat = Math.max(0, c.centerFlat || 0);
  if (flat >= usableAlong) {
    throw new Error('Ortadaki düz alan kullanılabilir boydan küçük olmalı.');
  }
  const available = usableAlong - flat;
  const groups = [];

  const makeFromStart = (start, limit, side) => {
    const gap = c.exitGap;
    const rawCount = (limit + gap) / c.pitch;
    const count = Math.max(1, Math.round(rawCount));
    const length = (limit - (count - 1) * gap) / count;
    if (length <= 0) {
      throw new Error('Seçilen panjur kademesi bu alana sığmıyor.');
    }

    let pos = start;
    for (let i = 0; i < count; i++) {
      const end = pos + length;
      groups.push({ start: pos, end, side });
      pos = end + (i < count - 1 ? gap : 0);
    }
  };

  if (flat > 0) {
    const lowerSpan = available / 2;
    const upperSpan = available - lowerSpan;
    makeFromStart(alongStart, lowerSpan, 'start');
    const upperStart = alongStart + lowerSpan + flat;
    makeFromStart(upperStart, upperSpan, 'end');
  } else {
    makeFromStart(alongStart, usableAlong, 'single');
  }

  groups.sort((a, b) => a.start - b.start);
  const actualLengths = [...new Set(groups.map((g) => Number((g.end - g.start).toFixed(6))))];
  const actualLength = actualLengths.length === 1 ? actualLengths[0] : Math.min(...actualLengths);
  const actualPitch = actualLength + c.exitGap;

  return {
    crossSpan,
    alongSpan,
    crossStart,
    crossEnd,
    alongStart,
    alongEnd,
    usableAlong,
    centerFlat: flat,
    groups,
    actualLength,
    actualPitch,
  };
}

/**
 * Panjur konfigürasyonundaki tüm sayısal alanları ve geometrik kısıtları
 * doğrular; geçersiz bir değer varsa açıklayıcı hata fırlatır.
 * @param {object} c - Panjur konfigürasyonu
 */
function validatePanjurConfig(c) {
  const nums = [
    c.width, c.height, c.offset, c.pitch, c.exitGap, c.stepover, c.startZ, c.endZ,
    c.feed, c.plunge, c.spindle, c.exitCut, c.t4Z, c.drillSpindle, c.exitToolDia,
    c.t14TipDia, c.t14BodyDia, c.t14Height,
  ];
  if (nums.some((v) => !Number.isFinite(v))) {
    throw new Error('Eksik veya geçersiz bir değer var.');
  }
  if (c.width <= 0 || c.height <= 0 || c.offset < 0) {
    throw new Error('Dış ölçüler ve offset geçerli olmalı.');
  }
  if (c.offsetMode === 'normal' && c.offset * 2 >= Math.min(c.width, c.height)) {
    throw new Error('Offset parçanın kullanılabilir alanını sıfırlıyor.');
  }
  if ([c.offsetLeft, c.offsetRight, c.offsetBottom, c.offsetTop, c.centerFlat].some((v) => v < 0 || !Number.isFinite(v))) {
    throw new Error('Ayrıntılı offset veya orta düz alan değeri geçersiz.');
  }
  if (c.offsetLeft + c.offsetRight >= c.width) {
    throw new Error('Sol + sağ offset toplamı genişliği sıfırlıyor.');
  }
  if (c.offsetBottom + c.offsetTop >= c.height) {
    throw new Error('Alt + üst offset toplamı yüksekliği sıfırlıyor.');
  }
  if (c.stepover <= 0) {
    throw new Error('Raster adımı 0’dan büyük olmalı.');
  }
  if (c.edgeInset !== undefined && c.edgeInset !== 'auto' && !(c.edgeInset === null || c.edgeInset === '')) {
    if (!Number.isFinite(Number(c.edgeInset)) || Number(c.edgeInset) < 0) {
      throw new Error('Kenar içeri çekme negatif olamaz (sayı veya "auto").');
    }
  }
  if (c.endZ >= c.startZ) {
    throw new Error('Son Z, başlangıç Z’den daha düşük olmalı.');
  }
  if (c.groundEntry && (c.exitCut <= 0 || c.t4Z !== 0)) {
    throw new Error('Çıkış kesimi 0’dan büyük olmalı ve T4 Z değeri 0 olmalı.');
  }
  if (c.t14TipDia <= 0 || c.t14BodyDia < c.t14TipDia || c.t14Height <= 0) {
    throw new Error('T14 uç/gövde çapı ve konik yükseklik geçerli olmalı.');
  }
  if (c.groundEntry && c.exitToolDia <= 0) {
    throw new Error('Uç bıçağı çapı 0’dan büyük olmalı.');
  }
  if (c.groundEntry && c.exitCut < c.exitToolDia) {
    throw new Error('Çıkış kesimi, uç bıçağı çapından küçük olamaz (bıçak alana sığmaz).');
  }
  if (c.groundEntry && c.exitToolDia !== 4) {
    throw new Error('Delikli panjur için T4 çapı tam 4 mm olmalı; geometri 3 mm eski + 1 mm yeni panjur payına göre hesaplanır.');
  }
  if (c.groundEntry && c.exitCut !== 4) {
    throw new Error('Delikli panjurda çıkış kesimi 4 mm olmalı: 3 mm eski panjur + 1 mm yeni panjur.');
  }
}

/**
 * Belirtilen eksende tek yönlü (zig-zag) raster pasını üretir. `axis` 'y' ise
 * takım Y ekseninde süpürülür ve X ekseninde adımlanır; aksi halde tersi.
 * @returns {number} güncellenmiş satır sayacı (n)
 */
/**
 * En derin noktada konik bıçağın (T14) gerçek yarıçapını hesaplar.
 *
 * Konik geometri: uç çapı (tipDia) → gövde çapı (bodyDia), konik yükseklik
 * (height) boyunca doğrusal açılır. Eğim (tan açı):
 *   eğim = (gövdeYarıçap - uçYarıçap) / konikYükseklik
 * maxDerinlik kadar inince takımın efektif yarıçapı:
 *   r_eff = uçYarıçap + maxDerinlik × eğim  (gövdeYarıçapını geçmez)
 *
 * @param {object} c - Panjur konfigürasyonu
 * @returns {{ tipR:number, bodyR:number, taperTan:number, maxDepth:number, rEff:number }}
 */
export function t14EffectiveRadius(c) {
  const tipR = (Number(c.t14TipDia) || 0) / 2;
  const bodyR = (Number(c.t14BodyDia) || 0) / 2;
  const taperH = Number(c.t14Height) || 0;
  const taperTan = taperH > 0 ? (bodyR - tipR) / taperH : 0;
  const maxDepth = Math.max(0, (Number(c.startZ) || 0) - (Number(c.endZ) || 0));
  const rEff = Math.min(bodyR, tipR + maxDepth * taperTan);
  return { tipR, bodyR, taperTan, maxDepth, rEff };
}

/**
 * Rasterın enine sınırlarını kenardan ne kadar içeri çekeceğini çözer.
 * - `edgeInset` sayı ise: o sabit değer (mm). 0 = tam kenar.
 * - `edgeInset` 'auto'/tanımsız ise: T14 konik açısından otomatik hesaplanan
 *   en derin nokta yarıçapı (`t14EffectiveRadius`).
 * @param {object} c
 * @returns {number} içeri çekme mesafesi (mm, >= 0)
 */
export function resolveEdgeInset(c) {
  const raw = c.edgeInset;
  if (raw === 'auto' || raw === undefined || raw === null || raw === '') {
    return t14EffectiveRadius(c).rEff;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Belirli bir derinlikteki (mm) konik bıçağın gerçek yarıçapını verir.
 *
 * Not: `t14EffectiveRadius` yalnızca en derin noktaya (maxDepth) göre tek bir
 * yarıçap döndür. Konik bıçak sığ Z'de ince (neredeyse sadece uç), derinde
 * kalın (gövdeye yakın) olduğundan, her raster satırının kendi derinliğine göre
 * ayrı bir yarıçapa (dolayısıyla kenar içeri çekmesine) ihtiyacı vardır. Aksi
 * halde sığ satırlar en derin satıra göre fazla içeri çekilir ve kenar düz
 * ikizkenar yamuk yerine rampa/basamaklı görünür.
 *
 * @param {object} c - Panjur konfigürasyonu
 * @param {number} depth - O satırdaki kesim derinliği (mm, >= 0)
 * @returns {number} o derinlikteki efektif yarıçap (mm)
 */
export function t14RadiusAtDepth(c, depth) {
  const { tipR, bodyR, taperTan } = t14EffectiveRadius(c);
  const d = Math.max(0, Number(depth) || 0);
  return Math.min(bodyR, tipR + d * taperTan);
}

/**
 * Belirli bir derinlikteki kenar içeri çekmesini çözer.
 * - `edgeInset` sayı ise: o sabit değer (mm), derinlikten bağımsız.
 * - 'auto' ise: o derinlikteki konik bıçak yarıçapı (`t14RadiusAtDepth`).
 * @param {object} c
 * @param {number} depth - O satırdaki kesim derinliği (mm, >= 0)
 * @returns {number} içeri çekme mesafesi (mm, >= 0)
 */
export function resolveEdgeInsetAtDepth(c, depth) {
  const raw = c.edgeInset;
  if (raw === 'auto' || raw === undefined || raw === null || raw === '') {
    return t14RadiusAtDepth(c, depth);
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function emitRasterPass(axis, lines, n, c, crossStart, crossEnd, safeStart, step, passes) {
  const isY = axis === 'y';
  const stepAxis = isY ? 'Y' : 'X';
  const crossAxis = isY ? 'X' : 'Y';

  // Kenarları her satırın KENDİ derinliğine göre içeri çek: rasterın enine
  // sınırları crossStart/crossEnd yerine bu kadar daraltılmış kullanılır.
  // - 'auto' (varsayılan): o satırdaki kesim derinliğine göre konik bıçağın
  //   gerçek yarıçapı kadar içeri çekilir. Sığ satır az, derin satır çok
  //   içeri çekilir; böylece kenar dikeyde simetrik "ikizkenar yamuk" olur
  //   (soldaki rampa/basamak yerine).
  // - sayı: elle sabit içeri çekme (mm), derinlikten bağımsız. 0 = tam kenar.
  const fixedInset =
    c.edgeInset === 'auto' || c.edgeInset === undefined || c.edgeInset === null || c.edgeInset === ''
      ? null
      : resolveEdgeInset(c);
  const insetAt = (depth) => (fixedInset === null ? resolveEdgeInsetAtDepth(c, depth) : fixedInset);

  // Bütün satırların sınırlarını önceden hesapla (giriş noktası için de gerekli).
  const bounds = [];
  for (let i = 0; i < passes; i++) {
    const t = i / (passes - 1);
    const z = c.startZ + (c.endZ - c.startZ) * t;
    const depth = Math.max(0, c.startZ - z);
    const inset = insetAt(depth);
    const innerStart = crossStart + inset;
    const innerEnd = crossEnd - inset;
    bounds.push({
      cross: innerEnd > innerStart ? (i % 2 === 0 ? innerEnd : innerStart) : (i % 2 === 0 ? crossEnd : crossStart),
      entryCross: innerEnd > innerStart ? innerStart : crossStart,
    });
  }

  const gx = isY ? bounds[0].entryCross : safeStart;
  const gy = isY ? safeStart : bounds[0].entryCross;
  lines.push(`N${n++} G0 X${fmt(gx)} Y${fmt(gy)}`);
  lines.push(`N${n++} G0 Z${fmt(c.safeZ)}`);
  lines.push(`N${n++} G0 Z${fmt(c.startZ)}`);
  for (let i = 0; i < passes; i++) {
    const cross = bounds[i].cross;
    lines.push(`N${n++} G1 ${crossAxis}${fmt(cross)} F${c.feed}`);
    if (i < passes - 1) {
      const nextAlong = safeStart + (i + 1) * step;
      const zn = c.startZ + (c.endZ - c.startZ) * ((i + 1) / (passes - 1));
      lines.push(`N${n++} G1 ${stepAxis}${fmt(nextAlong)}`);
      lines.push(`N${n++} G1 Z${fmt(zn)}`);
    }
  }
  return n;
}

/**
 * 1708.html tam motoru: Otomatik panjur bölme + T14 konik ballnose eğimli raster + T4 zemin çıkışı
 * @param {object} c - Panjur konfigürasyonu
 */
export function generatePanjurGcode(c) {
  validatePanjurConfig(c);

  const g = panjurGroups(c);
  const lines = ['%', 'O2000', 'N1 G0 G17 G40 G49 G80 G90 G54'];
  let n = 2;
  const x0 = g.crossStart;
  const x1 = g.crossEnd;
  const y0 = g.alongStart;
  const y1 = g.alongEnd;

  const toolRT4 = c.exitToolDia / 2;
  // T4=4 mm için takım izi tam olarak 3 mm eski panjur + 1 mm yeni
  // panjur alanıdır. Merkez hattı, eski ucun 1 mm içine yerleşir:
  // [end - 3 mm, end + 1 mm]. Çap değişirse oran korunur.
  const newSideOverlap = 1;
  const oldSideOverlap = 3;

  // =========================================================
  // 1. AŞAMA: TÜM T14 RÖLYEF TARAMALARI (HEPSİ BİRDEN)
  // =========================================================
  lines.push(`N${n++} M6T${c.toolNo}`);
  lines.push(`N${n++} S${c.spindle} M3`);
  lines.push(`N${n++} M7`);

  g.groups.forEach((grp) => {
    const span = grp.end - grp.start;
    if (span <= 0) {
      throw new Error(`Panjur boyu (${(grp.end - grp.start).toFixed(1)} mm), T14 takımının konik yarıçapı için yetersiz.`);
    }

    const passes = Math.max(2, Math.ceil(span / c.stepover) + 1);
    const step = span / (passes - 1);
    const crossStart = c.direction === 'y' ? x0 : y0;
    const crossEnd = c.direction === 'y' ? x1 : y1;

    n = emitRasterPass(c.direction, lines, n, c, crossStart, crossEnd, grp.start, step, passes);
    lines.push(`N${n++} G0 Z${fmt(c.safeZ)}`);
  });

  // =========================================================
  // 2. AŞAMA: TÜM T4 ÇIKIŞ KESİMLERİ (HEPSİ BİRDEN)
  // =========================================================
  if (c.groundEntry) {
    lines.push(`N${n++} M5`);
    lines.push(`N${n++} G0 Z${fmt(c.toolChangeZ)}`);
    lines.push(`N${n++} M6T${c.drillTool}`);
    lines.push(`N${n++} S${c.drillSpindle} M3`);
    lines.push(`N${n++} M7`);

    g.groups.forEach((grp) => {
      const start = grp.start;
      const end = grp.end;
      // T4 merkezi, eski panjurun end-3 noktasından yeni panjurun
      // end+1 noktasına tek bir düz rampayla ilerler. Böylece takım yolu
      // tam 4 mm'dir: 3 mm iniş bölgesinden + 1 mm çıkış bölgesinden.
      // Önceki dik Z dalışı burada özellikle yoktur; Z, bu düz çizgi
      // boyunca 0'a iner ve ardından aynı Z0 seviyesinde enine keser.
      const transitionStart = Math.max(start, end - oldSideOverlap);
      const transitionEnd = end + newSideOverlap;
      const span = end - start;
      const zAtTransitionStart = c.startZ + (c.endZ - c.startZ) * ((transitionStart - start) / span);

      if (c.direction === 'y') {
        lines.push(`N${n++} G0 X${fmt(x0 - toolRT4)} Y${fmt(transitionStart)} Z${fmt(c.safeZ)}`);
        lines.push(`N${n++} G1 Z${fmt(zAtTransitionStart)} F${c.plunge}`);
        lines.push(`N${n++} G1 Y${fmt(transitionEnd)} Z0.000 F${c.feed}`);
        lines.push(`N${n++} G1 X${fmt(x1 + toolRT4)} F${c.feed}`);
      } else {
        lines.push(`N${n++} G0 X${fmt(transitionStart)} Y${fmt(y0 - toolRT4)} Z${fmt(c.safeZ)}`);
        lines.push(`N${n++} G1 Z${fmt(zAtTransitionStart)} F${c.plunge}`);
        lines.push(`N${n++} G1 X${fmt(transitionEnd)} Z0.000 F${c.feed}`);
        lines.push(`N${n++} G1 Y${fmt(y1 + toolRT4)} F${c.feed}`);
      }
      lines.push(`N${n++} G0 Z${fmt(c.safeZ)}`);
    });
    lines.push(`N${n++} M5`);
  }

  // =========================================================
  // 3. AŞAMA: GÜVENLİ BİTİŞ
  // =========================================================
  lines.push(`N${n++} G0 Z${fmt(c.homeZ)}`);
  lines.push(`N${n++} G0 X0.00 Y0.00`);
  lines.push(`N${n++} M9`);
  lines.push(`N${n++} M16`);
  lines.push(`N${n++} M30`);
  lines.push('%');

  const approxStep = g.groups.length
    ? Math.abs(g.groups[0].end - g.groups[0].start) / Math.max(1, Math.ceil(Math.abs(g.groups[0].end - g.groups[0].start) / c.stepover))
    : 0;

  return {
    gcode: lines.join('\n'),
    groups: g.groups,
    panjurData: g,
    approxStep,
    message: `${g.groups.length} panjur grubu üretildi. Raster adımı ~${approxStep.toFixed(3)} mm.${
      c.groundEntry ? ` T${c.drillTool} ile her uçta ${oldSideOverlap.toFixed(1)} mm eski + ${newSideOverlap.toFixed(1)} mm yeni panjur payı Z0'a açıldı.` : ''
    }`,
  };
}

/**
 * Backward compatibility function for existing smoke tests and direct blade specs
 */
export function buildPanjurGcode(opts) {
  if (opts.width !== undefined && opts.height !== undefined && opts.pitch !== undefined) {
    return generatePanjurGcode(opts);
  }

  const {
    xStart, xEnd, startY, bladeHeight, bladeCount, yStep,
    zTop, zBottom, safeZ, toolNo, spindleSpeed, cutFeed,
    programNumber = 1234,
  } = opts;

  if (!(xEnd > xStart)) throw new Error('Bitiş X, başlangıç X\'ten büyük olmalı.');
  if (!(bladeHeight > 0)) throw new Error('Çıta yüksekliği pozitif olmalı.');
  if (!(bladeCount >= 1)) throw new Error('En az 1 çıta gerekli.');
  if (!(zTop > zBottom)) throw new Error('Başlangıç derinliği (zTop), bitiş derinliğinden (zBottom) büyük olmalı.');
  if (!(yStep > 0)) throw new Error('Geçerli bir raster adımı gir.');

  const numSteps = Math.max(1, Math.round(bladeHeight / yStep));
  const actualYStep = bladeHeight / numSteps;
  const actualZStep = (zTop - zBottom) / numSteps;

  let n = 0;
  const lines = [];
  const push = (text) => { n++; lines.push(`N${n} ${text}`); };

  lines.push('%');
  lines.push(`O${programNumber}`);
  push('G0 G17 G40 G49 G80 G90 G54');
  push(`M6 T${toolNo}`);
  push(`S${spindleSpeed} M3`);
  push('M7');

  for (let b = 0; b < bladeCount; b++) {
    const yBladeStart = startY + b * bladeHeight;

    if (b === 0) {
      push(`G0 X${fmtN(xStart)} Y${fmtN(yBladeStart)}`);
      push(`G0 Z${fmtN(safeZ)}`);
    } else {
      push(`G0 X${fmtN(xStart)} Y${fmtN(yBladeStart)}`);
    }
    push(`G0 Z${fmtN(zTop)}`);

    let atEnd = false;
    push(`G1 X${fmtN(xEnd)} F${cutFeed}`);
    atEnd = true;

    for (let step = 1; step <= numSteps; step++) {
      const y = yBladeStart + step * actualYStep;
      const z = zTop - step * actualZStep;
      const targetX = atEnd ? xStart : xEnd;
      push(`G1 Y${fmtN(y)}`);
      push(`G1 Z${fmtN(z)}`);
      push(`G1 X${fmtN(targetX)}`);
      atEnd = !atEnd;
    }

    push(`G0 Z${fmtN(safeZ)}`);
  }

  push('M5');
  push('M9');
  push('M16');
  push('M30');
  lines.push('%');

  return { gcode: lines.join('\n'), stepsPerBlade: numSteps, actualYStep };
}

