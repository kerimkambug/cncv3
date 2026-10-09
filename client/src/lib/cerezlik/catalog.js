// Built-in parametric models: common, generic board / tray / snack-dish forms
// drawn from parameters (no DXF needed). Every model returns a part in the same
// form as a DXF part: { outline, comps: [{pts, kind, islands, depth?}], lines }.
import { area, bbox, difference, ensureCCW, offset, roundShape, transform, union } from './geom.js';

const TAU = Math.PI * 2;

/** Points of a circle (CCW), chord error ≤ 0.02 mm. */
export function circlePts(cx, cy, r, a0 = 0) {
  const n = Math.min(720, Math.max(36, Math.ceil(Math.PI / Math.sqrt(0.04 / Math.max(r, 0.1)))));
  return Array.from({ length: n }, (_, i) => { const a = a0 + (TAU * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
}

function arcPts(cx, cy, r, a0, a1) {
  const n = Math.max(4, Math.ceil((Math.abs(a1 - a0) / TAU) * circlePts(0, 0, r).length));
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
}

/** Rounded rectangle (CCW). */
export function roundRect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r === 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return [
    ...arcPts(x + w - r, y + r, r, -Math.PI / 2, 0),
    ...arcPts(x + w - r, y + h - r, r, 0, Math.PI / 2),
    ...arcPts(x + r, y + h - r, r, Math.PI / 2, Math.PI),
    ...arcPts(x + r, y + r, r, Math.PI, 1.5 * Math.PI),
  ];
}

export const regularPolygon = (n, R, rot = 0) => Array.from({ length: n }, (_, i) => { const a = rot + (TAU * i) / n; return [R * Math.cos(a), R * Math.sin(a)]; });

/** A straight band of width w along p→q (used as a divider wall), stretched past both ends by `ext`. */
function band(p, q, w, ext = 0) {
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy * (w / 2), ny = ux * (w / 2);
  const a = [p[0] - ux * ext, p[1] - uy * ext], b = [q[0] + ux * ext, q[1] + uy * ext];
  return [[a[0] + nx, a[1] + ny], [a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny]];
}

function heartPts(width) {
  const pts = [];
  for (let i = 0; i < 360; i++) {
    const t = (TAU * i) / 360;
    pts.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
  }
  const k = width / 32;
  return ensureCCW(pts.map(([x, y]) => [x * k, y * k]));
}

/** Lens (two equal arcs) of length L and width W, along X, centred at the origin. */
function lensPts(L, W) {
  const s = W / 2, c = L / 2;
  const R = (s * s + c * c) / (2 * s);
  const a = Math.asin(c / R);
  const top = arcPts(0, s - R, R, Math.PI / 2 + a, Math.PI / 2 - a); // left tip → right tip
  const bottom = arcPts(0, R - s, R, -Math.PI / 2 + a, -Math.PI / 2 - a); // right tip → left tip
  return ensureCCW([...top, ...bottom.slice(1, -1)]);
}

const biggest = (shapes) => shapes.slice().sort((a, b) => area(b.outer) - area(a.outer))[0];

/** Joins loops into one outline; concave joints get a fillet of `fillet` mm. */
function outlineOf(loops, fillet = 0) {
  const u = biggest(union(loops));
  return fillet > 0 ? biggest(roundShape(u.outer, [], 0, fillet)).outer : u.outer;
}

/**
 * Compartments: the area `rim` inside the outline, minus the divider walls,
 * each piece with its corners rounded to `cornerR` (≥ the pocket bit radius).
 */
function bowls(outline, rim, dividers, cornerR, depth) {
  const inner = offset([outline], -rim);
  if (!inner.length) return [];
  const pieces = difference(inner, dividers);
  const out = [];
  for (const pc of pieces) {
    for (const sh of roundShape(pc.outer, pc.holes, cornerR)) {
      if (area(sh.outer) > 400) out.push({ pts: sh.outer, islands: sh.holes, kind: 'cep', depth });
    }
  }
  return out;
}

const hole = (cx, cy, d) => ({ pts: circlePts(cx, cy, d / 2), islands: [], kind: 'delik' });
const slot = (cx, cy, w, h) => ({ pts: roundRect(cx - w / 2, cy - h / 2, w, h, h / 2), islands: [], kind: 'delik' });

/** Body + a handle sticking out to +X from x = bodyRight, with a hole near its end. */
function withHandle(body, bodyRight, cy, hLen, hW, holeD, fillet) {
  const handle = roundRect(bodyRight - hW, cy - hW / 2, hLen + hW, hW, hW / 2);
  const outline = outlineOf([body, handle], fillet);
  const comps = holeD > 0 ? [hole(bodyRight + hLen - hW / 2, cy, holeD)] : [];
  return { outline, comps };
}

const P = (k, label, def, min, max, step = 1) => ({ k, label, def, min, max, step });

export const CATALOG = [
  // ---------------- cutting boards ----------------
  {
    id: 'kesme-sapli', group: 'Kesme tahtası', name: 'Saplı kesme tahtası',
    params: [P('L', 'Gövde boyu', 340, 150, 700), P('W', 'En', 220, 100, 450), P('r', 'Köşe yarıçapı', 25, 0, 80), P('hl', 'Sap boyu', 110, 40, 250), P('hw', 'Sap eni', 50, 30, 100), P('hd', 'Delik çapı', 22, 0, 40)],
    build: (p) => withHandle(roundRect(0, 0, p.L, p.W, p.r), p.L, p.W / 2, p.hl, p.hw, p.hd, 18),
  },
  {
    id: 'kesme-kurek', group: 'Kesme tahtası', name: 'Yuvarlak kürek tahta',
    params: [P('D', 'Çap', 300, 150, 600), P('hl', 'Sap boyu', 120, 40, 250), P('hw', 'Sap eni', 46, 30, 100), P('hd', 'Delik çapı', 20, 0, 40)],
    build: (p) => withHandle(circlePts(p.D / 2, p.D / 2, p.D / 2), p.D, p.D / 2, p.hl, p.hw, p.hd, 25),
  },
  {
    id: 'kesme-oluklu', group: 'Kesme tahtası', name: 'Oluklu kesme tahtası',
    params: [P('L', 'Boy', 450, 250, 700), P('W', 'En', 300, 150, 450), P('r', 'Köşe yarıçapı', 20, 0, 80), P('m', 'Oluk kenardan', 18, 10, 40), P('gw', 'Oluk eni', 10, 6, 20), P('gd', 'Oluk derinliği', 5, 2, 10, 0.5), P('sl', 'Tutma yuvası boyu', 100, 0, 160)],
    build: (p) => {
      const outline = roundRect(0, 0, p.L, p.W, p.r);
      const outer = offset([outline], -p.m)[0];
      const inner = offset([outline], -(p.m + p.gw))[0];
      const comps = [{ pts: outer, islands: [inner], kind: 'cep', depth: p.gd }];
      if (p.sl > 0) comps.push(slot(p.m + p.gw + 36, p.W / 2, 28, Math.min(p.sl, p.W - 2 * (p.m + p.gw) - 30)));
      return { outline, comps };
    },
  },
  {
    id: 'kesme-delikli', group: 'Kesme tahtası', name: 'Delikli dikdörtgen tahta',
    params: [P('L', 'Boy', 400, 200, 700), P('W', 'En', 250, 120, 450), P('r', 'Köşe yarıçapı', 15, 0, 80), P('hd', 'Askı deliği çapı', 25, 0, 45)],
    build: (p) => ({ outline: roundRect(0, 0, p.L, p.W, p.r), comps: p.hd > 0 ? [hole(p.L - 25 - p.hd / 2, p.W - 25 - p.hd / 2, p.hd)] : [] }),
  },
  {
    id: 'kesme-damla', group: 'Kesme tahtası', name: 'Damla tahta',
    params: [P('L', 'Boy', 380, 200, 650), P('W', 'En', 230, 120, 400), P('hd', 'Delik çapı', 20, 0, 40)],
    build: (p) => {
      const R = p.W / 2;
      const tipX = p.L; // circle centre at x = R, tip at x = L
      const d = tipX - R;
      const a = Math.acos(Math.min(1, R / d));
      const body = [...arcPts(R, R, R, a, TAU - a), [tipX, R]];
      const outline = biggest(roundShape(ensureCCW(body), [], 12)).outer;
      // on the axis, a point t from the tip is t·sin(θ) from the straight sides (sin θ = R / d)
      const t = (p.hd / 2 + 15) / (R / d);
      return { outline, comps: p.hd > 0 ? [hole(tipX - Math.max(t, 30 + p.hd / 2), R, p.hd)] : [] };
    },
  },
  {
    id: 'kesme-kalp', group: 'Kesme tahtası', name: 'Kalp tahta',
    params: [P('W', 'En', 300, 150, 550), P('hd', 'Askı deliği çapı', 0, 0, 30)],
    build: (p) => {
      const outline = biggest(roundShape(heartPts(p.W), [], 4, 15)).outer;
      const b = bbox([outline]);
      return { outline, comps: p.hd > 0 ? [hole((b.minX + b.maxX) / 2, b.maxY - 0.22 * (b.maxY - b.minY), p.hd)] : [] };
    },
  },

  // ---------------- serving boards / trays ----------------
  {
    id: 'sunum-yaprak', group: 'Sunumluk', name: 'Yaprak sunumluk',
    params: [P('L', 'Boy', 420, 200, 700), P('W', 'En', 200, 100, 350), P('rim', 'Kenar eni', 18, 10, 40), P('d', 'Derinlik', 8, 3, 15, 0.5), P('hl', 'Sap boyu', 70, 0, 150)],
    build: (p) => {
      const lens = lensPts(p.L, p.W).map(([x, y]) => [x + p.L / 2, y + p.W / 2]);
      const outline = p.hl > 0 ? outlineOf([lens, roundRect(p.L - 30, p.W / 2 - 13, p.hl + 30, 26, 13)], 20) : lens;
      return { outline, comps: bowls(lens, p.rim, [], 10, p.d) };
    },
  },
  {
    id: 'sunum-tepsi', group: 'Sunumluk', name: 'Kulplu servis tepsisi',
    params: [P('L', 'Boy', 460, 250, 750), P('W', 'En', 300, 150, 450), P('r', 'Köşe yarıçapı', 30, 5, 80), P('rim', 'Yan kenar', 22, 12, 40), P('end', 'Kulp tarafı kenar', 60, 45, 100), P('d', 'Derinlik', 8, 3, 15, 0.5)],
    build: (p) => {
      const outline = roundRect(0, 0, p.L, p.W, p.r);
      const pocket = roundRect(p.end, p.rim, p.L - 2 * p.end, p.W - 2 * p.rim, Math.max(8, p.r - p.rim));
      const sw = Math.min(110, p.W * 0.45);
      return {
        outline,
        comps: [{ pts: pocket, islands: [], kind: 'cep', depth: p.d }, slot(p.end / 2, p.W / 2, 24, sw), slot(p.L - p.end / 2, p.W / 2, 24, sw)],
      };
    },
  },
  {
    id: 'sunum-cift-kalp', group: 'Sunumluk', name: 'Çift kalp sunumluk',
    params: [P('W', 'Tek kalp eni', 260, 150, 400), P('ov', 'İç içe geçme', 30, 10, 45), P('rim', 'Kenar eni', 14, 10, 30), P('d', 'Derinlik', 8, 3, 15, 0.5)],
    build: (p) => {
      // two hearts leaning outwards, overlapping by ov % of a width; the right one lies on top
      const h = heartPts(p.W);
      const shift = p.W * (1 - p.ov / 100);
      const left = transform(h, 10, 0, 0);
      const right = transform(h, -10, shift, 0);
      const outline = biggest(roundShape(outlineOf([left, right], 15), [], 5)).outer;
      const bowlR = offset([right], -p.rim);
      const bowlL = difference(offset([left], -p.rim), [right]);
      const comps = [];
      for (const sh of [...bowlL, ...bowlR.map((o) => ({ outer: o, holes: [] }))]) {
        for (const r of roundShape(sh.outer, sh.holes, 9)) if (area(r.outer) > 400) comps.push({ pts: r.outer, islands: r.holes, kind: 'cep', depth: p.d });
      }
      return { outline, comps };
    },
  },
  {
    id: 'sunum-yinyang', group: 'Sunumluk', name: 'Yin-yang sunumluk (yarım)',
    params: [P('D', 'Takım çapı', 360, 220, 600), P('g', 'İki yarı arası boşluk', 6, 0, 20), P('cup', 'Fincan yuvası çapı', 80, 0, 120), P('cd', 'Fincan yuvası derinliği', 5, 2, 10, 0.5), P('rim', 'Kenar eni', 14, 10, 30), P('wall', 'Ara duvar', 10, 6, 25), P('d', 'Derinlik', 8, 3, 15, 0.5)],
    build: (p) => {
      // one half of the yin-yang disc; the other half is the same piece turned 180°
      const R = p.D / 2;
      const halfDisc = [...arcPts(0, 0, R, Math.PI / 2, 1.5 * Math.PI)];
      const head = circlePts(0, R / 2, R / 2);
      const bite = circlePts(0, -R / 2, R / 2);
      const comma = biggest(difference(union([halfDisc, head]).map((sh) => sh.outer), [bite])).outer;
      const piece = biggest(roundShape(offset([comma], -p.g / 2)[0] || comma, [], 8)).outer;
      const comps = [];
      const cupR = Math.min(p.cup / 2, R / 2 - p.rim - p.g / 2 - 4);
      let walls = [];
      if (p.cup > 0 && cupR > 15) {
        comps.push({ pts: circlePts(0, R / 2, cupR), islands: [], kind: 'cep', depth: p.cd });
        walls = [circlePts(0, R / 2, cupR + p.wall)];
      }
      comps.push(...bowls(piece, p.rim, walls, 9, p.d));
      return { outline: piece, comps };
    },
  },
  {
    id: 'sunum-kalp', group: 'Sunumluk', name: 'Kalp kase',
    params: [P('W', 'En', 280, 150, 500), P('rim', 'Kenar eni', 16, 10, 40), P('d', 'Derinlik', 12, 3, 15, 0.5)],
    build: (p) => {
      const outline = biggest(roundShape(heartPts(p.W), [], 4, 15)).outer;
      return { outline, comps: bowls(outline, p.rim, [], 10, p.d) };
    },
  },

  // ---------------- snack dishes ----------------
  {
    id: 'cerez-altigen-dilim', group: 'Çerezlik', name: 'Altıgen dilimli çerezlik',
    params: [P('D', 'Köşeden köşeye', 340, 200, 600), P('n', 'Dilim sayısı', 6, 3, 8), P('r', 'Köşe yarıçapı', 18, 0, 60), P('rim', 'Kenar eni', 16, 10, 40), P('wall', 'Ara duvar', 10, 6, 25), P('d', 'Derinlik', 12, 3, 15, 0.5)],
    build: (p) => {
      const R = p.D / 2;
      const outline = biggest(roundShape(regularPolygon(6, R, Math.PI / 6), [], p.r)).outer.map(([x, y]) => [x + R, y + R]);
      const c = [R, R];
      const div = Array.from({ length: p.n }, (_, i) => { const a = Math.PI / 2 + (TAU * i) / p.n; return band(c, [R + R * Math.cos(a), R + R * Math.sin(a)], p.wall, 0); });
      const hub = circlePts(R, R, p.wall * 1.4);
      return { outline, comps: bowls(outline, p.rim, [...div, hub], 9, p.d) };
    },
  },
  {
    id: 'cerez-altigen-paralel', group: 'Çerezlik', name: 'Altıgen çizgili çerezlik',
    params: [P('D', 'Köşeden köşeye', 340, 200, 600), P('n', 'Bölme sayısı', 4, 2, 7), P('r', 'Köşe yarıçapı', 18, 0, 60), P('rim', 'Kenar eni', 16, 10, 40), P('wall', 'Ara duvar', 10, 6, 25), P('d', 'Derinlik', 12, 3, 15, 0.5)],
    build: (p) => {
      const R = p.D / 2;
      const outline = biggest(roundShape(regularPolygon(6, R, 0), [], p.r)).outer.map(([x, y]) => [x + R, y + R]);
      // dividers parallel to one diagonal, evenly spread across the width
      const a = Math.PI / 3, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
      const span = R * Math.sqrt(3) - 2 * p.rim;
      const div = [];
      for (let i = 1; i < p.n; i++) {
        const t = -span / 2 + (span * i) / p.n;
        const cx = R + nx * t, cy = R + ny * t;
        div.push(band([cx - ux * R * 1.2, cy - uy * R * 1.2], [cx + ux * R * 1.2, cy + uy * R * 1.2], p.wall));
      }
      return { outline, comps: bowls(outline, p.rim, div, 9, p.d) };
    },
  },
  {
    id: 'cerez-yuvarlak-merkez', group: 'Çerezlik', name: 'Yuvarlak merkezli çerezlik',
    params: [P('D', 'Çap', 320, 200, 600), P('n', 'Dış dilim', 5, 3, 8), P('cr', 'Orta kase çapı', 120, 60, 250), P('rim', 'Kenar eni', 16, 10, 40), P('wall', 'Ara duvar', 10, 6, 25), P('d', 'Derinlik', 12, 3, 15, 0.5)],
    build: (p) => {
      const R = p.D / 2;
      const outline = circlePts(R, R, R);
      const ring = circlePts(R, R, p.cr / 2 + p.wall);
      const centre = circlePts(R, R, p.cr / 2);
      const spokes = Array.from({ length: p.n }, (_, i) => { const a = Math.PI / 2 + (TAU * i) / p.n; return band([R + (p.cr / 2) * Math.cos(a), R + (p.cr / 2) * Math.sin(a)], [R + R * Math.cos(a), R + R * Math.sin(a)], p.wall); });
      // the outer slices stop a wall's width outside the centre bowl
      const comps = bowls(outline, p.rim, [ring, ...spokes], 9, p.d);
      comps.push({ pts: centre, islands: [], kind: 'cep', depth: p.d });
      return { outline, comps };
    },
  },
  {
    id: 'cerez-kare-merkez', group: 'Çerezlik', name: 'Kare merkezli çerezlik',
    params: [P('A', 'Kenar', 300, 180, 550), P('r', 'Köşe yarıçapı', 35, 5, 100), P('cr', 'Orta kase çapı', 110, 60, 220), P('rim', 'Kenar eni', 16, 10, 40), P('wall', 'Ara duvar', 10, 6, 25), P('d', 'Derinlik', 12, 3, 15, 0.5)],
    build: (p) => {
      const A = p.A, c = A / 2;
      const outline = roundRect(0, 0, A, A, p.r);
      const ring = circlePts(c, c, p.cr / 2 + p.wall);
      const spokes = [0, 1, 2, 3].map((i) => { const a = Math.PI / 4 + (i * Math.PI) / 2; return band([c, c], [c + A * Math.cos(a), c + A * Math.sin(a)], p.wall); });
      const comps = bowls(outline, p.rim, [ring, ...spokes], 9, p.d);
      comps.push({ pts: circlePts(c, c, p.cr / 2), islands: [], kind: 'cep', depth: p.d });
      return { outline, comps };
    },
  },
  {
    id: 'cerez-izgara', group: 'Çerezlik', name: 'Izgara bölmeli çerezlik',
    params: [P('L', 'Boy', 320, 150, 650), P('W', 'En', 220, 100, 450), P('cols', 'Sütun', 3, 1, 6), P('rows', 'Satır', 2, 1, 5), P('r', 'Köşe yarıçapı', 25, 0, 80), P('rim', 'Kenar eni', 15, 10, 40), P('wall', 'Ara duvar', 10, 6, 25), P('d', 'Derinlik', 12, 3, 15, 0.5)],
    build: (p) => {
      const outline = roundRect(0, 0, p.L, p.W, p.r);
      const div = [];
      for (let i = 1; i < p.cols; i++) { const x = p.rim + ((p.L - 2 * p.rim) * i) / p.cols; div.push(band([x, -10], [x, p.W + 10], p.wall)); }
      for (let j = 1; j < p.rows; j++) { const y = p.rim + ((p.W - 2 * p.rim) * j) / p.rows; div.push(band([-10, y], [p.L + 10, y], p.wall)); }
      return { outline, comps: bowls(outline, p.rim, div, Math.max(9, p.r - p.rim), p.d) };
    },
  },
  {
    id: 'cerez-yonca', group: 'Çerezlik', name: 'Yonca çerezlik',
    params: [P('n', 'Yaprak sayısı', 4, 3, 6), P('lr', 'Yaprak çapı', 140, 80, 260), P('rim', 'Kenar eni', 14, 10, 30), P('wall', 'Ara duvar', 10, 6, 25), P('d', 'Derinlik', 12, 3, 15, 0.5)],
    build: (p) => {
      const r = p.lr / 2;
      const inner = r - p.rim;
      // lobe centres far enough apart that neighbouring bowls keep a `wall` between them
      const dist = Math.max(r * 0.8, (2 * inner + p.wall) / (2 * Math.sin(Math.PI / p.n)));
      const C = dist + r;
      const centres = Array.from({ length: p.n }, (_, i) => { const a = Math.PI / 2 + (TAU * i) / p.n; return [C + dist * Math.cos(a), C + dist * Math.sin(a)]; });
      const loops = [...centres.map(([x, y]) => circlePts(x, y, r)), circlePts(C, C, dist * 0.9)];
      const outline = outlineOf(loops, 18);
      const comps = centres.map(([x, y]) => ({ pts: circlePts(x, y, inner), islands: [], kind: 'cep', depth: p.d }));
      return { outline, comps };
    },
  },
  {
    id: 'cerez-cicek', group: 'Çerezlik', name: 'Çiçek çerezlik',
    params: [P('n', 'Yaprak sayısı', 6, 5, 8), P('cr', 'Orta çap', 120, 70, 200), P('pr', 'Yaprak çapı', 110, 60, 180), P('rim', 'Kenar eni', 12, 10, 30), P('wall', 'Ara duvar', 9, 6, 25), P('d', 'Derinlik', 12, 3, 15, 0.5)],
    build: (p) => {
      const rc = p.cr / 2, rp = p.pr / 2;
      const ic = rc - p.rim, ip = rp - p.rim;
      // petals: far enough from the centre bowl and from each other
      const dist = Math.max(ic + ip + p.wall, (2 * ip + p.wall) / (2 * Math.sin(Math.PI / p.n)));
      const C = dist + rp;
      const centres = Array.from({ length: p.n }, (_, i) => { const a = Math.PI / 2 + (TAU * i) / p.n; return [C + dist * Math.cos(a), C + dist * Math.sin(a)]; });
      const outline = outlineOf([circlePts(C, C, Math.max(rc, dist)), ...centres.map(([x, y]) => circlePts(x, y, rp))], 14);
      const comps = [{ pts: circlePts(C, C, ic), islands: [], kind: 'cep', depth: p.d }, ...centres.map(([x, y]) => ({ pts: circlePts(x, y, ip), islands: [], kind: 'cep', depth: p.d }))];
      return { outline, comps };
    },
  },
];

export const defaultParams = (model) => Object.fromEntries(model.params.map((p) => [p.k, p.def]));

/** Builds a part (same shape as a DXF part, outline at the origin) from a catalog model. */
export function catalogPart(model, params) {
  const p = { ...defaultParams(model), ...params };
  const raw = model.build(p);
  const outline = ensureCCW(raw.outline);
  const b = bbox([outline]);
  const shift = (pts) => pts.map(([x, y]) => [x - b.minX, y - b.minY]);
  const comps = (raw.comps || []).map((c) => ({ ...c, pts: shift(ensureCCW(c.pts)), islands: (c.islands || []).map(shift) }));
  const holeArea = comps.filter((c) => c.kind === 'delik').reduce((s, c) => s + area(c.pts), 0);
  return {
    name: `${model.name} ${Math.round(b.w)}×${Math.round(b.h)}`,
    outline: shift(outline),
    comps,
    lines: (raw.lines || []).map(shift),
    width: b.w,
    height: b.h,
    area: area(outline) - holeArea,
    catalog: { id: model.id, params: p },
  };
}
