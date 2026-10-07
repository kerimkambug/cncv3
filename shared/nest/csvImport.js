// shared/nest/csvImport.js
// Nesting parts-list import parser.
//
// WHY THIS EXISTS: the previous implementation did
//     line.split(/[,;]/).map(c => parseFloat(c.replace(',', '.')))
// which is ambiguous for the Turkish decimal comma the shop actually uses.
// "Kapak;500,5;454,2;2" was split into ["Kapak","500","5","454","2","2"] and
// every value landed in the wrong column.
//
// The format is now EXPLICIT instead of guessed:
//
//   * Column separator: the first separator character found on the first
//     meaningful row decides it for the whole file (";" or "," or a TAB). A
//     single-delimiter file is therefore never re-interpreted per row.
//   * Decimal separator: the OTHER character. When ';' is the column
//     separator, ',' is the decimal mark (Turkish/European). When ',' is the
//     column separator, '.' is the decimal mark (Anglo). A comma used as a
//     column separator can never also be a decimal mark in the same file, so
//     the two are unambiguous.
//   * Quoting: RFC4180-style double quotes. A quoted field may contain the
//     column separator and the decimal mark; "" escapes a literal quote.
//   * Empty fields: preserved as empty strings (they count for column
//     position); a row made only of separators is treated as blank.
//   * Whitespace: trimmed around unquoted fields.
//   * Malformed rows: reported by 1-based line number and skipped — never
//     silently guessed.

/** Splits one CSV record into fields, honouring double-quote quoting. */
export function splitCsvRecord(line, separator) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = false; }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; quoted = true; continue; }
    if (ch === separator) { fields.push({ value: current, quoted }); current = ''; quoted = false; continue; }
    current += ch;
  }
  fields.push({ value: current, quoted });

  return fields.map((f) => (f.quoted ? f.value : f.value.trim()));
}

/**
 * Decides the column separator for the file from its first meaningful row.
 *
 * Semicolon and TAB are checked FIRST because those are the only separators a
 * Turkish/European decimal comma can coexist with. If a line contains a ';'
 * (or a tab) anywhere, that is the column separator and ',' is the decimal
 * mark — otherwise "500,5;454,2;2" would be read as comma-separated with the
 * decimal commas mistaken for column breaks. Plain comma separation is chosen
 * only when there is no semicolon/tab at all.
 */
export function detectColumnSeparator(text) {
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.includes('\t')) return '\t';
    if (line.includes(';')) return ';';
    if (line.includes(',')) return ',';
  }
  return ';';
}

/** Parses a numeric cell using the file's decimal separator. Returns NaN if not a number. */
export function parseNumberCell(cell, decimalSeparator) {
  const raw = String(cell ?? '').trim();
  if (raw === '') return NaN;
  const other = decimalSeparator === ',' ? '.' : ',';
  // Normalise any occurrence of the "other" mark to the file's own mark, then
  // to a plain dot for Number.parseFloat.
  const normalised = raw.split(other).join(decimalSeparator).split(decimalSeparator).join('.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(normalised)) return NaN;
  return Number.parseFloat(normalised);
}

/**
 * @typedef {{name:string, width:number, height:number, qty:number}} NestPart
 * @typedef {{parts:NestPart[], errors:number[], separator:string, decimal:string}} NestImportResult
 */

/**
 * Parses a pasted/imported parts list.
 *
 * Accepted shapes, in either separator style:
 *   name ; width ; height ; qty     (qty optional, defaults to 1)
 *           width ; height ; qty
 *   width - height - qty            (legacy TXT, '.', or ',' decimal)
 *
 * @param {string} text
 * @returns {NestImportResult}
 */
export function parseNestImportText(text) {
  const source = String(text ?? '');
  const rawLines = source.split(/\r?\n/);
  const separator = detectColumnSeparator(source);
  const decimal = separator === '\t' || separator === ';' ? ',' : '.';
  const parts = [];
  const errors = [];

  rawLines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    if (!line.includes(separator)) {
      // Legacy TXT: 500-454-2 => 500mm x 454mm, qty 2.
      const match = line.match(/^(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+)$/);
      if (!match) { errors.push(index + 1); return; }

      const width = Number.parseFloat(match[1].replace(',', '.'));
      const height = Number.parseFloat(match[2].replace(',', '.'));
      const qty = Number.parseInt(match[3], 10);
      if (width <= 0 || height <= 0 || qty <= 0) { errors.push(index + 1); return; }
      parts.push({ name: `${width}×${height}`, width, height, qty });
      return;
    }

    const cells = splitCsvRecord(line, separator);
    // A row of nothing but separators is blank, not malformed.
    if (cells.every((c) => c === '')) return;

    const numeric = cells.map((c) => parseNumberCell(c, decimal));
    const firstIsNumber = Number.isFinite(numeric[0]);

    // Header rows are skipped silently, but only on the first line.
    if (index === 0 && !firstIsNumber && /genişlik|width|yükseklik|height|isim|ad/i.test(line)) return;

    // Layout: the numbers are width, height [, qty]; anything before the
    // first number is the name. Columns are positional on purpose — that is
    // what makes the format predictable.
    let name = null;
    if (!firstIsNumber) name = cells[0];
    const numbers = numeric.slice(firstIsNumber ? 0 : 1);

    const width = numbers[0];
    const height = numbers[1];
    const qty = numbers.length >= 3 ? Math.trunc(numbers[2]) : 1;

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      errors.push(index + 1);
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(index + 1);
      return;
    }

    parts.push({ name: name && name !== '' ? name : `${width}×${height}`, width, height, qty });
  });

  return { parts, errors, separator, decimal };
}
