// node --test — команда svyazka целиком (агент, секреты, подтверждения, без GUI). macOS, Windows, Linux.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'svyazka.mjs');
const win = process.platform === 'win32';

function sandbox(extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-'));
  const env = { ...process.env, SVYAZKA_HOME: home, SVYAZKA_SYNC_DIR: path.join(home, 'sync'), SVYAZKA_TEST: '1',
    SVYAZKA_TEST_PASSWORD: 'test-pass-123', SVYAZKA_TEST_CONFIRM: '1', SVYAZKA_LANG: 'ru', ...extra };
  delete env.CLAUDECODE;
  for (const k of Object.keys(env)) if (k.startsWith('CODEX_')) delete env[k];
  const run = (args, opts = {}) => {
    const e = Object.fromEntries(Object.entries({ ...env, ...(opts.env || {}) }).filter(([, v]) => v !== undefined));
    return spawnSync(process.execPath, [CLI, ...args], { env: e, input: opts.input, encoding: 'utf8' });
  };
  const stop = () => { run(['stop']); fs.rmSync(home, { recursive: true, force: true }); };
  return { home, run, stop };
}

test('создать, добавить, найти, показать — без секретов в выводе', (t) => {
  const s = sandbox(); t.after(s.stop);
  assert.equal(s.run(['init']).status, 0);
  let r = s.run(['add', 'password', 'Панель', '--shelf', 'VPS', '--login', 'admin', '--password', 'gen']);
  assert.equal(r.status, 0, r.stderr);
  r = s.run(['add', 'token', '.env', '--shelf', 'VPS', '--value', '-'], { input: 'DB_PASS=SuperSecret42\nAPI=sk-abcdef123456\n' });
  assert.equal(r.status, 0, r.stderr);
  const ls = s.run(['ls', 'VPS']).stdout;
  assert.match(ls, /Панель — admin/);
  assert.doesNotMatch(ls, /SuperSecret42/);
  assert.match(s.run(['find', 'admin']).stdout, /VPS\/Панель/);
  assert.match(s.run(['show', 'Панель']).stdout, /секреты \(скрыты\): password/);
});

test('секрет текстом в аргументах запрещён', (t) => {
  const s = sandbox(); t.after(s.stop);
  s.run(['init']);
  const r = s.run(['add', 'password', 'X', '--password', 'hunter2']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /не передаётся текстом/);
});

test('run: секреты в окружении, в выводе •••', (t) => {
  const s = sandbox(); t.after(s.stop);
  s.run(['init']);
  s.run(['add', 'token', 'env', '--shelf', 'P', '--value', '-'], { input: 'DB_PASS=SuperSecret42\n' });
  const r = s.run(['run', 'env', '--', process.execPath, '-e', 'console.log("db=" + process.env.DB_PASS + " len=" + process.env.DB_PASS.length)']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'db=••• len=13');
  assert.equal(s.run(['run', 'env', '--', process.execPath, '-e', 'process.exit(7)']).status, 7, 'код выхода сохраняется');
});

test('get: только с подтверждением; журнал пишется', (t) => {
  const s = sandbox(); t.after(s.stop);
  s.run(['init']);
  s.run(['add', 'token', 'tok', '--value', '-'], { input: 'abc-secret-777' });
  assert.equal(s.run(['get', 'tok']).stdout, 'abc-secret-777');
  s.run(['stop']);
  const denied = s.run(['get', 'tok'], { env: { SVYAZKA_TEST_CONFIRM: '0' } });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /Не подтверждено/);
  const log = s.run(['log']).stdout;
  assert.match(log, /get \| Разное\/tok \| value/);
  assert.doesNotMatch(log, /abc-secret-777/);
});

