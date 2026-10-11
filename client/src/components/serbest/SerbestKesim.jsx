import { useMemo, useRef, useState } from 'react';
import SimPanel from '../SimPanel.jsx';
import { parseDxf } from '../../lib/cerezlik/dxf.js';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import { useToolMagazine } from '../../hooks/useToolMagazine.js';
import { toSimTools } from '../../lib/sim/toolMagazine.js';
import { DEFAULT_LAYER, OPS, buildSerbestProgram, guessOp, layersOf, placeDrawing } from '../../lib/serbest/serbest.js';

const COLORS = ['#4f8cff', '#2ecc8f', '#ff9f43', '#e056fd', '#feca57', '#ff6b6b', '#48dbfb', '#c8d6e5', '#1dd1a1', '#f368e0'];
const TOOL_COLORS = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#f368e0', '#ff9f43', '#c8d6e5', '#54a0ff'];
const DRAWING_KEY = 'empire-cnc-serbest-dxf';
// a pocket or a V line never goes through by default (empty depth = through)
const OP_DEPTH = { cep: 5, vcizgi: 2, hat: 3 };

/**
 * Serbest Kesim: load any DXF, put it on the machine zero (or any X/Y), give
 * every layer an operation and a tool from the magazine, get the program.
 */
export default function SerbestKesim() {
  const fileRef = useRef(null);
  const [file, setFile] = useState(() => {
    try { return JSON.parse(localStorage.getItem(DRAWING_KEY)) || null; } catch { return null; }
  });
  const [error, setError] = useState(null);
  const [settings, setSettings] = usePersistentState('empire-cnc-serbest', {
    thickness: 18, place: { mode: 'solAlt', x: 0, y: 0, rot: 0 }, layers: {}, showPaths: true,
  });
  const [mag] = useToolMagazine();
  const tools = useMemo(() => toSimTools(mag), [mag]);
  const toolOptions = useMemo(() => Object.entries(tools).map(([no, t]) => ({ no, name: t.name })), [tools]);

  const drawing = useMemo(() => {
    if (!file) return null;
    try { return parseDxf(file.text); } catch (e) { return { error: e.message }; }
  }, [file]);
  const layers = useMemo(() => (drawing && !drawing.error ? layersOf(drawing) : []), [drawing]);
  const cfgOf = (name) => {
    const op = guessOp(name);
    return { ...DEFAULT_LAYER, op, tool: op === 'vcizgi' ? '1' : DEFAULT_LAYER.tool, depth: OP_DEPTH[op] ?? null, ...(settings.layers[name] || {}) };
  };
  const layerCfg = useMemo(() => Object.fromEntries(layers.map((l) => [l.name, cfgOf(l.name)])), [layers, settings.layers]); // eslint-disable-line react-hooks/exhaustive-deps
  const placed = useMemo(() => (drawing && !drawing.error ? placeDrawing(drawing, settings.place, layerCfg) : null), [drawing, settings.place, layerCfg]);
  const result = useMemo(() => {
    if (!placed || !placed.box) return null;
    try { return buildSerbestProgram(placed, layerCfg, { thickness: settings.thickness, tools }); } catch (e) { return { error: e.message }; }
  }, [placed, layerCfg, settings.thickness, tools]);

  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const setPlace = (patch) => setSettings((s) => ({ ...s, place: { ...s.place, ...patch } }));
  const setLayer = (name, patch) => setSettings((s) => ({ ...s, layers: { ...s.layers, [name]: { ...cfgOf(name), ...(s.layers[name] || {}), ...patch } } }));

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    const text = await f.text();
    try { parseDxf(text); } catch (err) { setError(`${f.name}: ${err.message}`); return; }
    const next = { name: f.name, text };
    setFile(next);
    try { localStorage.setItem(DRAWING_KEY, JSON.stringify(next)); } catch { /* too big to remember: fine */ }
  }
  function download() {
    const blob = new Blob([result.gcode], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(file?.name || 'serbest').replace(/\.dxf$/i, '')}.nc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const box = placed?.box;
  const layerColor = (name) => COLORS[Math.max(0, layers.findIndex((l) => l.name === name)) % COLORS.length];
  const toolNos = result?.preview ? [...new Set(result.preview.map((p) => String(p.tool)))] : [];
  const toolColor = (t) => TOOL_COLORS[toolNos.indexOf(String(t)) % TOOL_COLORS.length];

  return (
    <div className="converter-grid serbest">
      <section className="card">
        <h2>Serbest Kesim</h2>
        <button type="button" className="btn-primary" style={{ marginTop: 0 }} onClick={() => fileRef.current?.click()}>📂 DXF yükle</button>
        <input ref={fileRef} type="file" accept=".dxf" hidden onChange={onFile} />
        {file && <div className="converter-file-name" title={file.name}>{file.name}</div>}
        {(error || drawing?.error) && <div className="err" style={{ display: 'block' }}>{error || drawing.error}</div>}
        {drawing?.warnings?.length > 0 && <div className="hint hint-warn">{drawing.warnings.join(' ')}</div>}

        <label>Malzeme kalınlığı (mm)</label>
        <input type="number" step="0.1" min="1" value={settings.thickness} onChange={(e) => set({ thickness: Number(e.target.value) || 18 })} />

        <label>Konum</label>
        <div className="serbest-chips">
          {[['solAlt', 'Sol alt köşe → 0,0'], ['merkez', 'Merkez → 0,0'], ['ozel', 'Sol alt köşe → X,Y']].map(([k, t]) => (
            <button key={k} type="button" className={`tab${settings.place.mode === k ? ' active' : ''}`} onClick={() => setPlace({ mode: k })}>{t}</button>
          ))}
        </div>
        {settings.place.mode === 'ozel' && (
          <div className="row2" style={{ marginTop: 8 }}>
            <div><label>X</label><input type="number" step="0.1" value={settings.place.x} onChange={(e) => setPlace({ x: e.target.value })} /></div>
            <div><label>Y</label><input type="number" step="0.1" value={settings.place.y} onChange={(e) => setPlace({ y: e.target.value })} /></div>
          </div>
        )}
        <label>Döndür</label>
        <div className="serbest-chips">
          {[0, 90, 180, 270].map((r) => (
            <button key={r} type="button" className={`tab${(Number(settings.place.rot) || 0) === r ? ' active' : ''}`} onClick={() => setPlace({ rot: r })}>{r}°</button>
          ))}
        </div>
        {box && (
          <div className="converter-stats" style={{ marginTop: 14 }}>
            <span>Ölçü</span><b>{box.w.toFixed(1)} × {box.h.toFixed(1)} mm</b>
          </div>
        )}
        {box && (
          <div className="converter-stats">
            <span>Alan</span><b>X {box.x0.toFixed(1)} … {box.x1.toFixed(1)} · Y {box.y0.toFixed(1)} … {box.y1.toFixed(1)}</b>
          </div>
        )}
        {!file && <div className="hint">DXF'teki her katman ayrı bir işlem olur: kesim, cep, V çizgi… Katman adında “CEP”, “V”, “HAT” geçiyorsa işlem kendiliğinden seçilir.</div>}
      </section>

      <section className="card converter-preview-card">
        <div className="converter-stats">
          <span>{result?.gcode ? `${result.gcode.split('\n').length} satır · ~${Math.round(result.minutes)} dk · ${toolNos.map((t) => `T${t}`).join(' ')}` : 'Önizleme'}</span>
          <label className="check-field" style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={settings.showPaths} onChange={(e) => set({ showPaths: e.target.checked })} /> Bıçak yolları
          </label>
        </div>
        <div className="converter-canvas-wrap">
          {box ? <Preview placed={placed} result={settings.showPaths ? result : null} layerColor={layerColor} toolColor={toolColor} /> : <span className="hint">DXF yükleyin</span>}
        </div>
        {toolNos.length > 0 && settings.showPaths && (
          <div className="serbest-legend">{toolNos.map((t) => <span key={t}><i style={{ background: toolColor(t) }} />{tools[Number(t)]?.name || `T${t}`}</span>)}</div>
        )}
      </section>

      {layers.length > 0 && (
        <section className="card serbest-layers">
          <h2>Katmanlar</h2>
          <div className="mag-lib-wrap">
            <table className="tool-table">
              <thead>
                <tr><th>Katman</th><th>İşlem</th><th>Bıçak</th><th>Derinlik</th><th>Paso</th><th>Kesim F</th><th>Dalış F</th><th>Köprü (adet × boy × yük.)</th></tr>
              </thead>
              <tbody>
                {layers.map((l) => {
                  const c = layerCfg[l.name];
                  const cut = ['kesim', 'dis', 'ic'].includes(c.op);
                  return (
                    <tr key={l.name}>
                      <td className="name-cell" style={{ textAlign: 'left' }}>
                        <i className="serbest-dot" style={{ background: layerColor(l.name) }} />{l.name}
                        <small> · {l.closed ? `${l.closed} kapalı` : ''}{l.closed && l.open ? ', ' : ''}{l.open ? `${l.open} açık` : ''}</small>
                      </td>
                      <td>
                        <select value={c.op} onChange={(e) => { const op = e.target.value; setLayer(l.name, { op, depth: OP_DEPTH[op] ?? null, ...(op === 'vcizgi' ? { tool: '1' } : {}) }); }}>
                          {Object.entries(OPS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={c.tool} disabled={c.op === 'yok'} onChange={(e) => setLayer(l.name, { tool: e.target.value })}>
                          {toolOptions.map((t) => <option key={t.no} value={t.no}>{t.name}</option>)}
                        </select>
                      </td>
                      <td><input type="number" step="0.1" min="0" disabled={c.op === 'yok'} value={c.depth ?? ''} placeholder={`${settings.thickness} (boydan)`} onChange={(e) => setLayer(l.name, { depth: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                      <td><input type="number" step="0.5" min="0.5" disabled={c.op === 'yok' || c.op === 'vcizgi'} value={c.stepdown} onChange={(e) => setLayer(l.name, { stepdown: Number(e.target.value) || 6 })} /></td>
                      <td><input type="number" step="100" min="100" disabled={c.op === 'yok'} value={c.feed} onChange={(e) => setLayer(l.name, { feed: Number(e.target.value) || 5000 })} /></td>
                      <td><input type="number" step="100" min="100" disabled={c.op === 'yok'} value={c.plunge} onChange={(e) => setLayer(l.name, { plunge: Number(e.target.value) || 1500 })} /></td>
                      <td className="serbest-tabs">
                        <input type="number" min="0" step="1" disabled={!cut} value={c.tabs} title="adet" onChange={(e) => setLayer(l.name, { tabs: Number(e.target.value) || 0 })} />
                        <input type="number" min="0" step="1" disabled={!cut} value={c.tabLen} title="boy (mm)" onChange={(e) => setLayer(l.name, { tabLen: Number(e.target.value) || 0 })} />
                        <input type="number" min="0" step="0.5" disabled={!cut} value={c.tabHeight} title="yükseklik (mm)" onChange={(e) => setLayer(l.name, { tabHeight: Number(e.target.value) || 0 })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hint">
            Kesim: kapalı şekillerin dış hattı dıştan, içindeki delikler içten kesilir; bıçağın gerçek çapı Atölye → Bıçaklar'dan gelir.
            Derinlik boşsa malzeme boyunca (Z0'a kadar) keser; köprüler yalnız boydan kesilen dış hatlarda kalır. Sıra: önce oyma/cep, sonra delikler, en son dış hatlar (küçükten büyüğe).
          </div>
          {result?.warnings?.length > 0 && <div className="hint hint-warn">{result.warnings.join(' ')}</div>}
          {result?.error && <div className="err" style={{ display: 'block' }}>{result.error}</div>}
          {result?.gcode && (
            <>
              <button type="button" className="btn-accent2" onClick={download}>⬇ G-code indir (.nc)</button>
              <SimPanel gcode={result.gcode} top={settings.thickness} name={(file?.name || 'serbest').replace(/\.dxf$/i, '')} />
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** Top view: the placed drawing in its layer colours, the machine zero, and the toolpaths. */
function Preview({ placed, result, layerColor, toolColor }) {
  const { box } = placed;
  const pad = Math.max(box.w, box.h) * 0.06 + 10;
  const x0 = Math.min(box.x0, 0) - pad, y0 = Math.min(box.y0, 0) - pad;
  const x1 = Math.max(box.x1, 0) + pad, y1 = Math.max(box.y1, 0) + pad;
  const W = x1 - x0, H = y1 - y0, sw = Math.max(W, H) / 600;
  const pts = (p) => p.map(([x, y]) => `${(x - x0).toFixed(2)},${(y1 - y).toFixed(2)}`).join(' ');
  const cross = Math.max(W, H) * 0.04;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <rect x={box.x0 - x0} y={y1 - box.y1} width={box.w} height={box.h} fill="none" stroke="var(--border)" strokeDasharray={`${sw * 4} ${sw * 3}`} strokeWidth={sw} />
      {placed.loops.map((l, i) => <polygon key={`l${i}`} points={pts(l.pts)} fill="none" stroke={layerColor(l.layer)} strokeWidth={sw * 1.4} />)}
      {placed.chains.map((c, i) => <polyline key={`c${i}`} points={pts(c.pts)} fill="none" stroke={layerColor(c.layer)} strokeWidth={sw * 1.4} />)}
      {result?.preview?.map((p, i) => <polyline key={`p${i}`} points={pts(p.pts)} fill="none" stroke={toolColor(p.tool)} strokeWidth={sw * 0.8} opacity="0.75" />)}
      <g stroke="#ff4d4d" strokeWidth={sw * 1.5}>
        <line x1={-x0 - cross} y1={y1} x2={-x0 + cross} y2={y1} />
        <line x1={-x0} y1={y1 - cross} x2={-x0} y2={y1 + cross} />
      </g>
      <text x={-x0 + cross * 0.3} y={y1 + cross * 0.9} fill="#ff4d4d" fontSize={cross * 0.6}>0,0</text>
    </svg>
  );
}
