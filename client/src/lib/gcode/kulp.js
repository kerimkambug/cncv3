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

export const KULP_DEFAULTS = {
  toolNo: '11',
  spindle: 15000,
  z: 4, // bit tip above the table
  passes: '-1, 7', // bit centre from the edge, mm (+ into the door), one per pass
  approach: 30, // how far outside the edge the bit goes down and turns
  plungeFeed: 2000,
  cutFeed: 5000,
  dia: 30, // widest diameter of the bit (used when the magazine does not know it)
};

export const KULP_EDGES = { left: 'Sol', right: 'Sağ', top: 'Üst', bottom: 'Alt' };

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
    passes: parsePasses(v.passes),
    approach: Number(v.approach) > 0 ? Number(v.approach) : KULP_DEFAULTS.approach,
    plungeFeed: Number(v.plungeFeed) || KULP_DEFAULTS.plungeFeed,
    cutFeed: Number(v.cutFeed) || KULP_DEFAULTS.cutFeed,
    dia: Number(v.dia) > 0 ? Number(v.dia) : KULP_DEFAULTS.dia,
  };
}

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
 * @returns {{pts:number[][]}[]} one polyline per pass, each starting and ending outside the door
 */
export function kulpPasses(door, kulp, settings) {
  const s = kulpSettings(settings);
  const P = edgeFrame(door, kulp.edge);
  const len = edgeLength(door, kulp.edge);
  const A = s.approach, out = [];
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

const f2 = (v) => Number(v).toFixed(2);

/**
 * G-code block for every kulp of the doors (one tool change for all), in the
 * kapak programs' style. Starts with M5 (the previous tool is still turning).
 * @param {{x:number,y:number,w:number,h:number,kulps?:object[]}[]} doors
 * @param {object} settings  kulp settings (Atölye → Makine → Kulp)
 * @param {number} safeZ
 * @returns {string[]} lines ([] when no door has a kulp)
 */
export function buildKulpLines(doors, settings, safeZ) {
  const s = kulpSettings(settings);
  const jobs = doors.flatMap((d) => (d.kulps || []).map((k) => ({ door: d, kulp: k })));
  if (!jobs.length) return [];
  const lines = ['M5', `M6T${s.toolNo}`, `M3 S${s.spindle}`, `G0Z${f2(safeZ)}`];
  for (const { door, kulp } of jobs) {
    const passes = kulpPasses(door, kulp, s);
    const [sx, sy] = passes[0].pts[0];
    lines.push(`G0 X${f2(sx)} Y${f2(sy)} Z${f2(safeZ)}`);
    // down beside the door, in the air
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
