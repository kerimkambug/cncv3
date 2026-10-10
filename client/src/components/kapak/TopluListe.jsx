import SimPanel from '../SimPanel.jsx';
import { useState } from 'react';
import JSZip from 'jszip';
import { buildKapakGcode, validateKapakSize, validateCarvingWarnings, parseBatchLine } from '../../lib/gcode/kapak.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';
import { ActiveModelBar } from './ModelGallery.jsx';

export default function TopluListe({ workspace, presets, presetsLoading }) {
  const { cfg, canGenerate } = workspace;
  const [list, setList] = useState('');
  const [message, setMessage] = useState(null);

  async function generate() {
    setMessage(null);
    if (!canGenerate) { setMessage({ type: 'err', text: 'Önce bir model seçin.' }); return; }
    const linesRaw = list.split('\n').map((l) => l.trim()).filter(Boolean);
    if (linesRaw.length === 0) { setMessage({ type: 'err', text: 'Liste boş.' }); return; }

    const zip = new JSZip();
    const errors = [];
    let okCount = 0;
    const usedNames = {};

    linesRaw.forEach((line, idx) => {
      const parsed = parseBatchLine(line);
      if (!parsed) { errors.push(`Satır ${idx + 1} ("${line}") okunamadı, atlandı.`); return; }
      const err = validateKapakSize(parsed.width, parsed.height, cfg.rows, cfg.offsetMode, cfg.thickness);
      if (err) { errors.push(`Satır ${idx + 1} ("${line}"): ${err}`); return; }

      const gcode = buildKapakGcode(parsed.width, parsed.height, cfg);
      const base = String(workspace.modelName(presets) || 'kapak').replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ_-]+/gi, '_');
      let fname = `${base}_${parsed.width}x${parsed.height}`;
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
    const warnings = validateCarvingWarnings(cfg.rows);
    if (warnings.length > 0) msg += `\n\nUyarı:\n` + warnings.join('\n');
    setMessage({ type: 'ok', text: msg });
  }

  useCtrlEnter(generate);
  const [simIdx, setSimIdx] = useState(0);
  const simLines = list.split(/\r?\n/).map((l) => parseBatchLine(l.trim())).filter(Boolean);

  return (
    <div className="card">
      <h2>Toplu Liste</h2>
      <ActiveModelBar workspace={workspace} presets={presets} loading={presetsLoading} />
      <label>Ölçü listesi — her satıra bir kapak: GENİŞLİK-YÜKSEKLİK (ör. 450-700). Hepsi seçili modelle üretilir.</label>
      <textarea
        className="list-input"
        value={list}
        onChange={(e) => setList(e.target.value)}
        placeholder={'327-656\n351-720\n373-715\n760-702-2'}
      />
      <button type="button" className="btn-primary download-btn" onClick={generate} disabled={!canGenerate}>⬇ Hepsini indir (.zip)</button>
      {canGenerate && simLines.length > 0 && (
        <div className="sim-pick">
          <label>Simülasyon için kapak</label>
          <select value={Math.min(simIdx, simLines.length - 1)} onChange={(e) => setSimIdx(Number(e.target.value))}>
            {simLines.map((p, i) => <option key={i} value={i}>{p.width} × {p.height}</option>)}
          </select>
          <SimPanel
            getGcode={() => { const p = simLines[Math.min(simIdx, simLines.length - 1)]; return buildKapakGcode(p.width, p.height, cfg); }}
            top={cfg.thickness}
            name="kapak"
          />
        </div>
      )}
      {message && (
        <div className={message.type === 'err' ? 'err' : 'ok'} style={{ display: 'block', whiteSpace: 'pre-line' }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
