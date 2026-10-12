// Workshop settings in two layers: the DEFAULT the admin sets (Atölye) and, on
// top of it, each user's OWN copy (their own tools…), which they can drop at any
// time to go back to the default.
//
//   MongoDB (the online site): Setting documents, key 'tools' (default) and
//   'tools:<userId>' (a user's own).
//   Local install: the default in server/data/<file> (kept in git, so the shop PC
//   gets it with a pull and server/scripts/render-preset-images.mjs reads it), the
//   users' own copies in server/data/user-settings.json (never committed).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Setting from '../models/Setting.js';
import { isMongoConnected } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TOOLS_DATA_DIR || path.join(__dirname, '..', 'data');
const USER_FILE = path.join(DATA_DIR, 'user-settings.json');

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return { value: JSON.parse(fs.readFileSync(file, 'utf-8')), updatedAt: fs.statSync(file).mtime };
}
function writeJson(file, value) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
}
const readUsers = () => readJson(USER_FILE)?.value || {};

/**
 * One layered setting.
 * @param {string} key  'tools', 'machine'…
 * @param {string} file the default's file name in server/data
 */
export function layeredSetting(key, file) {
  const FILE = path.join(DATA_DIR, file);
  const ownKey = (userId) => `${key}:${userId}`;
  return {
    /** The admin's default, or null. */
    async getDefault() {
      if (isMongoConnected()) {
        const doc = await Setting.findOne({ key }).lean();
        // a new online database: start from the repository's copy (the real T9 profile…)
        if (doc) return { value: doc.value, updatedAt: doc.updatedAt };
      }
      return readJson(FILE);
    },
    /** A user's own copy, or null. */
    async getOwn(userId) {
      if (!userId) return null;
      if (isMongoConnected()) {
        const doc = await Setting.findOne({ key: ownKey(userId) }).lean();
        return doc ? { value: doc.value, updatedAt: doc.updatedAt } : null;
      }
      return readUsers()[ownKey(userId)] || null;
    },
    /** What a user works with: their own copy, else the default ({…, scope}). */
    async get(userId = null) {
      const own = await this.getOwn(userId);
      if (own) return { ...own, scope: 'own' };
      const def = await this.getDefault();
      return def ? { ...def, scope: 'default' } : null;
    },
    /** userId null = the default. */
    async set(value, userId = null) {
      if (isMongoConnected()) {
        const doc = await Setting.findOneAndUpdate({ key: userId ? ownKey(userId) : key }, { value }, { upsert: true, new: true }).lean();
        return { value: doc.value, updatedAt: doc.updatedAt, scope: userId ? 'own' : 'default' };
      }
      if (!userId) {
        writeJson(FILE, value);
        return { value, updatedAt: fs.statSync(FILE).mtime, scope: 'default' };
      }
      const all = readUsers();
      all[ownKey(userId)] = { value, updatedAt: new Date().toISOString() };
      writeJson(USER_FILE, all);
      return { ...all[ownKey(userId)], scope: 'own' };
    },
    /** Drops a user's own copy: they are back on the default. */
    async clear(userId) {
      if (!userId) return;
      if (isMongoConnected()) { await Setting.deleteOne({ key: ownKey(userId) }); return; }
      const all = readUsers();
      if (!(ownKey(userId) in all)) return;
      delete all[ownKey(userId)];
      writeJson(USER_FILE, all);
    },
  };
}

export function validateTools(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.library) || typeof v.slots !== 'object' || v.slots === null) {
    return 'Bıçak listesi bozuk: library ve slots gerekli.';
  }
  if (v.library.length > 500) return 'En fazla 500 bıçak olabilir.';
  if (v.library.some((t) => !t || typeof t.id !== 'string' || typeof t.type !== 'string')) return 'Her bıçağın id ve tipi olmalı.';
  return '';
}

/** The tool library + magazine (Atölye → Bıçaklar). */
export const toolStore = layeredSetting('tools', 'bicaklar.json');
/** Machine and plate defaults (Atölye → Makine). */
export const machineStore = layeredSetting('machine', 'makine.json');
