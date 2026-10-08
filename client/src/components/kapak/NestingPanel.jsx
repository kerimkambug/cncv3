import { Fragment, useRef, useState, useEffect } from 'react';
import JSZip from 'jszip';
import {
  calculateNesting,
  validateNestingResult,
  buildNestingPlateGcode,
  buildNestingPlateDxf,
  estimateNestingTime,
  parseNestImportText,
  groupNestingPartsByPreset,
  partToolpathSegments,
} from '../../lib/gcode/nesting.js';
import { validateNestingGap } from '../../../../shared/gcode/validation.js';
import { validateCarvingWarnings } from '../../lib/gcode/kapak.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';
import { usePresets } from '../../hooks/usePresets.js';

function getPresetId(p) { return p._id || p.id; }

// "Cam kapak" in a part row's Model list: a glass door cut by tarama + iç kesim.
const CAM_ID = '__cam__';
const CAM_KEY_PREFIX = 'cam:';
const DEFAULT_CAM = {
  gozSayisi: 6, kolonSayisi: 2, disMargin: 60, icerGap: 20, oturmaPayi: 10,
  taramaDepth: 9, stepover: 3, toolDia: 6, taramaToolNo: '6', kesimToolNo: '6',
};
const CAM_FIELDS = [
  ['gozSayisi', 'Göz sayısı', 1],
  ['kolonSayisi', 'Sütun', 1],
  ['icerGap', 'Çıta (mm)', 1],
  ['disMargin', 'Dıştan (mm)', 1],
  ['oturmaPayi', 'Oturma payı (mm)', 1],
  ['taramaDepth', 'Tarama derinliği (mm)', 0.5],
  ['stepover', 'Tarama adımı (mm)', 0.5],
  ['toolDia', 'Bıçak çapı (mm)', 1],
  ['taramaToolNo', 'Tarama T', 1],
  ['kesimToolNo', 'Kesim T', 1],
];

/** Colour of a tool's toolpaths (same tool = same colour; models shifted apart). */
function toolColor(toolNo, groupIdx = 0) {
  const n = Number.parseInt(toolNo, 10) || 0;
  return `hsl(${(n * 53 + 190 + groupIdx * 41) % 360} 85% 62%)`;
}

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}