test('без GUI и без терминала — понятная ошибка вместо зависания', (t) => {
  const s = sandbox({ SVYAZKA_NO_GUI: '1' }); t.after(s.stop);
  s.run(['init']);
  s.run(['stop']);
  const r = s.run(['ls'], { env: { SVYAZKA_TEST_PASSWORD: undefined } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /окна недоступны/);
});

test('без GUI: пароль из терминала передаётся агенту ответом', { skip: win && 'на Windows агент слушает порт с ключом доступа' }, async (t) => {
  const s = sandbox({ SVYAZKA_NO_GUI: '1' }); t.after(s.stop);
  s.run(['init']);
  s.run(['stop']);
  // агент без тестового пароля: должен попросить ввод и принять ответ
  const env = { SVYAZKA_TEST_PASSWORD: undefined };
  s.run(['status'], { env });
  const sock = fs.existsSync(path.join(s.home, 'agent.sock')) ? path.join(s.home, 'agent.sock') : null;
  if (!sock) return t.skip('сокет в другом месте');
  const ask = (answers) => new Promise((res) => {
    const c = net.createConnection(sock);
    let buf = '';
    c.on('data', (d) => { buf += d; if (buf.includes('\n')) { c.end(); res(JSON.parse(buf.split('\n')[0])); } });
    c.write(JSON.stringify({ op: 'list', args: {}, caller: 'терминал', answers }) + '\n');
  });
  const need = await ask({});
  assert.equal(need.code, 'NEED_INPUT');
  assert.equal(need.extra.kind, 'password');
  assert.equal((await ask({ password: 'wrong-wrong' })).code, 'BAD_PASSWORD');
  const ok = await ask({ password: 'test-pass-123' });
  assert.equal(ok.ok, true);
});

test('sync: бэкап в папку и слияние с другого компьютера', (t) => {
  const a = sandbox(); t.after(a.stop);
  const b = sandbox({ SVYAZKA_SYNC_DIR: path.join(a.home, 'sync') }); t.after(b.stop);
  a.run(['init']);
  a.run(['add', 'note', 'с компьютера A', '--text', 'a']);
  assert.equal(a.run(['sync']).status, 0);
  // B: первое хранилище — из бэкапа A (те же пароль и соль), потом своя запись
  const file = fs.readdirSync(path.join(a.home, 'sync')).find((f) => f.endsWith('.json'));
  assert.equal(b.run(['import', path.join(a.home, 'sync', file)]).status, 0);
  b.run(['add', 'note', 'с компьютера B', '--text', 'b']);
  fs.renameSync(path.join(a.home, 'sync', file), path.join(a.home, 'sync', 'svyazka-A.json'));
  fs.copyFileSync(path.join(b.home, 'vault.json'), path.join(a.home, 'sync', 'svyazka-B.json'));
  assert.equal(a.run(['sync']).status, 0);
  assert.match(a.run(['find', 'компьютера']).stdout, /с компьютера B/);
});

test('Windows: агент не отвечает без ключа доступа', { skip: !win && 'только Windows' }, async (t) => {
  const s = sandbox(); t.after(s.stop);
  s.run(['init']);
  const a = JSON.parse(fs.readFileSync(path.join(s.home, 'agent.json'), 'utf8'));
  assert.ok(a.port && a.token);
  const ask = (token) => new Promise((res) => {
    const c = net.createConnection({ port: a.port, host: '127.0.0.1' });
    let buf = '';
    c.on('data', (d) => { buf += d; });
    c.on('close', () => res(buf));
    c.on('error', () => res(''));
    c.write(JSON.stringify({ op: 'status', args: {}, caller: 'терминал', token }) + '\n');
  });
  assert.equal(await ask('wrong'), '');
  assert.match(await ask(a.token), /"ok":true/);
});

test('открытие по отпечатку: после пароля ключ запоминается, дальше пароль не нужен', async (t) => {
  const s = sandbox(); t.after(s.stop);
  s.run(['init']);
  s.run(['add', 'note', 'n', '--text', 'x']);
  s.run(['stop']);
  const noPw = { SVYAZKA_TEST_PASSWORD: undefined, SVYAZKA_NO_GUI: '1' };
  // отпечаток подтверждён — открывается без пароля
  let r = s.run(['ls'], { env: { ...noPw, SVYAZKA_TEST_QUICK: '1' } });
  assert.equal(r.status, 0, r.stderr);
  s.run(['stop']);
  // отпечаток отклонён, пароля нет — не открывается
  r = s.run(['ls'], { env: { ...noPw, SVYAZKA_TEST_QUICK: '0' } });
  assert.notEqual(r.status, 0);
  s.run(['stop']);
  // выключили — ключ удалён, без пароля не открыть
  assert.match(s.run(['config', 'quick-unlock', 'off']).stdout, /выключено/);
  r = s.run(['ls'], { env: { ...noPw, SVYAZKA_TEST_QUICK: '1' } });
  assert.notEqual(r.status, 0);
});

test('окно приложения: /api/unlock по отпечатку и паролю, /api/lock', async (t) => {
  const s = sandbox({ SVYAZKA_TEST_QUICK: '1' }); t.after(s.stop);
  s.run(['init']);
  const url = new URL(s.run(['ui', '--print']).stdout.trim());
  const tok = url.searchParams.get('t');
  const post = (p, body, token = tok) => fetch(new URL(p, url), { method: 'POST', headers: { 'X-Svyazka-Token': token }, body: body && JSON.stringify(body) });
  assert.equal((await post('/api/unlock', {}, 'wrong')).status, 403);
  let r = await post('/api/unlock', {});
  assert.equal(r.status, 200);
  assert.equal(Buffer.from((await r.json()).raw, 'base64').length, 32);
  assert.equal((await post('/api/lock')).status, 204);
  r = await post('/api/unlock', { password: 'wrong-wrong' });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, 'BAD_PASSWORD');
  r = await post('/api/unlock', { password: 'test-pass-123' });
  assert.equal(r.status, 200);
});

