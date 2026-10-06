import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Overridable (PRESETS_DATA_DIR) so tests can run against a temp directory
// instead of the live data file.
const DATA_DIR = process.env.PRESETS_DATA_DIR || path.join(__dirname, '..', 'data');
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
    validateAbsoluteOffsets(parsed);
    validateRowFlags(parsed);
    return parsed.map((p) => normalizeRowFlags(normalizeOffsetRows(p)));
  } catch (err) {
    const error = new Error(`Unable to read preset data from ${DATA_FILE}: ${err.message}`, { cause: err });
    error.code = err.code || 'PRESET_DATA_READ_ERROR';
    throw error;
  }
}

function writeAll(list) {
  ensureFile();
  // Atomic replace: write to a temp file in the same directory, then rename it
  // over the data file. A crash or concurrent read mid-write can no longer leave
  // a truncated/partial presets.json behind (rename over an existing file is
  // atomic on POSIX and effectively atomic on Windows via MoveFileEx).
  const tmpFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(list, null, 2), 'utf-8');
  try {
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch { /* best effort cleanup */ }
    throw err;
  }
}

function makeId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Presets saved/seeded before per-row `absoluteOffset` existed declare only
// `stepOffset` on their offset rows (e.g. presets.json 2/7/8 NUMARA, rows
// 119-149 / 328-370 / 394-427). In absolute offset mode the step value IS the
// distance from the part edge, so backfilling it as `absoluteOffset` keeps
// every consumer (kapak.js pinning at lines 410/429/650, nesting, DXF export)
// reading a defined number instead of undefined. Relative-mode rows are left
// untouched on purpose: backfilling a pin there would change the cumulative
// chain semantics (a pinned row freezes the chain at its own value).
function normalizeOffsetRows(preset) {
  if (!preset || preset.offsetMode !== 'absolute' || !Array.isArray(preset.rows)) return preset;
  let changed = false;
  const rows = preset.rows.map((row) => {
    if (row == null || (row.operation || 'offset') !== 'offset') return row;
    if (row.absoluteOffset !== undefined && row.absoluteOffset !== null) return row;
    changed = true;
    return { ...row, absoluteOffset: row.stepOffset };
  });
  return changed ? { ...preset, rows } : preset;
}

// Row-emission flags the G-code engine reads (kapak.js emitOffsetPasses) but
// which do NOT appear on every row: `roughing` (square clearing pass), `chain`
// (continue at depth, no retract/re-plunge) and `repeatStartY` (repeat the start
// Y on the cut move). They were absent from the Mongoose schema, so an API
// POST/PUT stripped them and a preset saved through the app lost its toolpath
// (1 NUMARA roughing, 7 NUMARA chained rings). normalizeRowFlags is the store
// counterpart: it backfills the explicit false and reports rows that carried
// them, so the same flags survive a file-store round-trip.
const ROW_FLAG_KEYS = ['roughing', 'chain', 'repeatStartY'];
function normalizeRowFlags(preset) {
  if (!preset || !Array.isArray(preset.rows)) return preset;
  let changed = false;
  const rows = preset.rows.map((row) => {
    if (row == null) return row;
    const next = { ...row };
    let rowChanged = false;
    for (const key of ROW_FLAG_KEYS) {
      if (next[key] === undefined) { next[key] = false; rowChanged = true; }
    }
    if (rowChanged) changed = true;
    return rowChanged ? next : row;
  });
  return changed ? { ...preset, rows } : preset;
}

// Advisory pass: makes the row flags visible in the log instead of silent. It
// only warns when a row actually carries a truthy flag, so operators can see
// which presets depend on retract-skipping (chain) or square clearing (roughing)
// — both of which change the physical toolpath when a data source drops them.
const warnedRowFlags = new Set();
function validateRowFlags(presets) {
  if (!Array.isArray(presets)) return;
  presets.forEach((preset, presetIdx) => {
    if (!preset || !Array.isArray(preset.rows)) return;
    const presetKey = String(preset._id || preset.name || `index-${presetIdx}`);
    preset.rows.forEach((row, rowIdx) => {
      if (row == null) return;
      const active = ROW_FLAG_KEYS.filter((key) => row[key] === true);
      if (active.length === 0) return;
      const warnKey = `${presetKey}:${rowIdx}:${active.join(',')}`;
      if (warnedRowFlags.has(warnKey)) return;
      warnedRowFlags.add(warnKey);
      console.warn(
        `[presets.json] "${preset.name || presetKey}" satır ${rowIdx + 1}${row.name ? ` (${row.name})` : ''}: ${active.join(', ')} aktif — tezgâh yolu bu bayraklara bağlı (retract atlama / kare talaş boşaltma / Y tekrarı).`,
      );
    });
  });
}

