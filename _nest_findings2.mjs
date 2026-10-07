// Kullanıcının nesting çıktısındaki GERÇEK hataları programatik olarak bul.
import { buildNestingPlateGcode, calculateNesting } from './client/src/lib/gcode/nesting.js';
import { NUMUNE_PRESETS, toPresetDoc } from './server/scripts/seed-numune-presets.js';

const presetMap = {};
for (const def of NUMUNE_PRESETS) presetMap[def.name] = toPresetDoc(def);

const parts = [];
for (let i = 1; i <= 14; i++) parts.push({ name: `P${i}`, width: 500, height: 500, presetId: `${i} NUMARA` });

const nest = calculateNesting({ plateW: 2100, plateH: 2800, edge: 7, gap: 12, rotate: true, parts });
const plate = nest.plates[0];

const g = buildNestingPlateGcode(plate, {
  thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 5000,
  safeZ: 46, toolChangeZ: 46, homeZ: 46,
  cutToolNo: '6', cutToolDia: 6, preCutDepth: 1.5, enableOuterCut: true,
}, presetMap);

const lines = g.split('\n');
const problems = [];

// --- 1) Aynı takım arka arkaya M6 (işleme bitmeden takım değişimi) ---
for (let i = 1; i < lines.length; i++) {
  const a = /^M6T(\d+)$/.exec(lines[i - 1].trim());
  const b = /^M6T(\d+)$/.exec(lines[i].trim());
  if (a && b && a[1] === b[1]) problems.push(`satır ${i + 1}: arka arkaya aynı takım M6T${b[1]} (parçalar arası gereksiz/durum kaybı)`);
}

// --- 2) "İşleme" aşamasında T6 kullanımı: final kesim takımı işleme de yapıyor mu? ---
let phase = 'precut';
const byPhase = { precut: {}, profile: {}, final: {} };
lines.forEach((l) => {
  const m = /^M6T(\d+)$/.exec(l.trim());
  if (m) byPhase[phase][m[1]] = (byPhase[phase][m[1]] || 0) + 1;
  if (/G1 Z16\.50 F/.test(l)) phase = 'profile';
  if (/G1 Z0\.00 F/.test(l)) phase = 'final';
});
console.log('ön kesim takımları:', JSON.stringify(byPhase.precut));
console.log('işleme takımları  :', JSON.stringify(byPhase.profile));
console.log('final kesim takım :', JSON.stringify(byPhase.final));

// --- 3) Aynı takım hem işleme hem final kesimde mi? ---
const profileTools = new Set(Object.keys(byPhase.profile));
const finalTools = new Set(Object.keys(byPhase.final));
const both = [...profileTools].filter((t) => finalTools.has(t));
console.log('hem işleme hem final kesimde olan takım:', both.join(',') || '(yok)');

// --- 4) Bir parçanın tüm işlemleri bitmeden takım başka parçaya mı gidiyor? ---
// Her parça için kesim etiketlerini X/Y ile eşleştir; takım sırası parça bazında
// monoton olmalı (aynı parçaya geri dönülmemeli).
let curTool = null, prevTool = null;
const switches = [];
lines.forEach((l, i) => {
  const m = /^M6T(\d+)$/.exec(l.trim());
  if (m) { prevTool = curTool; curTool = m[1]; if (prevTool && prevTool === curTool) switches.push(i + 1); }
});

// --- 5) Aynı geometri (X/Y ve Z) iki kez kesiliyor mu? (kopya yol) ---
const cutSet = new Map();
lines.forEach((l, i) => {
  const t = l.trim();
  if (!/^(G1|X| )/.test(l) || !/[XY]/.test(l)) return;
  const xs = [...t.matchAll(/X(-?[\d.]+)/g)].map((m) => m[1]);
  const ys = [...t.matchAll(/Y(-?[\d.]+)/g)].map((m) => m[1]);
  if (!xs.length || !ys.length) return;
  const key = `X${xs[0]}Y${ys[0]}`;
  if (cutSet.has(key)) cutSet.get(key).push(i + 1); else cutSet.set(key, [i + 1]);
});

console.log('\n--- SORUNLAR ---');
if (problems.length === 0) console.log('  (arke arkaya aynı takım yok)');
problems.slice(0, 12).forEach((s) => console.log('  ' + s));
if (problems.length > 12) console.log(`  ... +${problems.length - 12} tane daha`);

console.log('\n--- ÖRNEK: ilk 3 takım bloğu ---');
let shown = 0;
for (let i = 0; i < lines.length && shown < 3; i++) {
  if (/^M6T\d+$/.test(lines[i].trim())) {
    console.log('  ' + lines.slice(i, i + 5).map((x) => JSON.stringify(x)).join('\n  '));
    console.log('  ---');
    shown++;
  }
}
