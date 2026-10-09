import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { parseDxf } from '../../lib/cerezlik/dxf.js';
import { buildParts, checkPart } from '../../lib/cerezlik/parts.js';
import { DEFAULT_RECIPE } from '../../lib/cerezlik/toolpaths.js';
import { DEFAULT_PLATE, nestInput, platePrograms, spacing } from '../../lib/cerezlik/job.js';
import { sampleDrawing } from '../../lib/cerezlik/sampleDxf.js';
import { area as polyArea } from '../../lib/cerezlik/geom.js';
import PartCanvas from './PartCanvas.jsx';
import PlateCanvas from './PlateCanvas.jsx';
import CatalogPicker from './CatalogPicker.jsx';

const RECIPE_KEY = 'empire-cnc-cerezlik-recipe';
const PLATE_KEY = 'empire-cnc-cerezlik-plate';

/** localStorage-backed state; nested objects are merged over the defaults. */
function useStored(key, defaults) {
  const [value, setValue] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (!saved || typeof saved !== 'object') return defaults;
      const out = { ...defaults };
      for (const k of Object.keys(defaults)) {
        if (!(k in saved)) continue;
        out[k] = defaults[k] && typeof defaults[k] === 'object' ? { ...defaults[k], ...saved[k] } : saved[k];
      }
      return out;
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }, [key, value]);
  return [value, setValue];
}

function Num({ label, value, onChange, step = 'any', min, suffix }) {
  return (
    <div>
      <label>{label}{suffix ? ` (${suffix})` : ''}</label>
      <input type="number" step={step} min={min} value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    </div>
  );
}

