// Accounts and sessions, with Node's own crypto (no extra packages).
//
//   password  — scrypt with a random salt: "scrypt$<salt>$<hash>"
//   session   — an HttpOnly cookie "<userId>.<expiry>.<version>.<HMAC>", signed
//               with SESSION_SECRET. Bumping a user's sessionVersion (password
//               reset, disabling) signs all of their old sessions out.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { userStore } from '../store/userStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE = 'empire_sess';
const SESSION_DAYS = 30;

/** SESSION_SECRET from the environment, else one generated once and kept in server/data (not committed). */
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(__dirname, '..', 'data', '.session-secret');
  try { return fs.readFileSync(file, 'utf-8').trim(); } catch { /* create below */ }
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, s); } catch { /* memory only */ }
  return s;
}
// read on first use: the .env files are loaded after this module is imported
let SECRET = null;
const secret = () => SECRET || (SECRET = loadSecret());

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(pw), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

const sign = (s) => crypto.createHmac('sha256', secret()).update(s).digest('base64url');

function makeToken(user) {
  const body = `${user._id}.${Date.now() + SESSION_DAYS * 864e5}.${user.sessionVersion || 1}`;
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return null;
  const body = parts.slice(0, 3).join('.');
  const a = Buffer.from(sign(body)), b = Buffer.from(parts[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [id, exp, ver] = parts;
  if (Number(exp) < Date.now()) return null;
  return { id, ver: Number(ver) };
}

function cookieOf(req) {
  const m = /(?:^|;\s*)empire_sess=([^;]+)/.exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}

export function setSession(req, res, user) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken(user))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Why a user may not use the app right now ('' = may). */
export function accessProblem(user) {
  if (!user) return 'Giriş yapın.';
  if (user.status === 'pending') return 'Hesabınız yönetici onayı bekliyor.';
  if (user.status === 'disabled') return 'Hesabınız kapatıldı.';
  if (user.role !== 'admin' && user.accessUntil && new Date(user.accessUntil).getTime() < Date.now()) {
    return 'Erişim süreniz doldu. Yöneticiyle iletişime geçin.';
  }
  return '';
}

/** Public view of a user (never the hash). */
export const publicUser = (u) => u && ({
  _id: u._id, email: u.email, name: u.name, role: u.role, status: u.status,
  accessUntil: u.accessUntil, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
});

/** Attaches req.user (or null) from the session cookie. */
export async function loadUser(req, res, next) {
  req.user = null;
  try {
    const t = readToken(cookieOf(req));
    if (t) {
      const u = await userStore.byId(t.id);
      if (u && (u.sessionVersion || 1) === t.ver) req.user = u;
    }
  } catch { /* treated as signed out */ }
  next();
}

/** Only for users who may use the app now. */
export function requireAccess(req, res, next) {
  const why = accessProblem(req.user);
  if (why) return res.status(req.user ? 403 : 401).json({ error: why });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin' || accessProblem(req.user)) return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekir.' });
  next();
}
