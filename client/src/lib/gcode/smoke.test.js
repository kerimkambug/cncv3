// smoke.test.js
// Regression tests against REAL production g-code we validated together
// (M6T redundancy skip, circle center offset, derz auto-fit, cam kesim/
// tarama coordinates, panjur blade math, offset-mode switching). Run with:
//   cd client/src/lib/gcode && node smoke.test.js
// (needs clipper-lib installed — it already is if you ran `npm install`
// in client/).
import { buildKapakGcode, validateKapakSize } from './kapak.js';
import { resolveCircleParams } from './circle.js';
import { computeDerzPositions } from './derz.js';
import { camComputeOpenings, buildCamKesimGcode } from './cam.js';
import { camBuildTaramaRings } from './camTarama.js';
import { calculateNesting } from './nesting.js';

let failures = 0;
function check(label, cond) {
  if (!cond) { console.log('FAIL:', label); failures++; }
  else console.log('ok  :', label);
}

// --- Kapak: Model 1 preset, T9->T9 consecutive should skip M6T/M3/M5 between them ---
const model1Cfg = {
  thickness: 18, spindleSpeed: 18000, safeZ: 61, toolChangeZ: 96, homeZ: 96,
  plungeFeed: 3000, cutFeed: 6000,
  rows: [
    { toolNo: 7, depth: 2.5, stepOffset: 52, name: '30mm yuvarlama' },
    { toolNo: 2, depth: 2, stepOffset: 16, name: '10mm balmumu' },
    { toolNo: 9, depth: 5.5, stepOffset: 9, name: '20mm tabla' },
    { toolNo: 9, depth: 5.5, stepOffset: 8, name: '20mm tabla' },
    { toolNo: 12, depth: 5.5, stepOffset: 5, name: '135 bicak' },
  ],
};
const g = buildKapakGcode(500, 500, model1Cfg);
check('kapak: T7 offset 52 -> X52.00', g.includes('X52.00 Y52.00'));
check('kapak: T9->T9 has no redundant M6T9 in between', (() => {
  const lines = g.split('\n');
  const t9idx = lines.findIndex((l) => l === 'M6T9');
  const afterFirstT9Block = lines.slice(t9idx + 1);
  const secondM6T9 = afterFirstT9Block.findIndex((l) => l === 'M6T9');
  const nextX = afterFirstT9Block.findIndex((l) => l.startsWith('G0 X85.00'));
  // second M6T9 should NOT appear before the X85 (2nd T9 pass) line
  return secondM6T9 === -1 || secondM6T9 > nextX;
})());

// --- Kapak: mixed offset + derz preset is emitted as one program ---
const mixedPreset = buildKapakGcode(500, 500, {
  ...model1Cfg,
  rows: [
    { toolNo: '7', depth: 2.5, stepOffset: 53, operation: 'offset' },
    { toolNo: '12', depth: 2, stepOffset: 60, operation: 'derz', derz: { yon: 'dikey', margin: 9, spacing: 60, autoFit: true, overshoot: 1 } },
  ],
});
check('kapak mixed: offset path is emitted', mixedPreset.includes('M6T7') && mixedPreset.includes('X53.00 Y53.00'));
check('kapak mixed: derz tool and depth are emitted', mixedPreset.includes('M6T12') && mixedPreset.includes('Z16.00'));
check('kapak mixed: derz respects preceding 53mm offset', mixedPreset.includes('Y53.00') && mixedPreset.includes('Y447.00') && !mixedPreset.includes('Y-1.00'));
const mixedOverflow = buildKapakGcode(500, 500, {
  ...model1Cfg,
  rows: [
    { toolNo: '7', depth: 2.5, stepOffset: 53, operation: 'offset' },
    { toolNo: '12', depth: 2, stepOffset: 60, operation: 'derz', derz: { yon: 'dikey', margin: 0, spacing: 60, autoFit: true, overshootY: 5, overshootX: 2 } },
  ],
});
check('kapak mixed: derz Y overflow follows 5mm setting', mixedOverflow.includes('Y48.00') && mixedOverflow.includes('Y452.00'));

// --- Circle: center must not double-count tool radius ---
const circleP = { mode: 'solid', outerDia: 500, left: 0, bottom: 0, toolDia: 6, toolNo: 6, depth: 18 };
const cr = resolveCircleParams(circleP);
check('circle: center at 250,250 (not 253,253)', cr.centerX === 250 && cr.centerY === 250);
check('circle: outerR = 253', cr.outerR === 253);

