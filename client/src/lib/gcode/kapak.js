// kapak.js
// Rectangular multi-tool pocket cutting (cabinet doors / "tabla")
import { fmt, computeCumOffsets } from './common.js';
import { computeDerzPositions } from './derz.js';

/**
 * Calculates adaptive toolpath coordinates for a part of given width and height.
 *
 * Rules:
 * 1. Normal offset system is preserved (e.g. 53 -> 16 -> 9 -> 8 -> 5).
 * 2. If a part is narrow and does not fit nominal offsets symmetrically, the problematic
 *    side's base offset is reduced by 10mm (e.g. 53 -> 43), while the safe side stays at 53mm.
 * 3. Subsequent inner step offsets (16 -> 9 -> 8 -> 5) remain unchanged.
 * 4. For each tool row, if the cut rectangle does not physically fit (spanX <= 0 or spanY <= 0),
 *    that specific pass is skipped without generating invalid/inverted coordinates.
 *
 * @param {number} width - Part width (mm)
 * @param {number} height - Part height (mm)
 * @param {Array<{toolNo:string|number, depth:number, stepOffset:number, name?:string}>} rows
 * @param {'relative'|'absolute'} [offsetMode='relative']
 * @returns {Array<{
 *   rowIdx: number,
 *   toolNo: string|number,
 *   depth: number,
 *   name: string,
 *   skipped: boolean,
 *   leftOffset: number,
 *   rightOffset: number,
 *   bottomOffset: number,
 *   topOffset: number,
 *   x1: number|null,
 *   x2: number|null,
 *   y1: number|null,
 *   y2: number|null,
 *   spanX: number,
 *   spanY: number
 * }>}
 */
/**
 * Calculates adaptive toolpath coordinates for a part of given width and height.
 *
 * Rules (confirmed with the shop):
 * 1. Ölçüye göre akıllı kısıtlama: sadece S0 (ilk/dış offset) esner. İç bıçakların
 *    aralarındaki adımlar (delta'lar — stepOffset[1], stepOffset[2], ...) HİÇBİR ZAMAN
 *    değişmez; sadece S0 küçülerek tüm zincir içeri/dışarı kayar. S0 dar parçada iç
 *    bıçakların (özellikle en içteki motifin) tam ve net kalmasına öncelik verecek
 *    şekilde otomatik küçülür — asla nominal değerinin üstüne çıkmaz.
 * 2. X ve Y ekseni tamamen bağımsız hesaplanır. Bir eksen dar olduğu için S0 orada
 *    küçülürken diğer eksen genişse kendi nominal S0 değerinde kalır.
 * 3. Karşılıklı kenarlar HER ZAMAN simetriktir (sol=sağ, alt=üst) — asimetrik kayma
 *    yok, parça her zaman merkezli işlenir.
 * 4. Adapte edilmiş S0 ile bile bir bıçağın (genelde en içteki) payı kalmıyorsa
 *    (span <= 0), o bıçak sorunsuzca atlanır (skipped=true) — hata vermez.
 *
 * "Mutlak" modda offsetler zaten birbirinden bağımsız/sabit ölçülerdir (kullanıcı
 * doğrudan kenardan mesafe olarak girmiştir), o yüzden esnetme uygulanmaz — sadece
 * sığmayan satırlar tek tek atlanır.
 *
 * @param {number} width - Part width (mm)
 * @param {number} height - Part height (mm)
 * @param {Array<{toolNo:string|number, depth:number, stepOffset:number, name?:string}>} rows
 * @param {'relative'|'absolute'} [offsetMode='relative']
 * @param {number} [minCenterSpan=0] - en içteki geçerli bıçağın bırakması gereken minimum güvenli pay (mm)
 * @returns {Array<{
 *   rowIdx: number, toolNo: string|number, depth: number, name: string, skipped: boolean,
 *   leftOffset: number, rightOffset: number, bottomOffset: number, topOffset: number,
 *   x1: number|null, x2: number|null, y1: number|null, y2: number|null,
 *   spanX: number, spanY: number
 * }>}
 */
