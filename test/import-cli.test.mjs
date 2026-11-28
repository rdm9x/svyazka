// node --test — svyazka import из другого менеджера и svyazka export: секреты не в выводе, выгрузка только после подтверждения.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'svyazka.mjs');

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-imp-'));
  const env = { ...process.env, SVYAZKA_HOME: home, SVYAZKA_TEST: '1', SVYAZKA_TEST_PASSWORD: 'test-pass-123', SVYAZKA_TEST_CONFIRM: '1', SVYAZKA_LANG: 'en' };
  delete env.CLAUDECODE;
  for (const k of Object.keys(env)) if (k.startsWith('CODEX_')) delete env[k];
  const run = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
  return { home, run, stop: () => { run(['stop']); fs.rmSync(home, { recursive: true, force: true }); } };
}

test('import Bitwarden → скрытые поля не показываются; export только после подтверждения', (t) => {
  const s = sandbox(); t.after(s.stop);
  assert.equal(s.run(['init']).status, 0);
  const src = path.join(s.home, 'bitwarden.json');
  fs.writeFileSync(src, JSON.stringify({ encrypted: false, folders: [], items: [
    { type: 1, name: 'Panel', notes: 'recovery-code-777', login: { username: 'me', password: 'pw-secret-555', totp: 'JBSWY3DPEHPK3PXP', uris: [] } },
    { type: 3, name: 'Visa', card: {} },
  ] }));
  let r = s.run(['import', src]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Format: Bitwarden/);
  assert.match(r.stdout, /not imported .*: 1/);
  assert.match(r.stdout, /added: 1/i);

  r = s.run(['show', 'Bitwarden/Panel']);
  assert.match(r.stdout, /password, totp, hidden/);
  assert.doesNotMatch(r.stdout, /recovery-code-777|pw-secret-555|JBSWY3DP/);

  // get без поля: первый заполненный секрет
  assert.equal(s.run(['get', 'Panel']).stdout.trim(), 'pw-secret-555');
  // run: скрытая заметка тоже вычищается из вывода
  r = s.run(['run', 'Panel', '--env', 'H=hidden', '--', process.execPath, '-e', 'console.log(process.env.H)']);
  assert.equal(r.stdout.trim(), '•••');

  const out = path.join(s.home, 'out.csv');
  // ответ на подтверждение задаёт окружение агента — перезапускаем его с отказом
  s.run(['stop']);
  r = s.run(['export', out], { SVYAZKA_TEST_CONFIRM: '0' });
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(out));
  s.run(['stop']);
  r = s.run(['export', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /pw-secret-555/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(out).mode & 0o777, 0o600);
  assert.doesNotMatch(r.stdout, /pw-secret-555/);
  assert.notEqual(s.run(['export', out]).status, 0); // не перезаписывает
  assert.match(s.run(['log']).stdout, /export \| out\.csv \| csv/);

  const unknown = path.join(s.home, 'x.csv');
  fs.writeFileSync(unknown, 'a,b,c\n1,2,3\n');
  assert.match(s.run(['import', unknown]).stderr, /Unknown format/);
});
