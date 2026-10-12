// presetController.test.js — default models (the admin's) and users' own models
// (node server/controllers/presetController.test.js). File store in a temp dir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-'));
process.env.PRESETS_DATA_DIR = dir;
process.env.TOOLS_DATA_DIR = dir;
const { default: presetRoutes } = await import('../routes/presetRoutes.js');
const { removeUserPresets } = await import('./presetController.js');

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); } catch (err) { failures++; console.log(`✗ ${name}\n  ${err.message}`); }
}

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { _id: req.headers['x-user'], role: req.headers['x-role'] || 'user' }; next(); });
app.use('/api/presets', presetRoutes);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/presets`;
const as = (user, role = 'user') => ({ 'Content-Type': 'application/json', 'x-user': user, 'x-role': role });
const call = async (method, url, user, body, role) => {
  const res = await fetch(base + url, { method, headers: as(user, role), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const list = async (user, role) => (await call('GET', '?module=kapak', user, null, role)).body;
const rows = (depth) => [{ toolNo: '6', depth, stepOffset: 60 }];

let defaultId, copyId;
try {
  await check('the admin adds a default model; every user sees it as default', async () => {
    const r = await call('POST', '', 'admin1', { name: 'A', module: 'kapak', rows: rows(5) }, 'admin');
    assert.equal(r.status, 201);
    defaultId = r.body._id;
    assert.equal(r.body.owner, undefined);
    const l = await list('u1');
    assert.deepEqual(l.map((p) => [p.name, p.scope]), [['A', 'default']]);
  });

  await check('a user changing a default gets an own copy; others and the default are untouched', async () => {
    const r = await call('PUT', `/${defaultId}`, 'u1', { name: 'A', module: 'kapak', rows: rows(8) });
    assert.equal(r.status, 200);
    copyId = r.body._id;
    assert.notEqual(copyId, defaultId);
    const l1 = await list('u1');
    assert.deepEqual(l1.map((p) => [p.name, p.scope, p.rows[0].depth]), [['A', 'changed', 8]]);
    const l2 = await list('u2');
    assert.deepEqual(l2.map((p) => [p.name, p.scope, p.rows[0].depth]), [['A', 'default', 5]]);
    // the users' models never go into the presets.json kept in git
    assert.ok(!fs.readFileSync(path.join(dir, 'presets.json'), 'utf8').includes('"u1"'));
    assert.ok(fs.readFileSync(path.join(dir, 'user-presets.json'), 'utf8').includes('"u1"'));
  });

  await check('changing the default again updates the same copy', async () => {
    const r = await call('PUT', `/${defaultId}`, 'u1', { name: 'A', module: 'kapak', rows: rows(9) });
    assert.equal(r.body._id, copyId);
  });

  await check('a user cannot delete a default, nor see or touch another user\'s model', async () => {
    assert.equal((await call('DELETE', `/${defaultId}`, 'u1')).status, 403);
    assert.equal((await call('GET', `/${copyId}`, 'u2')).status, 404);
    assert.equal((await call('PUT', `/${copyId}`, 'u2', { name: 'x' })).status, 404);
    assert.equal((await call('DELETE', `/${copyId}`, 'u2')).status, 404);
  });

  await check('deleting the own copy brings the default back', async () => {
    assert.equal((await call('DELETE', `/${copyId}`, 'u1')).status, 204);
    assert.deepEqual((await list('u1')).map((p) => [p.name, p.scope, p.rows[0].depth]), [['A', 'default', 5]]);
  });

  await check('users add models of their own; a default name is refused; the admin does not see them', async () => {
    assert.equal((await call('POST', '', 'u1', { name: 'A', module: 'kapak', rows: rows(3) })).status, 409);
    const r = await call('POST', '', 'u1', { name: 'B', module: 'kapak', rows: rows(3), owner: 'u2' });
    assert.equal(r.status, 201);
    assert.equal(r.body.owner, 'u1', 'the owner comes from the session, not the body');
    assert.equal((await call('POST', '', 'u2', { name: 'B', module: 'kapak', rows: rows(3) })).status, 201, 'two users may use the same name');
    assert.deepEqual((await list('u1')).map((p) => [p.name, p.scope]), [['A', 'default'], ['B', 'own']]);
    assert.deepEqual((await list('admin1', 'admin')).map((p) => p.name), ['A']);
  });

  await check('the admin\'s change of a default reaches users without a copy', async () => {
    await call('PUT', `/${defaultId}`, 'admin1', { name: 'A', module: 'kapak', rows: rows(6) }, 'admin');
    assert.equal((await list('u2')).find((p) => p.name === 'A').rows[0].depth, 6);
  });

  await check('a deleted account takes its own models with it', async () => {
    await removeUserPresets('u1');
    assert.deepEqual((await list('u1')).map((p) => p.name), ['A']);
    assert.deepEqual((await list('u2')).map((p) => p.name), ['A', 'B']);
  });
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

if (failures) { console.log(`${failures} test failed`); process.exit(1); }
console.log('ALL CHECKS PASSED');
