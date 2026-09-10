import { useState } from 'react';
import { buildCircleGcode, resolveCircleParams } from '../../lib/gcode/circle.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';

export default function DaireKesimi({ cfg }) {
  const [mode, setMode] = useState('solid');
  const [outerDia, setOuterDia] = useState(500);
  const [innerDia, setInnerDia] = useState(400);
  const [left, setLeft] = useState(0);
  const [bottom, setBottom] = useState(0);
  const [toolDia, setToolDia] = useState(6);
  const [toolNo, setToolNo] = useState('6');
  const [depth, setDepth] = useState(18);
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState(null);

  const params = { mode, outerDia, innerDia, left, bottom, toolDia, toolNo, depth };
  const resolved = (() => {
    try { return resolveCircleParams(params); } catch { return null; }
  })();

  function generate() {
    setMessage(null);
    if (!Number.isFinite(outerDia) || outerDia <= 0) { setMessage({ type: 'err', text: 'Geçerli bir dış çap gir.' }); return; }
    if (mode === 'ring' && (!Number.isFinite(innerDia) || innerDia <= 0 || innerDia >= outerDia)) {
      setMessage({ type: 'err', text: 'İç çap, dış çaptan küçük ve geçerli olmalı.' }); return;
    }
    if (!Number.isFinite(toolDia) || toolDia <= 0) { setMessage({ type: 'err', text: 'Geçerli bir bıçak çapı gir.' }); return; }
    if (!Number.isFinite(depth) || depth <= 0) { setMessage({ type: 'err', text: 'Geçerli bir derinlik gir.' }); return; }

    setOutput(buildCircleGcode(params, cfg));
    setMessage({ type: 'ok', text: 'G-code üretildi.' });
  }

  useCtrlEnter(generate);

  function download() {
    if (!output.trim()) return;
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'daire.nc';
    a.click();
  }

  return (
    <div className="card">
      <h2>Daire Kesimi</h2>
      <label>Mod</label>
      <select value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="solid">Düz Daire (dolu parça)</option>
        <option value="ring">Çember (dış-iç arası halka)</option>
      </select>

      <div className="row2">
        <div><label>Dış Çap (mm)</label><input type="number" value={outerDia} onChange={(e) => setOuterDia(parseFloat(e.target.value))} /></div>
        {mode === 'ring' && (
          <div><label>İç Çap (mm)</label><input type="number" value={innerDia} onChange={(e) => setInnerDia(parseFloat(e.target.value))} /></div>
        )}
      </div>
      <div className="row2">
        <div><label>Soldan boşluk (mm)</label><input type="number" value={left} onChange={(e) => setLeft(parseFloat(e.target.value))} /></div>
        <div><label>Alttan boşluk (mm)</label><input type="number" value={bottom} onChange={(e) => setBottom(parseFloat(e.target.value))} /></div>
      </div>
      <div className="row3">
        <div><label>Bıçak çapı (mm)</label><input type="number" value={toolDia} onChange={(e) => setToolDia(parseFloat(e.target.value))} /></div>
        <div><label>Tool No</label><input type="text" value={toolNo} onChange={(e) => setToolNo(e.target.value)} /></div>
        <div><label>Derinlik (mm)</label><input type="number" value={depth} onChange={(e) => setDepth(parseFloat(e.target.value))} /></div>
      </div>

      {resolved && (
        <div className="measure-summary">
          Dış kesim çapı: {(resolved.outerR * 2).toFixed(1)} mm — Merkez: X{resolved.centerX.toFixed(1)} Y{resolved.centerY.toFixed(1)}
          {mode === 'ring' && resolved.innerR != null && ` — İç çap: ${(resolved.innerR * 2).toFixed(1)} mm`}
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
