// The workshop's tool library + magazine (Atölye → Bıçaklar), one copy for every
// computer: MongoDB when connected (the online site), otherwise the local file
// server/data/bicaklar.json (kept in git, so the shop PC gets it with a pull,
// and read by server/scripts/render-preset-images.mjs).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Setting from '../models/Setting.js';
import { isMongoConnected } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TOOLS_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'bicaklar.json');
const KEY = 'tools';

function readFile() {
  if (!fs.existsSync(FILE)) return null;
  return { value: JSON.parse(fs.readFileSync(FILE, 'utf-8')), updatedAt: fs.statSync(FILE).mtime };
}

export function validateTools(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.library) || typeof v.slots !== 'object' || v.slots === null) {
    return 'Bıçak listesi bozuk: library ve slots gerekli.';
  }
  if (v.library.length > 500) return 'En fazla 500 bıçak olabilir.';
  if (v.library.some((t) => !t || typeof t.id !== 'string' || typeof t.type !== 'string')) return 'Her bıçağın id ve tipi olmalı.';
  return '';
}

export const toolStore = {
  async get() {
    if (isMongoConnected()) {
      const doc = await Setting.findOne({ key: KEY }).lean();
      if (doc) return { value: doc.value, updatedAt: doc.updatedAt };
      // a new online database: start from the repository's list (the real T9 profile…)
      return readFile();
    }
    return readFile();
  },
  async set(value) {
    if (isMongoConnected()) {
      const doc = await Setting.findOneAndUpdate({ key: KEY }, { value }, { upsert: true, new: true }).lean();
      return { value: doc.value, updatedAt: doc.updatedAt };
    }
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
    fs.renameSync(tmp, FILE);
    return { value, updatedAt: fs.statSync(FILE).mtime };
  },
};
