import { useRef, useState, useEffect } from 'react';
import JSZip from 'jszip';
import {
  calculateNesting,
  validateNestingResult,
  buildNestingPlateGcode,
  buildNestingPlateDxf,
  estimateNestingTime,
  parseNestImportText,
} from '../../lib/gcode/nesting.js';
import { calculateAdaptiveOffsets } from '../../lib/gcode/kapak.js';
import { computeCumOffsets } from '../../lib/gcode/common.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}

function crispRect(x, y, w, h) {
  const x1 = Math.round(x), y1 = Math.round(y);
  const x2 = Math.round(x + w), y2 = Math.round(y + h);
  return { x: x1 + 0.5, y: y1 + 0.5, w: Math.max(1, x2 - x1 - 1), h: Math.max(1, y2 - y1 - 1) };
}

export default function NestingPanel({ cfg, plateCfg }) {
  // Nesting, Ayarlar bölümündeki ortak plaka ölçülerini kullanır.
  const [plateWidth, setPlateWidth] = useState(plateCfg?.width || 2100);
  const [plateHeight, setPlateHeight] = useState(plateCfg?.height || 2800);
  const [edgeMargin, setEdgeMargin] = useState(10);
  const [partGap, setPartGap] = useState(5);
  const [allowRotate, setAllowRotate] = useState(true);

  // Dış Kesim / Ebatlama Ayarları
  const [enableOuterCut, setEnableOuterCut] = useState(true);
  const [cutToolNo, setCutToolNo] = useState('6');
  const [cutToolDia, setCutToolDia] = useState(6);
  const [preCutDepth, setPreCutDepth] = useState(1.5);

  const [parts, setParts] = useState([
    { name: 'Kapak', width: 500, height: 500, qty: 1, lockRotation: false },
  ]);

  const [result, setResult] = useState(null);
  const [selectedPlateIndex, setSelectedPlateIndex] = useState(0);
  const [showToolpaths, setShowToolpaths] = useState(true);
  const [message, setMessage] = useState(null);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!plateCfg) return;
    if (plateCfg.width > 0) setPlateWidth(plateCfg.width);
    if (plateCfg.height > 0) setPlateHeight(plateCfg.height);
  }, [plateCfg?.width, plateCfg?.height]);

  function updatePart(idx, field, value) {
    const next = parts.slice();
    next[idx] = {
      ...next[idx],
      [field]: field === 'name' ? value : field === 'lockRotation' ? value : parseFloat(value) || 0,
    };
    setParts(next);
  }

  function addPart() {
    setParts([...parts, { name: `Parça ${parts.length + 1}`, width: 500, height: 500, qty: 1, lockRotation: false }]);
  }

  function removePart(idx) {
    if (parts.length <= 1) {
      setParts([{ name: '', width: '', height: '', qty: 1, lockRotation: false }]);
      return;
    }
    setParts(parts.filter((_, i) => i !== idx));
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const { parts: imported, errors } = parseNestImportText(text);
    if (imported.length > 0) {
      const formatted = imported.map((p) => ({ ...p, lockRotation: false }));
      setParts((prev) => [...prev.filter((p) => p.name || p.width || p.height), ...formatted]);
    }
    if (imported.length && errors.length) {
      setMessage({ type: 'ok', text: `${imported.length} satır içe aktarıldı. Geçersiz satırlar: ${errors.join(', ')}` });
    } else if (!imported.length && errors.length) {
      setMessage({ type: 'err', text: 'Geçerli ölçü bulunamadı. TXT örnek: 500-454-2  •  CSV örnek: isim,genişlik,yükseklik,adet' });
    } else if (imported.length) {
      setMessage({ type: 'ok', text: `${imported.length} ölçü satırı içe aktarıldı.` });
    }
  }

  function expandParts() {
    const out = [];
    parts.forEach((p, idx) => {
      const name = (p.name || '').trim() || `Parça ${idx + 1}`;
      const w = parseFloat(p.width) || 0;
      const h = parseFloat(p.height) || 0;
      const qty = Math.max(1, parseInt(p.qty, 10) || 1);
      if (w > 0 && h > 0) {
        for (let q = 1; q <= qty; q++) {
          out.push({ name, width: w, height: h, itemNo: q, lockRotation: !!p.lockRotation });
        }
      }
    });
    return out;
  }

  function getActiveConfig() {
    return {
      ...cfg,
      enableOuterCut,
      cutToolNo,
      cutToolDia: parseFloat(cutToolDia) || 6,
      preCutDepth: parseFloat(preCutDepth) || 1.5,
    };
  }

  function calculate() {
    setMessage(null);
    try {
      const expanded = expandParts();
      if (!expanded.length) {
        throw new Error('En az bir geçerli parça ekle.');
      }
      const nest = calculateNesting({
        plateW: parseFloat(plateWidth) || 0,
        plateH: parseFloat(plateHeight) || 0,
        edge: parseFloat(edgeMargin) || 0,
        gap: parseFloat(partGap) || 0,
        rotate: allowRotate,
        parts: expanded,
      });

      setSelectedPlateIndex(0);
      setResult(nest);

      if (!cfg.rows.length && !enableOuterCut) {
        setMessage({ type: 'err', text: 'Nesting hesaplandı fakat CNC dosyası üretmek için en az bir bıçak tanımlamalısın veya dış kesimi açmalısın.' });
        return;
      }
      const toolErr = validateNestingResult(nest, cfg.rows, cfg.offsetMode);
      if (toolErr) {
        setMessage({ type: 'err', text: 'Nesting hesaplandı fakat bazı parçalar için bıçak ayarları geçersiz.' });
        return;
      }

      const activeCfg = getActiveConfig();
      const minutes = estimateNestingTime(nest, activeCfg);
      setMessage({
        type: 'ok',
        text: `${nest.plates.length} plaka bulundu. Tahmini süre: ~${minutes.toFixed(1)} dk.${enableOuterCut ? ' (1.5mm Ön Çizme + İşleme + Z0 Final Kesim dahil — Sağ üstten sola)' : ''
          }. Sonuçtan memnunsan "CNC Dosyalarını İndir" butonuna bas.`,
      });
    } catch (e) {
      setMessage({ type: 'err', text: e.message });
      setResult(null);
    }
  }

  useCtrlEnter(calculate);

  async function downloadFiles() {
    if (!result) return;
    if (!cfg.rows.length && !enableOuterCut) {
      setMessage({ type: 'err', text: 'CNC dosyası üretmek için en az bir bıçak tanımlamalısın veya dış kesimi açmalısın.' });
      return;
    }
    const toolErr = validateNestingResult(result, cfg.rows, cfg.offsetMode);
    if (toolErr) {
      setMessage({ type: 'err', text: 'Bazı parçalar için bıçak ayarları geçersiz. Bıçaklar bölümünü kontrol et.' });
      return;
    }

    const activeCfg = getActiveConfig();
    const zip = new JSZip();
    result.plates.forEach((plate) => {
      zip.file(`plaka_${plate.number}.nc`, buildNestingPlateGcode(plate, activeCfg));
    });
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `nesting_${result.plates.length}_plaka.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage({ type: 'ok', text: `${result.plates.length} plaka için CNC dosyaları (.nc) ZIP formatında indirildi.` });
  }

  async function downloadDxfFiles() {
    if (!result) return;
    const activeCfg = getActiveConfig();
    const zip = new JSZip();
    result.plates.forEach((plate) => {
      zip.file(`plaka_${plate.number}.dxf`, buildNestingPlateDxf(plate, activeCfg));
    });
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `nesting_${result.plates.length}_plaka_dxf.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage({ type: 'ok', text: `${result.plates.length} plaka için DXF dosyaları (.dxf) ZIP formatında indirildi.` });
  }

  function exportSingleDXF() {
    if (!result) return;
    const plate = result.plates[selectedPlateIndex] || result.plates[0];
    if (!plate) return;
    const activeCfg = getActiveConfig();
    const dxfText = buildNestingPlateDxf(plate, activeCfg);
    const blob = new Blob([dxfText], { type: 'application/dxf;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nesting_plaka_${plate.number}.dxf`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage({ type: 'ok', text: `Plaka ${plate.number} için DXF dosyası indirildi.` });
  }

  function exportPNG() {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const plateNum = result.plates[selectedPlateIndex]?.number || 1;
      a.download = `nesting_plaka_${plateNum}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  }

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (!result || !result.plates.length) {
      canvas.width = 900;
      canvas.height = 450;
      ctx.fillStyle = '#171a21';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#2a2f3a';
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
      ctx.fillStyle = '#9aa2b1';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Henüz nesting hesaplanmadı.', canvas.width / 2, canvas.height / 2);
      return;
    }

    const plate = result.plates[selectedPlateIndex] || result.plates[0];
    // Keep the real plate aspect ratio. Do not force minimum canvas dimensions:
    // that distorted vertical plates such as 2100 × 2800.
    const maxW = 900, maxH = 700;
    const scale = Math.min(maxW / result.plateW, maxH / result.plateH);
    canvas.width = Math.max(1, Math.round(result.plateW * scale));
    canvas.height = Math.max(1, Math.round(result.plateH * scale));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#171a21';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    // 1. Draw Parts
    plate.parts.forEach((part, idx) => {
      const x = part.x * scale, y = part.y * scale;
      const w = part.placedWidth * scale, h = part.placedHeight * scale;
      const r = crispRect(x, y, w, h);

      ctx.strokeStyle = `hsl(${hashHue(part.name)} 70% 62%)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      ctx.fillStyle = '#e6e8ec';
      ctx.font = `${Math.max(9, Math.min(13, Math.min(w, h) / 7))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const label = `${idx + 1}. ${part.name}${part.rotated ? ' ↻' : ''}`;
      ctx.fillText(label, x + w / 2, y + h / 2);
    });

    // 2. Draw Toolpaths
    if (showToolpaths) {
      // Dış Kesim Çizgisi (3mm dışarıdan kesim hattı)
      if (enableOuterCut) {
        const cutToolRadius = (parseFloat(cutToolDia) || 6) / 2;
        ctx.strokeStyle = '#2fd08a';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        plate.parts.forEach((part) => {
          const x1 = (part.x - cutToolRadius) * scale;
          const y1 = (part.y - cutToolRadius) * scale;
          const w2 = (part.placedWidth + 2 * cutToolRadius) * scale;
          const h2 = (part.placedHeight + 2 * cutToolRadius) * scale;
          const cr = crispRect(x1, y1, w2, h2);
          ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);
        });
        ctx.setLineDash([]);
      }

      // Profil / Motif Bıçakları (Adaptif Offsetli) — carving satırları ayrı çizilir.
      const offsetRows = (cfg.rows || []).filter((r) => (r.operation || 'offset') !== 'derz' && r.operation !== 'carving');
      const carvingRows = (cfg.rows || []).filter((r) => r.operation === 'carving');
      const offsetToolColors = offsetRows.map((r, i) => `hsl(${(i * 67) % 360} 90% 62%)`);

      offsetRows.forEach((r, rowIdx) => {
        ctx.strokeStyle = offsetToolColors[rowIdx];
        ctx.lineWidth = 1;

        plate.parts.forEach((part) => {
          const adaptiveRows = calculateAdaptiveOffsets(
            part.placedWidth,
            part.placedHeight,
            offsetRows,
            cfg.offsetMode || 'relative'
          );
          const adRow = adaptiveRows[rowIdx];
          if (!adRow || adRow.skipped) return;

          const x1 = (part.x + adRow.leftOffset) * scale;
          const y1 = (part.y + adRow.bottomOffset) * scale;
          const w2 = (part.placedWidth - adRow.leftOffset - adRow.rightOffset) * scale;
          const h2 = (part.placedHeight - adRow.bottomOffset - adRow.topOffset) * scale;
          const cr = crispRect(x1, y1, w2, h2);
          if (cfg.topStyle && cfg.topStyle !== 'flat') {
            // Draw the curved top edge (approximate) instead of a flat rectangle top.
            const xc = part.x + part.placedWidth / 2;
            const yt = (part.y + part.placedHeight - adRow.topOffset) * scale;
            ctx.beginPath();
            ctx.moveTo(cr.x, cr.y);
            ctx.lineTo(cr.x + cr.w, cr.y);
            ctx.lineTo(cr.x + cr.w, yt);
            ctx.quadraticCurveTo(xc * scale, yt + adRow.topOffset * scale, cr.x, yt);
            ctx.closePath();
            ctx.stroke();
          } else {
            ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);
          }
        });
      });

      // Carving profilleri (tek çizgi, V-bıçak)
      carvingRows.forEach((r) => {
        ctx.strokeStyle = 'hsl(320 85% 62%)';
        ctx.lineWidth = 1;
        const o = Number(r.stepOffset) || 0;
        plate.parts.forEach((part) => {
          const x1 = (part.x + o) * scale;
          const y1 = (part.y + o) * scale;
          const x2 = (part.x + part.placedWidth - o) * scale;
          const y2 = (part.y + part.placedHeight - o) * scale;
          const cr = crispRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);
        });
      });
    }
  }, [result, selectedPlateIndex, showToolpaths, enableOuterCut, cutToolDia, cfg]);

  const stats = (() => {
    if (!result) {
      return { plateCount: 0, partCount: 0, areaUsed: '0%', wasteM2: '0', estTime: '0' };
    }
    const totalArea = result.plateW * result.plateH * result.plates.length;
    const usedArea = result.plates.reduce(
      (sum, p) => sum + p.parts.reduce((s, part) => s + part.placedWidth * part.placedHeight, 0),
      0
    );
    const pct = totalArea ? (usedArea / totalArea) * 100 : 0;
    const wasteM2 = Math.max(0, totalArea - usedArea) / 1_000_000;
    const minutes = estimateNestingTime(result, getActiveConfig());

    return {
      plateCount: result.plates.length,
      partCount: result.plates.reduce((s, p) => s + p.parts.length, 0),
      areaUsed: `${pct.toFixed(1)}%`,
      wasteM2: wasteM2.toFixed(2),
      estTime: minutes.toFixed(1),
    };
  })();

  // Legend/colour must follow the SAME row set the canvas draws:
  // offset rows drive the cumulative chain, carving rows are their own entries.
  const legendOffsetRows = (cfg.rows || []).filter((r) => (r.operation || 'offset') !== 'derz' && r.operation !== 'carving');
  const legendCarvingRows = (cfg.rows || []).filter((r) => r.operation === 'carving');
  const cums = showToolpaths && legendOffsetRows.length ? computeCumOffsets(legendOffsetRows, cfg.offsetMode || 'relative') : [];
  const toolColors = legendOffsetRows.map((r, i) => `hsl(${(i * 67) % 360} 90% 62%)`);

  return (
    <div className="card">
      <div className="nesting-grid">
        <div className="nesting-settings">
          <div className="card-lite">
            <h3>Plaka ve Boşluklar</h3>
            <div className="row2">
              <div>
                <label>Plaka genişliği X (mm)</label>
                <input
                  type="number"
                  value={plateWidth}
                  min="1"
                  step="1"
                  onChange={(e) => setPlateWidth(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label>Plaka yüksekliği Y (mm)</label>
                <input
                  type="number"
                  value={plateHeight}
                  min="1"
                  step="1"
                  onChange={(e) => setPlateHeight(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="row2" style={{ marginTop: 8 }}>
              <div>
                <label>Dış kenar boşluğu (mm)</label>
                <input
                  type="number"
                  value={edgeMargin}
                  min="0"
                  step="0.1"
                  onChange={(e) => setEdgeMargin(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label>Parçalar arası boşluk (mm)</label>
                <input
                  type="number"
                  value={partGap}
                  min="0"
                  step="0.1"
                  onChange={(e) => setPartGap(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <label className="checkbox-row" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={allowRotate}
                onChange={(e) => setAllowRotate(e.target.checked)}
              />
              Parçaları 90° döndürmeye izin ver
            </label>
          </div>

          <div className="card-lite">
            <h3>Dış Kesim (Ebatlama)</h3>
            <label className="checkbox-row" style={{ marginTop: 0, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={enableOuterCut}
                onChange={(e) => setEnableOuterCut(e.target.checked)}
              />
              Dış kesim yapılacak mı? (Ebatlama)
            </label>

            {enableOuterCut && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <div className="row3">
                  <div>
                    <label>Kesim Takım No</label>
                    <input
                      type="text"
                      value={cutToolNo}
                      onChange={(e) => setCutToolNo(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Bıçak Çapı (mm)</label>
                    <input
                      type="number"
                      value={cutToolDia}
                      min="1"
                      step="0.5"
                      onChange={(e) => setCutToolDia(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label>Ön Çizme (mm)</label>
                    <input
                      type="number"
                      value={preCutDepth}
                      min="0.1"
                      step="0.1"
                      onChange={(e) => setPreCutDepth(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <div className="hint" style={{ marginTop: 8 }}>
                  <b>3 Aşamalı Kesim:</b><br />
                  1. İşleme öncesi {cutToolDia}mm bıçakla {cutToolDia / 2}mm dıştan {preCutDepth}mm derinliğe ön çizme atılır.<br />
                  2. Bıçaklar tablosundaki motif/profil bıçakları sırayla işlenir.<br />
                  3. İşleme bitince {cutToolDia}mm bıçakla Z0'a inilip parçalar ayrılır.<br />
                  <b>Sıra:</b> Sağ en üstteki parçadan sola doğru.
                </div>
              </div>
            )}
          </div>

          <div className="card-lite">
            <h3>Parçalar</h3>
            <table className="parts-table">
              <thead>
                <tr>
                  <th>Parça</th>
                  <th>Gen.</th>
                  <th>Yük.</th>
                  <th>Ad.</th>
                  <th title="Döndürmeyi engelle (desen/damar yönü)">🔒</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        className="part-name"
                        type="text"
                        value={p.name}
                        placeholder="Kapak"
                        onChange={(e) => updatePart(idx, 'name', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        type="number"
                        min="1"
                        step="1"
                        value={p.width}
                        placeholder="500"
                        onChange={(e) => updatePart(idx, 'width', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        type="number"
                        min="1"
                        step="1"
                        value={p.height}
                        placeholder="500"
                        onChange={(e) => updatePart(idx, 'height', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="qty"
                        type="number"
                        min="1"
                        step="1"
                        value={p.qty}
                        onChange={(e) => updatePart(idx, 'qty', e.target.value)}
                      />
                    </td>
                    <td className="lock-cell">
                      <input
                        type="checkbox"
                        checked={!!p.lockRotation}
                        title="Döndürmeyi engelle"
                        onChange={(e) => updatePart(idx, 'lockRotation', e.target.checked)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="remove-part"
                        title="Parçayı sil"
                        onClick={() => removePart(idx)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                className="btn-secondary add-row-btn"
                style={{ flex: 1 }}
                onClick={addPart}
              >
                + Parça Ekle
              </button>
              <button
                type="button"
                className="btn-secondary add-row-btn"
                style={{ flex: 1 }}
                onClick={triggerImport}
              >
                📄 İçe Aktar
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
            <div className="hint" style={{ marginTop: 8 }}>
              TXT: her satıra <b>500-454-2</b> yaz (mm × mm, adet). CSV: <b>isim,genişlik,yükseklik,adet</b> sütunları da desteklenir.
            </div>
          </div>

          <div className="nesting-actions">
            <button type="button" className="btn-primary" onClick={calculate}>
              Nesting Hesapla
            </button>
          </div>
          <div className="nesting-actions" style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-accent2"
              style={{ flex: 1 }}
              disabled={!result}
              onClick={downloadFiles}
            >
              CNC Dosyaları (.nc)
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ flex: 1, borderColor: 'var(--accent, #4f8cff)' }}
              disabled={!result}
              onClick={downloadDxfFiles}
            >
              📐 DXF İndir (.zip)
            </button>
          </div>
          <div className="hint">
            Sığmayan parçalar otomatik olarak sonraki plakaya aktarılır. "CNC Dosyaları (.nc)" ile G-code, "DXF İndir" ile AutoCAD/Alphacam/ArtCAM uyumlu katmanlı DXF dosyaları alabilirsiniz.
          </div>

          {message && (
            <div className={message.type === 'err' ? 'err' : 'ok'} style={{ display: 'block' }}>
              {message.text}
            </div>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <div className="plate-label" style={{ margin: 0, flex: 1 }}>
              {!result
                ? 'Henüz nesting hesaplanmadı.'
                : `Önizleme: Plaka ${result.plates[selectedPlateIndex]?.number || 1} / ${result.plates.length} — ${result.plateW} × ${result.plateH} mm — sıra: Sağ üstten sola`}
            </div>
            <label
              className="checkbox-row"
              style={{ margin: 0 }}
              title="Bıçak offsetlerine göre gerçek kesim çizgilerini göster"
            >
              <input
                type="checkbox"
                checked={showToolpaths}
                onChange={(e) => setShowToolpaths(e.target.checked)}
              />
              Kesim yolları
            </label>
            {result && result.plates.length > 1 && (
              <select
                value={selectedPlateIndex}
                style={{ width: 130 }}
                onChange={(e) => setSelectedPlateIndex(parseInt(e.target.value, 10))}
              >
                {result.plates.map((p, i) => (
                  <option key={i} value={i}>
                    Plaka {p.number}
                  </option>
                ))}
              </select>
            )}
            {result && (
              <>
                <button type="button" className="btn-secondary btn-small" onClick={exportSingleDXF} title="Seçili plakanın DXF çizimini indir">
                  📐 DXF
                </button>
                <button type="button" className="btn-secondary btn-small" onClick={exportPNG}>
                  🖼 PNG
                </button>
              </>
            )}
          </div>

          <div className="nesting-preview">
            <canvas ref={canvasRef} id="nestCanvas" width="900" height="450" />
          </div>

          {showToolpaths && (
            <div className="hint" style={{ marginTop: 8 }}>
              Kesim yolları:{' '}
              {enableOuterCut && (
                <span className="legend-chip">
                  <span className="legend-dot" style={{ background: '#2fd08a' }} />
                  T{cutToolNo} Dış Kesim (6mm / 3mm dıştan)
                </span>
              )}
              {legendOffsetRows.map((r, i) => (
                <span key={`off-${i}`} className="legend-chip">
                  <span className="legend-dot" style={{ background: toolColors[i] }} />
                  T{r.toolNo} {r.name || ''}
                  {cums[i] < 0 ? ' (kesikli = dışarıda)' : ''}
                </span>
              ))}
              {legendCarvingRows.map((r, i) => (
                <span key={`carv-${i}`} className="legend-chip">
                  <span className="legend-dot" style={{ background: 'hsl(320 85% 62%)' }} />
                  T{r.toolNo} {r.name || 'Carving'} (V-bıçak profili)
                </span>
              ))}
            </div>
          )}

          <div className="nesting-stats" id="nestingStatsGrid">
            <div className="stat">
              <b>{stats.plateCount}</b>
              <span>Plaka</span>
            </div>
            <div className="stat">
              <b>{stats.partCount}</b>
              <span>Parça</span>
            </div>
            <div className="stat">
              <b>{stats.areaUsed}</b>
              <span>Toplam kullanım</span>
            </div>
            <div className="stat">
              <b>{stats.wasteM2}</b>
              <span>Boş alan m²</span>
            </div>
            <div className="stat">
              <b>{stats.estTime}</b>
              <span>Tahmini süre (dk)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


