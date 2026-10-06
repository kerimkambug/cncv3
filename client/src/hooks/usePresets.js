import { useCallback, useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/presets';
const STORAGE_KEY = 'empire-cnc-presets';

function readLocalPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalPresets(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function normalizePreset(raw) {
  const id = raw._id ?? raw.id ?? `${raw.module ?? 'preset'}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    ...raw,
    _id: id,
    id,
    module: raw.module ?? 'kapak',
  };
}

// Presets saved/seeded before per-row `absoluteOffset` existed declare only
// `stepOffset` on their offset rows. In absolute offset mode the step value IS
// the distance from the part edge, so backfilling it as `absoluteOffset` keeps
// the kapak.js pinning logic (and anything else reading absoluteOffset) working
// on a defined number. Relative-mode rows are left untouched on purpose: a
// backfilled pin there would change the cumulative chain semantics.
function normalizeOffsetRows(preset) {
  if (!preset || preset.offsetMode !== 'absolute' || !Array.isArray(preset.rows)) return preset;
  return {
    ...preset,
    rows: preset.rows.map((row) => {
      if (row == null || (row.operation || 'offset') !== 'offset') return row;
      if (row.absoluteOffset !== undefined && row.absoluteOffset !== null) return row;
      return { ...row, absoluteOffset: row.stepOffset };
    }),
  };
}

// Row-emission flags the G-code engine reads (kapak.js emitOffsetPasses) but which
// do NOT appear on every row: `roughing` (square clearing pass), `chain`
// (continue at depth without retract/re-plunge) and `repeatStartY` (repeat the
// start Y on the cut move). The server schema now stores them explicitly; this
// mirrors that so a preset loaded from localStorage (the no-server fallback) or
// from an older API payload without the flags still reaches kapak.js with a
// defined boolean instead of `undefined` (the engine tests `=== true`, so
// undefined and false behave the same — normalising just keeps the data shape
// identical between the API and localStorage paths).
const ROW_FLAG_KEYS = ['roughing', 'chain', 'repeatStartY'];
function normalizeRowFlags(preset) {
  if (!preset || !Array.isArray(preset.rows)) return preset;
  return {
    ...preset,
    rows: preset.rows.map((row) => {
      if (row == null) return row;
      const missing = ROW_FLAG_KEYS.some((key) => row[key] === undefined);
      if (!missing) return row;
      const next = { ...row };
      ROW_FLAG_KEYS.forEach((key) => { if (next[key] === undefined) next[key] = false; });
      return next;
    }),
  };
}

function normalizePresetRows(preset) {
  return normalizeRowFlags(normalizeOffsetRows(preset));
}

// Validation pass: flags absolute-mode offset rows whose source data carried no
// usable absoluteOffset. The loader backfills them from stepOffset, so this is
// advisory — it makes silently-fixed data visible instead of invisible.
const warnedMissingAbsoluteOffset = new Set();
function validateOffsetRows(presets) {
  if (!Array.isArray(presets)) return;
  presets.forEach((preset, presetIdx) => {
    if (!preset || preset.offsetMode !== 'absolute' || !Array.isArray(preset.rows)) return;
    const presetKey = String(preset._id || preset.id || preset.name || `index-${presetIdx}`);
    preset.rows.forEach((row, rowIdx) => {
      if (row == null || (row.operation || 'offset') !== 'offset') return;
      if (row.absoluteOffset !== undefined && row.absoluteOffset !== null) return;
      const warnKey = `${presetKey}:${rowIdx}`;
      if (warnedMissingAbsoluteOffset.has(warnKey)) return;
      warnedMissingAbsoluteOffset.add(warnKey);
      console.warn(
        `[presets] "${preset.name || presetKey}" satır ${rowIdx + 1}${row.name ? ` (${row.name})` : ''}: offsetMode absolute ama absoluteOffset eksik — stepOffset fallback kullanılıyor.`,
      );
    });
  });
}

/**
 * Works both with a backend API and with localStorage only, so the client can
 * run without a server in production builds.
 */
export function usePresets(moduleName) {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}?module=${moduleName}`);
      if (!res.ok) throw new Error('Presetler yüklenemedi.');
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      validateOffsetRows(list);
      setPresets(list.map(normalizePresetRows));
      setError(null);
    } catch {
      const localData = readLocalPresets().filter((item) => item.module === moduleName).map(normalizePreset);
      validateOffsetRows(localData);
      setPresets(localData.map(normalizePresetRows));
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [moduleName]);

  useEffect(() => { refresh(); }, [refresh]);

  const savePreset = useCallback(async (name, data, id = null) => {
    const payload = { name, module: moduleName, ...data };
    const url = id ? `${API_BASE}/${id}` : API_BASE;
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || (id ? 'Preset güncellenemedi.' : 'Preset oluşturulamadı.'));
      }
      await refresh();
      return;
    } catch (error) {
      // Only use localStorage as a fallback when the API is unavailable. Do not
      // hide real API errors such as duplicate names or failed updates.
      if (error.message !== 'Failed to fetch' && !error.message.includes('NetworkError')) throw error;
      const existing = readLocalPresets();
      const nextItem = normalizePreset({ ...payload, _id: id || crypto.randomUUID?.() || Date.now().toString() });
      const filtered = existing.filter((item) => id ? item.id !== id && item._id !== id : !(item.module === moduleName && item.name === name));
      writeLocalPresets([...filtered, nextItem]);
      await refresh();
    }
  }, [moduleName, refresh]);

  const deletePreset = useCallback(async (id) => {
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Preset silinemedi.');
      }
      await refresh();
      return;
    } catch (error) {
      if (error.message !== 'Failed to fetch' && !error.message.includes('NetworkError')) throw error;
      const existing = readLocalPresets().filter((item) => item.id !== id && item._id !== id);
      writeLocalPresets(existing);
      await refresh();
    }
  }, [refresh]);

  return { presets, loading, error, refresh, savePreset, deletePreset };
}
