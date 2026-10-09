import { useEffect, useRef } from 'react';
import { parseGcode } from '../../lib/gcode/gcodeToDxf.js';

/** Same tool = same colour (matches the nesting preview). */
function toolColor(toolNo) {
  const n = Number.parseInt(toolNo, 10) || 0;
  return `hsl(${(n * 53 + 190) % 360} 85% 62%)`;
}

/**
 * Draws what a program will cut: the door outlines and every cutting move of
 * the real G-code, coloured by tool — the operator's check before downloading.
 * @param {{gcode:string, doors:Array<{x:number,y:number,w:number,h:number}>}} props
 */
export default function PartPreview({ gcode, doors }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = Math.max(1, ...doors.map((d) => d.x + d.w));
    const H = Math.max(1, ...doors.map((d) => d.y + d.h));
    const dpr = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
    const box = canvas.parentElement.getBoundingClientRect();
    const maxW = Math.max(200, box.width - 2);
    const maxH = 460;
    const s = Math.min(maxW / W, maxH / H);
    canvas.style.width = `${Math.round(W * s)}px`;
    canvas.style.height = `${Math.round(H * s)}px`;
    canvas.width = Math.round(W * s * dpr);
    canvas.height = Math.round(H * s * dpr);
    const k = s * dpr;
    const cy = (v) => (H - v) * k; // machine Y grows up
    const styles = getComputedStyle(document.documentElement);
    ctx.fillStyle = styles.getPropertyValue('--panel2').trim() || '#1d212b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = styles.getPropertyValue('--muted').trim() || '#888';
    ctx.lineWidth = 1.5 * dpr;
    doors.forEach((d) => ctx.strokeRect(d.x * k, cy(d.y + d.h), d.w * k, d.h * k));
    if (!gcode) return;
    ctx.lineWidth = 1.2 * dpr;
    parseGcode(gcode).segments.forEach((sg) => {
      if (sg.type === 'G0') return;
      ctx.strokeStyle = toolColor(sg.tool);
      ctx.beginPath();
      ctx.moveTo(sg.from.x * k, cy(sg.from.y));
      ctx.lineTo(sg.to.x * k, cy(sg.to.y));
      ctx.stroke();
    });
  }, [gcode, doors]);

  const tools = [...new Set(gcode ? (gcode.match(/M6T\d+/g) || []).map((t) => t.slice(3)) : [])];
  return (
    <div className="part-preview">
      <canvas ref={ref} />
      {tools.length > 0 && (
        <div className="part-preview-legend">
          {tools.map((t) => (
            <span key={t} className="legend-chip"><span className="legend-dot" style={{ background: toolColor(t) }} />T{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
