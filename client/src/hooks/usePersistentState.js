import { useEffect, useRef, useState } from 'react';

/**
 * useState that survives a reload or a module switch: the value is kept in
 * localStorage under `key`. If storage is unavailable (private window, blocked
 * site data) it silently behaves like plain useState.
 * @returns {[any, Function, boolean]} value, setter, and whether a saved value was found
 */
export function usePersistentState(key, initial) {
  const found = useRef(false);
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        found.current = true;
        return JSON.parse(raw);
      }
    } catch { /* storage unavailable or corrupt: start from the initial value */ }
    return typeof initial === 'function' ? initial() : initial;
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }, [key, value]);
  return [value, setValue, found.current];
}
