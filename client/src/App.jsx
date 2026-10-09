import { useEffect, useState } from 'react';
import Topnav, { MAIN_SCREENS, TOOL_SCREENS } from './components/Topnav.jsx';
import Footer from './components/Footer.jsx';
import TekOlcu from './components/kapak/TekOlcu.jsx';
import TopluListe from './components/kapak/TopluListe.jsx';
import NestingPanel from './components/kapak/NestingPanel.jsx';
import DaireKesimi from './components/kapak/DaireKesimi.jsx';
import DerzBolme from './components/kapak/DerzBolme.jsx';
import AtolyePage from './components/kapak/AtolyePage.jsx';
import CamModule from './components/cam/CamModule.jsx';
import PanjurModule from './components/panjur/PanjurModule.jsx';
import ReliefGenerator from './components/ReliefGenerator.jsx';
import GcodeDxfConverter from './components/GcodeDxfConverter.jsx';
import { useKapakWorkspace } from './hooks/useKapakWorkspace.js';
import { usePersistentState } from './hooks/usePersistentState.js';
import { usePresets } from './hooks/usePresets.js';

const KNOWN = new Set([...MAIN_SCREENS, ...TOOL_SCREENS].map((s) => s.key).concat('atolye'));

export default function App() {
  const [screen, setScreen] = usePersistentState('empire-cnc-screen', 'kapak');
  const current = KNOWN.has(screen) ? screen : 'kapak';
  const workspace = useKapakWorkspace();
  const { presets, loading } = usePresets('kapak');
  const [theme, setTheme] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('empire-cnc-theme'));
      return { mode: saved?.mode === 'light' ? 'light' : 'dark' };
    } catch {
      return { mode: 'dark' };
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme.mode;
    try { localStorage.setItem('empire-cnc-theme', JSON.stringify(theme)); } catch { /* storage unavailable */ }
  }, [theme]);

  const kapakProps = { workspace, presets, presetsLoading: loading };
  return (
    <div className="app-layout">
      <Topnav screen={current} onNavigate={setScreen} theme={theme} setTheme={setTheme} />
      <main className="main-content">
        {current === 'kapak' && <TekOlcu {...kapakProps} />}
        {current === 'batch' && <TopluListe {...kapakProps} />}
        {current === 'nesting' && (
          <NestingPanel cfg={workspace.cfg} plateCfg={workspace.plateCfg} defaultModelName={workspace.modelName(presets)} />
        )}
        {current === 'cam' && <CamModule />}
        {current === 'panjur' && <PanjurModule />}
        {current === 'relief' && <ReliefGenerator />}
        {current === 'circle' && <DaireKesimi cfg={workspace.cfg} />}
        {current === 'derz' && <DerzBolme cfg={workspace.cfg} />}
        {current === 'gcode-dxf' && <GcodeDxfConverter />}
        {current === 'atolye' && <AtolyePage workspace={workspace} />}
        <Footer />
      </main>
    </div>
  );
}
