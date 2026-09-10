import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, isMongoConnected } from './config/db.js';
import presetRoutes from './routes/presetRoutes.js';
import reliefRoutes from './routes/reliefRoutes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../client/dist');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.use('/api/presets', presetRoutes);
app.use('/api/relief', reliefRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true, storage: isMongoConnected() ? 'mongodb' : 'local-file' }));

if (app.locals && app.locals.settings) {
  // no-op placeholder to keep the block structure explicit for future runtime settings
}

if (process.env.NODE_ENV === 'production' || true) {
  const fs = await import('fs');
  if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
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

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
    console.log(`[server] preset storage: ${isMongoConnected() ? 'MongoDB' : 'local file (server/data/presets.json)'}`);
    console.log(`[server] frontend dist: ${clientDistPath}`);
  });
});