// --- Derz: 50mm panel, 12mm spacing auto-fits to 12.5mm, no overshoot past edge ---
const derz = computeDerzPositions({ width: 50, height: 50, yon: 'dikey', margin: 0, spacing: 12, edgeExtra: 0, autoFit: true });
check('derz: auto-fit spacing = 12.5', Math.abs(derz.exactSpacing - 12.5) < 1e-9);
check('derz: last position exactly 50 (no overshoot past edge)', derz.positions[derz.positions.length - 1] === 50);

// --- Derz: real production match (margin=0, edgeExtra=1, spacing=7 on 500mm) ---
const derz2 = computeDerzPositions({ width: 500, height: 500, yon: 'dikey', margin: 0, spacing: 7, edgeExtra: 1, autoFit: true });
check('derz: 73 lines matching real file', derz2.positions.length === 73);
check('derz: first line at -1 matching real file', derz2.positions[0] === -1);
check('derz: last line at 501 matching real file', derz2.positions[derz2.positions.length - 1] === 501);

// --- Cam: 4-goz kesim matches real production file exactly ---
const camCfg = { width: 500, height: 1000, gozSayisi: 4, kolonSayisi: 2, disMargin: 50, icerGap: 20, toolDia: 6, kesimToolNo: 6, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 5000, safeZ: 61, homeZ: 96 };
const { openings } = camComputeOpenings(camCfg);
check('cam: 4 openings computed', openings.length === 4);
check('cam: opening[0] nominal X50-240', openings[0].x1 === 50 && openings[0].x2 === 240);
const kesimG = buildCamKesimGcode(camCfg);
check('cam kesim: toolpath X53.000 matches real file (50+3 toolR)', kesimG.includes('X53.000'));

// --- Cam tarama: outer ledge matches real file (43 = (50-10)+3) ---
const taramaCfg = { ...camCfg, oturmaPayi: 10, stepover: 3 };
const rings = camBuildTaramaRings(taramaCfg);
const allX = rings[0].map((p) => p.x);
check('cam tarama: first ring touches X=43 (outer ledge)', Math.min(...allX) === 43);

// --- Nesting: basic pack of 2 identical parts on one plate ---
const nestResult = calculateNesting({
  plateW: 1220, plateH: 2440, edge: 10, gap: 5, rotate: true,
  parts: [
    { name: 'A', width: 500, height: 500, qty: 1 },
    { name: 'B', width: 500, height: 500, qty: 1 },
  ],
});
check('nesting: both parts placed on 1 plate', nestResult.plates.length === 1 && nestResult.plates[0].parts.length === 2);

// --- Panjur: matches real file structure and blade math ---
const { buildPanjurGcode, panjurGroups, generatePanjurGcode } = await import('./panjur.js');
const panjurResult = buildPanjurGcode({
  xStart: 750, xEnd: 997.5, startY: 55.349, bladeHeight: 40.278, bladeCount: 2,
  yStep: 0.469, zTop: 17.937, zBottom: 3.105, safeZ: 30, toolNo: 14, spindleSpeed: 12000, cutFeed: 20000,
});
check('panjur: 86 steps per blade (matches real file)', panjurResult.stepsPerBlade === 86);
check('panjur: starts with N5 G0 X750. Y55.349 (matches real file)', panjurResult.gcode.includes('N5 G0 X750. Y55.349'));
check('panjur: N8 G1 X997.5 F20000 (matches real file)', panjurResult.gcode.includes('N8 G1 X997.5 F20000'));
check('panjur: ends with %% wrapper and M30', panjurResult.gcode.trim().endsWith('%') && panjurResult.gcode.includes('M30'));

// --- Panjur: 1708.html automatic group calculation & G-code engine ---
const panjurCfg = {
  width: 200, height: 200, offset: 60, offsetMode: 'normal',
  offsetLeft: 60, offsetRight: 60, offsetBottom: 60, offsetTop: 60, centerFlat: 0,
  direction: 'y', pitch: 40.5, exitGap: 0.45, stepover: 0.468,
  startZ: 17.937, endZ: 3.105, feed: 20000, plunge: 3000, toolNo: '14',
  spindle: 12000, groundEntry: true, exitCut: 4, t4Z: 0, drillTool: '4',
  drillSpindle: 12000, exitToolDia: 4, t14TipDia: 2, t14BodyDia: 12, t14Height: 65,
  safeZ: 30, toolChangeZ: 30, homeZ: 30,
};
const pGroups = panjurGroups(panjurCfg);
check('panjur 1708: 2 groups computed for 200x200 door', pGroups.groups.length === 2);
const pAutoGcode = generatePanjurGcode(panjurCfg);
check('panjur 1708: G-code contains M6T14 and M6T4 ground entry', pAutoGcode.gcode.includes('M6T14') && pAutoGcode.gcode.includes('M6T4'));
check('panjur 1708: G-code contains G54 and O2000', pAutoGcode.gcode.includes('O2000') && pAutoGcode.gcode.includes('G54'));

