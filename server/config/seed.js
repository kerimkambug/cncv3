// First start against an empty MongoDB (a new online site): the models come
// from server/data/presets.json in the repository, so nobody has to import
// anything by hand. Runs only while the collection is empty — after that the
// database is the source of truth and the admin edits models on the site.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Preset from '../models/Preset.js';
import { isMongoConnected } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_FILE = path.join(__dirname, '..', 'data', 'presets.json');

export async function seedPresetsIfEmpty() {
  if (!isMongoConnected()) return;
  if ((await Preset.countDocuments()) > 0) return;
  let list = [];
  try { list = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf-8')); } catch { return; }
  // the file's ids ("local_…") are not database ids: Mongo gives new ones
  const docs = list.map(({ _id, ...rest }) => rest);
  if (!docs.length) return;
  await Preset.insertMany(docs);
  console.log(`[db] empty database: ${docs.length} models imported from presets.json`);
}
