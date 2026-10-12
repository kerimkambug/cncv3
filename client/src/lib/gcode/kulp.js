// Kulp (hidden handle) cut along a door edge, independent of the door model:
// any door can get one or more, on any edge, the whole length ("boydan") or a
// window between two points.
//
// The handle bit is wider below than above, so it can never plunge into the
// material. As in the shop's own programs ("43'lük kapak gizli kulp sağ sol
// 90-110", "280 boy kulp 2 seferde"):
//   - it goes down beside the door, `approach` mm outside the edge, to its
//     cutting height Z (tip above the table) and stays at that Z;
//   - it enters the edge sideways and cuts in passes, each a little deeper
//     (`passes`: the bit centre's distance from the edge, + = into the door),
//     back and forth;
//   - between passes and at the end it is outside the door again, and only
//     there it goes back up.
// A window's ends are rounded by the bit itself: its centre stops one radius
// (plus how much deeper the last pass goes) short of them.
//
// Where there is material around the door (nesting: the plate), the bit cannot
// go down beside it. There the 10 mm bit (T10) clears first, down to the kulp's
// height: the holes where the kulp bit goes down and comes up again (its whole
// head must fit), and everything the kulp bit would leave flat — every point
// closer to its path than the bit's narrowest radius inside the material. The
// kulp bit then only cuts with its sides: the profile.
import { intersect, offset, union } from '../cerezlik/geom.js';
import { levels, ringPasses } from '../cerezlik/toolpaths.js';
import { silhouette } from '../sim/millSim.js';

export const KULP_DEFAULTS = {
  toolNo: '11',
  spindle: 15000,
  z: 4, // bit tip above the table
  passes: '-1, 7', // bit centre from the edge, mm (+ into the door), one per pass
  approach: 30, // how far outside the edge the bit goes down and turns
  plungeFeed: 2000,
  cutFeed: 5000,
  dia: 30, // widest diameter of the bit (used when the magazine does not know it)
  // clearing with the 10 mm bit before the kulp bit (always in nesting)
  clearTool: '10',
  clearDia: 10,
  clearSpindle: 18000,
  clearStepdown: 6,
  clearFeed: 6000,
  clearPlungeFeed: 2000,
  clearAlways: false, // also on single doors (Tek Ölçü), where the bit could go down in the air
};

export const KULP_EDGES = { left: 'Sol', right: 'Sağ', top: 'Üst', bottom: 'Alt' };

// in a plate the kulp bit goes down just clear of the edge: its centre one radius + this outside
const NEST_CLEAR = 2;

/** Pass offsets from the settings text ("-1, 7"). */
export function parsePasses(text) {
  return String(text ?? '').split(/[;,\s]+/).map(Number).filter((n) => Number.isFinite(n));
}

/** The settings with defaults filled in (numbers as numbers). */
export function kulpSettings(s = {}) {
  const v = { ...KULP_DEFAULTS, ...(s || {}) };
  return {
    toolNo: String(v.toolNo || KULP_DEFAULTS.toolNo).trim(),
    spindle: Number(v.spindle) || KULP_DEFAULTS.spindle,
    z: Number.isFinite(Number(v.z)) ? Number(v.z) : KULP_DEFAULTS.z,
    passes: Array.isArray(v.passes) ? v.passes.map(Number) : parsePasses(v.passes),
    approach: Number(v.approach) > 0 ? Number(v.approach) : KULP_DEFAULTS.approach,
    plungeFeed: Number(v.plungeFeed) || KULP_DEFAULTS.plungeFeed,
    cutFeed: Number(v.cutFeed) || KULP_DEFAULTS.cutFeed,
    dia: Number(v.dia) > 0 ? Number(v.dia) : KULP_DEFAULTS.dia,
    // the bit's side view (Atölye → Bıçaklar), when it was drawn: its narrowest radius matters
    outline: Array.isArray(v.outline) ? v.outline : null,
    clearTool: String(v.clearTool || KULP_DEFAULTS.clearTool).trim(),
    clearDia: Number(v.clearDia) > 0 ? Number(v.clearDia) : KULP_DEFAULTS.clearDia,
    clearSpindle: Number(v.clearSpindle) || KULP_DEFAULTS.clearSpindle,
    clearStepdown: Number(v.clearStepdown) > 0 ? Number(v.clearStepdown) : KULP_DEFAULTS.clearStepdown,
    clearFeed: Number(v.clearFeed) || KULP_DEFAULTS.clearFeed,
    clearPlungeFeed: Number(v.clearPlungeFeed) || KULP_DEFAULTS.clearPlungeFeed,
    clearAlways: v.clearAlways === true || v.clearAlways === 'true',
  };
}

