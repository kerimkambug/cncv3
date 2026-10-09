import { usePersistentState } from './usePersistentState.js';
import { DEFAULT_MACHINE_CONFIG, DEFAULT_PLATE_CONFIG } from '../lib/gcode/common.js';

// Fields a model (preset) brings into the machine settings when it is chosen.
const MODEL_CFG_FIELDS = [
  'thickness', 'spindleSpeed', 'safeZ', 'toolChangeZ', 'homeZ', 'plungeFeed', 'cutFeed',
  'offsetMode', 'topStyle', 'riseRatio', 'narrowAdapt', 'narrowMinPanel', 'narrowMinFirst',
];

// Before this hook the chosen preset id lived under this key (or '__custom__').
const LEGACY_ACTIVE_KEY = 'empire-cnc-active-tool-preset';

function cloneRows(rows) {
  return (rows || []).map((r) => ({ ...r, ...(r.derz ? { derz: { ...r.derz } } : {}) }));
}

/**
 * The kapak "workspace": which model is chosen, its tool rows and the machine /
 * plate settings. Shared by every kapak screen (Kapak, Toplu Liste, Nesting,
 * Atölye) and kept in localStorage, so the choice survives reloads and screen
 * changes until the user picks another model or edits the rows.
 *
 * activeModel: { id, name, custom } — custom = the rows were edited after the
 * model was chosen. null = nothing chosen yet: no G-code may be produced then
 * (the old built-in sample rows are gone; they produced a real program from
 * rows nobody had picked).
 */
export function useKapakWorkspace() {
  const [machineCfg, setMachineCfg] = usePersistentState('empire-cnc-kapak-machine', {
    ...DEFAULT_MACHINE_CONFIG, offsetMode: 'relative', topStyle: 'flat', riseRatio: 0.125,
  });
  const [plateCfg, setPlateCfg] = usePersistentState('empire-cnc-kapak-plate', { ...DEFAULT_PLATE_CONFIG });
  const [rows, setRowsRaw] = usePersistentState('empire-cnc-kapak-rows', []);
  const [activeModel, setActiveModel] = usePersistentState('empire-cnc-active-model', () => {
    try {
      const legacy = localStorage.getItem(LEGACY_ACTIVE_KEY);
      if (legacy && legacy !== '__custom__') return { id: legacy, name: null, custom: false };
    } catch { /* storage unavailable */ }
    return null;
  });

  function selectPreset(preset) {
    if (!preset) return;
    setRowsRaw(cloneRows(preset.rows));
    const patch = {};
    MODEL_CFG_FIELDS.forEach((f) => {
      if (preset[f] !== undefined && preset[f] !== null && preset[f] !== '') patch[f] = preset[f];
    });
    // the model's reference door (narrow-door adaptation, see planNarrowDoor)
    patch.refWidth = preset.previewWidth || null;
    patch.refHeight = preset.previewHeight || null;
    setMachineCfg((prev) => ({ ...prev, ...patch }));
    setActiveModel({ id: preset._id || preset.id, name: preset.name, custom: false });
  }

  /** Rows edited by hand: they stay, and the model is shown as customised. */
  function setRows(next) {
    setRowsRaw(next);
    setActiveModel((m) => (m ? { ...m, custom: true } : { id: null, name: 'Özel ayar', custom: true }));
  }

  /** Resolve the display name once the preset list is known (legacy ids). */
  function modelName(presets) {
    if (!activeModel) return null;
    if (activeModel.name) return activeModel.name;
    const p = (presets || []).find((x) => (x._id || x.id) === activeModel.id);
    return p ? p.name : null;
  }

  return {
    machineCfg, setMachineCfg, plateCfg, setPlateCfg,
    rows, setRows, activeModel, selectPreset, modelName,
    cfg: { ...machineCfg, rows },
    canGenerate: !!activeModel && rows.length > 0,
  };
}

/** Presets in natural order (1, 2, … 10, 11 — not 1, 10, 11, 2). */
export function sortPresets(presets) {
  return [...(presets || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr', { numeric: true }));
}
