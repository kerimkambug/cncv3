// basReliefEngine.js
// Empire CNC — Profesyonel Bas-Rölyef & Derinlik Haritası İşleme Motoru
// SculptOK seviyesinde çok ölçekli detay ayırma, parlak ışık telafisi ve çift yönlü yumuşatma.

/**
 * 2D Gaussian Kernel oluşturur
 */
function createGaussianKernel(radius, sigma) {
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size * size);
  let sum = 0;
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const idx = (y + radius) * size + (x + radius);
      const val = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      kernel[idx] = val;
      sum += val;
    }
  }
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= sum;
  }
  return { kernel, size, radius };
}

/**
 * Hızlı 1D Separable Gaussian Bulanıklaştırma (Float32Array için)
 */
export function gaussianBlurFloat(data, width, height, radius = 2, sigma = 1.2) {
  if (radius <= 0) return new Float32Array(data);
  const size = radius * 2 + 1;
  const k1d = new Float32Array(size);
  let kSum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k1d[i + radius] = v;
    kSum += v;
  }
  for (let i = 0; i < size; i++) k1d[i] /= kSum;

  const temp = new Float32Array(width * height);
  const out = new Float32Array(width * height);

  // Yatay geçiş (Horizontal pass)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = Math.max(0, Math.min(width - 1, x + k));
        sum += data[rowOffset + nx] * k1d[k + radius];
      }
      temp[rowOffset + x] = sum;
    }
  }

  // Dikey geçiş (Vertical pass)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = Math.max(0, Math.min(height - 1, y + k));
        sum += temp[ny * width + x] * k1d[k + radius];
      }
      out[y * width + x] = sum;
    }
  }

  return out;
}

/**
 * Bilateral Filter - Kenar Koruyucu Pürüzsüzleştirme
 * CNC takımının basamaklanmasını ve sivri gürültüleri yok eder, organik yüzeyleri ipeksi yapar.
 */
export function bilateralFilterFloat(data, width, height, radius = 3, sigmaSpace = 2.5, sigmaRange = 0.1) {
  if (radius <= 0) return new Float32Array(data);
  const out = new Float32Array(width * height);
  const twoSigmaSpaceSq = 2 * sigmaSpace * sigmaSpace;
  const twoSigmaRangeSq = 2 * sigmaRange * sigmaRange;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centerIdx = y * width + x;
      const centerVal = data[centerIdx];
      let sumWeight = 0;
      let sumVal = 0;

      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(height - 1, y + ky));
        const dy = ky;

        for (let kx = -radius; kx <= radius; kx++) {
          const nx = Math.max(0, Math.min(width - 1, x + kx));
          const dx = kx;

          const neighborVal = data[ny * width + nx];
          const distSq = dx * dx + dy * dy;
          const rangeDiff = centerVal - neighborVal;
          const rangeSq = rangeDiff * rangeDiff;

          const weight = Math.exp(-distSq / twoSigmaSpaceSq - rangeSq / twoSigmaRangeSq);
          sumWeight += weight;
          sumVal += neighborVal * weight;
        }
      }

      out[centerIdx] = sumWeight > 0 ? sumVal / sumWeight : centerVal;
    }
  }

  return out;
}

/**
 * Sobel Gradient ile kenar / mikroyapı şiddeti hesaplama
 */
export function computeSobelMagnitude(data, width, height) {
  const grad = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -data[idx - width - 1] + data[idx - width + 1] +
        -2 * data[idx - 1] + 2 * data[idx + 1] +
        -data[idx + width - 1] + data[idx + width + 1];

      const gy =
        -data[idx - width - 1] - 2 * data[idx - width] - data[idx - width + 1] +
        data[idx + width - 1] + 2 * data[idx + width] + data[idx + width + 1];

      grad[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return grad;
}

/**
 * Akıllı Ön Plan / Arka Plan Maskesi Çıkarıcı (Smart Subject Segmentation)
 * Beyaz, şeffaf veya tek renkli arka planları tespit ederek nesne siluetini ayırır.
 */
export function extractSubjectMask(imgData, threshold = 240) {
  const w = imgData.width;
  const h = imgData.height;
  const total = w * h;
  const mask = new Float32Array(total);
  const data = imgData.data;

  // 1. Köşe ve kenar piksellerinden arka plan rengini ve tipini tespit et
  const sampleIndices = [
    0,                                // Sol-Üst
    (w - 1) * 4,                      // Sağ-Üst
    (h - 1) * w * 4,                  // Sol-Alt
    ((h - 1) * w + (w - 1)) * 4,      // Sağ-Alt
    Math.floor(w / 2) * 4,            // Üst-Orta
    ((h - 1) * w + Math.floor(w / 2)) * 4, // Alt-Orta
    Math.floor(h / 2) * w * 4,        // Sol-Orta
    (Math.floor(h / 2) * w + (w - 1)) * 4 // Sağ-Orta
  ];

  let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
  let count = 0;
  for (const c of sampleIndices) {
    sumR += data[c];
    sumG += data[c + 1];
    sumB += data[c + 2];
    sumA += data[c + 3];
    count++;
  }

  const avgR = sumR / count;
  const avgG = sumG / count;
  const avgB = sumB / count;
  const avgA = sumA / count;
  const avgLum = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;

  // Arka Plan Tipi:
  const isTransparentBg = avgA < 50;
  const isBlackBg = !isTransparentBg && avgLum < 38;
  const isWhiteBg = !isTransparentBg && avgLum > 215;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3] / 255.0;

    if (a < 0.15) {
      mask[i] = 0.0;
      continue;
    }

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const distToBg = Math.sqrt((r - avgR) ** 2 + (g - avgG) ** 2 + (b - avgB) ** 2);

    if (isBlackBg) {
      // Siyah / Koyu Arka Plan (CNC Kabartma Standardı)
      if (lum <= 18 || distToBg < 20) {
        mask[i] = 0.0;
      } else if (lum < 32 && distToBg < 35) {
        mask[i] = Math.max(0, (lum - 18) / 14);
      } else {
        mask[i] = 1.0;
      }
    } else if (isWhiteBg) {
      // Beyaz / Açık Arka Plan
      if (lum >= threshold || distToBg < 22) {
        mask[i] = 0.0;
      } else if (lum > threshold - 20) {
        mask[i] = Math.max(0, (threshold - lum) / 20);
      } else {
        mask[i] = 1.0;
      }
    } else if (isTransparentBg) {
      mask[i] = a;
    } else {
      mask[i] = 1.0;
    }
  }

  return mask;
}

