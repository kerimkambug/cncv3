export default function MainMenu({ onSelectModule }) {
  return (
    <div className="menu-wrap">
      <div className="menu-card">
        <h1 className="menu-title">Empire CNC</h1>
        <div className="menu-sub">Devam etmek için bir modül seç.</div>

        <div className="menu-grid">
          <button
            type="button"
            className="module-btn"
            onClick={() => onSelectModule('kapak')}
          >
            <span className="module-icon">🚪</span>
            <span className="module-name">Kapak Modelleri</span>
            <span className="module-desc">Ölçü gir, parçaları nest et, plaka başına CNC dosyası üret.</span>
          </button>

          <button
            type="button"
            className="module-btn"
            onClick={() => onSelectModule('cam')}
          >
            <span className="module-icon">🪟</span>
            <span className="module-name">Cam Modelleri</span>
            <span className="module-desc">Göz ızgarası kesimi + kenar taraması (deneysel).</span>
          </button>

          <button
            type="button"
            className="module-btn"
            onClick={() => onSelectModule('panjur')}
          >
            <span className="module-icon">▤</span>
            <span className="module-name">Panjur Kapak</span>
            <span className="module-desc">Ölçü + offset gir, eğimli panjur taraması ve uç deliklerini otomatik üret.</span>
          </button>

          <button
            type="button"
            className="module-btn"
            onClick={() => onSelectModule('relief')}
          >
            <span className="module-icon">🗿</span>
            <span className="module-name">3D Rölyef</span>
            <span className="module-desc">Görsel yükle (PNG/JPG), derinlik haritasına çevirip 3D rölyef takım yolu üret.</span>
          </button>

          <button
            type="button"
            className="module-btn"
            onClick={() => onSelectModule('gcode-dxf')}
          >
            <span className="module-icon">📐</span>
            <span className="module-name">G-code → DXF</span>
            <span className="module-desc">Mevcut CNC takım yollarını okuyup katmanlı DXF dosyasına dönüştür.</span>
          </button>

        </div>
      </div>
    </div>
  );
}
