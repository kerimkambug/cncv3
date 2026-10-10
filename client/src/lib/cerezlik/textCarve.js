// V-carved text. The text is rendered with a real font into a bitmap, thinned
// to its centre lines (Zhang–Suen), and each centre line is cut with the V bit
// at a depth that follows the stroke: depth = half the stroke width / tan(angle/2).
// Wide strokes go deeper, thin ones shallower, branches run out into the sharp
// corners at depth 0 — the same idea as a CAM program's V-bit carving.
import { edt } from './surface.js';
import { offset, pointInPolygon, signedArea } from './geom.js';

export const FONTS = ['Georgia', 'Times New Roman', 'Palatino Linotype', 'Arial', 'Verdana', 'Tahoma', 'Segoe Script', 'Lucida Handwriting', 'Monotype Corsiva', 'Brush Script MT', 'Comic Sans MS', 'Impact'];

export const TEXT_DEFAULTS = {
  text: '', font: 'Georgia', italic: true, bold: false, height: 22, lineGap: 0.35,
  anchor: 'sag-alt', margin: 18, angle: 90, maxDepth: 4, tool: 1, rotate: 0,
};

/** Text → bitmap mask (browser only). Height = the ink height of one line in mm. */
export function renderTextMask(o) {
  const t = { ...TEXT_DEFAULTS, ...o };
  const lines = String(t.text).split('\n').map((s) => s.trimEnd()).filter((s, i, a) => s || i < a.length - 1);
  if (!lines.join('').trim()) return null;
  const pxPerMm = Math.min(20, Math.max(6, 420 / t.height));
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const fontFor = (px) => `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${px}px "${t.font}", serif`;
  // scale the font so that a line's ink (ascent + descent of the tallest line) is `height` mm
  let px = 200;
  ctx.font = fontFor(px);
  const inkH = Math.max(...lines.map((l) => { const m = ctx.measureText(l || 'H'); return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent; }));
  px = (px * t.height * pxPerMm) / (inkH || px);
  ctx.font = fontFor(px);
  const ms = lines.map((l) => ctx.measureText(l || ' '));
  const lineH = t.height * pxPerMm;
  const gap = t.lineGap * lineH;
  const widths = ms.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  const pad = 6;
  const W = Math.ceil(Math.max(...widths)) + 2 * pad;
  const H = Math.ceil(lines.length * lineH + (lines.length - 1) * gap) + 2 * pad;
  c.width = W; c.height = H;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = fontFor(px);
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, k) => {
    const m = ms[k];
    const top = pad + k * (lineH + gap);
    // centre each line; place the ink box at the line's slot
    const x = pad + (W - 2 * pad - widths[k]) / 2 + m.actualBoundingBoxLeft;
    const y = top + (lineH - (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) / 2 + m.actualBoundingBoxAscent;
    ctx.fillText(l, x, y);
  });
  const img = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) mask[k] = img[k * 4] > 127 ? 1 : 0;
  return { mask, w: W, h: H, mmPerPx: 1 / pxPerMm };
}

/** Zhang–Suen thinning (expects a zero border). */
export function thin(mask, w, h) {
  const m = mask.slice();
  const del = [];
  for (let changed = true; changed;) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (!m[p]) continue;
        const P2 = m[p - w], P3 = m[p - w + 1], P4 = m[p + 1], P5 = m[p + w + 1], P6 = m[p + w], P7 = m[p + w - 1], P8 = m[p - 1], P9 = m[p - w - 1];
        const B = P2 + P3 + P4 + P5 + P6 + P7 + P8 + P9;
        if (B < 2 || B > 6) continue;
        const seq = [P2, P3, P4, P5, P6, P7, P8, P9, P2];
        let A = 0;
        for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
        if (A !== 1) continue;
        if (step === 0 ? (P2 * P4 * P6 || P4 * P6 * P8) : (P2 * P4 * P8 || P2 * P6 * P8)) continue;
        del.push(p);
      }
      for (const p of del) m[p] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Skeleton pixels → polylines of pixel indices (diagonals only where no 4-neighbour bridges them). */
export function traceSkeleton(sk, w, h) {
  const nbrs = (p) => {
    const x = p % w, y = (p / w) | 0, out = [];
    for (const [dx, dy] of N8) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || !sk[yy * w + xx]) continue;
      if (dx && dy && (sk[y * w + xx] || sk[yy * w + x])) continue; // a 4-path already connects them
      out.push(yy * w + xx);
    }
    return out;
  };
  const seen = new Set();
  const ek = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  const paths = [];
  const walk = (a, b) => {
    const path = [a, b];
    seen.add(ek(a, b));
    let prev = a, cur = b;
    for (;;) {
      const nb = nbrs(cur);
      if (nb.length !== 2) break;
      const next = nb[0] === prev ? nb[1] : nb[0];
      if (seen.has(ek(cur, next))) break;
      seen.add(ek(cur, next));
      path.push(next);
      prev = cur; cur = next;
    }
    return path;
  };
  const pixels = [];
  for (let p = 0; p < sk.length; p++) if (sk[p]) pixels.push(p);
  for (const p of pixels) {
    const nb = nbrs(p);
    if (nb.length === 0) { paths.push([p, p]); continue; }
    if (nb.length === 2) continue;
    for (const q of nb) if (!seen.has(ek(p, q))) paths.push(walk(p, q));
  }
  // closed loops (every pixel has two neighbours, e.g. the letter O)
  for (const p of pixels) for (const q of nbrs(p)) if (!seen.has(ek(p, q))) paths.push(walk(p, q));
  return paths;
}

