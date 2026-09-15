import { useRef, useState } from 'react';
import { usePresets } from '../../hooks/usePresets.js';
import { buildKapakPresetDxf } from '../../lib/gcode/kapak.js';

function createDefaultPresetImage(name) {
  const label = String(name || 'Preset').trim() || 'Preset';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#050505"/><text x="450" y="300" fill="#fff" font-family="Arial, sans-serif" font-size="42" font-weight="700" text-anchor="middle" dominant-baseline="middle">${label.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]))}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export default function PresetPanel({ cfg, setCfg, rows, setRows }) {
  const { presets, loading, error, savePreset, deletePreset } = usePresets('kapak');
  const [category, setCategory] = useState('kapak');
  const [name, setName] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [description, setDescription] = useState('');
  const [previewWidth, setPreviewWidth] = useState(600);
  const [previewHeight, setPreviewHeight] = useState(600);
  const [previewPreset, setPreviewPreset] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [importMsg, setImportMsg] = useState(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);

  async function handleSave() {
    setSaveError(null);
    if (!name.trim()) return;
    try {
      const presetName = name.trim();
      await savePreset(presetName, { ...cfg, rows, category, imageDataUrl: imageDataUrl || createDefaultPresetImage(presetName), description, previewWidth: Number(previewWidth) || 600, previewHeight: Number(previewHeight) || 600 }, activeId);
      setName('');
      setImageDataUrl('');
      if (imageInputRef.current) imageInputRef.current.value = '';
      setDescription('');
      setPreviewWidth(600);
      setPreviewHeight(600);
      setActiveId(null);
    } catch (e) {
      setSaveError(e.message);
    }
  }

  async function handleDelete(id, presetName) {
    if (!window.confirm(`"${presetName}" presetini silmek istediğine emin misin?`)) return;
    await deletePreset(id);
    if (activeId === id) setActiveId(null);
  }

  function handleLoad(preset) {
    const presetId = preset._id || preset.id;
    setActiveId(presetId);
    setName(preset.name || '');
    setImageDataUrl(preset.imageDataUrl || '');
    setDescription(preset.description || '');
    const { name: _n, module: _m, category: _c, imageDataUrl: _i, description: _d, previewWidth: _pw, previewHeight: _ph, dxfFileName: _df, dxfText: _dt, dxfBounds: _db, _id, id: _id2, rows: presetRows, ...rest } = preset;
    setCfg((prev) => ({ ...prev, ...rest }));
    setRows(presetRows || []);
    setCategory(preset.category || 'kapak');
    setPreviewWidth(preset.previewWidth || 600);
    setPreviewHeight(preset.previewHeight || 600);
  }

  function handleNew() {
    setActiveId(null);
    setName('');
    setImageDataUrl('');
    if (imageInputRef.current) imageInputRef.current.value = '';
    setDescription('');
    setPreviewWidth(600);
    setPreviewHeight(600);
  }

  function handleImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  }

  function removeImage() {
    setImageDataUrl('');
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  function downloadDxf(preset) {
    const width = Number(preset.previewWidth) || 600;
    const height = Number(preset.previewHeight) || 600;
    const dxf = buildKapakPresetDxf(width, height, preset);
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${preset.name.replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ_\-]+/gi, '_')}_${width}x${height}.dxf`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const visiblePresets = presets.filter((preset) => (preset.category || 'kapak') === category);
  const getPresetId = (preset) => preset._id || preset.id;

  function movePreview(step) {
    if (!previewPreset || visiblePresets.length < 2) return;
    const currentIndex = visiblePresets.findIndex((preset) => getPresetId(preset) === getPresetId(previewPreset));
    const nextIndex = (currentIndex + step + visiblePresets.length) % visiblePresets.length;
    setPreviewPreset(visiblePresets[nextIndex]);
  }

  // --- preset.json import/export — kept compatible with the original
  // object-keyed format ( { "aa": {...}, "pah": {...} } ) so an old
  // preset.json exported from the HTML version can be dropped straight in.
  function exportPresetsJson() {
    const obj = {};
    presets.forEach((p) => {
      const { _id, name: n, module, createdAt, updatedAt, ...rest } = p;
      obj[n] = rest;
    });
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'preset.json';
    a.click();
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  function parsePresetJson(text) {
    const source = text.replace(/^\uFEFF/, '');
    let result = '';
    let inString = false;
    let escaped = false;

    for (const character of source) {
      if (inString && !escaped && character === '\n') {
        result += '\\n';
        continue;
      }
      if (inString && !escaped && character === '\r') {
        result += '\\r';
        continue;
      }
      result += character;
      if (character === '\\' && inString && !escaped) {
        escaped = true;
      } else {
        if (character === '"' && !escaped) inString = !inString;
        escaped = false;
      }
    }

    return JSON.parse(result);
  }

  async function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImportMsg(null);
    try {
      const text = await file.text();
      const parsed = parsePresetJson(text);
      // Accept both the old object-keyed shape and a plain array of presets.
      const entries = Array.isArray(parsed)
        ? parsed.map((p) => [p.name, p])
        : Object.entries(parsed);

      let imported = 0;
      const errors = [];
      for (const [presetName, data] of entries) {
        try {
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('preset verisi nesne olmalı');
          }
          const resolvedName = String(data.name || presetName || '').trim();
          if (!resolvedName) throw new Error('preset adı boş');
          const { name: _n, module: _m, _id, ...rest } = data;
          rest.imageDataUrl = rest.imageDataUrl || createDefaultPresetImage(resolvedName);
          const existing = presets.find((preset) => preset.name === resolvedName && (preset.module || 'kapak') === 'kapak');
          await savePreset(resolvedName, rest, existing?._id || existing?.id || null);
          imported++;
        } catch (err) {
          errors.push(`${presetName}: ${err.message}`);
        }
      }
      setImportMsg(
        errors.length
          ? `${imported} preset içe aktarıldı, ${errors.length} tanesi atlandı (muhtemelen aynı isim zaten var):\n${errors.join('\n')}`
          : `${imported} preset içe aktarıldı.`
      );
    } catch (err) {
      setImportMsg(`preset.json okunamadı: ${err.message}`);
    }
  }

  return (
    <div className="card">
      <h2>Presetler</h2>
      <div className="preset-category-tabs">
        <button type="button" className={`tab${category === 'kapak' ? ' active' : ''}`} onClick={() => setCategory('kapak')}>Kapak Modelleri</button>
        <button type="button" className={`tab${category === 'kapi' ? ' active' : ''}`} onClick={() => setCategory('kapi')}>Kapı Modelleri</button>
      </div>
      {loading && <div className="hint">Yükleniyor...</div>}
      {error && <div className="err" style={{ display: 'block' }}>{error} (sunucu çalışıyor mu?)</div>}
      <div className="preset-list">
        {visiblePresets.length === 0 && !loading && (
          <span className="hint">Bu kategoride preset yok. Ayarları yapıp model görseliyle kaydet.</span>
        )}
        {visiblePresets.map((p) => (
          <div key={getPresetId(p)} className={`preset-card${activeId === getPresetId(p) ? ' active' : ''}`} onClick={() => setPreviewPreset(p)}>
            <button type="button" className="preset-image-button" onClick={(event) => { event.stopPropagation(); setPreviewPreset(p); }}>
              <img src={p.imageDataUrl || createDefaultPresetImage(p.name)} alt={`${p.name} önizleme`} />
            </button>
            <div className="preset-card-info"><strong>{p.name}</strong><span>{p.category === 'kapi' ? 'Kapı' : 'Kapak'} · {p.rows?.length || 0} işlem</span><small>{(p.rows || []).filter((row) => row.operation === 'derz').length} derz / {(p.rows || []).filter((row) => row.operation === 'carving').length} carving / {(p.rows || []).filter((row) => !row.operation || row.operation === 'offset').length} offset</small><small className="dxf-badge">DXF kontrolü · {Number(p.previewWidth || 600).toFixed(0)} × {Number(p.previewHeight || 600).toFixed(0)} mm</small><button type="button" className="preset-select-button" onClick={(event) => { event.stopPropagation(); handleLoad(p); }}>Seç</button><button type="button" className="preset-dxf-button" onClick={(event) => { event.stopPropagation(); downloadDxf(p); }}>DXF indir</button></div>
            <span className="x" title="Bu kapağı sil" onClick={(event) => { event.stopPropagation(); handleDelete(getPresetId(p), p.name); }}>✕</span>
          </div>
        ))}
      </div>
      <div className="row2">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={activeId ? 'Düzenlenen kapağın adı' : 'Yeni kapak adı (örn: Model 1)'} />
        <button type="button" className="btn-secondary" onClick={handleSave}>{activeId ? 'Değişiklikleri Kaydet' : 'Yeni Kapak Kaydet'}</button>
        {activeId && <button type="button" className="btn-secondary" onClick={handleNew}>Yeni</button>}
      </div>
      <label>Model görseli</label>
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImage} />
      {imageDataUrl && <img className="preset-upload-preview" src={imageDataUrl} alt="Model önizleme" />}
      {imageDataUrl && <button type="button" className="btn-danger preset-remove-image" onClick={removeImage}>Görseli kaldır, varsayılanı kullan</button>}
      <label>Model açıklaması</label>
      <textarea className="preset-description-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Örn: Dıştan 53 mm offset, içte derzli kapak modeli." rows="3" />
      <label>DXF kontrol ölçüsü (mm)</label>
      <div className="row2"><input type="number" min="1" value={previewWidth} onChange={(e) => setPreviewWidth(e.target.value)} placeholder="Genişlik" /><input type="number" min="1" value={previewHeight} onChange={(e) => setPreviewHeight(e.target.value)} placeholder="Yükseklik" /></div>
      <div className="hint">Preset kartındaki DXF indir düğmesi bu ölçüyle nominal, offset ve derz katmanlarını dışa aktarır.</div>
      {saveError && <div className="err" style={{ display: 'block' }}>{saveError}</div>}

      <div className="row2" style={{ marginTop: 12 }}>
        <button type="button" className="btn-secondary" onClick={triggerImport}>preset.json Yükle</button>
        <button type="button" className="btn-secondary" onClick={exportPresetsJson} disabled={presets.length === 0}>preset.json İndir</button>
      </div>
      <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handleImportFile} />
      {importMsg && <div className="hint" style={{ whiteSpace: 'pre-line' }}>{importMsg}</div>}
      {previewPreset && (
        <div className="preset-preview-backdrop" onClick={() => setPreviewPreset(null)}>
          <div className="preset-preview-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title"><h2>{previewPreset.name}</h2><button type="button" className="modal-close" onClick={() => setPreviewPreset(null)}>✕</button></div>
            <div className="preset-preview-nav"><button type="button" className="btn-secondary" onClick={() => movePreview(-1)} disabled={visiblePresets.length < 2}>← Önceki</button><span>{visiblePresets.findIndex((preset) => getPresetId(preset) === getPresetId(previewPreset)) + 1} / {visiblePresets.length}</span><button type="button" className="btn-secondary" onClick={() => movePreview(1)} disabled={visiblePresets.length < 2}>Sonraki →</button></div>
            <img src={previewPreset.imageDataUrl || createDefaultPresetImage(previewPreset.name)} alt={`${previewPreset.name} büyük önizleme`} />
            <div className="preset-preview-details"><div className="measure-summary">{previewPreset.category === 'kapi' ? 'Kapı modeli' : 'Kapak modeli'} · Malzeme kalınlığı: {previewPreset.thickness ?? '-'} mm · DXF: {previewPreset.previewWidth || 600} × {previewPreset.previewHeight || 600} mm</div><p>{previewPreset.description || 'Bu model için açıklama eklenmemiş.'}</p><div className="preset-feature-list"><span>{previewPreset.rows?.length || 0} bıçak işlemi</span><span>{(previewPreset.rows || []).filter((row) => row.operation === 'derz').length} derz</span><span>{(previewPreset.rows || []).filter((row) => row.operation !== 'derz').length} offset</span><span>{previewPreset.rows?.map((row) => `T${row.toolNo}`).join(' · ') || 'Takım belirtilmemiş'}</span></div></div>
            <div className="preset-preview-actions">
              <button type="button" className="btn-secondary" onClick={() => downloadDxf(previewPreset)}>DXF indir</button>
              <button type="button" className="btn-secondary preset-preview-edit" onClick={() => { handleLoad(previewPreset); setPreviewPreset(null); }}>Düzenle</button>
              <button type="button" className="btn-accent2 preset-preview-select" onClick={() => { handleLoad(previewPreset); setPreviewPreset(null); }}>Seç</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
