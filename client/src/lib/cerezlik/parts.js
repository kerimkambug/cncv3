// Turns the loops of a drawing into parts. Nesting depth decides what a loop is:
//   depth 0  → part outline (cut out from outside)
//   depth 1  → a compartment of that part (pocket) — or a through hole
//   depth 2  → an island left standing inside a compartment
// Open chains lying on a part become engraving lines (V bit on the line).
import { area, bbox, cleanLoop, ensureCCW, offset, pointInPolygon, polygonInside, polylineDistance } from './geom.js';

const HOLE_LAYER = /del[iı]k|hole|through|bo[sş]luk|kesim|cut/i;

/**
 * @param {{loops:Array<{layer:string, pts:number[][]}>, chains:Array<{layer:string, pts:number[][]}>}} drawing
 * @param {string} baseName  used to name the parts
 */
export function buildParts(drawing, baseName = 'parça') {
  const warnings = [];
  // drop degenerate and duplicated loops (the same outline drawn twice is common)
  const loops = [];
  for (const l of drawing.loops) {
    const pts = cleanLoop(l.pts);
    if (pts.length < 3 || area(pts) < 1) continue;
    const a = area(pts), b = bbox([pts]);
    const dup = loops.find((o) => Math.abs(o.area - a) < Math.max(0.5, a * 0.001)
      && Math.abs(o.box.minX - b.minX) < 0.2 && Math.abs(o.box.minY - b.minY) < 0.2
      && Math.abs(o.box.maxX - b.maxX) < 0.2 && Math.abs(o.box.maxY - b.maxY) < 0.2);
    if (dup) { warnings.push('Üst üste çizilmiş aynı hatlar teke indirildi.'); continue; }
    loops.push({ layer: l.layer, pts: ensureCCW(pts), area: a, box: b, parent: null, depth: 0 });
  }
  // parent = the smallest loop that contains this one
  const bySize = loops.slice().sort((a, b) => a.area - b.area);
  for (const l of bySize) {
    for (const o of bySize) {
      if (o === l || o.area <= l.area) continue;
      if (o.box.minX > l.box.minX || o.box.minY > l.box.minY || o.box.maxX < l.box.maxX || o.box.maxY < l.box.maxY) continue;
      if (polygonInside(l.pts, o.pts)) { l.parent = o; break; }
    }
  }
  for (const l of loops) { let d = 0, p = l.parent; while (p) { d++; p = p.parent; } l.depth = d; }
  if (loops.some((l) => l.depth > 2)) warnings.push('İç içe 3 kattan derin hatlar atlandı.');

  const outers = loops.filter((l) => l.depth === 0).sort((a, b) => b.area - a.area);
  const parts = outers.map((o, i) => {
    const cavities = loops.filter((l) => l.depth === 1 && l.parent === o);
    const comps = cavities.map((c) => ({
      pts: c.pts,
      kind: HOLE_LAYER.test(c.layer) ? 'delik' : 'cep',
      islands: loops.filter((l) => l.depth === 2 && l.parent === c).map((l) => l.pts),
    }));
    const lines = drawing.chains.filter((ch) => ch.pts.every((p) => pointInPolygon(p, o.pts))).map((ch) => ch.pts);
    const b = o.box;
    const shift = (pts) => pts.map(([x, y]) => [x - b.minX, y - b.minY]);
    return {
      name: outers.length > 1 ? `${baseName}-${i + 1}` : baseName,
      outline: shift(o.pts),
      comps: comps.map((c) => ({ ...c, pts: shift(c.pts), islands: c.islands.map(shift) })),
      lines: lines.map(shift),
      width: b.w,
      height: b.h,
      area: o.area - cavities.filter((c) => HOLE_LAYER.test(c.layer)).reduce((s, c) => s + c.area, 0),
    };
  });
  if (parts.reduce((s, p) => s + p.lines.length, 0) < drawing.chains.length) {
    warnings.push('Hiçbir parçanın üzerinde olmayan açık çizgiler atlandı.');
  }
  return { parts, warnings: [...new Set(warnings)] };
}

/**
 * Production checks for one part against the recipe: walls too thin between
 * compartments / the edge, and compartments too small for the pocket bit.
 */
export function checkPart(part, recipe) {
  const out = [];
  const minWall = Number(recipe.minWall) || 0;
  const cavities = part.comps.map((c) => c.pts);
  if (minWall > 0) {
    let thinEdge = false, thinBetween = false;
    for (let i = 0; i < cavities.length; i++) {
      if (!thinEdge && polylineDistance(cavities[i], part.outline) < minWall) thinEdge = true;
      for (let j = i + 1; j < cavities.length && !thinBetween; j++) {
        if (polylineDistance(cavities[i], cavities[j]) < minWall) thinBetween = true;
      }
    }
    if (thinEdge) out.push(`Kenar duvarı ${minWall} mm'den ince.`);
    if (thinBetween) out.push(`Bölmeler arası duvar ${minWall} mm'den ince.`);
  }
  const r = (Number(recipe.pocket.dia) || 6) / 2;
  const small = part.comps.filter((c) => c.kind === 'cep' && !offset([c.pts, ...c.islands], -r).length).length;
  if (small) out.push(`${small} bölme tarama bıçağına (Ø${2 * r}) göre çok küçük, taranamaz.`);
  return out;
}
