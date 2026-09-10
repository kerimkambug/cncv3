export default function Topnav({ onHome }) {
  return (
    <header className="topnav">
      <div className="topnav-brand" onClick={onHome} style={{ cursor: onHome ? 'pointer' : 'default' }}>
        <span className="topnav-logo">⚙</span> Empire CNC
        <span className="topnav-tagline">G-code Üretici</span>
      </div>
      <div className="topnav-right">
        <span className="topnav-badge">MERN sürümü — presetler sunucuda saklanır</span>
      </div>
    </header>
  );
}
