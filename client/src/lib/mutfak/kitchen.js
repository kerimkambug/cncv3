// The sample kitchen (mm): one wall, 3.6 m — fridge column, base units with a
// sink and a drawer unit under the hob, oven column; wall units above, two of
// them glazed. Pure data: scene.js turns it into 3D, the doors carry the model.

export const PLINTH = 140;        // base height under the carcasses
export const BASE_H = 720;        // base carcass height
export const COUNTER = 40;        // worktop thickness
export const UPPER_Y = 1500;      // wall units start here
export const UPPER_H = 720;
export const TOP = PLINTH + 2080; // tall units / wall units top (2220)
export const DEPTH = { base: 560, upper: 330, tall: 580 };
export const GAP = 2;             // gap between fronts (as fitted in a real kitchen)
export const THICK = 18;          // door thickness

/**
 * fronts: stacked from the bottom; `count` doors side by side.
 * type: door | drawer | oven | glass
 */
export const UNITS = [
  { x: 0, w: 600, kind: 'tall', fronts: [{ type: 'door', count: 1, h: 1300 }, { type: 'door', count: 1, h: 772 }] },
  { x: 600, w: 600, kind: 'base', fronts: [{ type: 'door', count: 2, h: 716 }] },
  { x: 1200, w: 600, kind: 'base', sink: true, fronts: [{ type: 'door', count: 2, h: 716 }] },
  { x: 1800, w: 600, kind: 'base', hob: true, fronts: [{ type: 'drawer', count: 1, h: 236 }, { type: 'drawer', count: 1, h: 236 }, { type: 'drawer', count: 1, h: 236 }] },
  { x: 2400, w: 600, kind: 'base', fronts: [{ type: 'door', count: 2, h: 716 }] },
  { x: 3000, w: 600, kind: 'tall', fronts: [{ type: 'drawer', count: 1, h: 300 }, { type: 'oven', count: 1, h: 596 }, { type: 'door', count: 1, h: 1172 }] },
  { x: 600, w: 600, kind: 'upper', fronts: [{ type: 'glass', count: 2, h: 716 }] },
  { x: 1200, w: 600, kind: 'upper', fronts: [{ type: 'door', count: 2, h: 716 }] },
  { x: 2400, w: 600, kind: 'upper', fronts: [{ type: 'glass', count: 2, h: 716 }] },
];

/** Every front as a rectangle: { unit, x, y, w, h, type, group:'alt'|'ust', side:'L'|'R'|null } (y = bottom). */
export function frontsOf(units = UNITS) {
  const out = [];
  for (const u of units) {
    let y = (u.kind === 'upper' ? UPPER_Y : PLINTH) + GAP / 2;
    // the fronts fill the carcass height exactly, whatever the gap
    const unitH = u.kind === 'upper' ? UPPER_H : u.kind === 'tall' ? TOP - PLINTH : BASE_H;
    const scale = (unitH - GAP * u.fronts.length) / u.fronts.reduce((a, f) => a + f.h, 0);
    for (const f0 of u.fronts) {
      const f = { ...f0, h: f0.h * scale };
      const w = (u.w - GAP * f.count) / f.count;
      for (let k = 0; k < f.count; k++) {
        out.push({
          unit: u, x: u.x + GAP / 2 + k * (w + GAP), y, w, h: f.h, type: f.type,
          group: u.kind === 'upper' ? 'ust' : 'alt',
          // the handle goes on the opening side (two doors open from the middle)
          side: f.type === 'door' || f.type === 'glass' ? (f.count === 2 ? (k === 0 ? 'R' : 'L') : 'R') : null,
        });
      }
      y += f.h + GAP;
    }
  }
  return out;
}

