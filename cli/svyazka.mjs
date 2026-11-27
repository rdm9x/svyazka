#!/usr/bin/env node
// svyazka — Связка: локальная ключница для людей и ИИ-агентов (macOS, Windows, Linux).
// Агент держит ключ в памяти (как ssh-agent). Команды пользуются секретами, не показывая их;
// показать значение можно только после Touch ID / Windows Hello. Всё пишется в журнал ~/.svyazka/audit.log.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as core from '../core.js';
import * as sys from './platform.mjs';

const HOME = os.homedir();
const DIR = process.env.SVYAZKA_HOME || path.join(HOME, '.svyazka');
const VAULT = path.join(DIR, 'vault.json');
// Связь с агентом: Unix-сокет (macOS, Linux) или локальный порт + ключ доступа в файле профиля (Windows)
const AGENT_FILE = path.join(DIR, 'agent.json');
const SOCK = (() => {
  const p = path.join(DIR, 'agent.sock');
  if (Buffer.byteLength(p) < 100) return p;
  let h = 0; for (const ch of DIR) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return path.join(os.tmpdir(), `svyazka-${h.toString(36)}.sock`);
})();
// Тестовый режим (ответы вместо окон) — только для временных папок, никогда для настоящего ~/.svyazka.
const TEST = process.env.SVYAZKA_TEST === '1' && (DIR.startsWith('/private/tmp/') || DIR.startsWith(os.tmpdir())) && DIR !== path.join(os.userInfo().homedir, '.svyazka');
const LOG = path.join(DIR, 'audit.log');
const STATE = path.join(DIR, 'state.json');
const TOUCHID = path.join(DIR, 'bin', 'svyazka-touchid');
const CONFIG = path.join(DIR, 'config.json');
// Папка для бэкапа и обмена между компьютерами: настройка → переменная → iCloud Drive / OneDrive → Документы
const syncDir = () => readJSON(CONFIG).syncDir || process.env.SVYAZKA_SYNC_DIR || sys.defaultSyncDir(HOME);
const HOST = os.hostname().replace(/\.local$/, '').replace(/[^\w.-]+/g, '-') || 'mac';
const SCRIPT = fs.realpathSync(fileURLToPath(import.meta.url));
const WEBROOT = path.resolve(path.dirname(SCRIPT), '..');
const IDLE_MIN = +process.env.SVYAZKA_IDLE_MIN || 30;
const MAX_HOURS = 8;
const SSH_KEY_TTL = 900; // секунд ключ живёт в ssh-agent

const TYPE_LABEL = { password: 'пароль', ssh: 'ssh', token: 'токен', payment: 'оплата', note: 'заметка' };
const PERIOD_LABEL = { 1: 'мес', 3: 'квартал', 6: 'полгода', 12: 'год', 24: '2 года', 36: '3 года', 0: 'разово' };

class UserError extends Error {
  constructor(m, code, extra) { super(m); this.code = code; this.extra = extra; }
}
const fail = (m, code, extra) => { throw new UserError(m, code, extra); };

// Ответы, которые клиент передал из терминала (когда окон macOS нет: вход по SSH и т. п.)
const answers = new AsyncLocalStorage();

// Быстрая разблокировка (Touch ID / Windows Hello): ключ хранилища в связке ключей / DPAPI.
// id записи зависит от папки и соли хранилища — после смены пароля старый ключ просто не найдётся.
const quickId = (saltB64) => 'vault-' + createHash('sha256').update(DIR + '|' + saltB64).digest('hex').slice(0, 16);
const quickEnabled = () => readJSON(CONFIG).quickUnlock !== false && (sys.QUICK || TEST);
const QOPT = { touchid: TOUCHID, dir: DIR };
const QTEST = () => path.join(DIR, 'quick-test.json');
function qStore(id, raw) {
  if (TEST) { writeJSON(QTEST(), { id, raw }); return true; }
  return sys.quickStore(id, raw, QOPT);
}
function qLoad(id, reason) {
  if (TEST) {
    if (process.env.SVYAZKA_TEST_QUICK === '0') return { status: 'denied' };
    const q = readJSON(QTEST());
    return process.env.SVYAZKA_TEST_QUICK === '1' && q.id === id ? { raw: q.raw } : { status: 'none' };
  }
  return sys.quickLoad(id, reason, QOPT);
}
// Подтвердить, что за компьютером владелец (для окна приложения при уже открытом агенте)
function qVerify(reason) {
  if (TEST) return { '1': 'ok', '0': 'denied' }[process.env.SVYAZKA_TEST_QUICK] || 'unavailable';
  return sys.verifyUser(reason, TOUCHID);
}
function qDelete(id) { if (TEST) fs.rmSync(QTEST(), { force: true }); else sys.quickDelete(id, QOPT); }
const GUI = sys.GUI;

// Спросить у человека: тест → ответ из терминала → окно macOS → попросить клиента спросить в терминале
function prompt(kind, text) {
  if (TEST && process.env.SVYAZKA_TEST_PASSWORD != null) return process.env.SVYAZKA_TEST_PASSWORD || null;
  const ans = answers.getStore();
  if (ans && kind in ans) { const v = ans[kind]; delete ans[kind]; return v === '' || v == null ? null : v; }
  if (!GUI) fail('Нужен ввод в терминале', 'NEED_INPUT', { kind, text });
  return sys.dialogInput(text);
}

/* ═════════════════════════ агент ═════════════════════════ */

const AGENT_TOKEN = core.b64e(core.rand(24));

