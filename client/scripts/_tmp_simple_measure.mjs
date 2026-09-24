import { processArtReliefPipeline } from '../src/lib/relief/artReliefEngine.js';

const W = 200, H = 200;
const data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let lum = 220; // düz açık arka plan
    if (x > 50 && x < 150 && y > 30 && y < 170) lum = 80; // büyük koyu dikdörtgen
    if (x > 90 && x < 110 && y > 80 && y < 110) lum = 250; // iç parlama
    data[i] = lum; data[i + 1] = lum; data[i + 2] = lum; data[i + 3] = 255;
  }
}

const res = processArtReliefPipeline({ width: W, height: H, data }, null, {});
function reg(x0, x1, y0, y1) {
  let s = 0, n = 0, mn = 1, mx = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = res.depthGrid[y * W + x]; s += v; n++; if (v < mn) mn = v; if (v > mx) mx = v; }
  return `mean=${(s / n).toFixed(3)} min=${mn.toFixed(3)} max=${mx.toFixed(3)}`;
}
console.log('bg köşe (10,10):   ', reg(5, 40, 5, 40));
console.log('gövde göbek(90,140):', reg(60, 140, 120, 160));
console.log('gövde kenarı(52,:  ', reg(52, 60, 100, 150));
console.log('parlama (95,100):  ', reg(92, 108, 82, 108));
console.log('gövde üst (60,80): ', reg(60, 90, 40, 70));
