// server/scripts/seed-numune-presets.js
//
// Seeds the sample models in /numuneler as Kapak presets. Each preset's `rows`
// geometry was derived from the matching real production file and verified
// against it with buildKapakGcode (coordinate/token comparison). Safe to run
// repeatedly — existing presets with the same name are skipped.
//
//   node server/scripts/seed-numune-presets.js
//
import { fileStore } from '../store/fileStore.js';

/** Machine config shared by the samples (safeZ/toolZ from the real files). */
const M = {
  thickness: 18,
  spindleSpeed: 18000,
  safeZ: 46,
  toolChangeZ: 46,
  homeZ: 46,
  plungeFeed: 3000,
  cutFeed: 5000,
  offsetMode: 'absolute',
  category: 'kapak',
};

/**
 * Verified against numuneler/*.cnc with server/scripts/compare-numuneler-geom.mjs
 * (modal-state simulation: cutting moves + feeds compared). Current status:
 *   ALL 7 presets -> geometric match (52/16/32/20/20/25/20 cutting moves).
 *
 * 1 NUMARA note: its plain 70 mm finishing rectangle is declared AFTER the T1
 * carving row on purpose — ArtCAM cuts it after the V-bit run (1_NUMARA.cnc lines
 * 57-63), and buildKapakGcode emits post-carving offset rows in a trailing phase.
 */
export const NUMUNE_PRESETS = [
  {
    name: '1 NUMARA',
    width: 292,
    height: 400,
    description: 'Carving + düz offset + derz. T1 V-bıçak köşe keskinleştirmesi doğrulandı. Derz: X çizgileri 89/108/127/146/165/184/203 (eşit 19mm aralık) — 1_NUMARA.cnc ile birebir. kaba boşaltma pasoları (abs 62/59, r4/r2) ve derz başlangıç Y değeri (70 = çerçeve offseti) doğrulandı.',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '6', depth: 6, stepOffset: 62, absoluteOffset: 62, name: '6mm kaba boşaltma (dış, dik köşe)', operation: 'offset', roughing: true },
        { toolNo: '6', depth: 6, stepOffset: 59, absoluteOffset: 59, chain: true, name: '6mm kaba boşaltma (iç, dik köşe)', operation: 'offset', roughing: true },
        { toolNo: '6', depth: 6, stepOffset: 70, absoluteOffset: 64, cornerRadius: 6, name: '6mm dış rounded offset', operation: 'offset' },
        { toolNo: '6', depth: 6, stepOffset: 70, absoluteOffset: 67, cornerRadius: 3, chain: true, name: '6mm iç rounded offset', operation: 'offset' },
        { toolNo: '1', depth: 6, stepOffset: 56, feed: 6000, name: 'Carving V-bıçak (90° = kenara 45°)', operation: 'carving', bitAngle: 90 },
        { toolNo: '6', depth: 6, stepOffset: 70, absoluteOffset: 70, feed: 6000, name: 'düz bitirme pası (carving sonrası)', operation: 'offset' },
        { toolNo: '1', depth: 3, stepOffset: 89, feed: 6000, name: '135° derz', operation: 'derz', derz: { yon: 'dikey', margin: 89, spacing: 19, autoFit: true, overshootY: 0, startY: 70, respectPreviousOffset: false } },
      ],
    },
  },
  {
    name: '2 NUMARA',
    width: 292,
    height: 400,
    description: 'Kemerli (yarım daire) üst + derz. 2_NUMARA.cnc ile xc=146 / r=86 / yc=254 doğrulandı. Derz: X çizgileri 60/90.67/121.33/152 (eşit 30.667mm aralık). Derz üst ucu kemer eğrisini takip eder (curve.yEnd), dosyadaki gibi Y326.66/338.62 noktalarında biter.',
    cfg: {
      topStyle: 'semicircle',
      rows: [
        { toolNo: '9', depth: 3, stepOffset: 60, name: 'Kemer dış offset', operation: 'offset' },
        { toolNo: '9', depth: 3, stepOffset: 55, name: 'Kemer iç offset', operation: 'offset' },
        { toolNo: '2', depth: 2, stepOffset: 100, feed: 7000, name: '10mm balmumu derz', operation: 'derz', derz: { yon: 'dikey', margin: 100, spacing: 30, autoFit: true, overshootY: 0, respectPreviousOffset: false, spindleSpeed: 15000 } },
      ],
    },
  },
  {
    name: '3 NUMARA',
    width: 292,
    height: 400,
    description: 'Sivri/basık kemer üst (riseRatio 0.125) + derz. 3_NUMARA.cnc G3 yayı ve derz bitiş noktası (Y327.36) doğrulandı. Derz: X çizgileri 70.69/84.38/... eşit 13.69mm aralık; çizgiler alttan dış çerçeve offsetinden (Y57) başlar ve kemer eğrisini takip ederek Y327.36/332.68/336.83 noktalarında biter.',
    cfg: {
      topStyle: 'pointed',
      riseRatio: 0.125,
      rows: [
        { toolNo: '3', depth: 5, stepOffset: 57, feed: 8000, absoluteOffset: 57, name: 'Dış çerçeve (üstü kavisli)', operation: 'offset' },
        { toolNo: '3', depth: 5, stepOffset: 70.69, feed: 8000, name: 'Sivri kemer derz', operation: 'derz', derz: { yon: 'dikey', margin: 70.69, spacing: 13.69, autoFit: true, overshootY: 0, respectPreviousOffset: false } },
      ],
    },
  },
  {
    name: '5 NUMARA',
    width: 292,
    height: 400,
    description: 'Çoklu düz offset (T6 / T9 / T9 / T7). 5_NUMARA.cnc koordinatları ve bıçak-başı feed (T7→F10000) ile tam eşleşti.',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '6', depth: 2, stepOffset: 53, name: '6mm dış', operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 67, name: '20mm tabla', operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 62, name: '20mm tabla', operation: 'offset' },
        { toolNo: '7', depth: 4, stepOffset: 74, feed: 10000, name: '30mm yuvarlama', operation: 'offset' },
      ],
    },
  },
  {
    name: '6 NUMARA',
    width: 292,
    height: 400,
    description: 'Çoklu düz offset (T6 / T9 / T9 / T11). 6_NUMARA.cnc koordinatları ve bıçak-başı feed (T11→F8000) ile tam eşleşti.',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '6', depth: 2, stepOffset: 53, name: '6mm dış', operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 65, name: '20mm tabla', operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 62, name: '20mm tabla', operation: 'offset' },
        { toolNo: '11', depth: 5.8, stepOffset: 75, feed: 8000, name: 'iç offset', operation: 'offset' },
      ],
    },
  },
  {
    name: '7 NUMARA',
    width: 292,
    height: 400,
    description: 'Çoklu iç halka (135° T12) + dış T6. 7_NUMARA.cnc ile doğrulandı (iç halka başlangıç noktaları + bıçak-başı feed T12→F9000).',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '12', depth: 5, stepOffset: 139.1, feed: 9000, name: '135° iç halka 1', operation: 'offset' },
        { toolNo: '12', depth: 5, stepOffset: 115.4, feed: 9000, chain: true, name: '135° halka 2', operation: 'offset' },
        { toolNo: '12', depth: 5, stepOffset: 91.7, feed: 9000, chain: true, name: '135° halka 3', operation: 'offset' },
        { toolNo: '12', depth: 5, stepOffset: 68, feed: 9000, chain: true, name: '135° halka 4', operation: 'offset' },
        { toolNo: '6', depth: 5, stepOffset: 53, name: '6mm dış', operation: 'offset' },
      ],
    },
  },
  {
    name: '8 NUMARA',
    width: 292,
    height: 400,
    description: 'Rounded-corner (G2 köşe yaylı) T8 offset + düz T3/T12. 8_NUMARA.cnc köşe yayları doğrulandı (I4J0 / I0J-4 / I-4J-0). DİKKAT: dosyadaki BL köşesi bir yuvarlatma yayı değil, ArtCAM\'in 45° teğetsel dalış (lead-in/lead-out) rampasıdır (R=4.002, merkez köşe çemberinde değil); bu motor yerine temiz 90° köşe yayı üretir — tezgâhta geometrik olarak eşdeğer ve daha pürüzsüzdür. Bıçak-başı feed (T3→F8000, T8/T12→F9000).',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '3', depth: 5, stepOffset: 57, feed: 8000, name: 'düz dış offset', operation: 'offset' },
        { toolNo: '8', depth: 5.5, stepOffset: 60, feed: 9000, name: 'düz kaba offset', operation: 'offset' },
        { toolNo: '8', depth: 5.5, stepOffset: 64.5, cornerRadius: 4, feed: 9000, name: 'yuvarlak köşe offset', operation: 'offset' },
        { toolNo: '12', depth: 5.5, stepOffset: 68.5, feed: 9000, name: '135° iç', operation: 'offset' },
      ],
    },
  },
];