function runAgent() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  if (!sys.WIN) { fs.chmodSync(DIR, 0o700); try { fs.unlinkSync(SOCK); } catch {} }

  const st = { key: null, salt: null, saltB64: null, iter: null, data: null, fileText: null, unlockedAt: 0, lastUse: 0 };
  let unlocking = null;
  let ui = null;
  let clipTimer = null;

  const lockNow = () => { Object.assign(st, { key: null, raw: null, salt: null, saltB64: null, data: null, fileText: null, unlockedAt: 0 }); };
  setInterval(() => {
    if (st.key && (Date.now() - st.lastUse > IDLE_MIN * 60000 || Date.now() - st.unlockedAt > MAX_HOURS * 3600000)) lockNow();
  }, 15000).unref();

  const readVault = () => { try { return fs.readFileSync(VAULT, 'utf8'); } catch { return null; } };
  const writeText = (file, text) => {
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  };

  // Подтянуть изменения файла (их мог сделать веб-интерфейс или sync).
  async function reload() {
    const text = readVault();
    if (!text) { lockNow(); fail('Хранилища нет. Создайте: svyazka init'); }
    if (text === st.fileText) return;
    const blob = JSON.parse(text);
    if (blob.salt !== st.saltB64) { lockNow(); fail('Мастер-пароль сменился — откройте заново: svyazka unlock'); }
    st.data = await core.decryptWith(blob, st.key);
    st.fileText = text;
  }

  async function persist() {
    const text = readVault();
    if (text && text !== st.fileText) {
      const blob = JSON.parse(text);
      if (blob.salt === st.saltB64) st.data = core.mergeData(st.data, await core.decryptWith(blob, st.key)).data;
    }
    const out = JSON.stringify(await core.seal(st));
    writeText(VAULT, out);
    st.fileText = out;
  }

  // opts: { password } — пароль уже известен (окно приложения); { passwordFallback: false } — только отпечаток
  async function ensureUnlocked(reason, opts = {}) {
    if (st.key) { await reload(); st.lastUse = Date.now(); return; }
    const text = readVault();
    if (!text) fail('Хранилища нет. Создайте: svyazka init (или svyazka import <бэкап>)');
    unlocking ||= (async () => {
      const blob = JSON.parse(text);
      const id = quickId(blob.salt);
      const open = async (raw) => {
        const key = await core.importRaw(raw);
        const data = await core.decryptWith(blob, key);
        Object.assign(st, { key, raw, salt: core.b64d(blob.salt), saltB64: blob.salt, iter: blob.iter, data, fileText: text, unlockedAt: Date.now(), lastUse: Date.now() });
      };
      // 1. отпечаток
      if (opts.password == null && quickEnabled() && (GUI || TEST)) {
        const q = qLoad(id, 'открыть Связку'); // macOS: «…пытается открыть Связку»
        if (q.raw) {
          try { await open(core.b64d(q.raw)); return; } catch { qDelete(id); } // ключ устарел — пароль сменили
        }
        if (q.status === 'denied' && opts.passwordFallback === false) fail('Не подтверждено', 'DENIED');
      }
      if (opts.passwordFallback === false) fail('Нужен мастер-пароль', 'NEED_PASSWORD');
      // 2. мастер-пароль
      for (let attempt = 0; attempt < 3; attempt++) {
        const pw = opts.password ?? prompt('password', `${reason}\n\nВведите мастер-пароль${attempt ? ' (неверный, ещё раз)' : ''}:`);
        if (pw == null) fail('Отменено: хранилище не открыто');
        try {
          await open(await core.deriveRaw(pw, core.b64d(blob.salt), blob.iter));
          if (quickEnabled() && (GUI || TEST)) qStore(id, core.b64e(st.raw));
          return;
        } catch {}
        if (opts.password != null || !GUI || TEST) break; // одна попытка за запрос, повторит клиент
      }
      fail('Неверный мастер-пароль', 'BAD_PASSWORD');
    })().finally(() => { unlocking = null; });
    await unlocking;
  }

  const confirmSecret = async (what) => {
    if (TEST && process.env.SVYAZKA_TEST_CONFIRM != null) {
      if (process.env.SVYAZKA_TEST_CONFIRM === '1') return;
      fail('Не подтверждено');
    }
    if (GUI) {
      const v = sys.verifyUser(what, TOUCHID);
      if (v === 'ok') return;
      if (v === 'denied') fail(`Не подтверждено (${sys.VERIFY_NAME})`);
      if (!sys.dialogConfirm(what)) fail('Не подтверждено');
      return;
    }
    // без окон: подтверждение мастер-паролем в терминале
    const pw = prompt('confirm', `Подтвердите мастер-паролем: ${what}`);
    if (pw == null) fail('Не подтверждено');
    try { await core.decryptWith(JSON.parse(st.fileText), await core.deriveKey(pw, st.salt, st.iter)); }
    catch { fail('Неверный мастер-пароль — не подтверждено'); }
  };

  const shelfName = (id) => st.data.shelves.find((s) => s.id === id)?.name || '—';

  function resolve(ref) {
    const items = st.data.items;
    const exact = items.find((i) => i.id === ref);
    if (exact) return exact;
    const q = ref.trim().toLowerCase();
    let pool = items;
    let title = q;
    if (q.includes('/')) {
      const [sh, ...rest] = q.split('/');
      const shelves = st.data.shelves.filter((s) => s.name.toLowerCase().includes(sh.trim()));
      if (shelves.length) { pool = items.filter((i) => shelves.some((s) => s.id === i.shelfId)); title = rest.join('/').trim(); }
    }
    let hits = pool.filter((i) => i.title.toLowerCase() === title);
    if (!hits.length) hits = pool.filter((i) => i.title.toLowerCase().includes(title));
    if (!hits.length && pool !== items) hits = pool; // «Полка/» — все записи полки
    if (!hits.length) fail(`Не нашёл запись «${ref}». Посмотрите: svyazka ls`);
    if (hits.length > 1) fail(`«${ref}» подходит к нескольким записям — уточните как «Полка/Название»:\n` + hits.map((i) => `  ${shelfName(i.shelfId)}/${i.title}`).join('\n'));
    return hits[0];
  }

  function redact(it) {
    const secrets = core.SECRET_FIELDS[it.type] || [];
    const fields = {};
    for (const [k, v] of Object.entries(it.f || {})) {
      if (secrets.includes(k) || k === 'history' || k === 'anchor' || v === '' || v == null) continue;
      fields[k] = v;
    }
    return {
      id: it.id, shelf: shelfName(it.shelfId), type: it.type, title: it.title, fields,
      secrets: secrets.filter((k) => it.f?.[k]),
      history: it.type === 'payment' ? (it.f.history || []).slice(0, 5) : undefined,
      updated: new Date(it.updated || it.created || 0).toISOString().slice(0, 10),
    };
  }

  function findShelf(name, create) {
    const s = st.data.shelves.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (s || !create) return s;
    const n = { id: core.uid(), name: name.trim(), color: core.COLORS[st.data.shelves.length % core.COLORS.length], created: Date.now(), updated: Date.now() };
    st.data.shelves.push(n);
    return n;
  }

  // Значения полей из запроса: обычные строки, {ask:1} — спросить в окне, {gen:N} — сгенерировать.
  // Человеческие названия полей для окна ввода
  const FIELD_LABEL = { value: 'значение токена (ключ, токен, ссылку или содержимое .env)', password: 'пароль', privateKey: 'приватный SSH-ключ',
    passphrase: 'пароль (passphrase) от SSH-ключа', login: 'логин', text: 'текст заметки', url: 'адрес' };

  function materialize(type, title, fields, ctx = {}) {
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (v && typeof v === 'object' && v.ask) {
        const x = prompt('field:' + k, `${ctx.who || 'Агент'} сохраняет в Связку запись «${title}»${ctx.shelf ? ` (полка «${ctx.shelf}»)` : ''}.\n\n`
          + `Вставьте сюда ${FIELD_LABEL[k] || k}. Агент значение не увидит — оно сразу шифруется.`);
        if (x == null) fail('Отменено');
        out[k] = x;
      } else if (v && typeof v === 'object' && v.gen) out[k] = genPassword(v.gen);
      else out[k] = v;
    }
    if (type === 'payment') {
      if (out.amount != null) out.amount = String(out.amount).replace(',', '.').replace(/[^\d.]/g, '');
      if (out.currency) out.currency = String(out.currency).toUpperCase();
      if (out.period != null) out.period = +out.period;
      if (out.remind != null) out.remind = +out.remind;
      if (out.autoRenew != null) out.autoRenew = /^(1|true|да|yes)$/i.test(String(out.autoRenew));
      if (out.nextDate) out.anchor = +out.nextDate.slice(8, 10);
    }
    return out;
  }

  function secretEnv(it, envmap) {
    const f = it.f, env = {};
    const put = (k, v) => { if (v != null && v !== '') env[k] = String(v); };
    if (it.type === 'password') { put('SVYAZKA_LOGIN', f.login); put('SVYAZKA_PASSWORD', f.password); put('SVYAZKA_URL', f.url); }
    if (it.type === 'token') {
      put('SVYAZKA_TOKEN', f.value);
      for (const line of String(f.value || '').split('\n')) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/);
        if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      }
    }
    if (it.type === 'ssh') { put('SVYAZKA_HOST', f.host); put('SVYAZKA_USER', f.user); put('SVYAZKA_PORT', f.port); put('SVYAZKA_PASSPHRASE', f.passphrase); }
    if (it.type === 'note') put('SVYAZKA_TEXT', f.text);
    for (const [name, field] of Object.entries(envmap || {})) {
      if (!(field in f)) fail(`В «${it.title}» нет поля ${field}. Поля: ${Object.keys(f).join(', ')}`);
      put(name, f[field]);
    }
    return env;
  }

  const secretValues = (its) => its.flatMap((it) => (core.SECRET_FIELDS[it.type] || []).map((k) => it.f[k]))
    .concat(its.filter((i) => i.type === 'token').flatMap((i) => String(i.f.value || '').split('\n').map((l) => l.split('=').slice(1).join('=').trim())))
    .filter((v) => v && String(v).length >= 4)
    .flatMap((v) => [String(v), ...String(v).split('\n').map((l) => l.trim()).filter((l) => l.length >= 8)])
    .sort((a, b) => b.length - a.length);

  function sshAdd(it, sock) {
    if (!it.f.privateKey) return false;
    if (!sock && !sys.WIN) fail('Нет SSH_AUTH_SOCK — ssh-agent не запущен');
    const key = it.f.privateKey.endsWith('\n') ? it.f.privateKey : it.f.privateKey + '\n';
    const env = sock ? { ...process.env, SSH_AUTH_SOCK: sock } : { ...process.env };
    if (sys.WIN) return sshAddWindows(it, key, env);
    if (it.f.passphrase) {
      // ssh-add спрашивает passphrase через SSH_ASKPASS — отдаём её из памяти агента
      const ask = path.join(DIR, 'askpass-' + process.pid + '.sh');
      fs.writeFileSync(ask, '#!/bin/sh\nprintf "%s" "$SVYAZKA_PP"\n', { mode: 0o700 });
      Object.assign(env, { SSH_ASKPASS: ask, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0', SVYAZKA_PP: it.f.passphrase });
      const r = spawnSync('ssh-add', ['-t', String(SSH_KEY_TTL), '-'], { input: key, env, encoding: 'utf8' });
      fs.rmSync(ask, { force: true });
      if (r.status !== 0) fail('ssh-add не принял ключ: ' + (r.stderr || '').trim());
    } else {
      const r = spawnSync('ssh-add', ['-t', String(SSH_KEY_TTL), '-'], { input: key, env, encoding: 'utf8' });
      if (r.status !== 0) fail('ssh-add не принял ключ: ' + (r.stderr || '').trim());
    }
    return true;
  }

  // Windows: агент OpenSSH (служба ssh-agent). Срок жизни ключа он может не поддерживать — тогда убираем ключ сами.
  function sshAddWindows(it, key, env) {
    if (it.f.passphrase) fail('Ключи с passphrase на Windows пока не поддерживаются — уберите passphrase или используйте ключ без неё');
    let r = spawnSync('ssh-add', ['-t', String(SSH_KEY_TTL), '-'], { input: key, env, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0 && /agent|connect|pipe/i.test(r.stderr || '') && !/lifetime|constrain/i.test(r.stderr || '')) {
      fail('Не запущена служба ssh-agent. В PowerShell от администратора: Get-Service ssh-agent | Set-Service -StartupType Automatic; Start-Service ssh-agent');
    }
    if (r.status !== 0) {
      r = spawnSync('ssh-add', ['-'], { input: key, env, encoding: 'utf8', windowsHide: true });
      if (r.status !== 0) fail('ssh-add не принял ключ: ' + (r.stderr || '').trim());
      if (it.f.publicKey) {
        setTimeout(() => {
          const pub = path.join(DIR, 'tmp-' + process.pid + '.pub');
          try { fs.writeFileSync(pub, it.f.publicKey + '\n'); spawnSync('ssh-add', ['-d', pub], { env, windowsHide: true }); } catch {}
          fs.rmSync(pub, { force: true });
        }, SSH_KEY_TTL * 1000).unref();
      }
    }
    return true;
  }

  const audit = (caller, op, what = '', extra = '') => {
    const t = new Date().toLocaleString('sv-SE').slice(0, 16);
    fs.appendFileSync(LOG, `${t} | ${caller} | ${op}${what ? ' | ' + what : ''}${extra ? ' | ' + extra : ''}\n`, { mode: 0o600 });
  };
  const label = (it) => `${shelfName(it.shelfId)}/${it.title}`;
  const who = (c) => ({ Claude: 'Claude Code', Codex: 'Codex' })[c] || 'Терминал';

  async function openForeign(blob, purpose) {
    if (st.key && blob.salt === st.saltB64) return core.decryptWith(blob, st.key);
    for (let a = 0; a < 3; a++) {
      const pw = prompt('file', `${purpose}\n\nЭтот файл зашифрован другим паролем (или другим хранилищем). Введите его мастер-пароль${a ? ' (неверный, ещё раз)' : ''}:`);
      if (pw == null) fail('Отменено');
      try { return (await core.openVault(blob, pw)).data; } catch {}
      if (!GUI || TEST) break;
    }
    fail('Неверный пароль файла');
  }

  /* ── операции ── */
  const ops = {
    async status() {
      const exists = !!readVault();
      return {
        exists, unlocked: !!st.key,
        items: st.data?.items.length, shelves: st.data?.shelves.length,
        lockInMin: st.key ? Math.max(0, Math.round((IDLE_MIN * 60000 - (Date.now() - st.lastUse)) / 60000)) : null,
        ui: ui?.url || null, vault: VAULT,
      };
    },
    async lock(a, c) { lockNow(); audit(c, 'lock'); return 'Связка заблокирована'; },
    async stop(a, c) { lockNow(); audit(c, 'stop'); setTimeout(cleanupExit, 50); return 'Агент остановлен'; },
    async unlock(a, c) { await ensureUnlocked(`${who(c)} просит открыть Связку.`); audit(c, 'unlock'); return `Открыто: ${st.data.items.length} записей, автоблокировка через ${IDLE_MIN} мин без использования`; },

    async init(a, c) {
      if (readVault()) fail('Хранилище уже есть: ' + VAULT);
      const p1 = prompt('new', 'Новое хранилище на этом компьютере.\n\nПридумайте мастер-пароль (не короче 8 символов; восстановить его нельзя):');
      if (p1 == null) fail('Отменено');
      if (p1.length < 8) fail('Минимум 8 символов');
      const p2 = prompt('new2', 'Повторите мастер-пароль:');
      if (p1 !== p2) fail('Пароли не совпадают');
      const salt = core.rand(16);
      const raw = await core.deriveRaw(p1, salt);
      Object.assign(st, { key: await core.importRaw(raw), raw, salt, iter: core.ITER, data: core.newVault(), unlockedAt: Date.now(), lastUse: Date.now() });
      st.saltB64 = core.b64e(salt);
      await persist();
      if (quickEnabled() && (GUI || TEST)) qStore(quickId(st.saltB64), core.b64e(raw));
      audit(c, 'init');
      return 'Хранилище создано: ' + VAULT;
    },

    async list({ shelf }, c) {
      await ensureUnlocked(`${who(c)} просит список записей.`);
      if (shelf) {
        const s = st.data.shelves.find((x) => x.name.toLowerCase().includes(shelf.toLowerCase()));
        if (!s) fail(`Нет полки «${shelf}»`);
        return { shelf: s.name, items: st.data.items.filter((i) => i.shelfId === s.id).map(redact) };
      }
      return {
        shelves: st.data.shelves.map((s) => ({ name: s.name, count: st.data.items.filter((i) => i.shelfId === s.id).length }))
          .sort((x, y) => x.name.localeCompare(y.name, 'ru')),
      };
    },
    async find({ q }, c) {
      await ensureUnlocked(`${who(c)} ищет в Связке «${q}».`);
      const needle = q.toLowerCase();
      return st.data.items.filter((it) => {
        const r = redact(it);
        return [r.title, r.shelf, ...Object.values(r.fields)].join(' ').toLowerCase().includes(needle);
      }).map(redact);
    },
    async show({ ref }, c) {
      await ensureUnlocked(`${who(c)} смотрит запись «${ref}».`);
      const it = resolve(ref);
      audit(c, 'show', label(it));
      return redact(it);
    },

    async add({ type, title, shelf, fields }, c) {
      await ensureUnlocked(`${who(c)} добавляет запись «${title}».`);
      if (!core.FIELDS[type]) fail('Тип: password, ssh, token, payment или note');
      if (!title) fail('Нужно название');
      const s = findShelf(shelf || 'Разное', true);
      if (st.data.items.some((i) => i.shelfId === s.id && i.type === type && i.title.toLowerCase() === title.toLowerCase())) {
        fail(`На полке «${s.name}» уже есть «${title}». Изменить: svyazka set "${s.name}/${title}" …`);
      }
      const f = materialize(type, title, fields, { who: who(c), shelf: s.name });
      if (type === 'payment') Object.assign(f, { currency: f.currency || st.data.settings.currency, period: f.period ?? 1, remind: f.remind ?? 7 });
      const now = Date.now();
      const it = { id: core.uid(), shelfId: s.id, type, title, f, created: now, updated: now };
      st.data.items.push(it);
      await persist();
      audit(c, 'add', label(it), 'поля: ' + Object.keys(f).join(','));
      return redact(it);
    },
    async set({ ref, fields, title, shelf }, c) {
      await ensureUnlocked(`${who(c)} меняет запись «${ref}».`);
      const it = resolve(ref);
      Object.assign(it.f, materialize(it.type, it.title, fields, { who: who(c), shelf: shelfName(it.shelfId) }));
      if (title) it.title = title;
      if (shelf) it.shelfId = findShelf(shelf, true).id;
      it.updated = Date.now();
      await persist();
      audit(c, 'set', label(it), 'поля: ' + Object.keys(fields || {}).join(','));
      return redact(it);
    },
    async rm({ ref }, c) {
      await ensureUnlocked(`${who(c)} удаляет запись «${ref}».`);
      const it = resolve(ref);
      await confirmSecret(`удалить «${it.title}» из Связки (${who(c)})`);
      st.data.items = st.data.items.filter((i) => i.id !== it.id);
      core.tombstone(st.data, 'item', it.id);
      await persist();
      audit(c, 'rm', label(it));
      return `Удалено: ${label(it)}`;
    },

    async get({ ref, field }, c) {
      await ensureUnlocked(`${who(c)} хочет прочитать секрет «${ref}».`);
      const it = resolve(ref);
      const k = field || (core.SECRET_FIELDS[it.type] || [])[0] || Object.keys(it.f)[0];
      if (!(k in it.f)) fail(`В «${it.title}» нет поля ${k}`);
      await confirmSecret(`показать «${it.title}» → ${k} (${who(c)})`);
      audit(c, 'get', label(it), k);
      return { value: it.f[k] };
    },
    async copy({ ref, field }, c) {
      await ensureUnlocked(`${who(c)} копирует секрет «${ref}».`);
      const it = resolve(ref);
      const k = field || (core.SECRET_FIELDS[it.type] || [])[0] || Object.keys(it.f)[0];
      if (!(k in it.f)) fail(`В «${it.title}» нет поля ${k}`);
      await confirmSecret(`скопировать «${it.title}» → ${k} (${who(c)})`);
      if (!sys.clipboardSet(String(it.f[k]))) fail('Буфер обмена недоступен' + (sys.LINUX ? ' (нужен wl-copy или xclip)' : ''));
      clearTimeout(clipTimer);
      clipTimer = setTimeout(() => sys.clipboardSet(''), 30000);
      audit(c, 'copy', label(it), k);
      return `Скопировано в буфер: ${label(it)} → ${k}. Очистится через 30 с.`;
    },

    async sshadd({ ref, sock }, c) {
      await ensureUnlocked(`${who(c)} подключается по SSH: «${ref}».`);
      const it = resolve(ref);
      if (it.type !== 'ssh') fail(`«${it.title}» — не SSH-запись`);
      const added = sshAdd(it, sock);
      audit(c, 'ssh', label(it), added ? 'ключ в ssh-agent на 15 мин' : 'без ключа');
      return { host: it.f.host || '', user: it.f.user || '', port: it.f.port || '', keyAdded: added, title: it.title };
    },

    async run({ refs, envmap, cmd, cwd, env, sock }, c, conn) {
      await ensureUnlocked(`${who(c)} запускает команду с секретами: ${cmd[0]}.`);
      const its = refs.map(resolve);
      const senv = {};
      for (const it of its) {
        Object.assign(senv, secretEnv(it, {}));
        if (it.type === 'ssh') sshAdd(it, sock);
      }
      for (const [name, field] of Object.entries(envmap || {})) {
        const it = its.find((x) => x.f[field] != null && x.f[field] !== '');
        if (!it) fail(`Ни в одной записи нет поля ${field}`);
        senv[name] = String(it.f[field]);
      }
      audit(c, 'run', its.map(label).join(', '), 'команда: ' + path.basename(cmd[0]));
      const secrets = secretValues(its);
      const scrub = (s) => { for (const v of secrets) s = s.split(v).join('•••'); return s; };
      return await new Promise((res) => {
        const fullEnv = { ...env, ...senv };
        if (sock || env.SSH_AUTH_SOCK) fullEnv.SSH_AUTH_SOCK = sock || env.SSH_AUTH_SOCK;
        const [bin, argv, extra] = sys.resolveSpawn(cmd[0], cmd.slice(1), fullEnv);
        const child = spawn(bin, argv, { cwd, env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...extra });
        const pipe = (stream, type) => {
          let buf = '';
          let t = null;
          const flush = (all) => {
            const i = all ? buf.length : buf.lastIndexOf('\n') + 1;
            if (i > 0) { send(conn, { type, data: scrub(buf.slice(0, i)) }); buf = buf.slice(i); }
          };
          stream.setEncoding('utf8');
          stream.on('data', (d) => { buf += d; flush(false); clearTimeout(t); t = setTimeout(() => flush(true), 300); });
          stream.on('end', () => { clearTimeout(t); flush(true); });
        };
        pipe(child.stdout, 'out');
        pipe(child.stderr, 'err');
        child.on('error', (e) => res({ code: 127, error: `Не удалось запустить ${cmd[0]}: ${e.message}` }));
        child.on('close', (code) => setTimeout(() => res({ code: code ?? 1 }), 20));
      });
    },

    async pay(a, c) {
      await ensureUnlocked(`${who(c)} смотрит платежи.`);
      return st.data.items.filter((i) => i.type === 'payment').map((i) => ({
        ref: label(i), amount: i.f.amount, currency: i.f.currency, period: PERIOD_LABEL[+i.f.period] || '',
        nextDate: i.f.done ? null : i.f.nextDate || null, done: !!i.f.done,
        days: i.f.nextDate && !i.f.done ? Math.round((Date.parse(i.f.nextDate) - Date.parse(core.todayISO())) / 864e5) : null,
      })).sort((x, y) => (x.nextDate || '9') < (y.nextDate || '9') ? -1 : 1);
    },
    async paid({ ref }, c) {
      await ensureUnlocked(`${who(c)} отмечает оплату «${ref}».`);
      const it = resolve(ref);
      if (it.type !== 'payment') fail(`«${it.title}» — не оплата`);
      core.markPaid(it);
      await persist();
      audit(c, 'paid', label(it));
      return it.f.done ? `Отмечено: ${label(it)} оплачено` : `Отмечено. Следующий платёж: ${it.f.nextDate}`;
    },

    async import({ text, name }, c) {
      let src;
      try { src = JSON.parse(text); } catch { fail('Файл — не JSON'); }
      if (!readVault() && core.isVaultBlob(src)) {
        // первое хранилище — прямо из бэкапа (тот же пароль и соль: дальше sync без лишних вопросов)
        writeText(VAULT, text);
        await ensureUnlocked('Открываю хранилище из бэкапа.');
        audit(c, 'import', name, 'новое хранилище из бэкапа');
        return `Хранилище создано из бэкапа: ${st.data.items.length} записей`;
      }
      await ensureUnlocked(`${who(c)} импортирует файл ${name}.`);
      if (core.isPlainImport(src)) {
        const { shelves, items, newShelves, skipped } = core.planPlainImport(st.data, src);
        st.data.shelves = shelves;
        st.data.items.push(...items);
        await persist();
        audit(c, 'import', name, `открытый JSON: +${items.length}`);
        return `Добавлено записей: ${items.length}, новых полок: ${newShelves}, пропущено (дубли/пустые): ${skipped}.\n⚠ Файл ${name} не зашифрован — удалите его.`;
      }
      if (!core.isVaultBlob(src)) fail('Это не файл Связки');
      const theirs = await openForeign(src, `Импорт бэкапа ${name}.`);
      const { data, stats } = core.mergeData(st.data, theirs);
      st.data = data;
      await persist();
      audit(c, 'import', name, `слияние: +${stats.added} ~${stats.updated} -${stats.removed}`);
      return `Объединено: новых ${stats.added}, обновлено ${stats.updated}, удалено ${stats.removed}`;
    },

    async sync(a, c) {
      await ensureUnlocked(`${who(c)} делает бэкап Связки.`);
      const DIRS = syncDir();
      const mine = `svyazka-${HOST}.json`;
      fs.mkdirSync(DIRS, { recursive: true });
      const state = readJSON(STATE);
      const last = state.lastSync || 0;
      const lines = [];
      const files = fs.readdirSync(DIRS).filter((f) => f.endsWith('.json') && f !== mine);
      for (const f of files) {
        const p = path.join(DIRS, f);
        if (fs.statSync(p).mtimeMs <= last) continue;
        let blob;
        try { blob = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
        if (!core.isVaultBlob(blob)) continue;
        const theirs = await openForeign(blob, `Синхронизация: файл ${f}.`);
        const { data, stats } = core.mergeData(st.data, theirs);
        st.data = data;
        lines.push(`← ${f}: новых ${stats.added}, обновлено ${stats.updated}, удалено ${stats.removed}`);
      }
      const placeholders = fs.readdirSync(DIRS).filter((f) => f.endsWith('.json.icloud'));
      if (placeholders.length) lines.push(`⚠ Ещё не скачаны из iCloud: ${placeholders.join(', ')} — откройте папку в Finder и повторите`);
      st.data.meta.lastBackup = Date.now();
      await persist();
      fs.copyFileSync(VAULT, path.join(DIRS, mine));
      writeJSON(STATE, { ...state, lastSync: Date.now() });
      lines.push(`→ ${path.join(DIRS, mine)} (${st.data.items.length} записей, зашифровано)`);
      audit(c, 'sync', '', lines.length - 1 + ' файл(ов) с других компьютеров');
      return lines.join('\n') + '\nНа другом компьютере с той же папкой: svyazka sync — изменения сольются.';
    },

    async ui(a, c) {
      if (!ui) ui = await startUI();
      audit(c, 'ui');
      return { url: ui.url };
    },
    async log({ n }) {
      try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-(n || 30)).join('\n'); } catch { return 'Журнал пуст'; }
    },
  };

  function startUI() {
    const token = core.b64e(core.rand(24)).replace(/[+/=]/g, '');
    const allow = new Set(['/index.html', '/app.js', '/core.js', '/styles.css', '/icons/icon.svg', '/icons/icon-512.png']);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
    return new Promise((res, rej) => {
      const srv = http.createServer((req, rsp) => {
        const host = req.headers.host || '';
        if (host !== `127.0.0.1:${srv.address().port}`) { rsp.writeHead(403); return rsp.end(); }
        const url = new URL(req.url, 'http://x');
        if (url.pathname === '/api/unlock' || url.pathname === '/api/lock') {
          if (req.headers['x-svyazka-token'] !== token || req.method !== 'POST') { rsp.writeHead(403); return rsp.end(); }
          if (url.pathname === '/api/lock') { lockNow(); audit('приложение', 'lock'); rsp.writeHead(204); return rsp.end(); }
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
          req.on('end', async () => {
            let a = {};
            try { a = JSON.parse(body || '{}'); } catch {}
            const json = (code, v) => { rsp.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); rsp.end(JSON.stringify(v)); };
            // Окно приложения всегда требует владельца: отпечаток или верный мастер-пароль — даже если агент уже открыт.
            try {
              const byPassword = typeof a.password === 'string';
              if (st.key) {
                await reload();
                if (byPassword) {
                  const raw = await core.deriveRaw(a.password, st.salt, st.iter);
                  if (raw.length !== st.raw.length || !raw.every((b, i) => b === st.raw[i])) fail('Неверный мастер-пароль', 'BAD_PASSWORD');
                  if (quickEnabled() && (GUI || TEST)) qStore(quickId(st.saltB64), core.b64e(st.raw));
                } else {
                  if (!quickEnabled() || !(GUI || TEST)) fail('Нужен мастер-пароль', 'NEED_PASSWORD');
                  const v = qVerify('открыть Связку');
                  if (v === 'denied') fail('Не подтверждено', 'DENIED');
                  if (v !== 'ok') fail('Нужен мастер-пароль', 'NEED_PASSWORD');
                }
                st.lastUse = Date.now();
              } else {
                await ensureUnlocked('Связка', byPassword ? { password: a.password } : { passwordFallback: false });
              }
              audit('приложение', 'unlock', '', byPassword ? 'паролем' : sys.VERIFY_NAME);
              json(200, { raw: core.b64e(st.raw), salt: st.saltB64, iter: st.iter, verify: sys.VERIFY_NAME });
            } catch (e) { json(401, { code: e.code || 'ERROR', error: e.message }); }
          });
          return;
        }
        if (url.pathname === '/api/vault') {
          if (req.headers['x-svyazka-token'] !== token) { rsp.writeHead(403); return rsp.end(); }
          if (req.method === 'GET') {
            const t = readVault();
            rsp.writeHead(t ? 200 : 204, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            return rsp.end(t || undefined);
          }
          if (req.method === 'PUT') {
            let body = '';
            req.setEncoding('utf8');
            req.on('data', (d) => { body += d; if (body.length > 16e6) req.destroy(); });
            req.on('end', () => {
              try { if (!core.isVaultBlob(JSON.parse(body))) throw 0; } catch { rsp.writeHead(400); return rsp.end(); }
              writeText(VAULT, body);
              rsp.writeHead(204); rsp.end();
            });
            return;
          }
          if (req.method === 'DELETE') {
            if (fs.existsSync(VAULT)) fs.renameSync(VAULT, VAULT + '.deleted-' + Date.now());
            lockNow();
            rsp.writeHead(204); return rsp.end();
          }
          rsp.writeHead(405); return rsp.end();
        }
        const p = url.pathname === '/' ? '/index.html' : url.pathname;
        if (!allow.has(p)) { rsp.writeHead(404); return rsp.end(); }
        fs.readFile(path.join(WEBROOT, p), (e, buf) => {
          if (e) { rsp.writeHead(404); return rsp.end(); }
          rsp.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
          rsp.end(buf);
        });
      });
      const saved = +readJSON(STATE).uiPort || 0;
      const done = () => {
        const port = srv.address().port;
        if (port !== saved) writeJSON(STATE, { ...readJSON(STATE), uiPort: port });
        res({ url: `http://127.0.0.1:${port}/?t=${token}` });
      };
      srv.once('error', (e) => {
        if (saved && e.code === 'EADDRINUSE') { srv.once('error', rej); srv.listen(0, '127.0.0.1', done); }
        else rej(e);
      });
      srv.listen(saved, '127.0.0.1', done);
    });
  }

  const server = net.createServer((conn) => {
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('error', () => {});
    conn.on('data', async (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      const line = buf.slice(0, i);
      buf = '';
      let req;
      try { req = JSON.parse(line); } catch { return conn.end(); }
      if (sys.WIN && req.token !== AGENT_TOKEN) return conn.destroy();
      const op = ops[req.op];
      try {
        if (!op) fail('Неизвестная операция ' + req.op);
        const who = ['Claude', 'Codex'].includes(req.caller) ? req.caller : 'терминал';
        const result = await answers.run({ ...(req.answers || {}) }, () => op(req.args || {}, who, conn));
        send(conn, { type: 'done', ok: true, result });
      } catch (e) {
        send(conn, { type: 'done', ok: false, error: e instanceof UserError ? e.message : 'Ошибка агента: ' + e.message, code: e.code, extra: e.extra });
      }
      conn.end();
    });
  });
  if (sys.WIN) {
    server.listen(0, '127.0.0.1', () => writeJSON(AGENT_FILE, { port: server.address().port, token: AGENT_TOKEN, pid: process.pid }));
  } else {
    server.listen(SOCK, () => fs.chmodSync(SOCK, 0o600));
  }
  function cleanupExit() {
    try { sys.WIN ? fs.unlinkSync(AGENT_FILE) : fs.unlinkSync(SOCK); } catch {}
    process.exit(0);
  }
  process.on('SIGTERM', cleanupExit);
  process.on('SIGINT', cleanupExit);
}

function send(conn, msg) { if (!conn.destroyed) conn.write(JSON.stringify(msg) + '\n'); }

function genPassword(n = 24) {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?';
  const max = 256 - (256 % cs.length);
  let out = '';
  while (out.length < n) for (const x of core.rand(n * 2)) if (x < max && out.length < n) out += cs[x % cs.length];
  return out;
}

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1), { mode: 0o600 });

