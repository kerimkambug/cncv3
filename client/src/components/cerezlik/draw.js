// Shared canvas drawing for the çerezlik screens.

export const PATH_COLORS = { pocket: '#4f8cff', round: '#e0a03c', vline: '#c46cff', cut: '#2fd08a' };
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
  ctx.strokeStyle = WOOD.line;
  ctx.lineWidth = toolLine * 1.5;
  for (const l of part.lines) {
    ctx.beginPath();
    l.forEach((p, i) => { const [x, y] = map(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
  }
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
