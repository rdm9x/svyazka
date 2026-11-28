// node --test — переводы: каждая строка t('…') есть в английском словаре; i18n.js сам по себе.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as i18n from '../i18n.js';
import EN_CLI from '../lang/en-cli.js';
import EN_APP from '../lang/en-app.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ключи t('…') — только строки в одинарных кавычках
export function keys(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const out = [];
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g)) out.push(m[1].replace(/\\(['\\])/g, '$1').replace(/\\n/g, '\n'));
  return out;
}

for (const [files, dict, name] of [[['cli/svyazka.mjs', 'cli/platform.mjs', 'cli/mcp.mjs', 'cli/update.mjs', 'core.js'], EN_CLI, 'lang/en-cli.js'], [['app.js'], EN_APP, 'lang/en-app.js']]) {
  test(`каждая строка t('…') переведена в ${name}`, () => {
    const missing = [...new Set(files.flatMap(keys))].filter((k) => !(k in dict));
    assert.deepEqual(missing, [], `нет перевода в ${name}`);
  });
  test(`в ${name} подстановки {N} совпадают с русскими`, () => {
    const ph = (s) => [...String(s).matchAll(/\{\d+\}/g)].map((m) => m[0]).sort().join();
    const bad = Object.entries(dict).filter(([ru, en]) => ph(ru) !== ph(en)).map(([ru]) => ru);
    assert.deepEqual(bad, []);
  });
}

test('i18n: язык, подстановки, множественное число', () => {
  const t = i18n.makeT({ en: { 'Привет, {0}': 'Hi, {0}' } });
  assert.equal(i18n.langFromTag('ru-RU'), 'ru');
  assert.equal(i18n.langFromTag('ru_RU.UTF-8'), 'ru');
  assert.equal(i18n.langFromTag('en-AM'), 'en');
  assert.equal(i18n.langFromTag('rus'), 'en');
  i18n.setLang('ru');
  assert.equal(t('Привет, {0}', 'Мир'), 'Привет, Мир');
  assert.equal(i18n.plural(21, ['запись', 'записи', 'записей'], ['item', 'items']), '21 запись');
  assert.equal(i18n.plural(12, ['запись', 'записи', 'записей'], ['item', 'items']), '12 записей');
  assert.equal(i18n.plural(3, ['запись', 'записи', 'записей'], ['item', 'items']), '3 записи');
  i18n.setLang('en');
  assert.equal(t('Привет, {0}', 'World'), 'Hi, World');
  assert.equal(t('Нет перевода'), 'Нет перевода');
  assert.equal(i18n.plural(1, ['запись', 'записи', 'записей'], ['item', 'items']), '1 item');
  i18n.setLang('xx');
  assert.equal(i18n.lang(), 'ru');
});
