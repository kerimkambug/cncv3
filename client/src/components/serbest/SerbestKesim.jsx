import { useEffect, useMemo, useRef, useState } from 'react';
import SimPanel from '../SimPanel.jsx';
import { parseDxf } from '../../lib/cerezlik/dxf.js';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import { useToolMagazine } from '../../hooks/useToolMagazine.js';
import { toSimTools } from '../../lib/sim/toolMagazine.js';
import { DEFAULT_OP, OPS, OP_DEPTH, buildSerbestProgram, layersOf, placeDrawing } from '../../lib/serbest/serbest.js';

const OP_COLORS = ['#4f8cff', '#2ecc8f', '#ff9f43', '#e056fd', '#48dbfb', '#ff6b6b', '#1dd1a1', '#f368e0', '#feca57', '#54a0ff'];
const SELECTED = '#ffd400';
const FREE = '#8a93a3';
const DRAWING_KEY = 'empire-cnc-serbest-dxf';
const newId = () => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Serbest Kesim, the ArtCAM way: load a DXF, put it on the machine zero (or any
 * X/Y), pick vectors (click, shift/ctrl + click, drag a box) and give the
 * selection an operation and a tool. The operations list holds what was made;
 * the program is built from it.
 */
export default function SerbestKesim() {
  const fileRef = useRef(null);
  const canvasApi = useRef(null);
  const [file, setFile] = useState(() => {
    try { return JSON.parse(localStorage.getItem(DRAWING_KEY)) || null; } catch { return null; }
  });
  const [error, setError] = useState(null);
  const [settings, setSettings] = usePersistentState('empire-cnc-serbest', { thickness: 18, place: { mode: 'solAlt', x: 0, y: 0, rot: 0 }, showPaths: true });
  const [form, setForm] = usePersistentState('empire-cnc-serbest-form', { ...DEFAULT_OP });
  const [opsByFile, setOpsByFile] = usePersistentState('empire-cnc-serbest-ops', {});
  const [selection, setSelection] = useState(() => new Set());
  const [mag] = useToolMagazine();
  const tools = useMemo(() => toSimTools(mag), [mag]);
  const toolOptions = useMemo(() => Object.entries(tools).map(([no, t]) => ({ no, name: t.name })), [tools]);

  const fileKey = file ? `${file.name}|${file.text.length}` : '';
  const ops = opsByFile[fileKey] || [];
  const setOps = (fn) => setOpsByFile((m) => ({ ...m, [fileKey]: typeof fn === 'function' ? fn(m[fileKey] || []) : fn }));

  const drawing = useMemo(() => {
    if (!file) return null;
    try { return parseDxf(file.text); } catch (e) { return { error: e.message }; }
  }, [file]);
  const layers = useMemo(() => (drawing && !drawing.error ? layersOf(drawing) : []), [drawing]);
  const placed = useMemo(() => (drawing && !drawing.error ? placeDrawing(drawing, settings.place) : null), [drawing, settings.place]);
  const vectors = useMemo(() => (placed ? [...placed.loops, ...placed.chains] : []), [placed]);
  const result = useMemo(() => {
    if (!placed?.box || !ops.length) return null;
    try { return buildSerbestProgram(placed, ops, { thickness: settings.thickness, tools }); } catch (e) { return { error: e.message }; }
  }, [placed, ops, settings.thickness, tools]);

  // which operation colours a vector (the first one it is in)
  const opOf = useMemo(() => {
    const m = new Map();
    ops.forEach((o, i) => o.items.forEach((id) => { if (!m.has(id)) m.set(id, i); }));
    return m;
  }, [ops]);

  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const setPlace = (patch) => setSettings((s) => ({ ...s, place: { ...s.place, ...patch } }));
  const select = (ids, mode = 'replace') => setSelection((cur) => {
    if (mode === 'replace') return new Set(ids);
    const next = new Set(cur);
    if (mode === 'add') ids.forEach((id) => next.add(id));
    if (mode === 'toggle') ids.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)));
    return next;
  });

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    const text = await f.text();
    try { parseDxf(text); } catch (err) { setError(`${f.name}: ${err.message}`); return; }
    const next = { name: f.name, text };
    setFile(next);
    setSelection(new Set());
    try { localStorage.setItem(DRAWING_KEY, JSON.stringify(next)); } catch { /* too big to remember: fine */ }
  }
  function addOp() {
    if (!selection.size) return;
    const n = ops.filter((o) => o.op === form.op).length + 1;
    setOps((list) => [...list, { ...form, id: newId(), name: `${OPS[form.op].split(' (')[0]} ${n}`, items: [...selection] }]);
    setSelection(new Set());
  }
  const updateOp = (id, patch) => setOps((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const removeOp = (id) => setOps((list) => list.filter((o) => o.id !== id));
  const setFormOp = (op) => setForm((f) => ({ ...f, op, depth: OP_DEPTH[op] ?? null, ...(op === 'vcizgi' ? { tool: '1' } : {}) }));

  function download() {
    const blob = new Blob([result.gcode], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(file?.name || 'serbest').replace(/\.dxf$/i, '')}.nc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ArtCAM keys: Esc drops the selection, Ctrl+A selects everything (not while typing in a field)
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'Escape') setSelection(new Set());
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && vectors.length) { e.preventDefault(); setSelection(new Set(vectors.map((v) => v.id))); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [vectors]);

  const box = placed?.box;
  const selClosed = vectors.filter((v) => selection.has(v.id) && v.closed).length;
  const toolNos = result?.preview ? [...new Set(result.preview.map((p) => String(p.tool)))] : [];

  return (
    <div className="serbest">
      <div className="serbest-top">
        <section className="card serbest-side">
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
            {[['solAlt', 'Sol alt → 0,0'], ['merkez', 'Merkez → 0,0'], ['ozel', 'Sol alt → X,Y']].map(([k, t]) => (
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
            <>
              <div className="converter-stats" style={{ marginTop: 14 }}><span>Ölçü</span><b>{box.w.toFixed(1)} × {box.h.toFixed(1)} mm</b></div>
              <div className="converter-stats"><span>Alan</span><b>X {box.x0.toFixed(1)} … {box.x1.toFixed(1)} · Y {box.y0.toFixed(1)} … {box.y1.toFixed(1)}</b></div>
              <div className="converter-stats"><span>Vektör</span><b>{placed.loops.length} kapalı · {placed.chains.length} açık</b></div>
            </>
          )}
        </section>

        <section className="card serbest-view">
          <div className="serbest-toolbar">
            <span className="serbest-selinfo">{selection.size ? <b>{selection.size} seçili</b> : 'Seçim yok'}{selection.size ? ` (${selClosed} kapalı, ${selection.size - selClosed} açık)` : ''}</span>
            <button type="button" className="btn-secondary btn-small" onClick={() => select(vectors.map((v) => v.id))}>Tümü</button>
            <button type="button" className="btn-secondary btn-small" onClick={() => select([])}>Temizle</button>
            <button type="button" className="btn-secondary btn-small" onClick={() => select(vectors.filter((v) => !selection.has(v.id)).map((v) => v.id))}>Ters çevir</button>
            <button type="button" className="btn-secondary btn-small" onClick={() => select(vectors.filter((v) => v.closed).map((v) => v.id))}>Kapalılar</button>
            <button type="button" className="btn-secondary btn-small" onClick={() => select(vectors.filter((v) => !v.closed).map((v) => v.id))}>Açıklar</button>
            <button type="button" className="btn-secondary btn-small" onClick={() => select(vectors.filter((v) => !opOf.has(v.id)).map((v) => v.id))}>İşlemsizler</button>
            {layers.length > 1 && (
              <select className="serbest-layer-pick" value="" onChange={(e) => e.target.value && select(vectors.filter((v) => v.layer === e.target.value).map((v) => v.id))}>
                <option value="">Katmandan seç…</option>
                {layers.map((l) => <option key={l.name} value={l.name}>{l.name} ({l.closed + l.open})</option>)}
              </select>
            )}
            <button type="button" className="btn-secondary btn-small" onClick={() => canvasApi.current?.fit()}>Sığdır</button>
            <button type="button" className="btn-secondary btn-small" disabled={!selection.size} onClick={() => canvasApi.current?.zoomTo(selection)}>Seçime yakınlaş</button>
            <label className="check-field serbest-paths"><input type="checkbox" checked={settings.showPaths} onChange={(e) => set({ showPaths: e.target.checked })} /> Bıçak yolları</label>
          </div>
          <div className="serbest-canvas">
            {box ? (
              <Canvas
                placed={placed} vectors={vectors} selection={selection} select={select} api={canvasApi}
                colorOf={(id) => (selection.has(id) ? SELECTED : opOf.has(id) ? OP_COLORS[opOf.get(id) % OP_COLORS.length] : FREE)}
                paths={settings.showPaths ? result?.preview : null}
              />
            ) : <span className="hint">DXF yükleyin</span>}
          </div>
          <div className="hint">
            Tıkla: seç · Shift/Ctrl + tıkla: ekle/çıkar · Boşlukta sürükle: kutu ile seç (soldan sağa: tamamı içinde olanlar, sağdan sola: değenler) ·
            Tekerlek: yakınlaş · Sağ tuş / orta tuş ile sürükle: kaydır · Çift tıkla: sığdır · Esc: seçimi bırak · Ctrl+A: tümünü seç
          </div>
        </section>
      </div>

      {box && (
        <section className="card serbest-ops">
          <h2>İşlemler</h2>
          <div className="serbest-form">
            <div><label>İşlem</label>
              <select value={form.op} onChange={(e) => setFormOp(e.target.value)}>{Object.entries(OPS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
            <div><label>Bıçak</label>
              <select value={form.tool} onChange={(e) => setForm((f) => ({ ...f, tool: e.target.value }))}>{toolOptions.map((t) => <option key={t.no} value={t.no}>{t.name}</option>)}</select></div>
            <OpFields o={form} thickness={settings.thickness} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
            <button type="button" className="btn-accent2 serbest-add" disabled={!selection.size} onClick={addOp}>
              {selection.size ? `+ Seçili ${selection.size} vektöre uygula` : 'Önce vektör seçin'}
            </button>
          </div>

          {ops.length > 0 && (
            <div className="mag-lib-wrap">
              <table className="tool-table serbest-optable">
                <thead><tr><th /><th>Ad</th><th>İşlem</th><th>Bıçak</th><th>Derinlik</th><th>Paso</th><th>Kesim F</th><th>Dalış F</th><th>Köprü</th><th>Vektör</th><th /></tr></thead>
                <tbody>
                  {ops.map((o, i) => (
                    <tr key={o.id}>
                      <td><i className="serbest-dot" style={{ background: OP_COLORS[i % OP_COLORS.length] }} /></td>
                      <td className="name-cell"><input value={o.name} onChange={(e) => updateOp(o.id, { name: e.target.value })} /></td>
                      <td><select value={o.op} onChange={(e) => updateOp(o.id, { op: e.target.value, depth: OP_DEPTH[e.target.value] ?? null })}>{Object.entries(OPS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                      <td><select value={o.tool} onChange={(e) => updateOp(o.id, { tool: e.target.value })}>{toolOptions.map((t) => <option key={t.no} value={t.no}>{t.name}</option>)}</select></td>
                      <OpFields o={o} thickness={settings.thickness} cells onChange={(patch) => updateOp(o.id, patch)} />
                      <td>{o.items.length}</td>
                      <td className="serbest-rowbtns">
                        <button type="button" className="btn-secondary btn-small" title="Bu işlemin vektörlerini seç" onClick={() => select(o.items)}>Seç</button>
                        <button type="button" className="btn-secondary btn-small" title="Vektörlerini şu anki seçimle değiştir" disabled={!selection.size} onClick={() => updateOp(o.id, { items: [...selection] })}>Seçimi ata</button>
                        <button type="button" className="btn-danger btn-small" onClick={() => removeOp(o.id)}>Sil</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="hint">
            Kesim: seçilen kapalı şekillerden dıştakiler dıştan, içlerindeki delikler içten kesilir. Cep: seçilen şekillerden dıştakinin içi taranır,
            içindeki seçili şekiller ada olarak kalır (iki iç içe şekil → aradaki şerit; kare + içindeki 4 desen → karenin içinde desenlerin dışında kalan alan);
            bıçak payı hem dış kenardan hem adalardan bırakılır. Bıçağın gerçek çapı Atölye → Bıçaklar'dan gelir.
            Derinlik boşsa boydan (Z0'a kadar) keser; köprüler yalnız boydan kesilen dış hatlarda kalır. Program sırası: önce oyma/cep/çizgiler,
            sonra delikler, en son dış hatlar (küçükten büyüğe). Bir vektör birden çok işlemde olabilir.
          </div>
          {result?.warnings?.length > 0 && <div className="hint hint-warn">{result.warnings.join(' ')}</div>}
          {result?.error && <div className="err" style={{ display: 'block' }}>{result.error}</div>}
          {result?.gcode && (
            <>
              <div className="converter-stats" style={{ marginTop: 12 }}>
                <span>Program</span><b>{result.gcode.split('\n').length} satır · ~{Math.round(result.minutes)} dk · {toolNos.map((t) => `T${t}`).join(' ')}</b>
              </div>
              <button type="button" className="btn-accent2" onClick={download}>⬇ G-code indir (.nc)</button>
              <SimPanel gcode={result.gcode} top={settings.thickness} name={(file?.name || 'serbest').replace(/\.dxf$/i, '')} />
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** Depth, step, feeds and tabs of an operation — as form fields or as table cells. */
function OpFields({ o, thickness, onChange, cells = false }) {
  const cut = ['kesim', 'dis', 'ic'].includes(o.op);
  const W = cells ? 'td' : 'div';
  const num = (v, d) => (v === '' ? d : Number(v));
  return (
    <>
      <W>{!cells && <label>Derinlik</label>}<input type="number" step="0.1" min="0" value={o.depth ?? ''} placeholder={`${thickness} (boydan)`} onChange={(e) => onChange({ depth: e.target.value === '' ? null : Number(e.target.value) })} /></W>
      <W>{!cells && <label>Paso</label>}<input type="number" step="0.5" min="0.5" disabled={o.op === 'vcizgi'} value={o.stepdown} onChange={(e) => onChange({ stepdown: num(e.target.value, 6) })} /></W>
      <W>{!cells && <label>Kesim F</label>}<input type="number" step="100" min="100" value={o.feed} onChange={(e) => onChange({ feed: num(e.target.value, 5000) })} /></W>
      <W>{!cells && <label>Dalış F</label>}<input type="number" step="100" min="100" value={o.plunge} onChange={(e) => onChange({ plunge: num(e.target.value, 1500) })} /></W>
      <W className="serbest-tabs">{!cells && <label>Köprü (adet × boy × yük.)</label>}
        <input type="number" min="0" step="1" disabled={!cut} value={o.tabs} title="adet" onChange={(e) => onChange({ tabs: num(e.target.value, 0) })} />
        <input type="number" min="0" step="1" disabled={!cut} value={o.tabLen} title="boy (mm)" onChange={(e) => onChange({ tabLen: num(e.target.value, 0) })} />
        <input type="number" min="0" step="0.5" disabled={!cut} value={o.tabHeight} title="yükseklik (mm)" onChange={(e) => onChange({ tabHeight: num(e.target.value, 0) })} />
      </W>
    </>
  );
}

/**
 * The drawing to pick from: vectors in their colours, the machine zero, the
 * toolpaths; click / box selection, wheel zoom, right-drag pan, double-click fit.
 * Drawn in drawing coordinates with Y turned (svg y = −y).
 */
function Canvas({ placed, vectors, selection, select, colorOf, paths, api }) {
  const svgRef = useRef(null);
  const { box } = placed;
  const fit = () => {
    const pad = Math.max(box.w, box.h) * 0.06 + 10;
    const x0 = Math.min(box.x0, 0) - pad, y0 = Math.min(box.y0, 0) - pad;
    const x1 = Math.max(box.x1, 0) + pad, y1 = Math.max(box.y1, 0) + pad;
    return { x: x0, y: -y1, w: x1 - x0, h: y1 - y0 };
  };
  const [view, setView] = useState(fit);
  useEffect(() => { setView(fit()); }, [box.x0, box.y0, box.w, box.h]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Sığdır" / "Seçime yakınlaş" buttons outside the canvas
  if (api) {
    api.current = {
      fit: () => setView(fit()),
      zoomTo: (ids) => {
        const vs = vectors.filter((v) => ids.has(v.id));
        if (!vs.length) return;
        const x0 = Math.min(...vs.map((v) => v.box.x0)), x1 = Math.max(...vs.map((v) => v.box.x1));
        const y0 = Math.min(...vs.map((v) => v.box.y0)), y1 = Math.max(...vs.map((v) => v.box.y1));
        const pad = Math.max(x1 - x0, y1 - y0, 10) * 0.15;
        setView({ x: x0 - pad, y: -(y1 + pad), w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad });
      },
    };
  }
  // the drag lives in a ref (read at once by the next event, even a very fast click)
  // and in state (to draw the selection box)
  const dragRef = useRef(null);
  const [drag, setDragState] = useState(null); // {kind:'box'|'pan', a, b, add, v}
  const setDrag = (d) => { dragRef.current = d; setDragState(d); };

  const toUser = (e) => {
    const svg = svgRef.current, p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const u = p.matrixTransform(svg.getScreenCTM().inverse());
    return [u.x, u.y]; // svg user coordinates (y down)
  };
  // wheel zoom around the cursor (a native listener: React's wheel handler cannot preventDefault)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const [ux, uy] = toUser(e), k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      setView((v) => ({ x: ux - (ux - v.x) * k, y: uy - (uy - v.y) * k, w: v.w * k, h: v.h * k }));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  const onDown = (e) => {
    if (e.button === 1 || e.button === 2) { e.preventDefault(); setDrag({ kind: 'pan', a: [e.clientX, e.clientY], v: view }); svgRef.current.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    const p = toUser(e);
    setDrag({ kind: 'box', a: p, b: p, add: e.shiftKey || e.ctrlKey || e.metaKey });
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pan') {
      const r = svgRef.current.getBoundingClientRect();
      const s = Math.max(drag.v.w / r.width, drag.v.h / r.height);
      setView({ ...drag.v, x: drag.v.x - (e.clientX - drag.a[0]) * s, y: drag.v.y - (e.clientY - drag.a[1]) * s });
      return;
    }
    setDrag({ ...drag, b: toUser(e) });
  };
  const onUp = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'box') {
      const [ax, ay] = drag.a, [bx, by] = drag.b;
      const r = svgRef.current.getBoundingClientRect(), px = Math.max(view.w / r.width, view.h / r.height);
      if (Math.abs(bx - ax) < 4 * px && Math.abs(by - ay) < 4 * px) {
        // a click: the vector whose line is nearest the cursor (within a few pixels)
        const hit = pick(vectors, ax, -ay, 6 * px);
        if (hit) select([hit.id], drag.add ? 'toggle' : 'replace');
        else if (!drag.add) select([]);
      } else {
        const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = -Math.max(ay, by), y1 = -Math.min(ay, by);
        const crossing = bx < ax; // right to left: everything the box touches (CAD convention)
        const ids = vectors.filter((v) => (crossing
          ? v.box.x1 >= x0 && v.box.x0 <= x1 && v.box.y1 >= y0 && v.box.y0 <= y1 && touches(v, x0, y0, x1, y1)
          : v.box.x0 >= x0 && v.box.x1 <= x1 && v.box.y0 >= y0 && v.box.y1 <= y1)).map((v) => v.id);
        select(ids, drag.add ? 'add' : 'replace');
      }
    }
    setDrag(null);
    svgRef.current.releasePointerCapture?.(e.pointerId);
  };

  const pts = (p) => p.map(([x, y]) => `${x},${-y}`).join(' ');
  const cross = Math.max(view.w, view.h) * 0.03;
  // the selection is drawn last so it sits on top
  const ordered = [...vectors].sort((a, b) => (selection.has(a.id) ? 1 : 0) - (selection.has(b.id) ? 1 : 0));
  return (
    <svg
      ref={svgRef} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onContextMenu={(e) => e.preventDefault()} onDoubleClick={() => setView(fit())}
      style={{ cursor: drag?.kind === 'pan' ? 'grabbing' : 'crosshair' }}
    >
      <rect x={box.x0} y={-box.y1} width={box.w} height={box.h} fill="none" stroke="#3a4250" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      {ordered.map((v) => {
        const El = v.closed ? 'polygon' : 'polyline';
        return <El key={v.id} points={pts(v.pts)} fill="none" stroke={colorOf(v.id)} strokeWidth={selection.has(v.id) ? 2.4 : 1.4} vectorEffect="non-scaling-stroke" />;
      })}
      {paths?.map((p, i) => <polyline key={`p${i}`} points={pts(p.pts)} fill="none" stroke="#ff6b6b" strokeWidth="0.8" opacity="0.65" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      <g stroke="#ff4d4d" pointerEvents="none">
        <line x1={-cross} y1={0} x2={cross} y2={0} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1={0} y1={-cross} x2={0} y2={cross} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </g>
      {drag?.kind === 'box' && (
        <rect
          x={Math.min(drag.a[0], drag.b[0])} y={Math.min(drag.a[1], drag.b[1])} width={Math.abs(drag.b[0] - drag.a[0])} height={Math.abs(drag.b[1] - drag.a[1])}
          fill={drag.b[0] < drag.a[0] ? 'rgba(46,204,143,.12)' : 'rgba(79,140,255,.12)'} stroke={drag.b[0] < drag.a[0] ? '#2ecc8f' : '#4f8cff'}
          strokeDasharray={drag.b[0] < drag.a[0] ? '5 4' : 'none'} vectorEffect="non-scaling-stroke" pointerEvents="none"
        />
      )}
    </svg>
  );
}

/** The vector whose line passes nearest to (x, y), within `tol`. */
function pick(vectors, x, y, tol) {
  let best = null, bd = tol;
  for (const v of vectors) {
    if (x < v.box.x0 - tol || x > v.box.x1 + tol || y < v.box.y0 - tol || y > v.box.y1 + tol) continue;
    const n = v.pts.length, segs = v.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const [ax, ay] = v.pts[i], [bx, by] = v.pts[(i + 1) % n];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
      if (d < bd) { bd = d; best = v; }
    }
  }
  return best;
}

/** Whether any segment of the vector crosses or lies in the box (for right-to-left selection). */
function touches(v, x0, y0, x1, y1) {
  const n = v.pts.length, segs = v.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    let [ax, ay] = v.pts[i], [bx, by] = v.pts[(i + 1) % n];
    // Liang–Barsky clip of the segment against the box
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay)) return true;
  }
  return false;
}
