// _geo_compare.mjs
// Byte-birebir değil, GEOMETRİK eşdeğerlik karşılaştırması.
// ArtCAM kendi I/J işaretlerini ve lead-in noktalarını tutarsız koyduğu için
// (yay başlangıç noktası kendi I/J yarıçapı üzerinde bile değil) saf metin
// eşleşmesi yanıltıcı. Bunun yerine:
//  - her iki taraftaki G2/G3 yaylarının YARIÇAPINI ve MERKEZİNİ çıkarıp karşılaştır
//  - düz kenar koordinatlarını (X=.., Y=..) küme olarak karşılaştır
import fs from 'fs';
import { buildKapakGcode } from './kapak.js';
import { NUMUNE_PRESETS, toPresetDoc } from '../../../../server/scripts/seed-numune-presets.js';

const base = new URL('../../../..', import.meta.url);
const readCnc = (n) => fs.readFileSync(new URL(`numuneler/${n} NUMARA.cnc`, base), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const core = (s) => s.replace(/\s+/g, '').toUpperCase();

// Extract arcs as {x,y,R,cx,cy} and straight coords as a set of "X.."/"Y.." tokens.
function parse(lines) {
  const arcs = [];
  const xs = new Set(), ys = new Set();
  for (const raw of lines) {
    const s = core(raw);
    const arc = s.match(/^G[23]X(-?[\d.]+)Y(-?[\d.]+)I(-?[\d.]+)J(-?[\d.]+)/);
    if (arc) {
      const x = +arc[1], y = +arc[2], i = +arc[3], j = +arc[4];
      arcs.push({ x, y, r: +Math.hypot(i, j).toFixed(2), cx: +(x + i).toFixed(2), cy: +(y + j).toFixed(2) });
      continue;
    }
    const gx = s.match(/^(?:G\d)?X(-?[\d.]+)/);
    if (gx) xs.add((+gx[1]).toFixed(2));
    const gy = s.match(/^(?:G\d|G\dX-?[\d.]+)?Y(-?[\d.]+)/) || s.match(/^Y(-?[\d.]+)/);
    if (gy) ys.add((+gy[1]).toFixed(2));
  }
  return { arcs, xs, ys };
}

const setOverlap = (a, b) => [...a].filter((v) => b.has(v)).length;

console.log('\n===== GEOMETRİK EŞDEĞERLİK (yarıçap / merkez / kenar) =====\n');
for (const def of NUMUNE_PRESETS) {
  const n = def.name.split(' ')[0];
  const real = parse(readCnc(n));
  const got = parse(buildKapakGcode(292, 400, toPresetDoc(def)).split('\n'));

  const gotArcs = new Set(got.arcs.map((a) => `R${a.r}@(${a.cx},${a.cy})`));
  const realArcs = new Set(real.arcs.map((a) => `R${a.r}@(${a.cx},${a.cy})`));

  const arcMatch = setOverlap(realArcs, gotArcs);
  const xMatch = setOverlap(real.xs, got.xs);
  const yMatch = setOverlap(real.ys, got.ys);

  const realR = [...new Set(real.arcs.map((a) => a.r))].sort((a, b) => a - b);
  const gotR = [...new Set(got.arcs.map((a) => a.r))].sort((a, b) => a - b);

  console.log(`### ${def.name}`);
  console.log(`  yay (yarıçap@merkez): nihai ${real.arcs.length} / motor ${got.arcs.length} → ortak ${arcMatch}`);
  console.log(`  nihai yarıçaplar: ${realR.join(', ') || '-'} | motor yarıçaplar: ${gotR.join(', ') || '-'}`);
  console.log(`  X koordinatları: ortak ${xMatch}/${real.xs.size}`);
  console.log(`  Y koordinatları: ortak ${yMatch}/${real.ys.size}`);
  console.log('');
}