export default function NestingPanel({ cfg, plateCfg }) {
  // Nesting, Ayarlar bölümündeki ortak plaka ölçülerini kullanır.
  const [plateWidth, setPlateWidth] = useState(plateCfg?.width || 2100);
  const [plateHeight, setPlateHeight] = useState(plateCfg?.height || 2800);
  const [edgeMargin, setEdgeMargin] = useState(10);
  // Default matching the 6mm outer cutter shipped in cutToolDia: a smaller gap
  // would put two compensated outer paths on top of each other.
  const [partGap, setPartGap] = useState(6);
  const [allowRotate, setAllowRotate] = useState(true);

  // Dış Kesim / Ebatlama Ayarları
  const [enableOuterCut, setEnableOuterCut] = useState(true);
  const [cutToolNo, setCutToolNo] = useState('6');
  const [cutToolDia, setCutToolDia] = useState(6);
  const [preCutDepth, setPreCutDepth] = useState(1.5);

  const [parts, setParts] = useState([
    { name: 'Kapak', width: 500, height: 500, qty: 1, lockRotation: false, presetId: '' },
  ]);

  // Parça satırındaki "Model" dropdown'ı için kayıtlı kapak/kapı presetleri.
  // Boş seçim ("Ayarlardaki") = o satır üstteki ⚙ Ayarlar/🔧 Bıçaklar panelindeki
  // aktif cfg'yi (prop olarak gelen `cfg`) kullanır; aksi halde seçilen preset'in
  // KENDİ bıçak sırası/derinlik/offsetMode'u o parça grubuna uygulanır.
  const { presets } = usePresets('kapak');

  const [result, setResult] = useState(null);
  const [resultPresetMap, setResultPresetMap] = useState({});
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

  const TEXT_FIELDS = new Set(['name', 'lockRotation', 'presetId']);

  function updatePart(idx, field, value) {
    const next = parts.slice();
    next[idx] = {
      ...next[idx],
      [field]: TEXT_FIELDS.has(field) ? value : parseFloat(value) || 0,
    };
    setParts(next);
  }

  // Glass-door settings of a "Cam kapak" row (kept per row; default = the Cam module's).
  function updateCam(idx, field, value) {
    const next = parts.slice();
    const cam = { ...DEFAULT_CAM, ...(next[idx].cam || {}) };
    cam[field] = field.endsWith('ToolNo') ? value : (parseFloat(value) || 0);
    next[idx] = { ...next[idx], cam };
    setParts(next);
  }

  function addPart() {
    setParts([...parts, { name: `Parça ${parts.length + 1}`, width: 500, height: 500, qty: 1, lockRotation: false, presetId: '' }]);
  }

  function removePart(idx) {
    if (parts.length <= 1) {
      setParts([{ name: '', width: '', height: '', qty: 1, lockRotation: false, presetId: '' }]);
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
      const formatted = imported.map((p) => ({ ...p, lockRotation: false, presetId: '' }));
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
      // A glass door's model key carries its settings, so two different glass
      // configurations become two groups with their own programs.
      const presetId = p.presetId === CAM_ID
        ? `${CAM_KEY_PREFIX}${JSON.stringify({ ...DEFAULT_CAM, ...(p.cam || {}) })}`
        : p.presetId || null;
      if (w > 0 && h > 0) {
        for (let q = 1; q <= qty; q++) {
          out.push({ name, width: w, height: h, itemNo: q, lockRotation: !!p.lockRotation, presetId });
        }
      }
    });
    return out;
  }

  /**
   * Genişletilmiş parça listesindeki her farklı presetId için { [presetId]: cfg }
   * haritası kurar — sadece parçalar arasında FİİLEN seçilmiş presetler dahil edilir
   * (kayıtlı ama kullanılmayan bir presette eksik bıçak bilgisi varsa nesting'i
   * gereksiz yere engellememesi için).
   */
  function buildPresetMap(expandedParts) {
    const usedIds = new Set(expandedParts.map((p) => p.presetId).filter(Boolean));
    const map = {};
    // Glass doors use the machine settings of "Ayarlar" (thickness, feeds, Z...).
    usedIds.forEach((id) => {
      if (!id.startsWith(CAM_KEY_PREFIX)) return;
      map[id] = { ...cfg, rows: [], name: 'Cam kapak', cam: JSON.parse(id.slice(CAM_KEY_PREFIX.length)) };
    });
    presets.forEach((preset) => {
      const id = getPresetId(preset);
      if (!usedIds.has(id)) return;
      const { _id, id: _id2, module, category, imageDataUrl, description, previewWidth, previewHeight, createdAt, updatedAt, ...rest } = preset;
      map[id] = rest; // { name, thickness, spindleSpeed, safeZ, ..., offsetMode, topStyle, riseRatio, rows }
    });
    return map;
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

  // Live feedback for the parts-gap field. The same rule is enforced again in
  // calculateNesting (before packing) and in buildNestingPlateGcode (before any
  // G-code is emitted), so this is purely the explanation the operator needs to
  // understand WHY the value is rejected instead of getting a silent redraw.
  const gapWarning = validateNestingGap({
    partGap: parseFloat(partGap),
    cutToolDia: parseFloat(cutToolDia),
    outerCutEnabled: enableOuterCut,
  });

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
        // Safety gate input: the outer cutter's diameter. Without it the parts
        // could be packed closer than one tool diameter and their compensated
        // outer paths would overlap (tool cuts into the neighbouring part).
        gapSafety: {
          cutToolDia: parseFloat(cutToolDia),
          outerCutEnabled: enableOuterCut,
        },
      });

      const presetMap = buildPresetMap(expanded);
      setSelectedPlateIndex(0);
      setResult(nest);
      setResultPresetMap(presetMap);

      const anyDefaultUsesAyarlar = expanded.some((p) => !p.presetId);
      if (anyDefaultUsesAyarlar && !cfg.rows.length && !enableOuterCut) {
        setMessage({ type: 'err', text: 'Nesting hesaplandı fakat "Ayarlardaki" modeli kullanan parçalar için en az bir bıçak tanımlamalısın veya dış kesimi açmalısın.' });
        return;
      }
      const activeCfg = getActiveConfig();
      const toolErr = validateNestingResult(nest, activeCfg, presetMap);
      if (toolErr) {
        setMessage({ type: 'err', text: `Nesting hesaplandı fakat bazı parçalar için bıçak ayarları geçersiz. ${toolErr}` });
        return;
      }

      const minutes = estimateNestingTime(nest, activeCfg, presetMap);
      const warnings = validateCarvingWarnings(cfg.rows);
      setMessage({
        type: 'ok',
        text: `${nest.plates.length} plaka bulundu (${nest.search.variants} yerleşim varyasyonu denendi, en az plaka + en toplu son plaka seçildi; plaka kullanımı %${(nest.search.utilization * 100).toFixed(1)}). Tahmini süre: ~${minutes.toFixed(1)} dk.${enableOuterCut ? ' (1.5mm Ön Çizme + İşleme + Z0 Final Kesim dahil — Sağ üstten sola)' : ''
          }. Sonuçtan memnunsan "CNC Dosyalarını İndir" butonuna bas.${warnings.length ? `\n\nUyarı:\n${warnings.join('\n')}` : ''}`,
      });
    } catch (e) {
      setMessage({ type: 'err', text: e.message });
      setResult(null);
    }
  }

  useCtrlEnter(calculate);

  async function downloadFiles() {
    if (!result) return;
    const activeCfg = getActiveConfig();
    const toolErr = validateNestingResult(result, activeCfg, resultPresetMap);
    if (toolErr) {
      setMessage({ type: 'err', text: `Bazı parçalar için bıçak ayarları geçersiz. ${toolErr}` });
      return;
    }

    const zip = new JSZip();
    result.plates.forEach((plate) => {
      zip.file(`plaka_${plate.number}.nc`, buildNestingPlateGcode(plate, activeCfg, resultPresetMap));
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
      zip.file(`plaka_${plate.number}.dxf`, buildNestingPlateDxf(plate, activeCfg, resultPresetMap));
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
    const dxfText = buildNestingPlateDxf(plate, activeCfg, resultPresetMap);
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
    // that distorted vertical plates such as 2100 x 2800.
    // Backstore is rendered at devicePixelRatio (and never below 2x) so that the
    // canvas, which CSS stretches to 100% width, stays sharp instead of being an
    // upscaled blur — that blur is what made the drawing "look wrong" even when
    // the numbers were right.
    const maxW = 1100, maxH = 900;
    const dpr = Math.max(2, Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    const s = Math.min(maxW / result.plateW, maxH / result.plateH) * dpr;
    canvas.width = Math.max(1, Math.round(result.plateW * s));
    canvas.height = Math.max(1, Math.round(result.plateH * s));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#171a21';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    // Machine Y grows UP from the plate's bottom edge, canvas Y grows down: flip,
    // so the preview shows the plate the way the machine (and the DXF) sees it.
    const cy = (v) => (result.plateH - v) * s;

    // 1. Draw Parts
    plate.parts.forEach((part, idx) => {
      const x = part.x * s, y = cy(part.y + part.placedHeight);
      const w = part.placedWidth * s, h = part.placedHeight * s;

      ctx.strokeStyle = `hsl(${hashHue(part.name)} 70% 62%)`;
      ctx.lineWidth = 1.5 * dpr;
      // Parça sınırı dahi TAM ölçüde çizilir (piksel yuvarlama yok).
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = '#e6e8ec';
      ctx.font = `${Math.max(9, Math.min(13, Math.min(w, h) / 7)) * dpr}px sans-serif`;
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
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        plate.parts.forEach((part) => {
          const x1 = (part.x - cutToolRadius) * s;
          const y1 = cy(part.y + part.placedHeight + cutToolRadius);
          const w2 = (part.placedWidth + 2 * cutToolRadius) * s;
          const h2 = (part.placedHeight + 2 * cutToolRadius) * s;
          // Bıçak yarıçapı kadar dışarıdan — TAM ölçüde, yuvarlama yok.
          ctx.strokeRect(x1, y1, w2, h2);
        });
        ctx.setLineDash([]);
      }

      // Profil / motif takım yolları — her parça, KENDİ modelinin (dropdown'da
      // seçilenin, boşsa Ayarlar'ın) gerçek G-code'undan çizilir: ekranda görülen,
      // makinenin keseceği yolun kendisidir (offset, köşe yayı, carving rampası,
      // derz, tarama, şablon...). Renk = takım.
      const drawGroups = groupNestingPartsByPreset(plate.parts, cfg, resultPresetMap);
      drawGroups.forEach((group, groupIdx) => {
        group.parts.forEach((part) => {
          partToolpathSegments(part, group.cfg).forEach((seg) => {
            ctx.strokeStyle = toolColor(seg.tool, groupIdx);
            ctx.lineWidth = 1.25 * dpr;
            ctx.beginPath();
            ctx.moveTo(seg.from.x * s, cy(seg.from.y));
            ctx.lineTo(seg.to.x * s, cy(seg.to.y));
            ctx.stroke();
          });
        });
      });
    }
  }, [result, selectedPlateIndex, showToolpaths, enableOuterCut, cutToolDia, cfg, resultPresetMap]);

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
    const minutes = estimateNestingTime(result, getActiveConfig(), resultPresetMap);

    return {
      plateCount: result.plates.length,
      partCount: result.plates.reduce((s, p) => s + p.parts.length, 0),
      areaUsed: `${pct.toFixed(1)}%`,
      wasteM2: wasteM2.toFixed(2),
      estTime: minutes.toFixed(1),
    };
  })();

  // Legend/colour must follow the SAME grouping the canvas draws: each model
  // (preset seçilmişse o, yoksa Ayarlar) kendi offset/carving satırlarıyla listelenir.
  const selectedPlateParts = result?.plates?.[selectedPlateIndex]?.parts || [];
  const rawLegendGroups = showToolpaths ? groupNestingPartsByPreset(selectedPlateParts, cfg, resultPresetMap) : [];
  const legendMultiModel = rawLegendGroups.length > 1;
  const legendGroups = rawLegendGroups.map((group, groupIdx) => {
    // One chip per tool, in the order the rows first use it, naming its rows.
    const tools = [];
    const legendRows = group.cfg.cam
      ? [{ toolNo: group.cfg.cam.taramaToolNo, name: 'Cam tarama' }, { toolNo: group.cfg.cam.kesimToolNo, name: 'Cam iç kesim' }]
      : (group.cfg.rows || []);
    legendRows.forEach((r) => {
      const key = String(r.toolNo);
      let t = tools.find((x) => x.toolNo === key);
      if (!t) { t = { toolNo: key, color: toolColor(key, groupIdx), names: [] }; tools.push(t); }
      if (r.name && !t.names.includes(r.name)) t.names.push(r.name);
    });
    return {
      label: legendMultiModel ? (group.key === '__default__' ? 'Ayarlar' : (group.cfg.name || 'Model')) : null,
      tools,
    };
  });

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
                {gapWarning && (
                  <div className="err" style={{ display: 'block', marginTop: 6, fontSize: 11.5 }}>
                    {gapWarning}
                  </div>
                )}
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
                  <th title="Bu ölçü hangi kapak modeliyle (bıçak sırası/offset/carving) işlenecek?">Model</th>
                  <th title="Döndürmeyi engelle (desen/damar yönü)">🔒</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p, idx) => (
                  <Fragment key={idx}>
                  <tr>
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
                    <td>
                      <select
                        className="part-preset-select"
                        value={p.presetId || ''}
                        title="Ayarlar = Ayarlar/Bıçaklar panelindeki aktif model. Cam kapak = tarama + iç kesim (ayarları satırın altında)."
                        onChange={(e) => updatePart(idx, 'presetId', e.target.value)}
                      >
                        <option value="">Ayarlar</option>
                        <option value={CAM_ID}>Cam kapak</option>
                        {presets.map((preset) => (
                          <option key={getPresetId(preset)} value={getPresetId(preset)}>
                            {preset.name}{preset.category === 'kapi' ? ' (Kapı)' : ''}
                          </option>
                        ))}
                      </select>
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
                  {p.presetId === CAM_ID && (
                    <tr className="cam-settings-row">
                      <td colSpan={7}>
                        <div className="cam-settings">
                          {CAM_FIELDS.map(([field, label, step]) => (
                            <label key={field}>
                              <span>{label}</span>
                              <input
                                type={field.endsWith('ToolNo') ? 'text' : 'number'}
                                min="0"
                                step={step}
                                value={(p.cam || DEFAULT_CAM)[field]}
                                onChange={(e) => updateCam(idx, field, e.target.value)}
                              />
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
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
              {legendGroups.map((group, gi) => (
                <span key={`grp-${gi}`}>
                  {group.label && <span className="legend-chip" style={{ fontWeight: 600 }}>{group.label}:</span>}
                  {group.tools.map((t) => (
                    <span key={`tool-${gi}-${t.toolNo}`} className="legend-chip" title={t.names.join(' · ')}>
                      <span className="legend-dot" style={{ background: t.color }} />
                      T{t.toolNo} {t.names.join(' · ')}
                    </span>
                  ))}
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


