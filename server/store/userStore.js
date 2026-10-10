// Accounts: MongoDB when connected (the online site), otherwise a local JSON
// file (server/data/users.json — never committed: it holds password hashes).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import { isMongoConnected } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.USERS_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'users.json');

function readFile() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf-8')); } catch { return []; }
}
function writeFile(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8');
  fs.renameSync(tmp, FILE);
}
const plain = (doc) => {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject({ versionKey: false }) : { ...doc };
  return { ...o, _id: String(o._id) };
};

export const userStore = {
  async count() {
    if (isMongoConnected()) return User.countDocuments();
    return readFile().length;
  },
  async list() {
    if (isMongoConnected()) return (await User.find().sort({ createdAt: 1 })).map(plain);
    return readFile();
  },
  async byId(id) {
    if (isMongoConnected()) return plain(await User.findById(id).catch(() => null));
    return readFile().find((u) => u._id === id) || null;
  },
  async byEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (isMongoConnected()) return plain(await User.findOne({ email: e }));
    return readFile().find((u) => u.email === e) || null;
  },
  async create(data) {
    const now = new Date().toISOString();
    if (isMongoConnected()) return plain(await User.create(data));
    const list = readFile();
    const user = { _id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, sessionVersion: 1, accessUntil: null, lastLoginAt: null, createdAt: now, updatedAt: now, ...data };
    list.push(user);
    writeFile(list);
    return user;
  },
  async update(id, patch) {
    if (isMongoConnected()) return plain(await User.findByIdAndUpdate(id, patch, { new: true }));
    const list = readFile();
    const i = list.findIndex((u) => u._id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
    writeFile(list);
    return list[i];
  },
  async remove(id) {
    if (isMongoConnected()) { await User.findByIdAndDelete(id); return; }
    writeFile(readFile().filter((u) => u._id !== id));
  },
};
