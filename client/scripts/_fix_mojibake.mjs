// kapak.js'te PowerShell'in iki kez bozdugu UTF-8 metin geri yuklemeyi onarir:
// dosya Latin-1 olarak okunup tekrar yazildigi icin Turkce karakterler "Ã¶" gibi
// gorunuyor. Bu, YALNIZCA yorum/JSdoc satirlarini etkiler (kod mantigi saglam).
// Duzeltme: mojibake dizisini orijinal metne geri cevir.
import { readFileSync, writeFileSync } from 'node:fs';

const P = new URL('../src/lib/gcode/kapak.js', import.meta.url);
let s = readFileSync(P, 'utf8');

// Iki kez bozulmus: orijinal UTF-8 byte'lari -> once Latin-1'e, sonra tekrar
// UTF-8'e kodlanmis. Ters islemin iki adimi.
const fixOnce = (t) => Buffer.from(t, 'latin1').toString('utf8');
const before = s;
// "Ã¶" gibi bir desen kaldi mi diye bakip, iki kez coz.
for (let i = 0; i < 2; i++) {
  if (!/[ÃÂ][\u0080-\u00BF]|â€|Ã°|Ã§|Ã¶|Ã¼|Ã±|Å°|Ä°|ÄŸ|ÅŸ|Ã³|Ã©|Ãº|Ã­|Ã¤|Ã¯|â„|â€”/.test(s)) break;
  s = fixOnce(s);
}

writeFileSync(P, s, 'utf8');
console.log('changed:', before !== s);
console.log('sample:', s.split('\n')[8]);
