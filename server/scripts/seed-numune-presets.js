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
 * Verified against numuneler/*.cnc. `match` records how much of the real file
 * this preset reproduces (coordinate-line comparison), so the shop knows which
 * presets are byte-accurate and which are partial.
 */
export const NUMUNE_PRESETS = [
  {
    name: '1 NUMARA',
    width: 292,
    height: 400,
    description: 'Carving + düz offset. T1 V-bıçak köşe keskinleştirmesi 1_NUMARA.cnc ile doğrulandı. Derz ve rounded-köşe detayları bu preset kapsamı dışında (kısmi).',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '6', depth: 6, stepOffset: 62, name: '6mm dış offset', operation: 'offset' },
        { toolNo: '6', depth: 6, stepOffset: 59, name: '6mm dış kare', operation: 'offset' },
        { toolNo: '1', depth: 6, stepOffset: 56, name: 'Carving V-bıçak', operation: 'carving', cornerSharpen: true, cornerSharpenDistance: 6 },
      ],
    },
  },
  {
    name: '2 NUMARA',
    width: 292,
    height: 400,
    description: 'Kemerli (yarım daire) üst. 2_NUMARA.cnc ile xc=146 / r=86 / yc=254 doğrulandı. Derz eğri-üst noktaları kısmi.',
    cfg: {
      topStyle: 'semicircle',
      rows: [
        { toolNo: '9', depth: 3, stepOffset: 60, name: 'Kemer dış offset', operation: 'offset' },
        { toolNo: '9', depth: 3, stepOffset: 55, name: 'Kemer iç offset', operation: 'offset' },
      ],
    },
  },
  {
    name: '3 NUMARA',
    width: 292,
    height: 400,
    description: 'Sivri/basık kemer üst (riseRatio 0.125). 3_NUMARA.cnc G3 yayı ve derz noktası (Y327.36) ile doğrulandı.',
    cfg: {
      topStyle: 'pointed',
      riseRatio: 0.125,
      rows: [
        { toolNo: '3', depth: 5, stepOffset: 57, name: 'Sivri kemer offset', operation: 'offset' },
      ],
    },
  },
  {
    name: '5 NUMARA',
    width: 292,
    height: 400,
    description: 'Çoklu düz offset (T6 / T9 / T9 / T7). 5_NUMARA.cnc koordinatları ile tam eşleşti.',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '6', depth: 2, stepOffset: 53, name: '6mm dış', operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 67, name: '20mm tabla', operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 62, name: '20mm tabla', operation: 'offset' },
        { toolNo: '7', depth: 4, stepOffset: 74, name: '30mm yuvarlama', operation: 'offset' },
      ],
    },
  },
  {
    name: '6 NUMARA',
    width: 292,
    height: 400,
    description: 'Çoklu düz offset (T6 / T9 / T9 / T11). 6_NUMARA.cnc koordinatları ile tam eşleşti.',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '6', depth: 2, stepOffset: 53, name: '6mm dış', operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 65, name: '20mm tabla', operation: 'offset' },
        { toolNo: '9', depth: 5.8, stepOffset: 62, name: '20mm tabla', operation: 'offset' },
        { toolNo: '11', depth: 5.8, stepOffset: 75, name: 'iç offset', operation: 'offset' },
      ],
    },
  },
  {
    name: '7 NUMARA',
    width: 292,
    height: 400,
    description: 'Çoklu iç halka (135° T12) + dış T6. 7_NUMARA.cnc ile kısmen doğrulandı (iç halka başlangıç noktaları kısmi).',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '12', depth: 5, stepOffset: 139.1, name: '135° iç halka 1', operation: 'offset' },
        { toolNo: '12', depth: 5, stepOffset: 115.4, name: '135° halka 2', operation: 'offset' },
        { toolNo: '12', depth: 5, stepOffset: 91.7, name: '135° halka 3', operation: 'offset' },
        { toolNo: '12', depth: 5, stepOffset: 68, name: '135° halka 4', operation: 'offset' },
        { toolNo: '6', depth: 5, stepOffset: 53, name: '6mm dış', operation: 'offset' },
      ],
    },
  },
  {
    name: '8 NUMARA',
    width: 292,
    height: 400,
    description: 'Yuvarlak köşe (rounded-corner) offset içerir. Bu motor rounded-corner G2/G3 üretmediği için kısmi; düz offsetler doğru.',
    cfg: {
      topStyle: 'flat',
      rows: [
        { toolNo: '3', depth: 5, stepOffset: 57, name: 'düz dış offset', operation: 'offset' },
        { toolNo: '8', depth: 5.5, stepOffset: 60, name: 'yuvarlak köşe offset', operation: 'offset' },
        { toolNo: '12', depth: 5.5, stepOffset: 68.5, name: '135° iç', operation: 'offset' },
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

/** Seeds every sample preset that is not already present (matched by name). */
export async function seedNumunePresets(store = fileStore) {
  const existing = await store.list('kapak');
  const existingNames = new Set(existing.map((p) => p.name));
  let added = 0;
  let skipped = 0;
  for (const def of NUMUNE_PRESETS) {
    if (existingNames.has(def.name)) { skipped++; continue; }
    await store.create(toPresetDoc(def));
    existingNames.add(def.name);
    added++;
  }
  return { added, skipped, total: NUMUNE_PRESETS.length };
}

// Allow running directly: `node server/scripts/seed-numune-presets.js`
const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/seed-numune-presets.js');
if (invokedDirectly) {
  seedNumunePresets()
    .then(({ added, skipped, total }) => {
      console.log(`[seed] numune presets: +${added} added, ${skipped} already present (${total} total).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed] failed:', err.message);
      process.exit(1);
    });
}
