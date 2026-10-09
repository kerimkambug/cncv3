import { useMemo, useState } from 'react';
import { CATALOG, catalogPart, defaultParams } from '../../lib/cerezlik/catalog.js';
import PartCanvas from './PartCanvas.jsx';

const GROUPS = ['Hepsi', ...new Set(CATALOG.map((m) => m.group))];

/** Built-in models: pick one, set its sizes, add it to the job. */
export default function CatalogPicker({ onAdd }) {
  const [group, setGroup] = useState('Hepsi');
  const [modelId, setModelId] = useState(null);
  const [params, setParams] = useState({});
  const [qty, setQty] = useState(1);

  const thumbs = useMemo(() => new Map(CATALOG.map((m) => [m.id, catalogPart(m, {})])), []);
  const model = CATALOG.find((m) => m.id === modelId);
  const clean = (m, o) => Object.fromEntries(m.params.map((p) => {
    const v = Number(o[p.k]);
    return [p.k, o[p.k] === '' || !Number.isFinite(v) ? p.def : Math.min(p.max, Math.max(p.min, v))];
  }));
  const preview = useMemo(() => {
    if (!model) return null;
    try { return catalogPart(model, clean(model, params)); } catch { return null; }
  }, [model, params]);

  const pick = (m) => {
    if (m.id === modelId) { setModelId(null); return; }
    setModelId(m.id);
    setParams(defaultParams(m));
    setQty(1);
  };
  const list = CATALOG.filter((m) => group === 'Hepsi' || m.group === group);

  return (
    <div className="cz-catalog">
      <div className="cz-chips">
        {GROUPS.map((g) => (
          <button key={g} type="button" className={`cz-chip${g === group ? ' active' : ''}`} onClick={() => setGroup(g)}>{g}</button>
        ))}
      </div>
      <div className="cz-model-grid">
        {list.map((m) => (
          <button key={m.id} type="button" className={`cz-model${m.id === modelId ? ' active' : ''}`} onClick={() => pick(m)} title={m.name}>
            <PartCanvas part={thumbs.get(m.id)} size={64} />
            <span>{m.name}</span>
          </button>
        ))}
      </div>
      {model && (
        <div className="cz-model-form">
          <div className="cz-model-form-head">
            {preview && <PartCanvas part={preview} size={120} />}
            <div>
              <strong>{model.name}</strong>
              {preview && <span>{preview.width.toFixed(0)} × {preview.height.toFixed(0)} mm · {preview.comps.filter((c) => c.kind === 'cep').length} bölme{preview.comps.some((c) => c.kind === 'delik') ? ' · delikli' : ''}</span>}
            </div>
          </div>
          <div className="row3">
            {model.params.map((p) => (
              <div key={p.k}>
                <label>{p.label}</label>
                <input
                  type="number"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={params[p.k] ?? p.def}
                  onChange={(e) => {
                    const v = e.target.value === '' ? '' : Number(e.target.value);
                    setParams((o) => ({ ...o, [p.k]: v }));
                  }}
                  onBlur={() => setParams((o) => clean(model, o))}
                />
              </div>
            ))}
            <div>
              <label>Adet</label>
              <input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={!preview}
            onClick={() => {
              onAdd(catalogPart(model, clean(model, params)), qty);
              setModelId(null);
            }}
          >
            Listeye ekle
          </button>
        </div>
      )}
    </div>
  );
}
