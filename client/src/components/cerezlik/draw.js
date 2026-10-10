// Shared canvas drawing for the çerezlik screens.

export const PATH_COLORS = { rough: '#4f8cff', pocket: '#4f8cff', bowl: '#36c5f0', bowlRest: '#ffb86b', semi: '#ffb86b', relief: '#f7e463', round: '#e0a03c', groove: '#ff6f9c', vline: '#c46cff', vcarve: '#ff4fd8', cut: '#2fd08a' };
export const WOOD = { part: '#d8b88a', partEdge: '#8a6236', bowl: '#a97b4c', line: '#5b3a19' };

export function cssVar(name, fallback) {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

/** Sizes a canvas for crisp lines on HiDPI screens; returns its 2D context in CSS pixels. */
export function setupCanvas(canvas, w, h) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.aspectRatio = `${w} / ${h}`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Fit transform: world (Y up) → canvas (Y down). */
export function fitView(box, w, h, pad = 8) {
  const s = Math.min((w - 2 * pad) / (box.w || 1), (h - 2 * pad) / (box.h || 1));
  const ox = pad + ((w - 2 * pad) - box.w * s) / 2 - box.minX * s;
  const oy = h - pad - ((h - 2 * pad) - box.h * s) / 2 + box.minY * s;
  return { s, map: ([x, y]) => [ox + x * s, oy - y * s], unmap: (cx, cy) => [(cx - ox) / s, (oy - cy) / s] };
}

export function tracePoly(ctx, pts, map) {
  pts.forEach((p, i) => { const [x, y] = map(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
}

/** Draws one part (outline, bowls, holes, lines) through a point mapping. */
export function drawPart(ctx, part, map, { bg, toolLine = 1 } = {}) {
  if (part.surface) {
    drawSurface(ctx, part, map);
    // through holes, grooves and lines on top of the shaded surface
    for (const c of part.comps) {
      if (c.kind !== 'delik') continue;
      ctx.beginPath(); tracePoly(ctx, c.pts, map);
      if (bg) { ctx.fillStyle = bg; ctx.fill(); }
      ctx.strokeStyle = WOOD.partEdge; ctx.lineWidth = toolLine; ctx.stroke();
    }
    ctx.strokeStyle = WOOD.bowl; ctx.lineWidth = toolLine * 4; ctx.lineJoin = 'round';
    for (const g of part.grooves || []) {
      ctx.beginPath();
      g.pts.forEach((p, i) => { const [x, y] = map(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if (g.closed) ctx.closePath();
      ctx.stroke();
    }
    ctx.strokeStyle = WOOD.line; ctx.lineWidth = toolLine * 1.5;
    for (const l of part.lines || []) {
      ctx.beginPath();
      l.forEach((p, i) => { const [x, y] = map(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    drawCarve(ctx, part, map, toolLine);
    return;
  }
  ctx.beginPath();
  tracePoly(ctx, part.outline, map);
  for (const c of part.comps) if (c.kind === 'delik') tracePoly(ctx, c.pts, map);
  ctx.fillStyle = WOOD.part;
  ctx.fill('evenodd');
  ctx.lineWidth = toolLine;
  ctx.strokeStyle = WOOD.partEdge;
  ctx.stroke();
  for (const c of part.comps) {
    ctx.beginPath();
    tracePoly(ctx, c.pts, map);
    for (const isl of c.islands || []) tracePoly(ctx, isl, map);
    if (c.kind === 'cep') { ctx.fillStyle = WOOD.bowl; ctx.fill('evenodd'); }
    else if (bg) { ctx.fillStyle = bg; ctx.fill('evenodd'); }
    ctx.strokeStyle = WOOD.partEdge;
    ctx.stroke();
  }
  // ball-nose grooves: a wide soft stroke
  ctx.strokeStyle = WOOD.bowl;
  ctx.lineWidth = toolLine * 4;
  ctx.lineJoin = 'round';
  for (const g of part.grooves || []) {
    ctx.beginPath();
    g.pts.forEach((p, i) => { const [x, y] = map(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    if (g.closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.strokeStyle = WOOD.line;
  ctx.lineWidth = toolLine * 1.5;
  for (const l of part.lines) {
    ctx.beginPath();
    l.forEach((p, i) => { const [x, y] = map(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
  }
  drawCarve(ctx, part, map, toolLine);
}

/** V-carved text: stroke width drawn from the cut width (2 × depth for a 90° bit). */
export function drawCarve(ctx, part, map, toolLine = 1) {
  if (!part.carve || !part.carve.length) return;
  const o = map([0, 0]), e = map([1, 0]);
  const s = Math.hypot(e[0] - o[0], e[1] - o[1]); // px per mm
  const k = Math.tan((((part.text?.angle || 90) / 2) * Math.PI) / 180);
  ctx.strokeStyle = WOOD.line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of part.carve) {
    for (let i = 1; i < p.length; i++) {
      const a = map(p[i - 1]), b = map(p[i]);
      ctx.lineWidth = Math.max(toolLine * 0.6, (p[i - 1][2] + p[i][2]) * k * s);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

export function drawPaths(ctx, passes, map, width = 0.8) {
  ctx.lineWidth = width;
  for (const { kind, pts } of passes) {
    ctx.strokeStyle = PATH_COLORS[kind] || '#888';
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = map(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
  }
}

const shadeCache = new WeakMap();

/**
 * Hill-shaded picture of a 3D part's surface (depth grid), as a canvas whose
 * row 0 is the grid's bottom row (draw it through an affine map with Y up).
 */
export function shadeSurface(surface) {
  if (shadeCache.has(surface)) return shadeCache.get(surface);
  const g = surface.grid;
  const c = document.createElement('canvas');
  c.width = g.w; c.height = g.h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(g.w, g.h);
  const lx = -0.5, ly = 0.6, lz = 0.62; // light from the upper left
  const at = (i, j) => g.z[Math.min(g.h - 1, Math.max(0, j)) * g.w + Math.min(g.w - 1, Math.max(0, i))];
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    // surface height = top − depth, so its normal is (∂depth/∂x, ∂depth/∂y, 1)
    const nx = (at(i + 1, j) - at(i - 1, j)) / (2 * g.cell);
    const ny = (at(i, j + 1) - at(i, j - 1)) / (2 * g.cell);
    const nl = Math.hypot(nx, ny, 1);
    const lam = Math.max(0, (nx * lx + ny * ly + lz) / nl);
    const shade = 0.35 + 0.75 * lam - Math.min(0.25, at(i, j) * 0.012);
    const k = (j * g.w + i) * 4;
    img.data[k] = Math.min(255, 216 * shade);
    img.data[k + 1] = Math.min(255, 184 * shade);
    img.data[k + 2] = Math.min(255, 138 * shade);
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  shadeCache.set(surface, c);
  return c;
}

/** Draws the shaded surface of a 3D part, clipped to its outline, through an affine point map. */
export function drawSurface(ctx, part, map) {
  const g = part.surface.grid;
  const o = map([0, 0]), ex = map([1, 0]), ey = map([0, 1]);
  ctx.save();
  ctx.beginPath();
  tracePoly(ctx, part.outline, map);
  ctx.clip();
  ctx.transform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(shadeSurface(part.surface), g.x0, g.y0, g.w * g.cell, g.h * g.cell);
  ctx.restore();
  ctx.beginPath();
  tracePoly(ctx, part.outline, map);
  ctx.strokeStyle = WOOD.partEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
}