/** Where the bit goes down: `approach` outside the edge in the air, or just clear of it in a plate. */
const approachOf = (s, nest) => (nest ? s.dia / 2 + NEST_CLEAR : s.approach);

/** Length of a door edge. */
const edgeLength = (door, edge) => (edge === 'left' || edge === 'right' ? door.h : door.w);

/**
 * Maps edge coordinates to the plate: u along the edge from its start corner
 * (bottom for the side edges, left for top and bottom), n into the door from the edge.
 */
function edgeFrame(door, edge) {
  const { x, y, w, h } = door;
  switch (edge) {
    case 'left': return (u, n) => [x + n, y + u];
    case 'right': return (u, n) => [x + w - n, y + u];
    case 'bottom': return (u, n) => [x + u, y + n];
    case 'top': return (u, n) => [x + u, y + h - n];
    default: throw new Error(`Bilinmeyen kenar: ${edge}`);
  }
}

/** Where along the edge a kulp runs: [from, to] in mm from the edge's start corner (null = whole length). */
export function kulpSpan(door, kulp) {
  if (kulp.mode !== 'window') return null;
  return [Number(kulp.from), Number(kulp.to)];
}

/** Why this kulp cannot be cut on this door ('' = it can). */
export function kulpProblem(door, kulp, settings) {
  const s = kulpSettings(settings);
  if (!KULP_EDGES[kulp.edge]) return 'Kulp kenarı seçilmedi.';
  if (!s.passes.length) return 'Kulp ayarlarında paso yok (Atölye → Makine → Kulp).';
  if (s.z < 0) return 'Kulp yüksekliği (Z) negatif olamaz.';
  const len = edgeLength(door, kulp.edge);
  const span = kulpSpan(door, kulp);
  if (span) {
    const [a, b] = span;
    if (!(Number.isFinite(a) && Number.isFinite(b))) return 'Kulp başlangıç ve bitişini girin.';
    if (a < 0 || b > len + 1e-6) return `Kulp ${KULP_EDGES[kulp.edge].toLowerCase()} kenarın dışına taşıyor (kenar ${len} mm).`;
    const spread = Math.max(...s.passes) - Math.min(...s.passes);
    const need = s.dia + 2 * spread;
    if (b - a < need - 1e-6) return `Kulp penceresi bıçağa göre kısa: en az ${need.toFixed(0)} mm olmalı (bıçak Ø${s.dia}).`;
  }
  return '';
}

/**
 * The bit centre's passes for one kulp, in plate coordinates.
 * @param {{nest?:boolean}} [opts] nest: material around the door — go down just clear of the edge
 * @returns {{pts:number[][]}[]} one polyline per pass, each starting and ending outside the door
 */
export function kulpPasses(door, kulp, settings, { nest = false } = {}) {
  const s = kulpSettings(settings);
  const P = edgeFrame(door, kulp.edge);
  const len = edgeLength(door, kulp.edge);
  const A = approachOf(s, nest), out = [];
  const span = kulpSpan(door, kulp);
  const last = s.passes[s.passes.length - 1];
  // the first pass of a window has the door on its right (as the shop's programs);
  // a whole-length kulp starts from the far end (as "280 boy kulp 2 seferde")
  const rightUp = kulp.edge === 'left' || kulp.edge === 'top';
  s.passes.forEach((n, k) => {
    if (!span) {
      const down = k % 2 === 0;
      const [u0, u1] = down ? [len + A, -A] : [-A, len + A];
      out.push({ pts: [P(u0, n), P(u1, n)] });
      return;
    }
    const shrink = s.dia / 2 + Math.max(0, last - n);
    const a = span[0] + shrink, b = span[1] - shrink;
    const up = k % 2 === 0 ? rightUp : !rightUp;
    const [u0, u1] = up ? [a, b] : [b, a];
    out.push({ pts: [P(u0, -A), P(u0, n), P(u1, n), P(u1, -A)] });
  });
  return out;
}

