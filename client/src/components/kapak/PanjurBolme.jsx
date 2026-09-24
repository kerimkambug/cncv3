import { useState } from 'react';
import { buildPanjurGcode } from '../../lib/gcode/panjur.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';

export default function PanjurBolme() {
  const [xStart, setXStart] = useState(750);
  const [xEnd, setXEnd] = useState(997.5);
  const [startY, setStartY] = useState(55.349);
  const [bladeHeight, setBladeHeight] = useState(40.278);
  const [bladeCount, setBladeCount] = useState(9);
  const [yStep, setYStep] = useState(0.47);
  const [zTop, setZTop] = useState(17.937);
  const [zBottom, setZBottom] = useState(3.105);
  const [safeZ, setSafeZ] = useState(30);
  const [toolNo, setToolNo] = useState('14');
  const [spindleSpeed, setSpindleSpeed] = useState(12000);
  const [cutFeed, setCutFeed] = useState(20000);
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState(null);
  const [stats, setStats] = useState(null);

  function generate() {
    setMessage(null);
    try {
      const opts = { xStart, xEnd, startY, bladeHeight, bladeCount, yStep, zTop, zBottom, safeZ, toolNo, spindleSpeed, cutFeed };
      const result = buildPanjurGcode(opts);
      setOutput(result.gcode);
      setStats({ stepsPerBlade: result.stepsPerBlade, actualYStep: result.actualYStep });
      setMessage({ type: 'ok', text: `G-code üretildi (${bladeCount} çıta, çıta başına ${result.stepsPerBlade} raster adımı, gerçek adım ~${result.actualYStep.toFixed(3)}mm).` });
    } catch (e) {
      setMessage({ type: 'err', text: e.message });
      setOutput('');
    }
  }

  useCtrlEnter(generate);

  function download() {
    if (!output.trim()) return;
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    
    // Genişlik ve toplam yüksekliği hesaplayarak dinamik dosya adı oluştur.
    // Örnek: Panjur_247x362_9Cita.nc
    const genislik = (xEnd - xStart).toFixed(0);
    const yukseklik = totalHeight.toFixed(0);
    a.download = `Panjur_${genislik}x${yukseklik}_${bladeCount}Cita.nc`;
    
    a.click();
  }
  const totalHeight = bladeHeight * bladeCount;

  return (
    <div className="card">
      <h2>Panjur Bölme (deneysel)</h2>
      <div className="hint">
        Her çıta, X boyunca zigzag tararken Y arttıkça Z kademeli olarak derinleşen bir rampa oluşturur —
        panjur/jaluzi kapağın eğimli çıta yüzeyi. Gerçek üretim dosyasından çıkarılmış ve doğrulanmıştır.
        Çıktı formatı (N-satır/O-program numaralı ISO G-code) sistemin geri kalanından farklı — çünkü
        gerçek örnek dosya da öyleydi.
      </div>

      <h2 style={{ marginTop: 16 }}>Raster Alanı</h2>
      <div className="row2">
        <div><label>X Başlangıç (mm)</label><input type="number" value={xStart} onChange={(e) => setXStart(parseFloat(e.target.value))} /></div>
        <div><label>X Bitiş (mm)</label><input type="number" value={xEnd} onChange={(e) => setXEnd(parseFloat(e.target.value))} /></div>
      </div>
      <div className="row2">
        <div><label>İlk çıtanın başladığı Y (mm)</label><input type="number" value={startY} onChange={(e) => setStartY(parseFloat(e.target.value))} /></div>
        <div><label>Raster adımı (mm, istenen)</label><input type="number" step="0.01" value={yStep} onChange={(e) => setYStep(parseFloat(e.target.value))} /></div>
      </div>

      <h2 style={{ marginTop: 16 }}>Çıta Ayarları</h2>
      <div className="row2">
        <div><label>Çıta yüksekliği (mm)</label><input type="number" step="0.001" value={bladeHeight} onChange={(e) => setBladeHeight(parseFloat(e.target.value))} /></div>
        <div><label>Çıta sayısı</label><input type="number" value={bladeCount} onChange={(e) => setBladeCount(parseInt(e.target.value, 10))} /></div>
      </div>
      <div className="row2">
        <div><label>Z başlangıç (sığ, mm)</label><input type="number" step="0.001" value={zTop} onChange={(e) => setZTop(parseFloat(e.target.value))} /></div>
        <div><label>Z bitiş (derin, mm)</label><input type="number" step="0.001" value={zBottom} onChange={(e) => setZBottom(parseFloat(e.target.value))} /></div>
      </div>

      <div className="measure-summary">
        Toplam yükseklik: {totalHeight.toFixed(2)}mm ({bladeCount} çıta × {bladeHeight}mm) — X genişliği: {(xEnd - xStart).toFixed(1)}mm
      </div>

      <h2 style={{ marginTop: 16 }}>Takım</h2>
      <div className="row3">
        <div><label>Tool No</label><input type="text" value={toolNo} onChange={(e) => setToolNo(e.target.value)} /></div>
        <div><label>Spindle S</label><input type="number" value={spindleSpeed} onChange={(e) => setSpindleSpeed(parseFloat(e.target.value))} /></div>
        <div><label>Kesim Feed</label><input type="number" value={cutFeed} onChange={(e) => setCutFeed(parseFloat(e.target.value))} /></div>
      </div>
      <label>Safe Z (çıtalar arası geri çekilme)</label>
      <input type="number" value={safeZ} onChange={(e) => setSafeZ(parseFloat(e.target.value))} />

      <button type="button" className="btn-primary" onClick={generate}>G-code Üret</button>
      <div className="hint">Kısayol: Ctrl+Enter (Mac: ⌘+Enter)</div>
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
