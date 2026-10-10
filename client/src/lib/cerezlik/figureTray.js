// "Figürlü tepsi": a 3D figure in the middle of a tray, compartments around it.
//
//   outline (oval / round / rounded rectangle)
//   └ rim ─ compartments (dished: flat floor joined to the wall by a radius)
//           separated by radial walls, and kept a wall away from …
//   └ figure recess: the figure silhouette + a small pad, floor at the figure's
//     base; the figure itself rises from that floor up to `figTop` below the
//     material surface.
//
// The result is a part whose `surface` holds DEPTH below the material top for
// every cell (0 = untouched), so it follows any material thickness chosen later.
import { area, bbox, difference, offset, roundShape, union } from './geom.js';
import { circlePts, roundRect } from './catalog.js';
import { makeGrid, maskPolys, maskToShapes, wallDistance } from './surface.js';
import { rotateFigure, sampleFigure } from './figure.js';
import { dishDepth } from './dish.js';

export const FIGURE_TRAY_DEFAULTS = {
  shape: 'oval', W: 420, H: 320, r: 40,
  figW: 170, figX: 0, figY: 0, rot: 0,
  figH: 10, figTop: 0, pad: 7,
  rim: 14, wall: 9, n: 6, a0: 90,
  depth: 12, fillet: 15, cell: 0.4,
  ballR: 15, // radius of the ball nose that finishes the compartments (T7 Ø30)
  reliefDia: 6, // the relief bit: the moat around the figure must be wider than it
};

function band(p, q, w) {
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * (w / 2), ny = (dx / L) * (w / 2);
  return [[p[0] + nx, p[1] + ny], [p[0] - nx, p[1] - ny], [q[0] - nx, q[1] - ny], [q[0] + nx, q[1] + ny]];
}

function outlineFor(p) {
  if (p.shape === 'yuvarlak') return circlePts(p.W / 2, p.W / 2, p.W / 2);
  if (p.shape === 'dikdortgen') return roundRect(0, 0, p.W, p.H, p.r);
  // ellipse
  const n = 360;
  return Array.from({ length: n }, (_, k) => { const a = (2 * Math.PI * k) / n; return [p.W / 2 + (p.W / 2) * Math.cos(a), p.H / 2 + (p.H / 2) * Math.sin(a)]; });
}


/**
 * @param {object} figure  from figure.js
 * @param {object} params  see FIGURE_TRAY_DEFAULTS
 * @param {number} thickness  material thickness (for the checks)
 */
