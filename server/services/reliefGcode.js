// reliefGcode.js
// Empire CNC — Server-side Relief G-Code Processing Service
import { emitRectCutPath } from '../../client/src/lib/gcode/common.js';

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
  return {
    width: Math.max(1, Number(cfg.width) || 200),
    height: Math.max(1, Number(cfg.height) || 200),
    thickness: Number(cfg.thickness) || 18,
    maxDepth: Number(cfg.maxDepth) || 5,
    stepover: Math.max(0.1, Number(cfg.stepover) || 0.8),
    plungeFeed: Number(cfg.plungeFeed) || 1500,
    cutFeed: Number(cfg.cutFeed) || 4500,
    safeZ: Number(cfg.safeZ) || 25,
    homeZ: Number(cfg.homeZ) || 60,
    toolNo: cfg.toolNo || '1',
    spindleSpeed: Number(cfg.spindleSpeed) || 18000,
    direction: cfg.direction === 'y' ? 'y' : 'x',
    bgMode: cfg.backgroundMode || 'flat',
    enableOuterCut: cfg.enableOuterCut,
    outerCutToolNo: cfg.outerCutToolNo || '6',
    outerCutDia: Number(cfg.outerCutDia) || 6,
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
