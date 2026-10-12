import { useEffect, useSyncExternalStore } from 'react';
import { defaultMagazine, normalizeMagazine } from '../lib/sim/toolMagazine.js';
import { handleAuthError } from './useAuth.js';

// One magazine for the whole app (Atölye edits it, every SimPanel reads it).
// The server holds it (/api/tools: MongoDB online, server/data on a local
// install): the admin's copy is the workshop DEFAULT; anyone else who changes
// it gets their OWN copy (scope 'own'), which resetMagazine() drops again.
// localStorage keeps the last copy for a quick start and offline use.
const KEY = 'empire-cnc-tool-magazine';
const API = '/api/tools';
const subscribers = new Set();
let cache = null;
let sync = { status: 'idle', message: '', scope: null }; // status: idle | loading | saved | local | error; scope: default | own
let started = false;
let saveTimer = null;

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
const notify = () => subscribers.forEach((f) => f());
function setSync(status, message = '', scope = sync.scope) { sync = { status, message, scope }; notify(); }
function keepLocal(m) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage unavailable */ } }

async function upload(m) {
  try {
    const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m), credentials: 'same-origin' });
    if (handleAuthError(res)) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setSync('saved', '', data.scope || null);
  } catch (err) {
    setSync('error', `Sunucuya kaydedilemedi (${err.message}); bu tarayıcıda duruyor.`);
  }
}

/** First use: take the server's copy; if the server has none yet, give it ours. */
async function start() {
  if (started) return;
  started = true;
  setSync('loading');
  try {
    const res = await fetch(API, { credentials: 'same-origin' });
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.value) {
      cache = normalizeMagazine(data.value);
      keepLocal(cache);
      setSync('saved', '', data.scope || null);
    } else {
      await upload(read());
    }
  } catch (err) {
    setSync('local', `Sunucuya ulaşılamadı (${err.message}); bu tarayıcıdaki liste kullanılıyor.`);
  }
}

export function setMagazine(next) {
  cache = typeof next === 'function' ? next(read()) : next;
  keepLocal(cache);
  notify();
  // typing in a field changes the list on every key: send once it settles
  clearTimeout(saveTimer);
  setSync('loading');
  const snapshot = cache;
  saveTimer = setTimeout(() => upload(snapshot), 600);
}

/** Drops this user's own tools: back to the workshop default. */
export async function resetMagazine() {
  clearTimeout(saveTimer);
  setSync('loading');
  try {
    const res = await fetch(API, { method: 'DELETE', credentials: 'same-origin' });
    if (handleAuthError(res)) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data && data.value) { cache = normalizeMagazine(data.value); keepLocal(cache); }
    setSync('saved', '', data?.scope || null);
  } catch (err) {
    setSync('error', `Varsayılana dönülemedi (${err.message}).`);
  }
}

function subscribe(fn) {
  subscribers.add(fn);
  const onStorage = (e) => { if (e.key === KEY) { cache = null; fn(); } };
  window.addEventListener('storage', onStorage);
  return () => { subscribers.delete(fn); window.removeEventListener('storage', onStorage); };
}

/** @returns {[{library:object[], slots:object, slotCount:number}, Function, {status:string, message:string, scope:string|null}]} */
export function useToolMagazine() {
  const magazine = useSyncExternalStore(subscribe, read);
  const status = useSyncExternalStore(subscribe, () => sync);
  useEffect(() => { start(); }, []);
  return [magazine, setMagazine, status];
}
