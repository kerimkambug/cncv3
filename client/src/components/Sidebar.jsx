import { useState } from 'react';

const KAPAK_OPS = [
  { key: 'single', label: 'Tek Ölçü' },
  { key: 'batch', label: 'Toplu Liste' },
  { key: 'nesting', label: 'Nesting' },
  { key: 'circle', label: 'Daire Kesimi' },
  { key: 'derz', label: 'Derz Bölme' },
];

/**
 * @param {object} props
 * @param {'kapak'|'cam'|'panjur'|'relief'} props.activeModule
 * @param {string} props.activeOp - active operation key within the Kapak module
 * @param {(mod:'kapak'|'cam'|'panjur', op?:string) => void} props.onNavigate
 */
export default function Sidebar({ activeModule, activeOp, onNavigate }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <nav className="sidebar">
      <button
        type="button"
        className={`sidebar-nav-btn${activeModule === 'kapak' ? ' active' : ''}`}
        onClick={() => { setExpanded((v) => !v); onNavigate('kapak', activeOp); }}
      >
        <span className="sidebar-nav-icon">🚪</span>
        <span className="sidebar-nav-label">Kapak Modelleri</span>
        <span className="sidebar-caret">{expanded ? '▾' : '▸'}</span>
      </button>

      <div className={`sidebar-subnav${expanded ? '' : ' collapsed'}`}>
        {KAPAK_OPS.map((op) => (
          <button
            key={op.key}
            type="button"
            className={`sidebar-sub-btn${activeModule === 'kapak' && activeOp === op.key ? ' active' : ''}`}
            onClick={() => onNavigate('kapak', op.key)}
          >
            {op.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`sidebar-nav-btn${activeModule === 'cam' ? ' active' : ''}`}
        onClick={() => onNavigate('cam')}
      >
        <span className="sidebar-nav-icon">🪟</span>
        <span className="sidebar-nav-label">Cam Modelleri</span>
      </button>

      <button
        type="button"
        className={`sidebar-nav-btn${activeModule === 'panjur' ? ' active' : ''}`}
        onClick={() => onNavigate('panjur')}
      >
        <span className="sidebar-nav-icon">▤</span>
        <span className="sidebar-nav-label">Panjur Kapak</span>
      </button>

      <button
        type="button"
        className={`sidebar-nav-btn${activeModule === 'relief' ? ' active' : ''}`}
        onClick={() => onNavigate('relief')}
      >
        <span className="sidebar-nav-icon">🗿</span>
        <span className="sidebar-nav-label">3D Rölyef</span>
      </button>

    </nav>
  );
}
