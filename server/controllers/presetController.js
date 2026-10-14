import Preset from '../models/Preset.js';
import { isMongoConnected } from '../config/db.js';
import { fileStore } from '../store/fileStore.js';
import { toolStore } from '../store/toolStore.js';
import { renderPresetImage, simToolsFrom } from '../services/presetImage.js';

// Normalizes a Mongoose document to the same plain-object shape the file
// store returns, so the frontend never has to care which backend is active.
function serializeMongoDoc(doc) {
  const obj = dropNulls(doc.toObject ? doc.toObject({ versionKey: false }) : doc);
  return { ...obj, _id: String(obj._id) };
}

// Fields the schema declares but a model never set come back as null. The
// generators treat "missing" and null differently (Number(null) is 0: a row
// spindle speed of null was written as "M3 S0"), so a stored model must read
// back exactly like the same model in presets.json: absent, not null.
function dropNulls(v) {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (v && typeof v === 'object' && !(v instanceof Date) && v.constructor === Object) {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) out[k] = dropNulls(x);
    return out;
  }
  return v;
}

// ---- who sees and changes what --------------------------------------------
// Default models (owner none) are the admin's: everyone sees them, only the admin
// changes or deletes them. Anyone else who changes a default gets their OWN copy
// of it (baseId = the default), which hides the default for them only; deleting
// that copy brings the default back. Users can also add models of their own.
const isAdmin = (req) => !req.user || req.user.role === 'admin';
const uid = (req) => (req.user ? String(req.user._id) : null);
const idOf = (p) => String(p._id);

/** Fields a client may not set: identity and ownership come from the server. */
function cleanBody(body) {
  const { _id, id, owner, baseId, scope, createdAt, updatedAt, __v, ...rest } = body || {};
  return rest;
}

const store = {
  async all(module) {
    if (isMongoConnected()) return (await Preset.find(module ? { module } : {}).sort({ name: 1 })).map(serializeMongoDoc);
    return fileStore.list(module);
  },
  async get(id) {
    if (isMongoConnected()) {
      const p = await Preset.findById(id).catch(() => null);
      return p ? serializeMongoDoc(p) : null;
    }
    return fileStore.get(id);
  },
  async create(data) {
    if (isMongoConnected()) return serializeMongoDoc(await Preset.create(data));
    return fileStore.create(data);
  },
  async update(id, data) {
    if (isMongoConnected()) {
      const p = await Preset.findByIdAndUpdate(id, data, { new: true, runValidators: true });
      return p ? serializeMongoDoc(p) : null;
    }
    return fileStore.update(id, data);
  },
  async remove(id) {
    if (isMongoConnected()) return Preset.findByIdAndDelete(id);
    return fileStore.remove(id);
  },
};

/** The list one user sees: defaults (minus those they changed) and their own, each with its scope. */
export function visibleFor(all, userId) {
  const own = userId ? all.filter((p) => p.owner === userId) : [];
  const defaults = all.filter((p) => !p.owner);
  const changed = new Set(own.map((p) => p.baseId).filter(Boolean));
  const defaultIds = new Set(defaults.map(idOf));
  return [
    ...defaults.filter((p) => !changed.has(idOf(p))).map((p) => ({ ...p, scope: 'default' })),
    ...own.map((p) => ({ ...p, scope: p.baseId && defaultIds.has(p.baseId) ? 'changed' : 'own' })),
  ].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function sendError(res, err, fallback = 400) {
  if (err.code === 11000) return res.status(409).json({ error: 'Bu isimde bir model zaten var.' });
  if (err.name === 'CastError') return res.status(404).json({ error: 'Model bulunamadı.' });
  return res.status(fallback).json({ error: err.message });
}

export async function listPresets(req, res) {
  try {
    res.json(visibleFor(await store.all(req.query.module), isAdmin(req) ? null : uid(req)));
  } catch (err) {
    sendError(res, err, 500);
  }
}

export async function getPreset(req, res) {
  try {
    const p = await store.get(req.params.id);
    if (!p || (p.owner && p.owner !== uid(req))) return res.status(404).json({ error: 'Model bulunamadı.' });
    res.json(p);
  } catch (err) {
    sendError(res, err, 500);
  }
}

export async function createPreset(req, res) {
  try {
    const data = cleanBody(req.body);
    if (!isAdmin(req)) {
      const module = data.module || 'kapak';
      const taken = (await store.all(module)).some((p) => !p.owner && p.name === String(data.name || '').trim());
      if (taken) return res.status(409).json({ error: 'Bu isimde bir varsayılan model var; başka bir isim verin ya da o modeli düzenleyin.' });
      data.owner = uid(req);
    }
    res.status(201).json(await store.create(data));
  } catch (err) {
    sendError(res, err);
  }
}

export async function updatePreset(req, res) {
  try {
    const target = await store.get(req.params.id);
    const me = uid(req);
    if (!target || (target.owner && target.owner !== me)) return res.status(404).json({ error: 'Model bulunamadı.' });
    const data = cleanBody(req.body);
    // the admin edits the defaults; a user edits their own models…
    if (isAdmin(req) || target.owner === me) return res.json(await store.update(req.params.id, data));
    // …and changing a default makes (or updates) their own copy of it
    const mine = (await store.all(target.module)).find((p) => p.owner === me && p.baseId === idOf(target));
    if (mine) return res.json(await store.update(idOf(mine), data));
    const { _id, createdAt, updatedAt, scope, ...base } = target;
    res.json(await store.create({ ...base, ...data, owner: me, baseId: idOf(target) }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function deletePreset(req, res) {
  try {
    const target = await store.get(req.params.id);
    const me = uid(req);
    if (!target || (target.owner && target.owner !== me)) return res.status(404).json({ error: 'Model bulunamadı.' });
    if (!target.owner && !isAdmin(req)) return res.status(403).json({ error: 'Varsayılan modelleri yalnızca yönetici silebilir.' });
    await store.remove(req.params.id);
    res.status(204).send();
  } catch (err) {
    sendError(res, err, 500);
  }
}

/** A deleted account's own models go with it. */
export async function removeUserPresets(userId) {
  if (!userId) return;
  if (isMongoConnected()) { await Preset.deleteMany({ owner: String(userId) }); return; }
  for (const p of (await fileStore.list()).filter((x) => x.owner === String(userId))) await fileStore.remove(p._id);
}

/**
 * "Görselleri yenile": every kapak model's picture is made again from its own rows
 * by the simulation. The admin renders the defaults with the default tools; a user
 * renders their own models with their own tools. Only imageDataUrl changes.
 */
export async function renderPresetImages(req, res) {
  try {
    const me = isAdmin(req) ? null : uid(req);
    const tools = simToolsFrom((await toolStore.get(me))?.value || null);
    const list = (await store.all()).filter((p) => (me ? p.owner === me : !p.owner));
    const done = [], skipped = [];
    for (const p of list) {
      if ((p.category || 'kapak') !== 'kapak') continue;
      const r = renderPresetImage(p, tools);
      if (!r) { skipped.push(p.name); continue; }
      // an unchanged picture is not written again (no new updatedAt, no noise in presets.json)
      if (r.dataUrl === p.imageDataUrl) { done.push(p.name); continue; }
      if (isMongoConnected()) await Preset.updateOne({ _id: p._id }, { $set: { imageDataUrl: r.dataUrl } });
      else await fileStore.update(p._id, { imageDataUrl: r.dataUrl });
      done.push(p.name);
    }
    res.json({ done, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