// --- offsetMode: absolute mode uses each row's stepOffset directly, not cumulative ---
const { computeCumOffsets } = await import('./common.js');
const absCums = computeCumOffsets([{ stepOffset: 10 }, { stepOffset: 20 }, { stepOffset: 15 }], 'absolute');
check('offsetMode absolute: [10,20,15] stays [10,20,15] (not cumulative)', JSON.stringify(absCums) === JSON.stringify([10, 20, 15]));
const relCums = computeCumOffsets([{ stepOffset: 10 }, { stepOffset: 20 }, { stepOffset: 15 }], 'relative');
check('offsetMode relative: [10,20,15] becomes cumulative [10,30,45]', JSON.stringify(relCums) === JSON.stringify([10, 30, 45]));

// --- nesting import parser ---
const { parseNestImportText, buildNestingPlateGcode, buildNestingPlateDxf } = await import('./nesting.js');
const importResult = parseNestImportText('500-454-2\nKapak,300,600,3\n#yorum satırı\nbozuk satır');
check('nest import: legacy TXT + CSV both parsed', importResult.parts.length === 2 && importResult.parts[0].qty === 2 && importResult.parts[1].name === 'Kapak');
check('nest import: invalid line reported as error', importResult.errors.length === 1);

// --- nesting 3-stage outer cut: Stage 1 (1.5mm pre-cut), Stage 2 (profiling), Stage 3 (Z0 final cut) ---
const { orderPartsVacuumSafeFinalCut, orderPartsTopRightToLeft } = await import('./nesting.js');
const testParts = [
  { name: 'SolAlt', x: 10, y: 10, placedWidth: 500, placedHeight: 500 },
  { name: 'SagUst', x: 600, y: 600, placedWidth: 500, placedHeight: 500 },
  { name: 'SolUst', x: 10, y: 600, placedWidth: 500, placedHeight: 500 },
  { name: 'SagAlt', x: 600, y: 10, placedWidth: 500, placedHeight: 500 },
];
const sortedParts = orderPartsVacuumSafeFinalCut(testParts, 2440, 1220);
check('vacuum-safe final cut: Top-Right first', sortedParts[0].name === 'SagUst');
check('vacuum-safe final cut: Top-Left second', sortedParts[1].name === 'SolUst');
check('vacuum-safe final cut: Bottom-Right third', sortedParts[2].name === 'SagAlt');
check('vacuum-safe final cut: Bottom-Left fourth', sortedParts[3].name === 'SolAlt');

const camNestPlate = {
  number: 1,
  width: 2440,
  height: 1220,
  parts: testParts,
};
const camNestCfg = {
  rows: [{ toolNo: '7', depth: 2.5, stepOffset: 52 }],
  thickness: 18,
  spindleSpeed: 18000,
  plungeFeed: 3000,
  cutFeed: 6000,
  safeZ: 61,
  toolChangeZ: 96,
  homeZ: 96,
  enableOuterCut: true,
  cutToolNo: '6',
  cutToolDia: 6,
  preCutDepth: 1.5,
};
const camNestGcode = buildNestingPlateGcode(camNestPlate, camNestCfg);
check('nest 3-stage: Stage 1 (M6T6 pre-cut 1.5mm -> Z16.50)', camNestGcode.includes('M6T6') && camNestGcode.includes('Z16.50'));
check('nest 3-stage: Stage 2 (M6T7 profiling)', camNestGcode.includes('M6T7') && camNestGcode.includes('Z15.50'));
check('nest 3-stage: Stage 3 (M6T6 final cut -> Z0.00)', camNestGcode.includes('Z0.00'));
check('nest 3-stage: 6mm tool cuts 3mm outside (SagUst X600+500+3 = X1103.00)', camNestGcode.includes('X1103.00'));

// --- nesting DXF export generation ---
const camNestDxf = buildNestingPlateDxf(camNestPlate, camNestCfg);
check('nest DXF: valid ASCII DXF header & footer', camNestDxf.startsWith('0\nSECTION') && camNestDxf.endsWith('\n0\nEOF'));
check('nest DXF: includes 0_PLAKA layer', camNestDxf.includes('0_PLAKA'));
check('nest DXF: includes 1_PARCALAR and 2_ETIKETLER', camNestDxf.includes('1_PARCALAR') && camNestDxf.includes('2_ETIKETLER'));
check('nest DXF: includes 3_DIS_KESIM_T6 and 4_ISLEME_T7', camNestDxf.includes('3_DIS_KESIM_T6') && camNestDxf.includes('4_ISLEME_T7'));

