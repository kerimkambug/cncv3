// Minimal ASCII DXF reader for the çerezlik module: turns the drawing into flat
// polylines (arcs, bulges, circles, ellipses and splines are flattened to short
// chords) and joins loose segments into chains / closed loops.

const UNIT_MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 13: 0.001, 14: 0.1 };
const IGNORED = new Set(['TEXT', 'MTEXT', 'DIMENSION', 'HATCH', 'POINT', 'SOLID', 'ATTDEF', 'ATTRIB', 'LEADER', 'MLEADER', 'VIEWPORT', 'IMAGE', 'WIPEOUT', '3DFACE', 'SEQEND']);

function readPairs(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (Number.isNaN(code)) { i -= 1; continue; } // resync on stray blank lines
    pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

/** Splits the pair stream into raw entities ({type, g: [[code, value]...]}) per section. */
function collect(pairs) {
  const out = { header: {}, blocks: new Map(), entities: [] };
  let section = null, block = null, cur = null, lastHeaderVar = null;
  const flush = () => {
    if (!cur) return;
    const target = block ? block.entities : section === 'ENTITIES' ? out.entities : null;
    if (target) target.push(cur);
    cur = null;
  };
  for (let i = 0; i < pairs.length; i++) {
    const [code, val] = pairs[i];
    if (code === 0) {
      flush();
      if (val === 'SECTION') { section = pairs[i + 1] && pairs[i + 1][1]; i++; continue; }
      if (val === 'ENDSEC') { section = null; continue; }
      if (val === 'EOF') break;
      if (section === 'BLOCKS' && val === 'BLOCK') { block = { name: '', base: [0, 0], entities: [], g: [] }; cur = null; continue; }
      if (section === 'BLOCKS' && val === 'ENDBLK') { if (block) out.blocks.set(block.name, block); block = null; continue; }
      if (section === 'ENTITIES' || (section === 'BLOCKS' && block)) cur = { type: val, g: [] };
      continue;
    }
    if (section === 'HEADER') {
      if (code === 9) lastHeaderVar = val;
      else if (lastHeaderVar) out.header[lastHeaderVar] = val;
      continue;
    }
    if (block && !cur) {
      if (code === 2) block.name = val;
      else if (code === 10) block.base[0] = +val;
      else if (code === 20) block.base[1] = +val;
      continue;
    }
    if (cur) cur.g.push([code, val]);
  }
  flush();
  return out;
}

const first = (g, code, def = 0) => { const p = g.find((x) => x[0] === code); return p ? +p[1] : def; };
const firstStr = (g, code, def = '') => { const p = g.find((x) => x[0] === code); return p ? p[1] : def; };
const all = (g, code) => g.filter((x) => x[0] === code).map((x) => +x[1]);

function arcSteps(r, sweep, tol) {
  if (r <= tol) return 1;
  const max = 2 * Math.acos(Math.max(-1, 1 - tol / r));
  return Math.min(1440, Math.max(2, Math.ceil(Math.abs(sweep) / (max || 0.1))));
}

function arcPoints(cx, cy, r, a0, a1, tol) {
  const n = arcSteps(r, a1 - a0, tol);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Points of a bulged polyline segment p1 → p2 (bulge = tan(sweep / 4)), excluding p1. */
function bulgePoints(p1, p2, bulge, tol) {
  if (!bulge) return [p2];
  const sweep = 4 * Math.atan(bulge);
  const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  if (chord < 1e-9) return [p2];
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
  const d = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)); // centre distance from the chord midpoint
  const ux = (p2[0] - p1[0]) / chord, uy = (p2[1] - p1[1]) / chord;
  // centre lies to the left of p1→p2 for a CCW (positive) bulge below 180°
  const side = (bulge > 0 ? 1 : -1) * (Math.abs(sweep) > Math.PI ? -1 : 1);
  const cx = mx - uy * d * side, cy = my + ux * d * side;
  const a0 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const pts = arcPoints(cx, cy, r, a0, a0 + sweep, tol);
  pts[pts.length - 1] = p2;
  return pts.slice(1);
}

/** NURBS point by de Boor (knots clamped or not, weights optional). */
function deBoor(t, p, knots, ctrl, weights) {
  const n = ctrl.length - 1;
  let k = p;
  while (k < n && t >= knots[k + 1]) k++;
  const d = [];
  for (let j = 0; j <= p; j++) {
    const c = ctrl[k - p + j], w = weights ? weights[k - p + j] : 1;
    d.push([c[0] * w, c[1] * w, w]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const den = knots[i + p - r + 1] - knots[i];
      const a = den ? (t - knots[i]) / den : 0;
      for (let m = 0; m < 3; m++) d[j][m] = (1 - a) * d[j - 1][m] + a * d[j][m];
    }
  }
  return [d[p][0] / d[p][2], d[p][1] / d[p][2]];
}

