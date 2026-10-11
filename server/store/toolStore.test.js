// toolStore.test.js — plain-node tests for the tool library store and its route
// (node server/store/toolStore.test.js). Uses a temp TOOLS_DATA_DIR so the live
// server/data/bicaklar.json is never touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'));
process.env.TOOLS_DATA_DIR = dir;
const { toolStore, validateTools } = await import('./toolStore.js');
const { default: toolRoutes } = await import('../routes/toolRoutes.js');

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); } catch (err) { failures++; console.log(`✗ ${name}\n  ${err.message}`); }
}

const sample = { library: [{ id: 'b9', name: 'tabla', type: 'custom', dia: 21.6, profile: [[0, 0], [10.8, 5.8]] }], slots: { 9: 'b9' }, slotCount: 12 };

await check('empty store answers null (the browser then uploads its copy)', async () => {
  assert.equal(await toolStore.get(), null);
});
await check('set then get round-trips through the file', async () => {
  await toolStore.set(sample);
  const got = await toolStore.get();
  assert.deepEqual(got.value, sample);
  assert.ok(fs.existsSync(path.join(dir, 'bicaklar.json')));
});
await check('validation rejects a broken list', async () => {
  assert.match(validateTools({ slots: {} }), /bozuk/);
  assert.match(validateTools({ library: [{ name: 'x' }], slots: {} }), /id ve tipi/);
  assert.equal(validateTools(sample), '');
});
await check('route: GET returns the saved list, PUT replaces it, a bad PUT is refused', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tools', toolRoutes);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/tools`;
  try {
    assert.deepEqual((await (await fetch(base)).json()).value, sample);
    const next = { ...sample, slots: { 9: null } };
    const put = await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    assert.equal(put.status, 200);
    assert.deepEqual((await toolStore.get()).value, next);
    const bad = await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"slots":{}}' });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});

fs.rmSync(dir, { recursive: true, force: true });
if (failures) { console.log(`${failures} test failed`); process.exit(1); }
console.log('ALL CHECKS PASSED');
