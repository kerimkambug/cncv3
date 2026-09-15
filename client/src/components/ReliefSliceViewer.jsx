import React, { useRef, useEffect } from 'react';

export default function ReliefSliceViewer({
  depthGrid,
  gridCols,
  gridRows,
  realWidth = 200,
  realHeight = 200,
  maxDepth = 5,
  thickness = 18,
  sliceRatio = 0.5, // 0.0 (top) - 1.0 (bottom)
  axis = 'x',       // 'x' = horizontal cut profile
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !depthGrid || gridCols <= 0 || gridRows <= 0) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Arka plan & ızgara
    ctx.fillStyle = '#0f1218';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#222938';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Kesit profili çıkar
    const padding = 20;
    const plotW = w - padding * 2;
    const plotH = h - padding * 2;

    const points = [];
    const numSamples = 200;

    if (axis === 'x') {
      const rowIdx = Math.max(0, Math.min(gridRows - 1, Math.round(sliceRatio * (gridRows - 1))));
      for (let i = 0; i < numSamples; i++) {
        const colIdx = Math.max(0, Math.min(gridCols - 1, Math.round((i / (numSamples - 1)) * (gridCols - 1))));
        const d = depthGrid[rowIdx * gridCols + colIdx] || 0;
        const zMm = thickness - (1.0 - d) * maxDepth;
        points.push({ xMm: (i / (numSamples - 1)) * realWidth, zMm, d });
      }
    }

    // Profil eğrisi çiz
    ctx.beginPath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;

    points.forEach((p, idx) => {
      const screenX = padding + (idx / (points.length - 1)) * plotW;
      // Normalleştirilmiş derinlik: 0 (üst) -> h - padding, 1 (alt) -> padding
      const screenY = padding + p.d * plotH;

      if (idx === 0) ctx.moveTo(screenX, screenY);
      else ctx.lineTo(screenX, screenY);
    });
    ctx.stroke();

    // Doldurma (Alan)
    ctx.lineTo(padding + plotW, h - padding);
    ctx.lineTo(padding, h - padding);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fill();

    // Eksen yazıları
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(`0 mm (Yüzey)`, padding, padding - 5);
    ctx.fillText(`-${maxDepth} mm (Maks Derinlik)`, padding, h - 5);
    ctx.fillText(`Genişlik: ${realWidth} mm (Yatay Kesit: %${Math.round(sliceRatio * 100)})`, w - 240, padding - 5);
  }, [depthGrid, gridCols, gridRows, realWidth, realHeight, maxDepth, thickness, sliceRatio, axis]);

  return (
    <div className="relief-slice-box">
      <div className="slice-header">
        <span className="slice-title">📐 CNC Kesit & Derinlik Profili (Z-Eğrisi)</span>
        <span className="slice-stat">Pürüzsüz Bas-Rölyef Geçişi (Sıfır Diken/Çapak)</span>
      </div>
      <canvas ref={canvasRef} width={500} height={120} className="slice-canvas" />
    </div>
  );
}
