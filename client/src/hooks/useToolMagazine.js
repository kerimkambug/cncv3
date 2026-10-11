import { useSyncExternalStore } from 'react';
import { defaultMagazine, normalizeMagazine } from '../lib/sim/toolMagazine.js';

// One magazine for the whole app (Atölye edits it, every SimPanel reads it),
// kept in localStorage and shared between open tabs.
const KEY = 'empire-cnc-tool-magazine';
const subscribers = new Set();
let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? normalizeMagazine(JSON.parse(raw)) : defaultMagazine();
  } catch {
    cache = defaultMagazine();
  }
  return cache;
}

export function setMagazine(next) {
  cache = typeof next === 'function' ? next(read()) : next;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage unavailable */ }
  subscribers.forEach((f) => f());
}

function subscribe(fn) {
  subscribers.add(fn);
  const onStorage = (e) => { if (e.key === KEY) { cache = null; fn(); } };
  window.addEventListener('storage', onStorage);
  return () => { subscribers.delete(fn); window.removeEventListener('storage', onStorage); };
}

/** @returns {[{library:object[], slots:object, slotCount:number}, Function]} */
export function useToolMagazine() {
  return [useSyncExternalStore(subscribe, read), setMagazine];
}
