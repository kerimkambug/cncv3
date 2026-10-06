const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT = 'tum_kodlar.txt';

// Hariç tutulan klasörler
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.cache',
  '.codebase-memory', '.cursor', '.zed', '.vscode', '.idea',
  'numuneler',   // örnek G-code çıktıları: çok büyük, kod değil
  'public'
]);

// Hariç tutulan dosyalar (ad bazlı)
const IGNORE_FILES = new Set([
  'package-lock.json', '.env', 'tree.txt', 'tree.js', 'dump.js', OUTPUT,
  '_ai_svc.log', '_ai_svc_err.log', 'pip.log',
  'karsilastirma-ham-veri.txt', 'strict-detail.txt', 'ai_tum_kodlar.txt',
  'mimari-harita.html'
]);

// Dahil edilecek uzantılar
const ALLOW_EXT = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html',
  '.md', '.ps1', '.py', '.txt', '.example'
]);

const MAX_SIZE = 500 * 1024; // 500 KB'den büyük dosyaları atla

function collect(dir, list = []) {
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));

  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!IGNORE_DIRS.has(item.name)) collect(full, list);
    } else {
      const ext = path.extname(item.name).toLowerCase();
      if (IGNORE_FILES.has(item.name)) continue;
      if (!ALLOW_EXT.has(ext) && item.name !== '.env.example') continue;
      list.push(full);
    }
  }
  return list;
}

const files = collect(ROOT);
const out = fs.createWriteStream(OUTPUT, { encoding: 'utf8' });
let count = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const stat = fs.statSync(file);

  out.write('\n' + '='.repeat(80) + '\n');
  out.write(`DOSYA: ${path.basename(file)}\n`);
  out.write(`YOL  : ${rel}\n`);
  out.write('='.repeat(80) + '\n');

  if (stat.size > MAX_SIZE) {
    out.write(`[ATLANDI: dosya çok büyük (${Math.round(stat.size / 1024)} KB)]\n`);
    continue;
  }

  out.write(fs.readFileSync(file, 'utf8') + '\n');
  count++;
}

out.end(() => console.log(`${count} dosya ${OUTPUT} içine yazıldı (toplam ${files.length} dosya tarandı)`));