/**
 * Çok Ölçekli Bas-Rölyef Detay Katmanı Oluşturucu (SculptOK Standardı)
 * Orijinal görseldeki kanat tüyleri, saç lifleri, kumaş kıvrımları ve yüz anatomisini
 * mikro, mezo ve yapısal frekans bantlarına ayırarak 3D kabartma detayına dönüştürür.
 */
export function extractBasReliefDetails(lumaData, width, height, detailScale = 1.0) {
  if (detailScale <= 0.01) return new Float32Array(width * height);

  // 1. Düzleştirilmiş / Işık dengelenmiş luma
  const broadLight = gaussianBlurFloat(lumaData, width, height, 16, 8.0);
  const flattened = new Float32Array(width * height);
  for (let i = 0; i < flattened.length; i++) {
    const orig = lumaData[i];
    const broad = broadLight[i];
    // Geniş çaplı gölge/ışık eğimlerini dengeler, yerel kontrastı korur
    flattened[i] = Math.max(0, Math.min(1, orig - 0.5 * (broad - 0.5)));
  }

  // 2. Çok Ölçekli Frekans Ayrıştırma (Multi-Scale Bandpass Filters)
  // Seviye 1: Mikro Detaylar (Tüy lifleri, kirpikler, saç telleri - Radius 1)
  const blur1 = gaussianBlurFloat(flattened, width, height, 1, 0.8);
  // Seviye 2: Mezo Detaylar (Kanat tüyleri, elbise kıvrımları, dudak/burun - Radius 4)
  const blur2 = gaussianBlurFloat(flattened, width, height, 4, 2.4);
  // Seviye 3: Yapısal Formlar (Ana kumaş dökümleri, kas hatları - Radius 12)
  const blur3 = gaussianBlurFloat(flattened, width, height, 12, 6.0);

  // Kenar büyütme/emboss özellikle açık-koyu sınırlarında halo üretir; kullanılmaz.
  // Detay yalnızca signed band-pass farklarından gelir ve bu nedenle çevreye yayılmaz.
  const detailMap = new Float32Array(width * height);
  const scale = detailScale * 2.2;

  for (let i = 0; i < detailMap.length; i++) {
    const f = flattened[i];
    const b1 = blur1[i];
    const b2 = blur2[i];
    const b3 = blur3[i];

    const fine = f - b1;        // Yüksek frekans
    const med = b1 - b2;        // Orta frekans
    const structure = b2 - b3;  // Yapısal frekans
    // Signed detay: parlak kontur eklemeden gerçek yerel topografyayı korur.
    const rawDetail = fine * 2.2 + med * 1.5 + structure * 0.8;

    // Tanh ile yumuşak sıkıştırma (sivri çapak yapmadan heykelimsi kabartma)
    detailMap[i] = Math.tanh(rawDetail * scale) * 0.45;
  }

  return detailMap;
}

/**
 * Parlak Işık & Patlama Telafisi (Specular & Sunbeam Suppression)
 * Fotoğraflardaki güneş ışınlarının ve aşırı parlak patlamaların rölyefte delik açmasını
 * veya devasa sivri dağlar oluşturmasını engeller.
 */
export function suppressSpecularHighlights(lumaData, width, height, strength = 0.8) {
  if (strength <= 0) return new Float32Array(lumaData);
  const out = new Float32Array(width * height);
  const blur = gaussianBlurFloat(lumaData, width, height, 8, 5.0);

  for (let i = 0; i < lumaData.length; i++) {
    const lum = lumaData[i];
    const broad = blur[i];

    // Eğer bölge geniş çapta çok parlaksa (güneş ışığı / gökyüzü gibi)
    if (broad > 0.65) {
      const over = (broad - 0.65) / 0.35;
      const damp = 1.0 - over * strength * 0.7;
      out[i] = lum * damp;
    } else {
      out[i] = lum;
    }
  }
  return out;
}

/**
 * Derinlik Eğrisi / Ton Dönüşümü (Bas-Relief S-Curve & Tone-mapping)
 */
export function applyToneCurve(val, curveType = 'linear', contrast = 1.0) {
  let v = Math.max(0, Math.min(1, val));
  if (contrast !== 1.0) {
    v = (v - 0.5) * contrast + 0.5;
    v = Math.max(0, Math.min(1, v));
  }

  switch (curveType) {
    case 's_curve':
      return v * v * (3 - 2 * v);
    case 'bas_relief_compress':
      // Doğal yumuşak sıkıştırma (Patlatma yapmaz, açık ton detaylarını korur)
      return (v * (1.0 + 0.25 * v)) / 1.25;
    case 'exponential':
      return Math.pow(v, 1.3);
    case 'linear':
    default:
      return v;
  }
}

