import { useEffect, useState } from 'react';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('tr-TR') : '—');
const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const STATUS = { pending: 'Onay bekliyor', active: 'Açık', disabled: 'Kapalı' };

/** Admin: accounts, approval, access period, password reset. */
export default function UsersPanel({ me }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    setError('');
    try {
      const r = await fetch('/api/auth/users');
      if (!r.ok) throw new Error((await r.json()).error || 'Liste alınamadı.');
      setUsers(await r.json());
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function patch(id, body, okText) {
    setError(''); setNote('');
    try {
      const r = await fetch(`/api/auth/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Kaydedilemedi.');
      setUsers((list) => list.map((u) => (u._id === id ? d : u)));
      if (okText) setNote(okText);
    } catch (err) { setError(err.message); }
  }

  async function remove(u) {
    if (!window.confirm(`${u.email} hesabı silinsin mi?`)) return;
    const r = await fetch(`/api/auth/users/${u._id}`, { method: 'DELETE' });
    if (r.ok) setUsers((list) => list.filter((x) => x._id !== u._id));
    else setError((await r.json()).error || 'Silinemedi.');
  }

  function quick(u, months) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    patch(u._id, { status: 'active', accessUntil: isoDay(d) }, `${u.email}: ${months} ay erişim verildi.`);
  }

  function resetPassword(u) {
    const pw = window.prompt(`${u.email} için yeni şifre (en az 8 karakter):`);
    if (pw) patch(u._id, { newPassword: pw }, `${u.email}: şifre değiştirildi, açık oturumları kapandı.`);
  }

  return (
    <div className="card users-panel">
      <h2>Kullanıcılar</h2>
      <div className="hint">Siteden kayıt olanlar burada onay bekler. Onaylayıp bitiş tarihi verin; tarih boş kalırsa süresizdir. Süresi dolan kullanıcı giriş yapabilir ama uygulamayı açamaz.</div>
      {error && <div className="err" style={{ display: 'block' }}>{error}</div>}
      {note && <div className="ok" style={{ display: 'block' }}>{note}</div>}
      {!users && !error && <div className="hint">Yükleniyor…</div>}
      {users && (
        <div className="users-table">
          <div className="users-row users-head">
            <span>Kullanıcı</span><span>Durum</span><span>Erişim bitişi</span><span>Son giriş</span><span />
          </div>
          {users.map((u) => {
            const self = me && u._id === me._id;
            const expired = u.role !== 'admin' && u.accessUntil && new Date(u.accessUntil) < new Date();
            return (
              <div key={u._id} className={`users-row${u.status === 'pending' ? ' pending' : ''}`}>
                <span className="users-who">
                  <strong>{u.name || u.email}</strong>
                  <small>{u.email}{u.role === 'admin' ? ' · yönetici' : ''}</small>
                </span>
                <span>
                  <select value={u.status} disabled={self} onChange={(e) => patch(u._id, { status: e.target.value })}>
                    {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {expired && <small className="users-expired">süresi doldu</small>}
                </span>
                <span>
                  {u.role === 'admin' ? <small>süresiz</small> : (
                    <>
                      <input type="date" value={isoDay(u.accessUntil)} onChange={(e) => patch(u._id, { accessUntil: e.target.value || null })} />
                      <span className="users-quick">
                        <button type="button" className="link-btn" onClick={() => quick(u, 1)}>+1 ay</button>
                        <button type="button" className="link-btn" onClick={() => quick(u, 6)}>+6 ay</button>
                        <button type="button" className="link-btn" onClick={() => quick(u, 12)}>+1 yıl</button>
                        <button type="button" className="link-btn" onClick={() => patch(u._id, { accessUntil: null })}>süresiz</button>
                      </span>
                    </>
                  )}
                </span>
                <span><small>{fmtDate(u.lastLoginAt)}</small></span>
                <span className="users-actions">
                  <button type="button" className="link-btn" onClick={() => resetPassword(u)}>Şifre</button>
                  {!self && <button type="button" className="link-btn danger" onClick={() => remove(u)}>Sil</button>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Everyone: change own password. */
export function PasswordPanel() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);
  async function save(e) {
    e.preventDefault();
    setMsg(null);
    const r = await fetch('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: cur, next }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setMsg({ ok: true, text: 'Şifreniz değiştirildi.' }); setCur(''); setNext(''); } else setMsg({ ok: false, text: d.error || 'Değiştirilemedi.' });
  }
  return (
    <form className="card" onSubmit={save} style={{ maxWidth: 420 }}>
      <h2>Şifre değiştir</h2>
      <label>Mevcut şifre</label>
      <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
      <label>Yeni şifre (en az 8 karakter)</label>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      <button type="submit" className="btn-primary">Kaydet</button>
      {msg && <div className={msg.ok ? 'ok' : 'err'} style={{ display: 'block' }}>{msg.text}</div>}
    </form>
  );
}
