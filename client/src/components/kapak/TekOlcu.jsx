import SimPanel from '../SimPanel.jsx';
import { guardZ } from '../../lib/gcode/zGuard.js';
import { mergeToolBlocks } from '../../lib/gcode/toolOrder.js';
import { useMemo, useState } from 'react';
import { buildKapakGcode, validateKapakSize, validateCarvingWarnings, planNarrowDoor } from '../../lib/gcode/kapak.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import ModelGallery from './ModelGallery.jsx';
import PartPreview from './PartPreview.jsx';

/**
 * The main screen: pick a model, type the size, download the G-code.
 * The program is rebuilt live on every change and drawn underneath, so what the
 * operator sees is exactly what will be cut. Several doors side by side
 * ("bitişik kapak") are still possible, as a secondary option.
 */
export default function TekOlcu({ workspace, presets, presetsLoading }) {
  const { cfg, plateCfg, activeModel, canGenerate } = workspace;
  const [measurements, setMeasurements] = usePersistentState('empire-cnc-tek-olcu', [{ id: 1, width: 500, height: 500 }]);
  const [showCode, setShowCode] = useState(false);
  const plateW = plateCfg?.width || 2100;
  const plateH = plateCfg?.height || 2800;

  const update = (id, field, value) => setMeasurements(measurements.map((m) => (m.id === id ? { ...m, [field]: value === '' ? '' : parseFloat(value) } : m)));
  const remove = (id) => measurements.length > 1 && setMeasurements(measurements.filter((m) => m.id !== id));
  const add = () => setMeasurements([...measurements, { id: Math.max(...measurements.map((m) => m.id)) + 1, width: 500, height: 500 }]);

  // Build live: { gcode, doors, error, notes }
  const result = useMemo(() => {
    if (!canGenerate) return { error: 'Önce soldan bir model seçin.' };
    const bad = measurements.find((m) => !(Number(m.width) > 0) || !(Number(m.height) > 0));
    if (bad) return { error: 'Genişlik ve yükseklik girin.' };
    const totalW = measurements.reduce((s, m) => s + m.width, 0);
    if (totalW > plateW) return { error: `Toplam genişlik (${totalW} mm) plakayı aşıyor (${plateW} mm).` };
    const tall = measurements.find((m) => m.height > plateH);
    if (tall) return { error: `Yükseklik (${tall.height} mm) plakayı aşıyor (${plateH} mm).` };
    const lines = ['makro'];
    const doors = [];
    const notes = [];
    let x = 0;
    for (const m of measurements) {
      const err = validateKapakSize(m.width, m.height, cfg.rows, cfg.offsetMode, cfg.thickness);
      if (err) return { error: `${m.width}×${m.height}: ${err}` };
      try {
        buildKapakGcode(m.width, m.height, cfg, x, 0, true).split('\n').forEach((l) => l.trim() && lines.push(l));
      } catch (e) {
        return { error: `${m.width}×${m.height}: ${e.message}` };
      }
      const plan = planNarrowDoor(m.width, m.height, cfg);
      if (plan) {
        const parts = [];
        if (plan.dx) parts.push(`yan kenarlarda çerçeve ${plan.dx.toFixed(0)} mm dışa alındı`);
        if (plan.dy) parts.push(`üst/alt kenarlarda çerçeve ${plan.dy.toFixed(0)} mm dışa alındı`);
        if (plan.dropped) parts.push('sığmayan iç çerçeve atılıp içi tarandı');
        notes.push(`${m.width}×${m.height} dar kapak: ${parts.join(', ')}.`);
      }
      doors.push({ x, y: 0, w: m.width, h: m.height });
      x += m.width;
    }
    const hz = Number(cfg.homeZ || 0).toFixed(2);
    lines.push(`G0 X0.00 Y0.00 Z${hz}`, `G0Z${hz}`, 'X0.00Y0.00', 'M5', 'M16', 'M30');
    validateCarvingWarnings(cfg.rows).forEach((w) => notes.push(w));
    // side-by-side doors: each tool once for all of them
    return { gcode: guardZ(mergeToolBlocks(lines.join('\n'))), doors, notes };
  }, [measurements, cfg, canGenerate, plateW, plateH]);

  const modelName = workspace.modelName(presets);
  const fileName = () => {
    const base = String(modelName || 'kapak').replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ_-]+/gi, '_');
    return `${base}_${measurements.map((m) => `${m.width}x${m.height}`).join('_')}.nc`;
  };
  function download() {
    if (!result.gcode) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([result.gcode], { type: 'text/plain' }));
    a.download = fileName();
    a.click();
    URL.revokeObjectURL(a.href);
  }
  useCtrlEnter(download);

  return (
    <div className="kapak-screen">
      <section className="card kapak-models">
        <h2>1 · Model</h2>
        <ModelGallery
          presets={presets}
          loading={presetsLoading}
          activeId={activeModel?.id}
          onSelect={workspace.selectPreset}
        />
      </section>

      <section className="card kapak-job">
        <div className="kapak-job-model">
          <span className="active-model-label">Seçili model</span>
          <strong>{modelName || 'Model seçilmedi'}</strong>
          {activeModel?.custom && <span className="badge" title="Bıçak sırası Atölye'de elle değiştirildi">özelleştirilmiş</span>}
        </div>

        <h2>2 · Ölçü</h2>
        <div className="size-rows">
          {measurements.map((m, i) => (
            <div className="size-row" key={m.id}>
              {measurements.length > 1 && <span className="size-index">{i + 1}.</span>}
              <label><span>Genişlik (mm)</span>
                <input type="number" min="1" step="0.5" value={m.width} onChange={(e) => update(m.id, 'width', e.target.value)} />
              </label>
              <span className="size-x">×</span>
              <label><span>Yükseklik (mm)</span>
                <input type="number" min="1" step="0.5" value={m.height} onChange={(e) => update(m.id, 'height', e.target.value)} />
              </label>
              {measurements.length > 1 && (
                <button type="button" className="icon-btn" title="Bu kapağı kaldır" onClick={() => remove(m.id)}>✕</button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="link-btn" onClick={add}>+ Yanına bitişik kapak ekle</button>

        <h2>3 · Önizleme ve indir</h2>
        {result.doors && <PartPreview gcode={result.gcode} doors={result.doors} />}
        {result.error && <div className="err" style={{ display: 'block' }}>{result.error}</div>}
        {result.notes?.length > 0 && <div className="hint notes">{result.notes.map((n) => <div key={n}>• {n}</div>)}</div>}

        <button type="button" className="btn-primary download-btn" onClick={download} disabled={!result.gcode}>
          ⬇ G-code indir (.nc)
        </button>
        <div className="hint">Kısayol: Ctrl+Enter</div>
        {result.gcode && (
          <SimPanel
            gcode={result.gcode}
            top={cfg.thickness}
            size={result.doors?.length ? { w: Math.max(...result.doors.map((d) => d.x + d.w)), h: Math.max(...result.doors.map((d) => d.y + d.h)) } : null}
            name="kapak"
          />
        )}

        {result.gcode && (
          <div className="code-toggle">
            <button type="button" className="link-btn" onClick={() => setShowCode((v) => !v)}>
              {showCode ? 'G-code\'u gizle' : 'G-code\'u göster'}
            </button>
            {showCode && (
              <>
                <textarea value={result.gcode} readOnly spellCheck={false} />
                <button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(result.gcode)}>Kopyala</button>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
