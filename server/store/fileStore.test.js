// fileStore.test.js
// Plain-node unit tests for the preset file store (node server/store/fileStore.test.js).
// Uses a temp PRESETS_DATA_DIR so the live data file is never touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
// check(name, condition) — istemci testleriyle AYNI imza. Bu dosya oradan
// kopyalandığında imza fn almak üzere kalmış, çağrılar boolean geçirdiği için
// "fn is not a function" ile tüm dosya çöküyordu.
function check(name, cond) {
  try {
    let ok;
    if (typeof cond === 'function') ok = cond();
    else if (cond === undefined) ok = true;   // assert.throws(...) undefined döner; varlığı yeter
    else ok = cond;
    if (!ok) throw new Error('koşul sağlanmadı');
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

// --- row-emission flags (roughing / chain / repeatStartY) ---
// These three are read by kapak.js emitOffsetPasses but were missing from the
// Mongoose schema, so an API POST/PUT stripped them and a preset saved through
// the app lost its toolpath (1 NUMARA roughing -> square clearing passes,
// 7 NUMARA chain -> no retract/re-plunge between the inner rings). The store
// must persist the true flags and materialise the rest as explicit false.
const flagPreset = await fileStore.create({
  name: 'FlagMode',
  offsetMode: 'absolute',
  rows: [
    { name: 'rough', toolNo: '6', depth: 6, stepOffset: 62, absoluteOffset: 62, roughing: true },
    { name: 'chained', toolNo: '6', depth: 6, stepOffset: 59, absoluteOffset: 59, chain: true },
    { name: 'ring', toolNo: '12', depth: 5, stepOffset: 139.1, absoluteOffset: 139.1, repeatStartY: true },
    { name: 'plain', toolNo: '9', depth: 3, stepOffset: 60, absoluteOffset: 60 },
  ],
});
const flagStored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')).find((p) => p.name === 'FlagMode');
check('roughing survives the write path', flagStored.rows[0].roughing === true);
check('chain survives the write path', flagStored.rows[1].chain === true);
check('repeatStartY survives the write path', flagStored.rows[2].repeatStartY === true);
check('rows without a flag are written as explicit false (not undefined)', flagStored.rows[3].roughing === false && flagStored.rows[3].chain === false && flagStored.rows[3].repeatStartY === false);
check('create() returns the flag-carrying preset', flagPreset.rows[0].roughing === true);

const flagRead = (await fileStore.list()).find((p) => p.name === 'FlagMode');
check('flags round-trip through readAll', flagRead.rows[0].roughing === true && flagRead.rows[1].chain === true && flagRead.rows[2].repeatStartY === true);

// --- derz sub-fields read by kapak.js (startY / spindleSpeed) ---
// Same failure class as the row flags above: emitDerzRows reads derz.startY
// (1/12 NUMARA dividers start at Y70, not rows[0]'s 62) and derz.spindleSpeed
// (2 NUMARA's derz block runs at S15000), but neither was in the Mongoose schema.
const derzPreset = await fileStore.create({
  name: 'DerzFields',
  offsetMode: 'absolute',
  rows: [
    { name: 'derz', toolNo: '1', depth: 3, stepOffset: 89, operation: 'derz', derz: { yon: 'dikey', margin: 89, spacing: 19, overshootY: 0, startY: 70, spindleSpeed: 15000, respectPreviousOffset: false } },
  ],
});
const derzStored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')).find((p) => p.name === 'DerzFields');
check('derz.startY survives the write path', derzStored.rows[0].derz.startY === 70);
check('derz.spindleSpeed survives the write path', derzStored.rows[0].derz.spindleSpeed === 15000);
check('derz.startY round-trips through readAll', derzPreset.rows[0].derz.startY === 70);

// A flag flipping off must also persist (not be re-derived as true).
await fileStore.update(flagPreset._id, {
  rows: [
    { name: 'rough', toolNo: '6', depth: 6, stepOffset: 62, absoluteOffset: 62 },
  ],
});
const flagUpdated = (await fileStore.list()).find((p) => p.name === 'FlagMode');
check('update clears flags when the new rows omit them', flagUpdated.rows[0].roughing === false && flagUpdated.rows.length === 1);

// --- legacy rows: a preset saved without the flags still reads cleanly ---
// Simulates an existing presets.json entry (pre-migration) with no flags on any row.
const legacy = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
legacy.push({
  _id: 'legacy_1', name: 'LegacyRow', module: 'kapak', offsetMode: 'absolute',
  rows: [{ name: 'old', toolNo: '6', depth: 6, stepOffset: 62, absoluteOffset: 62 }],
});
fs.writeFileSync(DATA_FILE, JSON.stringify(legacy, null, 2), 'utf-8');
const legacyRead = (await fileStore.list()).find((p) => p.name === 'LegacyRow');
check('legacy rows (no flags in file) read as explicit false', legacyRead.rows[0].roughing === false && legacyRead.rows[0].chain === false && legacyRead.rows[0].repeatStartY === false);

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