function splinePoints(g, warnings) {
  const p = first(g, 71, 3);
  const knots = all(g, 40);
  const xs = all(g, 10), ys = all(g, 20);
  const ctrl = xs.map((x, i) => [x, ys[i] ?? 0]);
  const w = all(g, 41);
  const closed = (first(g, 70) & 1) === 1;
  if (ctrl.length > p && knots.length === ctrl.length + p + 1) {
    let len = 0;
    for (let i = 1; i < ctrl.length; i++) len += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
    const n = Math.min(4000, Math.max(ctrl.length * 12, Math.ceil(len / 0.4)));
    const t0 = knots[p], t1 = knots[ctrl.length];
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(deBoor(t0 + ((t1 - t0) * i) / n - (i === n ? 1e-9 * (t1 - t0) : 0), p, knots, ctrl, w.length === ctrl.length ? w : null));
    return { pts, closed };
  }
  const fx = all(g, 11), fy = all(g, 21);
  if (fx.length >= 2) {
    warnings.add('Bazı eğriler (spline) yalnızca geçiş noktalarından okundu; hatlar yaklaşık olabilir.');
    return { pts: fx.map((x, i) => [x, fy[i] ?? 0]), closed };
  }
  return null;
}

/** OCS → WCS for the usual 2D case: extrusion (0,0,-1) mirrors X. */
const ocs = (g) => (first(g, 230, 1) < 0 ? ([x, y]) => [-x, y] : (pt) => pt);

function entityToPolys(e, ctx, xf, depth) {
  const { tol, warnings } = ctx;
  const g = e.g;
  const layer = firstStr(g, 8, '0');
  const push = (pts, closed) => { if (pts.length >= 2) ctx.out.push({ layer, pts: pts.map(xf), closed }); };
  switch (e.type) {
    case 'LINE':
      push([[first(g, 10), first(g, 20)], [first(g, 11), first(g, 21)]], false);
      break;
    case 'ARC': {
      const o = ocs(g);
      let a0 = (first(g, 50) * Math.PI) / 180, a1 = (first(g, 51) * Math.PI) / 180;
      while (a1 <= a0) a1 += 2 * Math.PI;
      push(arcPoints(first(g, 10), first(g, 20), first(g, 40), a0, a1, tol).map(o), false);
      break;
    }
    case 'CIRCLE': {
      const o = ocs(g);
      const pts = arcPoints(first(g, 10), first(g, 20), first(g, 40), 0, 2 * Math.PI, tol);
      pts.pop();
      push(pts.map(o), true);
      break;
    }
    case 'ELLIPSE': {
      const cx = first(g, 10), cy = first(g, 20), mx = first(g, 11), my = first(g, 21), ratio = first(g, 40, 1);
      let t0 = first(g, 41, 0), t1 = first(g, 42, 2 * Math.PI);
      while (t1 <= t0) t1 += 2 * Math.PI;
      const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6;
      const R = Math.hypot(mx, my);
      const n = arcSteps(R, t1 - t0, tol);
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        pts.push([cx + mx * Math.cos(t) - my * ratio * Math.sin(t), cy + my * Math.cos(t) + mx * ratio * Math.sin(t)]);
      }
      if (full) pts.pop();
      const o = ocs(g);
      push(pts.map(o), full);
      break;
    }
    case 'LWPOLYLINE': {
      const o = ocs(g);
      const verts = [];
      for (const [code, val] of g) {
        if (code === 10) verts.push({ p: [+val, 0], b: 0 });
        else if (code === 20 && verts.length) verts[verts.length - 1].p[1] = +val;
        else if (code === 42 && verts.length) verts[verts.length - 1].b = +val;
      }
      polyFromVerts(verts, (first(g, 70) & 1) === 1, tol, (pts, closed) => push(pts.map(o), closed));
      break;
    }
    case 'POLYLINE': {
      const flags = first(g, 70);
      if (flags & (16 | 64)) { warnings.add('3B ağ/yüzey nesneleri atlandı.'); break; }
      const verts = (e.vertices || [])
        .filter((v) => !(first(v.g, 70) & 16))
        .map((v) => ({ p: [first(v.g, 10), first(v.g, 20)], b: first(v.g, 42) }));
      polyFromVerts(verts, (flags & 1) === 1, tol, (pts, closed) => push(pts, closed));
      break;
    }
    case 'SPLINE': {
      const s = splinePoints(g, warnings);
      if (s) push(s.closed ? s.pts.slice(0, -1) : s.pts, s.closed);
      break;
    }
    case 'INSERT': {
      if (depth > 8) break;
      const blk = ctx.blocks.get(firstStr(g, 2));
      if (!blk) break;
      const ix = first(g, 10), iy = first(g, 20);
      const sx = first(g, 41, 1), sy = first(g, 42, 1);
      const rot = (first(g, 50) * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
      const [bx, by] = blk.base;
      const local = ([x, y]) => {
        const px = (x - bx) * sx, py = (y - by) * sy;
        return xf([ix + px * c - py * s, iy + px * s + py * c]);
      };
      for (const child of groupPolylines(blk.entities)) entityToPolys(child, ctx, local, depth + 1);
      break;
    }
    default:
      if (!IGNORED.has(e.type)) ctx.skipped.add(e.type);
  }
}

