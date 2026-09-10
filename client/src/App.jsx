import { useState } from 'react';
import Topnav from './components/Topnav.jsx';
import Footer from './components/Footer.jsx';
import Sidebar from './components/Sidebar.jsx';
import MainMenu from './components/MainMenu.jsx';
import KapakModule from './components/kapak/KapakModule.jsx';
import CamModule from './components/cam/CamModule.jsx';
import PanjurModule from './components/panjur/PanjurModule.jsx';
import ReliefGenerator from './components/ReliefGenerator.jsx';

export default function App() {
  const [activeModule, setActiveModule] = useState('kapak');
  const [activeOp, setActiveOp] = useState('single');

  function handleNavigate(mod, op) {
    setActiveModule(mod);
    if (mod === 'kapak' && op) setActiveOp(op);
  }

  return (
    <div className="app-layout">
      <Topnav onHome={() => setActiveModule('menu')} />
      <div className="app-body">
        <Sidebar activeModule={activeModule} activeOp={activeOp} onNavigate={handleNavigate} />
        <main className="main-content">
          {activeModule === 'menu' && <MainMenu onSelectModule={(mod) => handleNavigate(mod, 'single')} />}
          {activeModule === 'kapak' && <KapakModule activeOp={activeOp} onBackToMenu={() => setActiveModule('menu')} />}
          {activeModule === 'cam' && <CamModule onBackToMenu={() => setActiveModule('menu')} />}
          {activeModule === 'panjur' && <PanjurModule onBackToMenu={() => setActiveModule('menu')} />}
          {activeModule === 'relief' && <ReliefGenerator onBackToMenu={() => setActiveModule('menu')} />}
          <Footer />
        </main>
      </div>
    </div>
  );
}