export function calculateAdaptiveOffsets(width, height, rows, offsetMode = 'relative', minCenterSpan = 0) {
  if (!rows || rows.length === 0) return [];
  const isAbs = offsetMode === 'absolute';

  // Adapts S0 (row 0's offset) for ONE axis so the innermost row keeps a
  // positive (or minCenterSpan-safe) span, while every delta after row 0
  // stays exactly as specified. Returns the single symmetric offset to use
  // for BOTH sides of that axis, per row.
  function computeAxisOffsets(span) {
    if (isAbs) return null; // absolute mode: no S0 adaptation, handled per-row below

    const nominalCum = computeCumOffsets(rows, 'relative');
    const S0 = nominalCum[0];
    const innerCum = nominalCum.map((c) => c - S0); // fixed deltas relative to row 0, never adapted
    const lastInnerCum = innerCum[innerCum.length - 1];

    const maxAllowedS0 = (span - minCenterSpan) / 2 - lastInnerCum;
    const adaptedS0 = Math.max(0, Math.min(S0, maxAllowedS0));

    return innerCum.map((ic) => adaptedS0 + ic); // symmetric cumulative offset per row
  }

  const xOffsets = computeAxisOffsets(width);
  const yOffsets = computeAxisOffsets(height);

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let cumX, cumY;

    if (isAbs) {
      cumX = Number(r.stepOffset) || 0;
      cumY = Number(r.stepOffset) || 0;
    } else {
      cumX = xOffsets[i];
      cumY = yOffsets[i];
    }

    const x1 = cumX, x2 = width - cumX;
    const y1 = cumY, y2 = height - cumY;
    const spanX = x2 - x1;
    const spanY = y2 - y1;
    const fits = spanX > minCenterSpan - 1e-9 && spanY > minCenterSpan - 1e-9 && spanX > 0 && spanY > 0;

    results.push({
      rowIdx: i,
      toolNo: r.toolNo,
      depth: r.depth,
      name: r.name || '',
      skipped: !fits,
      leftOffset: cumX,
      rightOffset: cumX,
      bottomOffset: cumY,
      topOffset: cumY,
      x1: fits ? x1 : null,
      x2: fits ? x2 : null,
      y1: fits ? y1 : null,
      y2: fits ? y2 : null,
      spanX,
      spanY,
    });
  }

  return results;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {object} cfg - machine config (thickness, spindleSpeed, safeZ, toolChangeZ, homeZ, plungeFeed, cutFeed)
 * @param {Array<{toolNo:string|number, depth:number, stepOffset:number}>} cfg.rows
 * @param {'relative'|'absolute'} [cfg.offsetMode]
 * @param {number} [offsetX]
 * @param {number} [offsetY]
 * @param {boolean} [isCombined=false] - true ise M30 komutunu çıkart (birleştirilmiş g-code için)
 * @returns {string} full gcode program
 */
export function buildKapakGcode(width, height, cfg, offsetX = 0, offsetY = 0, isCombined = false) {
  const rows = cfg.rows || [];
  const offsetRows = rows.filter((row) => (row.operation || 'offset') !== 'derz');
  const derzRows = rows.map((row, rowIndex) => ({ row, rowIndex })).filter(({ row }) => row.operation === 'derz');
  const adaptiveRows = calculateAdaptiveOffsets(width, height, offsetRows, cfg.offsetMode || 'relative');
  const lines = isCombined ? [] : ['makro'];
  let lastEmittedToolNo = null;

  adaptiveRows.forEach((r) => {
    if (r.skipped) return;

    const x1 = offsetX + r.x1;
    const x2 = offsetX + r.x2;
    const y1 = offsetY + r.y1;
    const y2 = offsetY + r.y2;
    const z = +(cfg.thickness - r.depth).toFixed(3);

    const toolChanged = String(r.toolNo) !== String(lastEmittedToolNo);

    if (toolChanged) {
      if (lastEmittedToolNo !== null) {
        lines.push(`G0Z${fmt(cfg.toolChangeZ)}`);
        lines.push('M5');
      }
      lines.push(`M6T${r.toolNo}`);
      lines.push(`M3 S${cfg.spindleSpeed}`);
      lastEmittedToolNo = r.toolNo;
    }

    lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(cfg.safeZ)}`);
    lines.push(`G1   Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
    lines.push(`G1 X${fmt(x2)}   F${cfg.cutFeed.toFixed(1)}`);
    lines.push(` Y${fmt(y2)} `);
    lines.push(`X${fmt(x1)}  `);
    lines.push(` Y${fmt(y1)} `);
    lines.push(`G0   Z${fmt(cfg.safeZ)}`);
  });

  derzRows.forEach(({ row, rowIndex }) => {
    const derz = row.derz || {};
    const previousOffsetRows = rows.slice(0, rowIndex).filter((item) => (item.operation || 'offset') !== 'derz');
    const previousOffsets = computeCumOffsets(previousOffsetRows, cfg.offsetMode || 'relative');
    const previousOffset = derz.respectPreviousOffset === false ? 0 : (previousOffsets[previousOffsets.length - 1] || 0);
    const opts = {
      width,
      height,
      yon: derz.yon || 'dikey',
      margin: previousOffset + (Number(derz.margin) || 0),
      spacing: Number(derz.spacing) || Number(row.stepOffset) || 60,
      autoFit: derz.autoFit !== false,
      overshootX: Number(derz.overshootX ?? derz.overshoot) || 1,
      overshootY: Number(derz.overshootY ?? derz.overshoot) || 1,
      edgeExtra: Number(derz.edgeExtra) || 0,
    };
    const positions = computeDerzPositions(opts).positions;
    if (!positions.length) return;
    const z = +(cfg.thickness - Number(row.depth || 0)).toFixed(3);
    lines.push(`M6T${row.toolNo}`);
    lines.push(`M3 S${cfg.spindleSpeed}`);
    positions.forEach((pos) => {
      const vertical = opts.yon === 'dikey';
      const x1 = vertical ? offsetX + pos : offsetX + opts.margin - opts.overshootX;
      const y1 = vertical ? offsetY + opts.margin - opts.overshootY : offsetY + pos;
      const x2 = vertical ? x1 : offsetX + width - opts.margin + opts.overshootX;
      const y2 = vertical ? offsetY + height - opts.margin + opts.overshootY : y1;
      lines.push(`G0 X${fmt(x1)} Y${fmt(y1)} Z${fmt(cfg.safeZ)}`);
      lines.push(`G1 Z${fmt(z)} F${cfg.plungeFeed.toFixed(1)}`);
      lines.push(`G1 X${fmt(x2)} Y${fmt(y2)} F${cfg.cutFeed.toFixed(1)}`);
      lines.push(`G0 Z${fmt(cfg.safeZ)}`);
    });
  });

  if (lastEmittedToolNo !== null) {
    lines.push(`G0Z${fmt(cfg.toolChangeZ)}`);
    lines.push('M5');
  }

  if (!isCombined) {
    lines.push(`G0 X0.00 Y0.00 Z${fmt(cfg.homeZ)}`);
    lines.push(`G0Z${fmt(cfg.homeZ)}`);
    lines.push('X0.00Y0.00');
    lines.push('M5');
    lines.push('M16');
    lines.push('M30');
  }

  return lines.join('\n');
}

