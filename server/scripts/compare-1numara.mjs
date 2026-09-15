// Compare generated g-code for preset "1 NUMARA" against numuneler/1 NUMARA.cnc
import { fileStore } from '../store/fileStore.js';
import { buildKapakGcode } from '../../client/src/lib/gcode/kapak.js';

const presets = await fileStore.list();
const p = (Array.isArray(presets) ? presets : presets.presets || []).find((x) => x.name === '1 NUMARA');
if (!p) {
  console.error('preset bulunamadı');
  process.exit(1);
}

const gcode = buildKapakGcode(p.width || 292, p.height || 400, p);
const gen = gcode.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

const real = (await import('node:fs')).readFileSync(
  new URL('../../numuneler/1 NUMARA.cnc', import.meta.url),
  'utf8'
);
const ref = real.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

console.log(`üretilen: ${gen.length} satır, gerçek: ${ref.length} satır`);

// Compare coordinate/token lines: normalize by dropping modal-only lines
function tokens(l) {
  return (l.match(/[A-Za-z][-+]?[0-9]+(\.[0-9]+)?|[A-Za-z]+/g) || []).map((t) =>
    /^-?[0-9]/.test(t) ? t : t.toUpperCase()
  );
}

const refKey = new Map();
ref.forEach((l, i) => refKey.set(tokens(l).join(','), i));

let matched = 0;
const unmatched = [];
gen.forEach((l) => {
  const k = tokens(l).join(',');
  if (refKey.has(k)) matched++;
  else unmatched.push(l);
});

console.log(`birebir satır eşleşmesi: ${matched}/${gen.length}`);
if (unmatched.length) {
  console.log('--- üretilen dosyada ama gerçek dosyada birebir karşılığı olmayan satırlar ---');
  unmatched.forEach((l) => console.log(' ' + l));
}
