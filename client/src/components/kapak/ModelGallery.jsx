import { useState } from 'react';
import { sortPresets } from '../../hooks/useKapakWorkspace.js';

export function defaultModelImage(name) {
  const label = String(name || 'Model').trim() || 'Model';
  const esc = label.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="300" height="400" fill="#1d212b"/><rect x="40" y="40" width="220" height="320" fill="none" stroke="#4f8cff" stroke-width="6"/><text x="150" y="205" fill="#e6e8ec" font-family="Arial, sans-serif" font-size="34" font-weight="700" text-anchor="middle">${esc}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Picture cards of the saved models, in natural order. Clicking a card chooses
 * that model for the whole kapak workspace.
 */
export default function ModelGallery({ presets, activeId, onSelect, loading, compact = false }) {
  const kapi = (presets || []).some((p) => p.category === 'kapi');
  const [category, setCategory] = useState('kapak');
  const list = sortPresets((presets || []).filter((p) => (p.category || 'kapak') === category));
  return (
    <div className={`model-gallery${compact ? ' compact' : ''}`}>
      {kapi && (
        <div className="model-gallery-tabs">
          <button type="button" className={`tab${category === 'kapak' ? ' active' : ''}`} onClick={() => setCategory('kapak')}>Kapak</button>
          <button type="button" className={`tab${category === 'kapi' ? ' active' : ''}`} onClick={() => setCategory('kapi')}>Kapı</button>
        </div>
      )}
      {loading && !list.length && <div className="hint">Modeller yükleniyor…</div>}
      {!loading && !list.length && <div className="hint">Kayıtlı model yok. Atölye → Modeller bölümünden ekleyin.</div>}
      <div className="model-grid">
        {list.map((p) => {
          const id = p._id || p.id;
          const active = id === activeId;
          return (
            <button
              type="button"
              key={id}
              className={`model-card${active ? ' active' : ''}`}
              onClick={() => onSelect(p)}
              title={p.name}
              aria-pressed={active}
            >
              <img src={p.imageDataUrl || defaultModelImage(p.name)} alt="" loading="lazy" />
              <span className="model-card-name">{p.name}</span>
              {active && <span className="model-card-check" aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Seçili model" bar for screens that work with the chosen model (Toplu Liste,
 * Nesting…): picture + name, and a button that opens the gallery to change it.
 */
export function ActiveModelBar({ workspace, presets, loading }) {
  const [open, setOpen] = useState(false);
  const { activeModel } = workspace;
  const id = activeModel && activeModel.id;
  const preset = (presets || []).find((p) => (p._id || p.id) === id);
  const name = workspace.modelName(presets);
  return (
    <div className="active-model">
      <div className="active-model-bar">
        <img src={preset?.imageDataUrl || defaultModelImage(name || '?')} alt="" />
        <div className="active-model-text">
          <span className="active-model-label">Seçili model</span>
          <strong>{name || 'Model seçilmedi'}</strong>
          {activeModel?.custom && <span className="badge" title="Bıçak sırası Atölye'de elle değiştirildi">özelleştirilmiş</span>}
        </div>
        <button type="button" className="btn-secondary" onClick={() => setOpen((o) => !o)}>
          {open ? 'Kapat' : name ? 'Değiştir' : 'Model seç'}
        </button>
      </div>
      {open && (
        <ModelGallery
          presets={presets}
          loading={loading}
          activeId={id}
          compact
          onSelect={(p) => { workspace.selectPreset(p); setOpen(false); }}
        />
      )}
    </div>
  );
}
