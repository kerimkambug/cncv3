// server/scripts/seed-numune-presets.js
//
// Seeds the kapak model presets (server/data/presets.json) into a store — e.g. a
// fresh MongoDB. Safe to run repeatedly — existing presets with the same name
// are skipped unless --force is given.
//
//   node server/scripts/seed-numune-presets.js
//
import { fileStore } from '../store/fileStore.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The presets live in ONE place: server/data/presets.json (models 1-14). This
// script used to carry its own copy of every row, which drifted (1 and 7 no
// longer matched ArtCAM) and `--force` would have written the stale copy back
// over the good presets. It now seeds exactly what presets.json says.
const PRESETS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/presets.json');

/** Preset definitions (width/height = the size the preset was verified on). */
export const NUMUNE_PRESETS = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'))
  .filter((p) => (p.module || p.category) === 'kapak')
  .map((p) => ({ ...p, width: p.previewWidth || 292, height: p.previewHeight || 400 }));

/** Store document for a definition (store-managed fields stripped). */
export function toPresetDoc(def) {
  const { _id, id, createdAt, updatedAt, width, height, ...doc } = def;
  return doc;
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
