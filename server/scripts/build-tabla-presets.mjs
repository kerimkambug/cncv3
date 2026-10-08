// build-tabla-presets.mjs
//
// Rebuilds the kapak presets of models 4 and 9-14 in server/data/presets.json
// from the TABLA panel (numuneler/TABLA MODELLERİMİZ pano şeklinde.anc + .dxf):
// these models have no per-model ArtCAM file, the panel is their only source.
// Every number below was measured on the panel door (347.5 x ~462.5); offsets
// are distances from the door edge (absolute mode). The FIRST offset of a model
// is the shop's choice per door (53 / 60 / 63 ...); what defines the model is
// what comes after it. Spindle is always S18000.
//
// It also applies the small fixes found while comparing presets 1-8 with the
// tool table (names only — their G-code matches ArtCAM and is left alone).
//
//   node server/scripts/build-tabla-presets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRESETS = path.join(ROOT, 'server/data/presets.json');
import { encodeSablonPath } from '../../client/src/lib/gcode/features.js';

// Templates are stored compactly (one "x,y,depth,ax,ay ..." string per path).
const SABLON = (n) => {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, `numuneler/tabla-sablon/model${n}.json`), 'utf8'));
  return { refWidth: t.refWidth, refHeight: t.refHeight, paths: t.paths.map(encodeSablonPath) };
};

const base = {
  category: 'kapak', module: 'kapak', imageDataUrl: '', previewWidth: 347.5, previewHeight: 462.5,
  thickness: 18, spindleSpeed: 18000, safeZ: 46, toolChangeZ: 46, homeZ: 46,
  plungeFeed: 3000, cutFeed: 6000, offsetMode: 'absolute', topStyle: 'flat', riseRatio: 0.125,
};
const off = (toolNo, offset, depth, feed, name, extra = {}) => ({
  toolNo: String(toolNo), operation: 'offset', stepOffset: offset, absoluteOffset: offset, depth, feed, name,
  roughing: false, chain: false, repeatStartY: false, ...extra,
});
const carving = (toolNo, offset, depth, bitAngle, feed, name) => ({
  toolNo: String(toolNo), operation: 'carving', stepOffset: offset, depth, bitAngle, feed, name,
});
// V-bit carving centre from the panel's outer corner box: centre = box + depth * tan(angle/2)
const carveCentre = (box, depth, angle) => +(box + depth * Math.tan((angle / 2) * Math.PI / 180)).toFixed(2);