/**
 * Exports a visual DXF check file for a Kapak preset. The file is deliberately
 * layered so the shop can inspect nominal, offset, and derz geometry in CAD.
 */
export function buildKapakPresetDxf(width, height, cfg = {}) {
  const rows = cfg.rows || [];
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '2', '0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS'];
  const layers = ['0_NOMINAL', ...rows.map((row, index) => `${row.operation === 'derz' ? 'DERZ' : 'OFFSET'}_T${row.toolNo || index + 1}_${index + 1}`)];
  layers.forEach((layer, index) => lines.push('0', 'LAYER', '2', layer, '70', '0', '62', String((index % 6) + 1), '6', 'CONTINUOUS'));
  lines.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  function addLine(layer, x1, y1, x2, y2) { lines.push('0', 'LINE', '8', layer, '10', Number(x1).toFixed(3), '20', Number(y1).toFixed(3), '30', '0.000', '11', Number(x2).toFixed(3), '21', Number(y2).toFixed(3), '31', '0.000'); }
  function addRect(layer, x1, y1, x2, y2) { addLine(layer, x1, y1, x2, y1); addLine(layer, x2, y1, x2, y2); addLine(layer, x2, y2, x1, y2); addLine(layer, x1, y2, x1, y1); }
  addRect('0_NOMINAL', 0, 0, width, height);
  let offsetRows = 0;
  rows.forEach((row, index) => {
    const layer = layers[index + 1];
    if (row.operation === 'derz') {
      const derz = row.derz || {};
      const base = offsetRows;
      const yon = derz.yon || 'dikey';
      const margin = (derz.respectPreviousOffset === false ? 0 : base) + (Number(derz.margin) || 0);
      const overshootX = Number(derz.overshootX ?? derz.overshoot) || 1;
      const overshootY = Number(derz.overshootY ?? derz.overshoot) || 1;
      const spacing = Number(derz.spacing) || Number(row.stepOffset) || 60;
      const available = (yon === 'dikey' ? width : height) - margin * 2;
      const count = derz.autoFit === false ? Math.max(0, Math.floor(available / spacing) + 1) : Math.max(0, Math.round(available / spacing) + 1);
      const exact = count > 1 ? available / (count - 1) : spacing;
      for (let i = 0; i < count; i++) {
        const pos = margin + i * exact;
        if (yon === 'dikey') addLine(layer, pos, margin - overshootY, pos, height - margin + overshootY);
        else addLine(layer, margin - overshootX, pos, width - margin + overshootX, pos);
      }
    } else {
      offsetRows += Number(row.stepOffset) || 0;
      addRect(layer, offsetRows, offsetRows, width - offsetRows, height - offsetRows);
    }
  });
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

/**
 * Validates a size against a tool-row set before generating gcode.
 * Only validates missing configuration fields (not narrow dimensions).
 * @returns {string|null} an error message, or null if valid
 */
export function validateKapakSize(width, height, rows, offsetMode = 'relative') {
  if (!rows || rows.length === 0) return 'En az bir bıçak tanımla.';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.toolNo === '' || r.toolNo === undefined || r.toolNo === null) return 'Bir satırda Tool No eksik.';
    if (!Number.isFinite(r.depth)) return `${r.name || 'bir bıçak'} için derinlik eksik.`;
    if (!Number.isFinite(r.stepOffset)) return `${r.name || 'bir bıçak'} için adım offset eksik.`;
  }
  return null;
}

/** Parses a batch line like "327-656" or "327-656-2" (trailing qty ignored). */
export function parseBatchLine(line) {
  const parts = line.trim().split('-').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const w = parseFloat(parts[0]);
  const h = parseFloat(parts[1]);
  if (Number.isNaN(w) || Number.isNaN(h)) return null;
  return { width: w, height: h, raw: line.trim() };
}