import { useState, useEffect } from 'react';
import MachineSettingsPanel from './MachineSettingsPanel.jsx';
import ToolRows from './ToolRows.jsx';
import PresetPanel from './PresetPanel.jsx';
import TekOlcu from './TekOlcu.jsx';
import TopluListe from './TopluListe.jsx';
import NestingPanel from './NestingPanel.jsx';
import DaireKesimi from './DaireKesimi.jsx';
import DerzBolme from './DerzBolme.jsx';
import { DEFAULT_MACHINE_CONFIG, DEFAULT_PLATE_CONFIG } from '../../lib/gcode/common.js';

const TABS = [
  { key: 'single', label: 'Tek Kapak' },
  { key: 'batch', label: 'Toplu Liste' },
  { key: 'nesting', label: 'Nesting' },
  { key: 'circle', label: 'Daire Kesimi' },
  { key: 'derz', label: 'Derz Bölme' },
];

export default function KapakModule({ activeOp = 'single', onBackToMenu }) {
  const [currentTab, setCurrentTab] = useState(activeOp);
  const [activeModal, setActiveModal] = useState(null); // 'settings' | 'tools' | null

  const [machineCfg, setMachineCfg] = useState({ ...DEFAULT_MACHINE_CONFIG, offsetMode: 'relative', topStyle: 'flat', riseRatio: 0.125 });
  const [plateCfg, setPlateCfg] = useState({ ...DEFAULT_PLATE_CONFIG });
  const [rows, setRows] = useState([
    { name: '30mm yuvarlama', toolNo: '7', depth: 2.5, stepOffset: 52 },
    { name: '10mm balmumu', toolNo: '2', depth: 2, stepOffset: 16 },
    { name: '20mm tabla bıçağı', toolNo: '9', depth: 5.5, stepOffset: 9 },
    { name: '20mm tabla bıçağı', toolNo: '9', depth: 5.5, stepOffset: 8 },
    { name: '135° bıçak', toolNo: '12', depth: 5.5, stepOffset: 5 },
  ]);

  useEffect(() => {
    if (activeOp) setCurrentTab(activeOp);
  }, [activeOp]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setActiveModal(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const cfg = { ...machineCfg, rows };

  return (
    <div className="wrap app-screen active">
      <div className="topbar">
        <div>
          <h1>Empire CNC — G-code Üretici</h1>
          <div className="sub">Ölçü gir, parçaları nest et ve plaka başına CNC dosyalarını otomatik üret.</div>
        </div>
        <div className="top-actions">
          {onBackToMenu && (
            <button type="button" className="btn-secondary" onClick={onBackToMenu}>
              ← Ana Menü
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setActiveModal(activeModal === 'settings' ? null : 'settings')}
          >
            ⚙ Ayarlar
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setActiveModal(activeModal === 'tools' ? null : 'tools')}
          >
            🔧 Bıçaklar
          </button>
        </div>
      </div>

      <div className="main-card">
        <div className="card">
          <div className="tabs">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`tab${currentTab === tab.key ? ' active' : ''}`}
                onClick={() => setCurrentTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {currentTab === 'single' && <TekOlcu cfg={cfg} plateCfg={plateCfg} />}
          {currentTab === 'batch' && <TopluListe cfg={cfg} />}
          {currentTab === 'nesting' && <NestingPanel cfg={cfg} plateCfg={plateCfg} />}
          {currentTab === 'circle' && <DaireKesimi cfg={cfg} />}
          {currentTab === 'derz' && <DerzBolme cfg={cfg} />}
        </div>
      </div>

      {/* Modal Backdrop */}
      <div
        className={`modal-backdrop${activeModal ? ' open' : ''}`}
        onClick={() => setActiveModal(null)}
      />

      {/* Settings Modal */}
      <div className={`settings-card${activeModal === 'settings' ? ' open' : ''}`}>
        <div className="card">
          <div className="modal-title">
            <h2>⚙ Makine ve İşleme Ayarları</h2>
            <button
              type="button"
              className="btn-secondary modal-close"
              onClick={() => setActiveModal(null)}
            >
              ✕
            </button>
          </div>
          <MachineSettingsPanel cfg={machineCfg} setCfg={setMachineCfg} plateCfg={plateCfg} setPlateCfg={setPlateCfg} />
          <div style={{ marginTop: 16 }}>
            <PresetPanel cfg={machineCfg} setCfg={setMachineCfg} rows={rows} setRows={setRows} />
          </div>
        </div>
      </div>

      {/* Tools Modal */}
      <div className={`tools-card${activeModal === 'tools' ? ' open' : ''}`}>
        <div className="card">
          <div className="modal-title">
            <h2>🔧 Bıçak Sırası</h2>
            <button
              type="button"
              className="btn-secondary modal-close"
              onClick={() => setActiveModal(null)}
            >
              ✕
            </button>
          </div>
          <ToolRows
            rows={rows}
            setRows={setRows}
            thickness={machineCfg.thickness}
            offsetMode={machineCfg.offsetMode}
            setOffsetMode={(mode) => setMachineCfg((c) => ({ ...c, offsetMode: mode }))}
          />
        </div>
      </div>
    </div>
  );
}

