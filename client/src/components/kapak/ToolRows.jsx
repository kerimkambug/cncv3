/**
 * Editable list of {name, toolNo, operation, depth, stepOffset} rows — the tool
 * sequence shared by every Kapak operation (Tek Ölçü, Toplu Liste,
 * Nesting all read the same rows).
 */
import { useState } from 'react';

export default function ToolRows({ rows, setRows, thickness, offsetMode = 'relative', setOffsetMode }) {
  // ⚙ ile seçilen satırın ayarları tablonun altındaki panelde gösterilir.
  const [selected, setSelected] = useState(null);

  function updateRow(idx, field, value) {
    const next = rows.slice();
    next[idx] = { ...next[idx], [field]: field === 'name' || field === 'toolNo' || field === 'operation' ? value : parseFloat(value) || 0 };
    setRows(next);
  }

  // cornerRadius / feed accept an empty string to mean "not set" (cleared),
  // so a plain offset pass stays plain and a radius/feed can be removed again.
  function updateOptional(idx, field, value) {
    const next = rows.slice();
    const stored = value === '' || value === null || value === undefined ? null : parseFloat(value) || 0;
    next[idx] = { ...next[idx], [field]: stored };
    setRows(next);
  }
  function updateCarving(idx, field, value) {
    const next = rows.slice();
    // bitAngle: empty => null (no angle known, ramp falls back to the 1:1 rule)
    const stored = value === '' || value === null || value === undefined ? null : parseFloat(value) || 0;
    next[idx] = { ...next[idx], [field]: stored };
    setRows(next);
  }
  function updateDerz(idx, field, value) {
    const next = rows.slice();
    next[idx] = { ...next[idx], derz: { yon: 'dikey', margin: 0, spacing: 60, autoFit: true, overshoot: 1, overshootX: 1, overshootY: 1, edgeExtra: 0, respectPreviousOffset: true, ...(next[idx].derz || {}), [field]: field === 'yon' || field === 'autoFit' || field === 'respectPreviousOffset' ? value : parseFloat(value) || 0 } };
    setRows(next);
  }
  function addRow() {
    setRows([...rows, { name: '', toolNo: '', operation: 'offset', depth: 1, stepOffset: 10, derz: { yon: 'dikey', margin: 0, spacing: 60, autoFit: true, overshoot: 1, edgeExtra: 0, outerFrame: false } }]);
  }
  function removeRow(idx) {
    setRows(rows.filter((_, i) => i !== idx));
  }

  const isAbsolute = offsetMode === 'absolute';

  function toggleMode() {
    if (setOffsetMode) {
      setOffsetMode(isAbsolute ? 'relative' : 'absolute');
    }
  }

  let cum = 0;

  return (
    <div className="card">
      <div className="tool-header-row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Bıçaklar</h2>
        <span className="badge">{rows.length} bıçak</span>
      </div>

      <div className="mode-switch" style={{ marginBottom: 14 }}>
        <span className={`mode-label${!isAbsolute ? ' active' : ''}`} id="modeLabelRelative">
          Göreceli (kümülatif)
        </span>
        <div className={`switch-track${isAbsolute ? ' on' : ''}`} onClick={toggleMode}>
          <div className="knob" />
        </div>
        <span className={`mode-label${isAbsolute ? ' active' : ''}`} id="modeLabelAbsolute">
          Mutlak (en dıştan)
        </span>
      </div>

      <table className="tool-table">
        <thead>
          <tr>
            <th>Bıçak Adı</th>
            <th>Tool No</th>
            <th>İşlem</th>
            <th>Derinlik</th>
            <th>{isAbsolute ? 'Offset (dıştan)' : 'Adım Offset'}</th>
            <th>Kümülatif</th>
            <th>Z</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.operation === 'derz' || r.operation === 'carving') {
              cum = cum;
            } else if (isAbsolute) {
              cum = Number(r.stepOffset) || 0;
            } else {
              cum += Number(r.stepOffset) || 0;
            }
            const z = (Number(thickness) || 0) - (Number(r.depth) || 0);
            return (
              <tr key={i}>
                <td className="name-cell">
                  <input
                    type="text"
                    value={r.name || ''}
                    onChange={(e) => updateRow(i, 'name', e.target.value)}
                    placeholder="30mm yuvarlama"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={r.toolNo || ''}
                    onChange={(e) => updateRow(i, 'toolNo', e.target.value)}
                    style={{ width: 50 }}
                  />
                </td>
                <td>
                  <select value={r.operation || 'offset'} onChange={(e) => updateRow(i, 'operation', e.target.value)}>
                    <option value="offset">Offset</option>
                    <option value="derz">Derz</option>
                    <option value="carving">Carving (V-bıçak profil)</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.1"
                    value={r.depth}
                    onChange={(e) => updateRow(i, 'depth', e.target.value)}
                    style={{ width: 60 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.1"
                    value={r.stepOffset}
                    onChange={(e) => updateRow(i, 'stepOffset', e.target.value)}
                    style={{ width: 60 }}
                  />
                </td>
                <td>{r.operation === 'derz' || r.operation === 'carving' ? '-' : cum.toFixed(2)}</td>
                {/* NOT: ayarlar satır sonundaki ⚙ düğmesinden açılır */}
                <td>{z.toFixed(2)}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className={`icon-btn settings-toggle${selected === i ? ' open' : ''}`}
                    title="Ayarlar"
                    onClick={() => setSelected(selected === i ? null : i)}
                  >
                    ⚙
                  </button>
                  <button type="button" className="icon-btn" onClick={() => removeRow(i)}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selected != null && rows[selected] && (() => {
        const r = rows[selected];
        // Carving is corner-sharpening BY DEFINITION, so the only thing the shop
        // supplies is the bit angle. Offset + depth already say where and how deep
        // the flat floor runs; the angle turns that into the corner ramp.
        const hasAngle = Number(r.bitAngle) > 0;
        const ramp = hasAngle ? +(Number(r.depth) / Math.tan((Number(r.bitAngle) / 2) * (Math.PI / 180))).toFixed(2) : null;
        const offset = Number(r.stepOffset) || 0;
        // The plate clamp silently shortens any ramp wider than the offset.
        const clipped = ramp != null && ramp > offset;
        return (
          <div className="tool-settings-panel">
            <div className="tool-settings-header">
              <strong>⚙ {r.name || `Bıçak ${selected + 1}`} — Ayarlar</strong>
              <button type="button" className="icon-btn" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="tool-settings-grid">
              {/* Carving only ever asks for the bit angle. Its offset and depth are
                  already in the table, and corner sharpening IS what carving means —
                  so Köşe R / Feed are irrelevant here and are not shown. */}
              {r.operation === 'carving' && (
                <>
                  <label>
                    <span>Bıçak açısı (°){hasAngle ? ` — kenara ${Number(r.bitAngle) / 2}°` : ''}</span>
                    <input type="number" min="1" max="179" step="1" value={r.bitAngle ?? ''} placeholder="90" onChange={(e) => updateCarving(selected, 'bitAngle', e.target.value)} />
                  </label>
                  <div className={`hint${clipped ? ' hint-warn' : ''}`} style={{ gridColumn: '1 / -1' }}>
                    {hasAngle ? (
                      <>
                        {r.bitAngle}° bıçak (kenara {Number(r.bitAngle) / 2}°) · köşede {ramp}mm dışa çıkıp yüzeye tırmanır.
                        {clipped && ` ⚠ Offset (${offset}mm) bu rampayı taşımıyor — ${offset}mm'ye kırpılacak.`}
                      </>
                    ) : (
                      <>Bıçak açısını gir — köşe rampası ona göre hesaplanır (şimdilik 90° varsayılıyor).</>
                    )}
                  </div>
                </>
              )}
              {r.operation !== 'carving' && (
                <>
                  <label>
                    <span>Köşe R (mm) — boş = düz köşe</span>
                    <input type="number" min="0" step="0.5" value={r.cornerRadius ?? ''} placeholder="—" onChange={(e) => updateOptional(selected, 'cornerRadius', e.target.value)} />
                  </label>
                  <label>
                    <span>Feed (mm/dk) — boş = genel</span>
                    <input type="number" min="0" step="100" value={r.feed ?? ''} placeholder="genel" onChange={(e) => updateOptional(selected, 'feed', e.target.value)} />
                  </label>
                </>
              )}
              {r.operation === 'derz' && (
                <>
                  <label>
                    <span>Yön</span>
                    <select value={r.derz?.yon || 'dikey'} onChange={(e) => updateDerz(selected, 'yon', e.target.value)}>
                      <option value="dikey">Dikey</option>
                      <option value="yatay">Yatay</option>
                    </select>
                  </label>
                  <label>
                    <span>Kenar boşluğu (mm)</span>
                    <input type="number" min="0" step="0.1" value={r.derz?.margin ?? 0} onChange={(e) => updateDerz(selected, 'margin', e.target.value)} />
                  </label>
                  <label>
                    <span>Çizgi aralığı (mm)</span>
                    <input type="number" min="0.1" step="0.1" value={r.derz?.spacing ?? r.stepOffset} onChange={(e) => updateDerz(selected, 'spacing', e.target.value)} />
                  </label>
                  <label>
                    <span>Taşma X (mm)</span>
                    <input type="number" min="0" step="0.1" value={r.derz?.overshootX ?? r.derz?.overshoot ?? 1} onChange={(e) => updateDerz(selected, 'overshootX', e.target.value)} />
                  </label>
                  <label>
                    <span>Taşma Y (mm)</span>
                    <input type="number" min="0" step="0.1" value={r.derz?.overshootY ?? r.derz?.overshoot ?? 1} onChange={(e) => updateDerz(selected, 'overshootY', e.target.value)} />
                  </label>
                  <label className="check-field">
                    <input type="checkbox" checked={r.derz?.autoFit !== false} onChange={(e) => updateDerz(selected, 'autoFit', e.target.checked)} />
                    <span>Aralığı otomatik sığdır</span>
                  </label>
                  <label className="check-field">
                    <input type="checkbox" checked={r.derz?.respectPreviousOffset !== false} onChange={(e) => updateDerz(selected, 'respectPreviousOffset', e.target.checked)} />
                    <span>Önceki offset sınırlarına uy</span>
                  </label>
                </>
              )}
            </div>
          </div>
        );
      })()}

      <button type="button" className="btn-secondary add-row-btn" onClick={addRow}>
        + Bıçak Ekle
      </button>

      <div className="hint" style={{ marginTop: 8 }}>
        {isAbsolute
          ? 'Sıra dıştan içe. Her satırın offseti, o satırın kendi değeridir — bir önceki satırdan bağımsız, doğrudan en dış kenardan ölçülür.'
          : 'Sıra dıştan içe. Adım offset değerleri kümülatif olarak toplanır (her satır bir öncekinin üstüne eklenir).'}
      </div>
    </div>
  );
}

