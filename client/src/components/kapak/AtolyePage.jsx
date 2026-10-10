import { usePersistentState } from '../../hooks/usePersistentState.js';
import MachineSettingsPanel from './MachineSettingsPanel.jsx';
import PresetPanel from './PresetPanel.jsx';
import ToolRows from './ToolRows.jsx';
import UsersPanel, { PasswordPanel } from '../UsersPanel.jsx';

/**
 * Atölye (workshop) — everything the person who sets the machine up needs and
 * the operator does not: machine settings, and the models with their tool rows
 * (create / edit / delete / import / export). The production screens only read
 * what is chosen here.
 */
export default function AtolyePage({ workspace, me = null }) {
  const [tab0, setTab] = usePersistentState('empire-cnc-atolye-tab', 'modeller');
  // no account (development server) = full access; otherwise models and users are the admin's
  const isAdmin = !me || me.user?.role === 'admin';
  const tabs = [
    isAdmin && ['modeller', 'Modeller'],
    ['makine', 'Makine'],
    isAdmin && me && ['kullanicilar', 'Kullanıcılar'],
    me && ['hesap', 'Hesabım'],
  ].filter(Boolean);
  const tab = tabs.some(([k]) => k === tab0) ? tab0 : tabs[0][0];
  const { machineCfg, setMachineCfg, plateCfg, setPlateCfg, rows, setRows } = workspace;
  return (
    <div className="atolye">
      <div className="atolye-head">
        <h1>Atölye</h1>
        <div className="hint">Makine ve model ayarları. Üretim ekranları buradaki seçimleri kullanır.</div>
      </div>
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'makine' && (
        <MachineSettingsPanel cfg={machineCfg} setCfg={setMachineCfg} plateCfg={plateCfg} setPlateCfg={setPlateCfg} />
      )}

      {tab === 'kullanicilar' && <UsersPanel me={me?.user} />}
      {tab === 'hesap' && <PasswordPanel />}

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
