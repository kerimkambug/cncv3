// Nesting derz doğrulama: derz satırlı bir modelle plaka üret,
// G-code'daki derz çizgilerini ve DXF'teki LINE varlıklarını say.
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

const nest = calculateNesting({
  plateW: 2100,
  plateH: 2800,
  edge: 10,
  gap: 5,
  rotate: true,
  parts: [{ name: 'Kapak', width: 500, height: 800, qty: 4 }],
});

console.log('Plaka sayısı:', nest.plates.length, '| Parça sayısı:', nest.plates[0].parts.length);
const part = nest.plates[0].parts[0];
console.log('İlk parça:', `${part.name} @ x=${part.x}, y=${part.y}, ${part.placedWidth}x${part.placedHeight}, rotated=${part.rotated}`);

const gcode = buildNestingPlateGcode(nest.plates[0], cfg, {});
const lines = gcode.split('\n');

// Derz bloğu T2 ile başlamalı; T2 bloğundaki dikey çizgileri topla.
const t2Start = lines.findIndex((l) => /^M6T2$/.test(l));
const t1AfterT2 = lines.findIndex((l, i) => i > t2Start && /^M6T1$/.test(l));
const t2Block = lines.slice(t2Start, t1AfterT2 === -1 ? lines.length : t1AfterT2);

const vert = [];
for (let i = 0; i < t2Block.length; i++) {
  const m = t2Block[i].match(/^G1\s+Z([\d.-]+)/);
  if (!m) continue;
  const z = parseFloat(m[1]);
  // Derz derinliği 18-2=16
  if (Math.abs(z - 16) < 0.01) {
    const mv = t2Block[i + 1]; // G1 X.. Y.. kesim hareketi
    const xm = mv.match(/X([\d.-]+)/);
    const ym = mv.match(/Y([\d.-]+)/);
    if (xm && ym) vert.push({ x: parseFloat(xm[1]), y: parseFloat(ym[1]) });
  }
}
console.log('T2 derz bloğunda Z16 kesim noktası sayısı:', vert.length);
console.log('Derz X konumları (parça bazında):', vert.map((v) => v.x.toFixed(1)).join(', '));

// Beklenen: her parçada önceki offset (20) + margin (5) = 25 efek marjin,
// kullanılabilir uzunluk = 500 - 50 = 450; autoFit aralığı = 450 / round(450/150=3) = 150
// konumlar: 25, 175, 325, 475 (parça yereline göre)
const expectedPerPart = [25, 175, 325, 475];
const parts = nest.plates[0].parts;
let mismatches = 0;
parts.forEach((p) => {
  expectedPerPart.forEach((exp) => {
    const found = vert.some((v) => Math.abs(v.x - (p.x + exp)) < 0.02);
    if (!found) { mismatches++; console.log(`  EKSİK: parça @(${p.x},${p.y}) içinde x=${p.x + exp} beklenen derz yok`); }
  });
});
console.log(mismatches === 0 ? '✔ Tüm parçalarda 4 derz çizgisi doğru konumda.' : `✘ ${mismatches} eksik derz konumu.`);

// Derz taşması: y1 = part.y - 1, y2 = part.y + h + 1 olmalı
const firstLine = vert[0];
console.log('İlk derz Y (part.y - 1 =', part.y - 1, '):', firstLine.y);

const dxf = buildNestingPlateDxf(nest.plates[0], cfg, {});
const lineEntities = dxf.split('\n').filter((l) => l === 'LINE').length;
console.log('DXF LINE entity sayısı:', lineEntities);

// T2 katmanında dikey derz LINE var mı?
const t2LayerLines = [];
const dxfLines = dxf.split('\n');
for (let i = 0; i < dxfLines.length; i++) {
  // DXF çift dizisi: ['0','LINE','8',layer,'10',x1,'20',y1,...]
  if (dxfLines[i] === 'LINE' && dxfLines[i + 1] === '8') {
    const layer = dxfLines[i + 2];
    if (layer.includes('T2')) t2LayerLines.push(layer);
  }
}
console.log('T2 katmanındaki LINE sayısı:', t2LayerLines.length, '(beklenen: 1 parça × 6 derz = 6)');
console.log(t2LayerLines.length === 6 ? '✔ DXF derz katmanı doğru.' : '✘ DXF derz katmanı eksik/fazla.');
