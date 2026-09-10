import { useEffect, useRef, useState } from 'react';
import { computeCumOffsets } from '../../lib/gcode/common.js';

// Stable color per part name so identical parts always share the same
// color, regardless of placement order.
function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}

// Snap a rect to the pixel grid so 1px strokes render crisp instead of a
// blurred 2px band across anti-aliased sub-pixel edges.
function crispRect(x, y, w, h) {
  const x1 = Math.round(x), y1 = Math.round(y);
  const x2 = Math.round(x + w), y2 = Math.round(y + h);
  return { x: x1 + 0.5, y: y1 + 0.5, w: Math.max(1, x2 - x1 - 1), h: Math.max(1, y2 - y1 - 1) };
}

export default function NestingPlateCanvas({ result, cfg }) {
  const canvasRef = useRef(null);
  const [plateIndex, setPlateIndex] = useState(0);
  const [showToolpaths, setShowToolpaths] = useState(true);

  useEffect(() => { setPlateIndex(0); }, [result]);

  useEffect(() => {
    if (!result || !canvasRef.current) return;
    const plate = result.plates[plateIndex];
    if (!plate) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const maxW = 2700, maxH = 1350;
    const scale = Math.min(maxW / result.plateW, maxH / result.plateH);
    canvas.width = Math.max(900, Math.round(result.plateW * scale));
    canvas.height = Math.max(660, Math.round(result.plateH * scale));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#171a21';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    plate.parts.forEach((part, idx) => {
      const x = part.x * scale, y = part.y * scale;
      const w = part.placedWidth * scale, h = part.placedHeight * scale;
      const r = crispRect(x, y, w, h);

      ctx.strokeStyle = `hsl(${hashHue(part.name)} 70% 62%)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      ctx.fillStyle = '#e6e8ec';
      ctx.font = `${Math.max(9, Math.min(14, Math.min(w, h) / 7))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${idx + 1}. ${part.name}${part.rotated ? ' ↻' : ''}`, x + w / 2, y + h / 2);
    });

    if (showToolpaths && cfg.rows.length) {
      const cums = computeCumOffsets(cfg.rows, cfg.offsetMode);
      const toolColors = cfg.rows.map((r, i) => `hsl(${(i * 67) % 360} 90% 62%)`);

      cfg.rows.forEach((r, rowIdx) => {
        const cum = cums[rowIdx];
        ctx.strokeStyle = toolColors[rowIdx];
        ctx.lineWidth = 1;
        ctx.setLineDash(cum < 0 ? [4, 3] : []);
        plate.parts.forEach((part) => {
          const x1 = (part.x + cum) * scale, y1 = (part.y + cum) * scale;
          const w2 = (part.placedWidth - 2 * cum) * scale, h2 = (part.placedHeight - 2 * cum) * scale;
          const cr = crispRect(x1, y1, w2, h2);
          ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);
        });
      });
      ctx.setLineDash([]);
    }
  }, [result, plateIndex, showToolpaths, cfg]);

  function exportPNG() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nesting_plaka_${result.plates[plateIndex].number}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  if (!result) return null;
  const plate = result.plates[plateIndex];
  const cums = showToolpaths && cfg.rows.length ? computeCumOffsets(cfg.rows, cfg.offsetMode) : [];
  const toolColors = cfg.rows.map((r, i) => `hsl(${(i * 67) % 360} 90% 62%)`);

  return (
    <div className="card">
      <h2>Plaka Önizleme</h2>
      <div className="row2">
        {result.plates.length > 1 && (
          <select value={plateIndex} onChange={(e) => setPlateIndex(parseInt(e.target.value, 10))}>
            {result.plates.map((p, i) => <option key={i} value={i}>Plaka {p.number}</option>)}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={showToolpaths} onChange={(e) => setShowToolpaths(e.target.checked)} style={{ width: 'auto' }} />
          Kesim yollarını göster
        </label>
      </div>

      <div className="hint">
        Önizleme: Plaka {plate.number} / {result.plates.length} — {result.plateW} × {result.plateH} mm — sıra: gezinme mesafesine göre optimize
      </div>

      <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', borderRadius: 8, marginTop: 8 }} />

      {showToolpaths && cfg.rows.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          Kesim yolları:{' '}
          {cfg.rows.map((r, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: toolColors[i], display: 'inline-block' }} />
              T{r.toolNo} {r.name || ''}{cums[i] < 0 ? ' (kesikli = dışarıda)' : ''}
            </span>
          ))}
        </div>
      )}

      <button type="button" className="btn-secondary" style={{ marginTop: 12 }} onClick={exportPNG}>PNG olarak indir</button>
    </div>
  );
}