/* ═════════════════════════ клиент ═════════════════════════ */

// Кто вызвал: Claude Code, Codex или человек в терминале — для окон подтверждения и журнала.
const caller = (() => {
  if (process.env.CLAUDECODE) return 'Claude';
  if (Object.keys(process.env).some((k) => k.startsWith('CODEX_'))) return 'Codex';
  for (const name of sys.parentNames()) {
    if (name.includes('codex')) return 'Codex';
    if (name === 'claude' || name.includes('claude code')) return 'Claude';
  }
  return 'терминал';
})();

function connect() {
  return new Promise((res, rej) => {
    let c;
    if (sys.WIN) {
      const a = readJSON(AGENT_FILE);
      if (!a.port) return rej(new Error('агент не запущен'));
      c = net.createConnection({ port: a.port, host: '127.0.0.1' });
      c.token = a.token;
    } else c = net.createConnection(SOCK);
    c.once('connect', () => res(c));
    c.once('error', rej);
  });
}
async function ensureAgent() {
  try { return await connect(); } catch {}
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [SCRIPT, '__agent'], { detached: true, stdio: 'ignore', windowsHide: true, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDECODE' && !k.startsWith('CODEX_'))) });
  child.unref();
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 50));
    try { return await connect(); } catch {}
  }
  throw new UserError('Агент Связки не запустился');
}
function ttyAsk(question) {
  return new Promise((res) => {
    process.stderr.write(question);
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl._writeToOutput = () => {};
    rl.on('line', (l) => { rl.close(); process.stderr.write('\n'); res(l); });
    rl.on('SIGINT', () => { rl.close(); process.stderr.write('\n'); res(null); });
  });
}

