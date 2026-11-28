// node --test — svyazka update: подпись релиза, сравнение версий, проверка через локальный «GitHub».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newer, latest } from '../cli/update.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'svyazka.mjs');

// «релиз»: SHA256SUMS.txt + подпись тестовым ключом; files — что отдавать
function release(version, { tamper = false, key } = {}) {
  const { publicKey, privateKey } = key || crypto.generateKeyPairSync('ed25519');
  const zip = Buffer.from('fake zip ' + version);
  const sums = Buffer.from(`${crypto.createHash('sha256').update(zip).digest('hex')}  svyazka-${version}.zip\n`);
  const sig = crypto.sign(null, sums, privateKey).toString('base64');
  const files = { '/SHA256SUMS.txt': tamper ? Buffer.from(sums.toString().replace(/^./, '0')) : sums, '/SHA256SUMS.txt.sig': Buffer.from(sig), [`/svyazka-${version}.zip`]: zip };
  return { files, pub: publicKey.export({ type: 'spki', format: 'pem' }) };
}
function serve(files) {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => { const f = files[q.url]; r.writeHead(f ? 200 : 404); r.end(f); });
    srv.listen(0, '127.0.0.1', () => res({ base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
  });
}
const run = (args, env) => new Promise((res) => {
  const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => res({ code, out, err }));
});

test('версии: 1.10.0 > 1.9.2, равные — не новее', () => {
  assert.equal(newer('1.10.0', '1.9.2'), true);
  assert.equal(newer('2.0.0', '1.9.9'), true);
  assert.equal(newer('1.9.0', '1.9.0'), false);
  assert.equal(newer('1.8.9', '1.9.0'), false);
});

test('подпись: верная — версия; подменённый список или чужой ключ — отказ', async (t) => {
  const ok = release('9.9.9');
  const s1 = await serve(ok.files); t.after(s1.close);
  const r = await latest({ base: s1.base, pubkey: ok.pub });
  assert.equal(r.version, '9.9.9');
  assert.equal(r.zip, 'svyazka-9.9.9.zip');

  const bad = release('9.9.9', { tamper: true });
  const s2 = await serve(bad.files); t.after(s2.close);
  await assert.rejects(latest({ base: s2.base, pubkey: bad.pub }), (e) => e.code === 'SIGNATURE');

  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  await assert.rejects(latest({ base: s1.base, pubkey: other }), (e) => e.code === 'SIGNATURE');

  // настоящий открытый ключ проекта на месте и это Ed25519
  const pub = crypto.createPublicKey(fs.readFileSync(path.join(path.dirname(CLI), 'release-key.pub'), 'utf8'));
  assert.equal(pub.asymmetricKeyType, 'ed25519');
});

test('svyazka update --check: новая версия видна, подмена отклоняется, проверку можно выключить', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-up-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const ok = release('99.0.0');
  const s = await serve(ok.files); t.after(s.close);
  const env = { SVYAZKA_HOME: home, SVYAZKA_TEST: '1', SVYAZKA_LANG: 'en', SVYAZKA_RELEASE_URL: s.base, SVYAZKA_UPDATE_PUBKEY: ok.pub };

  let r = await run(['update', '--check', '--json'], env);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.available, true);
  assert.equal(j.latest, '99.0.0');
  r = await run(['status'], env);
  assert.match(r.out, /Version 99\.0\.0 is available/);

  r = await run(['update', '--check'], { ...env, SVYAZKA_UPDATE_PUBKEY: crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /signature does not match/);

  await run(['config', 'update-check', 'off'], env);
  r = await run(['update', '--check', '--auto', '--json'], env);
  assert.equal(JSON.parse(r.out).disabled, true);
  await run(['stop'], env);
});
