import { usePersistentState } from '../../hooks/usePersistentState.js';
import MachineSettingsPanel from './MachineSettingsPanel.jsx';
import PresetPanel from './PresetPanel.jsx';
import ToolRows from './ToolRows.jsx';

/**
 * Atölye (workshop) — everything the person who sets the machine up needs and
 * the operator does not: machine settings, and the models with their tool rows
 * (create / edit / delete / import / export). The production screens only read
 * what is chosen here.
 */
export default function AtolyePage({ workspace }) {
  const [tab, setTab] = usePersistentState('empire-cnc-atolye-tab', 'modeller');
  const { machineCfg, setMachineCfg, plateCfg, setPlateCfg, rows, setRows } = workspace;
  return (
    <div className="atolye">
      <div className="atolye-head">
        <h1>Atölye</h1>
        <div className="hint">Makine ve model ayarları. Üretim ekranları buradaki seçimleri kullanır.</div>
      </div>
      <div className="tabs">
        <button type="button" className={`tab${tab === 'modeller' ? ' active' : ''}`} onClick={() => setTab('modeller')}>Modeller</button>
        <button type="button" className={`tab${tab === 'makine' ? ' active' : ''}`} onClick={() => setTab('makine')}>Makine</button>
      </div>

      {tab === 'makine' && (
        <MachineSettingsPanel cfg={machineCfg} setCfg={setMachineCfg} plateCfg={plateCfg} setPlateCfg={setPlateCfg} />
      )}

      {tab === 'modeller' && (
        <div className="atolye-models">
          <PresetPanel workspace={workspace} />
          <ToolRows
            rows={rows}
            setRows={setRows}
            thickness={machineCfg.thickness}
            offsetMode={machineCfg.offsetMode}
            setOffsetMode={(mode) => setMachineCfg((c) => ({ ...c, offsetMode: mode }))}
          />
        </div>
      )}
    </div>
  );
}
