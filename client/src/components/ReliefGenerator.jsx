import { useState, useRef, useEffect, useCallback } from 'react';
import {
  DEFAULT_RELIEF_CONFIG,
  CNC_RELIEF_PRESETS,
  buildReliefGcodeFromDepthGrid,
  estimateReliefTime,
} from '../lib/gcode/relief.js';
import { buildDepthGridFromExternalMap } from '../lib/relief/basReliefEngine.js';
import { exportDepthGridToSTL } from '../lib/relief/stlExporter.js';
import Relief3DViewer from './Relief3DViewer.jsx';
import ReliefSliceViewer from './ReliefSliceViewer.jsx';

export default function ReliefGenerator({ onBackToMenu }) {
  const [imageMeta, setImageMeta] = useState(null);
  const [lockAspect, setLockAspect] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(1);
  const [activeTab, setActiveTab] = useState('3d'); // '3d' | '2d' | 'gcode'

  // Harici (dışarıda hazırlanmış) gri tonlamalı derinlik haritası doğrudan kullanılır.
  const [customDepthSrc, setCustomDepthSrc] = useState(null);

  // Configuration state
  const [cfg, setCfg] = useState({ ...DEFAULT_RELIEF_CONFIG });
  const [processedResult, setProcessedResult] = useState(null);
  const [output, setOutput] = useState('');
  const [stats, setStats] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [isGeneratingGcode, setIsGeneratingGcode] = useState(false);

  const customDepthInputRef = useRef(null);
  const sourceCanvasRef = useRef(null);
  const depthCanvasRef = useRef(null);

  function updateField(key, val) {
    setCfg((prev) => ({ ...prev, [key]: val }));
  }

  function handlePresetChange(presetKey) {
    const p = CNC_RELIEF_PRESETS[presetKey];
    if (p) {
      setCfg((prev) => ({
        ...prev,
        preset: presetKey,
        detailBoost: p.detailBoost,
        smoothRadius: p.smoothRadius,
        edgeCrispness: p.edgeCrispness,
        taubinSmooth: p.taubinSmooth,
        highlightDamp: p.highlightDamp,
        curve: p.curve,
        contrast: p.contrast,
        backgroundMode: p.backgroundMode,
      }));
    }
  }

  function handleWidthChange(newW) {
    const w = parseFloat(newW) || 0;
    if (lockAspect && aspectRatio > 0) {
      const h = +(w / aspectRatio).toFixed(1);
      setCfg((prev) => ({ ...prev, width: w, height: h }));
    } else {
      setCfg((prev) => ({ ...prev, width: w }));
    }
  }

  function handleHeightChange(newH) {
    const h = parseFloat(newH) || 0;
    if (lockAspect && aspectRatio > 0) {
      const w = +(h * aspectRatio).toFixed(1);
      setCfg((prev) => ({ ...prev, width: w, height: h }));
    } else {
      setCfg((prev) => ({ ...prev, height: h }));
    }
  }

  function handleThicknessChange(newT) {
    const t = Math.max(1, parseFloat(newT) || 18);
    // Taban güvenliği için ince bir taşıyıcı pay bırak; kalan kalınlığı relief kullanır.
    const idealMaxDepth = +(Math.max(0.5, t <= 4 ? t * 0.88 : t - Math.max(1, t * 0.08))).toFixed(1);
    setCfg((prev) => ({
      ...prev,
      thickness: t,
      maxDepth: idealMaxDepth,
    }));
  }

  // Process custom (externally prepared) depth map file
  const handleCustomDepthFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) {
      setStatusMsg({ type: 'err', text: 'Lütfen geçerli bir görsel (PNG, JPG, WEBP) dosyası yükleyin.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target.result;
      setCustomDepthSrc(src);

      // Boyut/oran bilgisini yüklenen derinlik haritasından al.
      const img = new Image();
      img.onload = () => {
        setImageMeta({ width: img.width, height: img.height, name: file.name });
        setAspectRatio(img.width / img.height);
        const baseW = 200;
        const baseH = +(baseW / (img.width / img.height)).toFixed(1);
        setCfg((prev) => ({ ...prev, width: baseW, height: baseH }));
        setStatusMsg({ type: 'ok', text: `Harici derinlik haritası yüklendi: ${file.name} (${img.width}×${img.height}px)` });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }, []);

  // Generate CNC G-Code (stable reference for useCallback consumers)
  const generateGcode = useCallback(() => {
    if (!processedResult || !processedResult.depthGrid) {
      setStatusMsg({ type: 'err', text: 'Lütfen önce geçerli bir görsel ve derinlik haritası oluşturun.' });
      return;
    }

    setIsGeneratingGcode(true);
    setStatusMsg(null);

    try {
      const result = buildReliefGcodeFromDepthGrid(
        processedResult.depthGrid,
        processedResult.width,
        processedResult.height,
        cfg
      );

      const estMinutes = estimateReliefTime(result, cfg);

      setOutput(result.gcode);
      setStats({
        lines: result.lineCount,
        points: result.pointCount,
        estMinutes: estMinutes.toFixed(1),
        size: `${cfg.width} × ${cfg.height} mm`,
        depth: `${cfg.maxDepth} mm`,
        tool: cfg.toolType === 'ballnose' ? `Küre Uç Ø${cfg.toolDia}mm` : `Düz Ø${cfg.toolDia}mm`,
      });
      setActiveTab('gcode');
      setStatusMsg({
        type: 'ok',
        text: `G-code başarıyla üretildi! (~${estMinutes.toFixed(1)} dk işlem süresi, ${result.pointCount} işleme noktası)`,
      });
    } catch (err) {
      setStatusMsg({ type: 'err', text: `Hata: ${err.message}` });
    } finally {
      setIsGeneratingGcode(false);
    }
  }, [processedResult, cfg]);

  // Harici derinlik haritasını (girdiler/ayarlar değiştikçe) doğrudan depth grid'e
  // dönüştür. Sentez/AI yoktur: gri tonlama doğrudan yükseklik olarak okunur.
  useEffect(() => {
    const sourceSrc = customDepthSrc;
    if (!sourceSrc) return;
    let isCancelled = false;
    const img = new Image();
    img.onload = () => {
      if (isCancelled) return;
      const sampleW = Math.min(4096, img.width || 512);
      const sampleH = Math.max(1, Math.round(sampleW / ((img.width || 1) / (img.height || 1))));
      const offCanvas = document.createElement('canvas');
      offCanvas.width = sampleW;
      offCanvas.height = sampleH;
      const sCtx = offCanvas.getContext('2d');
      if (!sCtx) return;
      sCtx.drawImage(img, 0, 0, sampleW, sampleH);
      const imgData = sCtx.getImageData(0, 0, sampleW, sampleH);
      const res = buildDepthGridFromExternalMap(imgData, {
        invert: Boolean(cfg.invert),
        smoothRadius: Number(cfg.smoothRadius),
        backgroundMode: cfg.backgroundMode,
        bgThreshold: Number(cfg.externalBgThreshold ?? 18),
      });
      if (!isCancelled) {
        setProcessedResult(res);
        setStatusMsg({ type: 'ok', text: '✅ Derinlik haritası hazır. 3D önizlemeyi inceleyebilir ve G-Code üretebilirsiniz.' });
      }
    };
    img.src = sourceSrc;
    return () => { isCancelled = true; };
  }, [
    customDepthSrc,
    cfg.smoothRadius,
    cfg.invert,
    cfg.backgroundMode,
    cfg.externalBgThreshold,
  ]);

  // Update 2D Preview Canvases when on 2D tab or when processedResult updates
  useEffect(() => {
    if (activeTab !== '2d') return;
    const sCanvas = sourceCanvasRef.current;
    const dCanvas = depthCanvasRef.current;
    if (!sCanvas || !dCanvas || !processedResult) return;

    const { width: w, height: h, depthGrid } = processedResult;
    sCanvas.width = w;
    sCanvas.height = h;
    dCanvas.width = w;
    dCanvas.height = h;

    const src = customDepthSrc;
    if (src) {
      const srcImg = new Image();
      srcImg.onload = () => {
        const sCtx = sCanvas.getContext('2d');
        if (sCtx) {
          sCtx.clearRect(0, 0, w, h);
          sCtx.drawImage(srcImg, 0, 0, w, h);
        }
      };
      srcImg.src = src;
    }

    const dCtx = dCanvas.getContext('2d');
    if (dCtx && depthGrid) {
      const depthImgData = dCtx.createImageData(w, h);
      for (let i = 0; i < depthGrid.length; i++) {
        const d = depthGrid[i];
        const shade = Math.max(0, Math.min(255, Math.round(d * 255)));
        // Saf Gri Tonlama (Grayscale): 0 = Siyah (En Alt / Taban), 255 = Beyaz (En Üst / Yüzey)
        depthImgData.data[i * 4] = shade;
        depthImgData.data[i * 4 + 1] = shade;
        depthImgData.data[i * 4 + 2] = shade;
        depthImgData.data[i * 4 + 3] = 255;
      }
      dCtx.putImageData(depthImgData, 0, 0);
    }
  }, [activeTab, processedResult, customDepthSrc]);

  // Export 3D STL File
  function handleDownloadSTL() {
    if (!processedResult || !processedResult.depthGrid) return;
    const blob = exportDepthGridToSTL(
      processedResult.depthGrid,
      processedResult.width,
      processedResult.height,
      cfg.width,
      cfg.height,
      Math.min(Number(cfg.maxDepth) || 1, Math.max(0.5, Number(cfg.thickness) * 0.92)),
      Math.max(0.5, Number(cfg.thickness) - (Math.min(Number(cfg.maxDepth) || 1, Math.max(0.5, Number(cfg.thickness) * 0.92)))),
      { targetResolution: Math.min(4096, Math.max(1024, Number(cfg.stlQuality) || 4096)) }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (imageMeta?.name ? imageMeta.name.replace(/\.[^/.]+$/, '') : 'relief') + '_3D.stl';
    a.href = url;
    a.download = safeName;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg({ type: 'ok', text: `3D STL modeli (${cfg.stlQuality || 1024}px CAD kalitesi) indirildi: ${safeName}` });
  }

  // Download Depth Map PNG
  function handleDownloadDepthMap() {
    if (!processedResult || !processedResult.depthGrid) return;
    const { width: w, height: h, depthGrid } = processedResult;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    const ctx = offCanvas.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < depthGrid.length; i++) {
      const d = depthGrid[i];
      const shade = Math.max(0, Math.min(255, Math.round(d * 255)));
      imgData.data[i * 4] = shade;
      imgData.data[i * 4 + 1] = shade;
      imgData.data[i * 4 + 2] = shade;
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    const a = document.createElement('a');
    a.href = offCanvas.toDataURL('image/png');
    a.download = (imageMeta?.name ? imageMeta.name.replace(/\.[^/.]+$/, '') : 'relief') + '_depthmap.png';
    a.click();
    setStatusMsg({ type: 'ok', text: `Derinlik haritası (PNG) indirildi.` });
  }

  // Download .nc file
  function handleDownloadGcode() {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (imageMeta?.name ? imageMeta.name.replace(/\.[^/.]+$/, '') : 'relief') + '_empire.nc';
    a.href = url;
    a.download = safeName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="wrap app-screen active">
      <div className="topbar">
        <div>
          <h1>Empire CNC — Harici Derinlik Haritasından 3D Bas-Rölyef & G-Code Üretici</h1>
          <div className="sub">
            Harici Derinlik Haritası, Küre Uçlu Takım Telafisi ve Gerçekçi 3D Simülasyon.
          </div>
        </div>
        <div className="top-actions">
          {onBackToMenu && (
            <button type="button" className="btn-secondary" onClick={onBackToMenu}>
              ← Ana Menü
            </button>
          )}
        </div>
      </div>

      <div className="main-card">
        <div className="grid">
          {/* 1. Harici Derinlik Haritası Kartı */}
          <div className="card">
            <h2>1. Harici Derinlik Haritası Yükle</h2>

            <div className="ai-engine-box">
              <div className="ai-engine-info">
                <b>📥 Harici Derinlik Haritası</b>
                <p>
                  Dışarıda (ör. SculptOK gibi bir araçla) hazırlanmış gri tonlamalı depth map yükleyin —
                  beyaz = yüzey/en yüksek, siyah = taban/en derin. Gri tonlama doğrudan yükseklik olarak
                  okunur; foto-detay sentezi / AI hesaplaması uygulanmaz. Siyah fonlu haritalarda koyu fon
                  varsayılan olarak düz tabana alınır.
                </p>
              </div>

              <input
                ref={customDepthInputRef}
                type="file"
                accept="image/png, image/jpeg, image/webp, image/bmp"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && handleCustomDepthFile(e.target.files[0])}
              />
              <button
                type="button"
                className="btn-accent2"
                onClick={() => customDepthInputRef.current?.click()}
              >
                {customDepthSrc ? '🔁 Derinlik Haritasını Değiştir' : '📥 Derinlik Haritası Yükle'}
              </button>

              {customDepthSrc && (
                <div className="ai-ready-badge" style={{ marginTop: 10 }}>
                  ✅ <b>Harici Derinlik Haritası Yüklendi</b>
                </div>
              )}

              <div className="row2" style={{ marginTop: 12 }}>
                <div>
                  <label htmlFor="customBackgroundMode">Arka Plan İşleme</label>
                  <select
                    id="customBackgroundMode"
                    value={cfg.backgroundMode || 'natural'}
                    onChange={(e) => updateField('backgroundMode', e.target.value)}
                  >
                    <option value="natural">İşleme yok (Natural)</option>
                    <option value="flat">Koyu fonu düz tabana al</option>
                    <option value="zero">Koyu fonu sıfırla</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="customBgThreshold">Koyu Fon Eşiği (0-255)</label>
                  <input
                    id="customBgThreshold"
                    type="number"
                    min="0"
                    max="255"
                    step="1"
                    value={cfg.externalBgThreshold ?? 18}
                    onChange={(e) => updateField('externalBgThreshold', Math.max(0, Math.min(255, Number(e.target.value) || 0)))}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 2. Otomatik CNC Yüzey & Kalite Motoru */}
          <div className="card">
            <h2>2. Otomatik CNC Yüzey & Kalite Motoru</h2>

            <div className="cnc-auto-box">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>🛡️</span>
                <div>
                  <b style={{ color: '#38bdf8', fontSize: 13.5 }}>Otomatik Pürüzsüzleştirme & STL Kalibrasyonu Aktif</b>
                  <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                    Ahşap/MDF lifleri ve küre uçlu (ballnose) CNC frezeler için pütür ve basamaklanma (terracing) önleyici filtreler uygulandı.
                  </div>
                </div>
              </div>

              <div>
                <label><b>İşlenecek Malzeme & Rölyef Profili:</b></label>
                <select
                  value={cfg.preset || 'wood_mdf'}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  style={{ marginTop: 4, width: '100%' }}
                >
                  {Object.entries(CNC_RELIEF_PRESETS).map(([key, item]) => (
                    <option key={key} value={key}>{item.name}</option>
                  ))}
                </select>
                <small style={{ color: '#64748b', display: 'block', marginTop: 4, fontSize: 11 }}>
                  {CNC_RELIEF_PRESETS[cfg.preset || 'wood_mdf']?.desc}
                </small>
              </div>

              <div className="cnc-spec-grid" style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="spec-badge">
                  <span className="spec-icon">✨</span>
                  <div>
                    <small>Yüzey Kalitesi</small>
                    <b>Pürüzsüz & Tırtıksız</b>
                  </div>
                </div>
                <div className="spec-badge">
                  <span className="spec-icon">🎯</span>
                  <div>
                    <small>Zemin İzolasyonu</small>
                    <b>%100 Temiz Sıfır Taban</b>
                  </div>
                </div>
                <div className="spec-badge">
                  <span className="spec-icon">📐</span>
                  <div>
                    <small>Ton Dağılımı</small>
                    <b>Doğrusal (Linear / Soft)</b>
                  </div>
                </div>
                <div className="spec-badge">
                  <span className="spec-icon">📦</span>
                  <div>
                    <small>STL Mesh</small>
                    <b>Watertight Manifold</b>
                  </div>
                </div>
              </div>

              <div className="row2" style={{ marginTop: 14 }}>
                <div>
                  <label>STL Mesh Çözünürlüğü</label>
                  <select
                    value={cfg.stlQuality ?? 1024}
                    onChange={(e) => updateField('stlQuality', parseInt(e.target.value, 10))}
                  >
                    <option value={512}>512 × 512 (Hızlı Önizleme)</option>
                    <option value={1024}>1024 × 1024 (Yüksek Kalite CAD — Önerilen)</option>
                    <option value={1536}>1536 × 1536 (Ultra Mikron Hassas)</option>
                    <option value={2048}>2048 × 2048 (Pro Sınıfı CAD — En Yüksek Detay)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
                  <div className="checkbox-row" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      id="invertCheck"
                      checked={cfg.invert}
                      onChange={(e) => updateField('invert', e.target.checked)}
                    />
                    <label htmlFor="invertCheck" style={{ margin: 0, cursor: 'pointer', fontSize: 13 }}>
                      Derinliği Ters Çevir (Invert)
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Boyut & CNC Takım Parametreleri */}
          <div className="card">
            <h2>3. Boyut ve CNC Takım Parametreleri</h2>

            <div className="row2">
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>Genişlik X (mm)</label>
                  <button
                    type="button"
                    className="btn-small btn-secondary"
                    onClick={() => setLockAspect((v) => !v)}
                    style={{ fontSize: 10, padding: '2px 6px', marginTop: 8 }}
                  >
                    {lockAspect ? '🔒 Oran Kilitli' : '🔓 Serbest'}
                  </button>
                </div>
                <input
                  type="number"
                  step="0.5"
                  value={cfg.width}
                  onChange={(e) => handleWidthChange(e.target.value)}
                />
              </div>

              <div>
                <label>Yükseklik Y (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  value={cfg.height}
                  onChange={(e) => handleHeightChange(e.target.value)}
                />
              </div>
            </div>

            <div className="row3" style={{ marginTop: 12 }}>
              <div>
                <label>Malzeme Kalınlığı (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  value={cfg.thickness}
                  onChange={(e) => handleThicknessChange(e.target.value)}
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>Maks. Rölyef Derinliği (mm)</label>
                  <span style={{ fontSize: 10, color: '#38bdf8' }}>
                    %{Math.round(((cfg.maxDepth || 1) / (cfg.thickness || 1)) * 100)} Kullanım
                  </span>
                </div>
                <input
                  type="number"
                  step="0.1"
                  value={cfg.maxDepth}
                  onChange={(e) => updateField('maxDepth', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label>Raster Adımı (Stepover, mm)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  value={cfg.stepover}
                  onChange={(e) => updateField('stepover', parseFloat(e.target.value) || 0.6)}
                />
              </div>
            </div>

            <div className="row3" style={{ marginTop: 12 }}>
              <div>
                <label>Takım Tipi (Freze)</label>
                <select
                  value={cfg.toolType}
                  onChange={(e) => updateField('toolType', e.target.value)}
                >
                  <option value="ballnose">Küre Uç (Ballnose) — Önerilen</option>
                  <option value="flat">Düz Freze (Flat Endmill)</option>
                </select>
              </div>

              <div>
                <label>Bıçak Çapı (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  value={cfg.toolDia}
                  onChange={(e) => updateField('toolDia', parseFloat(e.target.value) || 4)}
                />
              </div>

              <div>
                <label>Takım No (M6T...)</label>
                <input
                  type="text"
                  value={cfg.toolNo}
                  onChange={(e) => updateField('toolNo', e.target.value)}
                />
              </div>
            </div>

            <div className="row3" style={{ marginTop: 12 }}>
              <div>
                <label>Tarama Yönü</label>
                <select
                  value={cfg.direction}
                  onChange={(e) => updateField('direction', e.target.value)}
                >
                  <option value="x">X Ekseni (Yatay Zig-Zag)</option>
                  <option value="y">Y Ekseni (Dikey Zig-Zag)</option>
                  <option value="cross">Çift Pasolu Çapraz (Cross-Hatch)</option>
                </select>
              </div>

              <div>
                <label>Kesim Hızı (mm/dk)</label>
                <input
                  type="number"
                  step="100"
                  value={cfg.cutFeed}
                  onChange={(e) => updateField('cutFeed', parseFloat(e.target.value) || 4000)}
                />
              </div>

              <div>
                <label>Dalma Hızı (mm/dk)</label>
                <input
                  type="number"
                  step="100"
                  value={cfg.plungeFeed}
                  onChange={(e) => updateField('plungeFeed', parseFloat(e.target.value) || 1200)}
                />
              </div>
            </div>

            <div className="checkbox-row" style={{ marginTop: 14 }}>
              <input
                type="checkbox"
                id="outerCutCheck"
                checked={cfg.enableOuterCut}
                onChange={(e) => updateField('enableOuterCut', e.target.checked)}
              />
              <label htmlFor="outerCutCheck" style={{ margin: 0, cursor: 'pointer' }}>
                Rölyef bitiminde dış çevre konturunu kes (Ebatlama / Profil Kesimi)
              </label>
            </div>

            <div className="action-buttons-group" style={{ marginTop: 20 }}>
              <button
                type="button"
                className="btn-accent2"
                disabled={isGeneratingGcode || !processedResult}
                onClick={generateGcode}
              >
                {isGeneratingGcode ? 'G-Code Hesaplanıyor...' : '⚡ Kusursuz Rölyef G-Code Üret'}
              </button>

              <button
                type="button"
                className="btn-secondary"
                disabled={!processedResult}
                onClick={handleDownloadSTL}
              >
                📦 3D STL Modeli İndir
              </button>

              <button
                type="button"
                className="btn-secondary"
                disabled={!processedResult}
                onClick={handleDownloadDepthMap}
              >
                🖼️ Derinlik Haritası (PNG) İndir
              </button>
            </div>

            {statusMsg && (
              <div className={statusMsg.type === 'err' ? 'err' : 'ok'} style={{ display: 'block', marginTop: 12 }}>
                {statusMsg.text}
              </div>
            )}
          </div>

          {/* 4. Görselleştirme & Önizleme Kartı */}
          <div className="card relief-workspace-card">
            <div className="relief-workspace-heading">
              <div>
                <span className="eyebrow">ÖNİZLEME ALANI</span>
                <h2>Rölyef kontrol merkezi</h2>
              </div>
              {processedResult && <span className="workspace-status">Hazır</span>}
            </div>
            <div className="view-tabs">
              <button
                type="button"
                className={`view-tab ${activeTab === '3d' ? 'active' : ''}`}
                onClick={() => setActiveTab('3d')}
              >
                🌐 3D İnteraktif Simülasyon (Three.js)
              </button>
              <button
                type="button"
                className={`view-tab ${activeTab === '2d' ? 'active' : ''}`}
                onClick={() => setActiveTab('2d')}
              >
                🖼️ 2D Görsel & Derinlik Haritası
              </button>
              {output && (
                <button
                  type="button"
                  className={`view-tab ${activeTab === 'gcode' ? 'active' : ''}`}
                  onClick={() => setActiveTab('gcode')}
                >
                  📜 G-Code Çıktısı
                </button>
              )}
            </div>

            {/* TAB: 3D SIMULATION */}
            {activeTab === '3d' && (
              <div>
                {processedResult && processedResult.depthGrid ? (
                  <Relief3DViewer
                    depthGrid={processedResult.depthGrid}
                    gridCols={processedResult.width}
                    gridRows={processedResult.height}
                    realWidth={cfg.width}
                    realHeight={cfg.height}
                    maxDepth={cfg.maxDepth}
                  />
                ) : (
                  <div className="empty-preview-box">
                    <span>🖼️ Lütfen önce bir derinlik haritası yükleyin</span>
                  </div>
                )}

                {processedResult && processedResult.depthGrid && (
                  <div style={{ marginTop: 14 }}>
                    <ReliefSliceViewer
                      depthGrid={processedResult.depthGrid}
                      gridCols={processedResult.width}
                      gridRows={processedResult.height}
                      realWidth={cfg.width}
                      realHeight={cfg.height}
                      maxDepth={cfg.maxDepth}
                      thickness={cfg.thickness}
                    />
                  </div>
                )}
              </div>
            )}

            {/* TAB: 2D CANVASES */}
            {activeTab === '2d' && (
              <div>
                <div className="relief-preview-row">
                  <div className="preview-box">
                    <div className="preview-title">Yüklenen Derinlik Haritası</div>
                    <canvas ref={sourceCanvasRef} className="preview-canvas" />
                  </div>
                  <div className="preview-box">
                    <div className="preview-title">İşlenmiş Bas-Rölyef Derinlik Haritası</div>
                    <canvas ref={depthCanvasRef} className="preview-canvas" />
                  </div>
                </div>

                {processedResult && processedResult.depthGrid && (
                  <div style={{ marginTop: 14 }}>
                    <ReliefSliceViewer
                      depthGrid={processedResult.depthGrid}
                      gridCols={processedResult.width}
                      gridRows={processedResult.height}
                      realWidth={cfg.width}
                      realHeight={cfg.height}
                      maxDepth={cfg.maxDepth}
                      thickness={cfg.thickness}
                    />
                  </div>
                )}
              </div>
            )}

            {/* TAB: G-CODE OUTPUT */}
            {activeTab === 'gcode' && output && (
              <div>
                {stats && (
                  <div className="nesting-stats" style={{ marginBottom: 14 }}>
                    <div className="stat">
                      <b>{stats.size}</b>
                      <span>İşleme Alanı</span>
                    </div>
                    <div className="stat">
                      <b>{stats.depth}</b>
                      <span>Derinlik</span>
                    </div>
                    <div className="stat">
                      <b>{stats.tool}</b>
                      <span>Takım Geometrisi</span>
                    </div>
                    <div className="stat">
                      <b>{stats.points}</b>
                      <span>Takım Yolu Noktası</span>
                    </div>
                    <div className="stat">
                      <b>~{stats.estMinutes} dk</b>
                      <span>Tahmini Süre</span>
                    </div>
                  </div>
                )}

                <textarea
                  value={output}
                  readOnly
                  spellCheck={false}
                  style={{ height: 260 }}
                />

                <div className="out-actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(output);
                      setStatusMsg({ type: 'ok', text: 'G-code panoya kopyalandı!' });
                    }}
                  >
                    📋 Kopyala
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleDownloadGcode}
                    style={{ marginTop: 0 }}
                  >
                    💾 G-Code İndir (.nc)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
