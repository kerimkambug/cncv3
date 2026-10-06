const fs = require('fs');
const path = require('path');

const IGNORE = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  'coverage', '.cache', '.vscode', '.idea', '__pycache__',
  '.DS_Store', 'tree.txt', 'tree.js'
]);

function walk(dir, prefix = '') {
  let out = '';
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => !IGNORE.has(d.name))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));

  items.forEach((item, i) => {
    const last = i === items.length - 1;
    out += `${prefix}${last ? '└── ' : '├── '}${item.name}\n`;
    if (item.isDirectory()) {
      out += walk(path.join(dir, item.name), prefix + (last ? '    ' : '│   '));
    }
  });
  return out;
}

const root = process.cwd();
const result = path.basename(root) + '\n' + walk(root);
fs.writeFileSync('tree.txt', result, 'utf8');
console.log('tree.txt oluşturuldu');