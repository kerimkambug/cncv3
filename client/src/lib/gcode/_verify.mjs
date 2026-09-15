// Try to reproduce each sample with candidate presets and measure match.
import fs from 'fs';
import { buildKapakGcode } from './kapak.js';

const base = new URL('../../../..', import.meta.url);
const readCnc = (n) => fs.readFileSync(new URL(`numuneler/${n} NUMARA.cnc`, base), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const core = (s) => s.replace(/\s+/g, '');

const M = { thickness: 18, spindleSpeed: 18000, safeZ: 46, toolChangeZ: 46, homeZ: 46, plungeFeed: 3000, cutFeed: 5000, offsetMode: 'relative' };

const cand = {
  5: {
    ...M, rows: [
      { toolNo: '6', depth: 2, stepOffset: 53 },
      { toolNo: '9', depth: 5.8, stepOffset: 9 },
      { toolNo: '9', depth: 5.8, stepOffset: 5 },
      { toolNo: '7', depth: 4, stepOffset: 12 },
    ]
  },
  6: {
    ...M, rows: [
      { toolNo: '6', depth: 2, stepOffset: 53 },
      { toolNo: '9', depth: 5.8, stepOffset: 7 },
      { toolNo: '9', depth: 5.8, stepOffset: 5 },
      { toolNo: '11', depth: 5.8, stepOffset: 13 },
    ]
  },
  8: {
    ...M, rows: [
      { toolNo: '3', depth: 5, stepOffset: 57 },
      { toolNo: '8', depth: 5.5, stepOffset: 60 },
      { toolNo: '12', depth: 5.5, stepOffset: 8.5 },
    ]
  },
};

for (const n of [5, 6, 8]) {
  const real = readCnc(n).map(core);
  const got = buildKapakGcode(292, 400, cand[n]).split('\n').map(core).filter(Boolean);
  const realCore = real.filter((l) => !['M3S18000', 'M16', 'M30', 'M5', 'makro', 'G0Z46.00', 'X0.00Y0.00', 'M6T6', 'M6T9', 'M6T7', 'M6T11', 'M6T8', 'M6T12', 'M6T3'].includes(l));
  const gotCore = got;
  const matched = realCore.filter((l) => gotCore.includes(l));
  console.log(`${n} NUMARA: ${matched.length}/${realCore.length} coordinate lines matched`);
  const missing = realCore.filter((l) => !gotCore.includes(l)).slice(0, 8);
  if (missing.length) console.log('   missing:', missing.join(' | '));
}