// --- adaptive offset calculation for narrow parts (symmetric S0-only flex) ---
const { calculateAdaptiveOffsets } = await import('./kapak.js');
const standardRows = [
  { toolNo: '7', depth: 2.5, stepOffset: 53, name: 'yuvarlama' },
  { toolNo: '2', depth: 2.0, stepOffset: 16, name: 'balmumu' },
  { toolNo: '9', depth: 5.5, stepOffset: 9, name: 'tabla 1' },
  { toolNo: '9', depth: 5.5, stepOffset: 8, name: 'tabla 2' },
  { toolNo: '12', depth: 5.5, stepOffset: 5, name: '135 bıçak' },
];
// nominal cumulative: 53 -> 69 -> 78 -> 86 -> 91 (innerCum relative to row0: 0,16,25,33,38)

// Test 1: Büyük 500x500 parçada tüm offsetler nominal (53->69->78->86->91) ve simetrik kalmalı
const bigOffsets = calculateAdaptiveOffsets(500, 500, standardRows);
check('adaptive large: 500x500 leftOffset row 0 is 53', bigOffsets[0].leftOffset === 53);
check('adaptive large: 500x500 rightOffset row 0 is 53 (symmetric)', bigOffsets[0].rightOffset === 53);
check('adaptive large: 500x500 leftOffset row 1 is 69 (53+16)', bigOffsets[1].leftOffset === 69);
check('adaptive large: 500x500 all rows fit (!skipped)', bigOffsets.every((r) => !r.skipped));

// Test 2: 180x500 dar parçada X ekseni S0 52'ye küçülür (SİMETRİK: sol=sağ=52),
// iç adımlar (16,9,8,5) hiç değişmez, Y ekseni (500, geniş) nominal 53'te kalır.
// maxAllowedS0 = 180/2 - 38(lastInnerCum) = 52. En içteki (135° bıçak) span=0 -> skip.
const narrow180 = calculateAdaptiveOffsets(180, 500, standardRows);
check('adaptive narrow 180: leftOffset row 0 shrinks to 52 (not asymmetric 43)', narrow180[0].leftOffset === 52);
check('adaptive narrow 180: rightOffset row 0 SYMMETRIC, also 52 (not 53)', narrow180[0].rightOffset === 52);
check('adaptive narrow 180: Y axis (height=500, wide) stays nominal 53', narrow180[0].bottomOffset === 53 && narrow180[0].topOffset === 53);
check('adaptive narrow 180: leftOffset row 1 is 68 (52+16), symmetric with right', narrow180[1].leftOffset === 68 && narrow180[1].rightOffset === 68);
check('adaptive narrow 180: rows 0-3 fit (inner deltas preserved exactly)', narrow180.slice(0, 4).every((r) => !r.skipped));
check('adaptive narrow 180: innermost (135° bıçak) skipped — zero span left, no crash', narrow180[4].skipped === true);

// Test 3: 150x500 — X ekseni daha da dar. Yeni algoritma S0'ı 37'ye küçültüyor,
// bu sayede SADECE en içteki bıçak atlanıyor (eski asimetrik algoritma 2 bıçak atlıyordu).
const narrow150 = calculateAdaptiveOffsets(150, 500, standardRows);
check('adaptive narrow 150: S0 adapts to 37 (150/2 - 38)', narrow150[0].leftOffset === 37 && narrow150[0].rightOffset === 37);
check('adaptive narrow 150: row 0 fits (span 76)', !narrow150[0].skipped);
check('adaptive narrow 150: row 1 fits (span 44)', !narrow150[1].skipped);
check('adaptive narrow 150: row 2 fits (span 26)', !narrow150[2].skipped);
check('adaptive narrow 150: row 3 fits (span 10) — improved vs old asymmetric algorithm', !narrow150[3].skipped);
check('adaptive narrow 150: only row 4 (innermost) skipped (span 0)', narrow150[4].skipped);

// Test 5: X ve Y bağımsız — 180 genişlik x 500 yükseklikte X küçülürken Y aynen 53 kalmalı (yukarıda doğrulandı)
// Test 6: Karşılıklı simetri her koşulda korunmalı
check('adaptive symmetry: left always equals right, every row, every width', [500, 300, 180, 150, 120].every((w) => {
  return calculateAdaptiveOffsets(w, 500, standardRows).every((r) => r.leftOffset === r.rightOffset);
}));
check('adaptive symmetry: bottom always equals top, every row, every height', [500, 300, 180, 150, 120].every((h) => {
  return calculateAdaptiveOffsets(500, h, standardRows).every((r) => r.bottomOffset === r.topOffset);
}));

