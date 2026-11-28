// Помощь при переводе: строки с русским текстом вне t('…') и вне комментариев.  node test/i18n-left.mjs app.js
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\bt\(\s*'(?:[^'\\]|\\.)*'/g, 't()');
    if (/[А-Яа-яЁё]/.test(code) && !/^\s*(\*|\/\*)/.test(line)) console.log(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
}
