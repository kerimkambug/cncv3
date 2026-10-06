// Şema doğrulaması: Mongoose katı (strict) şeması absoluteOffset'i düşürmemeli.
import Preset from '../models/Preset.js';

const row = {
  name: 'test', toolNo: '7', operation: 'offset',
  depth: 2.5, stepOffset: 20, absoluteOffset: 60,
  derz: { yon: 'dikey', margin: 0, spacing: 60 },
};
const doc = new Preset({ name: 'T', module: 'kapak', rows: [row] });
const json = doc.toObject({ versionKey: false });
const saved = json.rows[0];

const checks = [
  ['absoluteOffset korunuyor', saved.absoluteOffset === 60],
  ['stepOffset korunuyor', saved.stepOffset === 20],
  ['derz alt nesnesi korunuyor', saved.derz?.spacing === 60],
  ['değer verilmezse null', new Preset({ name: 'X', rows: [{ toolNo: '1', depth: 1, stepOffset: 5 }] }).toObject().rows[0].absoluteOffset === null],
  ['geçersiz tip reddediliyor', (() => {
    const e = new Error('x');
    return Preset.schema.path('rows').schema.path('absoluteOffset').instance === 'Number';
  })()],
];
let bad = 0;
checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); });
process.exit(bad ? 1 : 0);
