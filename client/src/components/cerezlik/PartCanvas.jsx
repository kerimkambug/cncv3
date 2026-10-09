import { useEffect, useMemo, useRef } from 'react';
import { bbox, pointInPolygon, area } from '../../lib/cerezlik/geom.js';
import { partToolpaths } from '../../lib/cerezlik/toolpaths.js';
import { cssVar, drawPart, drawPaths, fitView, setupCanvas } from './draw.js';

/**
 * One part. Thumbnail when only `size` is given; with `recipe` it also shows
 * the part's toolpaths, and with `onToggleComp` a click on a bowl toggles it
 * between pocket and through hole.
 */
export default function PartCanvas({ part, size, recipe, onToggleComp }) {
  const ref = useRef(null);
  const viewRef = useRef(null);
  const ops = useMemo(() => (recipe ? partToolpaths(part, recipe) : null), [part, recipe]);

  const box = bbox([part.outline]);
  const thumb = !recipe;
  const w = size;
  const h = thumb ? size : Math.min(size, Math.max(160, (size * box.h) / (box.w || 1)));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = setupCanvas(canvas, w, h);
    ctx.clearRect(0, 0, w, h);
    const pad = thumb ? 4 : 30;
    const view = fitView(box, w, h, pad);
    viewRef.current = view;
    drawPart(ctx, part, view.map, { bg: cssVar('--panel', '#171a21'), toolLine: thumb ? 0.6 : 1 });
    if (ops) drawPaths(ctx, ops.flatMap((op) => op.passes.map((pts) => ({ kind: op.kind, pts }))), view.map, 0.7);
  }, [part, ops, w, h, thumb]);

  function onClick(e) {
    if (!onToggleComp || !viewRef.current) return;
    const r = ref.current.getBoundingClientRect();
    const [x, y] = viewRef.current.unmap(((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h);
    let hit = -1, best = Infinity;
    part.comps.forEach((c, i) => { if (pointInPolygon([x, y], c.pts) && area(c.pts) < best) { best = area(c.pts); hit = i; } });
    if (hit >= 0) onToggleComp(hit);
  }

  return (
    <canvas
      ref={ref}
      className={thumb ? 'cz-thumb-canvas' : 'cz-part-canvas'}
      style={{ width: thumb ? size : '100%', cursor: onToggleComp ? 'pointer' : 'default' }}
      onClick={onClick}
    />
  );
}
