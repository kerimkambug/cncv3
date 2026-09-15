import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'presets.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}

function readAll() {
  ensureFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    if (!Array.isArray(parsed)) {
      throw new Error('Preset data must be a JSON array.');
    }
    return parsed;
  } catch (err) {
    const error = new Error(`Unable to read preset data from ${DATA_FILE}: ${err.message}`, { cause: err });
    error.code = err.code || 'PRESET_DATA_READ_ERROR';
    throw error;
  }
}

function writeAll(list) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

function makeId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const fileStore = {
  async list(moduleFilter) {
    const all = readAll();
    const filtered = moduleFilter ? all.filter((p) => p.module === moduleFilter) : all;
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  },

  async get(id) {
    return readAll().find((p) => p._id === id) || null;
  },

  async create(data) {
    const all = readAll();
    const module = data.module || 'kapak';
    const dupe = all.find((p) => p.name === data.name && p.module === module);
    if (dupe) {
      const err = new Error('duplicate');
      err.code = 11000;
      throw err;
    }
    const now = new Date().toISOString();
    const preset = { _id: makeId(), category: 'kapak', imageDataUrl: '', previewWidth: 600, previewHeight: 600, ...data, module, createdAt: now, updatedAt: now };
    all.push(preset);
    writeAll(all);
    return preset;
  },

  async update(id, data) {
    const all = readAll();
    const idx = all.findIndex((p) => p._id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data, updatedAt: new Date().toISOString() };
    writeAll(all);
    return all[idx];
  },

  async remove(id) {
    const all = readAll();
    const idx = all.findIndex((p) => p._id === id);
    if (idx === -1) return null;
    const [removed] = all.splice(idx, 1);
    writeAll(all);
    return removed;
  },
};