// Validation pass: flags (never blocks) absolute-mode offset rows whose source
// data carried no usable absoluteOffset, so bad seed/API data shows up in the
// log instead of surfacing later as a silently different toolpath. Warned
// presets are remembered so repeated reads don't spam the console.
const warnedMissingAbsoluteOffset = new Set();
function validateAbsoluteOffsets(presets) {
  if (!Array.isArray(presets)) return;
  presets.forEach((preset, presetIdx) => {
    if (!preset || preset.offsetMode !== 'absolute' || !Array.isArray(preset.rows)) return;
    const presetKey = String(preset._id || preset.name || `index-${presetIdx}`);
    preset.rows.forEach((row, rowIdx) => {
      if (row == null || (row.operation || 'offset') !== 'offset') return;
      if (row.absoluteOffset !== undefined && row.absoluteOffset !== null) return;
      const warnKey = `${presetKey}:${rowIdx}`;
      if (warnedMissingAbsoluteOffset.has(warnKey)) return;
      warnedMissingAbsoluteOffset.add(warnKey);
      console.warn(
        `[presets.json] "${preset.name || presetKey}" satır ${rowIdx + 1}${row.name ? ` (${row.name})` : ''}: offsetMode absolute ama absoluteOffset eksik — stepOffset fallback kullanılıyor.`,
      );
    });
  });
}

// Simple async mutex: every exported store operation runs its read-modify-write
// body inside a promise-queued critical section, so two concurrent requests can
// never interleave readAll/writeAll and silently drop a preset.
let storeQueue = Promise.resolve();
function withLock(fn) {
  const run = storeQueue.then(fn, fn); // previous failure must not block the next op
  // Keep the tail of the chain alive even if `fn` rejects.
  storeQueue = run.then(() => undefined, () => undefined);
  return run;
}

export const fileStore = {
  async list(moduleFilter) {
    return withLock(() => {
      const all = readAll();
      const filtered = moduleFilter ? all.filter((p) => p.module === moduleFilter) : all;
      return filtered.sort((a, b) => a.name.localeCompare(b.name));
    });
  },

  async get(id) {
    return withLock(() => readAll().find((p) => p._id === id) || null);
  },

  async create(data) {
    return withLock(() => {
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
      // Normalization runs on WRITE too, not just on read. Otherwise a preset
      // saved from absolute mode would be written to presets.json without
      // absoluteOffset, and every consumer reading the raw file (DXF export,
      // JSON import, an editor opening the data directory) would see the missing
      // field — and, on the next read, would be silently patched to a different
      // value. Writing it back keeps the file and the in-memory shape identical.
      // The row-emission flags (roughing/chain/repeatStartY) go through the same
      // path so they are persisted explicitly instead of being re-derived.
      all.push(normalizeRowFlags(normalizeOffsetRows(preset)));
      writeAll(all);
      return all[all.length - 1];
    });
  },

  async update(id, data) {
    return withLock(() => {
      const all = readAll();
      const idx = all.findIndex((p) => p._id === id);
      if (idx === -1) return null;
      all[idx] = normalizeRowFlags(normalizeOffsetRows({ ...all[idx], ...data, updatedAt: new Date().toISOString() }));
      writeAll(all);
      return all[idx];
    });
  },

  async remove(id) {
    return withLock(() => {
      const all = readAll();
      const idx = all.findIndex((p) => p._id === id);
      if (idx === -1) return null;
      const [removed] = all.splice(idx, 1);
      writeAll(all);
      return removed;
    });
  },
};
