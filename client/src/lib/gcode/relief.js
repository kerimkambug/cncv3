// relief.js
// Empire CNC — Profesyonel 3D Bas-Rölyef (3D Relief) G-Code Üretim Motoru
// Küre uçlu (Ballnose) takım telafisi, çift yönlü pürüzsüzleştirme ve çok açılı işleme.
import { fmt, fmt3 } from './common.js';

export const CNC_RELIEF_PRESETS = {
  wood_mdf: {
    id: 'wood_mdf',
    name: '🪵 Ahşap & MDF Kabartma (Pürüzsüz Yüzey — Önerilen)',
    desc: 'Ahşap liflerinde çapak yapmayan, basamaksız ve heykelsi pürüzsüz yüzey',
    detailBoost: 0.15,
    smoothRadius: 1,
    edgeCrispness: 0.20,
    taubinSmooth: 1,
    highlightDamp: 0.7,
    curve: 'linear',
    contrast: 1.0,
    backgroundMode: 'flat',
  },
  stone_marble: {
    id: 'stone_marble',
    name: '🏛️ Mermer, Taş & Alçı (Hassas Hatlar)',
    desc: 'Sert yüzeyler için mikron hassasiyetinde keskin detay ve derinlik',
    detailBoost: 0.22,
    smoothRadius: 1,
    edgeCrispness: 0.28,
    taubinSmooth: 1,
    highlightDamp: 0.75,
    curve: 'linear',
    contrast: 1.0,
    backgroundMode: 'flat',
  },
  portrait_photo: {
    id: 'portrait_photo',
    name: '🖼️ Fotoğraftan Doğal Portre Rölyef',
    desc: 'İnsan yüzleri ve ten dokusu için gürültüsüz, yumuşak anatomik geçiş',
    detailBoost: 0.12,
    smoothRadius: 1,
    edgeCrispness: 0.15,
    taubinSmooth: 1,
    highlightDamp: 0.85,
    curve: 'linear',
    contrast: 1.0,
    backgroundMode: 'flat',
  },
};