/**
 * İğne ve Dikensi Gürültüleri Filtreleme (Despeckle / Spike Filter)
 * Tekil piksel kaynaklı sivri çukurları ve dağcıkları 8 komşu ortalamasıyla temizler.
 */
export function despeckleSpikesFloat(data, width, height, maxDiff = 0.06) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const v = data[idx];
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        out[idx] = v;
        continue;
      }
      const n0 = data[idx - width - 1];
      const n1 = data[idx - width];
      const n2 = data[idx - width + 1];
      const n3 = data[idx - 1];
      const n4 = data[idx + 1];
      const n5 = data[idx + width - 1];
      const n6 = data[idx + width];
      const n7 = data[idx + width + 1];
      const avg = (n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7) / 8.0;

      if (Math.abs(v - avg) > maxDiff) {
        out[idx] = avg;
      } else {
        out[idx] = v;
      }
    }
  }
  return out;
}

/**
 * Sürekli yerel kontrast: geniş formu korurken küçük frekansları yeniden ölçekler.
 * Hiçbir eşikleme veya foreground/background sınıflandırması yapmaz.
 */
export function enhanceLocalDepthContrast(data, width, height, radius = 12, amount = 0.22) {
  if (amount <= 0) return new Float32Array(data);
  const localMean = gaussianBlurFloat(data, width, height, radius, Math.max(1, radius * 0.55));
  const localSq = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) localSq[i] = data[i] * data[i];
  const localVariance = gaussianBlurFloat(localSq, width, height, radius, Math.max(1, radius * 0.55));
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const sigma = Math.sqrt(Math.max(0.00001, localVariance[i] - localMean[i] * localMean[i]));
    const normalized = (data[i] - localMean[i]) / (sigma * 2.5 + 0.08);
    out[i] = Math.max(0, Math.min(1, data[i] + normalized * amount));
  }
  return out;
}

/** Sürekli 0..1 normalizasyon; uç noktaları tüm görüntüden alır. */
export function normalizeContinuousDepth(data) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
  const range = max - min || 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.max(0, Math.min(1, (data[i] - min) / range));
  return out;
}

/**
 * Gerçek depth üzerinde kenarları keskinleştirir; luminance'ı yüksekliğe
 * dönüştürmez. Guidance yalnızca mevcut depth geçişlerinin nerede korunacağını
 * belirler, bu nedenle aydınlık arka planlar sahte tepe oluşturamaz.
 */
export function enhanceEdgeAwareDepth(data, guidance, width, height, amount = 0.35) {
  if (amount <= 0 || data.length === 0) return new Float32Array(data);
  const blurred = gaussianBlurFloat(data, width, height, 1, 0.8);
  const edges = normalizeContinuousDepth(computeSobelMagnitude(guidance, width, height));
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const edgeWeight = 1 + edges[i] * amount;
    out[i] = Math.max(0, Math.min(1, data[i] + (data[i] - blurred[i]) * edgeWeight));
  }
  return out;
}

function deriveSurfaceSlope(data, width, height) {
  const slope = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      const gx = (data[y * width + xp] - data[y * width + xm]) * 0.5;
      const gy = (data[yp * width + x] - data[ym * width + x]) * 0.5;
      slope[y * width + x] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 3.2);
    }
  }
  return gaussianBlurFloat(slope, width, height, 1, 0.8);
}

/**
 * Monoküler depth'in sahne perspektifini (özellikle yol/zemin rampasını)
 * kaldırır. Her satırın düşük değerli tabanını çıkararak nesnelerin kendi
 * rölyefini korur; böylece alt kadraj tek parça beyaz bir tepeye dönüşmez.
 */
function removeSceneDepthRamp(data, width, height, baselinePercentile = 0.2) {
  // Monoküler AI, zemini/kamerayı geniş bir eğimli yüzey olarak yorumlayabilir.
  // Bu geniş düşük frekanslı yüzeyi ayırmak, rölyefin tabanını düzleştirirken
  // insanlar, araçlar, tabela ve binaların yerel biçimlerini korur.
  if (!data.length || height < 3) return normalizeContinuousDepth(data);

  // AI haritasındaki geniş yüzey eğimini ayrıca ayır. Sadece satır tabanı
  // çıkarmak bu sahnedeki plakayı düzleştirmeye yetmiyordu; geniş Gaussian
  // taban, yol/zemin gibi düşük frekanslı eğimi temsil eder.
  const broad = gaussianBlurFloat(data, width, height, Math.max(8, Math.round(Math.min(width, height) / 18)), 12.0);
  const local = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) local[i] = data[i] - broad[i];
  const localNormalized = normalizeContinuousDepth(local);
  const original = normalizeContinuousDepth(data);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    // Lokal şekil/kenarlar öncelikli; makro depth'in küçük bir bölümü de
    // nesnelerin birbirine göre uzaklık bilgisini korur.
    out[i] = localNormalized[i] * 0.72 + original[i] * 0.28;
  }
  return normalizeContinuousDepth(out);
}

/**
 * Tam Bas-Rölyef Derinlik Matrisi İşleme Hattı (SculptOK Standardı)
 * @param {ImageData} imgData - Kaynak görsel piksel verisi
 * @param {Float32Array|null} aiDepthMap - (Varsa) Depth Anything V2 tarafından üretilen gerçek 3D derinlik
 * @param {Object} options - Filtre ve sıkıştırma ayarları
 * @returns {{ depthGrid: Float32Array, width: number, height: number }}
 */
