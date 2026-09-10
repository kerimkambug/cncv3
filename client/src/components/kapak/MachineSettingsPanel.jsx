export default function MachineSettingsPanel({ cfg, setCfg, plateCfg, setPlateCfg }) {
  function set(field, value) {
    setCfg({ ...cfg, [field]: parseFloat(value) });
  }

  function setPlate(field, value) {
    setPlateCfg({ ...plateCfg, [field]: parseFloat(value) });
  }

  const isAbsolute = cfg.offsetMode === 'absolute';
  function toggleOffsetMode() {
    setCfg({ ...cfg, offsetMode: isAbsolute ? 'relative' : 'absolute' });
  }

  return (
    <div className="card">
      <h2>Genel Ayarlar</h2>
      <div className="row2">
        <div>
          <label>Malzeme kalınlığı (mm)</label>
          <input type="number" step="0.1" value={cfg.thickness} onChange={(e) => set('thickness', e.target.value)} />
        </div>
        <div>
          <label>Spindle hızı S (RPM)</label>
          <input type="number" step="100" value={cfg.spindleSpeed} onChange={(e) => set('spindleSpeed', e.target.value)} />
        </div>
      </div>
      <div className="row3">
        <div>
          <label>Safe Z</label>
          <input type="number" step="0.1" value={cfg.safeZ} onChange={(e) => set('safeZ', e.target.value)} />
        </div>
        <div>
          <label>Tool-change Z</label>
          <input type="number" step="0.1" value={cfg.toolChangeZ} onChange={(e) => set('toolChangeZ', e.target.value)} />
        </div>
        <div>
          <label>Home Z</label>
          <input type="number" step="0.1" value={cfg.homeZ} onChange={(e) => set('homeZ', e.target.value)} />
        </div>
      </div>
      <div className="row2">
        <div>
          <label>Dalış feed</label>
          <input type="number" step="50" value={cfg.plungeFeed} onChange={(e) => set('plungeFeed', e.target.value)} />
        </div>
        <div>
          <label>Kesim feed</label>
          <input type="number" step="50" value={cfg.cutFeed} onChange={(e) => set('cutFeed', e.target.value)} />
        </div>
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 12 }}>Plaka Boyutları</h3>
      <div className="row2">
        <div>
          <label>Plaka Genişliği X (mm)</label>
          <input type="number" step="1" value={plateCfg.width} onChange={(e) => setPlate('width', e.target.value)} />
        </div>
        <div>
          <label>Plaka Yüksekliği Y (mm)</label>
          <input type="number" step="1" value={plateCfg.height} onChange={(e) => setPlate('height', e.target.value)} />
        </div>
      </div>

      <label style={{ marginTop: 14 }}>Offset Modu</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: isAbsolute ? 400 : 650, color: isAbsolute ? 'var(--muted)' : 'var(--accent)' }}>Kümülatif</span>
        <div
          onClick={toggleOffsetMode}
          role="switch"
          aria-checked={isAbsolute}
          style={{
            width: 40, height: 22, borderRadius: 12, cursor: 'pointer', position: 'relative',
            background: isAbsolute ? 'var(--accent)' : 'var(--panel2)', border: '1px solid var(--border)', transition: '.15s',
          }}
        >
          <div style={{
            width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2,
            left: isAbsolute ? 20 : 2, transition: '.15s',
          }} />
        </div>
        <span style={{ fontWeight: isAbsolute ? 650 : 400, color: isAbsolute ? 'var(--accent)' : 'var(--muted)' }}>Mutlak (dıştan)</span>
      </div>
      <div className="hint">
        {isAbsolute
          ? 'Sıra dıştan içe. Her satırın offseti, o satırın kendi değeridir — bir önceki satırdan bağımsız, doğrudan en dış kenardan ölçülür.'
          : 'Sıra dıştan içe. Adım offset değerleri kümülatif olarak toplanır (her satır bir öncekinin üstüne eklenir).'}
      </div>
    </div>
  );
}
