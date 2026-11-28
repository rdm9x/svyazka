// Ядро Связки: формат хранилища, шифрование и слияние.
// Один и тот же файл работает в браузере (телефон, веб-интерфейс) и в Node 20+ (svyazka на Mac).

import { makeT } from './i18n.js';
import EN from './lang/en-cli.js';

// Видимые человеку строки ядра (ошибки, названия по умолчанию). Язык общий с окном и svyazka.
const t = makeT({ en: EN });

export const ITER = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64e(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64d(s) {
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export const uid = () => b64e(rand(9)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));

/* ───────── шифрование ───────── */

export async function deriveKey(pw, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

// Формат файла (v2): { app, v, kdf, iter, salt, iv, ct }.
// Заголовок (app, v, kdf, iter, salt) входит в AAD шифра: подменить параметры незаметно нельзя — расшифровка не пройдёт.
export const FORMAT = 2;
const MIN_ITER = 100000;
const aad = (h) => enc.encode(JSON.stringify(['svyazka', h.v, h.kdf, h.iter, h.salt]));

// Ключ в «сыром» виде (32 байта) — для разблокировки по Touch ID / Windows Hello. Тот же ключ, что deriveKey.
export async function deriveRaw(pw, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 256));
}
export const importRaw = (raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

// sess = { key, salt, iter, data }
export async function seal(sess) {
  const iv = rand(12);
  const head = { app: 'svyazka', v: FORMAT, kdf: 'PBKDF2-SHA256', iter: sess.iter, salt: b64e(sess.salt) };
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(head) }, sess.key, enc.encode(JSON.stringify(sess.data)));
  return { ...head, iv: b64e(iv), ct: b64e(new Uint8Array(ct)) };
}

export async function openVault(blob, pw) {
  checkBlob(blob);
  const salt = b64d(blob.salt);
  const key = await deriveKey(pw, salt, blob.iter);
  const data = await decryptWith(blob, key);
  return { key, salt, iter: blob.iter, data };
}

// Расшифровать уже известным ключом (соль блока должна совпадать с солью ключа).
export async function decryptWith(blob, key) {
  checkBlob(blob);
  const params = { name: 'AES-GCM', iv: b64d(blob.iv) };
  if (blob.v >= 2) params.additionalData = aad(blob);
  const pt = await crypto.subtle.decrypt(params, key, b64d(blob.ct));
  return normalize(JSON.parse(dec.decode(pt)));
}

function checkBlob(b) {
  if (!isVaultBlob(b)) throw new Error(t('Это не файл Связки'));
  if (b.v > FORMAT) throw new Error(t('Файл из более новой версии Связки — обновите программу'));
  if (b.kdf !== 'PBKDF2-SHA256' || !(b.iter >= MIN_ITER)) throw new Error(t('Неподдерживаемые параметры шифрования'));
}

export const isVaultBlob = (b) => !!(b && b.app === 'svyazka' && b.ct && b.salt && b.iv);
export const isPlainImport = (b) => !!(b && b.format === 'svyazka-import');

/* ───────── данные ───────── */

