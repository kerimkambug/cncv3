/**
 * Editable list of {name, toolNo, operation, depth, stepOffset} rows — the tool
 * sequence shared by every Kapak operation (Tek Ölçü, Toplu Liste,
 * Nesting all read the same rows).
 */
import { useState } from 'react';
import { carveExitDistance } from '../../lib/gcode/kapak.js';

// Operations that take part in the offset chain (the others have their own geometry).
const CHAIN_OPS = ['offset'];

export default function ToolRows({ rows, setRows, thickness, offsetMode = 'relative', setOffsetMode }) {
  // ⚙ ile seçilen satırın ayarları tablonun altındaki panelde gösterilir.
  const [selected, setSelected] = useState(null);
  function updateRow(idx, field, value) {
    const next = rows.slice();
    next[idx] = { ...next[idx], [field]: field === 'name' || field === 'toolNo' || field === 'operation' ? value : parseFloat(value) || 0 };
    // A pinned row is cut at its absoluteOffset, so the offset cell edits that too
    // (otherwise typing a new offset would silently change nothing).
    if (field === 'stepOffset' && Number.isFinite(Number(next[idx].absoluteOffset))) {
      next[idx].absoluteOffset = next[idx].stepOffset;
    }
    setRows(next);
  }

  // Settings of the feature operations (tarama / uzatma) live in a
  // sub-object named after the operation; empty input = default.
  function updateSub(idx, group, field, value) {
    const next = rows.slice();
    const parsed = typeof value === 'boolean' || field === 'yon' ? value : (value === '' ? undefined : parseFloat(value));
    next[idx] = { ...next[idx], [group]: { ...(next[idx][group] || {}), [field]: parsed } };
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
    const BOOL = ['yon', 'autoFit', 'insideFrame', 'stagger', 'respectPreviousOffset'];
    // count / lineFromPct / lineToPct are optional: empty = not set.
    const OPTIONAL = ['count', 'lineFromPct', 'lineToPct', 'frameBevel', 'bitAngle'];
    let parsed;
    if (BOOL.includes(field)) parsed = value;
    else if (OPTIONAL.includes(field)) parsed = value === '' ? null : parseFloat(value);
    else parsed = parseFloat(value) || 0;
    next[idx] = { ...next[idx], derz: { yon: 'dikey', margin: 0, spacing: 60, autoFit: true, overshoot: 1, overshootX: 1, overshootY: 1, edgeExtra: 0, respectPreviousOffset: true, ...(next[idx].derz || {}), [field]: parsed } };
    setRows(next);
  }
  // Kulp box: vertical lines stop `fromTop` below the top except the first/last `skip`.
  function updateStopBox(idx, field, value) {
    const next = rows.slice();
    const d = next[idx].derz || {};
    const box = { ...(d.stopBox || {}) };
    if (field === 'line') box.line = value;
    else if (value === '') delete box[field];
    else box[field] = parseFloat(value) || 0;
    next[idx] = { ...next[idx], derz: { ...d, stopBox: box.fromTop > 0 ? box : undefined } };
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
            const pinned = Number.isFinite(Number(r.absoluteOffset)) ? Number(r.absoluteOffset) : null;
            if (!CHAIN_OPS.includes(r.operation || 'offset')) {
              // derz / carving / features do not move the offset chain
            } else if (pinned != null) {
              cum = pinned;
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
                    <option value="tarama">Tarama (cep boşaltma)</option>
                    <option value="uzatma">Uzatma (çerçeveden kenara)</option>
                    <option value="sablon" disabled={r.operation !== 'sablon'}>Şablon (süsleme)</option>
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
                    value={pinned ?? r.stepOffset ?? ''}
                    disabled={r.operation === 'sablon'}
                    onChange={(e) => updateRow(i, 'stepOffset', e.target.value)}
                    style={{ width: 60 }}
                  />
                </td>
                <td>{CHAIN_OPS.includes(r.operation || 'offset') ? cum.toFixed(2) : '-'}</td>
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
        const ramp = hasAngle ? +carveExitDistance(r.depth, r.bitAngle).toFixed(2) : null;
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
                  {(r.operation || 'offset') === 'offset' && (
                    <label>
                      <span>Köşe R (mm) — boş = düz köşe</span>
                      <input type="number" min="0" step="0.5" value={r.cornerRadius ?? ''} placeholder="—" onChange={(e) => updateOptional(selected, 'cornerRadius', e.target.value)} />
                    </label>
                  )}
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
                  <label className="check-field" title="Kenar payı = çerçeve çizgisi (ör. iç V offseti). Çerçeveler arası, verilen aralığa en yakın eşit parçalara bölünür; çerçevenin üstüne denk gelen iki çizgi atılır.">
                    <input type="checkbox" checked={r.derz?.insideFrame === true} onChange={(e) => updateDerz(selected, 'insideFrame', e.target.checked)} />
                    <span>Çerçeve içini eşit böl (kenar payı = çerçeve)</span>
                  </label>
                  <label className="check-field">
                    <input type="checkbox" checked={r.derz?.respectPreviousOffset !== false} onChange={(e) => updateDerz(selected, 'respectPreviousOffset', e.target.checked)} />
                    <span>Önceki offset sınırlarına uy</span>
                  </label>
                  <label title="Çerçeve bir V kanalıysa pahı panelin içine taşar (90° bıçak, 6 mm derin → 6 mm). Girilirse derzler görünen panel kenarından bölünür, kenar şeritleri de eşit çıkar.">
                    <span>Çerçeve pahı (mm) — boş = yok</span>
                    <input type="number" min="0" step="0.5" value={r.derz?.frameBevel ?? ''} placeholder="—" onChange={(e) => updateDerz(selected, 'frameBevel', e.target.value)} />
                  </label>
                  <label title="Derz bıçağının tam açısı (T1 = 90). Derz kanalının genişliği de hesaba katılır.">
                    <span>Derz bıçak açısı (°) — boş = yok</span>
                    <input type="number" min="0" max="179" step="1" value={r.derz?.bitAngle ?? ''} placeholder="—" onChange={(e) => updateDerz(selected, 'bitAngle', e.target.value)} />
                  </label>
                  <label>
                    <span>Çizgi sayısı — boş = aralıktan</span>
                    <input type="number" min="1" step="1" value={r.derz?.count ?? ''} placeholder="—" onChange={(e) => updateDerz(selected, 'count', e.target.value)} />
                  </label>
                  <label className="check-field" title="Çizgiler eşit bölmenin aralıklarının tam ortasına gelir (ör. model 4 üst yarısındaki kısa ara derzler).">
                    <input type="checkbox" checked={r.derz?.stagger === true} onChange={(e) => updateDerz(selected, 'stagger', e.target.checked)} />
                    <span>Ara çizgi (aralıkların ortasına)</span>
                  </label>
                  <label>
                    <span>Çizgi başı (%) — boş = çerçeve</span>
                    <input type="number" min="0" max="100" step="1" value={r.derz?.lineFromPct ?? ''} placeholder="—" onChange={(e) => updateDerz(selected, 'lineFromPct', e.target.value)} />
                  </label>
                  <label>
                    <span>Çizgi sonu (%) — boş = çerçeve</span>
                    <input type="number" min="0" max="100" step="1" value={r.derz?.lineToPct ?? ''} placeholder="—" onChange={(e) => updateDerz(selected, 'lineToPct', e.target.value)} />
                  </label>
                  <label title="Kulp kutusu: dikey çizgiler üst kenarın bu kadar altında durur (boş = kutu yok).">
                    <span>Kulp kutusu: üstten (mm)</span>
                    <input type="number" min="0" step="0.5" value={r.derz?.stopBox?.fromTop ?? ''} placeholder="—" onChange={(e) => updateStopBox(selected, 'fromTop', e.target.value)} />
                  </label>
                  <label title="Baştan ve sondan bu kadar çizgi kutunun kenarıdır, üste kadar devam eder.">
                    <span>Kutu kenarı: baş/son çizgi sayısı</span>
                    <input type="number" min="0" step="1" value={r.derz?.stopBox?.skip ?? ''} placeholder="0" onChange={(e) => updateStopBox(selected, 'skip', e.target.value)} />
                  </label>
                  <label className="check-field">
                    <input type="checkbox" checked={r.derz?.stopBox?.line === true} onChange={(e) => updateStopBox(selected, 'line', e.target.checked)} />
                    <span>Kutunun üst çizgisini de çiz</span>
                  </label>
                </>
              )}
              {r.operation === 'tarama' && (
                <>
                  <div className="hint" style={{ gridColumn: '1 / -1' }}>
                    Offset = boşaltılacak alanın dış sınırı. İç sınır boşsa ortaya kadar taranır.
                  </div>
                  <label>
                    <span>İç sınır offseti (mm) — boş = orta</span>
                    <input type="number" min="0" step="0.5" value={r.tarama?.innerOffset || ''} placeholder="—" onChange={(e) => updateSub(selected, 'tarama', 'innerOffset', e.target.value)} />
                  </label>
                  <label>
                    <span>Bıçak çapı (mm)</span>
                    <input type="number" min="0.1" step="0.5" value={r.tarama?.toolDiameter ?? ''} placeholder="6" onChange={(e) => updateSub(selected, 'tarama', 'toolDiameter', e.target.value)} />
                  </label>
                  <label>
                    <span>Adım (mm) — boş = çapın %80 i</span>
                    <input type="number" min="0.1" step="0.5" value={r.tarama?.stepover ?? ''} placeholder="—" onChange={(e) => updateSub(selected, 'tarama', 'stepover', e.target.value)} />
                  </label>
                </>
              )}
              {r.operation === 'uzatma' && (
                <>
                  <div className="hint" style={{ gridColumn: '1 / -1' }}>
                    Offset = uzatılacak çerçeve. Köşelerinden kapak kenarına çizgi çekilir.
                  </div>
                  <label>
                    <span>Yön</span>
                    <select value={r.uzatma?.yon || 'dikey'} onChange={(e) => updateSub(selected, 'uzatma', 'yon', e.target.value)}>
                      <option value="dikey">Dikey (üst/alt kenara)</option>
                      <option value="yatay">Yatay (sağ/sol kenara)</option>
                    </select>
                  </label>
                  <label>
                    <span>Kenardan taşma (mm)</span>
                    <input type="number" min="0" step="0.1" value={r.uzatma?.overshoot ?? ''} placeholder="0.5" onChange={(e) => updateSub(selected, 'uzatma', 'overshoot', e.target.value)} />
                  </label>
                </>
              )}
              {r.operation === 'sablon' && (
                <div className="hint" style={{ gridColumn: '1 / -1' }}>
                  Şablon (süsleme): {r.sablon?.paths?.length || 0} yol, {r.sablon?.refWidth} × {r.sablon?.refHeight} mm kapaktan alındı.
                  Köşe süslemeleri köşelerinde sabit kalır, çerçeve kolları kapak boyuna göre uzar. Derinlik şablonda kayıtlıdır.
                </div>
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

