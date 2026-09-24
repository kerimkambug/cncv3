// fileStore.test.js
// Plain-node unit tests for the preset file store (node server/store/fileStore.test.js).
// Uses a temp PRESETS_DATA_DIR so the live data file is never touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filestore-test-'));
process.env.PRESETS_DATA_DIR = tmpDir;

const { fileStore } = await import('./fileStore.js');
const DATA_FILE = path.join(tmpDir, 'presets.json');

// --- create / get / list ---
const p1 = await fileStore.create({ name: 'Test A', rows: [] });
check('create assigns an _id and defaults module/category', p1._id && p1.module === 'kapak' && p1.category === 'kapak');
check('create persists to the data file', JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')).length === 1);

const p2 = await fileStore.create({ name: 'Test B', module: 'cam', rows: [] });
check('get returns the stored preset by id', (await fileStore.get(p1._id)).name === 'Test A');
check('get returns null for an unknown id', (await fileStore.get('nope')) === null);
check('list returns all presets', (await fileStore.list()).length === 2);
check('list filters by module', (await fileStore.list('cam')).length === 1 && (await fileStore.list('cam'))[0].name === 'Test B');
check('list sorts by name', (await fileStore.list()).map((p) => p.name).join(',') === 'Test A,Test B');

// --- duplicate detection ---
let dupeCode = null;
try { await fileStore.create({ name: 'Test A', rows: [] }); } catch (e) { dupeCode = e.code; }
check('create rejects a duplicate name within the same module (code 11000)', dupeCode === 11000);
const camDupe = await fileStore.create({ name: 'Test A', module: 'cam', rows: [] });
check('same name is allowed in a DIFFERENT module', !!camDupe._id);

// --- update ---
const updated = await fileStore.update(p1._id, { name: 'Test A2' });
check('update applies the patch and bumps updatedAt', updated.name === 'Test A2' && updated.updatedAt >= p1.updatedAt);
check('update returns null for an unknown id', (await fileStore.update('nope', { name: 'x' })) === null);

// --- remove ---
const removed = await fileStore.remove(p2._id);
check('remove returns the removed preset', removed.name === 'Test B');
check('remove persists the deletion', JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')).length === 2);
check('remove returns null for an unknown id', (await fileStore.remove('nope')) === null);

// --- absolute-mode offset backfill (normalizeOffsetRows) ---
await fileStore.create({
  name: 'AbsMode',
  offsetMode: 'absolute',
  rows: [
    { name: 'T6', stepOffset: 62 },
    { name: 'T7', stepOffset: 59, absoluteOffset: 59 },
    { name: 'derz', operation: 'derz', stepOffset: 10 }, // non-offset rows untouched
  ],
});
const stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')).find((p) => p.name === 'AbsMode');
check('absolute-mode offset rows get stepOffset backfilled as absoluteOffset', stored.rows[0].absoluteOffset === 62);
check('rows with an explicit absoluteOffset are left untouched', stored.rows[1].absoluteOffset === 59);
check('derz rows are NOT backfilled', stored.rows[2].absoluteOffset === undefined);

// re-read through the store: the backfilled preset keeps its values and readAll stays valid
const absPreset = (await fileStore.list()).find((p) => p.name === 'AbsMode');
check('backfilled preset round-trips through readAll normalization', absPreset.rows[0].absoluteOffset === 62);

// --- corrupt file surfaces a readable error ---
fs.writeFileSync(DATA_FILE, '{not json', 'utf-8');
let readErr = null;
try { await fileStore.list(); } catch (e) { readErr = e; }
check('corrupt data file throws PRESET_DATA_READ_ERROR', readErr && String(readErr.message).includes('Unable to read preset data') && readErr.code === 'PRESET_DATA_READ_ERROR');

// --- concurrent creates must not lose a preset (mutex) ---
fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
const results = await Promise.all([
  fileStore.create({ name: 'C1', rows: [] }),
  fileStore.create({ name: 'C2', rows: [] }),
  fileStore.create({ name: 'C3', rows: [] }),
  fileStore.create({ name: 'C4', rows: [] }),
]);
check('4 concurrent creates all persist (no lost update)', (await fileStore.list()).length === 4 && results.every((p) => p._id));

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(failures === 0 ? '\nAll fileStore tests passed.' : `\n${failures} fileStore test(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