// Сумма из ввода: «1 990,50», «1,200» (тысячи), «4.51», «1.200,50» → строка с точкой
export function normAmount(v) {
  let x = String(v ?? '').replace(/[\s\u00a0']/g, '');
  if (x.includes(',') && x.includes('.')) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (/,\d{3}$/.test(x) && !/,\d{1,2}$/.test(x)) x = x.replace(/,/g, '');
  else x = x.replace(',', '.');
  return x.replace(/[^\d.]/g, '');
}

export const newVault = (currency = 'RUB') => normalize({ v: 1, shelves: [], items: [], deleted: [], settings: { autoLock: 5, currency }, meta: { created: Date.now(), lastBackup: 0 } });

export function normalize(d) {
  d.shelves ||= [];
  // цвет полки идёт в style — только #rrggbb (данные могли прийти из чужого бэкапа)
  for (const sh of d.shelves) if (!/^#[0-9a-f]{6}$/i.test(sh.color || '')) sh.color = '#a3aec2';
  d.items ||= [];
  d.deleted ||= [];
  d.settings = { autoLock: 5, currency: 'RUB', ...(d.settings || {}) };
  d.meta = { created: Date.now(), lastBackup: 0, ...(d.meta || {}) };
  return d;
}

const stamp = (x) => x.updated || x.created || 0;

export function tombstone(d, kind, id) {
  d.deleted.push({ kind, id, at: Date.now() });
}

// Слияние двух хранилищ: по каждой записи побеждает более свежая версия, удаления переносятся.
// Полки с одинаковым именем, но разными id, склеиваются.
export function mergeData(local, incoming) {
  normalize(local);
  normalize(incoming);
  const stats = { added: 0, updated: 0, removed: 0 };

  const tomb = new Map();
  for (const x of [...local.deleted, ...incoming.deleted]) {
    const k = x.kind + ':' + x.id;
    if (!tomb.has(k) || tomb.get(k).at < x.at) tomb.set(k, x);
  }

  // полки
  const shelves = new Map(local.shelves.map((s) => [s.id, s]));
  const remap = new Map();
  for (const s of incoming.shelves) {
    const mine = shelves.get(s.id);
    if (mine) { if (stamp(s) > stamp(mine)) shelves.set(s.id, s); continue; }
    const twin = [...shelves.values()].find((x) => x.name.trim().toLowerCase() === s.name.trim().toLowerCase());
    if (twin) remap.set(s.id, twin.id);
    else shelves.set(s.id, s);
  }

  // записи
  const items = new Map(local.items.map((i) => [i.id, i]));
  for (const raw of incoming.items) {
    const i = remap.has(raw.shelfId) ? { ...raw, shelfId: remap.get(raw.shelfId) } : raw;
    const mine = items.get(i.id);
    if (!mine) { items.set(i.id, i); stats.added++; }
    else if (stamp(i) > stamp(mine)) { items.set(i.id, i); stats.updated++; }
  }

  for (const [id, x] of shelves) { const d = tomb.get('shelf:' + id); if (d && d.at >= stamp(x)) shelves.delete(id); }
  for (const [id, x] of items) { const d = tomb.get('item:' + id); if (d && d.at >= stamp(x)) { items.delete(id); stats.removed++; } }

  // записи без полки — на «Разное» (имя полки — данные; новая полка получает имя на языке интерфейса)
  let orphanShelf = null;
  for (const i of items.values()) {
    if (shelves.has(i.shelfId)) continue;
    orphanShelf ||= [...shelves.values()].find((s) => s.name === 'Разное' || s.name === t('Разное'))
      || { id: uid(), name: t('Разное'), color: '#a3aec2', created: Date.now() };
    shelves.set(orphanShelf.id, orphanShelf);
    i.shelfId = orphanShelf.id;
  }

  const halfYear = Date.now() - 180 * 864e5;
  const data = {
    ...local,
    shelves: [...shelves.values()],
    items: [...items.values()],
    deleted: [...tomb.values()].filter((t) => t.at > halfYear),
    meta: { ...local.meta, lastBackup: Math.max(local.meta.lastBackup || 0, incoming.meta.lastBackup || 0) },
  };
  return { data, stats };
}

/* ───────── типы записей (общие для телефона и Mac) ───────── */

// k — поле, secret — секрет (не показывается без подтверждения), date — дата YYYY-MM-DD
export const FIELDS = {
  // totp — секрет для кодов 2FA; hidden — скрытые заметки (видны только после Touch ID, агентам — никогда)
  password: [{ k: 'login' }, { k: 'password', secret: 1 }, { k: 'url' }, { k: 'totp', secret: 1 }, { k: 'note' }, { k: 'hidden', secret: 1 }],
  ssh: [{ k: 'host' }, { k: 'user' }, { k: 'port' }, { k: 'privateKey', secret: 1 }, { k: 'publicKey' }, { k: 'passphrase', secret: 1 }, { k: 'note' }, { k: 'hidden', secret: 1 }],
  token: [{ k: 'value', secret: 1 }, { k: 'usage' }, { k: 'expires', date: 1 }, { k: 'note' }, { k: 'hidden', secret: 1 }],
  payment: [{ k: 'amount' }, { k: 'currency' }, { k: 'period' }, { k: 'nextDate', date: 1 }, { k: 'remind' }, { k: 'autoRenew' }, { k: 'method' }, { k: 'url' }, { k: 'note' }],
  note: [{ k: 'text' }, { k: 'hidden', secret: 1 }],
};
export const SECRET_FIELDS = Object.fromEntries(Object.entries(FIELDS).map(([t, fs]) => [t, fs.filter((f) => f.secret).map((f) => f.k)]));
export const PERIOD_MONTHS = [1, 3, 6, 12, 24, 36, 0];
export const COLORS = ['#7aa2ff', '#5fe0a8', '#ffc266', '#ff7eb6', '#b18cff', '#5ad1f0', '#ff8a5c', '#a3aec2'];

export function addMonths(iso, n, anchor) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(anchor || d, last));
  return t.toISOString().slice(0, 10);
}

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Отметить оплату: сдвинуть дату на период, записать в историю.
export function markPaid(it) {
  const f = it.f;
  const t = todayISO();
  f.history = [{ date: t, amount: f.amount, currency: f.currency, due: f.nextDate }, ...(f.history || [])].slice(0, 36);
  f.lastPaid = t;
  if (+f.period && f.nextDate) f.nextDate = addMonths(f.nextDate, +f.period, f.anchor);
  else f.done = true;
  it.updated = Date.now();
}

// Название записи по умолчанию — функцией: язык выбирается уже после загрузки модуля
const label = (type) => ({ password: t('Пароль'), ssh: 'SSH', token: t('Токен'), payment: t('Оплата'), note: t('Заметка') })[type];

// Запись из открытого JSON импорта (формат IMPORT.md). null — если пустая или неизвестного типа.
export function itemFromImport(raw, shelfId, defaultCurrency = 'RUB') {
  if (!raw || typeof raw !== 'object' || !FIELDS[raw.type]) return null;
  const type = raw.type;
  const s = (v) => (v == null ? '' : String(v).replace(/\r\n/g, '\n').trim());
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : '');
  const f = {};
  if (type === 'payment') {
    const p = +raw.period;
    f.amount = normAmount(raw.amount);
    f.currency = s(raw.currency).toUpperCase() || defaultCurrency;
    f.period = PERIOD_MONTHS.includes(p) ? p : 1;
    f.nextDate = iso(raw.nextDate);
    if (f.nextDate) f.anchor = +f.nextDate.slice(8, 10);
    f.remind = raw.remind == null || raw.remind === '' ? 7 : Math.max(0, parseInt(raw.remind, 10) || 0);
    f.autoRenew = !!raw.autoRenew;
    for (const k of ['method', 'url', 'note']) if (s(raw[k])) f[k] = s(raw[k]);
  } else {
    for (const fd of FIELDS[type]) {
      const v = fd.date ? iso(raw[fd.k]) : s(raw[fd.k]);
      if (v) f[fd.k] = v;
    }
  }
  const hasData = Object.entries(f).some(([k, v]) => !['currency', 'period', 'remind', 'autoRenew'].includes(k) && v !== '');
  if (!hasData) return null;
  const title = s(raw.title)
    || (type === 'ssh' && f.host ? `${f.user || 'root'}@${f.host}` : '')
    || (type === 'password' && f.url ? f.url.replace(/^https?:\/\//, '').split('/')[0] : '')
    || label(type);
  const now = Date.now();
  return { id: uid(), shelfId, type, title, f, created: now, updated: now };
}

// Применить открытый импорт к данным (без подтверждения). Возвращает новые полки/записи и счётчики.
export function planPlainImport(data, src) {
  const shelves = [...data.shelves];
  const items = [];
  let newShelves = 0, skipped = 0;
  for (const sh of Array.isArray(src.shelves) ? src.shelves : []) {
    const name = String(sh?.name ?? '').trim() || t('Разное');
    let target = shelves.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!target) {
      target = { id: uid(), name, color: COLORS.includes(sh.color) ? sh.color : COLORS[shelves.length % COLORS.length], created: Date.now(), updated: Date.now() };
      shelves.push(target);
      newShelves++;
    }
    for (const raw of Array.isArray(sh?.items) ? sh.items : []) {
      const it = itemFromImport(raw, target.id, data.settings?.currency);
      if (!it) { skipped++; continue; }
      const dup = [...data.items, ...items].some((x) => x.shelfId === target.id && x.type === it.type && x.title.toLowerCase() === it.title.toLowerCase());
      if (dup) { skipped++; continue; }
      items.push(it);
    }
  }
  return { shelves, items, newShelves, skipped };
}
