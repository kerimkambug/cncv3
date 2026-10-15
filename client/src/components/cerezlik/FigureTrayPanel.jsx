import { useEffect, useRef, useState } from 'react';
import { figureFromDxf, figureFromImageData, figureFromStl, sampleShell } from '../../lib/cerezlik/figure.js';
import { FIGURE_TRAY_DEFAULTS, figureTrayPart } from '../../lib/cerezlik/figureTray.js';
import { FLAT_BITS, FLAT_STYLES, HATCH_PATTERNS, LOGO_DEFAULTS, LOGO_PRESETS } from '../../lib/cerezlik/logoCarve.js';
import PartCanvas from './PartCanvas.jsx';

const FIELDS = [
  ['Tepsi', [
    ['W', 'En', 'mm'], ['H', 'Boy', 'mm'], ['r', 'Köşe yarıçapı', 'mm'], ['rim', 'Kenar eni', 'mm'],
  ]],
  ['Figür', [
    ['figW', 'Figür eni', 'mm'], ['figH', 'Kabartma yüksekliği', 'mm'], ['figTop', 'Tepesi yüzeyin altında', 'mm'],
    ['figX', 'Yatay kaydırma', 'mm'], ['figY', 'Dikey kaydırma', 'mm'], ['pad', 'Figür çevresi payı', 'mm'],
  ]],
  ['Bölmeler', [
    ['n', 'Bölme sayısı', ''], ['a0', 'İlk ayırıcı açısı', '°'], ['wall', 'Ara duvar', 'mm'],
    ['depth', 'Derinlik', 'mm'], ['fillet', 'Taban radüsü', 'mm'],
  ]],
];