export const DEFAULT_RELIEF_CONFIG = {
  width: 200,             // Parça genişliği X (mm)
  height: 200,            // Parça yüksekliği Y (mm)
  thickness: 18,          // Malzeme kalınlığı (mm)
  maxDepth: 15,           // Maksimum işleme derinliği (mm) - 18mm malzeme için 15mm tam Z kullanımı
  stepover: 0.6,          // Raster satır aralığı / adım (mm) (SculptOK: 0.4 - 0.8mm)
  resolution: 0.5,        // X/Y ekseni örnekleme hassasiyeti (mm)
  toolType: 'ballnose',   // 'ballnose' (Küre Uç) | 'flat' (Düz Uç) | 'vbit' (V-Bıçak)
  toolDia: 4.0,           // Bıçak Çapı (mm)
  toolNo: '1',            // Bıçak Numarası
  spindleSpeed: 18000,    // Devir / Spindle hızı (RPM)
  plungeFeed: 1200,       // Dalma hızı (mm/dk)
  cutFeed: 4000,          // Kesim / İlerleme hızı (mm/dk)
  safeZ: 25,              // Güvenli kalkış Z (mm)
  homeZ: 60,              // Home / Park Z (mm)
  preset: 'wood_mdf',     // Otomatik CNC Preset
  backgroundMode: 'natural', // Sürekli çok düzlemli yüzey; 'flat'/'zero' legacy
  invert: false,          // Siyah/Beyaz derinlik ters çevirme
  useBackgroundMask: true, // AI arka plan maskesi
  contrast: 1.0,          // Kontrast çarpanı
  brightness: 0,          // Parlaklık ofseti
  detailBoost: 0.15,      // İnce detay güçlendirme (pürüzsüz & tırtıksız)
  smoothRadius: 1,        // Bilateral pürüzsüzleştirme (0 - 6, net hatlar için 1)
  externalBgThreshold: 18, // Harici depth map koyu fon eşiği (0 - 255)
  edgeCrispness: 0.20,    // Anatomik kenar keskinliği (0.0 - 1.0)
  taubinSmooth: 1,        // Taubin yüzey düzleştirme iterasyonu (0 - 4)
  stlQuality: 1024,       // STL Mesh Çözünürlüğü: 512 | 1024 | 1536
  highlightDamp: 0.7,     // Güneş ışığı / parlama telafisi
  curve: 'linear',        // 'linear' (Doğal / Patlamasız)
  direction: 'x',         // 'x' (yatay) | 'y' (dikey) | 'diag' (45° çapraz) | 'cross'
  enableOuterCut: true,   // İşleme sonrası dış kontur kesimi
  outerCutToolNo: '6',    // Dış kesim bıçak no
  outerCutDia: 6,         // Dış kesim bıçak çapı (mm)
  threshold: 245,         // Arka plan algılama eşiği (0-255)

  // --- Heykelsi (sculpted) motor parametreleri -------------------------------
  // Çoğu motor-içi ve gizlidir; kullanıcıya yalnızca birkaçı açıktır.
  sculptMacroStrength: 0.85,      // L1 makro hacim
  sculptMediumStrength: 1.25,     // L2 orta form
  sculptFineStrength: 0.65,       // L3 ince detay
  sculptMicroStrength: 0.30,      // L4 mikro detay
  sculptDepthInfluence: 0.55,     // AI depth'in forma katkısı (tek form kaynağı)
  sculptContinuity: 0.38,         // yüzey sürekliliği (harmonic regularization)
  sculptSmoothness: 0.5,          // form-aware smoothing gücü
  sculptEdgeInfluence: 0.05,      // yüzey detayı (luminance sızıntısını kesmek için düşük)
  sculptSemanticInfluence: 0.0,   // form üretmez (uyumluluk)
  sculptCurvature: 0.04,          // yalnızca gerçek form bölgelerinde hafif kavis
  sculptReliefContrast: 1.0,      // kullanıcı: rölyef kontrastı (shaping)
  sculptBackgroundDepth: 0.06,    // kullanıcı: arka plan taban Z (0 = düz)
  sculptBackgroundMode: 'soft-falloff', // 'flat' | 'dome' | 'soft-falloff'

  // --- Sanatsal Kabartma (Pillow Emboss / SculptOK kalitesi) parametreleri -----
  // Obje solid maskelenir; maskeye düz taban + iç kavisli bombe basılır.
  // Parlamalar bastırılır → ışık sivri diken yapmaz. AI depth'e bağımlı değildir.
  artBaseZ: 0.45,                 // kullanıcı: Gövde Yüksekliği (solid objenin taban Z'si)
  artEmboss: 0.5,                 // kullanıcı: Gövde Bombesi (kavisli hacim gücü)
  artDetailAmount: 0.12,          // ince detay (%10-15), highlight-bastırılmış
  artMacroDepthInfluence: 0.10,   // AI depth'in çok hafif makro katkısı
  artReliefContrast: 1.0,         // kullanıcı: Rölyef Kontrastı
  artSmoothness: 0.4,             // yüzey yumuşaklığı
  artBackgroundDepth: 0.0,        // kullanıcı: Zemin Derinliği (0 = düz siyah)
};

/**
 * 2D Derinlik Matrisinden (Float32Array) iki doğrusal (Bilinear) örnekleme yapar.
 * u, v: 0.0 - 1.0 (Normalleştirilmiş koordinatlar)
 */
export function sampleDepthGridUV(depthGrid, cols, rows, u, v) {
  const x = Math.max(0, Math.min(cols - 1, u * (cols - 1)));
  const y = Math.max(0, Math.min(rows - 1, (1 - v) * (rows - 1))); // CNC: Alt-sol = (0,0)

  const x0 = Math.floor(x);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(rows - 1, y0 + 1);

  const dx = x - x0;
  const dy = y - y0;

  const d00 = depthGrid[y0 * cols + x0];
  const d10 = depthGrid[y0 * cols + x1];
  const d01 = depthGrid[y1 * cols + x0];
  const d11 = depthGrid[y1 * cols + x1];

  const top = d00 * (1 - dx) + d10 * dx;
  const btm = d01 * (1 - dx) + d11 * dx;
  const d = top * (1 - dy) + btm * dy;

  // Eğim (Gradient) hesaplama - Küre uçlu bıçak telafisi için
  const gradX = (d10 - d00) * (1 - dy) + (d11 - d01) * dy;
  const gradY = (d01 - d00) * (1 - dx) + (d11 - d10) * dx;

  return { d, gradX, gradY };
}

/**
 * Küre Uçlu Bıçak (Ballnose) Geometri Telafisi ile Z Yüksekliği Hesaplama
 * Fiziksel mm bazlı eğim kullanır, aşırı derin dalmaları ve titreşimi sınırlar.
 */