// Test 4: Single kapak G-code skipped rows don't produce inverted coordinates
const narrowGcode = buildKapakGcode(150, 500, {
  rows: standardRows,
  thickness: 18,
  spindleSpeed: 18000,
  plungeFeed: 3000,
  cutFeed: 6000,
  safeZ: 61,
  toolChangeZ: 96,
  homeZ: 96,
});
check('adaptive kapak gcode: contains tool 7, 2, 9', narrowGcode.includes('M6T7') && narrowGcode.includes('M6T2') && narrowGcode.includes('M6T9'));
check('adaptive kapak gcode: does not contain skipped tool 12', !narrowGcode.includes('M6T12'));

// --- Curved top (semicircle / pointed) — validated against 2_NUMARA.cnc / 3_NUMARA.cnc ---
const { computeTopCurve, emitTopCurveGcode, buildCarvingProfile } = await import('./kapak.js');

// 2_NUMARA.cnc: outer offset 60, xl=60, xr=232 -> xc=146, r=86, yc=254
const semi = computeTopCurve(60, 232, 340, 'semicircle');
check('top semicircle: xc = 146', Math.abs(semi.xc - 146) < 1e-9);
check('top semicircle: r = 86', Math.abs(semi.r - 86) < 1e-9);
check('top semicircle: yc = 254 (yt - r)', Math.abs(semi.yc - 254) < 1e-9);
check('top semicircle: apex at yt (340)', Math.abs((semi.yc + semi.r) - 340) < 1e-9);
check('top semicircle: yEnd(xc) = apex 340', Math.abs(semi.yEnd(semi.xc) - 340) < 1e-9);
check('top semicircle: yEnd at edges returns yc (254)', Math.abs(semi.yEnd(60) - 254) < 1e-9 && Math.abs(semi.yEnd(232) - 254) < 1e-9);
const semiLines = emitTopCurveGcode([], semi, 12, 6000);
check('top semicircle: emits 2 G3 quarter arcs', semiLines.filter((l) => l.startsWith('G3')).length === 2);
check('top semicircle: arc 1 matches 2_NUMARA G3X146.00Y340.00I-86.00J-0.00', semiLines[1].includes('X146.00 Y340.00') && semiLines[1].includes('I-86.00') && semiLines[1].includes('J0.00'));
check('top semicircle: arc 2 matches 2_NUMARA G3X60.00Y254.00I-0.00J-86.00', semiLines[2].includes('X60.00 Y254.00') && semiLines[2].includes('I0.00') && semiLines[2].includes('J-86.00'));

// 3_NUMARA.cnc: outer offset 57, plate 292x400, xl=57, xr=235
// innerW=178, rise=22.25, r~189.13, yc~153.88, yShoulder~320.75
const pointed = computeTopCurve(57, 235, 400 - 57, 'pointed');
check('top pointed: innerW = 178', Math.abs(pointed.innerW - 178) < 1e-9);
check('top pointed: rise = 22.25 (innerW * 0.125)', Math.abs(pointed.rise - 22.25) < 1e-9);
check('top pointed: r ~ 189.13', Math.abs(pointed.r - 189.13) < 0.01);
check('top pointed: yc ~ 153.88', Math.abs(pointed.yc - 153.88) < 0.01);
check('top pointed: yShoulder ~ 320.75', Math.abs(pointed.yShoulder - 320.75) < 0.01);
check('top pointed: yEnd(xc) = apex yt (343)', Math.abs(pointed.yEnd(pointed.xc) - (400 - 57)) < 1e-9);
const pointedLines = emitTopCurveGcode([], pointed, 12, 6000);
const pArc = pointedLines.find((l) => l.startsWith('G3'));
const pArcI = parseFloat((pArc.match(/I(-?[\d.]+)/) || [])[1]);
const pArcJ = parseFloat((pArc.match(/J(-?[\d.]+)/) || [])[1]);
check('top pointed: G3 X57.00 matches real file (arc lands on left shoulder)', pArc.includes('X57.00'));
check('top pointed: G3 I-89.00 matches real file (±0.01)', Math.abs(pArcI - (-89)) < 0.01);
check('top pointed: G3 J-166.87 matches real file (±0.01)', Math.abs(pArcJ - (-166.87)) < 0.01);
// derz point Y327.36 (x=70.69) — top of a vertical divider ending on the pointed curve
check('top pointed: derz point Y327.36 at x=70.69 matches real file (±0.01)', Math.abs(pointed.yEnd(70.69) - 327.36) < 0.01);
check('top pointed: yEnd returns 0-depth clamp when outside radius (no NaN)', Number.isFinite(pointed.yEnd(-1e6)));

