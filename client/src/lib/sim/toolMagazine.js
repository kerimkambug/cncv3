// The workshop's tool library and the machine's magazine.
//
// library: every tool the workshop owns (20+), each with its own shape and size.
// slots:   which library tool is loaded in which magazine position right now
//          (T1…T12). A program's "M6T5" means "whatever sits in slot 5".
//
// The simulation reads the tools through toSimTools(): slots inside the
// magazine use the loaded tool (or are reported empty); numbers beyond the
// magazine (T13 rölyef, T14 panjur…) keep the built-in TOOL_TABLE.
import { TOOL_TABLE } from './millSim.js';

export const DEFAULT_SLOT_COUNT = 12;

/** Tool shapes the simulation knows, and the fields each one needs. */
export const TOOL_TYPES = {
  flat: { label: 'Düz (parmak freze)', fields: ['dia'] },
  ball: { label: 'Küre uçlu', fields: ['dia'] },
  v: { label: 'V (açılı)', fields: ['dia', 'angle'] },
  roundover: { label: 'Yuvarlama', fields: ['dia', 'flat'] },
  taper: { label: 'Konik küre uçlu', fields: ['dia', 'tipDia', 'angle'] },
  // shape drawn in AutoCAD (see toolProfile.js); its diameter comes from the drawing
  custom: { label: 'Özel profil (DXF)', fields: [] },
};

export const FIELD_LABELS = {
  dia: 'Çap (mm)',
  angle: 'Açı (°)',
  flat: 'Uç düzlüğü (mm)',
  tipDia: 'Uç çapı (mm)',
};

export function newToolId() {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Starting point: the built-in table becomes the library, T1…T12 loaded as before. */
export function defaultMagazine() {
  const library = Object.entries(TOOL_TABLE).map(([no, t]) => {
    const { name, ...shape } = t;
    return { id: `b${no}`, name: name.replace(/^T\d+\s*/, ''), ...shape };
  });
  const slots = {};
  for (let n = 1; n <= DEFAULT_SLOT_COUNT; n++) slots[n] = TOOL_TABLE[n] ? `b${n}` : null;
  return { library, slots, slotCount: DEFAULT_SLOT_COUNT };
}

/** Repairs a stored/imported magazine: unknown slot tools become empty slots. */
export function normalizeMagazine(m) {
  if (!m || !Array.isArray(m.library)) return defaultMagazine();
  const library = m.library.filter((t) => t && t.id && TOOL_TYPES[t.type]);
  const ids = new Set(library.map((t) => t.id));
  const slotCount = Math.max(1, Math.min(99, Math.round(Number(m.slotCount)) || DEFAULT_SLOT_COUNT));
  const slots = {};
  for (let n = 1; n <= slotCount; n++) {
    const id = m.slots?.[n];
    slots[n] = id && ids.has(id) ? id : null;
  }
  return { library, slots, slotCount };
}

/** What is wrong with a tool's numbers (empty string = usable). */
export function toolProblem(tool) {
  if (!tool || !TOOL_TYPES[tool.type]) return 'Tip seçilmemiş';
  if (tool.type === 'custom') return Array.isArray(tool.profile) && tool.profile.length >= 2 && tool.dia > 0 ? '' : 'Profil çizimi (DXF) yüklenmemiş';
  const dia = Number(tool.dia);
  if (!(dia > 0)) return 'Çap girilmemiş';
  if (tool.type === 'v' || tool.type === 'taper') {
    const a = Number(tool.angle);
    if (!(a > 0 && a < 180)) return 'Açı 0–180° arası olmalı';
  }
  if (tool.type === 'taper' && !(Number(tool.tipDia) > 0 && Number(tool.tipDia) <= dia)) return 'Uç çapı 0 ile çap arasında olmalı';
  if (tool.type === 'roundover' && Number(tool.flat) >= dia) return 'Uç düzlüğü çaptan küçük olmalı';
  return '';
}

/** The tool's shape as the simulation's profile() expects it (numbers, only its own fields). */
export function simShape(tool) {
  // the outline too: a tool narrower higher up cuts under the surface with its full side view
  if (tool.type === 'custom') return { type: 'custom', dia: Number(tool.dia), profile: tool.profile, ...(tool.outline ? { outline: tool.outline } : {}) };
  const shape = { type: tool.type };
  for (const f of TOOL_TYPES[tool.type].fields) {
    const v = Number(tool[f]);
    if (Number.isFinite(v) && v > 0) shape[f] = v;
  }
  return shape;
}

/** Slot number → simulation tool, for every magazine slot. */
export function toSimTools(magazine) {
  const m = normalizeMagazine(magazine);
  const byId = new Map(m.library.map((t) => [t.id, t]));
  const out = {};
  for (let n = 1; n <= m.slotCount; n++) {
    const tool = byId.get(m.slots[n]);
    if (!tool) { out[n] = { type: 'flat', dia: 6, name: `T${n} (yuva boş)`, empty: true }; continue; }
    const problem = toolProblem(tool);
    if (problem) { out[n] = { type: 'flat', dia: 6, name: `T${n} ${tool.name} (${problem.toLowerCase()})`, empty: true }; continue; }
    out[n] = { ...simShape(tool), name: `T${n} ${tool.name}` };
  }
  return out;
}

/** Loads `toolId` into `slot`; a tool can be in one slot only, so it leaves its old one. */
export function loadTool(magazine, slot, toolId) {
  const slots = { ...magazine.slots };
  if (toolId) for (const k of Object.keys(slots)) if (slots[k] === toolId) slots[k] = null;
  slots[slot] = toolId || null;
  return { ...magazine, slots };
}
