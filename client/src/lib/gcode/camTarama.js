// camTarama.js
// The routing ("tarama") pass around each glass opening: an offset
// pocket-clearing toolpath computed with Clipper.js (polygon boolean +
// offset), since the region to clear (frame minus the openings) is not a
// simple rectangle once the outer "oturma payı" ledge is applied.
//
// KNOWN LIMITATION: corners come out square here — the rounded/decorative
// junction detail seen in real ArtCAM output (hand-drawn fillets before
// the offset toolpath is computed) is not replicated. Functionally
// equivalent (same depth, same coverage), just not the same aesthetic.
import ClipperLib from 'clipper-lib';
import { fmt3 } from './common.js';
import { camComputeOpenings } from './cam.js';

const CAM_SCALE = 1000; // mm -> integer units for Clipper

function rectToPath(x1, y1, x2, y2) {
  return [
    { X: Math.round(x1 * CAM_SCALE), Y: Math.round(y1 * CAM_SCALE) },
    { X: Math.round(x2 * CAM_SCALE), Y: Math.round(y1 * CAM_SCALE) },
    { X: Math.round(x2 * CAM_SCALE), Y: Math.round(y2 * CAM_SCALE) },
    { X: Math.round(x1 * CAM_SCALE), Y: Math.round(y2 * CAM_SCALE) },
  ];
}

/**
 * Builds the concentric offset rings that make up the tarama toolpath.
 * The ledge (oturma payı) shrinks ONLY the outer boundary; openings
 * between panes use the same nominal edges as the kesim pass (no ledge —
 * see cam.js), matching real production files exactly.
 */
export function camBuildTaramaRings(cfg) {
  const { openings } = camComputeOpenings(cfg);
  const toolR = cfg.toolDia / 2;
  const ledgeMargin = cfg.disMargin - cfg.oturmaPayi;
  if (ledgeMargin <= 0) throw new Error("Oturma payı, dışarıdan margin'den büyük olamaz.");

  const outerPath = rectToPath(ledgeMargin, ledgeMargin, cfg.width - ledgeMargin, cfg.height - ledgeMargin);

  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(outerPath, ClipperLib.PolyType.ptSubject, true);
  openings.forEach((o) => clipper.AddPath(rectToPath(o.x1, o.y1, o.x2, o.y2), ClipperLib.PolyType.ptClip, true));
  const region = new ClipperLib.Paths();
  clipper.Execute(ClipperLib.ClipType.ctDifference, region, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  if (region.length === 0) throw new Error('Taranacak alan bulunamadı.');

  const rings = [];
  let k = 0;
  while (k < 500) {
    const delta = -(toolR + k * cfg.stepover) * CAM_SCALE;
    const co = new ClipperLib.ClipperOffset();
    co.AddPaths(region, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const offsetted = new ClipperLib.Paths();
    co.Execute(offsetted, delta);
    if (!offsetted || offsetted.length === 0) break;
    const cleaned = offsetted.filter((p) => Math.abs(ClipperLib.Clipper.Area(p)) > 0.1 * CAM_SCALE * CAM_SCALE);
    if (cleaned.length === 0) break;
    cleaned.forEach((p) => rings.push(p.map((pt) => ({ x: pt.X / CAM_SCALE, y: pt.Y / CAM_SCALE }))));
    k++;
  }
  return rings;
}

export function buildCamTaramaGcode(cfg) {
  const rings = camBuildTaramaRings(cfg);
  if (rings.length === 0) throw new Error('Hiç toolpath halkası üretilemedi.');

  const z = +(cfg.thickness - cfg.taramaDepth).toFixed(3);
  const lines = ['makro'];
  lines.push(`M6T${cfg.taramaToolNo}`);
  lines.push(`M3 S${cfg.spindleSpeed}`);

  rings.forEach((ring, i) => {
    if (ring.length < 3) return;
    const start = ring[0];
    if (i === 0) {
      lines.push(`G0 X${fmt3(start.x)} Y${fmt3(start.y)} Z${fmt3(cfg.safeZ)}`);
    } else {
      lines.push(`G0 X${fmt3(start.x)} Y${fmt3(start.y)} `);
    }
    lines.push(`G1   Z${fmt3(z)} F${cfg.plungeFeed.toFixed(1)}`);
    for (let j = 1; j < ring.length; j++) {
      lines.push(`G1 X${fmt3(ring[j].x)} Y${fmt3(ring[j].y)}   F${cfg.cutFeed.toFixed(1)}`);
    }
    lines.push(`G1 X${fmt3(start.x)} Y${fmt3(start.y)} `);
    lines.push(`G0   Z${fmt3(cfg.safeZ)}`);
  });

  lines.push(`G0 X0.00 Y0.00 Z${fmt3(cfg.homeZ)}`);
  lines.push(`G0Z${fmt3(cfg.homeZ)}`);
  lines.push('X0.00Y0.00');
  lines.push('M5');
  lines.push('M16');
  lines.push('M30');
  return lines.join('\n');
}
