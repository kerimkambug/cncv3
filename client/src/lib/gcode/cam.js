// cam.js
// Glass-door "göz" (light/pane) grid: computes the nominal opening
// rectangles for a 2-column-by-N-row grid, and generates the "kesim"
// (through-cut) gcode for them. Validated against real production files —
// see camTarama.js for the routing ("tarama") pass.
import { fmt3 } from './common.js';

/**
 * @param {object} cfg - { width, height, gozSayisi, kolonSayisi, disMargin, icerGap }
 * @returns {{openings: Array<{x1,y1,x2,y2}>, cols:number, rows:number}}
 */
export function camComputeOpenings(cfg) {
  const cols = Number(cfg.kolonSayisi);
  const goz = Number(cfg.gozSayisi);
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(goz) || goz <= 0) {
    throw new Error('Göz sayısı ve sütun sayısı pozitif tam sayı olmalıdır.');
  }
  if (goz % cols !== 0) {
    throw new Error(`Göz sayısı (${goz}) sütun sayısına (${cols}) tam bölünmüyor.`);
  }
  const rows = goz / cols;
  const innerW = cfg.width - 2 * cfg.disMargin - (cols - 1) * cfg.icerGap;
  const innerH = cfg.height - 2 * cfg.disMargin - (rows - 1) * cfg.icerGap;
  if (innerW <= 0 || innerH <= 0) {
    throw new Error('Bu ölçü + margin + boşluk kombinasyonuyla göz için yer kalmıyor.');
  }
  const cellW = innerW / cols;
  const cellH = innerH / rows;

  const openings = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x1 = cfg.disMargin + c * (cellW + cfg.icerGap);
      const y1 = cfg.disMargin + r * (cellH + cfg.icerGap);
      openings.push({ x1, y1, x2: x1 + cellW, y2: y1 + cellH });
    }
  }
  return { openings, cols, rows };
}

export function buildCamKesimGcode(cfg) {
  const toolDia = Number(cfg.toolDia) || 0;
  const toolR = toolDia / 2;
  const plungeFeed = Number(cfg.plungeFeed) || 0;
  const cutFeed = Number(cfg.cutFeed) || 0;
  const { openings } = camComputeOpenings(cfg);

  for (const o of openings) {
    const w = o.x2 - o.x1;
    const h = o.y2 - o.y1;
    if (toolDia >= w || toolDia >= h) {
      throw new Error(`Takım çapı (${toolDia}mm) göz ölçülerinden (${w.toFixed(1)}x${h.toFixed(1)}mm) büyük veya eşit olamaz.`);
    }
  }

  const lines = ['makro'];
  lines.push(`M6T${cfg.kesimToolNo}`);
  lines.push(`M3 S${cfg.spindleSpeed}`);
  openings.forEach((o, i) => {
    // toolpath is inset from the nominal opening by toolR on every side
    // (standard internal-pocket cutter compensation).
    const x1 = o.x1 + toolR, y1 = o.y1 + toolR;
    const x2 = o.x2 - toolR, y2 = o.y2 - toolR;
    if (i === 0) {
      lines.push(`G0 X${fmt3(x1)} Y${fmt3(y1)} Z${fmt3(cfg.safeZ)}`);
    } else {
      lines.push(`G0 X${fmt3(x1)} Y${fmt3(y1)} `);
    }
    lines.push(`G1   Z0.00 F${plungeFeed.toFixed(1)}`);
    lines.push(`G1 X${fmt3(x2)}   F${cutFeed.toFixed(1)}`);
    lines.push(` Y${fmt3(y2)} `);
    lines.push(`X${fmt3(x1)}  `);
    lines.push(` Y${fmt3(y1)} `);
    lines.push(`G0   Z${fmt3(cfg.safeZ)}`);
  });
  lines.push(`G0 X0.00 Y0.00 Z${fmt3(cfg.homeZ)}`);
  lines.push('M5');
  lines.push('M16');
  lines.push('M30');
  return lines.join('\n');
}
