const TOKEN_RE = /([XYZIJKFSR])\s*([-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[Ee][-+]?\d+)?)/gi;

function number(value) {
  return Number.parseFloat(String(value).replace(',', '.'));
}

function stripComments(line) {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
}

function addPoint(state, token, value) {
  if (!Number.isFinite(value)) return;
  if (state.absolute) state[token] = value * state.unitScale;
  else state[token] += value * state.unitScale;
}

function arcPoints(start, end, params, clockwise) {
  let centerX;
  let centerY;
  if (Number.isFinite(params.I) || Number.isFinite(params.J)) {
    centerX = start.x + (Number.isFinite(params.I) ? params.I : 0);
    centerY = start.y + (Number.isFinite(params.J) ? params.J : 0);
  } else if (Number.isFinite(params.R)) {
    // R-format arc (ArtCAM .anc posts): centre from the chord and the radius;
    // a negative R asks for the arc longer than 180 degrees.
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const d = Math.hypot(dx, dy);
    const r = Math.abs(params.R);
    if (!d || r < d / 2 - 1e-6) return [end];
    const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
    const side = (!clockwise) === (params.R > 0) ? 1 : -1;
    centerX = (start.x + end.x) / 2 + side * h * (-dy / d);
    centerY = (start.y + end.y) / 2 + side * h * (dx / d);
  } else {
    return [end];
  }
  const radius = Math.hypot(start.x - centerX, start.y - centerY);
  if (!radius) return [end];

  let startAngle = Math.atan2(start.y - centerY, start.x - centerX);
  let endAngle = Math.atan2(end.y - centerY, end.x - centerX);
  let sweep = endAngle - startAngle;
  if (clockwise && sweep >= 0) sweep -= Math.PI * 2;
  if (!clockwise && sweep <= 0) sweep += Math.PI * 2;
  if (Math.abs(sweep) < 1e-9) sweep = clockwise ? -Math.PI * 2 : Math.PI * 2;

  const steps = Math.max(8, Math.ceil(Math.abs(sweep) * radius / 8));
  const points = [];
  const z0 = Number.isFinite(start.z) ? start.z : end.z;
  for (let index = 1; index <= steps; index += 1) {
    const angle = startAngle + sweep * (index / steps);
    points.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      z: z0 + (end.z - z0) * (index / steps),
    });
  }
  points[points.length - 1] = end;
  return points;
}