function polyFromVerts(verts, closed, tol, emit) {
  if (verts.length < 2) return;
  const pts = [verts[0].p];
  const n = verts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    pts.push(...bulgePoints(a.p, b.p, a.b, tol));
  }
  if (closed) pts.pop(); // the last point is the first one again
  emit(pts, closed);
}

/** Attaches VERTEX entities to their POLYLINE. */
function groupPolylines(entities) {
  const out = [];
  let poly = null;
  for (const e of entities) {
    if (e.type === 'VERTEX') { if (poly) poly.vertices.push(e); continue; }
    if (e.type === 'SEQEND') { poly = null; continue; }
    if (e.type === 'POLYLINE') { poly = { ...e, vertices: [] }; out.push(poly); continue; }
    poly = null;
    out.push(e);
  }
  return out;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Joins open polylines whose ends meet (within `joinTol`) into longer chains;
 * a chain whose ends meet becomes a closed loop.
 */
export function chainPolylines(polys, joinTol = 0.1) {
  const closed = [], open = [];
  for (const p of polys) {
    if (p.closed) closed.push(p);
    else if (p.pts.length > 2 && dist(p.pts[0], p.pts[p.pts.length - 1]) <= joinTol) closed.push({ ...p, pts: p.pts.slice(0, -1), closed: true });
    else open.push(p);
  }
  const cell = joinTol * 2;
  const key = (pt) => `${Math.floor(pt[0] / cell)},${Math.floor(pt[1] / cell)}`;
  const index = new Map();
  const add = (pt, ref) => { const k = key(pt); if (!index.has(k)) index.set(k, []); index.get(k).push(ref); };
  open.forEach((p, i) => { add(p.pts[0], { i, end: 0 }); add(p.pts[p.pts.length - 1], { i, end: 1 }); });
  const used = new Uint8Array(open.length);
  const find = (pt) => {
    const cx = Math.floor(pt[0] / cell), cy = Math.floor(pt[1] / cell);
    let best = null, bestD = joinTol;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const ref of index.get(`${cx + dx},${cy + dy}`) || []) {
        if (used[ref.i]) continue;
        const q = ref.end === 0 ? open[ref.i].pts[0] : open[ref.i].pts[open[ref.i].pts.length - 1];
        const d = dist(pt, q);
        if (d <= bestD) { bestD = d; best = ref; }
      }
    }
    return best;
  };
  const chains = [];
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let pts = open[i].pts.slice();
    for (let pass = 0; pass < 2; pass++) {
      for (;;) {
        if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= joinTol) break;
        const ref = find(pts[pts.length - 1]);
        if (!ref) break;
        used[ref.i] = 1;
        const seg = ref.end === 0 ? open[ref.i].pts : open[ref.i].pts.slice().reverse();
        pts = pts.concat(seg.slice(1));
      }
      pts.reverse();
    }
    if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= joinTol) closed.push({ layer: open[i].layer, pts: pts.slice(0, -1), closed: true });
    else chains.push({ layer: open[i].layer, pts, closed: false });
  }
  return { loops: closed, chains };
}

/**
 * Reads an ASCII DXF. Returns closed loops and open chains in millimetres,
 * plus human-readable warnings.
 */
export function parseDxf(text, { tol = 0.02, joinTol = 0.1 } = {}) {
  if (/^AutoCAD Binary DXF/.test(text)) throw new Error('İkili (binary) DXF desteklenmiyor; dosyayı ASCII DXF olarak kaydedin.');
  const raw = collect(readPairs(text));
  const warnings = new Set();
  const skipped = new Set();
  const ctx = { tol, warnings, skipped, blocks: new Map([...raw.blocks].map(([k, b]) => [k, b])), out: [] };
  for (const e of groupPolylines(raw.entities)) entityToPolys(e, ctx, (p) => p, 0);
  const units = parseInt(raw.header.$INSUNITS, 10);
  const k = UNIT_MM[units] || 1;
  if (k !== 1) for (const p of ctx.out) p.pts = p.pts.map(([x, y]) => [x * k, y * k]);
  if (skipped.size) warnings.add(`Okunamayan nesneler atlandı: ${[...skipped].join(', ')}.`);
  const { loops, chains } = chainPolylines(ctx.out, joinTol);
  if (!loops.length && !chains.length) throw new Error('Çizimde kesilecek hat bulunamadı.');
  return { loops, chains, warnings: [...warnings], unitScale: k };
}