const MODELS = {
  '4 NUMARA': {
    description: 'TABLA panosu model 4: T5 (ucu düz yuvarlayan) kapak kenarı profili + T5 derzler. '
      + 'Uzun dikey derzler kenardan kenara ~28.96 mm eşit aralıkla (kapak eni 12 eşit parça), aralarına üst yarıda '
      + 'kısa ara derzler (ara çizgi), orta yükseklikte bir yatay derz. Üstte kulp kutusu: kenardan 44.5 mm aşağıda '
      + 'yatay derz, kutunun içindeki çizgiler orada durur. (Kulp yuvasının kendisi — panoda T10 + T11 — ayrı bir iş, şimdilik yok.)',
    rows: [
      off(5, 0, 5, 10000, 'T5 kapak kenarı profili (ucu düz yuvarlayan)'),
      { toolNo: '5', operation: 'derz', depth: 5, stepOffset: 0, feed: 10000, name: 'T5 uzun dikey derz (kenardan kenara, ~28.96)',
        derz: { yon: 'dikey', margin: 0, spacing: 28.96, insideFrame: true, autoFit: true, startY: 0, overshootY: 0, respectPreviousOffset: false,
          stopBox: { fromTop: 44.5, skip: 1 } } },
      { toolNo: '5', operation: 'derz', depth: 5, stepOffset: 0, feed: 10000, name: 'T5 kısa ara derz (üst yarı) + kulp kutusu',
        derz: { yon: 'dikey', margin: 0, spacing: 28.96, stagger: true, autoFit: true, startY: 0, overshootY: 0, respectPreviousOffset: false,
          lineFromPct: 50, stopBox: { fromTop: 44.5, skip: 2, line: true } } },
      { toolNo: '5', operation: 'derz', depth: 5, stepOffset: 0, feed: 10000, name: 'T5 orta yatay derz',
        derz: { yon: 'yatay', margin: 0, count: 1, insideFrame: true, autoFit: true, overshootX: 0, respectPreviousOffset: false } },
    ],
  },
  '9 NUMARA': {
    description: 'TABLA panosu model 9: T1 90° V çerçeve 47.5 mm (2.5 mm) ve çerçevenin dikey kenarları üst/alt kenara uzatılır; '
      + 'T12 135° carving 69.3 mm (8 mm, köşeler 50 mm ye kadar keskinleşir); içinde T12 yatay derzler ~36 mm eşit aralıkla '
      + '(8 mm — 135° bıçakla yan yana oluklar).',
    rows: [
      off(1, 47.5, 2.5, 8000, 'T1 90° V çerçeve'),
      { toolNo: '1', operation: 'uzatma', stepOffset: 47.5, depth: 2.5, feed: 8000, name: 'T1 çerçeve dikey uzatma (üst/alt kenara)', uzatma: { yon: 'dikey', overshoot: 0.5 } },
      carving(12, carveCentre(50, 8, 135), 8, 135, 7000, 'T12 135° carving'),
      { toolNo: '12', operation: 'derz', depth: 8, stepOffset: 69.3, feed: 7000, name: 'T12 yatay derz (~36 mm)',
        derz: { yon: 'yatay', margin: 69.3, spacing: 36, insideFrame: true, autoFit: true, overshootX: 0, respectPreviousOffset: false } },
    ],
  },
  '10 NUMARA': {
    description: 'TABLA panosu model 10: iç içe çerçeveler. T1 90° carving 57 mm (7 mm, köşeler 50 ye), T4 58.5 mm (5 mm), '
      + 'T3 profil 60 ve 74 mm (7 mm), T6 77 mm düz + 78 mm R3 (7 mm, arayı temizler), T12 135° 81 mm (7 mm).',
    rows: [
      off(3, 60, 7, 6000, 'T3 profil (dış)'),
      off(3, 74, 7, 6000, 'T3 profil (iç)'),
      off(4, 58.5, 5, 8000, 'T4 kanal'),
      carving(1, 57, 7, 90, 8000, 'T1 90° carving'),
      off(12, 81, 7, 10000, 'T12 135° V iç çerçeve'),
      off(6, 77, 7, 6000, 'T6 temizleme'),
      off(6, 78, 7, 6000, 'T6 temizleme R3', { cornerRadius: 3 }),
    ],
  },
  '11 NUMARA': {
    description: 'TABLA panosu model 11: T4 52 mm (5 mm), T3 profil 53.5 mm (5 mm) ve 108.5 mm (6 mm), '
      + 'T12 135° carving (9 mm, köşeler 61.5 mm ye), 108.5 mm profilin içi T10 ile 6 mm taranır (iç cep).',
    rows: [
      off(3, 53.5, 5, 6000, 'T3 profil (dış)'),
      off(3, 108.5, 6, 6000, 'T3 profil (iç cep kenarı)'),
      carving(12, carveCentre(61.5, 9, 135), 9, 135, 6000, 'T12 135° carving'),
      { toolNo: '10', operation: 'tarama', stepOffset: 108.5, depth: 6, feed: 12000, name: 'T10 iç cep tarama',
        tarama: { innerOffset: 0, toolDiameter: 10, stepover: 5 } },
      off(4, 52, 5, 8000, 'T4 dış kanal'),
    ],
  },
  '12 NUMARA': {
    description: 'TABLA panosu model 12: T1 90° V çizgiler 52 ve 96.5 mm (2.5 mm), arada T12 135° carving (8.1 mm, köşeler 54.5 mm ye).',
    rows: [
      off(1, 52, 2.5, 6000, 'T1 90° V dış çizgi'),
      off(1, 96.5, 2.5, 6000, 'T1 90° V iç çizgi'),
      carving(12, carveCentre(54.5, 8.1, 135), 8.1, 135, 7000, 'T12 135° carving'),
    ],
  },
  '13 NUMARA': {
    description: 'TABLA panosu model 13: T1 90° V süsleme (2 mm) — sağ üst ve sol alt köşede süsleme, aralarında çift çizgili çerçeve kolları. '
      + 'Şablon panodaki ArtCAM yolundan alındı; süslemeler köşelerine sabit kalır, çerçeve kolları kapak boyuna göre uzar.',
    rows: [
      { toolNo: '1', operation: 'sablon', depth: 2, feed: 8000, name: 'T1 köşe süslemesi + çerçeve', sablon: SABLON(13) },
    ],
  },
  '14 NUMARA': {
    description: 'TABLA panosu model 14: T1 90° V kıvrımlı (scroll) süsleme (6 mm) — sağ üst ve sol alt kıvrımlar, '
      + 'sol üst ve sağ alt köşede ilmekli L kollar. Şablon panodaki ArtCAM yolundan alındı; kollar kapak boyuna göre uzar.',
    rows: [
      { toolNo: '1', operation: 'sablon', depth: 6, feed: 8000, name: 'T1 kıvrımlı süsleme', sablon: SABLON(14) },
    ],
  },
};

const all = JSON.parse(fs.readFileSync(PRESETS, 'utf8'));
const now = new Date().toISOString();
for (const [name, def] of Object.entries(MODELS)) {
  const i = all.findIndex((p) => p.name === name);
  const prev = i >= 0 ? all[i] : {};
  const doc = { ...base, _id: prev._id || `local_${Date.now()}_${name.replace(/\W/g, '')}`, name, ...def, createdAt: prev.createdAt || now, updatedAt: now };
  if (i >= 0) all[i] = doc; else all.push(doc);
}

// --- fixes on 1-8 (names / derz rule; G-code unchanged) ---
const fix = (name, fn) => { const p = all.find((x) => x.name === name); if (p) fn(p); };
fix('2 NUMARA', (p) => p.rows.forEach((r) => { if (/balmumu/i.test(r.name || '')) r.name = 'T2 10mm ballnose derz'; }));
for (const n of ['5 NUMARA', '6 NUMARA', '14 NUMARA', '9 NUMARA', '11 NUMARA']) {
  fix(n, (p) => p.rows.forEach((r) => { if (/20mm tabla/i.test(r.name || '')) r.name = r.name.replace(/20mm tabla/i, 'T9 tabla'); }));
}
// 3 NUMARA: the derz is "inside the 57 frame, ~13.69" — same lines on 292, right on every width.
fix('3 NUMARA', (p) => p.rows.forEach((r) => {
  if (r.operation === 'derz') Object.assign(r.derz, { margin: 57, spacing: 13.69, insideFrame: true });
}));

fs.writeFileSync(PRESETS, `${JSON.stringify(all, null, 2)}\n`);
console.log('presets updated:', Object.keys(MODELS).join(', '), '+ fixes on 2/3/5/6');
