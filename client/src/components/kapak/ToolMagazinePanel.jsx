import { Fragment, useRef, useState } from 'react';
import { resetMagazine, useToolMagazine } from '../../hooks/useToolMagazine.js';
import { profileFromDxf } from '../../lib/sim/toolProfile.js';
import { profile } from '../../lib/sim/millSim.js';
import {
  FIELD_LABELS, TOOL_TYPES, defaultMagazine, loadTool, newToolId, normalizeMagazine, simShape, toolProblem,
} from '../../lib/sim/toolMagazine.js';

/**
 * Atölye → Bıçaklar: the workshop's tool library (every tool owned, with its
 * shape and size) and the magazine (which tool sits in T1…T12 right now).
 * The simulation cuts with whatever is loaded here. The admin's list is the
 * workshop default; another user's changes make their own copy.
 */
export default function ToolMagazinePanel({ isAdmin = true }) {
  const [mag, setMag, sync] = useToolMagazine();
  const [msg, setMsg] = useState(null);
  const [libMsg, setLibMsg] = useState(null);
  const fileRef = useRef(null);
  const dxfRef = useRef(null);
  const dxfFor = useRef(null);
  const slotOf = (id) => Object.keys(mag.slots).find((k) => mag.slots[k] === id);

  function setSlot(n, id) {
    const from = id && slotOf(id);
    setMag((m) => loadTool(m, n, id));
    setMsg(from && Number(from) !== n ? `Bıçak T${from} yuvasından T${n} yuvasına alındı; T${from} artık boş.` : null);
  }
  function setSlotCount(v) {
    const n = Math.round(Number(v));
    if (n >= 1 && n <= 99) setMag((m) => normalizeMagazine({ ...m, slotCount: n }));
  }
  function updateTool(id, field, value) {
    setMag((m) => ({ ...m, library: m.library.map((t) => (t.id === id ? { ...t, [field]: value } : t)) }));
  }
  function pickDxf(id) {
    dxfFor.current = id;
    dxfRef.current?.click();
  }
  async function importDxf(file) {
    const id = dxfFor.current;
    if (!file || !id) return;
    try {
      const { profile: prof, outline, dia, height, axis, warnings } = profileFromDxf(await file.text());
      setMag((m) => ({ ...m, library: m.library.map((t) => (t.id === id ? { ...t, type: 'custom', profile: prof, outline, dia, height, dxfName: file.name } : t)) }));
      setLibMsg(`${file.name}: Ø${dia} mm, ${height} mm yükseklik, ${prof.length} noktalı profil. Eksen: ${axis === 'x0' ? "çizimdeki X=0 çizgisi" : 'çizimin ortası'} — önizlemeden kontrol edin.${warnings.length ? ` ${warnings.join(' ')}` : ''}`);
    } catch (err) {
      setLibMsg(`${file.name} okunamadı: ${err.message}`);
    }
  }
  function addTool() {
    setMag((m) => ({ ...m, library: [...m.library, { id: newToolId(), name: 'Yeni bıçak', type: 'flat', dia: 6 }] }));
  }
  function removeTool(t) {
    const slot = slotOf(t.id);
    if (!window.confirm(`"${t.name}" silinsin mi?${slot ? ` T${slot} yuvası boşalacak.` : ''}`)) return;
    setMag((m) => normalizeMagazine({ ...m, library: m.library.filter((x) => x.id !== t.id) }));
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(mag, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bicaklar.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importJson(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data?.library)) throw new Error('Dosyada bıçak listesi yok.');
      setMag(normalizeMagazine(data));
      setLibMsg(`${data.library.length} bıçak yüklendi.`);
    } catch (err) {
      setLibMsg(`Yüklenemedi: ${err.message}`);
    }
  }
  function reset() {
    if (window.confirm('Bıçak listesi ve magazin başlangıç haline (T1–T14 tablosu) dönsün mü? Girdiğiniz bıçaklar silinir.')) setMag(defaultMagazine());
  }

  const slotNos = Array.from({ length: mag.slotCount }, (_, i) => i + 1);
  const byId = new Map(mag.library.map((t) => [t.id, t]));
  const sorted = [...mag.library].sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr', { numeric: true }));

  function backToDefault() {
    if (window.confirm('Kendi bıçak listeniz silinsin ve yöneticinin varsayılan listesine dönülsün mü?')) resetMagazine();
  }

  return (
    <div className="atolye-models">
      <ScopeBar
        isAdmin={isAdmin}
        scope={sync.scope}
        what="Bıçak listesi"
        onReset={backToDefault}
      />
      <div className="card">
        <h2>
          Makine Magazini
          <label className="mag-count">Yuva sayısı <input type="number" min="1" max="99" value={mag.slotCount} onChange={(e) => setSlotCount(e.target.value)} /></label>
        </h2>
        <div className="mag-slots">
          {slotNos.map((n) => {
            const tool = byId.get(mag.slots[n]);
            const problem = tool && toolProblem(tool);
            return (
              <div key={n} className={`mag-slot${tool ? '' : ' empty'}${problem ? ' bad' : ''}`}>
                <span className="mag-no">T{n}</span>
                <ToolGlyph tool={tool} />
                <select value={mag.slots[n] || ''} onChange={(e) => setSlot(n, e.target.value || null)}>
                  <option value="">— boş —</option>
                  {sorted.map((t) => {
                    const s = slotOf(t.id);
                    return <option key={t.id} value={t.id}>{t.name}{s && Number(s) !== n ? ` (T${s}'de)` : ''}</option>;
                  })}
                </select>
                <small>{tool ? (problem || summary(tool)) : 'Bu yuvayı kullanan program simülasyonda uyarı verir.'}</small>
              </div>
            );
          })}
        </div>
        {msg && <div className="hint">{msg}</div>}
        <div className="hint">
          Programdaki M6T5 = şu an 5. yuvada takılı bıçak. Simülasyon bu tabloya göre keser.
          Magazin dışındaki numaralar (ör. T13 rölyef, T14 panjur) yerleşik tablodan alınır.
        </div>
      </div>

      <div className="card">
        <h2>
          Bıçak Kütüphanesi ({mag.library.length})
          <span className="mag-actions">
            <button type="button" className="btn-secondary btn-small" onClick={exportJson}>⬇ Dışa aktar</button>
            <button type="button" className="btn-secondary btn-small" onClick={() => fileRef.current?.click()}>⬆ İçe aktar</button>
            <button type="button" className="btn-danger btn-small" onClick={reset}>Başlangıca dön</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { importJson(e.target.files[0]); e.target.value = ''; }} />
            <input ref={dxfRef} type="file" accept=".dxf" hidden onChange={(e) => { importDxf(e.target.files[0]); e.target.value = ''; }} />
          </span>
        </h2>
        <div className="mag-lib-wrap">
          <table className="tool-table mag-lib">
            <thead>
              <tr>
                <th>Profil</th><th>Ad</th><th>Tip</th>
                <th>{FIELD_LABELS.dia}</th><th>{FIELD_LABELS.angle}</th><th>Uç (mm)</th>
                <th>Not</th><th>Yuva</th><th />
              </tr>
            </thead>
            <tbody>
              {mag.library.map((t) => {
                const fields = TOOL_TYPES[t.type]?.fields || [];
                const problem = toolProblem(t);
                const tipField = fields.includes('tipDia') ? 'tipDia' : fields.includes('flat') ? 'flat' : null;
                const slot = slotOf(t.id);
                return (
                  <Fragment key={t.id}>
                  <tr className={problem ? 'row-error' : ''} title={problem || undefined}>
                    <td><ToolGlyph tool={t} /></td>
                    <td className="name-cell"><input value={t.name} onChange={(e) => updateTool(t.id, 'name', e.target.value)} /></td>
                    <td>
                      <select value={t.type} onChange={(e) => updateTool(t.id, 'type', e.target.value)}>
                        {Object.entries(TOOL_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </td>
                    <td>
                      {t.type === 'custom'
                        ? <span className="mag-dia">{t.dia ? `Ø${t.dia}` : '—'}</span>
                        : <input type="number" min="0" step="0.1" value={t.dia ?? ''} onChange={(e) => updateTool(t.id, 'dia', e.target.value)} />}
                    </td>
                    <td>
                      {fields.includes('angle')
                        ? <input type="number" min="1" max="179" step="0.1" value={t.angle ?? ''} onChange={(e) => updateTool(t.id, 'angle', e.target.value)} />
                        : '—'}
                    </td>
                    <td>
                      {t.type === 'custom'
                        ? <button type="button" className="btn-secondary btn-small" onClick={() => pickDxf(t.id)}>📐 {t.profile ? 'DXF değiştir' : 'DXF yükle'}</button>
                        : tipField
                        ? <input type="number" min="0" step="0.1" value={t[tipField] ?? ''} title={FIELD_LABELS[tipField]} placeholder={tipField === 'flat' ? 'sivri' : ''} onChange={(e) => updateTool(t.id, tipField, e.target.value)} />
                        : '—'}
                    </td>
                    <td className="name-cell"><input value={t.note ?? ''} placeholder="marka, şaft…" onChange={(e) => updateTool(t.id, 'note', e.target.value)} /></td>
                    <td>
                      <select value={slot || ''} onChange={(e) => (e.target.value ? setSlot(Number(e.target.value), t.id) : slot && setSlot(Number(slot), null))}>
                        <option value="">—</option>
                        {slotNos.map((n) => <option key={n} value={n}>T{n}</option>)}
                      </select>
                    </td>
                    <td><button type="button" className="btn-danger btn-small" onClick={() => removeTool(t)}>Sil</button></td>
                  </tr>
                  {t.type === 'custom' && (
                    <tr className="mag-custom-row">
                      <td colSpan={9}>
                        {t.profile
                          ? <div className="mag-custom"><ToolGlyph tool={t} big /><span>{t.dxfName || 'çizim'} · Ø{t.dia} mm · {t.height} mm yükseklik<br />Simülasyon bıçağın alttan görünen hattıyla keser.</span></div>
                          : <span className="hint-warn">Bu bıçağın yan görünüşünü AutoCAD'de çizip “DXF yükle” ile ekleyin.</span>}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {libMsg && <div className="hint">{libMsg}</div>}
        <div className={`hint${sync.status === 'error' || sync.status === 'local' ? ' hint-warn' : ''}`}>
          {{ loading: 'Sunucuya kaydediliyor…', saved: '✓ Sunucuda kayıtlı', idle: '' }[sync.status] ?? sync.message}
        </div>
        <button type="button" className="btn-secondary" style={{ marginTop: 12 }} onClick={addTool}>+ Bıçak ekle</button>
        <div className="hint">
          V bıçakta çap = kesen kısmın en geniş yeri, açı = toplam uç açısı (90° = kenara 45°).
          Yuvarlamada “Uç” = uçtaki düz kısım (boş = sivri), konikte “Uç” = küre uç çapı.
          Hazır tiplere uymayan bıçaklar (kulp, tabla…) için tip “Özel profil (DXF)”: bıçağın yan görünüşünü AutoCAD'de
          ucu aşağıda, 1 birim = 1 mm çizip DXF kaydedin. Ya bütün silüeti çizin ya da yalnız sağ yarısını, eksen X=0 çizgisinde olacak şekilde.
          Liste sunucuda saklanır: hesabınızla girdiğiniz her bilgisayarda aynı bıçaklar görünür.
        </div>
      </div>
    </div>
  );
}

/**
 * Whose settings are on screen: the admin edits everyone's default; a user sees
 * the default until they change something, then their own copy (with a way back).
 */
export function ScopeBar({ isAdmin, scope, what, onReset }) {
  if (isAdmin) {
    return <div className="scope-bar admin"><b>{what}:</b> yöneticisiniz, burada yaptığınız ayar herkesin varsayılanıdır. Kendi ayarını yapan kullanıcılar kendi kopyalarıyla çalışır.</div>;
  }
  if (scope === 'own') {
    return (
      <div className="scope-bar own">
        <span><b>{what}:</b> kendi ayarınızı kullanıyorsunuz; değişiklikler yalnız sizde geçerli.</span>
        <button type="button" className="btn-secondary" onClick={onReset}>↺ Varsayılana dön</button>
      </div>
    );
  }
  return <div className="scope-bar"><b>{what}:</b> yöneticinin varsayılan ayarı. Bir şeyi değiştirdiğinizde kendi kopyanız oluşur; istediğiniz zaman varsayılana dönebilirsiniz.</div>;
}

function summary(tool) {
  const s = simShape(tool);
  if (s.type === 'custom') return `Özel profil · Ø${s.dia}${tool.dxfName ? ` · ${tool.dxfName}` : ''}`;
  const parts = [TOOL_TYPES[s.type].label, `Ø${s.dia}`];
  if (s.angle) parts.push(`${s.angle}°`);
  if (s.tipDia) parts.push(`uç Ø${s.tipDia}`);
  if (s.flat) parts.push(`uç düz ${s.flat}`);
  return parts.join(' · ');
}

/** Side view of the tool's cutting end, drawn from the same profile the simulation uses. */
function ToolGlyph({ tool, big = false }) {
  const cls = `mag-glyph${big ? ' big' : ''}`;
  if (!tool || toolProblem(tool)) return <svg className={cls} viewBox="0 0 48 36" aria-hidden="true" />;
  const s = simShape(tool);
  if (s.type === 'custom' && tool.outline) return <DrawnGlyph tool={tool} cls={cls} />;
  const R = s.dia / 2;
  // shown height: the cutting end, at most as tall as wide (a drawn tool: all of its highest point)
  const H = s.type === 'custom'
    ? Math.max(...s.profile.map(([, h]) => h), R * 0.2)
    : Math.min(profile(s, R) || R, s.dia) || R;
  const top = Math.max(H, R * 0.6);
  const N = s.type === 'custom' ? 120 : 24, pts = [];
  for (let k = 0; k <= N; k++) {
    const d = -R + (2 * R * k) / N;
    pts.push([d, Math.min(top, profile(s, Math.abs(d)))]);
  }
  const k = Math.min(44 / (2 * R), 32 / top);
  const X = (d) => 24 + d * k, Y = (h) => 34 - h * k;
  const path = `M${X(-R)},${Y(top)} ${pts.map(([d, h]) => `L${X(d).toFixed(2)},${Y(h).toFixed(2)}`).join(' ')} L${X(R)},${Y(top)} Z`;
  return (
    <svg className={cls} viewBox="0 0 48 36" aria-label={summary(tool)}>
      <path d={path} />
    </svg>
  );
}

/** A drawn tool: the drawing as loaded (a half profile mirrored) and, highlighted, the lower edge the simulation cuts with. */
function DrawnGlyph({ tool, cls }) {
  const half = tool.outline.every((o) => o.pts.every(([x]) => x >= -0.01));
  const lines = half ? [...tool.outline, ...tool.outline.map((o) => ({ ...o, pts: o.pts.map(([x, y]) => [-x, y]) }))] : tool.outline;
  const all = lines.flatMap((o) => o.pts);
  const R = tool.dia / 2;
  const H = Math.max(...all.map(([, y]) => y), 0.1);
  const minX = Math.min(-R, ...all.map(([x]) => x)), maxX = Math.max(R, ...all.map(([x]) => x));
  const k = Math.min(44 / (maxX - minX || 1), 32 / H);
  const cx = 24 - ((minX + maxX) / 2) * k;
  const X = (x) => (cx + x * k).toFixed(2), Y = (y) => (34 - y * k).toFixed(2);
  const P = tool.profile;
  const env = [...P.slice().reverse().map(([d, h]) => [-d, h]), ...P];
  return (
    <svg className={`${cls} drawn`} viewBox="0 0 48 36" aria-label={summary(tool)}>
      {lines.map((o, i) => (
        <path key={i} className="line" d={`M${o.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' L')}${o.closed ? ' Z' : ''}`} />
      ))}
      <path className="env" d={`M${env.map(([d, h]) => `${X(d)},${Y(h)}`).join(' L')}`} />
      <line className="axis" x1={X(0)} x2={X(0)} y1="1" y2="35" />
    </svg>
  );
}
