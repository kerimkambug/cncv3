import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, isMongoConnected } from './config/db.js';
import presetRoutes from './routes/presetRoutes.js';
import reliefRoutes from './routes/reliefRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { seedPresetsIfEmpty } from './config/seed.js';
import { accessProblem, loadUser, requireAccess, requireAdmin } from './auth/auth.js';

// server/.env.local (never in git: database address, session key…) first, then
// server/.env; variables already set by the host (Render…) always win.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env.local') });
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../client/dist');
const loginPage = path.join(__dirname, 'public', 'login.html');

const app = express();
// behind a hosting proxy (Render…): trust it for the client IP and https
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Accounts: every request first reads the session; the app and its API are only
// for users with access (see server/auth/auth.js).
app.use(loadUser);
app.use('/api/auth', authRoutes);
// models: everyone with access reads them, only the admin changes them
app.use('/api/presets', requireAccess, (req, res, next) => (req.method === 'GET' ? next() : requireAdmin(req, res, next)), presetRoutes);
app.use('/api/relief', requireAccess, reliefRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true, storage: isMongoConnected() ? 'mongodb' : 'local-file' }));

if (app.locals && app.locals.settings) {
  // no-op placeholder to keep the block structure explicit for future runtime settings
}

if (process.env.NODE_ENV === 'production' || true) {
  const fs = await import('fs');
  if (fs.existsSync(clientDistPath)) {
    // Without access nothing of the app (not even its scripts) is served: the
    // signed-out visitor gets only the small login page.
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      if (!accessProblem(req.user)) return next();
      if (req.method !== 'GET' || /\.(js|css|map|json|wasm|png|jpe?g|svg|ico|woff2?)$/i.test(req.path)) return res.status(401).end();
      res.set('Cache-Control', 'no-store');
      return res.sendFile(loginPage);
    });
    app.use(express.static(clientDistPath, { index: false }));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
  }
}

// Generic error handler so a thrown error doesn't crash the process
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası.' });
});

const PORT = process.env.PORT || 4000;

connectDB().then(async () => {
  try { await seedPresetsIfEmpty(); } catch (err) { console.warn(`[db] model import failed: ${err.message}`); }
  app.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
    console.log(`[server] preset storage: ${isMongoConnected() ? 'MongoDB' : 'local file (server/data/presets.json)'}`);
    console.log(`[server] frontend dist: ${clientDistPath}`);
  });
});