/** Settings of the chosen logo style (the V bit is T1 90°: a wider angle loses the fine strokes). */
function LogoStyleFields({ style, logo, setLogo }) {
  const o = { ...LOGO_DEFAULTS, ...logo };
  const flat = FLAT_STYLES.includes(style);
  const num = (k, label, extra = {}) => (
    <div key={k}>
      <label>{label}</label>
      <input type="number" value={o[k]} {...extra} onChange={(e) => setLogo({ [k]: e.target.value === '' ? '' : Number(e.target.value) })} />
    </div>
  );
  const check = (k, label) => (
    <label key={k} className="cz-check cz-text-check"><input type="checkbox" checked={!!o[k]} onChange={(e) => setLogo({ [k]: e.target.checked })} /> {label}</label>
  );
  return (
    <div className="row3">
      <div>
        <label>Düz bıçak</label>
        <select value={o.flatTool} onChange={(e) => { const [t, d] = FLAT_BITS.find(([x]) => x === Number(e.target.value)); setLogo({ flatTool: t, flatDia: d }); }}>
          {FLAT_BITS.map(([t, d]) => <option key={t} value={t}>T{t} · Ø{d} düz</option>)}
        </select>
      </div>
      {flat ? num('cepDepth', 'Derinlik (mm)', { min: 0.5, step: 0.5 }) : num('maxDepth', 'En fazla derinlik (mm)', { min: 0.5, step: 0.5 })}
      {flat && num('stepdown', 'Kademe (mm)', { min: 0.5, step: 0.5 })}
      {o.fill === 'acik' && num('frame', 'Logo çevresi zemin payı (mm)', { min: 0.5, step: 0.5 })}
      {style === 'cepZigzag' && num('zigAngle', 'Çizgi yönü (°)', { step: 15 })}
      {style === 'cepDoku' && (
        <div>
          <label>Desen</label>
          <select value={o.hatch} onChange={(e) => setLogo({ hatch: e.target.value })}>
            {HATCH_PATTERNS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      )}
      {style === 'cepDoku' && num('hatchStep', 'Desen aralığı (mm)', { min: 0.5, step: 0.5 })}
      {style === 'cepDoku' && num('lineDepth', 'Desen derinliği (mm)', { min: 0.2, step: 0.1 })}
      {style === 'cepDoku' && ['paralel', 'capraz', 'isinsal'].includes(o.hatch) && num('hatchAngle', 'Desen açısı (°)', { step: 15 })}
      {flat && check('corners', `Ø${o.flatDia}'ün giremediği dar yerleri ve köşeleri T1 V oysun`)}
      {!flat && check('flatClear', `Geniş tabanı T${o.flatTool} Ø${o.flatDia} düz temizlesin`)}
    </div>
  );
}

async function loadFigure(file) {
  if (/\.stl$/i.test(file.name)) return { fig: figureFromStl(await file.arrayBuffer()) };
  if (/\.dxf$/i.test(file.name)) {
    const dxf = await file.text();
    return { fig: figureFromDxf(dxf), dxf };
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return { fig: figureFromImageData(ctx.getImageData(0, 0, c.width, c.height)) };
}

/** Figure tray designer: load a figure (STL / depth map / DXF logo), shape the tray around it, add it to the job. */
export default function FigureTrayPanel({ thickness, ballR = 15, reliefDia = 6, onAdd }) {
  const [figure, setFigure] = useState(null); // { name, fig, dxf? }
  const [params, setParams] = useState(() => ({ ...FIGURE_TRAY_DEFAULTS, fillet: ballR }));
  const [part, setPart] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qty, setQty] = useState(1);
  const input = useRef(null);

  // rebuild the preview shortly after the last change
  useEffect(() => {
    if (!figure) { setPart(null); return undefined; }
    setBusy(true);
    const t = setTimeout(() => {
      try {
        setPart(figureTrayPart(figure.fig, { ...params, ballR, reliefDia }, thickness, figure.name));
        setError('');
      } catch (err) {
        setError(err.message);
      }
      setBusy(false);
    }, 350);
    return () => clearTimeout(t);
  }, [figure, params, thickness, ballR, reliefDia]);

  async function onFile(file) {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const { fig, dxf } = await loadFigure(file);
      if (!fig.mask.some(Boolean)) throw new Error('Figür bulunamadı: zemin tamamen düz ya da siyah.');
      setFigure({ name: file.name.replace(/\.[^.]+$/, ''), fig, dxf });
      // a DXF logo is carved into the flat top (raised logo by default); other figures are 3D reliefs
      setParams((p) => (dxf
        ? (p.style === 'kabartma' ? { ...p, style: 'cep', logo: { ...p.logo, fill: 'acik' } } : p)
        : { ...p, style: 'kabartma' }));
    } catch (err) {
      setError(`${file.name}: ${err.message}`);
      setBusy(false);
    }
  }

  const setP = (k, v) => setParams((p) => ({ ...p, [k]: v }));
  const setLogo = (patch) => setParams((p) => ({ ...p, logo: { ...p.logo, ...patch } }));
  const carved = !!figure?.dxf && params.style !== 'kabartma';
  const fill = params.logo?.fill || LOGO_DEFAULTS.fill;
  const preset = LOGO_PRESETS.find(([, , st, f]) => st === params.style && f === fill)?.[0] || LOGO_PRESETS[0][0];
  const onPreset = (key) => {
    const [, , st, f] = LOGO_PRESETS.find(([k]) => k === key);
    setParams((p) => ({ ...p, style: st, logo: { ...p.logo, fill: f } }));
  };
  const num = (k) => params[k];

  return (
    <div className="cz-figure">
      <div className="cz-drop" onClick={() => input.current?.click()}>
        <strong>{figure ? figure.name : 'Figür seçin'}</strong>
        <span>STL, DXF logo (kapalı hatlar tepsiye işlenir) ya da derinlik haritası (PNG/JPG: beyaz yüksek, siyah zemin)</span>
      </div>
      <input ref={input} type="file" accept=".stl,.dxf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
      {!figure && (
        <div className="hint">
          Figür ortada kabartma olarak işlenir, bölmeler etrafına yerleşir.{' '}
          <button type="button" className="cz-link" onClick={() => setFigure({ name: 'Deniz kabuğu', fig: sampleShell() })}>Örnek figürle deneyin</button>
        </div>
      )}
      {error && <div className="err" style={{ display: 'block' }}>{error}</div>}

      {figure && (
        <>
          <div className="cz-figure-preview">
            {part ? <PartCanvas part={part} size={380} /> : <div className="hint">Hazırlanıyor…</div>}
            {busy && part && <span className="cz-busy">güncelleniyor…</span>}
          </div>
          <div className="row2">
            <div>
              <label>Tepsi formu</label>
              <select value={params.shape} onChange={(e) => setP('shape', e.target.value)}>
                <option value="oval">Oval</option>
                <option value="yuvarlak">Yuvarlak</option>
                <option value="dikdortgen">Dikdörtgen</option>
              </select>
            </div>
            <div>
              <label>Figür yönü</label>
              <select value={params.rot} onChange={(e) => setP('rot', Number(e.target.value))}>
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </div>
          </div>
          {carved && (
            <div>
              <label>Logo stili</label>
              <select value={preset} onChange={(e) => onPreset(e.target.value)}>
                {LOGO_PRESETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
          )}
          {carved && <LogoStyleFields style={params.style} logo={params.logo} setLogo={setLogo} />}
          {figure.fig.openChains > 0 && (
            <div className="hint hint-warn">⚠ DXF'te {figure.fig.openChains} açık hat var; yalnızca kapalı hatlar işlendi.</div>
          )}
          {FIELDS.map(([title, fields]) => (
            <div key={title}>
              <h3>{title}</h3>
              <div className="row3">
                {fields
                  .filter(([k]) => !(k === 'H' && params.shape === 'yuvarlak') && !(k === 'r' && params.shape !== 'dikdortgen'))
                  .filter(([k]) => !(carved && ['figH', 'figTop'].includes(k)))
                  .map(([k, label, unit]) => (
                    <div key={k}>
                      <label>{label === 'En' && params.shape === 'yuvarlak' ? 'Çap' : label}{unit ? ` (${unit})` : ''}</label>
                      <input type="number" value={num(k)} onChange={(e) => setP(k, e.target.value === '' ? '' : Number(e.target.value))} onBlur={() => setP(k, Number(num(k)) || 0)} />
                    </div>
                  ))}
              </div>
            </div>
          ))}
          <div className="hint">
            Taban radüsü, bölme duvarı ile taban arasındaki kavistir. Bitirme topunun yarıçapına ({ballR} mm) eşit olursa top tek turda kavisi ve köşeleri birebir çıkarır, düz tabanı düz bıçak bitirir. Daha büyük değer daha kase görünümü verir (birkaç tur), daha küçüğü önerilmez.
          </div>
          {(part?.warnings || []).map((w) => <div key={w} className="hint hint-warn">⚠ {w}</div>)}
          <div className="row2">
            <div>
              <label>Adet</label>
              <input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </div>
            <button type="button" className="btn-primary" disabled={!part || busy} onClick={() => onAdd(part, qty)}>Listeye ekle</button>
          </div>
        </>
      )}
    </div>
  );
}
