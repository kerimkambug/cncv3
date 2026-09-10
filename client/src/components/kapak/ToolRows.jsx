/**
 * Editable list of {name, toolNo, operation, depth, stepOffset} rows — the tool
 * sequence shared by every Kapak operation (Tek Ölçü, Toplu Liste,
 * Nesting all read the same rows).
 */
export default function ToolRows({ rows, setRows, thickness, offsetMode = 'relative', setOffsetMode }) {
  function updateRow(idx, field, value) {
    const next = rows.slice();
    next[idx] = { ...next[idx], [field]: field === 'name' || field === 'toolNo' || field === 'operation' ? value : parseFloat(value) || 0 };
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
            if (r.operation === 'derz') {
              cum = cum;
            } else if (isAbsolute) {
              cum = Number(r.stepOffset) || 0;
            } else {
              cum += Number(r.stepOffset) || 0;
            }
            const z = (Number(thickness) || 0) - (Number(r.depth) || 0);
            return (
              <>
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
                <td>{r.operation === 'derz' ? '-' : cum.toFixed(2)}</td>
                <td>{z.toFixed(2)}</td>
                <td>
                  <button type="button" className="icon-btn" onClick={() => removeRow(i)}>
                    ✕
                  </button>
                </td>
              </tr>
              {r.operation === 'derz' && (
                <tr key={`${i}-derz`}>
                  <td colSpan="8" className="derz-row-settings">
                    <strong>Derz ayarları</strong>
                    <label><span>Yön</span><select value={r.derz?.yon || 'dikey'} onChange={(e) => updateDerz(i, 'yon', e.target.value)}><option value="dikey">Dikey</option><option value="yatay">Yatay</option></select></label>
                    <label><span>Kenar boşluğu (mm)</span><input type="number" min="0" step="0.1" value={r.derz?.margin ?? 0} onChange={(e) => updateDerz(i, 'margin', e.target.value)} /></label>
                    <label><span>Çizgi aralığı (mm)</span><input type="number" min="0.1" step="0.1" value={r.derz?.spacing ?? r.stepOffset} onChange={(e) => updateDerz(i, 'spacing', e.target.value)} /></label>
                    <label><span>Sağ-sol taşma X (mm)</span><input type="number" min="0" step="0.1" value={r.derz?.overshootX ?? r.derz?.overshoot ?? 1} onChange={(e) => updateDerz(i, 'overshootX', e.target.value)} /></label>
                    <label><span>Alt-üst taşma Y (mm)</span><input type="number" min="0" step="0.1" value={r.derz?.overshootY ?? r.derz?.overshoot ?? 1} onChange={(e) => updateDerz(i, 'overshootY', e.target.value)} /></label>
                    <label className="derz-auto-fit"><input type="checkbox" checked={r.derz?.autoFit !== false} onChange={(e) => updateDerz(i, 'autoFit', e.target.checked)} /><span>Aralığı otomatik sığdır</span></label>
                    <label className="derz-auto-fit"><input type="checkbox" checked={r.derz?.respectPreviousOffset !== false} onChange={(e) => updateDerz(i, 'respectPreviousOffset', e.target.checked)} /><span>Önceki offset sınırlarına uy</span></label>
                  </td>
                </tr>
              )}
              </>
            );
          })}
        </tbody>
      </table>
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

