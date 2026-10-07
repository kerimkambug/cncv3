// Kullanıcının yapıştırdığı nesting çıktısını yeniden üret ve şüpheli
// satırları programatik olarak işaretle.
import { buildNestingPlateGcode, calculateNesting } from './client/src/lib/gcode/nesting.js';
import { NUMUNE_PRESETS, toPresetDoc } from './server/scripts/seed-numune-presets.js';

const presetMap = {};
for (const def of NUMUNE_PRESETS) presetMap[def.name] = toPresetDoc(def);

const parts = [];
for (let i = 1; i <= 14; i++) parts.push({ name: `P${i}`, width: 500, height: 500, presetName: `${i} NUMARA` });

const nest = calculateNesting({ plateW: 2100, plateH: 2800, edge: 7, gap: 12, rotate: true, parts });
const plate = nest.plates[0];
console.log('yerleşim:'); plate.parts.slice().sort((a,b)=>(b.y-a.y)||(b.x-a.x)).forEach(p=>console.log('  ', p.presetName, `X${p.x} Y${p.y}`));

const g = buildNestingPlateGcode(plate, {
  thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 5000,
  safeZ: 46, toolChangeZ: 46, homeZ: 46,
  cutToolNo: '6', cutToolDia: 6, preCutDepth: 1.5, enableOuterCut: true,
}, presetMap);

const lines = g.split('\n');
console.log('toplam satır:', lines.length);

// 1) Aynı takım için üst üste M6 (gereksiz değişim)
for (let i = 1; i < lines.length; i++) {
  const a = /^M6T(\d+)$/.exec(lines[i - 1].trim());
  const b = /^M6T(\d+)$/.exec(lines[i].trim());
  if (a && b && a[1] === b[1]) console.log(`  satır ${i + 1}: aynı takım arka arkaya M6T${b[1]} (gereksiz değişim)`);
}

// 2) Z0 final kesimde takım
const z0Tool = [];
for (let i = 0; i < lines.length; i++) {
  if (/^G1 Z0\.00 F/.test(lines[i])) {
    for (let j = i; j >= 0; j--) {
      const m = /^M6T(\d+)$/.exec(lines[j].trim());
      if (m) { z0Tool.push(m[1]); break; }
    }
  }
}
console.log('Z0 final kesimdeki takım(lar):', [...new Set(z0Tool)].join(','), `(${z0Tool.length} kesim)`);

// 3) İşleme aşamasında kullanılan takımlar
const toolSeq = lines.filter((l) => /^M6T\d+$/.test(l.trim())).map((l) => l.trim());
console.log('takım sırası:', toolSeq.join(' '));

// 4) Parça sayısı / koordinatlar
const m = /G0 X7\.00 Y2027\.00 Z46\.00/;
console.log('kullanıcının ilk bloğu var mı:', lines.some((l) => l.includes('X7.00 Y2027.00')));
console.log('ilk 12 satır:'); lines.slice(0, 12).forEach((l, i) => console.log('   ', i + 1, JSON.stringify(l)));
