import { useEffect, useState } from 'react';

/**
 * The signed-in account ({ user, problem }) from the server. On the plain
 * development server (vite, no session) it simply stays null and the app runs
 * as before.
 */
export function useAuth() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setMe(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return me;
}

export async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* reload anyway */ }
  window.location.href = '/';
}

/** A request answered "not signed in" means the session ended: back to the login page. */
export function handleAuthError(res) {
  // (the vite development server has no login page: nothing to go back to there)
  if (res && res.status === 401 && !import.meta.env.DEV) {
    window.location.href = '/';
    return true;
  }
  return false;
}