/** Turns a seed definition into the preset document shape. */
export function toPresetDoc(def) {
  const cfg = def.cfg || {};
  return {
    name: def.name,
    module: 'kapak',
    category: 'kapak',
    imageDataUrl: '',
    description: def.description || '',
    previewWidth: def.width,
    previewHeight: def.height,
    thickness: cfg.thickness ?? M.thickness,
    spindleSpeed: cfg.spindleSpeed ?? M.spindleSpeed,
    safeZ: cfg.safeZ ?? M.safeZ,
    toolChangeZ: cfg.toolChangeZ ?? M.toolChangeZ,
    homeZ: cfg.homeZ ?? M.homeZ,
    plungeFeed: cfg.plungeFeed ?? M.plungeFeed,
    cutFeed: cfg.cutFeed ?? M.cutFeed,
    offsetMode: cfg.offsetMode ?? M.offsetMode,
    topStyle: cfg.topStyle || 'flat',
    riseRatio: cfg.riseRatio ?? 0.125,
    rows: cfg.rows || [],
  };
}

/**
 * Seeds the sample presets. By default a preset that already exists (matched by
 * name) is left untouched; pass { force: true } to overwrite existing presets
 * with the current definition (used after the sample geometry was refined).
 */
export async function seedNumunePresets(store = fileStore, { force = false } = {}) {
  const existing = await store.list('kapak');
  const existingByName = new Map(existing.map((p) => [p.name, p]));
  let added = 0;
  let skipped = 0;
  let updated = 0;
  for (const def of NUMUNE_PRESETS) {
    const prev = existingByName.get(def.name);
    if (prev && !force) { skipped++; continue; }
    if (prev) {
      await store.update(prev._id || prev.id, toPresetDoc(def));
      updated++;
    } else {
      await store.create(toPresetDoc(def));
      added++;
    }
  }
  return { added, updated, skipped, total: NUMUNE_PRESETS.length };
}

// Allow running directly: `node server/scripts/seed-numune-presets.js [--force]`
const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/seed-numune-presets.js');
if (invokedDirectly) {
  const force = process.argv.includes('--force');
  seedNumunePresets(fileStore, { force })
    .then(({ added, updated, skipped, total }) => {
      console.log(`[seed] numune presets: +${added} added, ${updated} updated, ${skipped} skipped (${total} total).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed] failed:', err.message);
      process.exit(1);
    });
}
