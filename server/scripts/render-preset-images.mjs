// Gives every kapak model a picture of ITSELF (see server/services/presetImage.js)
// and stores it in server/data/presets.json. On the online site (MongoDB) use
// Atölye → Modeller → "Görselleri yenile" instead: it works on the database.
//
//   node server/scripts/render-preset-images.mjs            → all presets
//   node server/scripts/render-preset-images.mjs "9 NUMARA" → just one
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPresetImage, simToolsFrom } from '../services/presetImage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '../data/presets.json');
// The workshop's real tools (Atölye → Bıçaklar, e.g. the T9 tabla bit drawn in
// AutoCAD); without the file the built-in tool table is used.
const TOOLS_FILE = path.join(here, '../data/bicaklar.json');
const tools = simToolsFrom(fs.existsSync(TOOLS_FILE) ? JSON.parse(fs.readFileSync(TOOLS_FILE, 'utf8')) : null);
console.log(fs.existsSync(TOOLS_FILE) ? `bıçaklar: ${path.relative(process.cwd(), TOOLS_FILE)} (T9 = ${tools[9]?.name})` : 'bıçaklar: yerleşik tablo');

const only = process.argv[2];
const presets = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let done = 0;
for (const p of presets) {
  if (only && p.name !== only) continue;
  if ((p.category || 'kapak') !== 'kapak') continue;
  const t0 = Date.now();
  const r = renderPresetImage(p, tools);
  if (!r) { console.log(`${p.name}: 300×400 üretilemedi, atlandı`); continue; }
  p.imageDataUrl = r.dataUrl;
  done++;
  console.log(`${p.name}: ${((Date.now() - t0) / 1000).toFixed(1)} sn, ${(r.cuttingMm / 1000).toFixed(1)} m kesim, görsel ${Math.round(r.dataUrl.length / 1024)} KB`);
}
fs.writeFileSync(FILE, `${JSON.stringify(presets, null, 2)}
`);
console.log(`${done} modelin görseli simülasyondan üretildi → ${path.relative(process.cwd(), FILE)}`);