async function callOnce(op, args, ans) {
  const c = await ensureAgent();
  return new Promise((res, rej) => {
    let buf = '';
    c.setEncoding('utf8');
    c.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (m.type === 'out') process.stdout.write(m.data);
        else if (m.type === 'err') process.stderr.write(m.data);
        else if (m.type === 'done') m.ok ? res(m.result) : rej(new UserError(m.error, m.code, m.extra));
      }
    });
    c.on('error', rej);
    c.on('close', () => rej(new UserError('Агент оборвал соединение')));
    c.write(JSON.stringify({ op, args, caller, answers: ans, token: c.token }) + '\n');
  });
}

// Окон нет (SSH, сервер) — агент просит ввод, спрашиваем в терминале и повторяем запрос.
async function call(op, args = {}) {
  const ans = {};
  for (let tries = 0; ; tries++) {
    try { return await callOnce(op, args, ans); }
    catch (e) {
      const retry = e.code === 'NEED_INPUT' || (e.code === 'BAD_PASSWORD' && 'password' in ans);
      if (!retry || tries > 6) throw e;
      if (!process.stdin.isTTY) {
        throw new UserError('Связка ждёт ввода пароля, а окна недоступны и терминала нет.\n'
          + 'Откройте её сами в терминале: svyazka unlock — и повторите команду.');
      }
      if (e.code === 'BAD_PASSWORD') { delete ans.password; process.stderr.write('Неверный мастер-пароль.\n'); }
      const { kind, text } = e.extra || { kind: 'password', text: 'Мастер-пароль:' };
      const v = await ttyAsk(text.replace(/\n\n/g, '\n') + ' ');
      if (v == null) throw new UserError('Отменено');
      ans[kind] = v;
    }
  }
}

