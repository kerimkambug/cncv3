import { Router } from 'express';
import { userStore } from '../store/userStore.js';
import {
  accessProblem, checkPassword, clearSession, hashPassword, publicUser, requireAdmin, setSession,
} from '../auth/auth.js';

const router = Router();
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));

// slow down password guessing: max 8 failed logins per IP per 10 minutes
const fails = new Map();
const tooMany = (ip) => {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  fails.set(ip, list);
  return list.length >= 8;
};

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!emailOk(email)) return res.status(400).json({ error: 'Geçerli bir e-posta girin.' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
  if (await userStore.byEmail(email)) return res.status(409).json({ error: 'Bu e-posta ile kayıtlı bir hesap var.' });
  // Who becomes administrator: with ADMIN_EMAIL set (the online site) exactly that
  // address; otherwise the very first account. Everyone else waits for approval.
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const first = adminEmail
    ? String(email).trim().toLowerCase() === adminEmail
    : (await userStore.count()) === 0;
  const user = await userStore.create({
    email: String(email).trim().toLowerCase(),
    name: String(name || '').trim().slice(0, 80),
    passwordHash: hashPassword(password),
    role: first ? 'admin' : 'user',
    status: first ? 'active' : 'pending',
  });
  if (first) setSession(req, res, user);
  res.json({ user: publicUser(user), message: first ? 'Yönetici hesabı oluşturuldu.' : 'Kaydınız alındı. Hesabınız yönetici onayından sonra açılacak.' });
});

router.post('/login', async (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: 'Çok fazla hatalı deneme. 10 dakika sonra tekrar deneyin.' });
  const { email, password } = req.body || {};
  const user = await userStore.byEmail(email);
  if (!user || !checkPassword(password, user.passwordHash)) {
    fails.get(ip).push(Date.now());
    return res.status(401).json({ error: 'E-posta ya da şifre hatalı.' });
  }
  const updated = await userStore.update(user._id, { lastLoginAt: new Date().toISOString() });
  setSession(req, res, updated || user);
  res.json({ user: publicUser(updated || user), problem: accessProblem(updated || user) });
});

// for the login page: with no account yet it opens straight on "create the first (admin) account"
router.get('/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // with ADMIN_EMAIL the page never offers 'create the first account': the admin just signs up
  res.json({ hasUsers: Boolean(process.env.ADMIN_EMAIL) || (await userStore.count()) > 0 });
});

router.post('/logout',(req, res) => { clearSession(res); res.json({ ok: true }); });

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
  res.json({ user: publicUser(req.user), problem: accessProblem(req.user) });
});

router.post('/password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Giriş yapın.' });
  const { current, next } = req.body || {};
  if (!checkPassword(current, req.user.passwordHash)) return res.status(400).json({ error: 'Mevcut şifre hatalı.' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'Yeni şifre en az 8 karakter olmalı.' });
  const u = await userStore.update(req.user._id, { passwordHash: hashPassword(next), sessionVersion: (req.user.sessionVersion || 1) + 1 });
  setSession(req, res, u);
  res.json({ ok: true });
});

// ---- administration --------------------------------------------------------
router.get('/users', requireAdmin, async (req, res) => {
  res.json((await userStore.list()).map(publicUser));
});

router.patch('/users/:id', requireAdmin, async (req, res) => {
  const target = await userStore.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  const { status, accessUntil, role, name, newPassword } = req.body || {};
  const patch = {};
  if (status !== undefined) {
    if (!['pending', 'active', 'disabled'].includes(status)) return res.status(400).json({ error: 'Geçersiz durum.' });
    patch.status = status;
  }
  if (accessUntil !== undefined) {
    if (accessUntil === null || accessUntil === '') patch.accessUntil = null;
    else {
      const d = new Date(accessUntil);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Geçersiz tarih.' });
      d.setHours(23, 59, 59, 0); // through the end of that day
      patch.accessUntil = d.toISOString();
    }
  }
  if (role !== undefined) {
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Geçersiz rol.' });
    patch.role = role;
  }
  if (name !== undefined) patch.name = String(name).slice(0, 80);
  if (newPassword !== undefined) {
    if (String(newPassword).length < 8) return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
    patch.passwordHash = hashPassword(newPassword);
  }
  // an admin cannot lock themselves out
  if (target._id === req.user._id && (patch.status && patch.status !== 'active' || patch.role === 'user')) {
    return res.status(400).json({ error: 'Kendi yönetici hesabınızı kapatamaz ya da yetkisini alamazsınız.' });
  }
  if (patch.status === 'disabled' || patch.passwordHash) patch.sessionVersion = (target.sessionVersion || 1) + 1;
  res.json(publicUser(await userStore.update(target._id, patch)));
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user._id) return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz.' });
  await userStore.remove(req.params.id);
  res.json({ ok: true });
});

export default router;
