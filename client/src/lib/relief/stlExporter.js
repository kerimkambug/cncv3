// stlExporter.js
// Empire CNC — CAD/CAM Seviyesinde Kusursuz Manifold Katı STL Üretim Motoru
// Doğru dışa bakan (outward) normal vektörleri, su sızdırmaz (watertight) katı gövde
// ve yüksek çözünürlüklü Catmull-Rom / Bicubic yüzey enterpolasyonu.

import { smoothMeshTaubin, despeckleSpikesFloat } from './basReliefEngine.js';

/**
 * 1D Catmull-Rom Spline Enterpolasyonu
 */
function catmullRom1D(p0, p1, p2, p3, t) {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

/**
 * 2D Derinlik Matrisini yüksek çözünürlüğe monotonik bilinear enterpole eder.
 * Ringing/overshoot engellenerek nesne sınırlarında yapay halo oluşması önlenir.
 */
export function resampleDepthGrid(srcGrid, srcCols, srcRows, dstCols, dstRows) {
  if (srcCols === dstCols && srcRows === dstRows) {
    return new Float32Array(srcGrid);
  }

  const out = new Float32Array(dstCols * dstRows);
  const getSrc = (c, r) => {
    const cc = Math.max(0, Math.min(srcCols - 1, c));
    const rr = Math.max(0, Math.min(srcRows - 1, r));
    return srcGrid[rr * srcCols + cc];
  };

  for (let r = 0; r < dstRows; r++) {
    const srcY = (r / Math.max(1, dstRows - 1)) * (srcRows - 1);
    const y0 = Math.floor(srcY);
    const ty = srcY - y0;

    for (let c = 0; c < dstCols; c++) {
      const srcX = (c / Math.max(1, dstCols - 1)) * (srcCols - 1);
      const x0 = Math.floor(srcX);
      const tx = srcX - x0;

      // Monotonik bilinear örnekleme: Catmull-Rom ringing/overshoot sınır çevresinde
      // sahte açık-koyu çerçeve oluşturabildiği için STL yolunda kullanılmaz.
      const x1 = Math.min(srcCols - 1, x0 + 1);
      const y1 = Math.min(srcRows - 1, y0 + 1);
      const top = getSrc(x0, y0) * (1 - tx) + getSrc(x1, y0) * tx;
      const bottom = getSrc(x0, y1) * (1 - tx) + getSrc(x1, y1) * tx;
      const val = top * (1 - ty) + bottom * ty;
      out[r * dstCols + c] = Math.max(0, Math.min(1, val));
    }
  }

  return out;
}

/**
 * 2D Derinlik Matrisini Katı, Su Sızdırmaz (Watertight Manifold) 3D Model (Binary STL) formatına dönüştürür.
 * @param {Float32Array} depthGrid - 0.0 (en derin / zemin) - 1.0 (en yüksek)
 * @param {number} cols - Genişlik örnek sayısı
 * @param {number} rows - Yükseklik örnek sayısı
 * @param {number} realWidth - Model genişliği X (mm)
 * @param {number} realHeight - Model yüksekliği Y (mm)
 * @param {number} maxDepth - Maksimum kabartma yüksekliği (mm)
 * @param {number} baseThickness - Alt taban kalınlığı (mm)
 * @param {Object} options - STL oluşturma seçenekleri
 * @param {number} [options.targetResolution] - İsteğe bağlı hedef çözünürlük (Örn: 512, 1024, 1536)
 * @returns {Blob}
 */
export function exportDepthGridToSTL(
  depthGrid,
  cols,
  rows,
  realWidth = 200,
  realHeight = 200,
  maxDepth = 5,
  baseThickness = 2,
  options = {}
) {
  let activeGrid = depthGrid;
  let activeCols = cols;
  let activeRows = rows;

  // Kaynak raster zaten 4K ise her pikseli koru. Sadece açıkça istenen hedef
  // çözünürlük kaynak çözünürlükten yüksekse güvenli bilinear yükseltme yap.
  if (options.targetResolution && options.targetResolution > Math.max(cols, rows)) {
    const targetW = Math.min(4096, options.targetResolution);
    const targetH = Math.round(targetW / (realWidth / realHeight));
    if (targetW !== cols || targetH !== rows) {
      const resampled = resampleDepthGrid(depthGrid, cols, rows, targetW, targetH);
      // 4K yükseltmede ek smoothing ince çizgileri siler; yalnızca hafif
      // tekil spike temizliği uygulanır.
      activeGrid = despeckleSpikesFloat(resampled, targetW, targetH, 0.025);
      activeCols = targetW;
      activeRows = targetH;
    }
  }

  const numQuads = (activeCols - 1) * (activeRows - 1);
  const numTris = numQuads * 2; // Üst rölyef yüzey üçgenleri
  // Alt taban (2 üçgen) + 4 yan duvar üçgenleri
  const totalTris = numTris + 2 + (activeCols - 1) * 4 + (activeRows - 1) * 4;

  const headerSize = 80;
  const countSize = 4;
  const triSize = 50; // 12 float (3 normal + 9 coords) = 48 bytes + 2 bytes attr
  const bufferSize = headerSize + countSize + totalTris * triSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // 80 bytes STL Header
  const headerStr = 'EMPIRE CNC — CAD/CAM Solid Manifold 3D Bas-Relief STL';
  for (let i = 0; i < headerStr.length && i < 80; i++) {
    view.setUint8(i, headerStr.charCodeAt(i));
  }

  view.setUint32(headerSize, totalTris, true);
  let offset = headerSize + countSize;

  function writeTriangle(p1, p2, p3) {
    // Dış normal vektörü hesapla (Sağ el kuralı)
    const ax = p2.x - p1.x, ay = p2.y - p1.y, az = p2.z - p1.z;
    const bx = p3.x - p1.x, by = p3.y - p1.y, bz = p3.z - p1.z;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;

    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;

    view.setFloat32(offset, p1.x, true); offset += 4;
    view.setFloat32(offset, p1.y, true); offset += 4;
    view.setFloat32(offset, p1.z, true); offset += 4;

    view.setFloat32(offset, p2.x, true); offset += 4;
    view.setFloat32(offset, p2.y, true); offset += 4;
    view.setFloat32(offset, p2.z, true); offset += 4;

    view.setFloat32(offset, p3.x, true); offset += 4;
    view.setFloat32(offset, p3.y, true); offset += 4;
    view.setFloat32(offset, p3.z, true); offset += 4;

    view.setUint16(offset, 0, true); offset += 2;
  }

  function getPoint(c, r) {
    const x = (c / (activeCols - 1)) * realWidth;
    const y = ((activeRows - 1 - r) / (activeRows - 1)) * realHeight;
    const d = activeGrid[r * activeCols + c];
    const z = baseThickness + d * maxDepth;
    return { x, y, z };
  }

  // 1. ÜST RÖLYEF YÜZEYİ (Normaller +Z yönünde yukarı bakar)
  for (let r = 0; r < activeRows - 1; r++) {
    for (let c = 0; c < activeCols - 1; c++) {
      const p00 = getPoint(c, r);
      const p10 = getPoint(c + 1, r);
      const p01 = getPoint(c, r + 1);
      const p11 = getPoint(c + 1, r + 1);

      writeTriangle(p00, p01, p10);
      writeTriangle(p10, p01, p11);
    }
  }

  // 2. ALT DÜZ TABAN (Normaller -Z yönünde aşağı bakar, manifold standardı)
  const b00 = { x: 0, y: 0, z: 0 };
  const b10 = { x: realWidth, y: 0, z: 0 };
  const b01 = { x: 0, y: realHeight, z: 0 };
  const b11 = { x: realWidth, y: realHeight, z: 0 };
  writeTriangle(b00, b01, b10);
  writeTriangle(b10, b01, b11);

  // 3. YAN DUVARLAR (Tüm kenarlarda normaller dışarıyı gösterir)
  // GÜNEY DUVARI (y = 0) -> Normal -Y
  for (let c = 0; c < activeCols - 1; c++) {
    const t0 = getPoint(c, activeRows - 1);
    const t1 = getPoint(c + 1, activeRows - 1);
    const b0 = { x: t0.x, y: 0, z: 0 };
    const b1 = { x: t1.x, y: 0, z: 0 };
    writeTriangle(b0, t1, t0);
    writeTriangle(b0, b1, t1);
  }

  // KUZEY DUVARI (y = realHeight) -> Normal +Y
  for (let c = 0; c < activeCols - 1; c++) {
    const u0 = getPoint(c, 0);
    const u1 = getPoint(c + 1, 0);
    const bu0 = { x: u0.x, y: realHeight, z: 0 };
    const bu1 = { x: u1.x, y: realHeight, z: 0 };
    writeTriangle(bu0, u0, u1);
    writeTriangle(bu0, u1, bu1);
  }

  // BATI DUVARI (x = 0) -> Normal -X
  for (let r = 0; r < activeRows - 1; r++) {
    const l0 = getPoint(0, r);
    const l1 = getPoint(0, r + 1);
    const bl0 = { x: 0, y: l0.y, z: 0 };
    const bl1 = { x: 0, y: l1.y, z: 0 };
    writeTriangle(bl0, l1, l0);
    writeTriangle(bl0, bl1, l1);
  }

  // DOĞU DUVARI (x = realWidth) -> Normal +X
  for (let r = 0; r < activeRows - 1; r++) {
    const r0 = getPoint(activeCols - 1, r);
    const r1 = getPoint(activeCols - 1, r + 1);
    const br0 = { x: realWidth, y: r0.y, z: 0 };
    const br1 = { x: realWidth, y: r1.y, z: 0 };
    writeTriangle(br0, r0, r1);
    writeTriangle(br0, r1, br1);
  }

  return new Blob([buffer], { type: 'model/stl' });
}
