// Small hand-built DXF drawings used by the tests (and written out as a sample
// file): a round tray with three bowls, a leaf (bulged polyline + ellipse
// compartment), a rounded tray drawn from loose LINE/ARC pieces, and a crescent.

const pair = (c, v) => `${c}\n${v}`;

export function dxfDoc(entities, { units = 4 } = {}) {
  return [
    pair(0, 'SECTION'), pair(2, 'HEADER'), pair(9, '$INSUNITS'), pair(70, units), pair(0, 'ENDSEC'),
    pair(0, 'SECTION'), pair(2, 'ENTITIES'), ...entities, pair(0, 'ENDSEC'), pair(0, 'EOF'),
  ].join('\n') + '\n';
}

export const circle = (x, y, r, layer = '0') => [pair(0, 'CIRCLE'), pair(8, layer), pair(10, x), pair(20, y), pair(40, r)].join('\n');
export const line = (x1, y1, x2, y2, layer = '0') => [pair(0, 'LINE'), pair(8, layer), pair(10, x1), pair(20, y1), pair(11, x2), pair(21, y2)].join('\n');
export const arc = (x, y, r, a0, a1, layer = '0') => [pair(0, 'ARC'), pair(8, layer), pair(10, x), pair(20, y), pair(40, r), pair(50, a0), pair(51, a1)].join('\n');
export const ellipse = (x, y, mx, my, ratio, layer = '0') => [pair(0, 'ELLIPSE'), pair(8, layer), pair(10, x), pair(20, y), pair(11, mx), pair(21, my), pair(40, ratio), pair(41, 0), pair(42, 2 * Math.PI)].join('\n');
export function lwpoly(verts, closed = true, layer = '0') {
  const out = [pair(0, 'LWPOLYLINE'), pair(8, layer), pair(90, verts.length), pair(70, closed ? 1 : 0)];
  for (const [x, y, b = 0] of verts) { out.push(pair(10, x), pair(20, y)); if (b) out.push(pair(42, b)); }
  return out.join('\n');
}

/** Rounded rectangle from separate LINE and ARC entities (tests chaining). */
export function roundedRectPieces(x, y, w, h, r, layer = '0') {
  return [
    line(x + r, y, x + w - r, y, layer), arc(x + w - r, y + r, r, 270, 360, layer),
    line(x + w, y + r, x + w, y + h - r, layer), arc(x + w - r, y + h - r, r, 0, 90, layer),
    line(x + w - r, y + h, x + r, y + h, layer), arc(x + r, y + h - r, r, 90, 180, layer),
    line(x, y + h - r, x, y + r, layer), arc(x + r, y + r, r, 180, 270, layer),
  ];
}

/** Rounded rectangle as one bulged LWPOLYLINE. */
export function roundedRectPoly(x, y, w, h, r, layer = '0') {
  const b = Math.tan(Math.PI / 8); // 90° corner
  return lwpoly([
    [x + r, y], [x + w - r, y, b], [x + w, y + r], [x + w, y + h - r, b],
    [x + w - r, y + h], [x + r, y + h, b], [x, y + h - r], [x, y + r, b],
  ], true, layer);
}

export function crescentPoints(cx, cy) {
  const pts = [];
  const a0 = Math.atan2(99.8, 66.67), a1 = 2 * Math.PI - a0;
  for (let i = 0; i <= 80; i++) { const a = a0 + ((a1 - a0) * i) / 80; pts.push([cx + 120 * Math.cos(a), cy + 120 * Math.sin(a)]); }
  const b0 = -Math.atan2(99.8, 6.67) + 2 * Math.PI, b1 = Math.atan2(99.8, 6.67);
  for (let i = 1; i < 60; i++) { const a = b0 - ((b0 - b1) * i) / 60; pts.push([cx + 60 + 100 * Math.cos(a), cy + 100 * Math.sin(a)]); }
  return pts;
}

export function sampleDrawing() {
  const ents = [];
  // round tray, three bowls
  ents.push(circle(200, 200, 150));
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + Math.PI / 2;
    ents.push(circle(200 + 75 * Math.cos(a), 200 + 75 * Math.sin(a), 55));
  }
  // leaf: two arcs as a bulged polyline, an elliptic bowl and a V-carved vein
  ents.push(lwpoly([[450, 200, 0.466], [750, 200, 0.466]]));
  ents.push(ellipse(600, 200, 100, 0, 0.35));
  ents.push(line(462, 200, 492, 200, 'V'));
  // rounded tray from loose LINE/ARC pieces, two rounded bowls
  ents.push(...roundedRectPieces(850, 100, 300, 180, 30));
  ents.push(roundedRectPoly(870, 125, 120, 130, 20));
  ents.push(roundedRectPoly(1010, 125, 120, 130, 20));
  // crescent (no bowls)
  ents.push(lwpoly(crescentPoints(1400, 200)));
  return dxfDoc(ents);
}
