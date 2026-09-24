// reliefGcode.test.js
// Plain-node unit tests for the server-side relief G-code service
// (node server/services/reliefGcode.test.js).
import assert from 'node:assert/strict';
import { generateReliefGcodeFromGrid } from './reliefGcode.js';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}

const baseCfg = {
  width: 100, height: 80, thickness: 18, maxDepth: 5,
  stepover: 10, cutFeed: 4500, plungeFeed: 1500, safeZ: 25, homeZ: 60,
  toolNo: 1, spindleSpeed: 18000,
};

// 3x3 flat grid: every point full depth (ratio 1 -> z = 18 - 5 = 13)
const flatGrid = [
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
];

// --- grid validation ---
check('empty grid throws TypeError', assert.throws(() => generateReliefGcodeFromGrid([], baseCfg), TypeError));
check('ragged rows throw TypeError', assert.throws(() => generateReliefGcodeFromGrid([[1, 1], [1]], baseCfg), TypeError));
check('non-numeric values throw TypeError', assert.throws(() => generateReliefGcodeFromGrid([[1, 'x'], [1, 1]], baseCfg), TypeError));

// --- program structure ---
const g = generateReliefGcodeFromGrid(flatGrid, baseCfg);
const lines = g.split('\n');
check('program starts with the makro banner', lines[0] === 'makro');
check('tool and spindle are declared once up front', lines.some((l) => l === 'M6T1') && lines.some((l) => l === 'M3 S18000'));
check('program ends with M30', lines[lines.length - 1] === 'M30');
check('flat grid: cutting Z is thickness - maxDepth (13.000)', g.includes('Z13.000'));
check('flat grid: first plunge is G1 at the plunge feed', g.includes('G1 Z13.000 F1500.0'));

// --- serpentine raster along X (default) ---
// Row 0 (y=0): x 0 -> 50 -> 100; row 1 reverses: 100 -> 0; row 2: 0 -> 100.
check('raster X: first cut move goes along +X at y=0.00', g.includes('G1 X50.00 Y0.00 Z13.000'));
check('raster X: right edge of row 0 reached', g.includes('G1 X100.00 Y0.00 Z13.000'));
check('raster X: serpentine reversal visits (0.00, 40.00)', g.includes('G1 X0.00 Y40.00 Z13.000'));
check('raster X: last pass ends at the far right of the bottom row', g.includes('G1 X100.00 Y80.00 Z13.000'));

// --- raster along Y (direction: 'y') sweeps along rows, steps across X ---
const gY = generateReliefGcodeFromGrid(flatGrid, { ...baseCfg, direction: 'y' });
check('raster Y: first cut move goes along +Y at x=0.00', gY.includes('G1 X0.00 Y40.00 Z13.000'));
check('raster Y: full sweep of column 0', gY.includes('G1 X0.00 Y80.00 Z13.000'));
check('raster Y: serpentine visits the top of column 1 (y=80)', gY.includes('G1 X50.00 Y80.00 Z13.000'));
check('raster Y: last pass ends at the far right column bottom', gY.includes('G1 X100.00 Y0.00 Z13.000'));

// --- depth ratio maps to Z ---
const rampGrid = [[0, 1]];
const gRamp = generateReliefGcodeFromGrid(rampGrid, { ...baseCfg, width: 100, height: 10, stepover: 100 });
check('depth ratio 0 -> z = thickness (18.000)', gRamp.includes('Z18.000'));
check('depth ratio 1 -> z = thickness - maxDepth (13.000)', gRamp.includes('Z13.000'));

// --- outer cut emission ---
const gOuter = generateReliefGcodeFromGrid(flatGrid, { ...baseCfg, enableOuterCut: true, outerCutToolNo: 6, outerCutDia: 6 });
check('outer cut: tool 6 is selected after the raster', gOuter.includes('M6T6'));
check('outer cut: spindle restarted for the second tool', gOuter.indexOf('M6T6') < gOuter.lastIndexOf('M3 S18000'));
check('outer cut: the rectangle profile is emitted (profile corners at -3/+103)', gOuter.includes('X-3.00 Y-3.00'));
const gNoOuter = generateReliefGcodeFromGrid(flatGrid, baseCfg);
check('no outer cut by default: no M6T6', !gNoOuter.includes('M6T6'));

console.log(failures === 0 ? '\nAll reliefGcode tests passed.' : `\n${failures} reliefGcode test(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
