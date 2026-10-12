import { useState } from 'react';
import { DEFAULT_MACHINE_CONFIG, DEFAULT_PLATE_CONFIG } from '../../lib/gcode/common.js';
import { handleAuthError } from '../../hooks/useAuth.js';
import { ScopeBar } from './ToolMagazinePanel.jsx';
import { KULP_DEFAULTS } from '../../lib/gcode/kulp.js';

// The values this panel sets (a chosen model may bring its own over them)
const MACHINE_FIELDS = [
  'thickness', 'spindleSpeed', 'safeZ', 'toolChangeZ', 'homeZ', 'plungeFeed', 'cutFeed',
  'offsetMode', 'topStyle', 'riseRatio', 'narrowAdapt', 'narrowMinPanel', 'narrowMinFirst', 'kulp',
];
const pick = (o) => Object.fromEntries(MACHINE_FIELDS.filter((f) => o[f] !== undefined).map((f) => [f, o[f]]));

/**
 * Atölye → Makine. Each user's values stay in their browser; the admin can make
 * the current values everyone's default, and anyone can go back to it.
 */
function DefaultsBar({ cfg, setCfg, plateCfg, setPlateCfg, isAdmin }) {
  const [msg, setMsg] = useState(null);
  async function saveAsDefault() {
    if (!window.confirm('Bu makine ve plaka değerleri herkesin varsayılanı olsun mu?')) return;
    try {
      const res = await fetch('/api/machine', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ machine: pick(cfg), plate: plateCfg }),
      });
      if (handleAuthError(res)) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg('✓ Varsayılan olarak kaydedildi.');
    } catch (err) {
      setMsg(`Kaydedilemedi: ${err.message}`);
    }
  }
  async function backToDefault() {
    if (!window.confirm('Makine ve plaka değerleri varsayılana dönsün mü?')) return;
    try {
      const res = await fetch('/api/machine', { credentials: 'same-origin' });
      if (handleAuthError(res)) return;
      const data = res.ok ? await res.json() : null;
      const v = data?.value;
      setCfg({ ...cfg, ...pick(DEFAULT_MACHINE_CONFIG), ...(v?.machine ? pick(v.machine) : {}) });
      setPlateCfg({ ...DEFAULT_PLATE_CONFIG, ...(v?.plate || {}) });
      setMsg(v ? '✓ Yöneticinin varsayılan değerleri yüklendi.' : '✓ Henüz yönetici varsayılanı yok; başlangıç değerleri yüklendi.');
    } catch (err) {
      setMsg(`Varsayılan alınamadı: ${err.message}`);
    }
  }
  return (
    <>
      {isAdmin
        ? <ScopeBar isAdmin what="Makine ayarları" />
        : <div className="scope-bar"><span><b>Makine ayarları:</b> değerleriniz bu tarayıcıda saklanır ve yalnız sizde geçerlidir.</span></div>}
      <div className="row2" style={{ marginBottom: 6 }}>
        {isAdmin && <button type="button" className="btn-secondary" onClick={saveAsDefault}>Bu değerleri varsayılan yap</button>}
        <button type="button" className="btn-secondary" onClick={backToDefault}>↺ Varsayılana dön</button>
      </div>
      {msg && <div className="hint">{msg}</div>}
    </>
  );
}

