// G-code for one nested plate, in the workshop machine's dialect (same header,
// tool change and footer as the ArtCAM files in numuneler/): tool by tool,
// pocket → rounding → V lines → through cuts (small parts first).

const KIND_ORDER = ['pocket', 'round', 'vline', 'cut'];
const RAPID = 10000; // mm/min, for the time estimate only
const TOOL_CHANGE_S = 15;

const f3 = (v) => {
  const s = (Math.round(v * 1000) / 1000).toFixed(3);
  return s === '-0.000' ? '0.000' : s;
};

/** Rotates + translates every pass of a part's ops onto the plate. */
export function placeOps(ops, { angle, dx, dy }) {
  const a = (angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ops.map((op) => ({
    ...op,
    passes: op.passes.map((pass) => pass.map(([x, y, z]) => [x * c - y * s + dx, x * s + y * c + dy, z])),
  }));
}

/**
 * @param {{placements:Array<{id:string, angle:number, dx:number, dy:number}>}} plate
 * @param {Map<string, {ops:Array, area:number}>} lib  toolpaths per part id (part coordinates)
 * @param {object} recipe
 */
export function buildPlateProgram(plate, lib, recipe) {
  const top = Number(recipe.thickness);
  const safeZ = top + (Number(recipe.safeAbove) || 28);
  const clearZ = top + (Number(recipe.clearAbove) || 5);
  const placed = plate.placements.map((pl, i) => ({ i, area: lib.get(pl.id).area, ops: placeOps(lib.get(pl.id).ops, pl) }));

  // jobs: one per (kind, part); ordered by kind, then nearest neighbour (cuts: small parts first)
  const jobs = [];
  for (const kind of KIND_ORDER) {
    const list = placed.flatMap((p) => p.ops.filter((op) => op.kind === kind).map((op) => ({ op, area: p.area })));
    if (kind === 'cut') list.sort((a, b) => a.area - b.area);
    else {
      // nearest neighbour on the first point of each job
      const rest = list.slice();
      const ordered = [];
      let at = [0, 0];
      while (rest.length) {
        let bi = 0, bd = Infinity;
        rest.forEach((j, k) => {
          const p = j.op.passes[0][0];
          const d = (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2;
          if (d < bd) { bd = d; bi = k; }
        });
        const [j] = rest.splice(bi, 1);
        const lastPass = j.op.passes[j.op.passes.length - 1];
        at = lastPass[lastPass.length - 1];
        ordered.push(j);
      }
      list.splice(0, list.length, ...ordered);
    }
    jobs.push(...list.map((j) => j.op));
  }

  const out = ['makro'];
  let tool = null, feedNow = null, justChanged = false;
  let pos = [0, 0, safeZ];
  let feedLen = 0, plungeLen = 0, rapidLen = 0, toolChanges = 0;
  const preview = [];
  const feedWord = (f) => { if (f === feedNow) return ''; feedNow = f; return ` F${Number(f).toFixed(1)}`; };

  for (const op of jobs) {
    if (op.tool !== tool) {
      if (tool !== null) { out.push(`G0 Z${f3(safeZ)}`, 'M5'); rapidLen += Math.abs(safeZ - pos[2]); pos = [pos[0], pos[1], safeZ]; }
      out.push(`M6T${op.tool}`, `M3 S${recipe.spindle}`);
      tool = op.tool; feedNow = null; toolChanges++; justChanged = true;
    }
    op.passes.forEach((pass, pi) => {
      const [x0, y0, z0] = pass[0];
      const hopZ = pi === 0 ? safeZ : clearZ;
      // lift, travel, plunge
      if (pos[2] < hopZ) { out.push(`G0 Z${f3(hopZ)}`); rapidLen += hopZ - pos[2]; }
      const zTravel = Math.max(pos[2], hopZ);
      out.push(`G0 X${f3(x0)} Y${f3(y0)}${justChanged ? ` Z${f3(safeZ)}` : ''}`);
      justChanged = false;
      rapidLen += Math.hypot(x0 - pos[0], y0 - pos[1]);
      out.push(`G1 Z${f3(z0)}${feedWord(op.plunge)}`);
      plungeLen += Math.abs(zTravel - z0);
      let [px, py, pz] = [x0, y0, z0];
      let feedSet = false;
      for (let k = 1; k < pass.length; k++) {
        const [x, y, z] = pass[k];
        if (Math.abs(x - px) < 1e-4 && Math.abs(y - py) < 1e-4 && Math.abs(z - pz) < 1e-4) continue;
        let w = 'G1';
        if (Math.abs(x - px) >= 1e-4) w += ` X${f3(x)}`;
        if (Math.abs(y - py) >= 1e-4) w += ` Y${f3(y)}`;
        if (Math.abs(z - pz) >= 1e-4) w += ` Z${f3(z)}`;
        if (!feedSet) { w += feedWord(op.feed); feedSet = true; }
        out.push(w);
        feedLen += Math.hypot(x - px, y - py, z - pz);
        [px, py, pz] = [x, y, z];
      }
      pos = [px, py, pz];
      preview.push({ kind: op.kind, tool: op.tool, pts: pass });
    });
  }
  out.push(`G0 Z${f3(safeZ)}`, 'G0 X0.000 Y0.000', 'M5', 'M16', 'M30');

  // feeds differ per op; use each op's own feed for its length
  const minutes = estimateMinutes(jobs, { rapidLen, toolChanges });
  return { gcode: out.join('\n') + '\n', minutes, preview, stats: { feedLen, plungeLen, rapidLen, toolChanges } };
}

function estimateMinutes(jobs, { rapidLen, toolChanges }) {
  let m = rapidLen / RAPID + (toolChanges * TOOL_CHANGE_S) / 60;
  for (const op of jobs) {
    for (const pass of op.passes) {
      let len = 0;
      for (let k = 1; k < pass.length; k++) len += Math.hypot(pass[k][0] - pass[k - 1][0], pass[k][1] - pass[k - 1][1], pass[k][2] - pass[k - 1][2]);
      m += len / (Number(op.feed) || 3000) + 30 / (Number(op.plunge) || 1500);
    }
  }
  return m;
}