export function processBasReliefPipeline(imgData, aiDepthMap = null, options = {}) {
  const {
    detailBoost = 0.35,        // Yüz/saç/tüy mikroyapı detay gücü (0.0 - 2.0)
    smoothRadius = 1,          // Bilateral pürüzsüzleştirme yarıçapı (0 - 6)
    highlightDamp = 0.7,       // Güneş ışığı & parlama telafisi (0.0 - 1.0)
    curve = 'linear',          // 'linear' | 's_curve' | 'bas_relief_compress' | 'exponential'
    contrast = 1.0,            // Kontrast çarpanı
    invert = false,            // Ters çevirme
    backgroundMode = 'natural', // Eski uyumluluk seçeneği; varsayılan sürekli yüzey
    bgThreshold = 245,           // Geriye dönük uyumluluk; depth için kullanılmaz
    edgeCrispness = 0.35,         // Anatomik kenar keskinliği (Unsharp Mask)
    taubinSmooth = 0,             // Taubin merdiven basamağı silici iterasyon sayısı
    localContrast = 0.0,          // Local-mean işlemleri sınır halosu üretebilir; signed band-pass kullanılır
    bevelWidth = 3,               // Saydam kenarlar için yumuşak CNC rampası (piksel)
    foregroundGain = 0.0,          // AI depth'te tekil üst-kuyruk sıkıştırması kapalı
    domeBevel = 0.16,              // Organik yüzey yumuşatma; halo/maske değildir
  } = options;

  const w = imgData.width;
  const h = imgData.height;
  const total = w * h;

  // 1. Sürekli yüzey tamponları ve illüstrasyon/kenar tespiti.
  const source = detectIllustrationSource(imgData, w, h, total);

  // 2. Makro + mezo + mikro hacim füzyonu ile temel derinliği kur.
  const { blended, detailLayer, hasAi, sceneCorrectedAi } = fuseBaseDepth(
    source, w, h, total, aiDepthMap, { detailBoost, highlightDamp }
  );

  // 3. Dome profili, ön plan kazanç eğrisi ve yerel kontrast ayarları.
  const domedAndGained = applyDomeAndGain(blended, w, h, total, {
    domeBevel, foregroundGain, localContrast, hasAi,
  });

  // 4. Ton eğrisi, yüzey pürüzsüzleştirme, kenar keskinleştirme ve detay geri ekleme.
  const edgeBoost = Math.max(0, Math.min(1.5, Number(options.edgeBoost ?? (hasAi ? 0.08 : 0.25))));
  const detailRetention = Math.max(0, Math.min(0.65, Number(options.detailRetention ?? 0.28)));
  const smoothed = applySurfaceToneAndSmoothing(domedAndGained, source, w, h, total, {
    curve,
    contrast,
    smoothRadius,
    taubinSmooth,
    edgeBoost,
    detailRetention,
    hasAi,
    sceneCorrectedAi,
    detailLayer,
  });

  // 5. Son dinamik aralık germe ve alfa/invert uygulaması.
  const finalDepth = finalizeDepth(smoothed, source, total, {
    invert,
    hasAi,
    useSourceIllustration: source.useSourceIllustration,
  });

  return {
    depthGrid: finalDepth,
    width: w,
    height: h,
  };
}

/**
 * Taubin Non-Shrinking Mesh / Grid Fairing (Terracing & Merdiven Basamağı Silici)
 * Geometriyi küçültmeden veya büzmeden yüksek frekanslı yüzey gürültüsünü yok eder.
 */
export function smoothMeshTaubin(data, width, height, iterations = 2, lambda = 0.33, mu = -0.34) {
  let curr = new Float32Array(data);
  const total = width * height;

  function laplacianStep(grid, factor) {
    const next = new Float32Array(total);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const v = grid[idx];

        let sum = 0;
        let count = 0;

        if (x > 0) { sum += grid[idx - 1]; count++; }
        if (x < width - 1) { sum += grid[idx + 1]; count++; }
        if (y > 0) { sum += grid[idx - width]; count++; }
        if (y < height - 1) { sum += grid[idx + width]; count++; }

        const avg = count > 0 ? sum / count : v;
        const delta = avg - v;
        next[idx] = Math.max(0, Math.min(1, v + factor * delta));
      }
    }
    return next;
  }

  for (let iter = 0; iter < iterations; iter++) {
    curr = laplacianStep(curr, lambda); // Pozitif adımla pürüzsüzleştir
    curr = laplacianStep(curr, mu);     // Negatif adımla büzülmeyi geri aç
  }

  return curr;
}

/**
 * Anatomik Detay Keskinleştirme (Unsharp Masking on Depth Grid)
 * Yüz hatlarını, burun köprüsünü, gözleri ve saç liflerini 3D STL'de belirginleştirir.
 */
export function crispenDepthFeatures(data, width, height, amount = 0.35, radius = 2) {
  if (amount <= 0.01) return new Float32Array(data);
  const blurred = gaussianBlurFloat(data, width, height, radius, 1.2);
  const out = new Float32Array(width * height);

  for (let i = 0; i < out.length; i++) {
    const orig = data[i];
    const diff = orig - blurred[i];
    out[i] = Math.max(0, Math.min(1, orig + diff * amount));
  }
  return out;
}

/**
 * Dinamik Aralık ve Yüzey Kontrastı Optimizasyonu (Percentile Normalization)
 */