export default function MachineSettingsPanel({ cfg, setCfg, plateCfg, setPlateCfg, isAdmin = true }) {
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

  const topStyle = cfg.topStyle || 'flat';
  function setTopStyle(style) {
    setCfg({ ...cfg, topStyle: style });
  }

  return (
    <div className="card">
      <h2>Genel Ayarlar</h2>
      <DefaultsBar cfg={cfg} setCfg={setCfg} plateCfg={plateCfg} setPlateCfg={setPlateCfg} isAdmin={isAdmin} />
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

      <label style={{ marginTop: 14 }}>Üst Kenar Şekli</label>
      <select value={topStyle} onChange={(e) => setTopStyle(e.target.value)}>
        <option value="flat">Düz (dikdörtgen)</option>
        <option value="semicircle">Yarım daire (tam kemer)</option>
        <option value="pointed">Sivri / basık kemer</option>
      </select>
      {topStyle === 'pointed' && (
        <div style={{ marginTop: 8 }}>
          <label>Kemer yükseklik oranı (iç genişliğe göre)</label>
          <input
            type="number"
            step="0.001"
            min="0.001"
            value={cfg.riseRatio ?? 0.125}
            onChange={(e) => set('riseRatio', e.target.value)}
          />
          <div className="hint">Varsayılan 0.125 (1/8). Kemer yüksekliği = iç genişlik × oran.</div>
        </div>
      )}
      <div className="hint">
        {topStyle === 'flat'
          ? 'Üst kenar düz çıkar (klasik dikdörtgen).'
          : 'Üst kenar eğri çıkar; dikey derz çizgileri ve profil bıçaklarının üst ucu eğriyi takip eder.'}
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 8 }}>Dar Kapak</h3>
      <label className="check-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={cfg.narrowAdapt !== false}
          onChange={(e) => setCfg({ ...cfg, narrowAdapt: e.target.checked })}
        />
        <span>Dar kenarda çerçeveyi daralt (mutlak modda)</span>
      </label>
      {cfg.narrowAdapt !== false && (
        <div className="row2" style={{ marginTop: 8 }}>
          <div>
            <label>En az iç panel (mm)</label>
            <input type="number" step="1" min="0" value={cfg.narrowMinPanel ?? 60} onChange={(e) => set('narrowMinPanel', e.target.value)} />
          </div>
          <div>
            <label>En az ilk offset (mm)</label>
            <input type="number" step="1" min="0" value={cfg.narrowMinFirst ?? 30} onChange={(e) => set('narrowMinFirst', e.target.value)} />
          </div>
        </div>
      )}
      <div className="hint">
        Dar kenarda orta panel bu değerin altında kalırsa çerçeveler kenara doğru kaydırılır; aralarındaki mesafeler korunur.
        Sığmayan çerçeveler çıkarılır ve kalan alanın içi taranır.
      </div>

      <KulpSettings cfg={cfg} setCfg={setCfg} />
    </div>
  );
}

/** Kulp (gizli kulp) cutting settings; where a door gets a kulp is chosen per door. */
function KulpSettings({ cfg, setCfg }) {
  const k = { ...KULP_DEFAULTS, ...(cfg.kulp || {}) };
  const set = (field, value) => setCfg({ ...cfg, kulp: { ...k, [field]: value } });
  const num = (field, label, step = 1) => (
    <div>
      <label>{label}</label>
      <input type="number" step={step} value={k[field]} onChange={(e) => set(field, e.target.value)} />
    </div>
  );
  return (
    <>
      <h3 style={{ marginTop: 20, marginBottom: 8 }}>Kulp</h3>
      <div className="row3">
        <div>
          <label>Kulp bıçağı (T)</label>
          <input type="text" value={k.toolNo} onChange={(e) => set('toolNo', e.target.value)} />
        </div>
        {num('spindle', 'Devir S', 100)}
        {num('z', 'Bıçak ucu yüksekliği Z (mm)', 0.1)}
      </div>
      <div className="row3">
        <div>
          <label title="Her paso için bıçak merkezinin kapak kenarına uzaklığı: + kapağın içine, − dışına. Örn. “-1, 7”: önce kenarın 1 mm dışından, sonra 7 mm içinden.">Pasolar (mm, + içeri)</label>
          <input type="text" value={k.passes} onChange={(e) => set('passes', e.target.value)} />
        </div>
        {num('approach', 'Dışarıda iniş mesafesi (mm)')}
        {num('dia', 'Bıçak çapı (mm)', 0.5)}
      </div>
      <div className="row2">
        {num('plungeFeed', 'İniş feed', 50)}
        {num('cutFeed', 'Kesim feed', 50)}
      </div>
      <div className="hint">
        Kulp bıçağı malzemeye dalamaz: kapağın dışında, boşlukta bu Z'ye iner, kenara yandan girer, pasolarla derinleşir,
        dışarı çıkıp kalkar. Bıçak çapı Atölye → Bıçaklar'da bu yuvadaki bıçaktan alınır; orada yoksa buradaki değer kullanılır.
        Kulpun hangi kapağın hangi kenarında olacağı kapak ölçüsünü girdiğiniz yerde seçilir.
      </div>
    </>
  );
}
