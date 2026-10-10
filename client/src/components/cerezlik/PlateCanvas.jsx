import { useEffect, useRef } from 'react';
import { transform, bbox } from '../../lib/cerezlik/geom.js';
import { cssVar, drawPart, drawPaths, fitView, setupCanvas } from './draw.js';

/** The plate with its placed parts (numbered) and, optionally, the toolpaths. */
export default function PlateCanvas({ plate, placements, parts, preview, edge }) {
  const ref = useRef(null);
  const W = Number(plate.width) || 1, H = Number(plate.height) || 1;
  const cw = 1000, ch = Math.round((cw * H) / W);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = setupCanvas(canvas, cw, ch);
    ctx.clearRect(0, 0, cw, ch);
    const view = fitView({ minX: 0, minY: 0, w: W, h: H }, cw, ch, 6);
    const [x0, y0] = view.map([0, H]);
    ctx.fillStyle = cssVar('--panel2', '#1e222c');
    ctx.fillRect(x0, y0, W * view.s, H * view.s);
    ctx.strokeStyle = cssVar('--border', '#2a2f3a');
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, W * view.s, H * view.s);
    if (edge > 0) {
      const [ex, ey] = view.map([edge, H - edge]);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = cssVar('--muted', '#9aa2b1');
      ctx.strokeRect(ex, ey, (W - 2 * edge) * view.s, (H - 2 * edge) * view.s);
      ctx.setLineDash([]);
    }
    const byId = new Map(parts.map((p) => [p.id, p]));
    const bg = cssVar('--panel2', '#1e222c');
    // each part is drawn in its own coordinates through "placement, then view",
    // so shaded 3D surfaces turn and move exactly like the outline
    const placed = placements.map((pc) => ({ part: byId.get(pc.id), pc })).filter((x) => x.part);
    for (const { part, pc } of placed) {
      const map = (pt) => view.map(transform([pt], pc.angle, pc.dx, pc.dy)[0]);
      drawPart(ctx, part, map, { bg, toolLine: 0.8 });
    }
    if (preview) drawPaths(ctx, preview, view.map, 0.6);
    // numbers: order of the parts on this plate
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    placed.forEach(({ part, pc }, i) => {
      const b = bbox([transform(part.outline, pc.angle, pc.dx, pc.dy)]);
      const [cx, cy] = view.map([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i + 1), cx, cy + 0.5);
    });
  }, [plate, placements, parts, preview, edge, W, H, ch]);

  return <canvas ref={ref} className="cz-plate-canvas" />;
}