/**
 * The kulp bit's narrowest radius over the material's height (its tip at s.z):
 * everything closer to its path than this is cut flat. Without a drawn side view
 * the bit is taken as a plain cylinder (its full radius).
 */
export function flatRadius(settings, top) {
  const s = kulpSettings(settings);
  const sil = s.outline ? silhouette(s.outline) : null;
  if (!sil) return s.dia / 2;
  const hMax = Math.max(0, top - s.z);
  let r = Infinity;
  for (let k = 0; k < sil.r.length && k * sil.dh <= hMax + 1e-9; k++) r = Math.min(r, sil.r[k]);
  if (hMax > (sil.r.length - 1) * sil.dh) r = Math.min(r, sil.rTop);
  return Number.isFinite(r) ? r : s.dia / 2;
}

/**
 * How far the kulp work reaches past each edge of a door in a plate (the 10 mm
 * bit's holes and the kulp bit's head), in the door's own frame: nesting keeps it free.
 * @returns {{left:number,right:number,bottom:number,top:number}}
 */
export function kulpMargins(kulps, settings) {
  const s = kulpSettings(settings);
  const reach = approachOf(s, true) + s.dia / 2 + 1;
  const m = { left: 0, right: 0, bottom: 0, top: 0 };
  const ends = { left: ['bottom', 'top'], right: ['bottom', 'top'], bottom: ['left', 'right'], top: ['left', 'right'] };
  for (const k of kulps || []) {
    if (!KULP_EDGES[k.edge]) continue;
    m[k.edge] = Math.max(m[k.edge], reach);
    // a whole-length kulp goes down and comes up beyond the edge's ends
    if (k.mode !== 'window') for (const e of ends[k.edge]) m[e] = Math.max(m[e], reach);
  }
  return m;
}

/** A disc as a polygon. */
function disc([cx, cy], r, n = 48) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
}

/** A segment widened by r on both sides, round ends (as a polygon, counter-clockwise). */
function capsule([ax, ay], [bx, by], r, n = 16) {
  const a = Math.atan2(by - ay, bx - ax), pts = [];
  for (let i = 0; i <= n; i++) { const t = a - Math.PI / 2 - (Math.PI * i) / n; pts.push([ax + r * Math.cos(t), ay + r * Math.sin(t)]); }
  for (let i = 0; i <= n; i++) { const t = a + Math.PI / 2 - (Math.PI * i) / n; pts.push([bx + r * Math.cos(t), by + r * Math.sin(t)]); }
  return pts;
}

/**
 * What the 10 mm bit clears before the kulp bit, as loops (outer CCW, holes CW):
 * the band the kulp bit would cut flat and, in a plate, the holes where it goes
 * down and up (its whole head must fit).
 * @param {{top:number, nest:boolean}} o  top: material thickness; nest: the door lies in a plate
 */
export function kulpClearRegion(door, kulps, settings, { top, nest }) {
  const s = kulpSettings(settings);
  const rFlat = flatRadius(s, top) - 0.5; // stay off the profile
  const loops = [];
  for (const k of kulps || []) {
    const pts = kulpPasses(door, k, s, { nest }).flatMap((p) => p.pts);
    if (rFlat > s.clearDia / 2) for (let i = 0; i + 1 < pts.length; i++) loops.push(capsule(pts[i], pts[i + 1], rFlat));
    if (nest) {
      const hole = s.dia / 2 + 1;
      loops.push(disc(pts[0], hole), disc(pts[pts.length - 1], hole));
    }
  }
  if (!loops.length) return [];
  let shapes = union(loops);
  // in the air (a single door) only the door itself needs clearing
  if (!nest) {
    const { x, y, w, h } = door;
    shapes = intersect(shapes.map((sh) => sh.outer), [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]]);
  }
  return shapes.flatMap((sh) => [sh.outer, ...(sh.holes || [])]);
}

