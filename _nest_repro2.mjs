// Kullanıcının çıktısını DOĞRU şekilde yeniden üret: parçalar presetId taşımalı.
import { buildNestingPlateGcode, calculateNesting, groupNestingPartsByPreset } from './client/src/lib/gcode/nesting.js';
import { NUMUNE_PRESETS, toPresetDoc } from './server/scripts/seed-numune-presets.js';

const presetMap = {};
for (const def of NUMUNE_PRESETS) presetMap[def.name] = toPresetDoc(def);

const parts = [];
for (let i = 1; i <= 14; i++) parts.push({ name: `P${i}`, width: 500, height: 500, presetId: `${i} NUMARA` });

const nest = calculateNesting({ plateW: 2100, plateH: 2800, edge: 7, gap: 12, rotate: true, parts });
const plate = nest.plates[0];
plate.parts.forEach((p) => { p.presetId = p.presetId || p.name; });

// presetId'yi isimden türet (yerleşim kopyalarken koruyor mu?)
plate.parts.forEach((p, i) => { if (!p.presetId) p.presetId = `${i + 1} NUMARA`; });

const groups = groupNestingPartsByPreset(plate.parts, { rows: [] }, presetMap);
console.log('grup sayısı:', groups.length);
groups.forEach((g) => console.log(`  ${g.key.padEnd(12)} ${g.parts.length} parça`));

const g = buildNestingPlateGcode(plate, {
  thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 5000,
  safeZ: 46, toolChangeZ: 46, homeZ: 46,
  cutToolNo: '6', cutToolDia: 6, preCutDepth: 1.5, enableOuterCut: true,
}, presetMap);

const lines = g.split('\n');
console.log('toplam satır:', lines.length);
const m6 = lines.filter((l) => /^M6T\d+$/.test(l.trim())).map((l) => l.trim());
console.log('M6 sayısı:', m6.length);
console.log('takım sırası:', m6.join(' '));
console.log('ilk 8 satır:'); lines.slice(0, 8).forEach((l, i) => console.log('   ', i + 1, JSON.stringify(l)));
