// 7 modeli tek tek nesting ettim ve alakası yok durumla model mi bozuk nesting ederken mi bozuluyor bilmiyorum araştır
// → 7 farklı modeli tek tek nesting edip G-code ve DXF'i derinlemesine doğrulayan script.
import { calculateNesting, buildNestingPlateGcode, buildNestingPlateDxf } from './nesting.js';

const cfg = {
  thickness: 18,
  spindleSpeed: 18000,
  safeZ: 61,
  toolChangeZ: 96,
  homeZ: 96,
  plungeFeed: 3000,
  cutFeed: 6000,
  offsetMode: 'relative',
  topStyle: 'flat',
  rows: [
    { name: 'Dış profil', toolNo: '7', operation: 'offset', depth: 6, stepOffset: 20 },
    { name: 'Derz T2', toolNo: '2', operation: 'derz', depth: 2, stepOffset: 60, derz: { yon: 'dikey', margin: 5, spacing: 150, autoFit: true, overshootX: 1, overshootY: 1, edgeExtra: 0, respectPreviousOffset: true } },
    { name: 'Carving', toolNo: '1', operation: 'carving', depth: 6, stepOffset: 56, bitAngle: 90 },
  ],
};

// 7 gerçekçi model kombinasyonu
const cases = [
  { name: 'M1', w: 500, h: 800, qty: 4 },
  { name: 'M2', w: 292, h: 400, qty: 6 },
  { name: 'M3', w: 400, h: 400, qty: 9 },
  { name: 'M4', w: 180, h: 500, qty: 10 },
  { name: 'M5', w: 150, h: 150, qty: 16 },
  { name: 'M6', w: 800, h: 1000, qty: 2 },
  { name: 'M7', w: 120, h: 700, qty: 8 },
];

let allOk = true;

for (const c of cases) {
  const nest = calculateNesting({
    plateW: 2100, plateH: 2800, edge: 10, gap: 5, rotate: true,
    parts: [{ name: c.name, width: c.w, height: c.h, qty: c.qty }],
  });

  if (!nest.plates.length) { console.log(`✘ ${c.name}: plaka üretilmedi`); allOk = false; continue; }

  const totalParts = nest.plates.reduce((s, p) => s + p.parts.length, 0);
  if (totalParts !== c.qty) {
    console.log(`✘ ${c.name}: parça sayısı ${totalParts} ≠ ${c.qty}`);
    allOk = false;
  }

  // Her parçanın plaka içinde kalması
  let boundsOk = true;
  for (const plate of nest.plates) {
    for (const p of plate.parts) {
      if (p.x < 0 || p.y < 0 ||
        p.x + p.placedWidth > plate.plateW + 1e-6 ||
        p.y + p.placedHeight > plate.plateH + 1e-6) {
        console.log(`   ${c.name}: parça plaka dışında @(${p.x},${p.y}) ${p.placedWidth}x${p.placedHeight}`);
        boundsOk = false;
      }
    }
  }
  if (!boundsOk) allOk = false;

  const gcode = buildNestingPlateGcode(nest.plates[0], cfg, {});
  const lines = gcode.split('\n');

  // T2 derz bloğundaki dikey derz noktalarını topla (Z16 kesim)
  const t2Start = lines.findIndex((l) => /^M6T2$/.test(l));
  const t1AfterT2 = lines.findIndex((l, i) => i > t2Start && /^M6T1$/.test(l));
  const t2Block = t2Start === -1 ? [] : lines.slice(t2Start, t1AfterT2 === -1 ? lines.length : t1AfterT2);

  const derzCuts = [];
  for (let i = 0; i < t2Block.length; i++) {
    const m = t2Block[i].match(/^G1\s+Z([\d.-]+)/);
    if (!m) continue;
    if (Math.abs(parseFloat(m[1]) - 16) < 0.01) {
      const mv = t2Block[i + 1].match(/X([\d.-]+)\s*Y([\d.-]+)/);
      if (mv) derzCuts.push({ x: parseFloat(mv[1]), y: parseFloat(mv[2]) });
    }
  }

  // Her parçada 4 derz konumu olmalı: margin(5)+offset(20)=25, spacing 150 → 25,175,325,475
  const expectedLocal = [25, 175, 325, 475];
  let missing = 0;
  for (const plate of nest.plates) {
    for (const p of plate.parts) {
      for (const exp of expectedLocal) {
        const want = p.x + exp;
        const hit = derzCuts.some((v) => Math.abs(v.x - want) < 0.02 &&
          v.y >= p.y - 1.02 && v.y <= p.y + p.placedHeight + 1.02);
        if (!hit) { missing++; if (missing <= 3) console.log(`   ${c.name} parça@(${p.x},${p.y}): derz x=${want.toFixed(1)} EKSİK`); }
      }
    }
  }

  const dxf = buildNestingPlateDxf(nest.plates[0], cfg, {});
  const lineEntities = dxf.split('\n').filter((l) => l === 'LINE').length;

  const ok = missing === 0 && totalParts === c.qty && boundsOk;
  if (!ok) allOk = false;
  console.log(`${ok ? '✔' : '✘'} ${c.name}: ${c.w}x${c.h} ×${c.qty} → plaka ${nest.plates.length}, parça ${totalParts}, derz noktası ${derzCuts.length}, DXF LINE ${lineEntities}${missing ? `, eksik derz ${missing}` : ''}`);
}

console.log(allOk ? '\n✔ TÜM MODELLER DOĞRU' : '\n✘ HATALAR VAR');
process.exit(allOk ? 0 : 1);
