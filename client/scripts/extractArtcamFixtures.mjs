// ArtCAM referanslarını numuneler/a.js dosyasından okur.
// a.js gerçek bir JS dosyası DEĞİLDİR: içinde yalnızca yorum blokları vardır.
// Bu modül onu metin olarak okur, iki tür bloğu ayırır ve fixture dosyalarına yazar.
//
//   /* modelN : nihai artcam çıktısı ... */  -> REFERANS (doğru olan)
//   /* modelN : kendi sistemimde üretilen kod */ -> bizim generator'ın çıktısı
//
// Bu dosya `npm run gen:artcam-fixtures` ile çalıştırılır ve ürettiği fixture'ları
// numuneler/artcam/ altına yazar. Testler (artcam.test.js) o fixture'ları okur.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const A_JS_PATH = join(REPO_ROOT, 'numuneler', 'a.js');
export const FIXTURE_DIR = join(REPO_ROOT, 'numuneler', 'artcam');

/** a.js içindeki blok başlıkları: model no + tür. */
const BLOCK_RE = /model(\d+)\s*:\s*(nihai artcam çıktısı|kendi sistemimde üretilen kod)/i;

/**
 * a.js metnini iki sözlüğe ayırır.
 * @returns {{reference: Map<number,string[]>, ours: Map<number,string[]>}}
 *   Her değer, blok içindeki boş olmayan g-code satırlarının dizisidir.
 */
export function parseAJs(text) {
  const reference = new Map();
  const ours = new Map();

  // a.js tamamen yorum bloğundan oluşur, ama bir blok gövdesi içinde `*/`
  // görünmez. Yine de güvenli olmak için blokları karakter düzeyinde ayırıyoruz.
  const re = /\/\*([\s\S]*?)\*\//g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = m[1].split(/\r?\n/);
    const head = BLOCK_RE.exec(body.join('\n'));
    if (!head) continue;
    const kind = /nihai/i.test(head[2]) ? 'reference' : 'ours';
    const model = Number(head[1]);
    // Gövde: başlık satırından sonrası, baştaki/ sondaki boş satırlar atılmış.
    const headerLineIndex = body.findIndex((l) => BLOCK_RE.test(l));
    const lines = body
      .slice(headerLineIndex + 1)
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => l.trim() !== '');
    const target = kind === 'reference' ? reference : ours;
    if (!target.has(model)) target.set(model, lines);
  }

  return { reference, ours };
}

/** Bir g-code satırını karşılaştırma için normalize eder. */
export function normalizeLine(line) {
  return line
    .replace(/\s+$/, '')                                  // satır sonu boşlukları
    .replace(/[ \t]+/g, ' ')                              // ardışık boşluklar -> tek boşluk
    .replace(/-0\.00(?=\D|$)/g, '0.00')                   // -0.00 == 0.00
    .replace(/-0\.0(?=\D|$)/g, '0.0')
    .trim();
}

/** G-code metnini normalize edilmiş satır dizisine çevirir. */
export function normalizeGcode(text) {
  return text.split(/\r?\n/).map(normalizeLine).filter((l) => l !== '');
}

/**
 * ArtCAM referans metnindeki G0/G1 satırlarının gerçek makine konumunu
 * hesaplayarak, "eksen atlanmış mı" kuralını doğrulamak için kullanılır.
 * (Testlerde kullanılmıyor ama hata ayıklamada işe yarar.)
 */
export function resolveModalPositions(text) {
  const pos = { X: 0, Y: 0, Z: null, F: null };
  const out = [];
  for (const line of normalizeGcode(text)) {
    if (/^M6T/.test(line)) { out.push({ line, ...pos }); continue; }
    for (const w of line.matchAll(/([XYZ])(-?[\d.]+)/g)) pos[w[1]] = parseFloat(w[2]);
    const f = /F(-?[\d.]+)/.exec(line);
    if (f) pos.F = parseFloat(f[1]);
    out.push({ line, ...pos });
  }
  return out;
}

/** Fixture dosyalarını (yeniden) yazar. Test sırasında çağrılmaz, elle çalıştırılır. */
export function writeFixtures() {
  const text = readFileSync(A_JS_PATH, 'utf8');
  const { reference } = parseAJs(text);
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });

  const written = [];
  for (const [model, body] of reference) {
    const file = join(FIXTURE_DIR, `model${model}.reference.nc`);
    writeFileSync(file, body.join('\n') + '\n', 'utf8');
    written.push(file);
  }
  return written;
}

// Bu dosya doğrudan çalıştırıldıysa fixture'ları yaz.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const files = writeFixtures();
  console.log(`${files.length} referans fixture yazildi:`);
  for (const f of files) console.log('  ' + f.slice(REPO_ROOT.length + 1));
}
