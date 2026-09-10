import { useState } from 'react';
import { buildCamTaramaGcode } from '../../lib/gcode/camTarama.js';

export default function CamTaramaPanel({ cfg }) {
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState(null);

  function generate() {
    setMessage(null);
    try {
      const g = buildCamTaramaGcode(cfg);
      setOutput(g);
      setMessage({ type: 'ok', text: "Tarama G-code üretildi. Köşeler şu an keskin — ArtCAM'deki rozet detayı yok." });
    } catch (e) {
      setMessage({ type: 'err', text: e.message });
      setOutput('');
    }
  }

  function download() {
    if (!output.trim()) return;
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tarama.nc';
    a.click();
  }

  return (
    <div className="card">
      <h2>Tarama (deneysel)</h2>
      <button type="button" className="btn-accent2" style={{ marginTop: 0 }} onClick={generate}>Tarama G-code Üret</button>
      {message && <div className={message.type === 'err' ? 'err' : 'ok'} style={{ display: 'block' }}>{message.text}</div>}

      {output && (
        <>
          <textarea value={output} readOnly spellCheck={false} style={{ marginTop: 12 }} />
          <div className="out-actions">
            <button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(output)}>Kopyala</button>
            <button type="button" className="btn-secondary" onClick={download}>.nc indir</button>
          </div>
        </>
      )}
    </div>
  );
}
