ra// _trace.mjs — Panjur takım yolunu X-Y izi olarak yazdır (sınır düz mü, rampa mı?)
import { generatePanjurGcode } from './panjur.js';

const base = {
  width: 200, height: 200, offset: 60, offsetMode: 'normal',
  offsetLeft: 60, offsetRight: 60, offsetBottom: 60, offsetTop: 60, centerFlat: 0,
  direction: 'y', pitch: 40.5, exitGap: 0.45, stepover: 2, startZ: 17.937, endZ: 3.105,
  feed: 20000, plunge: 3000, toolNo: '14', spindle: 12000, groundEntry: false, exitCut: 4, t4Z: 0,
  drillTool: '4', drillSpindle: 12000, exitToolDia: 4, t14TipDia: 2, t14BodyDia: 12, t14Height: 65,
  safeZ: 30, toolChangeZ: 30, homeZ: 30, edgeInset: 0,
};

const g = generatePanjurGcode(base);
console.log('--- T14 raster (X,Y,Z) izleri (ilk panjur grubu) ---');
console.log(g.gcode.split('\n').filter((l) => /G1 X/.test(l)).slice(0, 10).join('\n'));
console.log('\n--- aynı çıktı, edgeInset=1 ---');
const g2 = generatePanjurGcode({ ...base, edgeInset: 1 });
console.log(g2.gcode.split('\n').filter((l) => /G1 X/.test(l)).slice(0, 10).join('\n'));