/** Lacquer / melamine colours common in kitchens (approximate shades). */
export const COLORS = [
  { id: 'beyaz', name: 'Beyaz', hex: '#f3f2ee' },
  { id: 'kirik-beyaz', name: 'Kırık beyaz', hex: '#ece6da' },
  { id: 'kasmir', name: 'Kaşmir', hex: '#d5cabb' },
  { id: 'kum-beji', name: 'Kum beji', hex: '#c6b296' },
  { id: 'acik-gri', name: 'Açık gri', hex: '#bfc1c0' },
  { id: 'tas-gri', name: 'Taş gri', hex: '#8d8a83' },
  { id: 'antrasit', name: 'Antrasit', hex: '#3c3f43' },
  { id: 'siyah', name: 'Siyah', hex: '#1d1e20' },
  { id: 'lacivert', name: 'Lacivert', hex: '#22304a' },
  { id: 'petrol', name: 'Petrol mavisi', hex: '#2e5561' },
  { id: 'adacayi', name: 'Adaçayı yeşili', hex: '#a2ad95' },
  { id: 'zeytin', name: 'Zeytin yeşili', hex: '#5d634e' },
  { id: 'bordo', name: 'Bordo', hex: '#5b2027' },
  { id: 'mese', name: 'Meşe', hex: '#c39a6b', wood: true },
  { id: 'ceviz', name: 'Ceviz', hex: '#6a4a33', wood: true },
];

export const FINISHES = [
  { id: 'mat', name: 'Mat', roughness: 0.85, clearcoat: 0 },
  { id: 'saten', name: 'Saten', roughness: 0.5, clearcoat: 0.15 },
  { id: 'parlak', name: 'Parlak (lake)', roughness: 0.18, clearcoat: 1 },
];

export const GLASSES = [
  { id: 'seffaf', name: 'Şeffaf', color: '#e9f2f2', opacity: 0.16, roughness: 0.05 },
  { id: 'fume', name: 'Füme', color: '#3a3e42', opacity: 0.6, roughness: 0.05 },
  { id: 'bronz', name: 'Bronz', color: '#7b5a3c', opacity: 0.55, roughness: 0.05 },
  { id: 'buzlu', name: 'Buzlu', color: '#eef3f3', opacity: 0.82, roughness: 0.75 },
  { id: 'siyah', name: 'Siyah', color: '#121314', opacity: 0.88, roughness: 0.08 },
  { id: 'reflekte', name: 'Reflekte gümüş', color: '#a9b0b4', opacity: 0.7, roughness: 0.04, metalness: 0.6 },
];

export const COUNTERS = [
  { id: 'mermer', name: 'Beyaz mermer', hex: '#ebe9e4', roughness: 0.25, veins: true },
  { id: 'granit', name: 'Siyah granit', hex: '#232426', roughness: 0.3 },
  { id: 'beton', name: 'Beton gri', hex: '#9c9a95', roughness: 0.8 },
  { id: 'mese', name: 'Meşe masif', hex: '#b88a5a', roughness: 0.6, wood: true },
];

export const HANDLES = [
  { id: 'yok', name: 'Kulpsuz' },
  // cut into the door's edge with the kulp bit (Atölye → Makine → Kulp), the whole length
  { id: 'gizli', name: 'Gizli kulp (kenarda)' },
  { id: 'inox', name: 'Çubuk · inox', hex: '#c8cbcd', metalness: 1, roughness: 0.3 },
  { id: 'siyah', name: 'Çubuk · siyah', hex: '#1a1a1a', metalness: 0.4, roughness: 0.5 },
  { id: 'altin', name: 'Çubuk · altın', hex: '#c9a24a', metalness: 1, roughness: 0.25 },
];

/**
 * The edge a front's hidden kulp (gizli kulp) is cut on: the edge you reach for.
 * Base doors and drawers at the top, wall units at the bottom, tall doors on
 * their opening side. Glass doors and ovens get none.
 */
export function kulpEdge(f) {
  if (f.type !== 'door' && f.type !== 'drawer') return null;
  if (f.group === 'ust') return 'bottom';
  if (f.type === 'door' && f.unit.kind === 'tall') return f.side === 'L' ? 'left' : 'right';
  return 'top';
}
