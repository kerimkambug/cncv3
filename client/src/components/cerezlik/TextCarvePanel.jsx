import { useEffect, useRef, useState } from 'react';
import { FONTS, TEXT_DEFAULTS, carveFromMask, placeCarve, renderTextMask } from '../../lib/cerezlik/textCarve.js';

const ANCHORS = [
  ['sag-alt', 'Sağ alt'], ['sol-alt', 'Sol alt'], ['orta-alt', 'Alt orta'], ['orta', 'Orta'],
  ['orta-ust', 'Üst orta'], ['sag-ust', 'Sağ üst'], ['sol-ust', 'Sol üst'],
];
const BITS = [
  { key: '1-90', tool: 1, angle: 90, label: 'T1 · 90° V' },
  { key: '12-135', tool: 12, angle: 135, label: 'T12 · 135° V' },
];

/** V-carved text on the selected part: typed text, font, size, place; applied live. */
export default function TextCarvePanel({ part, onApply }) {
  const [o, setO] = useState(() => ({ ...TEXT_DEFAULTS, ...(part.text || {}) }));
  const [note, setNote] = useState(null); // { text, warn }
  const first = useRef(true);
  const partId = part.id;

  // re-seed when another part is selected
  useEffect(() => { setO({ ...TEXT_DEFAULTS, ...(part.text || {}) }); first.current = true; }, [partId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const t = setTimeout(() => {
      if (!o.text.trim()) { onApply({ text: { ...o }, carve: null }); setNote(null); return; }
      // if it does not fit, try the text a little smaller before giving up
      let placed = null, usedH = o.height;
      for (const k of [1, 0.85, 0.7, 0.55]) {
        const m = renderTextMask({ ...o, height: o.height * k });
        if (!m) return;
        const raw = carveFromMask(m, { angle: o.angle, maxDepth: o.maxDepth });
        placed = placeCarve(part, raw, o);
        usedH = o.height * k;
        if (placed.fits) break;
      }
      const { paths, fits } = placed;
      const deepest = Math.max(0, ...paths.flat().map((q) => q[2]));
      setNote({ warn: !fits, text: !fits
        ? 'Yazı seçilen yere sığmadı (kenara ya da bölmeye çok yakın); boyunu küçültün ya da yerini değiştirin.'
        : usedH < o.height
          ? `Sığması için harf yüksekliği ${usedH.toFixed(0)} mm'ye düşürüldü. En derin nokta ${deepest.toFixed(1)} mm.`
          : `En derin nokta ${deepest.toFixed(1)} mm.` });
      onApply({ text: { ...o }, carve: paths, carveFits: fits });
    }, 350);
    return () => clearTimeout(t);
  }, [o]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setO((x) => ({ ...x, [k]: v }));
  const bit = BITS.find((b) => b.tool === Number(o.tool)) || BITS[0];

  return (
    <div className="cz-text">
      <h3>Yazı oyma (V bıçak)</h3>
      <textarea rows={2} value={o.text} placeholder={'Örn: Afiyet olsun\nYılmaz Ailesi'} onChange={(e) => set('text', e.target.value)} />
      <div className="row3">
        <div>
          <label>Yazı tipi</label>
          <select value={o.font} onChange={(e) => set('font', e.target.value)} style={{ fontFamily: o.font }}>
            {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select>
        </div>
        <div>
          <label>Yer</label>
          <select value={o.anchor} onChange={(e) => set('anchor', e.target.value)}>
            {ANCHORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label>Bıçak</label>
          <select value={bit.key} onChange={(e) => { const b = BITS.find((x) => x.key === e.target.value); setO((x) => ({ ...x, tool: b.tool, angle: b.angle })); }}>
            {BITS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </div>
        <div><label>Harf yüksekliği (mm)</label><input type="number" min="5" value={o.height} onChange={(e) => set('height', Number(e.target.value) || 5)} /></div>
        <div><label>Kenardan (mm)</label><input type="number" min="5" value={o.margin} onChange={(e) => set('margin', Number(e.target.value) || 5)} /></div>
        <div><label>En fazla derinlik (mm)</label><input type="number" min="0.5" step="0.5" value={o.maxDepth} onChange={(e) => set('maxDepth', Number(e.target.value) || 1)} /></div>
        <div>
          <label>Açı</label>
          <select value={o.rotate} onChange={(e) => set('rotate', Number(e.target.value))}>
            {[0, 90, 180, 270, -15, 15].map((a) => <option key={a} value={a}>{a}°</option>)}
          </select>
        </div>
        <label className="cz-check cz-text-check"><input type="checkbox" checked={o.italic} onChange={(e) => set('italic', e.target.checked)} /> İtalik</label>
        <label className="cz-check cz-text-check"><input type="checkbox" checked={o.bold} onChange={(e) => set('bold', e.target.checked)} /> Kalın</label>
      </div>
      {note && <div className={`hint${note.warn ? ' hint-warn' : ''}`}>{note.text}</div>}
    </div>
  );
}
