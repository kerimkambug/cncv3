import { KULP_EDGES } from '../../lib/gcode/kulp.js';

/**
 * The kulps of one door: which edge, the whole length or a window between two
 * points (measured from the edge's bottom / left corner). Any model can get one.
 * @param {{door:{w:number,h:number}, kulps:object[], onChange:(kulps:object[])=>void}} props
 */
export default function KulpEditor({ door, kulps, onChange }) {
  const len = (edge) => (edge === 'left' || edge === 'right' ? door.h : door.w);
  const set = (i, patch) => onChange(kulps.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const add = () => {
    const edge = 'right';
    const L = len(edge), mid = L / 2;
    onChange([...kulps, { edge, mode: 'window', from: Math.max(0, Math.round(mid - 100)), to: Math.min(L, Math.round(mid + 100)) }]);
  };
  const center = (i) => {
    const k = kulps[i], w = Math.max(0, Number(k.to) - Number(k.from)) || 200, L = len(k.edge);
    set(i, { from: +((L - w) / 2).toFixed(1), to: +((L + w) / 2).toFixed(1) });
  };
  return (
    <div className="kulp-editor">
      {kulps.map((k, i) => (
        <div className="kulp-row" key={i}>
          <span className="kulp-tag">Kulp</span>
          <select value={k.edge} onChange={(e) => set(i, { edge: e.target.value })} title="Kapağın hangi kenarı">
            {Object.entries(KULP_EDGES).map(([v, label]) => <option key={v} value={v}>{label} kenar</option>)}
          </select>
          <select value={k.mode} onChange={(e) => set(i, { mode: e.target.value })}>
            <option value="window">Arası</option>
            <option value="full">Boydan boya</option>
          </select>
          {k.mode === 'window' && (
            <>
              <input type="number" step="1" value={k.from} onChange={(e) => set(i, { from: e.target.value === '' ? '' : Number(e.target.value) })}
                title={k.edge === 'left' || k.edge === 'right' ? 'Kapağın altından (mm)' : 'Kapağın solundan (mm)'} />
              <span>–</span>
              <input type="number" step="1" value={k.to} onChange={(e) => set(i, { to: e.target.value === '' ? '' : Number(e.target.value) })}
                title={k.edge === 'left' || k.edge === 'right' ? 'Kapağın altından (mm)' : 'Kapağın solundan (mm)'} />
              <span className="kulp-unit">mm</span>
              <button type="button" className="link-btn" onClick={() => center(i)} title="Aynı uzunlukta, kenarın ortasına al">ortala</button>
            </>
          )}
          <button type="button" className="icon-btn" title="Bu kulpu kaldır" onClick={() => onChange(kulps.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="link-btn kulp-add" onClick={add}>+ Kulp ekle</button>
    </div>
  );
}
