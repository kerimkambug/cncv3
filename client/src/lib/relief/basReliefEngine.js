// basReliefEngine.js
// Empire CNC — Harici Derinlik Haritası & CNC Yüzey Yardımcı Motoru
// Harici (hazır) gri tonlamalı depth map'i doğrudan depth grid'e çevir;
// ayrıca STL/G-code için pürüzsüzleştirme, despeckle ve keskinleştirme yardımcıları sunar.

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
 * Harici (dışarıda hazırlanmış) bir derinlik haritası görselinden doğrudan
 * depth grid üretir. Fotoğraf değil, zaten gri tonlamalı bir depth map
 * (ör. beyaz=yüzey/en yüksek, siyah=taban/en derin) beklenir — bu yüzden
 * foto-detay sentezi / AI harmanlama UYGULANMAZ; sadece hafif bir
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
    bgThreshold = 18,
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
  const mode = ['natural', 'flat', 'zero'].includes(backgroundMode) ? backgroundMode : 'flat';
  const threshold = Math.max(0, Math.min(255, Number(bgThreshold) || 0)) / 255;
  for (let i = 0; i < total; i++) {
    let d = smoothed[i];
    const a = alphaMask[i];
    const isBackground = d <= threshold;

    if (mode === 'zero') {
      d = isBackground ? 0 : d;
    } else if (mode === 'flat') {
      // Koyu fonu düz tabana alırken nesnenin kalan aralığını koru.
      d = isBackground ? 0 : (d - threshold) / Math.max(1e-6, 1 - threshold);
    }
    if (invert && (mode === 'natural' || !isBackground)) d = 1.0 - d;
    if (a < 1) d *= Math.max(0.05, a);

    finalDepth[i] = Math.max(0, Math.min(1, d));
  }

  return {
    depthGrid: finalDepth,
    width: w,
    height: h,
  };
}