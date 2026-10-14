import { describe, it, expect } from 'vitest';
import { kulpBit } from './useKulpSettings.js';
import { defaultMagazine, loadTool } from '../lib/sim/toolMagazine.js';

describe('kulp bit from the magazine', () => {
  const drawn = { id: 'bk', name: 'Dia kulp', type: 'custom', dia: 50, profile: [[0, 0], [25, 19]] };

  it('a plain tool in the kulp slot (the old "T11 kulp, Ø10 düz" placeholder) does not set the size', () => {
    expect(kulpBit(defaultMagazine(), '11')).toBeNull();
  });

  it('a drawn kulp bit in the slot does', () => {
    const m = defaultMagazine();
    m.library.push(drawn);
    expect(kulpBit(loadTool(m, 11, 'bk'), '11')).toMatchObject({ type: 'custom', dia: 50 });
  });

  it('an empty slot does not', () => {
    expect(kulpBit(loadTool(defaultMagazine(), 11, null), '11')).toBeNull();
  });
});