export function parseGcode(text, options = {}) {
  const includeRapids = Boolean(options.includeRapids);
  const segments = [];
  const state = { x: 0, y: 0, z: 0, absolute: true, unitScale: 1 };
  let motion = null;
  let tool = null;
  let previous = { x: 0, y: 0, z: 0 };

  String(text || '').split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = stripComments(rawLine).toUpperCase();
    if (!line) return;

    if (/\bG20\b/.test(line)) state.unitScale = 25.4;
    if (/\bG21\b/.test(line)) state.unitScale = 1;
    if (/\bG90\b/.test(line)) state.absolute = true;
    if (/\bG91\b/.test(line)) state.absolute = false;

    // ArtCAM writes arcs without spaces ("G2X64.00Y70.00I4.24J4.24"), so the
    // motion word cannot rely on a word boundary after its number.
    const motionMatch = line.match(/(?:^|[^A-Z])G0*([0-3])(?:\.0+)?(?![0-9])/);
    if (motionMatch) motion = Number(motionMatch[1]);
    const toolMatch = line.match(/M0*6\s*T\s*(\d+)|(?:^|[^A-Z])T\s*(\d+)\s*M0*6/);
    if (toolMatch) tool = toolMatch[1] || toolMatch[2];
    if (motion === null) return;

    const params = {};
    let match;
    TOKEN_RE.lastIndex = 0;
    while ((match = TOKEN_RE.exec(line))) params[match[1].toUpperCase()] = number(match[2]);

    const next = { x: state.x, y: state.y, z: state.z };
    ['X', 'Y', 'Z'].forEach((axis) => {
      if (Object.prototype.hasOwnProperty.call(params, axis)) addPoint(state, axis.toLowerCase(), params[axis]);
      next[axis.toLowerCase()] = state[axis.toLowerCase()];
    });

    const hasXYMove = next.x !== previous.x || next.y !== previous.y;
    if (hasXYMove && (motion !== 0 || includeRapids)) {
      const type = motion === 0 ? 'G0' : `G${motion}`;
      const points = motion === 2 || motion === 3
        ? arcPoints(previous, next, {
          I: Number.isFinite(params.I) ? params.I * state.unitScale : NaN,
          J: Number.isFinite(params.J) ? params.J * state.unitScale : NaN,
          R: Number.isFinite(params.R) ? params.R * state.unitScale : NaN,
        }, motion === 2)
        : [next];
      let from = { x: previous.x, y: previous.y, z: previous.z };
      points.forEach((to) => {
        const toZ = Number.isFinite(to.z) ? to.z : next.z;
        segments.push({ from, to: { x: to.x, y: to.y, z: toZ }, type, line: lineIndex + 1, tool });
        from = { x: to.x, y: to.y, z: toZ };
      });
    }

    previous = next;
  });

  const bounds = segments.reduce((result, segment) => {
    [segment.from, segment.to].forEach((point) => {
      result.minX = Math.min(result.minX, point.x);
      result.minY = Math.min(result.minY, point.y);
      result.maxX = Math.max(result.maxX, point.x);
      result.maxY = Math.max(result.maxY, point.y);
    });
    return result;
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  return { segments, bounds: segments.length ? bounds : null };
}

function dxfPair(lines, code, value) {
  lines.push(String(code), String(value));
}

/**
 * Plakayı X0,Y0'dan başlayıp sağa (+X) ve yukarı (+Y) doğru çizen kapalı
 * dikdörtgen referans sınırını verilen katmana ekler.
 */
function addPlateBoundary(lines, layer, width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  const corners = [
    [0, 0, w, 0],
    [w, 0, w, h],
    [w, h, 0, h],
    [0, h, 0, 0],
  ];
  corners.forEach(([x1, y1, x2, y2]) => {
    dxfPair(lines, 0, 'LINE');
    dxfPair(lines, 8, layer);
    dxfPair(lines, 10, x1.toFixed(4));
    dxfPair(lines, 20, y1.toFixed(4));
    dxfPair(lines, 30, 0);
    dxfPair(lines, 11, x2.toFixed(4));
    dxfPair(lines, 21, y2.toFixed(4));
    dxfPair(lines, 31, 0);
  });
}

export function buildGcodeDxf(parsed, options = {}) {
  const scaleX = Number(options.scaleX) || 1;
  const scaleY = Number(options.scaleY) || 1;
  const offsetX = Number(options.offsetX) || 0;
  const offsetY = Number(options.offsetY) || 0;
  const plateWidth = Number(options.plateWidth) || 0;
  const plateHeight = Number(options.plateHeight) || 0;
  const hasPlate = plateWidth > 0 && plateHeight > 0;
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', hasPlate ? '5' : '4'];

  const layerDefs = [['G0_RAPID', 8], ['G1_LINEAR', 7], ['G2_ARC_CW', 1], ['G3_ARC_CCW', 3]];
  if (hasPlate) layerDefs.push(['PLATE_BOUNDARY', 5]);
  layerDefs.forEach(([name, color]) => {
    lines.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS');
  });
  lines.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');

  if (hasPlate) {
    addPlateBoundary(lines, 'PLATE_BOUNDARY', plateWidth, plateHeight);
  }

  parsed.segments.forEach((segment) => {
    const layer = segment.type === 'G0' ? 'G0_RAPID' : segment.type === 'G1' ? 'G1_LINEAR' : segment.type === 'G2' ? 'G2_ARC_CW' : 'G3_ARC_CCW';
    const x1 = segment.from.x * scaleX + offsetX;
    const y1 = segment.from.y * scaleY + offsetY;
    const x2 = segment.to.x * scaleX + offsetX;
    const y2 = segment.to.y * scaleY + offsetY;
    dxfPair(lines, 0, 'LINE');
    dxfPair(lines, 8, layer);
    dxfPair(lines, 10, x1.toFixed(4));
    dxfPair(lines, 20, y1.toFixed(4));
    dxfPair(lines, 30, 0);
    dxfPair(lines, 11, x2.toFixed(4));
    dxfPair(lines, 21, y2.toFixed(4));
    dxfPair(lines, 31, 0);
  });

  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}