/**
 * The 10 mm bit's passes over the clearing region: rings from the inside out,
 * level by level down to the kulp's height.
 * @returns {number[][][]} passes of [x, y, z]
 */
export function kulpClearPasses(door, kulps, settings, { top, nest }) {
  const s = kulpSettings(settings);
  const region = kulpClearRegion(door, kulps, s, { top, nest });
  if (!region.length) return [];
  const r = s.clearDia / 2, step = s.clearDia * 0.8;
  const rings = [];
  let cur = offset(region, -r, { keepOrientation: true, arcTol: 0.05 });
  while (cur.length && rings.length < 2000) {
    rings.push(cur);
    cur = offset(cur, -step, { keepOrientation: true, arcTol: 0.1 });
  }
  if (!rings.length) return [];
  const passes = [];
  for (const d of levels(Math.max(0, top - s.z), s.clearStepdown)) passes.push(...ringPasses(rings, +(top - d).toFixed(3), step, false));
  return passes;
}

const f2 = (v) => Number(v).toFixed(2);

/** G-code lines of passes ([[x, y, z]…]): down at the start, follow, up. */
function passLines(passes, safeZ, plungeFeed, feed) {
  const out = [];
  for (const p of passes) {
    const [x0, y0, z0] = p[0];
    out.push(`G0 X${f2(x0)} Y${f2(y0)} Z${f2(safeZ)}`);
    out.push(`G1 Z${f2(z0)} F${plungeFeed.toFixed(1)}`);
    let first = true;
    for (let i = 1; i < p.length; i++) {
      const [x, y] = p[i];
      out.push(`G1 X${f2(x)} Y${f2(y)}${first ? ` F${feed.toFixed(1)}` : ''}`);
      first = false;
    }
    out.push(`G0 Z${f2(safeZ)}`);
  }
  return out;
}

/**
 * G-code for every kulp of the doors, in the kapak programs' style: the 10 mm
 * bit's clearing first (in a plate, or when asked), then the kulp bit — each one
 * tool change for all doors. Starts with M5 (the previous tool is still turning).
 * @param {{x:number,y:number,w:number,h:number,kulps?:object[]}[]} doors
 * @param {object} settings  kulp settings (Atölye → Makine → Kulp)
 * @param {number} safeZ
 * @param {{nest?:boolean, top?:number}} [opts]  nest: the doors lie in a plate (material around them)
 * @returns {string[]} lines ([] when no door has a kulp)
 */
export function buildKulpLines(doors, settings, safeZ, { nest = false, top = 18 } = {}) {
  const s = kulpSettings(settings);
  const jobs = doors.filter((d) => (d.kulps || []).length);
  if (!jobs.length) return [];
  const lines = [];
  if (nest || s.clearAlways) {
    const clear = jobs.flatMap((d) => kulpClearPasses(d, d.kulps, s, { top, nest }));
    if (clear.length) {
      lines.push('M5', `M6T${s.clearTool}`, `M3 S${s.clearSpindle}`, `G0Z${f2(safeZ)}`);
      lines.push(...passLines(clear, safeZ, s.clearPlungeFeed, s.clearFeed));
    }
  }
  lines.push('M5', `M6T${s.toolNo}`, `M3 S${s.spindle}`, `G0Z${f2(safeZ)}`);
  for (const door of jobs) for (const kulp of door.kulps) {
    const passes = kulpPasses(door, kulp, s, { nest });
    const [sx, sy] = passes[0].pts[0];
    lines.push(`G0 X${f2(sx)} Y${f2(sy)} Z${f2(safeZ)}`);
    // down beside the door: in the air, or in the hole the 10 mm bit made
    lines.push(`G1 Z${f2(s.z)} F${s.plungeFeed.toFixed(1)}`);
    let first = true, at = [sx, sy];
    for (const p of passes) {
      for (const [x, y] of p.pts) {
        if (Math.abs(x - at[0]) < 1e-6 && Math.abs(y - at[1]) < 1e-6) continue;
        lines.push(`G1 X${f2(x)} Y${f2(y)}${first ? ` F${s.cutFeed.toFixed(1)}` : ''}`);
        first = false;
        at = [x, y];
      }
    }
    lines.push(`G0 Z${f2(safeZ)}`);
  }
  return lines;
}
