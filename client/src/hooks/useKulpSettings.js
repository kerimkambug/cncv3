import { useMemo } from 'react';
import { useToolMagazine } from './useToolMagazine.js';
import { toSimTools } from '../lib/sim/toolMagazine.js';

/** The drawn kulp bit loaded in the kulp slot, or null (empty slot, or a plain tool there). */
export function kulpBit(magazine, toolNo) {
  const bit = toSimTools(magazine)[Number(toolNo || 11)];
  return bit && !bit.empty && bit.type === 'custom' && bit.dia > 0 ? bit : null;
}

/**
 * The kulp settings (Atölye → Makine → Kulp) with the bit as it is in the
 * magazine (Atölye → Bıçaklar): its widest diameter and its side view (the
 * 10 mm bit clears what it would cut flat).
 *
 * Only a DRAWN kulp bit may set the size. A plain tool in the slot (the old
 * "T11 kulp, Ø10 düz" placeholder) would make the paths for a 10 mm bit: in a
 * plate the real one (Ø50) would then go down beside the door — into it. With
 * no drawn bit the diameter typed in Makine → Kulp counts.
 */
export function useKulpSettings(cfg) {
  const [magazine] = useToolMagazine();
  return useMemo(() => {
    const k = { ...(cfg.kulp || {}) };
    const bit = kulpBit(magazine, k.toolNo);
    if (bit) {
      k.dia = bit.dia;
      if (bit.outline) k.outline = bit.outline;
    }
    return k;
  }, [cfg.kulp, magazine]);
}
