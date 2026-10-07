// Kullanıcının çıktısındaki T6 ön-kesim başlangıcı: X7 Y2027, blok 506x506.
// Kenar boşluğu (edge) ile tool radius telafisini kalibre et.
import { buildNestingPlateGcode } from './client/src/lib/gcode/nesting.js';

// Parça yerleşimini kullanıcının dosyasından türettik (gap 12, rotate true):
const placed = [
  [0,0],[512,0],[1024,0],[1536,0],
  [1536,512],[1024,512],[512,512],[0,512],
  [0,1024],[0,1536],[0,2048],[512,1024],[1024,1024],[1536,1024],
];
// Kullanıcının T6 bloğu: ilk parça (en sağ üst, 1536,1024) => X7 Y2027
// parça 1536..2036, 1024..1524 => +3 => 1533..2039 / 1021..1527  (X1533 değil X7?)

// Sağ-üst sıralamayı taklit et: ilk kesilen parçanın sol-alt köşesi
for (const edge of [0, 5, 7, 10, 12]) {
  const parts = placed.map(([x, y]) => ({ name: 'p', x: x + edge, y: y + edge, placedWidth: 500, placedHeight: 500 }));
  const first = parts.reduce((a, b) => ((b.y + 500) * 100000 + (b.x + 500)) > ((a.y + 500) * 100000 + (a.x + 500)) ? b : a);
  console.log(`edge=${edge}: ilk kesilen parça X${first.x} Y${first.y} -> blok X${first.x-3} Y${first.y-3}`);
}
