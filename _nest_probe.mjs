// Kullanıcının verdiği nesting çıktısının hangi girdiyle üretildiğini bul ve
// şüpheli satırları (duplicate tool-change bloğu, kayıp T6, sıra) doğrula.
import { buildNestingPlateGcode, calculateNesting } from './client/src/lib/gcode/nesting.js';

const parts = [];
for (let i = 1; i <= 14; i++) {
  parts.push({ name: `Parça ${i}`, width: 500, height: 500, presetName: `${i} NUMARA` });
}

const nest = calculateNesting({ plateW: 2100, plateH: 2800, edge: 0, gap: 12, rotate: true, parts });
console.log('plaka sayısı:', nest.plates.length);
nest.plates.forEach((p, i) => {
  console.log(`plaka ${i + 1}: ${p.parts.length} parça`, p.parts.map((x) => `${x.presetName||x.name}@(${x.x},${x.y})`).join(' '));
});
