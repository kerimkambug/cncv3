// _arcdump.mjs — 1/8 NUMARA köşe yaylarını (G2) yarıçap@merkez + I/J olarak dök.
//   node client/src/lib/gcode/_arcdump.mjs
import fs from 'fs';
import { buildKapakGcode, buildRoundedRectProfile } from './kapak.js';
import { NUMUNE_PRESETS, toPresetDoc } from '../../../../server/scripts/seed-numune-presets.js';

const base = new URL('../../../..', import.meta.url);
const W = 292, H = 400;
const readCnc = (n) => fs.readFileSync(new URL(`numuneler/${n} NUMARA.cnc`, base), 'utf8')
  .split(/\r?\n/).map((l) => l.replace(/\s+/g, '').toUpperCase()).filter(Boolean);
const out = (num) => {
  const def = NUMUNE_PRESETS.find((d) => d.name.startsWith(num));
  return buildKapakGcode(W, H, toPresetDoc(def))
    .split('\n').map((l) => l.replace(/\s+/g, '').toUpperCase()).filter(Boolean);
};

// Sanity: what the ENGINE function alone returns for the 8 NUMARA T8 box.
console.log('engine buildRoundedRectProfile(60,60,232,340,r=4):');
for (const s of buildRoundedRectProfile(60, 60, 232, 340, 4, 12.5, 3000, 9000, 46)) console.log('   ' + s);

for (const n of ['1', '8']) {
  console.log(`\n########## ${n} NUMARA — G2/G3 köşe yayları ##########`);
  for (const [label, lines] of [['nihai', readCnc(n)], ['motor', out(n)]]) {
    console.log(`  --- ${label} ---`);
    for (const s of lines) {
      const m = s.match(/^G([23])X(-?[\d.]+)Y(-?[\d.]+)I(-?[\d.]+)J(-?[\d.]+)/);
      if (!m) continue;
      const [type, x, y, i, j] = [m[1], +m[2], +m[3], +m[4], +m[5]];
      console.log(`    G${type} start=(${x.toFixed(2)},${y.toFixed(2)}) I=${i.toFixed(2)} J=${j.toFixed(2)}` +
        `  R=${Math.hypot(i, j).toFixed(2)}  centre=(${(x + i).toFixed(2)},${(y + j).toFixed(2)})`);
    }
  }
}
