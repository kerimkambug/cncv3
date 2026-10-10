import { useEffect, useRef, useState } from 'react';
import { logout } from '../hooks/useAuth.js';

// Production screens, left to right in the top menu.
export const MAIN_SCREENS = [
  { key: 'kapak', label: 'Kapak' },
  { key: 'batch', label: 'Toplu Liste' },
  { key: 'nesting', label: 'Nesting' },
  { key: 'cam', label: 'Cam' },
  { key: 'panjur', label: 'Panjur' },
  { key: 'cerezlik', label: 'Çerezlik' },
  { key: 'relief', label: '3D Rölyef' },
];
// Occasional helpers, under "Araçlar".
export const TOOL_SCREENS = [
  { key: 'circle', label: 'Daire Kesimi' },
  { key: 'derz', label: 'Derz Bölme' },
  { key: 'gcode-dxf', label: 'G-code → DXF' },
];

/**
 * One top bar for the whole app: the production screens, an "Araçlar" menu for
 * the occasional helpers, and "Atölye" (machine + model settings) on the right.
 */
export default function Topnav({ screen, onNavigate, theme, setTheme, me = null }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef(null);
  useEffect(() => {
    if (!toolsOpen) return undefined;
    const close = (e) => { if (!toolsRef.current?.contains(e.target)) setToolsOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [toolsOpen]);
  const go = (key) => { setToolsOpen(false); onNavigate(key); };
  const activeTool = TOOL_SCREENS.find((t) => t.key === screen);

  return (
    <header className="topnav">
      <div className="topnav-brand" onClick={() => go('kapak')} style={{ cursor: 'pointer' }}>
        <span className="topnav-logo">⚙</span> Empire CNC
      </div>
      <nav className="topnav-nav" aria-label="Ekranlar">
        {MAIN_SCREENS.map((s) => (
          <button key={s.key} type="button" className={`nav-btn${screen === s.key ? ' active' : ''}`} onClick={() => go(s.key)}>
            {s.label}
          </button>
        ))}
        <div className="nav-dropdown" ref={toolsRef}>
          <button
            type="button"
            className={`nav-btn${activeTool ? ' active' : ''}`}
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((o) => !o)}
          >
            {activeTool ? activeTool.label : 'Araçlar'} ▾
          </button>
          {toolsOpen && (
            <div className="nav-menu" role="menu">
              {TOOL_SCREENS.map((t) => (
                <button key={t.key} type="button" role="menuitem" className={screen === t.key ? 'active' : ''} onClick={() => go(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>
      <div className="topnav-right">
        {me?.user && (
          <span className="topnav-user" title={me.user.email}>
            {me.user.name || me.user.email}
            {me.user.role !== 'admin' && me.user.accessUntil && <small> · {new Date(me.user.accessUntil).toLocaleDateString('tr-TR')} tarihine kadar</small>}
            <button type="button" className="link-btn" onClick={logout}>Çıkış</button>
          </span>
        )}
        <button type="button" className={`nav-btn atolye-btn${screen === 'atolye' ? ' active' : ''}`} onClick={() => go('atolye')}>
          ⚙ Atölye
        </button>
        <button
          type="button"
          className="theme-toggle"
          aria-label={theme.mode === 'dark' ? 'Açık temaya geç' : 'Gece moduna geç'}
          title={theme.mode === 'dark' ? 'Açık temaya geç' : 'Gece moduna geç'}
          onClick={() => setTheme((current) => ({ mode: current.mode === 'dark' ? 'light' : 'dark' }))}
        >
          <span aria-hidden="true">{theme.mode === 'dark' ? '☀' : '☾'}</span>
        </button>
      </div>
    </header>
  );
}
