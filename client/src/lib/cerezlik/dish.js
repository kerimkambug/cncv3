// "Kase" compartments for ANY part (catalog model or DXF drawing): every flat
// pocket becomes a dished bowl made to fit the finishing ball nose.
//
//   floor   — flat, at the pocket depth: cut exactly by the end mill (T10)
//   wall    — joins the floor with a radius equal to the ball radius, and the
//             bowl's corners are rounded at least to that radius, so ONE ring
//             of the ball (T7) at the foot of the wall reproduces the whole
//             curve, corners included
//
// The part keeps everything else (through holes, grooves, lines, text).
import { area, bbox, roundShape } from './geom.js';
import { makeGrid, maskPolys, wallDistance } from './surface.js';

/** Depth of a dished floor at distance d (mm) from the wall: quarter-round of radius rf into a flat floor. */
export const dishDepth = (D, rf, d) => (d >= rf ? D : Math.max(0, D - (rf - Math.sqrt(Math.max(0, rf * rf - (rf - d) ** 2)))));

/**
 * @param {object} part   a part with flat pockets (comps of kind 'cep')
 * @param {{depth:number, ballR:number, fillet?:number, cell?:number}} o
 *        depth: pocket depth unless a compartment carries its own
 * @returns {object} the same part as a 3D part (surface + 'cep3d' comps)
 */
export function dishPart(part, { depth, ballR, fillet = ballR, cell = 0.4 }) {
  const rf = Math.max(fillet, 0.5);
  const corner = Math.max(rf, ballR);
  const ob = bbox([part.outline]);
  const margin = 2;
  const g = makeGrid(ob.minX - margin, ob.minY - margin, Math.ceil((ob.w + 2 * margin) / cell), Math.ceil((ob.h + 2 * margin) / cell), cell, 0);
  const bowlMask = new Uint8Array(g.w * g.h);
  const comps = [];
  const warnings = [];
  let maxDepth = 0;
  for (const c of part.comps) {
    if (c.kind !== 'cep') { comps.push(c); continue; }
    const D = Number(c.depth ?? depth) || 0;
    // corners at least as round as the ball, so it fits them exactly
    const shapes = roundShape(c.pts, c.islands || [], corner).filter((sh) => area(sh.outer) > 400);
    if (!shapes.length) { warnings.push(`Bir bölme ${2 * ballR} mm topa göre çok dar; kase yapılamadı, atlandı.`); continue; }
    for (const sh of shapes) {
      const loops = [sh.outer, ...sh.holes];
      const m = maskPolys(g, loops);
      const wd = wallDistance(g, m, loops, rf + 2);
      for (let k = 0; k < m.length; k++) if (m[k]) { bowlMask[k] = 1; g.z[k] = Math.max(g.z[k], dishDepth(D, rf, wd[k])); }
      comps.push({ pts: sh.outer, islands: sh.holes, kind: 'cep3d', roundable: rf < D - 1, depth: D });
      maxDepth = Math.max(maxDepth, D);
    }
  }
  return {
    ...part,
    comps,
    surface: { grid: g, bowlMask, recessMask: new Uint8Array(g.w * g.h), maxDepth },
    dished: true,
    warnings: [...(part.warnings || []), ...warnings],
  };
}