// buildKapakGcode honours topStyle on the top edge (semicircle)
const curvedG = buildKapakGcode(292, 400, {
  thickness: 18, spindleSpeed: 18000, safeZ: 61, toolChangeZ: 96, homeZ: 96, plungeFeed: 3000, cutFeed: 6000,
  topStyle: 'semicircle',
  rows: [{ toolNo: '7', depth: 2.5, stepOffset: 60, operation: 'offset' }],
});
check('top semicircle gcode: emits G3 arc instead of flat top edge', curvedG.includes('G3'));

// --- Carving row (single closed profile + corner sharpen) — 1_NUMARA.cnc T1 ---
// plate 292x400, offset 56, depth 6, thickness 18 => Z=12.00, exit 6 => outward offset 50
// Real file 1_NUMARA.cnc lines 42-56 (after the G0/G1 lead-in) must match 1:1:
const realCarving = [
  'G1 Z12.00',
  'G1 X242.00 Y350.00 Z18.00',
  'X236.00 Y344.00 Z12.00',
  'X56.00',
  'X50.00 Y350.00 Z18.00',
  'X56.00 Y344.00 Z12.00',
  ' Y56.00',
  'X50.00 Y50.00 Z18.00',
  'X56.00 Y56.00 Z12.00',
  'X236.00',
  'X242.00 Y50.00 Z18.00',
  'X236.00 Y56.00 Z12.00',
  ' Y344.00',
];
const carvingLines = buildCarvingProfile(292, 400, 56, 6, 18);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
check('carving: default cornerSharpenDistance == depth (6mm 1:1 ratio)', buildCarvingProfile(292, 400, 56, 6, 18).join('\n') === buildCarvingProfile(292, 400, 56, 6, 18, 6).join('\n'));
check('carving: coordinate/token match vs 1_NUMARA.cnc lines 43-55', carvingLines.map(norm).join('|') === realCarving.map(norm).join('|'));
check('carving: 4 diagonal surface ramps at offset 50 (Z18.00)', carvingLines.filter((l) => l.includes('Z18.00')).length === 4);
check('carving: profile runs at depth Z12.00 between corners', carvingLines.filter((l) => l.includes('Z12.00')).length === 5);
check('carving: explicit cornerSharpenDistance overrides 1:1 (50 -> 53)', buildCarvingProfile(292, 400, 56, 6, 18, 3).includes('X53.00 Y347.00 Z18.00'));

// --- Carving corner ramp must NEVER leave the plate (offset < exit) ---
// Regression: offset=5, depth=15 => exit=15 => oi would be -10 (off-plate).
const clampedCarving = buildCarvingProfile(200, 200, 5, 15, 18);
check('carving clamp: offset<exit produces NO negative X/Y coordinates', !clampedCarving.some((l) => /X-|Y-/.test(l)));
check('carving clamp: corner ramp is clipped to the profile edge (oi = 0)', clampedCarving.some((l) => l.includes('X3.00 Y0.00 Z18.00') || l.includes('X0.00 Y3.00 Z18.00') || l.includes('X0.00 Y0.00 Z18.00')));
const { clampCarvingExit } = await import('./kapak.js');
check('carving clamp: clampCarvingExit(15, 5) = 5', clampCarvingExit(15, 5) === 5);
check('carving clamp: clampCarvingExit(6, 56) = 6 (normal case untouched)', clampCarvingExit(6, 56) === 6);
check('carving clamp: clampCarvingExit(0, 56) = 0 (no ramp)', clampCarvingExit(0, 56) === 0);

// Boundary: offset === exit => oi = 0, corner sits exactly on the zero point, no crash
const boundaryCarving = buildCarvingProfile(292, 400, 6, 6, 18);
check('carving boundary: offset === exit does not crash and stays non-negative', Array.isArray(boundaryCarving) && boundaryCarving.length > 0 && !boundaryCarving.some((l) => /X-|Y-/.test(l)));
check('carving boundary: oi = 0 => corners at X0.00/Y0.00', boundaryCarving.some((l) => l.includes('X0.00 Y0.00 Z18.00')));

// Reference geometry (292,400,56,6,18) must be UNCHANGED by the clamp
check('carving clamp: reference case (292,400,56,6,18) still byte-matches 1_NUMARA.cnc', buildCarvingProfile(292, 400, 56, 6, 18).map(norm).join('|') === realCarving.map(norm).join('|'));

