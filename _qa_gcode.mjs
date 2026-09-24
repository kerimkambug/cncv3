45// End-to-end check: a 1 NUMARA-style carving row (45deg V-bit, 6mm deep, offset 56)
// must reproduce the real corner-sharpen ramp in 1 NUMARA.cnc, and switching the bit
// angle must visibly change the ramp length.
import { buildKapakGcode } from './client/src/lib/gcode/kapak.js';

const base = {
  thickness: 18, spindleSpeed: 18000, safeZ: 46, toolChangeZ: 46, homeZ: 46,
  plungeFeed: 3000, cutFeed: 6000,
};

// 1 NUMARA: T1 V-bit, offset 56, depth 6. Its real ramp goes 6mm out and back.
const g45 = buildKapakGcode(292, 400, {
  ...base,
  rows: [{ toolNo: '1', depth: 6, stepOffset: 56, operation: 'carving', bitAngle: 45 }],
});
// 45deg needs 2.41x => 14.49mm out => 56 - 14.49 = 41.51
const g90 = buildKapakGcode(292, 400, {
  ...base,
  rows: [{ toolNo: '1', depth: 6, stepOffset: 56, operation: 'carving', bitAngle: 90 }],
});
// 90deg is 1:1 => 6mm out => 56 - 6 = 50 (exactly the 1_NUMARA ramp)
const carvingBlock = (g) => g.split('\n').filter((l) => /^G1|^X|^ Y/.test(l)).slice(0, 14);

console.log('=== 45deg bit (2.41x ramp) ===');
console.log(carvingBlock(g45).join('\n'));
console.log('\n=== 90deg bit (1:1 ramp, must match 1 NUMARA) ===');
console.log(carvingBlock(g90).join('\n'));

console.log('\nchecks:');
console.log('  45deg ramp corner X41.51 Y385.51 present :', g45.includes('X41.51 Y385.51 Z18.00'));
console.log('  90deg ramp corner X50.00 Y350.00 present :', g90.includes('X50.00 Y350.00 Z18.00'));
console.log('  1 NUMARA ramp (X50.00 Y350.00 Z18.00) reproduced at 90deg:', g90.includes('X50.00 Y350.00 Z18.00'));
