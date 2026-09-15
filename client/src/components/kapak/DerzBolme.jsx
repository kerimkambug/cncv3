import { useState } from 'react';
import { buildDerzGcode, computeDerzPositions } from '../../lib/gcode/derz.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';

export default function DerzBolme({ cfg }) {
  const [width, setWidth] = useState(500);
  const [height, setHeight] = useState(500);
  const [yon, setYon] = useState('dikey');
  const [margin, setMargin] = useState(60);
  const [spacing, setSpacing] = useState(60);
  const [autoFit, setAutoFit] = useState(true);
  const [toolDia, setToolDia] = useState(4);
  const [toolNo, setToolNo] = useState('1');
  const [depth, setDepth] = useState(2);
  const [overshoot, setOvershoot] = useState(1);
  const [edgeExtra, setEdgeExtra] = useState(0);
  const [outerFrame, setOuterFrame] = useState(false);
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState(null);

  const opts = { width, height, yon, margin, spacing, edgeExtra, autoFit, toolNo, depth, overshoot, outerFrame };
  const preview = (() => {
    try { return computeDerzPositions(opts); } catch { return null; }
  })();

  function generate() {
    setMessage(null);
    try {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('Geçerli bir parça genişliği/yüksekliği gir.');
      }
      if (!Number.isFinite(toolDia) || toolDia <= 0) throw new Error('Geçerli bir bıçak çapı gir.');
      if (toolNo === '' || toolNo == null) throw new Error('Tool No eksik.');
      if (!Number.isFinite(depth) || depth <= 0) throw new Error('Geçerli bir derinlik gir.');

      setOutput(buildDerzGcode(opts, cfg));
      const spacingNote = autoFit ? `gerçek aralık ~${preview.exactSpacing.toFixed(2)}mm` : `sabit aralık ${spacing}mm`;
      setMessage({ type: 'ok', text: `G-code üretildi (${preview.positions.length} çizgi, ${spacingNote}).` });
    } catch (e) {
      setMessage({ type: 'err', text: e.message });
    }
  }

  useCtrlEnter(generate);

  function download() {
    if (!output.trim()) return;
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'derz.nc';
    a.click();
  }

  return (
    <div className="card">
      <h2>Derz Bölme</h2>
      <div className="row2">
        <div><label>Parça Genişliği X (mm)</label><input type="number" value={width} onChange={(e) => setWidth(parseFloat(e.target.value))} /></div>
        <div><label>Parça Yüksekliği Y (mm)</label><input type="number" value={height} onChange={(e) => setHeight(parseFloat(e.target.value))} /></div>
      </div>

      <label>Yön</label>
      <select value={yon} onChange={(e) => setYon(e.target.value)}>
        <option value="dikey">Dikey (yukarı-aşağı çizgiler)</option>
        <option value="yatay">Yatay (sağa-sola çizgiler)</option>
      </select>

      <div className="row2">
        <div><label>Dışarıdan boşluk (mm)</label><input type="number" value={margin} onChange={(e) => setMargin(parseFloat(e.target.value))} /></div>
        <div><label>Çizgiler arası mesafe (mm)</label><input type="number" value={spacing} onChange={(e) => setSpacing(parseFloat(e.target.value))} /></div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 10 }}>
        <input type="checkbox" checked={autoFit} onChange={(e) => setAutoFit(e.target.checked)} style={{ width: 'auto' }} />
        Aralığı kenara tam sığacak şekilde otomatik ayarla
      </label>

      <div className="row3">
        <div><label>Bıçak çapı (mm)</label><input type="number" value={toolDia} onChange={(e) => setToolDia(parseFloat(e.target.value))} /></div>
        <div><label>Tool No</label><input type="text" value={toolNo} onChange={(e) => setToolNo(e.target.value)} /></div>
        <div><label>Derinlik (mm)</label><input type="number" value={depth} onChange={(e) => setDepth(parseFloat(e.target.value))} /></div>
      </div>

      <div className="row2">
        <div><label>Taşma payı (mm, boyuna)</label><input type="number" value={overshoot} onChange={(e) => setOvershoot(parseFloat(e.target.value))} /></div>
        <div><label>Kenar payı azaltma (mm, enine)</label><input type="number" value={edgeExtra} onChange={(e) => setEdgeExtra(parseFloat(e.target.value))} /></div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={outerFrame} onChange={(e) => setOuterFrame(e.target.checked)} style={{ width: 'auto' }} /> Dış çerçeveyi de kes
      </label>

      {preview && preview.positions.length > 0 && (
        <div className="measure-summary">
          {preview.positions.length} çizgi — ilk/son çizgi kenardan {preview.effectiveMargin}mm, gerçek aralık ~{preview.exactSpacing.toFixed(2)}mm.
        </div>
      )}

      <button type="button" className="btn-primary" onClick={generate}>G-code Üret</button>
      {message && <div className={message.type === 'err' ? 'err' : 'ok'} style={{ display: 'block' }}>{message.text}</div>}

      {output && (
        <>
          <h2 style={{ marginTop: 20 }}>Çıktı</h2>
          <textarea value={output} readOnly spellCheck={false} />
          <div className="out-actions">
            <button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(output)}>Kopyala</button>
            <button type="button" className="btn-secondary" onClick={download}>.nc indir</button>
          </div>
        </>
      )}
    </div>
  );
}