// Advisory warning surfaces to the caller (non-fatal)
const { validateCarvingWarnings } = await import('./kapak.js');
check('carving warning: emitted when exit >= offset', validateCarvingWarnings([{ operation: 'carving', depth: 15, stepOffset: 5 }]).length === 1);
check('carving warning: silent for the safe reference row', validateCarvingWarnings([{ operation: 'carving', depth: 6, stepOffset: 56 }]).length === 0);
check('carving warning: ignored when cornerSharpen is off', validateCarvingWarnings([{ operation: 'carving', depth: 15, stepOffset: 5, cornerSharpen: false }]).length === 0);

// carving row inside buildKapakGcode emits the profile and skips pocket/derz handling
const carvingG = buildKapakGcode(292, 400, {
  thickness: 18, spindleSpeed: 18000, safeZ: 61, toolChangeZ: 96, homeZ: 96, plungeFeed: 3000, cutFeed: 6000,
  rows: [{ toolNo: '1', depth: 6, stepOffset: 56, operation: 'carving' }],
});
check('carving gcode: emits M6T1 and the closed profile', carvingG.includes('M6T1') && carvingG.includes('G0 X236.00 Y344.00 Z61.00') && carvingG.includes('G1 X242.00 Y350.00 Z18.00 F6000.0'));

// --- DXF check file: curved top arc + carving layer (PresetPanel visual check) ---
const { buildKapakPresetDxf } = await import('./kapak.js');
const semiDxf = buildKapakPresetDxf(292, 400, {
  topStyle: 'semicircle',
  rows: [{ toolNo: '7', depth: 2.5, stepOffset: 60, operation: 'offset' }],
});
check('DXF semicircle: emits an ARC entity for the curved top', semiDxf.includes('\nARC\n'));
check('DXF semicircle: arc centre on the panel midline (xc=146) and r=86', semiDxf.includes('146.000') && semiDxf.includes('86.000'));
check('DXF semicircle: still valid ASCII DXF', semiDxf.startsWith('0\nSECTION') && semiDxf.endsWith('\n0\nEOF'));

const pointedDxf = buildKapakPresetDxf(292, 400, {
  topStyle: 'pointed', riseRatio: 0.125,
  rows: [],
});
check('DXF pointed: emits an ARC entity for the shallow top', pointedDxf.includes('\nARC\n'));

const carveDxf = buildKapakPresetDxf(292, 400, {
  rows: [{ toolNo: '1', depth: 6, stepOffset: 56, operation: 'carving' }],
});
check('DXF carving: dedicated CARVING_T1_1 layer is created', carveDxf.includes('CARVING_T1_1'));
const flatDxfNoCarve = buildKapakPresetDxf(292, 400, {
  rows: [{ toolNo: '7', depth: 2.5, stepOffset: 60, operation: 'offset' }],
});
check('DXF flat: no ARC entity when topStyle is flat (unchanged rectangle)', !flatDxfNoCarve.includes('\nARC\n') && flatDxfNoCarve.includes('OFFSET_T7_1'));

// --- Nesting plate G-code: carving rows + curved tops must survive the plate pipeline ---
// (buildNestingPlateGcode is already imported above.)
const carvePlate = { number: 1, width: 1220, height: 2440, parts: [{ name: 'K', x: 10, y: 10, placedWidth: 292, placedHeight: 400 }] };
const carvePlateG = buildNestingPlateGcode(carvePlate, {
  thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 6000, safeZ: 61, toolChangeZ: 96, homeZ: 96,
  enableOuterCut: false,
  rows: [
    { toolNo: '1', depth: 6, stepOffset: 56, operation: 'carving' },
    { toolNo: '7', depth: 2.5, stepOffset: 40, operation: 'offset' },
  ],
});
check('nesting carving: emits M6T1 and the corner-ramp profile at part offset (66/354)', carvePlateG.includes('M6T1') && carvePlateG.includes('G1 X252.00 Y360.00 Z18.00') && carvePlateG.includes('X66.00 Y354.00 Z12.00'));
check('nesting carving: offset row does not leak into the carving depth', carvePlateG.includes('M6T7') && carvePlateG.includes('G1   Z15.50 F3000.0'));

const curvedPlateG = buildNestingPlateGcode(carvePlate, {
  thickness: 18, spindleSpeed: 18000, plungeFeed: 3000, cutFeed: 6000, safeZ: 61, toolChangeZ: 96, homeZ: 96,
  enableOuterCut: false, topStyle: 'semicircle',
  rows: [{ toolNo: '7', depth: 2.5, stepOffset: 40, operation: 'offset' }],
});
check('nesting curved top: offset pass emits a G3 arc', curvedPlateG.includes('G3'));