export function calculateCompensatedZ(depthRatio, gradX, gradY, cfg, cellW_mm = 1.0, cellH_mm = 1.0) {
  const thickness = Number(cfg.thickness) || 18;
  const maxDepth = Number(cfg.maxDepth) || 5;
  const toolType = cfg.toolType || 'ballnose';
  const toolRadius = (Number(cfg.toolDia) || 4.0) / 2;

  // Fiziksel yüzey Z kotu: Yüzey = thickness, Taban = thickness - maxDepth
  const clampedDepth = Math.max(0, Math.min(1, depthRatio));
  const surfaceZ = thickness - (1.0 - clampedDepth) * maxDepth;

  if (toolType !== 'ballnose' || toolRadius <= 0) {
    return surfaceZ;
  }

  // Fiziksel eğim (mm/mm): Aşırı dik duvarlarda takımın gereksiz derin dalmasını önlemek için sınırlandırılır
  const dzdx = (gradX * maxDepth) / Math.max(0.1, cellW_mm);
  const dzdy = (gradY * maxDepth) / Math.max(0.1, cellH_mm);
  const slopeSq = Math.min(3.0, dzdx * dzdx + dzdy * dzdy);

  const cosTheta = 1.0 / Math.sqrt(1.0 + slopeSq);
  // Küre temas noktası ofseti (maksimum takım yarıçapının %35'i ile sınırlandırılır)
  const maxOffset = toolRadius * 0.35;
  const compensationOffset = Math.min(maxOffset, toolRadius * (1.0 - cosTheta));

  // Küreyi eğimli yüzeyden uzak tutmak için takımı yüzeye doğru değil yukarı kaldır.
  return surfaceZ + compensationOffset;
}

/**
 * Takım yolu üzerindeki Z titreşimlerini ve sivri dikensi gürültüleri filtreler (Pürüzsüz CNC Hareketi)
 */
function smoothZTrack(points, windowSize = 3) {
  if (points.length < windowSize || windowSize <= 1) return points;
  const half = Math.floor(windowSize / 2);
  const out = [];

  for (let i = 0; i < points.length; i++) {
    let sumZ = 0;
    let count = 0;
    for (let k = -half; k <= half; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < points.length) {
        sumZ += points[idx].z;
        count++;
      }
    }
    out.push({
      x: points[i].x,
      y: points[i].y,
      z: +(sumZ / count).toFixed(3),
    });
  }
  return out;
}

/**
 * Düz / doğrusal hatlar üzerindeki gereksiz noktaları filtreler (G-Code dosya boyutunu %60 küçültür)
 */
