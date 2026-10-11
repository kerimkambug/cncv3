import { useEffect, useMemo, useRef, useState } from 'react';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import { useToolMagazine } from '../../hooks/useToolMagazine.js';
import { toSimTools } from '../../lib/sim/toolMagazine.js';
import { sortPresets } from '../../hooks/useKapakWorkspace.js';
import { COLORS, COUNTERS, FINISHES, GLASSES, HANDLES } from '../../lib/mutfak/kitchen.js';
import { createKitchen } from '../../lib/mutfak/scene.js';

const idOf = (p) => p?._id || p?.id;
// the Panjur screen's door (its own defaults), next to the kapak models
const PANJUR_MODEL = { _id: '__panjur__', name: 'Panjur', panjur: {}, thickness: 18, description: 'Panjur ekranının ayarlarıyla: T14 konik uç, 40.5 mm çıta, 60 mm çerçeve' };

/**
 * Mutfak: a sample kitchen in 3D with the workshop's own door models on it.
 * Every door's surface is the model's real program for that door size, cut in
 * the simulation — what the customer sees is what the machine will make.
 */
export default function MutfakModule({ presets = [] }) {
  const models = useMemo(() => [...sortPresets(presets.filter((p) => (p.category || 'kapak') === 'kapak' && !p.cam && p.rows?.length)), PANJUR_MODEL], [presets]);
  const [look, setLook] = usePersistentState('empire-cnc-mutfak', {
    alt: null, ust: null, color: 'beyaz', finish: 'mat', glass: 'seffaf', counter: 'mermer', handle: 'inox',
  });
  const [target, setTarget] = useState('hepsi'); // which doors a model click goes to
  const [busy, setBusy] = useState(0);
  const [allOpen, setAllOpen] = useState(false);
  const [mag] = useToolMagazine();
  const tools = useMemo(() => toSimTools(mag), [mag]);
  const host = useRef(null);
  const kitchen = useRef(null);
  const worker = useRef(null);
  const cache = useRef(new Map());
  const wanted = useRef(new Map()); // relief key -> cache key it should show now

  const altModel = models.find((m) => idOf(m) === look.alt) || models[0] || null;
  const ustModel = models.find((m) => idOf(m) === look.ust) || altModel;
  const set = (k, v) => setLook((l) => ({ ...l, [k]: v }));

  // scene + door worker live as long as the page
  useEffect(() => {
    kitchen.current = createKitchen(host.current);
    const w = new Worker(new URL('../../lib/mutfak/door.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { key, relief } = e.data;
      cache.current.set(key, relief);
      setBusy((n) => Math.max(0, n - 1));
      for (const [rk, ck] of wanted.current) if (ck === key) kitchen.current?.setRelief(rk, relief);
    };
    worker.current = w;
    return () => { w.terminate(); kitchen.current?.dispose(); kitchen.current = null; };
  }, []);

  useEffect(() => { kitchen.current?.setLook(look); }, [look]);

  // door surfaces: one per (model, door size); built once, then from the cache
  const toolsKey = JSON.stringify(tools);
  useEffect(() => {
    const k = kitchen.current;
    if (!k) return;
    for (const rk of k.keys) {
      const [group, size] = rk.split('|');
      const [w, h] = size.split('x').map(Number);
      const model = group === 'ust' ? ustModel : altModel;
      if (!model) { wanted.current.set(rk, null); k.setRelief(rk, null); continue; }
      const ck = `${idOf(model)}|${model.updatedAt || ''}|${size}|${toolsKey.length}`;
      wanted.current.set(rk, ck);
      if (cache.current.has(ck)) { k.setRelief(rk, cache.current.get(ck)); continue; }
      cache.current.set(ck, undefined);
      setBusy((n) => n + 1);
      worker.current.postMessage({ key: ck, preset: model, w, h, tools });
    }
  }, [altModel, ustModel, toolsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickModel(m) {
    const id = idOf(m);
    setLook((l) => ({ ...l, ...(target !== 'ust' ? { alt: id } : {}), ...(target !== 'alt' ? { ust: id } : {}) }));
  }
  function snapshot() {
    const a = document.createElement('a');
    a.href = kitchen.current.snapshot();
    a.download = `mutfak-${altModel?.name || 'onizleme'}.png`.replace(/\s+/g, '-');
    document.body.appendChild(a); a.click(); a.remove();
  }
  const customColor = look.color?.startsWith('#');

  return (
    <div className="mutfak">
      <aside className="card mutfak-side">
        <h2>Kapak modeli</h2>
        <div className="mutfak-target">
          {[['hepsi', 'Hepsi'], ['alt', 'Alt + boy'], ['ust', 'Üst']].map(([k, label]) => (
            <button key={k} type="button" className={`tab${target === k ? ' active' : ''}`} onClick={() => setTarget(k)}>{label}</button>
          ))}
        </div>
        <div className="mutfak-models">
          {models.map((m) => {
            const onAlt = idOf(m) === idOf(altModel), onUst = idOf(m) === idOf(ustModel);
            return (
              <button key={idOf(m)} type="button" className={`mutfak-model${onAlt || onUst ? ' active' : ''}`} onClick={() => pickModel(m)} title={m.description || m.name}>
                {m.imageDataUrl ? <img src={m.imageDataUrl} alt="" /> : <span className={`mutfak-noimg${m.panjur ? ' panjur' : ''}`} />}
                <span>{m.name}</span>
                {(onAlt || onUst) && <small>{onAlt && onUst ? 'alt + üst' : onAlt ? 'alt' : 'üst'}</small>}
              </button>
            );
          })}
          {!models.length && <div className="hint">Model listesi yükleniyor…</div>}
        </div>

        <h2 style={{ marginTop: 16 }}>Renk</h2>
        <div className="mutfak-swatches">
          {COLORS.map((c) => (
            <button key={c.id} type="button" title={c.name} className={`mutfak-swatch${look.color === c.id ? ' active' : ''}${c.wood ? ' wood' : ''}`} style={{ background: c.hex }} onClick={() => set('color', c.id)} />
          ))}
          <label className={`mutfak-swatch custom${customColor ? ' active' : ''}`} title="Özel renk" style={customColor ? { background: look.color } : undefined}>
            <input type="color" value={customColor ? look.color : '#b0a090'} onChange={(e) => set('color', e.target.value)} />
          </label>
        </div>
        <div className="hint">{customColor ? `Özel renk ${look.color}` : COLORS.find((c) => c.id === look.color)?.name}</div>

        <label>Yüzey</label>
        <div className="mutfak-chips">
          {FINISHES.map((f) => <button key={f.id} type="button" className={`tab${look.finish === f.id ? ' active' : ''}`} onClick={() => set('finish', f.id)}>{f.name}</button>)}
        </div>

        <label>Cam</label>
        <div className="mutfak-chips">
          {GLASSES.map((g) => (
            <button key={g.id} type="button" className={`tab mutfak-glass${look.glass === g.id ? ' active' : ''}`} onClick={() => set('glass', g.id)}>
              <i style={{ background: g.color, opacity: Math.max(0.35, g.opacity) }} />{g.name}
            </button>
          ))}
        </div>

        <div className="row2">
          <div>
            <label>Tezgâh</label>
            <select value={look.counter} onChange={(e) => set('counter', e.target.value)}>{COUNTERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </div>
          <div>
            <label>Kulp</label>
            <select value={look.handle} onChange={(e) => set('handle', e.target.value)}>{HANDLES.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          </div>
        </div>
      </aside>

      <section className="card mutfak-view">
        <div className="mutfak-toolbar">
          {[['genel', 'Genel'], ['alt', 'Alt dolaplar'], ['ust', 'Üst dolaplar'], ['yan', 'Yandan'], ['oda', 'Odaya dön'], ['disari', 'Dışarıdan']].map(([k, label]) => (
            <button key={k} type="button" className="btn-secondary btn-small" onClick={() => kitchen.current?.view(k)}>{label}</button>
          ))}
          <span className="mutfak-status">{busy > 0 ? `Kapak yüzeyleri hesaplanıyor… (${busy})` : `${altModel?.name || '—'}${ustModel && ustModel !== altModel ? ` · üst: ${ustModel.name}` : ''}`}</span>
          <button type="button" className="btn-secondary btn-small" onClick={() => { const o = !allOpen; setAllOpen(o); kitchen.current?.setAllOpen(o); }}>{allOpen ? 'Hepsini kapat' : 'Hepsini aç'}</button>
          <button type="button" className="btn-secondary btn-small" onClick={snapshot}>📷 Görüntü (PNG)</button>
        </div>
        <div ref={host} className="mutfak-canvas" />
        <div className="hint">
          Kapağa ya da çekmeceye tıklayınca açılır. Fareyle döndürün, tekerlekle yaklaşın, sağ tuşla kaydırın. Kapak yüzeyleri modelin o kapak ölçüsündeki gerçek
          programından, simülasyonla çıkar; modele sığmayan küçük kapaklar (çekmece) düz görünür.
        </div>
      </section>
    </div>
  );
}
