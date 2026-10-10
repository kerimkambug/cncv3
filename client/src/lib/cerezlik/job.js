// Glue between parts, the nesting search and the plate programs.
import { offset } from './geom.js';
import { nest } from './nest.js';
import { partToolpaths, toolReach } from './toolpaths.js';
import { buildPlateProgram } from './gcode.js';

export const DEFAULT_PLATE = { width: 2100, height: 2800, margin: 10, extraGap: 2, angleStep: 45, cell: 2, seconds: 4 };

export function anglesFor(step) {
  const s = Math.max(1, Number(step) || 90);
  const out = [];
  for (let a = 0; a < 360 - 1e-6; a += s) out.push(+a.toFixed(4));
  return out;
}

/**
 * Spacing rules. `gap` = minimum distance between two part outlines: the
 * farthest any tool reaches outside an outline (T3 rounding gap + its radius,
 * or the cutter radius) plus the extra safety gap.
 */
export function spacing(recipe, plate) {
  const reach = toolReach(recipe);
  const gap = reach + (Number(plate.extraGap) || 0);
  return { reach, gap, edge: (Number(plate.margin) || 0) + reach };
}

/** Grid size: the user's choice, coarsened only if the plate would exceed ~2.5M cells. */
export function cellSize(plate) {
  const want = Math.max(0.5, Number(plate.cell) || 2);
  return Math.max(want, Math.sqrt((plate.width * plate.height) / 2.5e6));
}

/** Input for nest(): keep-out polygons per part (outline grown by gap/2 + raster margin). */
export function nestInput(parts, recipe, plate) {
  const { gap, edge } = spacing(recipe, plate);
  const cell = cellSize(plate);
  const grow = gap / 2 + cell * 0.7072;
  return {
    plateW: Number(plate.width),
    plateH: Number(plate.height),
    inset: Math.max(0, edge - gap / 2),
    cell,
    angles: anglesFor(plate.angleStep),
    timeLimit: Math.max(0.2, Number(plate.seconds) || 4) * 1000,
    items: parts.filter((p) => p.qty > 0).map((p) => ({ id: p.id, qty: p.qty, area: p.area, polys: offset([p.outline], grow) })),
  };
}

export function runNest(parts, recipe, plate, onProgress) {
  return nest({ ...nestInput(parts, recipe, plate), onProgress });
}

/** Toolpaths per part id (computed once, reused on every plate). */
export function toolpathLibrary(parts, recipe) {
  return new Map(parts.map((p) => [p.id, { ops: partToolpaths(p, recipe), area: p.area }]));
}

export function platePrograms(result, parts, recipe, kinds = null) {
  const lib = toolpathLibrary(parts, recipe);
  return result.plates.map((pl) => buildPlateProgram(pl, lib, recipe, kinds));
}
