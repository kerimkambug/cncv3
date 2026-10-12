import { useMemo } from 'react';
import { useToolMagazine } from './useToolMagazine.js';
import { toSimTools } from '../lib/sim/toolMagazine.js';

/**
 * The kulp settings (Atölye → Makine → Kulp) with the bit as it is in the
 * magazine (Atölye → Bıçaklar): its widest diameter and, when it was drawn,
 * its side view (the 10 mm bit clears what it would cut flat).
 */
export function useKulpSettings(cfg) {
  const [magazine] = useToolMagazine();
  return useMemo(() => {
    const k = { ...(cfg.kulp || {}) };
    const bit = toSimTools(magazine)[Number(k.toolNo || 11)];
    if (bit && !bit.empty && bit.dia > 0) {
      k.dia = bit.dia;
      if (bit.outline) k.outline = bit.outline;
    }
    return k;
  }, [cfg.kulp, magazine]);
}
