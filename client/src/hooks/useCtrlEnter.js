import { useEffect } from 'react';

/** Calls `callback` whenever the user presses Ctrl+Enter (or Cmd+Enter on Mac). */
export function useCtrlEnter(callback) {
  useEffect(() => {
    function handler(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        callback();
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [callback]);
}