// --login x --private-key @~/.ssh/id --password gen --value - --passphrase ask
function parseFields(type, argv) {
  const fields = {};
  const rest = {};
  const known = new Set((core.FIELDS[type] || []).map((f) => f.k));
  const secrets = new Set(core.SECRET_FIELDS[type] || []);
  const camel = (s) => s.replace(/-([a-z])/g, (_, x) => x.toUpperCase());
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`Непонятный аргумент: ${a}`);
    let [k, v] = a.slice(2).split(/=(.*)/s);
    if (v === undefined) v = argv[++i];
    if (v === undefined) fail(`Нет значения для ${a}`);
    k = camel(k);
    if (['shelf', 'title', 'json'].includes(k)) { rest[k] = v; continue; }
    if (!known.has(k)) fail(`У типа ${type} нет поля ${k}. Поля: ${[...known].join(', ')}`);
    if (v === 'ask') fields[k] = { ask: 1 };
    else if (/^gen(:\d+)?$/.test(v)) fields[k] = { gen: +(v.split(':')[1] || 24) };
    else if (v === '-') fields[k] = fs.readFileSync(0, 'utf8').replace(/\n$/, '');
    else if (v.startsWith('@')) {
      const p = v.slice(1).replace(/^~(?=\/)/, HOME);
      fields[k] = fs.readFileSync(p, 'utf8').replace(/\n$/, '');
      if (k === 'privateKey' && !fields.publicKey && fs.existsSync(p + '.pub')) fields.publicKey = fs.readFileSync(p + '.pub', 'utf8').trim();
    } else if (secrets.has(k)) {
      fail(`Секрет ${k} не передаётся текстом в командной строке (останется в истории). Используйте ${a.split('=')[0]} @файл, - (из stdin), ask (ввести в окне) или gen (сгенерировать).`);
    } else fields[k] = v;
  }
  return { fields, rest };
}

