himport { buildKapakGcode } from './kapak.js';
import { NUMUNE_PRESETS, toPresetDoc } from '../../../../server/scripts/seed-numune-presets.js';

const src = { '1': { w: 292, h: 400 }, '2': { w: 292, h: 400 }, '3': { w: 292, h: 400 } };
for (const def of NUMUNE_PRESETS) {
  const key = def.name.split(' ')[0];
  if (!['1', '2', '3'].includes(key)) continue;
  const doc = toPresetDoc(def);
  const g = buildKapakGcode(src[key].w, src[key].h, { ...doc, rows: doc.rows });
  const xLines = g.split('\n').filter((l) => /^G0 X/.test(l) || /^G1 X[\d.]+ Y[\d.]+/.test(l));
  console.log(`=== ${def.name} ===`);
  console.log(g.split('\n').filter((l) => /M6T/.test(l) || /^G0 X/.test(l) || /F\d/.test(l)).slice(0, 40).join('\n'));
  console.log('');
  void xLines;
}
