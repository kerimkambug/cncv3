import { useState } from 'react';
import { buildKapakGcode, validateKapakSize, validateCarvingWarnings } from '../../lib/gcode/kapak.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';

export default function TekOlcu({ cfg, plateCfg }) {
  const [measurements, setMeasurements] = useState([
    { id: 1, width: 500, height: 500 },
  ]);
  const [nextId, setNextId] = useState(2);
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState(null);

  const PLATE_WIDTH = plateCfg?.width || 2100;
  const PLATE_HEIGHT = plateCfg?.height || 2800;

  function updateMeasurement(id, field, value) {
    setMeasurements(measurements.map(m =>
      m.id === id ? { ...m, [field]: parseFloat(value) || 0 } : m
    ));
  }

  function removeMeasurement(id) {
    if (measurements.length > 1) {
      setMeasurements(measurements.filter(m => m.id !== id));
    }
  }

  function addMeasurement() {
    setMeasurements([...measurements, {
      id: nextId,
      width: 500,
      height: 500,
    }]);
    setNextId(nextId + 1);
  }

  function generate() {
    setMessage(null);

    // Tüm ölçüleri kontrol et
    let allValid = true;
    for (const m of measurements) {
      if (!Number.isFinite(m.width) || !Number.isFinite(m.height) || m.width <= 0 || m.height <= 0) {
        allValid = false;
        break;
      }
    }

    if (!allValid) {
      setMessage({ type: 'err', text: 'Tüm ölçülerde geçerli genişlik/yükseklik değerleri gir.' });
      return;
    }

    // Toplam X pozisyonunu kontrol et
    let totalWidth = 0;
    for (const m of measurements) {
      totalWidth += m.width;
    }
    if (totalWidth > PLATE_WIDTH) {
      setMessage({ type: 'err', text: `Toplam genişlik (${totalWidth}mm) plakayı aşıyor (${PLATE_WIDTH}mm).` });
      return;
    }

    // Her ölçü için G-code oluştur ve birleştir
    let combinedOutput = ['makro'];
    let xOffset = 0;

    for (const m of measurements) {
      const err = validateKapakSize(m.width, m.height, cfg.rows, cfg.offsetMode);
      if (err) {
        setMessage({ type: 'err', text: `Ölçü ${m.width}×${m.height}: ${err}` });
        return;
      }

      const gcode = buildKapakGcode(m.width, m.height, cfg, xOffset, 0, true);
      const lines = gcode.split('\n');

      for (const line of lines) {
        if (line.trim()) {
          combinedOutput.push(line);
        }
      }

      xOffset += m.width;
    }

    // Program sonunu ekle
    combinedOutput.push(`G0 X0.00 Y0.00 Z${cfg.homeZ.toFixed(2)}`);
    combinedOutput.push(`G0Z${cfg.homeZ.toFixed(2)}`);
    combinedOutput.push('X0.00Y0.00');
    combinedOutput.push('M5');
    combinedOutput.push('M16');
    combinedOutput.push('M30');

    setOutput(combinedOutput.join('\n'));
    const warnings = validateCarvingWarnings(cfg.rows);
    setMessage({
      type: 'ok',
      text: warnings.length
        ? `G-code üretildi (${measurements.length} ölçü).\n\nUyarı:\n${warnings.join('\n')}`
        : `G-code üretildi (${measurements.length} ölçü).`,
    });
  }

  useCtrlEnter(generate);

  function download() {
    if (!output.trim()) return;
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'output.nc';
    a.click();
  }

  // Toplam X pozisyonunu ve boyutları hesapla
  let totalWidth = 0;
  let maxHeight = 0;
  let currentX = 0;
  const measurementsWithPos = measurements.map(m => {
    const x = currentX;
    currentX += m.width;
    totalWidth = currentX;
    maxHeight = Math.max(maxHeight, m.height);
    return { ...m, x };
  });

  const summaryValid = measurements.every(m => 
    Number.isFinite(m.width) && Number.isFinite(m.height) && m.width > 0 && m.height > 0
  );

  return (
    <div className="card">
      <div className="tool-header-row" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Tek Kapak</h2>
          <div className="hint" style={{ marginTop: 4 }}>
            Tek kapak ölçüsünü girin. Yan yana üretim için bitişik kapak ekleyebilirsiniz.
          </div>
        </div>
        <span className="badge">{measurements.length} kapak</span>
      </div>

      <table className="tool-table">
        <thead>
          <tr>
            <th>X Başlangıç</th>
            <th>Genişlik X</th>
            <th>Yükseklik Y</th>
            <th>Boyut (X×Y)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {measurementsWithPos.map((m) => (
            <tr key={m.id}>
              <td style={{ color: 'var(--muted)' }}>
                {m.x.toFixed(0)} mm
              </td>
              <td>
                <input
                  type="number"
                  step="0.1"
                  value={m.width}
                  onChange={(e) => updateMeasurement(m.id, 'width', e.target.value)}
                  style={{ width: 70 }}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.1"
                  value={m.height}
                  onChange={(e) => updateMeasurement(m.id, 'height', e.target.value)}
                  style={{ width: 70 }}
                />
              </td>
              <td style={{ fontWeight: 600, color: 'var(--accent)' }}>
                {m.width.toFixed(0)} × {m.height.toFixed(0)} mm
              </td>
              <td>
                <button 
                  type="button" 
                  className="icon-btn" 
                  onClick={() => removeMeasurement(m.id)}
                  disabled={measurements.length === 1}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" className="btn-secondary add-row-btn" onClick={addMeasurement}>
        + Bitişik Kapak Ekle
      </button>

      {summaryValid && (
        <div style={{ 
          marginTop: 12, 
          padding: 12, 
          background: 'var(--panel2)', 
          borderRadius: 4,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12
        }}>
          <div>
            <div style={{ fontSize: '0.85em', color: 'var(--muted)' }}>Toplam X</div>
            <div style={{ fontSize: '1.1em', fontWeight: 600, color: totalWidth <= PLATE_WIDTH ? 'var(--success)' : 'var(--error)' }}>
              {totalWidth.toFixed(0)} / {PLATE_WIDTH} mm
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.85em', color: 'var(--muted)' }}>Max Y</div>
            <div style={{ fontSize: '1.1em', fontWeight: 600, color: maxHeight <= PLATE_HEIGHT ? 'var(--success)' : 'var(--error)' }}>
              {maxHeight.toFixed(0)} / {PLATE_HEIGHT} mm
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.85em', color: 'var(--muted)' }}>Bıçak Sayısı</div>
            <div style={{ fontSize: '1.1em', fontWeight: 600 }}>
              {cfg.rows.length}
            </div>
          </div>
        </div>
      )}

      <button 
        type="button" 
        className="btn-primary" 
        onClick={generate}
        style={{ marginTop: 16 }}
      >
        G-code Üret
      </button>
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