function download(name, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'malzeme';
let fileSeq = 0;

export default function CerezlikModule() {
  const [recipe, setRecipe] = useStored(RECIPE_KEY, { material: 'MDF 18', ext: '.nc', ...structuredClone(DEFAULT_RECIPE) });
  const [plate, setPlate] = useStored(PLATE_KEY, DEFAULT_PLATE);
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(null); // part id shown in the editor
  const [result, setResult] = useState(null); // { nest, programs, key }
  const [plateIdx, setPlateIdx] = useState(0);
  const [running, setRunning] = useState(null); // progress text while nesting
  const [error, setError] = useState('');
  const [showPaths, setShowPaths] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [source, setSource] = useState('katalog');
  const fileInput = useRef(null);
  const workerRef = useRef(null);

  const parts = useMemo(() => files.flatMap((f) => f.parts), [files]);
  const gapInfo = spacing(recipe, plate);
  const inputKey = JSON.stringify([recipe, plate, parts.map((p) => [p.id, p.qty, p.comps.map((c) => c.kind)])]);
  const stale = result && result.key !== inputKey;
  const partWarnings = useMemo(() => new Map(parts.map((p) => [p.id, checkPart(p, recipe)])), [parts, recipe]);
  const totalQty = parts.reduce((s, p) => s + (Number(p.qty) || 0), 0);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const set = (path, v) => setRecipe((r) => {
    const [a, b] = path.split('.');
    return b ? { ...r, [a]: { ...r[a], [b]: v } } : { ...r, [a]: v };
  });
  const setP = (k, v) => setPlate((p) => ({ ...p, [k]: v }));

  async function addFiles(list) {
    setError('');
    const added = [];
    for (const file of list) {
      try {
        const text = typeof file.text === 'function' ? await file.text() : file.content;
        const drawing = parseDxf(text);
        const base = file.name.replace(/\.dxf$/i, '');
        const { parts: ps, warnings } = buildParts(drawing, base);
        if (!ps.length) throw new Error('Kapalı bir dış hat bulunamadı.');
        const fid = `f${++fileSeq}`;
        added.push({
          id: fid,
          name: file.name,
          warnings: [...drawing.warnings, ...warnings],
          parts: ps.map((p, i) => ({ ...p, id: `${fid}-${i}`, qty: 1 })),
        });
      } catch (err) {
        setError((e) => `${e ? `${e}\n` : ''}${file.name}: ${err.message}`);
      }
    }
    if (added.length) setFiles((f) => [...f, ...added]);
  }

  function addCatalogPart(part, qty) {
    setFiles((fs) => {
      const cat = fs.find((f) => f.id === 'katalog') || { id: 'katalog', name: 'Katalogdan', warnings: [], parts: [] };
      const next = { ...cat, parts: [...cat.parts, { ...part, id: `k${++fileSeq}`, qty }] };
      return fs.some((f) => f.id === 'katalog') ? fs.map((f) => (f.id === 'katalog' ? next : f)) : [next, ...fs];
    });
  }

  const removePart = (id) => {
    setFiles((fs) => fs.map((f) => ({ ...f, parts: f.parts.filter((p) => p.id !== id) })).filter((f) => f.parts.length));
    if (selected === id) setSelected(null);
  };

  const updatePart = (id, fn) => setFiles((fs) => fs.map((f) => ({ ...f, parts: f.parts.map((p) => (p.id === id ? fn(p) : p)) })));
  const removeFile = (id) => { setFiles((fs) => fs.filter((f) => f.id !== id)); setSelected(null); };

  function runNesting() {
    const list = parts.filter((p) => p.qty > 0);
    if (!list.length) return;
    setError('');
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../../lib/cerezlik/nest.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const key = inputKey;
    setRunning('Yerleşim aranıyor…');
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') { setRunning(`Yerleşim aranıyor… ${msg.variant} deneme`); return; }
      worker.terminate();
      workerRef.current = null;
      if (msg.type === 'error') { setRunning(null); setError(msg.message); return; }
      setRunning('G-code hazırlanıyor…');
      setTimeout(() => {
        try {
          const programs = platePrograms(msg.result, list, recipe);
          setResult({ nest: msg.result, programs, key, parts: list });
          setPlateIdx(0);
          setSelected(null);
        } catch (err) {
          setError(err.message);
        }
        setRunning(null);
      }, 20);
    };
    worker.onerror = (e) => { setRunning(null); setError(e.message || 'Yerleşim hesaplanamadı.'); worker.terminate(); };
    worker.postMessage(nestInput(list, recipe, plate));
  }

  function cancel() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(null);
  }

  const fileName = (i) => `plaka-${i + 1}${recipe.ext || '.nc'}`;
  async function downloadZip() {
    const zip = new JSZip();
    const dir = zip.folder(safeName(recipe.material));
    result.programs.forEach((p, i) => dir.file(fileName(i), p.gcode));
    download(`cerezlik-${safeName(recipe.material)}.zip`, await zip.generateAsync({ type: 'blob' }));
  }

  const plateArea = plate.width * plate.height;
  const usage = result ? result.nest.plates.map((pl) => pl.placements.reduce((s, pc) => {
    const part = result.parts.find((p) => p.id === pc.id);
    return s + (part ? polyArea(part.outline) : 0);
  }, 0) / plateArea) : [];
  const totalMin = result ? result.programs.reduce((s, p) => s + p.minutes, 0) : 0;
  const selPart = parts.find((p) => p.id === selected);

  return (
    <div className="wrap app-screen active cz">
      <div className="topbar">
        <div>
          <h1>Çerezlik</h1>
          <div className="sub">Kesme tahtası, sunumluk ve çerezlik: hazır modellerden ya da DXF çiziminden bölme taraması, kenar yuvarlama ve dış kesim. Parçalar birbirinin boşluğuna girecek şekilde plakaya dizilir.</div>
        </div>
      </div>

      <div className="cz-layout">
        <div className="cz-side">
          <div className="card">
            <h2>1 · Parçalar</h2>
            <div className="cz-source">
              <button type="button" className={`tab${source === 'katalog' ? ' active' : ''}`} onClick={() => setSource('katalog')}>Hazır modeller</button>
              <button type="button" className={`tab${source === 'dxf' ? ' active' : ''}`} onClick={() => setSource('dxf')}>DXF yükle</button>
            </div>
            {source === 'katalog' && <CatalogPicker onAdd={addCatalogPart} />}
            {source === 'dxf' && (<>
            <div
              className={`cz-drop${dragOver ? ' over' : ''}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles([...e.dataTransfer.files].filter((f) => /\.dxf$/i.test(f.name))); }}
            >
              <strong>DXF dosyası seçin</strong>
              <span>ya da buraya sürükleyin · birden fazla dosya olabilir</span>
            </div>
            <input ref={fileInput} type="file" accept=".dxf" multiple style={{ display: 'none' }} onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
            <div className="hint">
              Dış hat dıştan kesilir, içindeki kapalı hatlar bölme olarak taranır, açık çizgiler V bıçakla oyulur.{' '}
              {!files.some((f) => f.id !== 'katalog') && <button type="button" className="cz-link" onClick={() => addFiles([{ name: 'ornek-cerezlikler.dxf', content: sampleDrawing() }])}>Örnek çizimle deneyin</button>}
            </div>
            </>)}
            {error && <div className="err" style={{ display: 'block' }}>{error}</div>}
            {files.map((f) => (
              <div key={f.id} className="cz-file">
                <div className="cz-file-head">
                  <span title={f.name}>{f.name}</span>
                  <button type="button" className="cz-x" title={f.id === 'katalog' ? 'Hepsini kaldır' : 'Çizimi kaldır'} onClick={() => removeFile(f.id)}>✕</button>
                </div>
                {f.warnings.map((w) => <div key={w} className="hint hint-warn">{w}</div>)}
                {f.parts.map((p) => {
                  const warns = partWarnings.get(p.id) || [];
                  return (
                    <div key={p.id} className={`cz-part${selected === p.id ? ' active' : ''}`}>
                      <button type="button" className="cz-thumb" onClick={() => setSelected(selected === p.id ? null : p.id)} title="Ayrıntı">
                        <PartCanvas part={p} size={56} />
                      </button>
                      <div className="cz-part-info" onClick={() => setSelected(selected === p.id ? null : p.id)}>
                        <strong>{p.name}</strong>
                        <span>{p.width.toFixed(0)} × {p.height.toFixed(0)} mm · {p.comps.length} bölme{p.lines.length ? ` · ${p.lines.length} çizgi` : ''}</span>
                        {warns.length > 0 && <span className="cz-warn">⚠ {warns[0]}{warns.length > 1 ? ` (+${warns.length - 1})` : ''}</span>}
                      </div>
                      <div className="cz-qty">
                        <label>Adet{f.id === 'katalog' && <button type="button" className="cz-x" title="Kaldır" onClick={() => removePart(p.id)}>✕</button>}</label>
                        <input type="number" min="0" step="1" value={p.qty} onChange={(e) => updatePart(p.id, (x) => ({ ...x, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <details className="card cz-recipe" open>
            <summary><h2>2 · Reçete</h2></summary>
            <div className="row2">
              <div><label>Malzeme</label><input type="text" value={recipe.material} onChange={(e) => set('material', e.target.value)} /></div>
              <Num label="Kalınlık" suffix="mm" value={recipe.thickness} onChange={(v) => set('thickness', v)} />
            </div>

            <h3>Bölme taraması</h3>
            <div className="row3">
              <Num label="Bıçak" suffix="T" value={recipe.pocket.tool} step="1" onChange={(v) => set('pocket.tool', v)} />
              <Num label="Çap" suffix="mm" value={recipe.pocket.dia} onChange={(v) => set('pocket.dia', v)} />
              <Num label="Derinlik" suffix="mm" value={recipe.pocket.depth} onChange={(v) => set('pocket.depth', v)} />
              <Num label="Kademe" suffix="mm" value={recipe.pocket.stepdown} onChange={(v) => set('pocket.stepdown', v)} />
              <Num label="Adım" suffix="%" value={recipe.pocket.stepoverPct} onChange={(v) => set('pocket.stepoverPct', v)} />
              <Num label="İlerleme" suffix="mm/dk" value={recipe.pocket.feed} onChange={(v) => set('pocket.feed', v)} />
            </div>

            <h3>
              <label className="cz-check"><input type="checkbox" checked={recipe.round.enabled} onChange={(e) => set('round.enabled', e.target.checked)} /> Kenar yuvarlama</label>
            </h3>
            {recipe.round.enabled && (
              <>
                <div className="row3">
                  <Num label="Bıçak" suffix="T" value={recipe.round.tool} step="1" onChange={(v) => set('round.tool', v)} />
                  <Num label="En geniş çap" suffix="mm" value={recipe.round.dia} onChange={(v) => set('round.dia', v)} />
                  <Num label="Çizgiden pay" suffix="mm" value={recipe.round.gap} onChange={(v) => set('round.gap', v)} />
                  <Num label="Derinlik" suffix="mm" value={recipe.round.depth} onChange={(v) => set('round.depth', v)} />
                  <Num label="İlerleme" suffix="mm/dk" value={recipe.round.feed} onChange={(v) => set('round.feed', v)} />
                </div>
                <div className="hint">Dış kenarda çizginin dışından, bölmelerde içinden geçer; duvarda iz kalmaz.</div>
              </>
            )}

            <h3>Dış kesim</h3>
            <div className="row3">
              <Num label="Bıçak" suffix="T" value={recipe.cut.tool} step="1" onChange={(v) => set('cut.tool', v)} />
              <Num label="Çap" suffix="mm" value={recipe.cut.dia} onChange={(v) => set('cut.dia', v)} />
              <Num label="Kademe" suffix="mm" value={recipe.cut.stepdown} onChange={(v) => set('cut.stepdown', v)} />
              <Num label="Köprü sayısı" value={recipe.cut.tabs} step="1" min="0" onChange={(v) => set('cut.tabs', v)} />
              <Num label="Köprü boyu" suffix="mm" value={recipe.cut.tabLen} onChange={(v) => set('cut.tabLen', v)} />
              <Num label="Köprü yüksekliği" suffix="mm" value={recipe.cut.tabHeight} onChange={(v) => set('cut.tabHeight', v)} />
              <Num label="Alt taşma" suffix="mm" value={recipe.cut.overcut} onChange={(v) => set('cut.overcut', v)} />
              <Num label="İlerleme" suffix="mm/dk" value={recipe.cut.feed} onChange={(v) => set('cut.feed', v)} />
            </div>

            <h3>Çizgi oyma (V)</h3>
            <div className="row3">
              <Num label="Bıçak" suffix="T" value={recipe.vline.tool} step="1" onChange={(v) => set('vline.tool', v)} />
              <Num label="Derinlik" suffix="mm" value={recipe.vline.depth} onChange={(v) => set('vline.depth', v)} />
              <Num label="İlerleme" suffix="mm/dk" value={recipe.vline.feed} onChange={(v) => set('vline.feed', v)} />
            </div>

            <h3>Genel</h3>
            <div className="row3">
              <Num label="Devir" value={recipe.spindle} step="100" onChange={(v) => set('spindle', v)} />
              <Num label="En ince duvar" suffix="mm" value={recipe.minWall} onChange={(v) => set('minWall', v)} />
              <div>
                <label>Kesim yönü</label>
                <select value={recipe.climb ? 'climb' : 'conv'} onChange={(e) => set('climb', e.target.value === 'climb')}>
                  <option value="climb">Tırmanma</option>
                  <option value="conv">Klasik</option>
                </select>
              </div>
            </div>
          </details>

          <div className="card">
            <h2>3 · Plaka ve dizilim</h2>
            <div className="row3">
              <Num label="Genişlik" suffix="mm" value={plate.width} onChange={(v) => setP('width', v)} />
              <Num label="Yükseklik" suffix="mm" value={plate.height} onChange={(v) => setP('height', v)} />
              <Num label="Kenar payı" suffix="mm" value={plate.margin} onChange={(v) => setP('margin', v)} />
              <Num label="Ek boşluk" suffix="mm" value={plate.extraGap} onChange={(v) => setP('extraGap', v)} />
              <div>
                <label>Döndürme</label>
                <select value={plate.angleStep} onChange={(e) => setP('angleStep', Number(e.target.value))}>
                  <option value={90}>90° (4 yön)</option>
                  <option value={45}>45° (8 yön)</option>
                  <option value={30}>30° (12 yön)</option>
                  <option value={15}>15° (24 yön)</option>
                </select>
              </div>
              <div>
                <label>Hassasiyet</label>
                <select value={plate.cell} onChange={(e) => setP('cell', Number(e.target.value))}>
                  <option value={1}>1 mm (yavaş)</option>
                  <option value={2}>2 mm</option>
                  <option value={3}>3 mm (hızlı)</option>
                </select>
              </div>
              <Num label="Arama süresi" suffix="sn" value={plate.seconds} min="1" onChange={(v) => setP('seconds', v)} />
              <div>
                <label>Dosya uzantısı</label>
                <select value={recipe.ext} onChange={(e) => set('ext', e.target.value)}>
                  <option value=".nc">.nc</option>
                  <option value=".anc">.anc</option>
                </select>
              </div>
            </div>
            <div className="hint">
              Parçalar arası en az {gapInfo.gap.toFixed(1)} mm ({recipe.round.enabled ? `yuvarlama bıçağı çizgiden ${gapInfo.reach.toFixed(1)} mm dışarı uzanır` : `kesim bıçağı ${gapInfo.reach.toFixed(1)} mm dışarı uzanır`} + {Number(plate.extraGap) || 0} mm ek boşluk). Plaka kenarına en az {gapInfo.edge.toFixed(1)} mm.
            </div>
            {running ? (
              <div className="cz-running">
                <span>{running}</span>
                <button type="button" className="btn-secondary" onClick={cancel}>Durdur</button>
              </div>
            ) : (
              <button type="button" className="btn-primary" disabled={!totalQty} onClick={runNesting}>
                {totalQty ? `${totalQty} parçayı diz` : 'Önce parça ekleyin'}
              </button>
            )}
          </div>
        </div>

        <div className="cz-main">
          {selPart ? (
            <div className="card">
              <div className="cz-main-head">
                <h2>{selPart.name}</h2>
                <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>Plakaya dön</button>
              </div>
              <PartCanvas
                part={selPart}
                recipe={recipe}
                size={560}
                onToggleComp={(ci) => updatePart(selPart.id, (p) => ({ ...p, comps: p.comps.map((c, k) => (k === ci ? { ...c, kind: c.kind === 'cep' ? 'delik' : 'cep' } : c)) }))}
              />
              <div className="cz-legend">
                <span><i className="sw cep" /> Bölme (taranır)</span>
                <span><i className="sw delik" /> Boydan boya delik</span>
                <span><i className="sw line" /> V çizgi</span>
              </div>
              <div className="cz-legend">
                <span><i className="sw pocket" /> Tarama T{recipe.pocket.tool}</span>
                {recipe.round.enabled && <span><i className="sw round" /> Yuvarlama T{recipe.round.tool}</span>}
                {selPart.lines.length > 0 && <span><i className="sw vline" /> V çizgi T{recipe.vline.tool}</span>}
                <span><i className="sw cut" /> Kesim T{recipe.cut.tool}</span>
              </div>
              <div className="hint">Bir bölmeye tıklayarak taranacak bölme ile boydan boya kesilecek delik arasında değiştirin.</div>
              {(partWarnings.get(selPart.id) || []).map((w) => <div key={w} className="hint hint-warn">⚠ {w}</div>)}
            </div>
          ) : result ? (
            <div className="card">
              <div className="cz-main-head">
                <div className="cz-tabs">
                  {result.nest.plates.map((_, i) => (
                    <button key={i} type="button" className={`tab${i === plateIdx ? ' active' : ''}`} onClick={() => setPlateIdx(i)}>Plaka {i + 1}</button>
                  ))}
                </div>
                <label className="cz-check"><input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} /> Bıçak yolları</label>
              </div>
              {stale && <div className="hint hint-warn">Ayarlar ya da adetler değişti; güncel sonuç için yeniden dizin.</div>}
              <PlateCanvas
                plate={plate}
                placements={result.nest.plates[plateIdx]?.placements || []}
                parts={result.parts}
                preview={showPaths ? result.programs[plateIdx]?.preview : null}
                edge={gapInfo.edge}
              />
              <div className="cz-stats">
                <span><b>{result.nest.plates.length}</b> plaka</span>
                <span>Bu plaka: <b>{result.nest.plates[plateIdx]?.placements.length}</b> parça · doluluk <b>%{((usage[plateIdx] || 0) * 100).toFixed(1)}</b> · ~<b>{Math.round(result.programs[plateIdx]?.minutes || 0)}</b> dk</span>
                <span>Toplam ~{Math.round(totalMin)} dk</span>
              </div>
              {result.nest.unplaced.length > 0 && (
                <div className="hint hint-warn">{result.nest.unplaced.length} parça plakadan büyük olduğu için yerleştirilemedi.</div>
              )}
              <div className="cz-legend">
                <span><i className="sw pocket" /> Tarama T{recipe.pocket.tool}</span>
                {recipe.round.enabled && <span><i className="sw round" /> Yuvarlama T{recipe.round.tool}</span>}
                <span><i className="sw vline" /> V çizgi T{recipe.vline.tool}</span>
                <span><i className="sw cut" /> Kesim T{recipe.cut.tool}</span>
              </div>
              <div className="row2">
                <button type="button" className="btn-secondary" onClick={() => download(fileName(plateIdx), result.programs[plateIdx].gcode)}>⬇ Plaka {plateIdx + 1} ({recipe.ext})</button>
                <button type="button" className="btn-accent2 cz-zip" onClick={downloadZip}>⬇ Hepsini indir (.zip)</button>
              </div>
            </div>
          ) : (
            <div className="card cz-empty">
              <PlateCanvas plate={plate} placements={[]} parts={[]} edge={gapInfo.edge} />
              <div className="hint">Hazır modellerden seçin ya da DXF yükleyin; adetleri girip “Diz” ile plakaya yerleştirin.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
