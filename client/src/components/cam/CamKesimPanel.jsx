import { useState } from 'react';
import { buildCamKesimGcode } from '../../lib/gcode/cam.js';

export default function CamKesimPanel({ cfg }) {
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState(null);

  function generate() {
    setMessage(null);
    try {
      setOutput(buildCamKesimGcode(cfg));
      setMessage({ type: 'ok', text: 'Kesim G-code üretildi.' });
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
    a.download = 'kesim.nc';
    a.click();
  }

  return (
    <div className="card">
      <h2>Kesim</h2>
      <button type="button" className="btn-primary" style={{ marginTop: 0 }} onClick={generate}>Kesim G-code Üret</button>
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