export function applyPercentileNormalization(data, lowPct = 0.2, highPct = 99.8) {
  const total = data.length;
  if (total === 0) return new Float32Array(0);

  // Hızlı histogram ile yaklaşık percentile bulma
  const numBins = 1000;
  const hist = new Uint32Array(numBins);
  for (let i = 0; i < total; i++) {
    const bin = Math.min(numBins - 1, Math.max(0, Math.floor(data[i] * (numBins - 1))));
    hist[bin]++;
  }

  const lowCount = Math.floor((lowPct / 100) * total);
  const highCount = Math.floor((highPct / 100) * total);

  let acc = 0;
  let minVal = 0;
  for (let b = 0; b < numBins; b++) {
    acc += hist[b];
    if (acc >= lowCount) {
      minVal = b / (numBins - 1);
      break;
    }
  }

  acc = 0;
  let maxVal = 1;
  for (let b = 0; b < numBins; b++) {
    acc += hist[b];
    if (acc >= highCount) {
      maxVal = b / (numBins - 1);
      break;
    }
  }

  if (maxVal <= minVal) return new Float32Array(data);

  const range = maxVal - minVal;
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    out[i] = Math.max(0, Math.min(1, (data[i] - minVal) / range));
  }
  return out;
}

/**
 * Harici (dışarıda hazırlanmış) bir derinlik haritası görselinden doğrudan
 * depth grid üretir. Fotoğraf değil, zaten gri tonlamalı bir depth map
 * (ör. beyaz=yüzey/en yüksek, siyah=taban/en derin) beklenir — bu yüzden
 * processBasReliefPipeline'daki makro/mikro detay sentezi (AI blend,
 * highlight suppression, detail boost) burada UYGULANMAZ; sadece hafif bir
 * kenar-koruyucu pürüzsüzleştirme (CNC basamak azaltma) ve arka plan
 * düzleştirme/invert seçenekleri sunulur.
 *
 * @param {ImageData} imgData - Harici derinlik haritası (grayscale beklenir; renkli verilirse luma alınır)
 * @param {Object} options
 * @param {boolean} options.invert - Siyah/beyaz anlamını ters çevir
 * @param {number} options.smoothRadius - Bilateral pürüzsüzleştirme yarıçapı (0 = kapalı)
 * @param {string} options.backgroundMode - 'flat' | 'zero' | 'natural'
 * @param {number} options.bgThreshold - Arka plan parlaklık eşiği (0-255)
 * @returns {{ depthGrid: Float32Array, width: number, height: number }}
 */
export function buildDepthGridFromExternalMap(imgData, options = {}) {
  const {
    invert = false,
    smoothRadius = 0,
    backgroundMode = 'flat',
    bgThreshold = 245,
  } = options;

  const w = imgData.width;
  const h = imgData.height;
  const total = w * h;

  const rawLuma = new Float32Array(total);
  const alphaMask = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const r = imgData.data[i * 4] / 255;
    const g = imgData.data[i * 4 + 1] / 255;
    const b = imgData.data[i * 4 + 2] / 255;
    const a = imgData.data[i * 4 + 3] / 255;
    rawLuma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    alphaMask[i] = a;
  }

  // Depth map zaten hazır olduğu için sadece isteğe bağlı hafif bir
  // pürüzsüzleştirme uygulanır — detay sentezi / makro AI harmanlama yok.
  const smoothed = smoothRadius > 0
    ? bilateralFilterFloat(rawLuma, w, h, smoothRadius, 2.0, 0.08)
    : rawLuma;

  const finalDepth = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    let d = smoothed[i];
    const a = alphaMask[i];
    const lumVal = rawLuma[i] * 255;

    // Harici map de tam görüntü yüzeyidir: eşik tabanlı arka plan kesimi yoktur.
    if (invert) d = 1.0 - d;
    if (a < 1) d *= Math.max(0.05, a);

    finalDepth[i] = Math.max(0, Math.min(1, d));
  }

  return {
    depthGrid: finalDepth,
    width: w,
    height: h,
  };
}
/**
 * 4K Kenar Rehberli Derinlik Yükseltme (Joint Bilateral Upsampling)
 * Düşük çözünürlüklü AI depth haritasını, tam çözünürlüklü RGB luminance
 * rehberliğinde büyütür. Düz bilinear yükseltme "480p" hissi veren yumuşak
 * sınırlar üretir; bu yöntem kenarları kaynak görselin konturlarına kilitler,
 * böylece köşelerdeki geçişler hem keskin hem de basamaksız olur.
 */