// --- Relief Generator Tests ---
const { sampleDepthGridUV, calculateCompensatedZ, buildReliefGcodeFromImageData, estimateReliefTime, DEFAULT_RELIEF_CONFIG } = await import('./relief.js');

// 1. Mock 4x4 image buffer (pure black at center, white at edges)
const mockImgData = {
  width: 4,
  height: 4,
  data: new Uint8ClampedArray([
    255, 255, 255, 255,   255, 255, 255, 255,   255, 255, 255, 255,   255, 255, 255, 255,
    255, 255, 255, 255,     0,   0,   0, 255,     0,   0,   0, 255,   255, 255, 255, 255,
    255, 255, 255, 255,     0,   0,   0, 255,     0,   0,   0, 255,   255, 255, 255, 255,
    255, 255, 255, 255,   255, 255, 255, 255,   255, 255, 255, 255,   255, 255, 255, 255,
  ]),
};

// Convert to a 0..1 depth grid the same way buildReliefGcodeFromImageData does internally
// (0 = black = deepest / taban, 1 = white = surface / üst yüzey)
const mockGrid = new Float32Array(16);
for (let i = 0; i < 16; i++) {
  const r = mockImgData.data[i * 4], g = mockImgData.data[i * 4 + 1], b = mockImgData.data[i * 4 + 2];
  mockGrid[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const sampleCenter = sampleDepthGridUV(mockGrid, 4, 4, 0.5, 0.5);
check('relief UV sample center: depth is 0 (black / taban)', sampleCenter.d === 0);

const sampleCorner = sampleDepthGridUV(mockGrid, 4, 4, 0.0, 0.0);
check('relief UV sample corner: depth is 1 (white / yüzey)', sampleCorner.d === 1);

// Test depth mapping: thickness 18, maxDepth 5, flat (non-ballnose) tool = no slope compensation
const depthBlack = calculateCompensatedZ(0, 0, 0, { thickness: 18, maxDepth: 5, toolType: 'flat' });
check('relief depth black pixel: Z = 13.00 (18 - 5)', depthBlack === 13);

const depthWhite = calculateCompensatedZ(1, 0, 0, { thickness: 18, maxDepth: 5, toolType: 'flat' });
check('relief depth white pixel: Z = 18.00 (surface)', depthWhite === 18);

const reliefResult = buildReliefGcodeFromImageData(mockImgData, {
  ...DEFAULT_RELIEF_CONFIG,
  width: 100,
  height: 100,
  thickness: 18,
  maxDepth: 4,
  stepover: 25,
  resolution: 25,
  enableOuterCut: true,
});

check('relief gcode: contains Fanuc header and M6T1', reliefResult.gcode.includes('makro') && reliefResult.gcode.includes('M6T1'));
check('relief gcode: contains Z cut into material', /G1.*Z1[4-8]\.\d{3}/.test(reliefResult.gcode));
check('relief gcode: contains outer profile cut', reliefResult.gcode.includes('DIS KONTUR') && reliefResult.gcode.includes('Z0.000'));
check('relief gcode: ends with M30', reliefResult.gcode.trim().endsWith('M30'));

const timeEstimate = estimateReliefTime(reliefResult, DEFAULT_RELIEF_CONFIG);
check('relief time estimate: positive number calculated', typeof timeEstimate === 'number' && timeEstimate > 0);

// --- STL Exporter & Advanced Filtering Tests ---
const { exportDepthGridToSTL, resampleDepthGrid } = await import('../relief/stlExporter.js');
const { smoothMeshTaubin, crispenDepthFeatures } = await import('../relief/basReliefEngine.js');

const resampledGrid = resampleDepthGrid(mockGrid, 4, 4, 8, 8);
check('stl resample: resized 4x4 to 8x8 correctly', resampledGrid.length === 64);

const taubinSmoothed = smoothMeshTaubin(mockGrid, 4, 4, 2);
check('stl taubin: smoothed grid created with same length', taubinSmoothed.length === 16);

const crispGrid = crispenDepthFeatures(mockGrid, 4, 4, 0.4);
check('stl crisp: sharpened grid created with same length', crispGrid.length === 16);

const stlBlob = exportDepthGridToSTL(mockGrid, 4, 4, 100, 100, 4, 2, { targetResolution: 8 });
check('stl exporter: produces binary STL blob', stlBlob instanceof Blob && stlBlob.size > 84);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);