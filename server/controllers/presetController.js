import Preset from '../models/Preset.js';
import { isMongoConnected } from '../config/db.js';
import { fileStore } from '../store/fileStore.js';

// Normalizes a Mongoose document to the same plain-object shape the file
// store returns, so the frontend never has to care which backend is active.
function serializeMongoDoc(doc) {
  const obj = doc.toObject({ versionKey: false });
  return { ...obj, _id: String(obj._id) };
}

export async function listPresets(req, res) {
  try {
    const { module } = req.query;
    if (isMongoConnected()) {
      const filter = module ? { module } : {};
      const presets = await Preset.find(filter).sort({ name: 1 });
      return res.json(presets.map(serializeMongoDoc));
    }
    res.json(await fileStore.list(module));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPreset(req, res) {
  try {
    if (isMongoConnected()) {
      const preset = await Preset.findById(req.params.id);
      if (!preset) return res.status(404).json({ error: 'Preset bulunamadı.' });
      return res.json(serializeMongoDoc(preset));
    }
    const preset = await fileStore.get(req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset bulunamadı.' });
    res.json(preset);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: 'Preset bulunamadı.' });
    }
    res.status(500).json({ error: err.message });
  }
}

export async function createPreset(req, res) {
  try {
    if (isMongoConnected()) {
      const preset = await Preset.create(req.body);
      return res.status(201).json(serializeMongoDoc(preset));
    }
    const preset = await fileStore.create(req.body);
    res.status(201).json(preset);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Bu isimde bir preset zaten var.' });
    }
    res.status(400).json({ error: err.message });
  }
}

export async function updatePreset(req, res) {
  try {
    if (isMongoConnected()) {
      const preset = await Preset.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
      if (!preset) return res.status(404).json({ error: 'Preset bulunamadı.' });
      return res.json(serializeMongoDoc(preset));
    }
    const preset = await fileStore.update(req.params.id, req.body);
    if (!preset) return res.status(404).json({ error: 'Preset bulunamadı.' });
    res.json(preset);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: 'Preset bulunamadı.' });
    }
    res.status(400).json({ error: err.message });
  }
}

export async function deletePreset(req, res) {
  try {
    if (isMongoConnected()) {
      const preset = await Preset.findByIdAndDelete(req.params.id);
      if (!preset) return res.status(404).json({ error: 'Preset bulunamadı.' });
      return res.status(204).send();
    }
    const preset = await fileStore.remove(req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset bulunamadı.' });
    res.status(204).send();
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: 'Preset bulunamadı.' });
    }
    res.status(500).json({ error: err.message });
  }
}