export function upsampleDepthGuided(
  depth, depthW, depthH,
  guide, guideW, guideH,
  radius = 2, sigmaSpace = 2.2, sigmaRange = 0.09
) {
  if (depthW === guideW && depthH === guideH) return new Float32Array(depth);

  // Büyük görsellerde (>= 12MP) performans için ince ayar yarıçapını 1'e çek.
  const effRadius = guideW * guideH > 12_000_000 ? 1 : Math.max(1, Math.min(2, radius));

  // 1) Hızlı tam çözünürlük bilinear temel
  const up = new Float32Array(guideW * guideH);
  const scaleW = depthW / guideW;
  const scaleH = depthH / guideH;
  for (let y = 0; y < guideH; y++) {
    const fyy = y * scaleH;
    const y0 = Math.min(depthH - 1, Math.max(0, Math.floor(fyy)));
    const y1 = Math.min(depthH - 1, y0 + 1);
    const ty = fyy - y0;
    for (let x = 0; x < guideW; x++) {
      const fxx = x * scaleW;
      const x0 = Math.min(depthW - 1, Math.max(0, Math.floor(fxx)));
      const x1 = Math.min(depthW - 1, x0 + 1);
      const tx = fxx - x0;
      const d00 = depth[y0 * depthW + x0];
      const d10 = depth[y0 * depthW + x1];
      const d01 = depth[y1 * depthW + x0];
      const d11 = depth[y1 * depthW + x1];
      up[y * guideW + x] =
        (d00 * (1 - tx) + d10 * tx) * (1 - ty) + (d01 * (1 - tx) + d11 * tx) * ty;
    }
  }

  // 2) Kenar rehberli (joint bilateral) ince ayar — kenarlar RGB konturlarına hizalanır
  const out = new Float32Array(guideW * guideH);
  const twoS = 2 * sigmaSpace * sigmaSpace;
  const twoR = 2 * sigmaRange * sigmaRange;
  for (let y = 0; y < guideH; y++) {
    for (let x = 0; x < guideW; x++) {
      const idx = y * guideW + x;
      const gCenter = guide[idx];
      let wSum = 0;
      let vSum = 0;
      for (let ky = -effRadius; ky <= effRadius; ky++) {
        const ny = y + ky < 0 ? 0 : y + ky >= guideH ? guideH - 1 : y + ky;
        for (let kx = -effRadius; kx <= effRadius; kx++) {
          const nx = x + kx < 0 ? 0 : x + kx >= guideW ? guideW - 1 : x + kx;
          const nIdx = ny * guideW + nx;
          const gDiff = gCenter - guide[nIdx];
          const w = Math.exp(-(kx * kx + ky * ky) / twoS - (gDiff * gDiff) / twoR);
          wSum += w;
          vSum += w * up[nIdx];
        }
      }
      out[idx] = wSum > 0 ? vSum / wSum : up[idx];
    }
  }
  return out;
}

/**
 * Derinlik Haritası Kalite Kontrol & Düzeltme Motoru (QC)
 * Üretilen her depth haritası en fazla 2 doğrulama turundan geçer:
 *   Tur 1: NaN/tanımsız değer, tekil piksel sıçraması (spike) ve
 *          basamaklanma (terracing) skorları ölçülür. Temizse işlem biter.
 *   Tur 2: Sorun bulunursa -> spike temizleme + Taubin fairing ile düzeltilip
 *          yeniden doğrulanır (en fazla 2 tur, kullanıcı isteği gereği).
 * Rapor, kullanıcıya UI üzerinden gösterilir.
 */
export function verifyAndCorrectDepth(data, width, height) {
  const total = width * height;
  let grid = new Float32Array(data);
  const report = [];
  let passes = 0;

  function analyze(g) {
    let invalid = 0;
    let spikes = 0;
    let steps = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < total; i++) {
      const v = g[i];
      if (!Number.isFinite(v)) { invalid++; continue; }
      if (v < min) min = v;
      if (v > max) max = v;
      const x = i % width;
      if (x < width - 1 && Math.abs(g[i + 1] - v) > 0.1) steps++;
      if (i + width < total && Math.abs(g[i + width] - v) > 0.1) steps++;
    }

    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i = row + x;
        const v = g[i];
        const avg =
          (g[i - width - 1] + g[i - width] + g[i - width + 1] +
           g[i - 1] + g[i + 1] +
           g[i + width - 1] + g[i + width] + g[i + width + 1]) / 8;
        if (Math.abs(v - avg) > 0.06) spikes++;
      }
    }

    return {
      clean: invalid === 0 && spikes / total <= 0.003 && steps / (2 * total) <= 0.06,
      invalid,
      spikeRatio: spikes / total,
      stepRatio: steps / (2 * total),
      min,
      max,
    };
  }

  let stat = analyze(grid);
  report.push({ pass: 1, ...stat });

  if (!stat.clean) {
    // Düzeltme turu:
    // 1) NaN/Inf onarımı — komşu ortalaması (despeckle NaN'ı düzeltmez).
    const repaired = new Float32Array(total);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const v = grid[i];
        if (Number.isFinite(v)) { repaired[i] = v; continue; }
        let sum = 0, cnt = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const ny = y + ky;
          if (ny < 0 || ny >= height) continue;
          for (let kx = -1; kx <= 1; kx++) {
            const nx = x + kx;
            if (nx < 0 || nx >= width || (kx === 0 && ky === 0)) continue;
            const nv = grid[ny * width + nx];
            if (Number.isFinite(nv)) { sum += nv; cnt++; }
          }
        }
        repaired[i] = cnt > 0 ? sum / cnt : 0.5;
      }
    }
    grid = repaired;
    // 2) Sıçrama temizliği + Taubin fairing ile basamakların organik
    //    rampaya dönüştürülmesi (ani köşe geçişlerinin çözümü).
    grid = despeckleSpikesFloat(grid, width, height, 0.05);
    grid = smoothMeshTaubin(grid, width, height, 3, 0.33, -0.34);
    stat = analyze(grid);
    report.push({ pass: 2, ...stat });
    passes = 2;
  } else {
    passes = 1;
  }

  return {
    depthGrid: grid,
    passes,
    report: report.map((r) => ({ pass: r.pass, clean: r.clean })),
    metrics: report[report.length - 1],
  };
}

// ---------------------------------------------------------------------------
// processBasReliefPipeline aşama yardımcıları
// Aşırı büyük işleme hattını adlandırılmış, tek sorumluluklu aşamalara böler.
// ---------------------------------------------------------------------------