export function figureTrayPart(figure, params, thickness = 18, name = 'Figürlü tepsi') {
  const p = { ...FIGURE_TRAY_DEFAULTS, ...params };
  // the moat around the figure is finished by the relief bit: it has to fit in it
  const minPad = (Number(p.reliefDia) || 6) + 1;
  const padRaised = p.pad < minPad;
  if (padRaised) p.pad = minPad;
  const warnings = [];
  const fig = rotateFigure(figure, Math.round((p.rot || 0) / 90));
  const outline = outlineFor(p);
  const ob = bbox([outline]);
  const cell = Math.max(0.15, p.cell);
  const margin = 2;
  const g = makeGrid(-margin, -margin, Math.ceil((ob.w + 2 * margin) / cell), Math.ceil((ob.h + 2 * margin) / cell), cell, 0);
  const inOutline = maskPolys(g, [outline]);

  // figure placement
  const fw = p.figW, fh = (p.figW * fig.h) / fig.w;
  const fx0 = ob.w / 2 + p.figX - fw / 2, fy0 = ob.h / 2 + p.figY - fh / 2;
  const figVal = new Float32Array(g.w * g.h), figMask = new Uint8Array(g.w * g.h);
  for (let j = 0; j < g.h; j++) {
    const y = g.y0 + (j + 0.5) * cell;
    const v = (y - fy0) / fh;
    if (v < 0 || v > 1) continue;
    for (let i = 0; i < g.w; i++) {
      const x = g.x0 + (i + 0.5) * cell;
      const u = (x - fx0) / fw;
      if (u < 0 || u > 1) continue;
      const s = sampleFigure(fig, u, v);
      if (s.m && inOutline[j * g.w + i]) { figVal[j * g.w + i] = s.val; figMask[j * g.w + i] = 1; }
    }
  }

  // regions
  const sil = maskToShapes(g, figMask).map((s) => s.outer).filter((l) => area(l) > 25);
  const recess = sil.length ? union(offset(sil, p.pad, { keepOrientation: true }).filter((l) => area(l) > 25)).map((s) => s.outer) : [];
  const recessSmooth = recess.flatMap((l) => roundShape(l, [], 2).map((s) => s.outer));
  const figWall = recessSmooth.length ? offset(recessSmooth, p.wall, { keepOrientation: true }) : [];
  const inner = offset([outline], -p.rim);
  const fcx = fx0 + fw / 2, fcy = fy0 + fh / 2;
  const R = Math.hypot(ob.w, ob.h);
  const spokes = p.n > 1 ? Array.from({ length: p.n }, (_, k) => {
    const a = ((p.a0 + (360 * k) / p.n) * Math.PI) / 180;
    return band([fcx, fcy], [fcx + R * Math.cos(a), fcy + R * Math.sin(a)], p.wall);
  }) : [];
  const bowlShapes = [];
  for (const pc of difference(inner, [...figWall, ...spokes])) {
    // corners at least as round as the finishing ball, so it fits them exactly
    for (const sh of roundShape(pc.outer, pc.holes, Math.max(p.fillet, p.ballR))) if (area(sh.outer) > 600) bowlShapes.push(sh);
  }

  // depth field
  const depth = g.z;
  const D = p.depth;
  const recessDepth = p.figTop + p.figH;
  if (D > thickness - 3) warnings.push(`Bölme derinliği (${D} mm) malzemeye göre fazla; tabanda ${Math.max(0, thickness - D).toFixed(1)} mm kalıyor.`);
  if (recessDepth > thickness - 3) warnings.push(`Figür zemini ${recessDepth} mm derinde; malzemeye göre fazla.`);
  const bowlMask = new Uint8Array(g.w * g.h);
  for (const sh of bowlShapes) {
    const m = maskPolys(g, [sh.outer, ...sh.holes]);
    const wd = wallDistance(g, m, [sh.outer, ...sh.holes], p.fillet + 2);
    for (let k = 0; k < m.length; k++) if (m[k]) { bowlMask[k] = 1; depth[k] = Math.max(depth[k], dishDepth(D, p.fillet, wd[k])); }
  }
  const recessMask = recessSmooth.length ? maskPolys(g, recessSmooth) : new Uint8Array(g.w * g.h);
  if (recessSmooth.length) {
    const wd = wallDistance(g, recessMask, recessSmooth, Math.min(4, p.pad + 1) + 2);
    for (let k = 0; k < recessMask.length; k++) {
      if (!recessMask[k]) continue;
      let d = dishDepth(recessDepth, Math.min(4, p.pad + 1), wd[k]);
      if (figMask[k]) d = Math.min(d, p.figTop + p.figH * (1 - figVal[k]));
      depth[k] = Math.max(depth[k], d);
    }
  }
  if (padRaised) warnings.push(`Figür çevresi payı ${minPad} mm'ye çıkarıldı: rölyef bıçağı (Ø${p.reliefDia}) daha dar boşluğun dibine giremez.`);
  if (!sil.length) warnings.push('Figür tepsiye yerleşmedi; ölçü ve konumu kontrol edin.');
  if (p.fillet < p.ballR - 0.01) warnings.push(`Taban radüsü (${p.fillet} mm) bitirme topunun yarıçapından (${p.ballR} mm) küçük: top kavise tam oturmaz, dip kavisi küçük bıçakla ayrıca temizlenir. En temiz ve en hızlı sonuç için ${p.ballR} mm girin.`);

  const comps = [
    ...bowlShapes.map((sh) => ({ pts: sh.outer, islands: sh.holes, kind: 'cep3d', roundable: p.fillet < D - 1 })),
    ...recessSmooth.map((l) => ({ pts: l, islands: [], kind: 'cep3d', roundable: true, figure: true })),
  ];
  return {
    name: `${name} ${Math.round(ob.w)}×${Math.round(ob.h)}`,
    outline,
    comps,
    lines: [],
    grooves: [],
    width: ob.w,
    height: ob.h,
    area: area(outline),
    surface: { grid: g, bowlMask, recessMask, maxDepth: Math.max(D, recessDepth) },
    warnings,
    figureParams: p,
  };
}
