/* global __APP_COMMIT__, __APP_BUILT__ */
// The build's version (commit + when it was built): after an update is sent,
// the site shows the new number here once the server has rebuilt it.
const commit = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'yerel';
const built = typeof __APP_BUILT__ === 'string' ? new Date(__APP_BUILT__) : null;
const builtText = built && !Number.isNaN(built.getTime())
  ? built.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '';

export default function Footer() {
  return (
    <footer className="app-footer">
      <span>© {new Date().getFullYear()} Empire CNC</span>
      <span className="app-version" title="Sitenin şu an çalışan sürümü: kod numarası ve derlenme zamanı">
        Sürüm {commit}{builtText ? ` · ${builtText}` : ''}
      </span>
    </footer>
  );
}