/**
 * 1. Aşama — Kaynak tamponları ve illüstrasyon tespiti.
 * Görselden sürekli yüzey (rawLuma/alpha) tamponlarını üretir ve kaynağın
 * şeffaf/illüstrasyon tabanlı mı yoksa fotoğraf mı olduğunu belirler. Şeffaf ya
 * da açık-nötr kenarlı görsellerde flood-fill ile arka plan maskesi çıkarır.
 */
function detectIllustrationSource(imgData, w, h, total) {
  const rawLuma = new Float32Array(total);
  const alphaMask = new Float32Array(total);
  let opaquePixels = 0;
  let neutralBorderPixels = 0;
  let visibleLumaMin = 1;
  let visibleLumaMax = 0;

  for (let i = 0; i < total; i++) {
    const r = imgData.data[i * 4] / 255;
    const g = imgData.data[i * 4 + 1] / 255;
    const b = imgData.data[i * 4 + 2] / 255;
    const a = imgData.data[i * 4 + 3] / 255;
    rawLuma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    alphaMask[i] = a;
    if (a > 0.98) opaquePixels++;
    if (a > 0.05) {
      visibleLumaMin = Math.min(visibleLumaMin, rawLuma[i]);
      visibleLumaMax = Math.max(visibleLumaMax, rawLuma[i]);
    }
  }

  const hasTransparentBackground = opaquePixels < total * 0.98;
  const isNeutralBorder = (x, y) => {
    const index = (y * w + x) * 4;
    const r = imgData.data[index] / 255;
    const g = imgData.data[index + 1] / 255;
    const b = imgData.data[index + 2] / 255;
    const a = imgData.data[index + 3] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return a < 0.08 || (lum > 0.68 && Math.max(r, g, b) - Math.min(r, g, b) < 0.12);
  };
  for (let x = 0; x < w; x++) {
    if (isNeutralBorder(x, 0)) neutralBorderPixels++;
    if (isNeutralBorder(x, h - 1)) neutralBorderPixels++;
  }
  for (let y = 1; y < h - 1; y++) {
    if (isNeutralBorder(0, y)) neutralBorderPixels++;
    if (isNeutralBorder(w - 1, y)) neutralBorderPixels++;
  }
  const borderPixelCount = Math.max(1, w * 2 + (h - 2) * 2);
  const hasIllustrationBorder = neutralBorderPixels / borderPixelCount > 0.12;
  const useSourceIllustration = hasTransparentBackground || hasIllustrationBorder;
  const illustrationMask = new Float32Array(total);

  if (useSourceIllustration) {
    illustrationMask.fill(1);
    const background = new Uint8Array(total);
    const queue = [];
    const isLightNeutral = (index) => {
      const r = imgData.data[index * 4] / 255;
      const g = imgData.data[index * 4 + 1] / 255;
      const b = imgData.data[index * 4 + 2] / 255;
      const a = imgData.data[index * 4 + 3] / 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return a < 0.08 || (lum > 0.68 && Math.max(r, g, b) - Math.min(r, g, b) < 0.12);
    };
    const enqueue = (x, y) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const index = y * w + x;
      if (background[index] || !isLightNeutral(index)) return;
      background[index] = 1;
      queue.push(index);
    };
    for (let x = 0; x < w; x++) { enqueue(x, 0); enqueue(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { enqueue(0, y); enqueue(w - 1, y); }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      const x = index % w;
      const y = Math.floor(index / w);
      enqueue(x - 1, y); enqueue(x + 1, y); enqueue(x, y - 1); enqueue(x, y + 1);
    }
    for (let i = 0; i < total; i++) {
      if (background[i]) illustrationMask[i] = 0;
      else if (imgData.data[i * 4 + 3] < 16) illustrationMask[i] = 0;
    }
  }

  const visibleLumaRange = Math.max(0.05, visibleLumaMax - visibleLumaMin);
  const smoothSourceLuma = useSourceIllustration
    ? gaussianBlurFloat(rawLuma, w, h, 3, 1.6)
    : null;

  return {
    rawLuma,
    alphaMask,
    useSourceIllustration,
    illustrationMask,
    visibleLumaMin,
    visibleLumaRange,
    smoothSourceLuma,
  };
}

/**
 * 2. Aşama — Makro/mezo/mikro hacim füzyonu.
 * AI makro derinliği (varsa) veya ışık-dengelenmiş parlaklığı, çok ölçekli
 * band-pass detay katmanıyla kaynaştırarak temel derinlik tamponunu üretir.
 * @returns {{ blended: Float32Array, detailLayer: Float32Array, hasAi: boolean, sceneCorrectedAi: Float32Array|null }}
 */
function fuseBaseDepth(source, w, h, total, aiDepthMap, { detailBoost, highlightDamp }) {
  const {
    rawLuma,
    alphaMask,
    useSourceIllustration,
    illustrationMask,
    visibleLumaMin,
    visibleLumaRange,
    smoothSourceLuma,
  } = source;

  const detailLayer = extractBasReliefDetails(rawLuma, w, h, detailBoost);
  const dampened = suppressSpecularHighlights(rawLuma, w, h, highlightDamp);
  const hasAi = Boolean(aiDepthMap && aiDepthMap.length === total);
  const sceneCorrectedAi = hasAi ? normalizeContinuousDepth(aiDepthMap) : null;
  const aiSurfaceSlope = hasAi ? deriveSurfaceSlope(sceneCorrectedAi, w, h) : null;

  const baseDepth = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    if (useSourceIllustration) {
      baseDepth[i] = illustrationMask[i] > 0.05 && alphaMask[i] > 0.05
        ? 0.34 + Math.max(0, Math.min(1, (smoothSourceLuma[i] - visibleLumaMin) / visibleLumaRange)) * 0.52 + detailLayer[i] * 0.06
        : 0;
      continue;
    }
    const macro = hasAi ? sceneCorrectedAi[i] : dampened[i];
    const surfaceDetail = hasAi ? aiSurfaceSlope[i] * 0.045 : 0;
    baseDepth[i] = macro * (hasAi ? 0.90 : 0.72) + dampened[i] * (hasAi ? 0.04 : 0.18)
      + detailLayer[i] * (hasAi ? 0.06 : 0.46) + surfaceDetail;
  }

  const blended = useSourceIllustration ? new Float32Array(baseDepth) : normalizeContinuousDepth(baseDepth);
  return { blended, detailLayer, hasAi, sceneCorrectedAi };
}

