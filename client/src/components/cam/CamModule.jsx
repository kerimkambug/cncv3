import { useState } from 'react';
import CamKesimPanel from './CamKesimPanel.jsx';
import CamTaramaPanel from './CamTaramaPanel.jsx';

export default function CamModule({ onBackToMenu }) {
  const [cfg, setCfg] = useState({
    width: 500, height: 1000, gozSayisi: 6, kolonSayisi: 2,
    disMargin: 60, icerGap: 20, oturmaPayi: 10,
    thickness: 18, spindleSpeed: 18000, toolDia: 6,
    kesimToolNo: '6', taramaToolNo: '6', taramaDepth: 9, stepover: 3,
    plungeFeed: 3000, cutFeed: 5000, safeZ: 61, homeZ: 96,
  });

  function set(field, value) {
    setCfg((c) => ({ ...c, [field]: value }));
  }
  function setNum(field, value) {
    set(field, parseFloat(value));
  }

  return (
    <div className="wrap app-screen active">
      <div className="topbar">
        <div>
          <h1>Empire CNC — Cam Modelleri (deneysel)</h1>
          <div className="sub">Göz ızgarası kesimi + Clipper.js tabanlı offset kenar taraması. Köşelerdeki dekoratif rozet/fileto şekli henüz taklit edilmiyor — köşeler şu an keskin (kare).</div>
        </div>
        {onBackToMenu && (
          <div className="top-actions">
            <button type="button" className="btn-secondary" onClick={onBackToMenu}>
              ← Ana Menü
            </button>
          </div>
        )}
      </div>

      <div className="grid">
        <div className="main-card">
          <div className="card">
            <h2>Ölçü ve Izgara</h2>
            <div className="row2">
              <div><label>Dış Genişlik X (mm)</label><input type="number" value={cfg.width} onChange={(e) => setNum('width', e.target.value)} /></div>
              <div><label>Dış Yükseklik Y (mm)</label><input type="number" value={cfg.height} onChange={(e) => setNum('height', e.target.value)} /></div>
            </div>
            <div className="row3">
              <div><label>Göz sayısı</label><input type="number" value={cfg.gozSayisi} onChange={(e) => setNum('gozSayisi', e.target.value)} /></div>
              <div><label>Sütun sayısı</label><input type="number" value={cfg.kolonSayisi} onChange={(e) => setNum('kolonSayisi', e.target.value)} /></div>
              <div><label>Dışarıdan (mm, nominal)</label><input type="number" value={cfg.disMargin} onChange={(e) => setNum('disMargin', e.target.value)} /></div>
            </div>
            <div className="row2">
              <div><label>İçeriden — çıtalar arası (mm, nominal)</label><input type="number" value={cfg.icerGap} onChange={(e) => setNum('icerGap', e.target.value)} /></div>
              <div><label>Oturma payı (mm)</label><input type="number" value={cfg.oturmaPayi} onChange={(e) => setNum('oturmaPayi', e.target.value)} /></div>
            </div>
            <div className="hint">Göz sayısı sütun sayısına tam bölünmeli. Dış kenarda tarama sınırı = Dışarıdan − Oturma payı; iç çıtalarda tarama, kesimle aynı nominal sınırı kullanır.</div>
          </div>

          <div className="card">
            <h2>Takım ve İşleme</h2>
            <div className="row3">
              <div><label>Malzeme kalınlığı (mm)</label><input type="number" value={cfg.thickness} onChange={(e) => setNum('thickness', e.target.value)} /></div>
              <div><label>Spindle S (RPM)</label><input type="number" value={cfg.spindleSpeed} onChange={(e) => setNum('spindleSpeed', e.target.value)} /></div>
              <div><label>Bıçak çapı (mm)</label><input type="number" value={cfg.toolDia} onChange={(e) => setNum('toolDia', e.target.value)} /></div>
            </div>
            <div className="row3">
              <div><label>Kesim Tool No</label><input type="text" value={cfg.kesimToolNo} onChange={(e) => set('kesimToolNo', e.target.value)} /></div>
              <div><label>Tarama Tool No</label><input type="text" value={cfg.taramaToolNo} onChange={(e) => set('taramaToolNo', e.target.value)} /></div>
              <div><label>Tarama finiş derinliği (mm)</label><input type="number" value={cfg.taramaDepth} onChange={(e) => setNum('taramaDepth', e.target.value)} /></div>
            </div>
            <div className="row3">
              <div><label>Tarama stepover (mm)</label><input type="number" value={cfg.stepover} onChange={(e) => setNum('stepover', e.target.value)} /></div>
              <div><label>Dalış feed</label><input type="number" value={cfg.plungeFeed} onChange={(e) => setNum('plungeFeed', e.target.value)} /></div>
              <div><label>Kesim feed</label><input type="number" value={cfg.cutFeed} onChange={(e) => setNum('cutFeed', e.target.value)} /></div>
            </div>
            <div className="row2">
              <div><label>Safe Z</label><input type="number" value={cfg.safeZ} onChange={(e) => setNum('safeZ', e.target.value)} /></div>
              <div><label>Home Z</label><input type="number" value={cfg.homeZ} onChange={(e) => setNum('homeZ', e.target.value)} /></div>
            </div>
          </div>
        </div>

        <div className="main-card">
          <CamKesimPanel cfg={cfg} />
          <CamTaramaPanel cfg={cfg} />
        </div>
      </div>
    </div>
  );
}
