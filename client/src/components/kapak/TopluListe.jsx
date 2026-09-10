import { useState } from 'react';
import JSZip from 'jszip';
import { buildKapakGcode, validateKapakSize, parseBatchLine } from '../../lib/gcode/kapak.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';

export default function TopluListe({ cfg }) {
  const [list, setList] = useState('');
  const [message, setMessage] = useState(null);

  async function generate() {
    setMessage(null);
    const linesRaw = list.split('\n').map((l) => l.trim()).filter(Boolean);
    if (linesRaw.length === 0) { setMessage({ type: 'err', text: 'Liste boş.' }); return; }

    const zip = new JSZip();
    const errors = [];
    let okCount = 0;
    const usedNames = {};

    linesRaw.forEach((line, idx) => {
      const parsed = parseBatchLine(line);
      if (!parsed) { errors.push(`Satır ${idx + 1} ("${line}") okunamadı, atlandı.`); return; }
      const err = validateKapakSize(parsed.width, parsed.height, cfg.rows, cfg.offsetMode);
      if (err) { errors.push(`Satır ${idx + 1} ("${line}"): ${err}`); return; }

      const gcode = buildKapakGcode(parsed.width, parsed.height, cfg);
      let fname = `${parsed.width}-${parsed.height}`;
      if (usedNames[fname] !== undefined) {
        usedNames[fname]++;
        fname = `${fname}_${usedNames[fname]}`;
      } else {
        usedNames[fname] = 0;
      }
      zip.file(`${fname}.nc`, gcode);
      okCount++;
    });

    if (okCount === 0) { setMessage({ type: 'err', text: 'Hiçbir satır üretilemedi.\n' + errors.join('\n') }); return; }

    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = 'gcode_batch.zip';
    a.click();

    let msg = `${okCount} dosya üretildi ve zip indirildi.`;
    if (errors.length > 0) msg += `\n\n${errors.length} satır atlandı:\n` + errors.join('\n');
    setMessage({ type: 'ok', text: msg });
  }

  useCtrlEnter(generate);

  return (
    <div className="card">
      <h2>Toplu Liste</h2>
      <label>Ölçü listesi — her satır bir parça: GENİŞLİK-YÜKSEKLİK (fazladan sayılar yok sayılır)</label>
      <textarea
        className="list-input"
        value={list}
        onChange={(e) => setList(e.target.value)}
        placeholder={'327-656\n351-720\n373-715\n760-702-2'}
      />
      <button type="button" className="btn-accent2" onClick={generate}>Toplu Üret (.zip indir)</button>
      {message && (
        <div className={message.type === 'err' ? 'err' : 'ok'} style={{ display: 'block', whiteSpace: 'pre-line' }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
