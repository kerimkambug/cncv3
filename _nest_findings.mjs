// Kullanıcının nesting çıktısındaki GERÇEK hataları bul.
import { buildNestingPlateGcode, calculateNesting } from './client/src/lib/gcode/nesting.js';
import { NUMUNE_PRESETS, toPresetDoc } from './server/scripts/seed-numune-presets.js';

const presetMap = {};
for (const def of NUMUNE_PRESETS) presetMap[def.name] = toPresetDoc(def);

const parts = [];
for (let i = 1; i <= 14; i++) parts.push({ name: `P${i}`, width: 500, height: 500, presetName: `${i} NUMARA` });

const nest = calculateNesting({ plateW: 2100, plateH: 2800, edge: 7, gap: 12, rotate: true, parts });
const plate = nest.plates[0];

const g = buildNestingPlateGcode(plate, {
  thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 5000,
  safeZ: 46, toolChangeZ: 46, homeZ: 46,
  cutToolNo: '6', cutToolDia: 6, preCutDepth: 1.5, enableOuterCut: true,
}, presetMap);

const lines = g.split('\n');
const issues = [];

// --- HATA 1: Aynı takım arka arkaya (gereksiz M6/T-change) ---
for (let i = 1; i < lines.length; i++) {
  const a = /^M6T(\d+)$/.exec(lines[i - 1].trim());
  const b = /^M6T(\d+)$/.exec(lines[i].trim());
  if (a && b && a[1] === b[1]) issues.push(`satır ${i + 1}: aynı takım arka arkaya M6T${b[1]} (işleme bitmeden takım değişimi)`);
}

// --- HATA 2: Her parça için takım değişiminin tekrarlanması ---
// Aynı takım 14 parçada tekrar tekrar M6 ile alınıyor mu?
const m6Count = {};
lines.forEach((l) => { const m = /^M6T(\d+)$/.exec(l.trim()); if (m) m6Count[m[1]] = (m6Count[m[1]] || 0) + 1; });
console.log('M6 sayıları:', JSON.stringify(m6Count));

// --- HATA 3: Z0 final kesimden ÖNCE yapılan ön kesim Z16.50 iki kez mi? ---
const preCut = lines.filter((l) => /Z16\.50 F/.test(l)).length;
const finalCut = lines.filter((l) => /Z0\.00 F/.test(l)).length;
console.log('ön kesim (Z16.50) dalış:', preCut, '| final kesim (Z0.00) dalış:', finalCut);

// --- HATA 4: İşleme (2. aşama) ile final kesim arasında hangi takımlar var ---
let phase = 'pre';
const phaseTools = { pre: [], profile: [], final: [] };
lines.forEach((l) => {
  const m = /^M6T(\d+)$/.exec(l.trim());
  if (m) phaseTools[phase].push(m[1]);
  if (/G1 Z16\.50 F/.test(l)) phase = 'profile';
  if (/G1 Z0\.00 F/.test(l)) phase = 'final';
});
console.log('ön kesim takım:', [...new Set(phaseTools.pre)].join(','));
console.log('işleme takımları:', phaseTools.profile.join(' '));
console.log('final kesim takım:', [...new Set(phaseTools.final)].join(','));

// --- HATA 5: profile satırı 10 NUMARA'da T1 carving var mı, derz var mı ---
for (const def of NUMUNE_PRESETS) {
  const ops = def.cfg.rows.map((r) => `${r.toolNo}:${r.operation || 'offset'}`).join(' ');
  console.log(`  ${def.name.padEnd(10)} ${ops}`);
}

console.log('\n--- SORUNLAR ---');
if (issues.length === 0) console.log('  (üretim tarafında tespit yok)');
issues.forEach((s) => console.log('  ' + s));
