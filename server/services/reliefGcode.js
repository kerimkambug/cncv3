// reliefGcode.js
// Empire CNC — Server-side Relief G-Code Processing Service
import { emitRectCutPath } from '../../shared/gcode/common.js';

function fmt(n) {
  return Number(n).toFixed(2);
}

function fmt3(n) {
  return Number(n).toFixed(3);
}

export function generateReliefGcodeFromGrid(depthGrid, cfg) {
  const options = normalizeConfig(cfg);
  const { width, height, thickness, maxDepth, stepover, plungeFeed, cutFeed, safeZ, homeZ, toolNo, spindleSpeed, direction, bgMode } = options;

  const lines = ['makro'];
  lines.push(`(========================================)`);
  lines.push(`( EMPIRE CNC - 3D RELIEF G-CODE )`);
  lines.push(`( Boyutlar: ${width}x${height} mm | Kalinlik: ${thickness} mm )`);
  lines.push(`( Maks Derinlik: ${maxDepth} mm | Adim: ${stepover} mm )`);
  lines.push(`( Arka Plan Modu: ${bgMode} | Yon: ${direction.toUpperCase()} )`);
  lines.push(`(========================================)`);

  lines.push(`G0 Z${fmt(safeZ)}`);
  lines.push(`M6T${toolNo}`);
  lines.push(`M3 S${spindleSpeed}`);
  lines.push(`G0 X0.00 Y0.00 Z${fmt(safeZ)}`);

  appendRasterToolpath(lines, depthGrid, options);
  lines.push(`G0 Z${fmt(safeZ)}`);

  appendOuterCut(lines, options);

  finalizeProgram(lines, homeZ);
  return lines.join('\n');
}

function normalizeConfig(cfg = {}) {
  // Present-but-invalid values are an error, not a silent default: a typo'd
  // feed or depth otherwise produces a program that cuts wrong with no signal.
  // Missing fields still fall back to their defaults.
  const invalidFields = [];
  const numField = (name, def) => {
    if (cfg[name] === undefined || cfg[name] === null || cfg[name] === '') return def;
    const v = Number(cfg[name]);
    if (!Number.isFinite(v)) { invalidFields.push(name); return def; }
    return v;
  };

  const width = Math.max(1, numField('width', 200));
  const height = Math.max(1, numField('height', 200));
  const thickness = numField('thickness', 18);
  const maxDepth = numField('maxDepth', 5);
  const stepover = Math.max(0.1, numField('stepover', 0.8));
  const plungeFeed = numField('plungeFeed', 1500);
  const cutFeed = numField('cutFeed', 4500);
  const safeZ = numField('safeZ', 25);
  const homeZ = numField('homeZ', 60);
  const spindleSpeed = numField('spindleSpeed', 18000);
  const outerCutDia = numField('outerCutDia', 6);

  if (cfg.direction !== undefined && cfg.direction !== 'x' && cfg.direction !== 'y') invalidFields.push('direction');
  if (invalidFields.length > 0) {
    throw new TypeError(
      `Invalid relief config: non-numeric or out-of-range fields: ${invalidFields.join(', ')}`,
    );
  }

  return {
    width,
    height,
    thickness,
    maxDepth,
    stepover,
    plungeFeed,
    cutFeed,
    safeZ,
    homeZ,
    toolNo: cfg.toolNo || '1',
    spindleSpeed,
    direction: cfg.direction === 'y' ? 'y' : 'x',
    bgMode: cfg.backgroundMode || 'flat',
    enableOuterCut: cfg.enableOuterCut,
    outerCutToolNo: cfg.outerCutToolNo || '6',
    outerCutDia,
  };
}

function appendRasterToolpath(lines, depthGrid, options) {
  if (!Array.isArray(depthGrid) || depthGrid.length === 0) {
    throw new TypeError('depthGrid must be a non-empty rectangular grid.');
  }

  const numRows = depthGrid.length;
  const numCols = depthGrid[0]?.length || 0;
  if (numCols === 0 || depthGrid.some((row) => (
    !row || row.length !== numCols || Array.from(row).some((value) => !Number.isFinite(value))
 ))) {
    throw new TypeError('depthGrid must contain equally sized rows with finite numeric values.');
  }

  // direction === 'y' sweeps the tool along the Y axis (grid rows) and advances
  // the raster stepover across X (grid columns); the default sweeps along X.
  const alongY = options.direction === 'y';
  const outerCount = alongY ? numCols : numRows;
  const innerCount = alongY ? numRows : numCols;

  let isToolDown = false;
  for (let a = 0; a < outerCount; a++) {
    const isReverse = a % 2 === 1;
    for (let b = 0; b < innerCount; b++) {
      const idx = isReverse ? innerCount - 1 - b : b;
      const rowIdx = alongY ? idx : a;
      const colIdx = alongY ? a : idx;
      const x = (colIdx / Math.max(1, numCols - 1)) * options.width;
      const y = (rowIdx / Math.max(1, numRows - 1)) * options.height;
      const depthRatio = Math.max(0, Math.min(1, depthGrid[rowIdx][colIdx]));
      const z = +(options.thickness - depthRatio * options.maxDepth).toFixed(3);
      if (!isToolDown) {
        lines.push(`G0 X${fmt(x)} Y${fmt(y)} Z${fmt(options.safeZ)}`);
        lines.push(`G1 Z${fmt3(z)} F${options.plungeFeed.toFixed(1)}`);
        isToolDown = true;
      } else {
        lines.push(`G1 X${fmt(x)} Y${fmt(y)} Z${fmt3(z)} F${options.cutFeed.toFixed(1)}`);
      }
    }
  }
}

function appendOuterCut(lines, options) {
  if (!options.enableOuterCut) return;
  const cutRadius = options.outerCutDia / 2;
  lines.push(`G0 Z${fmt(options.safeZ + 30)}`);
  lines.push(`M5`);
  lines.push(`M6T${options.outerCutToolNo}`);
  lines.push(`M3 S${options.spindleSpeed}`);
  emitRectCutPath(
    lines,
    0,
    0,
    options.width,
    options.height,
    cutRadius,
    0,
    options.cutFeed,
    options.plungeFeed,
    options.safeZ
  );
}

function finalizeProgram(lines, homeZ) {
  lines.push(`G0 X0.00 Y0.00 Z${fmt(homeZ)}`);
  lines.push(`G0 Z${fmt(homeZ)}`);
  lines.push(`X0.00 Y0.00`);
  lines.push(`M5`);
  lines.push(`M16`);
  lines.push(`M30`);
}
