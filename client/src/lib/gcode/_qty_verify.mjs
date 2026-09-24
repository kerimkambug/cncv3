import { calculateNesting } from './nesting.js';

const plateW = 1830, plateH = 3660;
const parts = [
  { name: 'A', width: 500, height: 454, qty: 3 },
  { name: 'B', width: 300, height: 200, qty: 2 },
];

const res = calculateNesting({ plateW, plateH, edge: 10, gap: 10, parts });
const total = res.plates.reduce((s, p) => s + p.parts.length, 0);
console.log('Toplam yerleşen parça:', total, '(beklenen 5)');
console.log('Plaka sayısı:', res.plates.length);
for (const p of res.plates) {
  console.log(`Plaka ${p.number}:`, p.parts.map(x => `${x.name}${x.qty > 1 ? `#${x.copyIndex}` : ''} @(${Math.round(x.x)},${Math.round(x.y)}) ${x.w}×${x.h}${x.rotated ? ' R' : ''}`).join(' | '));
}
if (total !== 5) { console.error('HATA: qty işlenmedi!'); process.exit(1); }
console.log('OK');