function simplify3(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [i, j] = st.pop();
    const a = pts[i], b = pts[j];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(...ab);
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) {
      const ap = [pts[k][0] - a[0], pts[k][1] - a[1], pts[k][2] - a[2]];
      const d = L ? Math.hypot(ap[1] * ab[2] - ap[2] * ab[1], ap[2] * ab[0] - ap[0] * ab[2], ap[0] * ab[1] - ap[1] * ab[0]) / L : Math.hypot(...ap);
      if (d > bd) { bd = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; st.push([i, best], [best, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * Bitmap → V-carve centre lines [[x, y, depth]...] in mm (y up, origin at the
 * bitmap's lower left). depth = half stroke width / tan(angle/2), capped.
 */
export function carveFromMask({ mask, w, h, mmPerPx }, { angle = 90, maxDepth = 4 } = {}) {
  const dist = edt(mask, w, h);
  const sk = thin(mask, w, h);
  const k = 1 / Math.tan(((angle / 2) * Math.PI) / 180);
  const toPt = (p) => {
    const x = p % w, y = (p / w) | 0;
    return [(x + 0.5) * mmPerPx, (h - y - 0.5) * mmPerPx, Math.min(maxDepth, Math.max(0.05, (dist[p] - 0.5) * mmPerPx * k))];
  };
  return traceSkeleton(sk, w, h)
    .filter((path) => path.length >= 2)
    .map((path) => simplify3(path.map(toPt), 0.02));
}

/** Width / height of a carve set. */
export function carveBox(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/**
 * Places carve lines on a part: near the chosen corner/edge (`anchor`), at
 * least `margin` mm inside the outline and clear of compartments, holes and
 * grooves. Walks from the anchor towards the centre until the text fits.
 * @returns {{ paths: number[][][], fits: boolean }}  paths in part coordinates
 */
export function placeCarve(part, paths, { anchor = 'sag-alt', margin = 18, rotate = 0 } = {}) {
  const b = carveBox(paths);
  const a = (rotate * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const local = paths.map((p) => p.map(([x, y, d]) => {
    const u = x - (b.x0 + b.x1) / 2, v = y - (b.y0 + b.y1) / 2;
    return [u * ca - v * sa, u * sa + v * ca, d];
  }));
  const lb = carveBox(local);
  const W = part.width, H = part.height;
  const hw = lb.w / 2, hh = lb.h / 2;
  const ax = anchor.includes('sol') ? margin + hw : anchor.includes('sag') ? W - margin - hw : W / 2;
  const ay = anchor.includes('alt') ? margin + hh : anchor.includes('ust') ? H - margin - hh : H / 2;
  const inner = offset([part.outline], -margin);
  const keepOut = [
    ...part.comps.flatMap((c) => offset([c.pts], margin * 0.6)),
    ...(part.grooves || []).flatMap((g) => (g.closed ? offset([g.pts], 6) : [])),
  ];
  const insideInner = (pt) => inner.some((l) => signedArea(l) > 0 && pointInPolygon(pt, l)) && !inner.some((l) => signedArea(l) < 0 && pointInPolygon(pt, l));
  // probe points: the box outline plus a sample of the strokes
  const probes = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    probes.push([lb.x0 + lb.w * t, lb.y0], [lb.x0 + lb.w * t, lb.y1], [lb.x0, lb.y0 + lb.h * t], [lb.x1, lb.y0 + lb.h * t]);
  }
  const all = local.flat();
  for (let k = 0; k < all.length; k += Math.max(1, Math.floor(all.length / 300))) probes.push(all[k]);
  const fits = (px, py) => probes.every(([x, y]) => {
    const pt = [x + px, y + py];
    return insideInner(pt) && !keepOut.some((l) => signedArea(l) > 0 && pointInPolygon(pt, l));
  });
  let pos = null;
  for (let s = 0; s <= 60 && !pos; s++) {
    const t = s / 60;
    const px = ax + (W / 2 - ax) * t, py = ay + (H / 2 - ay) * t;
    if (fits(px, py)) pos = [px, py];
  }
  const [px, py] = pos || [ax, ay];
  return { paths: local.map((p) => p.map(([x, y, d]) => [x + px, y + py, d])), fits: !!pos };
}
