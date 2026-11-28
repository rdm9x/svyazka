// node --test — svyazka mcp: протокол, инструменты, секреты не выходят наружу. macOS, Windows, Linux.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'svyazka.mjs');

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-mcp-'));
  const env = { ...process.env, SVYAZKA_HOME: home, SVYAZKA_TEST: '1', SVYAZKA_TEST_PASSWORD: 'test-pass-123', SVYAZKA_TEST_CONFIRM: '1', SVYAZKA_LANG: 'en' };
  delete env.CLAUDECODE;
  for (const k of Object.keys(env)) if (k.startsWith('CODEX_')) delete env[k];
  const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { env, input, encoding: 'utf8' });
  return { home, env, run, stop: () => { run(['stop']); fs.rmSync(home, { recursive: true, force: true }); } };
}

// MCP-клиент: запросы по id, ответы по id
function client(env) {
  const p = spawn(process.execPath, [CLI, 'mcp'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  const raw = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => {
    raw.push(l);
    const m = JSON.parse(l); // в stdout — только JSON-RPC
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
  let n = 0;
  const req = (method, params) => new Promise((res) => {
    const id = ++n;
    waiting.set(id, res);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  const tool = async (name, args) => (await req('tools/call', { name, arguments: args })).result;
  const close = () => new Promise((res) => { p.on('close', res); p.stdin.end(); });
  return { req, notify, tool, close, raw };
}

test('mcp: инициализация, список инструментов, без get/copy/rm', async (t) => {
  const s = sandbox(); t.after(s.stop);
  assert.equal(s.run(['init']).status, 0);
  const c = client(s.env);
  const init = await c.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Cursor', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'keyhandoff');
  assert.ok(init.result.capabilities.tools);
  c.notify('notifications/initialized');
  const { tools } = (await c.req('tools/list', {})).result;
  const names = tools.map((x) => x.name);
  assert.ok(names.includes('keyhandoff_run') && names.includes('keyhandoff_add') && names.includes('keyhandoff_find'));
  assert.ok(!names.some((n) => /get|copy|rm|delete|reveal/.test(n)));
  assert.equal((await c.req('ping', {})).result && true, true);
  assert.equal((await c.req('nope/method', {})).error.code, -32601);
  await c.close();
});

test('mcp: добавить с gen, запустить — секрет в выводе скрыт; текстом секрет не принимается', async (t) => {
  const s = sandbox(); t.after(s.stop);
  assert.equal(s.run(['init']).status, 0);
  const c = client(s.env);
  await c.req('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Gemini CLI' } });

  let r = await c.tool('keyhandoff_add', { type: 'password', title: 'Panel', shelf: 'VPS', fields: { login: 'admin', password: 'gen:20' } });
  assert.equal(r.isError, false, r.content[0].text);
  assert.match(r.content[0].text, /"secrets":\s*\[\s*"password"/);

  r = await c.tool('keyhandoff_add', { type: 'token', title: 'Leak', fields: { value: 'plain-secret-value-123' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /cannot be passed as text/);

  r = await c.tool('keyhandoff_list', { shelf: 'VPS' });
  assert.match(r.content[0].text, /Panel/);
  assert.doesNotMatch(r.content[0].text, /"password":/);

  r = await c.tool('keyhandoff_run', { items: ['VPS/Panel'], command: [process.execPath, '-e', 'console.log("pw=" + process.env.SVYAZKA_PASSWORD + " len=" + process.env.SVYAZKA_PASSWORD.length)'] });
  assert.equal(r.isError, false, r.content[0].text);
  assert.match(r.structuredContent.output, /pw=••• len=20/);
  assert.equal(r.structuredContent.exitCode, 0);

  // строка — через оболочку (sh -c / cmd.exe), кавычки внутри работают
  r = await c.tool('keyhandoff_run', { items: ['VPS/Panel'], command: `"${process.execPath}" -e "console.log('s=' + process.env.SVYAZKA_PASSWORD.length)"` });
  assert.equal(r.isError, false, r.content[0].text);
  assert.match(r.structuredContent.output, /s=20/);

  r = await c.tool('keyhandoff_run', { items: ['VPS/Panel'], env: { X: 'hidden' }, command: [process.execPath, '-e', '1'] });
  assert.equal(r.isError, true);

  r = await c.tool('keyhandoff_add', { type: 'password', title: 'Short', fields: { password: 'gen:0' } });
  assert.equal(r.isError, true);

  r = await c.tool('keyhandoff_run', { items: ['VPS/Panel'], command: [process.execPath, '-e', 'process.exit(3)'] });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.exitCode, 3);

  r = await c.tool('keyhandoff_show', { item: 'nothing-like-this' });
  assert.equal(r.isError, true);

  assert.equal((await c.req('tools/call', { name: 'keyhandoff_get', arguments: {} })).error.code, -32602);
  await c.close();

  // клиент подписан в журнале; значения в stdout MCP не было
  const log = s.run(['log']).stdout;
  assert.match(log, /MCP: Gemini CLI \| add \| VPS\/Panel/);
  assert.match(log, /MCP: Gemini CLI \| run \| VPS\/Panel/);
  assert.ok(!c.raw.join('\n').includes('plain-secret-value-123'));
});

test('mcp config: путь к node и скрипту', () => {
  const s = sandbox();
  try {
    const cfg = JSON.parse(s.run(['mcp', 'config']).stdout);
    assert.equal(cfg.mcpServers.keyhandoff.command, process.execPath);
    assert.deepEqual(cfg.mcpServers.keyhandoff.args.slice(-1), ['mcp']);
  } finally { s.stop(); }
});
