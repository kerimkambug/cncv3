import { useMemo, useRef, useState } from 'react';
import { buildGcodeDxf, parseGcode } from '../lib/gcode/gcodeToDxf.js';

const DEFAULT_BOUNDS = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

export default function GcodeDxfConverter({ onBackToMenu }) {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [gcode, setGcode] = useState('');
  const [includeRapids, setIncludeRapids] = useState(false);
  const [scaleX, setScaleX] = useState(1);
  const [scaleY, setScaleY] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [drawPlate, setDrawPlate] = useState(true);
  const [plateWidth, setPlateWidth] = useState(2100);
  const [plateHeight, setPlateHeight] = useState(2800);
  const [message, setMessage] = useState(null);

  const parsed = useMemo(() => parseGcode(gcode, { includeRapids }), [gcode, includeRapids]);
  const bounds = parsed.bounds || DEFAULT_BOUNDS;
  const activePlate = drawPlate && plateWidth > 0 && plateHeight > 0
    ? { width: plateWidth, height: plateHeight }
    : null;
  const preview = useMemo(() => {
    const width = Math.max(1, (bounds.maxX - bounds.minX) * scaleX, activePlate ? activePlate.width * scaleX : 0);
    const height = Math.max(1, (bounds.maxY - bounds.minY) * scaleY, activePlate ? activePlate.height * scaleY : 0);
    return { width, height, viewBox: `0 0 ${width} ${height}` };
  }, [bounds, scaleX, scaleY, activePlate]);

  // Plaka X0,Y0'dan başlayıp sağa/üste büyür. Önizlemedeki yol koordinatları
  // (x - minX) * scale ile çizildiği için plaka da aynı dönüşümle hizalanır.
  const plateRect = useMemo(() => {
    if (!activePlate) return null;
    const x = (0 - bounds.minX) * scaleX;
    const y = (0 - bounds.minY) * scaleY;
    return {
      x,
      width: plateWidth * scaleX,
      height: plateHeight * scaleY,
      yTop: preview.height - (y + plateHeight * scaleY),
    };
  }, [activePlate, bounds, scaleX, scaleY, preview.height, plateWidth, plateHeight]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setGcode(text);
    setMessage({ type: 'ok', text: `${file.name} yüklendi. ${parseGcode(text).segments.length} takım yolu bulundu.` });
  }

  function downloadDxf() {
    if (!parsed.segments.length) {
      setMessage({ type: 'err', text: 'Önce hareket içeren bir G-code dosyası yükleyin.' });
      return;
    }
    const dxf = buildGcodeDxf(parsed, {
      scaleX,
      scaleY,
      offsetX,
      offsetY,
      plateWidth: drawPlate ? plateWidth : 0,
      plateHeight: drawPlate ? plateHeight : 0,
    });
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/\.[^.]+$/, '') || 'gcode_toolpath'}.dxf`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage({
      type: 'ok',
      text: drawPlate
        ? `DXF dosyası indirildi. Plaka sınırı (${plateWidth}×${plateHeight} mm) PLATE_BOUNDARY katmanında X0,Y0'dan çizildi.`
        : 'DXF dosyası indirildi. Katmanlar: G0_RAPID, G1_LINEAR, G2_ARC_CW, G3_ARC_CCW.',
    });
  }

  function formatBounds() {
    if (!parsed.bounds) return 'Henüz yol yok';
    return `${parsed.bounds.minX.toFixed(1)} × ${parsed.bounds.minY.toFixed(1)} → ${parsed.bounds.maxX.toFixed(1)} × ${parsed.bounds.maxY.toFixed(1)} mm`;
  }

  return (
    <div className="wrap app-screen active">
      <div className="topbar">
        <div>
          <h1>G-code → DXF Dönüştürücü</h1>
          <div className="sub">CNC takım yollarını okuyun, kontrol edin ve AutoCAD/CAM uyumlu DXF olarak indirin.</div>
        </div>
        {onBackToMenu && <button type="button" className="btn-secondary" onClick={onBackToMenu}>← Ana Menü</button>}
      </div>

      <div className="converter-grid">
        <div className="card">
          <h2>G-code dosyası</h2>
          <input ref={fileInputRef} type="file" accept=".nc,.gcode,.txt,text/plain" onChange={handleFile} style={{ display: 'none' }} />
          <button type="button" className="btn-primary" onClick={() => fileInputRef.current?.click()}>📄 G-code Yükle</button>
          <div className="converter-file-name">{fileName || 'Dosya seçilmedi'}</div>
          <label htmlFor="gcode-text-input">veya G-code metni</label>
          <textarea
            id="gcode-text-input"
            className="converter-textarea"
            value={gcode}
            onChange={(event) => {
              setGcode(event.target.value);
              setFileName(event.target.value.trim() ? 'Metin girişi' : '');
              setMessage(null);
            }}
            placeholder={'G21\nG90\nG0 X0 Y0\nG1 X500 Y0 F6000\nG1 X500 Y500\nG1 X0 Y500\nG1 X0 Y0'}
            spellCheck="false"
          />

          <h2 className="converter-section-title">Dönüşüm ayarları</h2>
          <div className="row2">
            <div><label>Ölçek X</label><input type="number" min="0.0001" step="0.01" value={scaleX} onChange={(e) => setScaleX(Number(e.target.value) || 1)} /></div>
            <div><label>Ölçek Y</label><input type="number" min="0.0001" step="0.01" value={scaleY} onChange={(e) => setScaleY(Number(e.target.value) || 1)} /></div>
            <div><label>Offset X (mm)</label><input type="number" step="0.1" value={offsetX} onChange={(e) => setOffsetX(Number(e.target.value) || 0)} /></div>
            <div><label>Offset Y (mm)</label><input type="number" step="0.1" value={offsetY} onChange={(e) => setOffsetY(Number(e.target.value) || 0)} /></div>
          </div>
          <label className="checkbox-row converter-checkbox">
            <input type="checkbox" checked={includeRapids} onChange={(e) => setIncludeRapids(e.target.checked)} />
            G0 hızlı hareketleri de DXF’e ekle
          </label>

          <label className="checkbox-row converter-checkbox">
            <input type="checkbox" checked={drawPlate} onChange={(e) => setDrawPlate(e.target.checked)} />
            Plaka sınırını çiz (X0,Y0’dan sağa/üste)
          </label>
          <div className="row2">
            <div><label>Plaka genişliği (mm)</label><input type="number" min="0" step="1" value={plateWidth} onChange={(e) => setPlateWidth(Number(e.target.value) || 0)} /></div>
            <div><label>Plaka yüksekliği (mm)</label><input type="number" min="0" step="1" value={plateHeight} onChange={(e) => setPlateHeight(Number(e.target.value) || 0)} /></div>
          </div>
          <button type="button" className="btn-accent2" disabled={!parsed.segments.length} onClick={downloadDxf}>📐 DXF İndir</button>
          {message && <div className={message.type === 'err' ? 'err' : 'ok'} style={{ display: 'block' }}>{message.text}</div>}
        </div>

        <div className="card converter-preview-card">
          <div className="tool-header-row">
            <h2>Takım yolu önizleme</h2>
            <span className="badge">{parsed.segments.length} hareket</span>
          </div>
          <div className="converter-stats">
            <span>Koordinat alanı</span><b>{formatBounds()}</b>
          </div>
          <div className="converter-canvas-wrap">
            {parsed.segments.length ? (
              <svg viewBox={preview.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="G-code takım yolu önizlemesi">
                {plateRect && (
                  <rect
                    x={plateRect.x}
                    y={plateRect.yTop}
                    width={plateRect.width}
                    height={plateRect.height}
                    className="converter-plate"
                  />
                )}
                {parsed.segments.map((segment, index) => (
                  <line
                    key={`${segment.line}-${index}`}
                    x1={(segment.from.x - bounds.minX) * scaleX}
                    y1={preview.height - (segment.from.y - bounds.minY) * scaleY}
                    x2={(segment.to.x - bounds.minX) * scaleX}
                    y2={preview.height - (segment.to.y - bounds.minY) * scaleY}
                    className={`converter-path ${segment.type.toLowerCase()}`}
                  />
                ))}
              </svg>
            ) : <div className="converter-empty">G-code yüklediğinizde takım yolları burada görünecek.</div>}
          </div>
          <div className="hint">DXF katmanları: G1 doğrusal kesimler, G2/G3 yay hareketleri, isteğe bağlı G0 hızlı hareketler.</div>
        </div>
      </div>
    </div>
  );
}
