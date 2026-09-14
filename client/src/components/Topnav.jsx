export default function Topnav({ onHome, theme, setTheme }) {
  return (
    <header className="topnav">
      <div className="topnav-brand" onClick={onHome} style={{ cursor: onHome ? 'pointer' : 'default' }}>
        <span className="topnav-logo">⚙</span> Empire CNC
        <span className="topnav-tagline">Profesyonel CNC Üretim Platformu</span>
      </div>
      <div className="topnav-right">
        <span className="topnav-badge">Ölçüden üretime, hızlı ve hassas CNC dosyaları</span>
        <div className="theme-control">
          <button
            type="button"
            className="theme-toggle"
            aria-label={theme.mode === 'dark' ? 'Açık temaya geç' : 'Gece moduna geç'}
            title={theme.mode === 'dark' ? 'Açık temaya geç' : 'Gece moduna geç'}
            onClick={() => setTheme((current) => ({ mode: current.mode === 'dark' ? 'light' : 'dark' }))}
          >
            <span aria-hidden="true">{theme.mode === 'dark' ? '☀' : '☾'}</span>
            {theme.mode === 'dark' ? 'Açık tema' : 'Gece modu'}
          </button>
        </div>
      </div>
    </header>
  );
}
