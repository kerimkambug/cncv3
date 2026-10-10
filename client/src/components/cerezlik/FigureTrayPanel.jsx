import { useEffect, useRef, useState } from 'react';
import { figureFromImageData, figureFromStl, sampleShell } from '../../lib/cerezlik/figure.js';
import { FIGURE_TRAY_DEFAULTS, figureTrayPart } from '../../lib/cerezlik/figureTray.js';
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

async function loadFigure(file) {
  if (/\.stl$/i.test(file.name)) return figureFromStl(await file.arrayBuffer());
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return figureFromImageData(ctx.getImageData(0, 0, c.width, c.height));
}

/** Figure tray designer: load a figure (STL / depth map), shape the tray around it, add it to the job. */
export default function FigureTrayPanel({ thickness, ballR = 15, reliefDia = 6, onAdd }) {
  const [figure, setFigure] = useState(null); // { name, fig }
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
      const fig = await loadFigure(file);
      if (!fig.mask.some(Boolean)) throw new Error('Figür bulunamadı: zemin tamamen düz ya da siyah.');
      setFigure({ name: file.name.replace(/\.[^.]+$/, ''), fig });
    } catch (err) {
      setError(`${file.name}: ${err.message}`);
      setBusy(false);
    }
  }

  const setP = (k, v) => setParams((p) => ({ ...p, [k]: v }));
  const num = (k) => params[k];

  return (
    <div className="cz-figure">
      <div className="cz-drop" onClick={() => input.current?.click()}>
        <strong>{figure ? figure.name : 'Figür seçin'}</strong>
        <span>STL ya da derinlik haritası (PNG/JPG: beyaz yüksek, siyah zemin)</span>
      </div>
      <input ref={input} type="file" accept=".stl,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
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
          {FIELDS.map(([title, fields]) => (
            <div key={title}>
              <h3>{title}</h3>
              <div className="row3">
                {fields
                  .filter(([k]) => !(k === 'H' && params.shape === 'yuvarlak') && !(k === 'r' && params.shape !== 'dikdortgen'))
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