function printItem(r) {
  console.log(`${r.shelf} / ${r.title}  [${TYPE_LABEL[r.type] || r.type}]`);
  for (const [k, v] of Object.entries(r.fields)) {
    const s = String(v);
    console.log(`  ${k}: ${s.includes('\n') ? '\n    ' + s.split('\n').join('\n    ') : s}`);
  }
  if (r.secrets.length) console.log(`  секреты (скрыты): ${r.secrets.join(', ')}`);
  if (r.history?.length) console.log(`  оплаты: ${r.history.map((h) => h.date).join(', ')}`);
  console.log(`  изменено: ${r.updated}`);
}
const subtitle = (r) => {
  const f = r.fields;
  return ({
    password: f.login || f.url, ssh: f.host ? `${f.user ? f.user + '@' : ''}${f.host}${f.port ? ':' + f.port : ''}` : '',
    token: f.usage, payment: f.amount ? `${f.amount} ${f.currency} / ${PERIOD_LABEL[+f.period] || ''}${f.nextDate ? ', след. ' + f.nextDate : ''}` : (f.nextDate || ''),
    note: (f.text || '').split('\n')[0],
  })[r.type] || '';
};

const HELP = `svyazka — Связка: ключница для людей и ИИ-агентов (секреты не показываются без Touch ID / Windows Hello)

  svyazka status | unlock | lock | stop   состояние, открыть (окно с паролем), закрыть, остановить агент
  svyazka init                            создать пустое хранилище на Mac
  svyazka import <файл>                   бэкап Связки (слияние) или открытый svyazka-import.json
  svyazka ls [полка]                      полки / записи полки (без секретов)
  svyazka find <текст>                    поиск по названиям и открытым полям
  svyazka show <запись>                   открытые поля и какие секреты есть
  svyazka add <тип> <название> --shelf П [--поле значение]...
        типы: password ssh token payment note
        секреты: --password gen | --private-key @~/.ssh/key | --value - (stdin) | --passphrase ask (окно)
  svyazka set <запись> [--поле значение]... [--title Н] [--shelf П]
  svyazka rm <запись>                     удалить (Touch ID / Windows Hello)
  svyazka run <запись> [--ref <ещё>]... [--env ИМЯ=поле]... -- команда ...
        секреты попадают в переменные окружения команды; в выводе они заменяются на •••
        по умолчанию: SVYAZKA_LOGIN/PASSWORD/URL, SVYAZKA_TOKEN (+ строки KEY=VAL из токена),
        SVYAZKA_HOST/USER/PORT; ssh-ключи — в ssh-agent на 15 мин
  svyazka ssh <запись> [-- аргументы ssh]  подключиться ключом из Связки (ключ не пишется на диск)
  svyazka ssh-add <запись>                ключ в ssh-agent на 15 мин (для scp, rsync, git)
  svyazka get <запись> [поле]             показать секрет (Touch ID / Windows Hello)
  svyazka copy <запись> [поле]            в буфер обмена на 30 с (Touch ID / Windows Hello)
  svyazka pay | paid <запись>             платежи / отметить оплату
  svyazka sync                            бэкап и обмен между компьютерами через папку (iCloud Drive, OneDrive…)
  svyazka config [sync-dir <папка>]       настройки: где лежат файлы, папка для sync
  svyazka config quick-unlock on|off      открывать Связку по Touch ID / Windows Hello (по умолчанию включено)
  svyazka ui                              открыть интерфейс Связки в браузере
  svyazka log [N]                         журнал действий

  <запись> — название, часть названия или «Полка/Название». --json — вывод в JSON.`;

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === '__agent') return runAgent();
  const json = argv.includes('--json');
  const args = argv.slice(1).filter((a) => a !== '--json');
  const out = (v, human) => (json ? console.log(JSON.stringify(v, null, 1)) : human(v));

  switch (cmd) {
    case undefined: case 'help': case '-h': case '--help':
      return console.log(HELP);
    case 'status': return out(await call('status'), (s) => console.log(
      !s.exists ? `Хранилища нет (${s.vault}). Создать: svyazka init или svyazka import <бэкап>`
        : s.unlocked ? `Открыто: ${s.items} записей на ${s.shelves} полках, заблокируется через ${s.lockInMin} мин без использования${s.ui ? '\nИнтерфейс: открыт' : ''}`
          : 'Заблокировано. Откроется само при первой команде (окно с паролем) или: svyazka unlock'));
    case 'stop':
      try { await connect().then((c) => c.destroy()); } catch { return console.log('Агент не запущен'); }
      return console.log(await call('stop'));
    case 'unlock': case 'lock': case 'init':
      return console.log(await call(cmd));
    case 'ls': return out(await call('list', { shelf: args.join(' ') || null }), (r) => {
      if (r.shelves) {
        if (!r.shelves.length) return console.log('Пусто');
        for (const s of r.shelves) console.log(`${s.name}  (${s.count})`);
      } else {
        console.log(`${r.shelf}:`);
        for (const i of r.items) console.log(`  [${TYPE_LABEL[i.type]}] ${i.title}${subtitle(i) ? ' — ' + subtitle(i) : ''}${i.secrets.length ? '  🔒' + i.secrets.join(',') : ''}`);
      }
    });
    case 'find': return out(await call('find', { q: args.join(' ') }), (r) => {
      if (!r.length) return console.log('Ничего не найдено');
      for (const i of r) console.log(`${i.shelf}/${i.title}  [${TYPE_LABEL[i.type]}]${subtitle(i) ? ' — ' + subtitle(i) : ''}`);
    });
    case 'show': return out(await call('show', { ref: args.join(' ') }), printItem);
    case 'add': {
      const [type, title, ...rest] = args;
      if (!type || !title) fail('svyazka add <тип> <название> --shelf Полка [--поле значение]...');
      const { fields, rest: o } = parseFields(type, rest);
      return out(await call('add', { type, title, shelf: o.shelf, fields }), (r) => { console.log('Добавлено:'); printItem(r); });
    }
    case 'set': {
      const [ref, ...rest] = args;
      if (!ref) fail('svyazka set <запись> --поле значение ...');
      const shown = await call('show', { ref });
      const { fields, rest: o } = parseFields(shown.type, rest);
      return out(await call('set', { ref: shown.id, fields, title: o.title, shelf: o.shelf }), (r) => { console.log('Изменено:'); printItem(r); });
    }
    case 'rm': return console.log(await call('rm', { ref: args.join(' ') }));
    case 'get': {
      const [ref, field] = args;
      const r = await call('get', { ref, field });
      return process.stdout.write(String(r.value) + (process.stdout.isTTY ? '\n' : ''));
    }
    case 'copy': { const [ref, field] = args; return console.log(await call('copy', { ref, field })); }
    case 'ssh-add': {
      const r = await call('sshadd', { ref: args.join(' '), sock: process.env.SSH_AUTH_SOCK });
      return console.log(r.keyAdded ? `Ключ «${r.title}» в ssh-agent на 15 мин` : `У «${r.title}» нет ключа`);
    }
    case 'ssh': {
      const dd = args.indexOf('--');
      const ref = (dd < 0 ? args : args.slice(0, dd)).join(' ');
      const extra = dd < 0 ? [] : args.slice(dd + 1);
      const r = await call('sshadd', { ref, sock: process.env.SSH_AUTH_SOCK });
      if (!r.host) fail(`У «${r.title}» не указан хост`);
      const target = (r.user ? r.user + '@' : '') + r.host;
      const sshArgs = [...(r.port ? ['-p', r.port] : []), target, ...extra];
      const p = spawnSync('ssh', sshArgs, { stdio: 'inherit' });
      return process.exit(p.status ?? 1);
    }
    case 'run': {
      const dd = args.indexOf('--');
      if (dd < 0 || dd === args.length - 1) fail('svyazka run <запись> [--env ИМЯ=поле] -- команда ...');
      const head = args.slice(0, dd);
      const command = args.slice(dd + 1);
      const refs = [];
      const envmap = {};
      for (let i = 0; i < head.length; i++) {
        if (head[i] === '--env') { const [n, f] = (head[++i] || '').split('='); if (!n || !f) fail('--env ИМЯ=поле'); envmap[n] = f; }
        else if (head[i] === '--ref') refs.push(head[++i]);
        else refs.push(head[i]);
      }
      if (!refs.length) fail('Укажите запись');
      const r = await call('run', { refs: refs.length > 1 ? refs : [refs.join(' ')], envmap, cmd: command, cwd: process.cwd(), env: process.env, sock: process.env.SSH_AUTH_SOCK });
      if (r.error) console.error(r.error);
      return process.exit(r.code);
    }
    case 'pay': return out(await call('pay'), (r) => {
      if (!r.length) return console.log('Платежей нет');
      for (const p of r) {
        const when = p.done ? 'оплачено' : p.nextDate ? `${p.nextDate} (${p.days < 0 ? 'просрочено ' + -p.days + ' дн.' : p.days === 0 ? 'сегодня' : 'через ' + p.days + ' дн.'})` : 'дата не указана';
        console.log(`${p.ref}: ${p.amount || '?'} ${p.currency || ''} / ${p.period} — ${when}`);
      }
    });
    case 'paid': return console.log(await call('paid', { ref: args.join(' ') }));
    case 'import': {
      const file = args.join(' ').replace(/^~(?=\/)/, HOME);
      if (!file) fail('svyazka import <файл>');
      return console.log(await call('import', { text: fs.readFileSync(file, 'utf8'), name: path.basename(file) }));
    }
    case 'sync': return console.log(await call('sync'));
    case 'config': {
      if (args[0] === 'sync-dir') {
        const dir = path.resolve(args.slice(1).join(' ').replace(/^~(?=\/|$)/, HOME));
        if (!args[1]) fail('svyazka config sync-dir <папка>');
        fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
        writeJSON(CONFIG, { ...readJSON(CONFIG), syncDir: dir });
        return console.log('Папка для sync: ' + dir);
      }
      if (args[0] === 'quick-unlock') {
        const on = { on: true, off: false }[args[1]];
        if (on === undefined) fail('svyazka config quick-unlock on|off');
        fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
        writeJSON(CONFIG, { ...readJSON(CONFIG), quickUnlock: on });
        if (!on) {
          try { const salt = JSON.parse(fs.readFileSync(VAULT, 'utf8')).salt; if (TEST) fs.rmSync(path.join(DIR, 'quick-test.json'), { force: true }); else sys.quickDelete(quickId(salt), { touchid: TOUCHID, dir: DIR }); } catch {}
        }
        return console.log(on ? `Открытие по ${sys.VERIFY_NAME}: включено (сработает после следующего ввода пароля)` : `Открытие по ${sys.VERIFY_NAME}: выключено, сохранённый ключ удалён`);
      }
      if (args[0]) fail('svyazka config [sync-dir <папка> | quick-unlock on|off]');
      const quick = readJSON(CONFIG).quickUnlock !== false && sys.QUICK;
      return out({ vault: VAULT, syncDir: syncDir(), log: LOG, app: WEBROOT, quickUnlock: quick }, (c) =>
        console.log(`хранилище: ${c.vault}\nпапка sync: ${c.syncDir}\nжурнал:     ${c.log}\nпрограмма:  ${c.app}\nоткрытие по ${sys.VERIFY_NAME}: ${sys.QUICK ? (c.quickUnlock ? 'включено' : 'выключено') : 'недоступно на этой системе'}`));
    }
    case 'ui': {
      const r = await call('ui');
      if (args.includes('--print')) return console.log(r.url);
      sys.openUrl(r.url);
      return console.log('Интерфейс открыт в браузере (адрес работает только на этом Mac, пока запущен агент)');
    }
    case 'log': return console.log(await call('log', { n: +args[0] || 30 }));
    default:
      fail(`Неизвестная команда «${cmd}». Справка: svyazka help`);
  }
}

main().catch((e) => {
  console.error(e instanceof UserError ? e.message : (e.code === 'ENOENT' ? `Файл не найден: ${e.path}` : e.stack || String(e)));
  process.exit(1);
});