/**
 * 3. Aşama — Dome profili, ön plan kazanç eğrisi ve yerel kontrast.
 * Temel derinliği yerinde (in-place) şekillendir ve işlenmiş tamponu döner.
 */
function applyDomeAndGain(blended, w, h, total, { domeBevel, foregroundGain, localContrast, hasAi }) {
  const dome = Math.max(0, Math.min(0.35, Number(domeBevel)));
  if (dome > 0) {
    const domeBase = gaussianBlurFloat(blended, w, h, 1, 0.8);
    for (let i = 0; i < total; i++) blended[i] = blended[i] * (1 - dome) + domeBase[i] * dome;
  }

  const fgGain = Math.max(0, Math.min(0.8, Number(foregroundGain)));
  for (let i = 0; i < total; i++) {
    const d = blended[i];
    const upperTail = d * d * (3 - 2 * d);
    blended[i] = Math.min(1, d + fgGain * upperTail * (1 - d));
  }

  const effectiveLocalContrast = hasAi ? Math.max(0.12, Number(localContrast)) : Number(localContrast);
  if (effectiveLocalContrast > 0) {
    blended = enhanceLocalDepthContrast(blended, w, h, hasAi ? 10 : 12, effectiveLocalContrast);
  }
  return blended;
}

/**
 * 4. Aşama — Ton eğrisi, yüzey pürüzsüzleştirme, kenar keskinleştirme ve detay geri ekleme.
 * Ton eğrisini uygular, bilateral/Taubin ile yüzeyi düzler, sonra gerçek depth
 * geçişlerini keskinleştir ve signed mikro-topografyayı geri ekler.
 */
function applySurfaceToneAndSmoothing(blended, source, w, h, total, opts) {
  const { rawLuma, useSourceIllustration } = source;
  const {
    curve,
    contrast,
    smoothRadius,
    taubinSmooth,
    edgeBoost,
    detailRetention,
    hasAi,
    sceneCorrectedAi,
    detailLayer,
  } = opts;

  for (let i = 0; i < total; i++) {
    blended[i] = Math.max(0, Math.min(1, applyToneCurve(blended[i], curve, contrast)));
  }

  const despeckled = useSourceIllustration
    ? new Float32Array(blended)
    : despeckleSpikesFloat(blended, w, h, 0.05);
  const effectiveSmoothRadius = useSourceIllustration
    ? Math.max(2, smoothRadius)
    : Math.max(0, smoothRadius);
  let smoothed = effectiveSmoothRadius > 0
    ? bilateralFilterFloat(despeckled, w, h, effectiveSmoothRadius, 2.0, 0.08)
    : despeckled;

  if (taubinSmooth > 0) {
    smoothed = smoothMeshTaubin(smoothed, w, h, taubinSmooth, 0.30, -0.32);
  }

  if (edgeBoost > 0) {
    const edgeGuidance = hasAi
      ? (() => {
          const guidance = new Float32Array(total);
          for (let i = 0; i < total; i++) guidance[i] = sceneCorrectedAi[i] * 0.70 + rawLuma[i] * 0.30;
          return guidance;
        })()
      : rawLuma;
    smoothed = enhanceEdgeAwareDepth(smoothed, edgeGuidance, w, h, edgeBoost);
  }

  for (let i = 0; i < total; i++) {
    smoothed[i] = Math.max(0, Math.min(1, smoothed[i] + detailLayer[i] * detailRetention));
  }
  return smoothed;
}

/**
 * 5. Aşama — Son dinamik aralık germe, invert ve alfa kenar rampası.
 * Percentile normalizasyonu, ters çevirme ve şeffaflık kenarı uygulanarak nihai
 * 0..1 derinlik ızgarası üretilir.
 */
function finalizeDepth(smoothed, source, total, { invert, hasAi }) {
  const { alphaMask, useSourceIllustration, illustrationMask } = source;
  const ranged = useSourceIllustration
    ? smoothed
    : applyPercentileNormalization(smoothed, hasAi ? 0.35 : 0.2, hasAi ? 99.65 : 99.8);
  const finalDepth = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    let d = invert ? 1.0 - ranged[i] : ranged[i];
    if (useSourceIllustration && illustrationMask[i] <= 0.05) {
      finalDepth[i] = 0;
      continue;
    }
    if (useSourceIllustration && illustrationMask[i] > 0.05) {
      d = Math.max(d, 0.24 * Math.min(1, alphaMask[i] * 1.2));
    }
    if (alphaMask[i] < 1) {
      const edgeRamp = Math.max(0.05, Math.min(1, alphaMask[i]));
      d *= edgeRamp;
    }
    finalDepth[i] = Math.max(0, Math.min(1, d));
  }
  return finalDepth;
}