export function simplifyPathPoints(points, tolerance = 0.01) {
  if (points.length <= 2) return points;
  const result = [points[0]];
  let prev = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];

    const expectedZ = prev.z + (next.z - prev.z) * ((curr.x - prev.x) / (next.x - prev.x || 1));
    if (Math.abs(curr.z - expectedZ) > tolerance) {
      result.push(curr);
      prev = curr;
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

/**
 * İşlenmiş Derinlik Matrisinden (Float32Array) Profesyonel CNC Rölyef G-Code Üretir.
 * @param {Float32Array} depthGrid - 0.0 (Taban / En Derin) - 1.0 (Üst Yüzey)
 * @param {number} gridCols - Matris sütun sayısı
 * @param {number} gridRows - Matris satır sayısı
 * @param {typeof DEFAULT_RELIEF_CONFIG} cfg - İşleme parametreleri
 * @returns {{ gcode: string, pointCount: number, lineCount: number }}
 */
export function buildReliefGcodeFromDepthGrid(depthGrid, gridCols, gridRows, cfg) {
  const width = Math.max(1, Number(cfg.width) || 200);
  const height = Math.max(1, Number(cfg.height) || 200);
  const thickness = Number(cfg.thickness) || 18;
  const maxDepth = Number(cfg.maxDepth) || 5;
  const stepover = Math.max(0.1, Number(cfg.stepover) || 0.6);
  const resolution = Math.max(0.1, Number(cfg.resolution) || 0.5);
  const plungeFeed = Number(cfg.plungeFeed) || 1200;
  const cutFeed = Number(cfg.cutFeed) || 4000;
  const safeZ = Number(cfg.safeZ) || 25;
  const homeZ = Number(cfg.homeZ) || 60;
  const toolNo = cfg.toolNo || '1';
  const toolType = cfg.toolType || 'ballnose';
  const toolDia = Number(cfg.toolDia) || 4;
  const spindleSpeed = Number(cfg.spindleSpeed) || 18000;
  const direction = cfg.direction || 'x';

  const lines = ['makro'];
  lines.push(`(========================================)`);
  lines.push(`( EMPIRE CNC - 3D BAS-ROLYEF G-CODE MOTORU )`);
  lines.push(`( Boyutlar: ${width}x${height} mm | Kalinlik: ${thickness} mm )`);
  lines.push(`( Maks Derinlik: ${maxDepth} mm | Adim: ${stepover} mm )`);
  lines.push(`( Takim: ${toolType === 'ballnose' ? 'Kure Uc (Ballnose)' : 'Duz Freze'} R${(toolDia/2).toFixed(1)}mm T${toolNo} )`);
  lines.push(`(========================================)`);

  lines.push(`G0 Z${fmt(safeZ)}`);
  lines.push(`M6T${toolNo}`);
  lines.push(`M3 S${spindleSpeed}`);
  lines.push(`G0 X0.00 Y0.00 Z${fmt(safeZ)}`);

  let totalPoints = 0;
  let isToolDown = false;

  const passes = direction === 'cross' ? ['x', 'y'] : [direction];
  const cellW_mm = width / Math.max(1, gridCols - 1);
  const cellH_mm = height / Math.max(1, gridRows - 1);

  for (const dir of passes) {
    if (dir === 'x') {
      const ySteps = Math.ceil(height / stepover);
      const xSteps = Math.ceil(width / resolution);

      for (let j = 0; j <= ySteps; j++) {
        const y = Math.min(height, j * stepover);
        const isReverse = j % 2 === 1;
        const rowPoints = [];

        for (let i = 0; i <= xSteps; i++) {
          const stepIdx = isReverse ? (xSteps - i) : i;
          const x = Math.min(width, stepIdx * (width / xSteps));

          const u = x / width;
          const v = y / height;
          const { d, gradX, gradY } = sampleDepthGridUV(depthGrid, gridCols, gridRows, u, v);
          const z = calculateCompensatedZ(d, gradX, gradY, cfg, cellW_mm, cellH_mm);

          rowPoints.push({ x, y, z: +z.toFixed(3) });
        }

        const smoothedRow = smoothZTrack(rowPoints, 3);
        const optimizedRow = simplifyPathPoints(smoothedRow, 0.006);
        for (let pIdx = 0; pIdx < optimizedRow.length; pIdx++) {
          const p = optimizedRow[pIdx];
          if (!isToolDown) {
            lines.push(`G0 X${fmt(p.x)} Y${fmt(p.y)} Z${fmt(safeZ)}`);
            lines.push(`G1 Z${fmt3(p.z)} F${plungeFeed.toFixed(1)}`);
            isToolDown = true;
          } else {
            lines.push(`G1 X${fmt(p.x)} Y${fmt(p.y)} Z${fmt3(p.z)} F${cutFeed.toFixed(1)}`);
          }
          totalPoints++;
        }
      }
    } else {
      // Y-axis Raster
      const xSteps = Math.ceil(width / stepover);
      const ySteps = Math.ceil(height / resolution);

      for (let i = 0; i <= xSteps; i++) {
        const x = Math.min(width, i * stepover);
        const isReverse = i % 2 === 1;
        const colPoints = [];

        for (let j = 0; j <= ySteps; j++) {
          const stepIdx = isReverse ? (ySteps - j) : j;
          const y = Math.min(height, stepIdx * (height / ySteps));

          const u = x / width;
          const v = y / height;
          const { d, gradX, gradY } = sampleDepthGridUV(depthGrid, gridCols, gridRows, u, v);
          const z = calculateCompensatedZ(d, gradX, gradY, cfg, cellW_mm, cellH_mm);

          colPoints.push({ x, y, z: +z.toFixed(3) });
        }

        const smoothedCol = smoothZTrack(colPoints, 3);
        const optimizedCol = simplifyPathPoints(smoothedCol, 0.006);
        for (let pIdx = 0; pIdx < optimizedCol.length; pIdx++) {
          const p = optimizedCol[pIdx];
          if (!isToolDown) {
            lines.push(`G0 X${fmt(p.x)} Y${fmt(p.y)} Z${fmt(safeZ)}`);
            lines.push(`G1 Z${fmt3(p.z)} F${plungeFeed.toFixed(1)}`);
            isToolDown = true;
          } else {
            lines.push(`G1 X${fmt(p.x)} Y${fmt(p.y)} Z${fmt3(p.z)} F${cutFeed.toFixed(1)}`);
          }
          totalPoints++;
        }
      }
    }
  }

  // Lift tool
  lines.push(`G0 Z${fmt(safeZ)}`);

  // Dış Kontur Kesimi (Ebatlama)
  if (cfg.enableOuterCut) {
    const cutTool = cfg.outerCutToolNo || '6';
    const cutDia = Number(cfg.outerCutDia) || 6;
    const cutRadius = cutDia / 2;
    const toolChangeZ = safeZ + 30;

    lines.push(`(========================================)`);
    lines.push(`( DIS KONTUR / EBATLAMA KESIMI )`);
    lines.push(`(========================================)`);
    lines.push(`G0 Z${fmt(toolChangeZ)}`);
    lines.push(`M5`);
    lines.push(`M6T${cutTool}`);
    lines.push(`M3 S${spindleSpeed}`);
    lines.push(`G0 X${fmt(-cutRadius)} Y${fmt(-cutRadius)} Z${fmt(safeZ)}`);
    lines.push(`G1 Z0.000 F${plungeFeed.toFixed(1)}`);
    lines.push(`G1 X${fmt(width + cutRadius)} F${cutFeed.toFixed(1)}`);
    lines.push(` Y${fmt(height + cutRadius)} `);
    lines.push(`X${fmt(-cutRadius)}  `);
    lines.push(` Y${fmt(-cutRadius)} `);
    lines.push(`G0 Z${fmt(safeZ)}`);
  }

  // Program Finish & Park
  lines.push(`G0 X0.00 Y0.00 Z${fmt(homeZ)}`);
  lines.push(`G0 Z${fmt(homeZ)}`);
  lines.push(`X0.00 Y0.00`);
  lines.push(`M5`);
  lines.push(`M16`);
  lines.push(`M30`);

  return {
    gcode: lines.join('\n'),
    pointCount: totalPoints,
    lineCount: lines.length,
  };
}

/**
 * Geriye dönük uyumluluk için ImageData üzerinden çağırma fonksiyonu
 */
export function buildReliefGcodeFromImageData(imgData, cfg) {
  const cols = imgData.width;
  const rows = imgData.height;
  const total = cols * rows;
  const grid = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const r = imgData.data[i * 4];
    const g = imgData.data[i * 4 + 1];
    const b = imgData.data[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    grid[i] = cfg.invert ? (255 - lum) / 255 : lum / 255;
  }

  return buildReliefGcodeFromDepthGrid(grid, cols, rows, cfg);
}

/**
 * Estimates total relief carving time in minutes.
 */
export function estimateReliefTime(result, cfg) {
  if (!result || !result.gcode) return 0;
  const lines = result.gcode.split('\n');
  const cutFeed = Number(cfg.cutFeed) || 4500;
  const plungeFeed = Number(cfg.plungeFeed) || 1500;
  const rapidFeed = 15000;

  let totalMinutes = 0;
  let cx = 0, cy = 0, cz = Number(cfg.safeZ) || 25;

  lines.forEach((l) => {
    const line = l.trim();
    if (!line.startsWith('G0') && !line.startsWith('G1')) return;

    const xMatch = line.match(/X([-\d.]+)/);
    const yMatch = line.match(/Y([-\d.]+)/);
    const zMatch = line.match(/Z([-\d.]+)/);

    const nx = xMatch ? parseFloat(xMatch[1]) : cx;
    const ny = yMatch ? parseFloat(yMatch[1]) : cy;
    const nz = zMatch ? parseFloat(zMatch[1]) : cz;

    const dist = Math.hypot(nx - cx, ny - cy, nz - cz);

    if (line.startsWith('G0')) {
      totalMinutes += dist / rapidFeed;
    } else if (line.startsWith('G1')) {
      if (nx === cx && ny === cy && nz !== cz) {
        // Pure Z plunge move
        totalMinutes += dist / plungeFeed;
      } else {
        totalMinutes += dist / cutFeed;
      }
    }

    cx = nx;
    cy = ny;
    cz = nz;
  });

  return totalMinutes;
}
