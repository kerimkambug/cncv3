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
const mine = { ...sample, slots: { 9: null } };

await check('empty store answers null (the browser then uploads its copy)', async () => {
  assert.equal(await toolStore.get(), null);
});
await check('the default round-trips through the file', async () => {
  await toolStore.set(sample);
  const got = await toolStore.get();
  assert.deepEqual(got.value, sample);
  assert.equal(got.scope, 'default');
  assert.ok(fs.existsSync(path.join(dir, 'bicaklar.json')));
});
await check('a user own copy wins for that user only, and clearing it restores the default', async () => {
  await toolStore.set(mine, 'u1');
  assert.deepEqual((await toolStore.get('u1')).value, mine);
  assert.equal((await toolStore.get('u1')).scope, 'own');
  assert.deepEqual((await toolStore.get('u2')).value, sample);
  assert.deepEqual((await toolStore.getDefault()).value, sample, 'the default is untouched');
  assert.ok(!fs.readFileSync(path.join(dir, 'bicaklar.json'), 'utf8').includes('null'), 'own copy not in the default file');
  await toolStore.clear('u1');
  assert.equal((await toolStore.get('u1')).scope, 'default');
});
await check('validation rejects a broken list', async () => {
  assert.match(validateTools({ slots: {} }), /bozuk/);
  assert.match(validateTools({ library: [{ name: 'x' }], slots: {} }), /id ve tipi/);
  assert.equal(validateTools(sample), '');
});
await check('route: the admin PUTs the default, a user PUTs their own copy and DELETE drops it', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { _id: req.headers['x-user'], role: req.headers['x-role'] || 'user' }; next(); });
  app.use('/api/tools', toolRoutes);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/tools`;
  const as = (user, role = 'user') => ({ 'Content-Type': 'application/json', 'x-user': user, 'x-role': role });
  try {
    assert.deepEqual((await (await fetch(base, { headers: as('u1') })).json()).value, sample);
    const put = await fetch(base, { method: 'PUT', headers: as('u1'), body: JSON.stringify(mine) });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).scope, 'own');
    assert.deepEqual((await toolStore.getDefault()).value, sample, 'a user cannot change the default');
    const back = await (await fetch(base, { method: 'DELETE', headers: as('u1') })).json();
    assert.equal(back.scope, 'default');
    const next = { ...sample, slotCount: 14 };
    await fetch(base, { method: 'PUT', headers: as('a', 'admin'), body: JSON.stringify(next) });
    assert.deepEqual((await toolStore.getDefault()).value, next, 'the admin changes the default');
    const bad = await fetch(base, { method: 'PUT', headers: as('u1'), body: '{"slots":{}}' });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});

fs.rmSync(dir, { recursive: true, force: true });
if (failures) { console.log(`${failures} test failed`); process.exit(1); }
console.log('ALL CHECKS PASSED');
