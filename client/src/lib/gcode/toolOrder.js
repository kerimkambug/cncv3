// One tool change per tool: a finished program is regrouped so that every tool
// does ALL of its work in one go before the next tool is loaded. Order of the
// tools = order of their first use. The only tool allowed to come back is the
// final cut (`finalTool`): its last block (the through cut that frees the
// parts) stays at the very end.
//
// A program that already uses each tool once is returned unchanged, byte for
// byte — so ArtCAM-matched outputs are not touched.

const TOOL = /^(?:N\d+\s+)?M6T(\S+)\s*$/;
const STOP = /^(?:N\d+\s+)?M5\s*$/;
const HEAD = /^(?:N\d+\s+)?(?:M3\b|S\d+\s*M3|M7\b|G0\s*Z-?[\d.]+\s*$)/;
const RETRACT = /^(?:N\d+\s+)?G0\s*Z-?[\d.]+\s*$/;
const HOME = /^(?:N\d+\s+)?G0\s*X0(?:\.0+)?\s*Y0(?:\.0+)?\b/;

/** Tool numbers in the order they are loaded (one entry per M6T). */
export function toolSequence(text) {
  return String(text).split('\n').map((l) => TOOL.exec(l.trim())).filter(Boolean).map((m) => m[1]);
}

/** Tools loaded more than once (the final cut's last block excepted), or [] if the program is clean. */
export function repeatedTools(text, finalTool = null) {
  const seq = toolSequence(text);
  const runs = seq.filter((t, i) => i === 0 || t !== seq[i - 1]);
  const body = finalTool != null && runs[runs.length - 1] === String(finalTool) ? runs.slice(0, -1) : runs;
  return [...new Set(body.filter((t, i) => body.indexOf(t) !== i))];
}

/**
 * @param {string} text  a complete program (or a combined one without header/footer)
 * @param {{finalTool?: string|number|null}} [opts]
 */
export function mergeToolBlocks(text, { finalTool = null } = {}) {
  const seq = toolSequence(text);
  const redundant = seq.some((t, i) => i > 0 && t === seq[i - 1]); // M6T6 … M6T6 back to back
  if (!redundant && !repeatedTools(text, finalTool).length) return text;
  const lines = String(text).split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (TOOL.test(l.trim())) starts.push(i); });
  const last = starts[starts.length - 1];
  let footAt = lines.findIndex((l, i) => i > last && HOME.test(l.trim()));
  if (footAt < 0) footAt = lines.length;
  const header = lines.slice(0, starts[0]);
  const footer = lines.slice(footAt);
  // the retract the program already uses between passes (for joining bodies)
  const retract = lines.find((l) => RETRACT.test(l.trim()));

  const blocks = starts.map((s, k) => {
    const blk = lines.slice(s, k + 1 < starts.length ? starts[k + 1] : footAt);
    while (blk.length && (STOP.test(blk[blk.length - 1].trim()) || !blk[blk.length - 1].trim())) blk.pop();
    const head = [blk[0]];
    let j = 1;
    while (j < blk.length && HEAD.test(blk[j].trim())) head.push(blk[j++]);
    return { tool: TOOL.exec(blk[0].trim())[1], head, body: blk.slice(j) };
  });

  // the final cut: the trailing run of `finalTool` blocks stays last
  let finalFrom = blocks.length;
  if (finalTool != null) while (finalFrom > 0 && blocks[finalFrom - 1].tool === String(finalTool)) finalFrom--;
  if (finalFrom === 0) finalFrom = blocks.length; // the whole program is one tool
  const groups = [];
  const byTool = new Map();
  blocks.slice(0, finalFrom).forEach((b) => {
    if (!byTool.has(b.tool)) { const g = { tool: b.tool, head: b.head, bodies: [] }; byTool.set(b.tool, g); groups.push(g); }
    byTool.get(b.tool).bodies.push(b.body);
  });
  const finals = blocks.slice(finalFrom);
  if (finals.length) groups.push({ tool: finals[0].tool, head: finals[0].head, bodies: finals.map((b) => b.body), final: true });

  const out = [...header];
  let current = null;
  for (const g of groups) {
    if (g.tool !== current) {
      if (current !== null) out.push('M5');
      out.push(...g.head);
      current = g.tool;
    }
    g.bodies.forEach((body) => {
      // never travel to the next stretch from cutting depth
      const prev = out[out.length - 1];
      if (retract && prev && !RETRACT.test(prev.trim()) && !TOOL.test(prev.trim()) && !HEAD.test(prev.trim())) out.push(retract);
      out.push(...body);
    });
  }
  const endPrev = out[out.length - 1];
  if (retract && endPrev && !RETRACT.test(endPrev.trim())) out.push(retract);
  out.push(...footer);
  return out.join('\n');
}
