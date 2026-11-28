// node --test — cli/install.sh: обёртка ~/.local/bin/svyazka (macOS, Linux). Всё во временной «домашней» папке.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('install.sh: старая ссылка заменяется обёрткой, файл по ссылке не портится', { skip: process.platform === 'win32' && 'только macOS и Linux' }, (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-inst-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  // как в 1.4.x: ссылка на скрипт; здесь — на подставной файл, чтобы проверить, что запись не идёт через ссылку
  const target = path.join(home, 'target.mjs');
  fs.writeFileSync(target, 'original');
  fs.symlinkSync(target, path.join(bin, 'svyazka'));

  const env = { ...process.env, HOME: home, SVYAZKA_HOME: path.join(home, '.svyazka'), SVYAZKA_NODE_BIN: process.execPath };
  const r = spawnSync('sh', [path.join(ROOT, 'cli', 'install.sh')], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);

  assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  const w = path.join(bin, 'svyazka');
  assert.ok(!fs.lstatSync(w).isSymbolicLink());
  assert.ok(fs.statSync(w).mode & 0o100);
  assert.match(fs.readFileSync(w, 'utf8'), new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // обёртка запускается без node в PATH
  const h = spawnSync(w, ['help'], { env: { HOME: home, PATH: '/usr/bin:/bin', SVYAZKA_HOME: path.join(home, '.svyazka') }, encoding: 'utf8' });
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /svyazka/);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'svyazka', 'SKILL.md')));
});
