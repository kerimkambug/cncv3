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
      setPresets(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      const localData = readLocalPresets().filter((item) => item.module === moduleName).map(normalizePreset);
      setPresets(localData);
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