test('окно приложения не открывается само, если агент уже открыт', async (t) => {
  const s = sandbox({ SVYAZKA_TEST_QUICK: '0' }); t.after(s.stop);
  s.run(['init']);
  s.run(['ls']); // агент открыт (как после работы Codex)
  const url = new URL(s.run(['ui', '--print']).stdout.trim());
  const post = (body) => fetch(new URL('/api/unlock', url), { method: 'POST', headers: { 'X-Svyazka-Token': url.searchParams.get('t') }, body: JSON.stringify(body) });
  let r = await post({});
  assert.equal(r.status, 401, 'без отпечатка — нельзя');
  assert.equal((await r.json()).code, 'DENIED');
  r = await post({ password: 'не-тот-пароль' });
  assert.equal(r.status, 401, 'неверный пароль не принимается, даже когда агент открыт');
  assert.equal((await r.json()).code, 'BAD_PASSWORD');
  assert.equal((await post({ password: 'test-pass-123' })).status, 200);
});

test('английский: SVYAZKA_LANG=en — ошибки, справка, настройки', (t) => {
  const s = sandbox({ SVYAZKA_LANG: 'en' }); t.after(s.stop);
  assert.match(s.run(['help']).stdout.split('\n')[0], /^svyazka — Svyazka: a keychain for people and AI agents/);
  assert.equal(s.run(['init']).status, 0);
  let r = s.run(['ls', 'no-such-shelf']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No shelf "no-such-shelf"/);
  r = s.run(['add', 'note', 'n1', '--text', 'hello']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Added:\nMisc \/ n1  \[note\]/);
  assert.match(s.run(['status']).stdout, /^Unlocked: 1 item on 1 shelf,/);
  assert.match(s.run(['frobnicate']).stderr, /Unknown command "frobnicate"/);
  assert.match(s.run(['config']).stdout, /^vault: /);
  assert.equal(s.run(['config', 'lang', 'ru']).stdout.trim(), 'Язык: русский');
  assert.equal(s.run(['config', 'lang', 'en']).stdout.trim(), 'Language: English');
  // --json не меняется от языка
  assert.deepEqual(Object.keys(JSON.parse(s.run(['show', 'n1', '--json']).stdout)), ['id', 'shelf', 'type', 'title', 'fields', 'secrets', 'updated']);
});

test('svyazka config lang en важнее SVYAZKA_LANG — и в команде, и в агенте', (t) => {
  const s = sandbox(); t.after(s.stop); // SVYAZKA_LANG=ru
  s.run(['init']);
  assert.match(s.run(['ls', 'нет-такой']).stderr, /Нет полки «нет-такой»/);
  assert.equal(s.run(['config', 'lang', 'en']).stdout.trim(), 'Language: English');
  assert.match(s.run(['ls', 'nope']).stderr, /No shelf "nope"/, 'агент уже запущен — язык читается на каждый запрос');
  assert.match(s.run(['bogus']).stderr, /Unknown command "bogus"/);
  assert.match(s.run(['config', 'lang', 'auto']).stdout, /Язык: русский/);
  assert.match(s.run(['ls', 'nope']).stderr, /Нет полки «nope»/);
});
