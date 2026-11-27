// Связка — ключи, пароли и оплаты. Всё шифруется на устройстве, сети не нужно.

import { ITER, uid, rand, deriveKey, seal, openVault, decryptWith, importRaw, b64d, newVault, normalize, mergeData, tombstone, isVaultBlob, isPlainImport,
  addMonths, todayISO, markPaid, planPlainImport } from './core.js';

const VERSION = '1.4.1';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');

/* ───────────── utils ───────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = (n) => String(n).padStart(2, '0');
const daysTo = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(todayISO() + 'T00:00:00Z')) / 864e5);

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('ru-RU', opts);
}
function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return Math.abs(daysTo(iso)) < 300
    ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
    : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
const fmtDateTime = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const nDays = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const nItems = (n) => `${n} ${plural(n, 'запись', 'записи', 'записей')}`;

function fmtMoney(a, cur) {
  const n = parseFloat(a);
  if (!isFinite(n)) return '—';
  const fd = Math.abs(n % 1) > 0.004 ? 2 : 0;
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: cur || 'RUB', minimumFractionDigits: fd, maximumFractionDigits: fd }).format(n);
  } catch {
    return `${n.toFixed(fd)} ${cur || ''}`.trim();
  }
}

/* ───────────── theme ───────────── */

const THEME_KEY = 'svyazka.theme';
const THEMES = [['auto', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']];
const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } };
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = t;
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => {
    m.dataset.orig ||= m.content;
    m.content = t === 'auto' ? m.dataset.orig : t === 'dark' ? '#07090f' : '#e8ecf5';
  });
}
function setTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  applyTheme(t);
}
applyTheme(getTheme());

/* ───────────── state ───────────── */

let S = null; // { key, salt, iter, data } — существует только пока хранилище открыто
const ui = { q: '', lastHash: null };

// Хранилище — файл ~/.svyazka/vault.json; страницу и доступ к файлу отдаёт локальный агент svyazka.
// Ключ доступа агент кладёт в адрес (?t=…), страница сразу убирает его из адресной строки.
const store = (() => {
  let token = null;
  try {
    const q = new URLSearchParams(location.search).get('t');
    if (q) { sessionStorage.setItem('svyazka.t', q); history.replaceState(null, '', location.pathname + location.hash); }
    token = sessionStorage.getItem('svyazka.t');
  } catch {}
  let cache = null;
  const api = (method, body) => fetch('/api/vault', { method, body, headers: { 'X-Svyazka-Token': token }, cache: 'no-store' });
  return {
    ready: !!token,
    async fetchRemote() {
      const r = await api('GET');
      if (!r.ok) throw new Error('агент Связки не отвечает');
      return r.status === 204 ? null : await r.text();
    },
    async init() { cache = await this.fetchRemote(); },
    get: () => cache,
    async set(v) {
      const r = await api('PUT', v);
      if (!r.ok) throw new Error('Не удалось сохранить файл');
      cache = v;
    },
    async remove() { await api('DELETE'); cache = null; },
    // открыть через агента: без пароля — по Touch ID / Windows Hello, с паролем — проверить его
    async unlock(password) {
      const r = await fetch('/api/unlock', { method: 'POST', headers: { 'X-Svyazka-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(password == null ? {} : { password }), cache: 'no-store' });
      return { ok: r.ok, ...(await r.json().catch(() => ({}))) };
    },
    lockAgent() { return fetch('/api/lock', { method: 'POST', headers: { 'X-Svyazka-Token': token } }).catch(() => {}); },
  };
})();

// Если файл поменялся снаружи (например, запись добавил Claude через svyazka) — сливаем, а не затираем.
async function pullExternal() {
  if (!S) return false;
  const cur = await store.fetchRemote().catch(() => null);
  if (!cur || cur === store.get()) return false;
  try {
    const theirs = await decryptWith(JSON.parse(cur), S.key);
    S.data = mergeData(S.data, theirs).data;
    return true;
  } catch { return false; }
}
async function save() {
  await pullExternal();
  const blob = await seal(S);
  await store.set(JSON.stringify(blob));
}
const hasVault = () => !!store.get();

const shelf = (id) => S.data.shelves.find((s) => s.id === id);
const item = (id) => S.data.items.find((i) => i.id === id);
const itemsIn = (sid) => S.data.items.filter((i) => i.shelfId === sid);
const shelvesSorted = () => [...S.data.shelves].sort((a, b) => a.name.localeCompare(b.name, 'ru'));

/* ───────────── definitions ───────────── */

const ic = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2.5 2.5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3.5"/><path d="m7.5 9.5 3 2.5-3 2.5M13 15h3.5"/>',
  token: '<path d="M8 4H7a2 2 0 0 0-2 2v3.5L3 12l2 2.5V18a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v3.5l2 2.5-2 2.5V18a2 2 0 0 1-2 2h-1"/><circle cx="12" cy="12" r="1.2"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
  note: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5M9 13h7M9 17h4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.8"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  dice: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5"/>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9m-5 5 5-5 5 5M5 4h14"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4M12 17v.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
};

const TYPES = {
  password: { label: 'Пароль', icon: 'key', ph: 'GitHub', desc: 'Логин и пароль от сайта, панели, почты', fields: [
    { k: 'login', l: 'Логин / e-mail', al: 'Логин' },
    { k: 'password', l: 'Пароль', secret: 1, gen: 1, mono: 1 },
    { k: 'url', l: 'Адрес', url: 1, ph: 'https://' },
    { k: 'note', l: 'Заметка', multi: 1 },
  ] },
  ssh: { label: 'SSH', icon: 'terminal', ph: 'VPS-1 · root', desc: 'Хост, пользователь, ключи', fields: [
    { k: 'host', l: 'Хост', mono: 1, ph: '203.0.113.10' },
    { k: 'user', l: 'Пользователь', mono: 1, ph: 'root' },
    { k: 'port', l: 'Порт', mono: 1, ph: '22', num: 1 },
    { k: 'privateKey', l: 'Приватный ключ', secret: 1, multi: 1, mono: 1, ph: '-----BEGIN OPENSSH PRIVATE KEY-----' },
    { k: 'publicKey', l: 'Публичный ключ', multi: 1, mono: 1, ph: 'ssh-ed25519 AAAA…' },
    { k: 'passphrase', l: 'Passphrase / пароль', al: 'Пароль', secret: 1, gen: 1, mono: 1 },
    { k: 'note', l: 'Заметка', multi: 1 },
  ] },
  token: { label: 'Токен', icon: 'token', ph: 'Cloudflare API', desc: 'API-ключ или токен со сроком действия', fields: [
    { k: 'value', l: 'Значение', secret: 1, multi: 1, mono: 1 },
    { k: 'usage', l: 'Где используется' },
    { k: 'expires', l: 'Истекает', date: 1 },
    { k: 'note', l: 'Заметка', multi: 1 },
  ] },
  payment: { label: 'Оплата', icon: 'card', ph: 'Аренда VPS', desc: 'VPS, домен, подписка — с напоминанием', fields: [] },
  note: { label: 'Заметка', icon: 'note', ph: 'Сетевые настройки', desc: 'IP-адреса, конфиги, инструкции', fields: [
    { k: 'text', l: 'Текст', multi: 1, big: 1 },
  ] },
};
const TYPE_ORDER = ['payment', 'password', 'ssh', 'token', 'note'];

const PERIODS = [[1, 'Ежемесячно', 'мес'], [3, 'Раз в квартал', 'квартал'], [6, 'Раз в полгода', 'полгода'], [12, 'Ежегодно', 'год'], [24, 'Раз в 2 года', '2 года'], [36, 'Раз в 3 года', '3 года'], [0, 'Разово', 'разово']];
const periodShort = (p) => (PERIODS.find((x) => x[0] === +p) || PERIODS[0])[2];
const CURRENCIES = ['RUB', 'USD', 'EUR', 'GBP', 'KZT', 'UAH', 'BYN', 'TRY', 'GEL', 'AMD', 'CNY', 'USDT'];
const COLORS = ['#7aa2ff', '#5fe0a8', '#ffc266', '#ff7eb6', '#b18cff', '#5ad1f0', '#ff8a5c', '#a3aec2'];

/* ───────────── derived ───────────── */

function totals() {
  const t = {};
  for (const it of S.data.items) {
    if (it.type !== 'payment' || it.f.done) continue;
    const p = +it.f.period, a = parseFloat(it.f.amount);
    if (!p || !isFinite(a)) continue;
    t[it.f.currency] = (t[it.f.currency] || 0) + a / p;
  }
  return t;
}
const fmtTotals = (t, mul) => {
  const ks = Object.keys(t);
  return ks.length ? ks.sort((a, b) => t[b] - t[a]).map((k) => `<span>${esc(fmtMoney(t[k] * mul, k))}</span>`).join('') : '—';
};

function dueOf(it) {
  if (it.type === 'payment' && it.f.nextDate && !it.f.done) return { date: it.f.nextDate, days: daysTo(it.f.nextDate), warn: +it.f.remind || 7, kind: 'pay' };
  if (it.type === 'token' && it.f.expires) return { date: it.f.expires, days: daysTo(it.f.expires), warn: 30, kind: 'exp' };
  return null;
}
function dueList() {
  return S.data.items.map((it) => ({ it, d: dueOf(it) })).filter((x) => x.d).sort((a, b) => (a.d.date < b.d.date ? -1 : 1));
}
function dueChip(d, long = false) {
  const n = d.days;
  const exp = d.kind === 'exp';
  if (n < 0) return `<span class="chip red">${long ? (exp ? 'истёк ' : 'просрочено на ') + nDays(-n) : (exp ? 'истёк' : '−' + -n + ' дн.')}</span>`;
  if (n === 0) return `<span class="chip red">${exp ? 'истекает сегодня' : 'сегодня'}</span>`;
  if (n === 1) return `<span class="chip amber">завтра</span>`;
  if (n <= d.warn) return `<span class="chip amber">${long ? 'через ' + nDays(n) : n + ' дн.'}</span>`;
  return `<span class="chip">${long ? 'через ' + nDays(n) : fmtDateShort(d.date)}</span>`;
}

function subtitle(it) {
  const f = it.f;
  switch (it.type) {
    case 'password': return f.login || (f.url || '').replace(/^https?:\/\//, '');
    case 'ssh': return f.host ? `${f.user ? f.user + '@' : ''}${f.host}${f.port && f.port !== '22' ? ':' + f.port : ''}` : '';
    case 'token': return f.usage || '';
    case 'payment': return f.done ? 'оплачено' : `${fmtMoney(f.amount, f.currency)} / ${periodShort(f.period)}`;
    case 'note': return (f.text || '').split('\n')[0];
  }
  return '';
}

const sshCmd = (f) => `ssh ${f.user ? f.user + '@' : ''}${f.host}${f.port && f.port !== '22' ? ' -p ' + f.port : ''}`;
const ACCESS_ORDER = { password: ['url', 'login', 'password', 'note'] };
const HAS_QUICK = new Set(['password', 'ssh', 'token']);

function accessText(it) {
  const t = TYPES[it.type], f = it.f;
  if (it.type === 'note') return [it.title, f.text].filter(Boolean).join('\n\n');
  const lines = [it.title];
  const add = (l, v) => {
    if (v == null || v === '') return;
    v = String(v).trim();
    lines.push(v.includes('\n') ? `${l}:\n${v}` : `${l}: ${v}`);
  };
  if (it.type === 'payment') {
    add('Сумма', `${fmtMoney(f.amount, f.currency)} / ${periodShort(f.period)}`);
    if (!f.done) add('Следующий платёж', fmtDate(f.nextDate));
    add('Чем платить', f.method);
    add('Где оплачивать', f.url);
    add('Заметка', f.note);
  } else {
    if (it.type === 'ssh' && f.host) add('Подключение', sshCmd(f));
    const order = ACCESS_ORDER[it.type] || t.fields.map((x) => x.k);
    for (const k of order) {
      const fd = t.fields.find((x) => x.k === k);
      add(fd.al || fd.l, fd.date ? fmtDate(f[k]) : f[k]);
    }
  }
  return lines.join('\n');
}

/* ───────────── components ───────────── */

function top(title, right = '', back = null, cls = '') {
  return `<header class="top ${cls}">
    ${back ? `<a class="icon-btn glass" href="${back}" aria-label="Назад">${ic(I.back)}</a>` : ''}
    <h1>${title}</h1>
    <div class="top-actions">${right}</div>
  </header>`;
}

function row(it, showShelf = false, quick = false) {
  const t = TYPES[it.type];
  const sh = showShelf ? shelf(it.shelfId)?.name : '';
  const d = dueOf(it);
  const chip = d && (it.type === 'payment' || d.days <= d.warn) ? dueChip(d) : (it.type === 'payment' && it.f.done ? '<span class="chip green">оплачено</span>' : '');
  const sub = [subtitle(it), sh].filter(Boolean).join(' · ');
  return `<a class="row" href="#/item/${it.id}">
    <span class="ti t-${it.type}">${ic(I[t.icon])}</span>
    <span class="rt"><b>${esc(it.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    ${chip}
    ${quick && HAS_QUICK.has(it.type) ? `<button class="mini quick" data-act="copy-access" data-id="${it.id}" aria-label="Скопировать доступ">${ic(I.copy)}</button>` : ''}
  </a>`;
}

function fld(f, v, name) {
  name ||= 'f.' + f.k;
  v ??= '';
  const common = `name="${name}" placeholder="${esc(f.ph || '')}" autocomplete="off" autocapitalize="${f.cap ? 'sentences' : 'off'}" autocorrect="off" spellcheck="false"`;
  let input;
  if (f.multi) input = `<textarea ${common} rows="${f.big ? 9 : f.mono ? 5 : 3}" class="${f.mono ? 'mono' : ''} ${f.secret ? 'secret-ta' : ''}">${esc(v)}</textarea>`;
  else if (f.date) input = `<input type="date" name="${name}" value="${esc(v)}">`;
  else input = `<input type="${f.secret ? 'password' : 'text'}" ${common} value="${esc(v)}" class="${f.mono ? 'mono' : ''}" ${f.num ? 'inputmode="numeric"' : ''} ${f.url ? 'inputmode="url"' : ''} ${f.req ? 'required' : ''}>`;
  const tools = (f.secret ? `<button type="button" class="mini" data-act="toggle-vis" aria-label="Показать">${ic(I.eye)}</button>` : '')
    + (f.gen ? `<button type="button" class="mini" data-act="gen" aria-label="Сгенерировать">${ic(I.dice)}</button>` : '');
  return `<label class="f"><span>${esc(f.l)}</span><div class="in ${tools ? 'has-tools' : ''} ${f.multi ? 'multi' : ''}">${input}${tools ? `<div class="tools">${tools}</div>` : ''}</div></label>`;
}

function linkify(v) {
  const s = String(v).trim();
  let href = /^https?:\/\//i.test(s) ? s : /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s) ? 'https://' + s : null;
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(s)}</a>` : esc(s);
}

const maskOf = (v, f) => (f.multi ? `•••••••• <em>${v.split('\n').length} стр.</em>` : '••••••••••');

function viewField(it, f) {
  const v = it.f[f.k];
  if (!v) return '';
  const shown = f.secret ? maskOf(v, f) : f.url ? linkify(v) : f.date ? esc(fmtDate(v)) : esc(v);
  return `<div class="fv">
    <div class="fl">${esc(f.l)}</div>
    <div class="fval ${f.mono ? 'mono' : ''} ${f.multi ? 'multi' : ''} ${f.secret ? 'masked' : ''}">${shown}</div>
    <div class="fa">
      ${f.secret ? `<button class="mini" data-act="reveal" data-id="${it.id}" data-k="${f.k}" aria-label="Показать">${ic(I.eye)}</button>` : ''}
      <button class="mini" data-act="copy" data-id="${it.id}" data-k="${f.k}" aria-label="Скопировать">${ic(I.copy)}</button>
    </div>
  </div>`;
}
const staticField = (label, html) => `<div class="fv"><div class="fl">${esc(label)}</div><div class="fval">${html}</div></div>`;

/* ───────────── views ───────────── */

const BIO = /Mac/.test(navigator.platform) ? 'Touch ID' : /Win/.test(navigator.platform) ? 'Windows Hello' : null;

function vLock() {
  const exists = hasVault();
  return `<section class="lock">
    <div class="logo glass">${ic(I.key)}</div>
    <h1>Связка</h1>
    <p class="muted" id="lock-hint">${exists ? (BIO ? `Приложите палец — ${BIO} — или введите мастер-пароль` : 'Введите мастер-пароль') : 'Придумайте мастер-пароль. Восстановить его нельзя — сохраните его в надёжном месте.'}</p>
    ${exists && BIO ? `<button class="btn primary" data-act="bio">${ic(I.key)} Открыть с ${BIO}</button>` : ''}
    <form id="f-lock" class="glass card stack" autocomplete="off">
      <input type="password" name="pw" placeholder="Мастер-пароль" autocomplete="${exists ? 'current-password' : 'new-password'}" required>
      ${exists ? '' : '<input type="password" name="pw2" placeholder="Повторите пароль" autocomplete="new-password" required>'}
      <p class="err" hidden></p>
      <button class="btn ${exists && BIO ? 'ghost' : 'primary'}" type="submit">${exists ? 'Открыть паролем' : 'Создать хранилище'}</button>
    </form>
    ${exists ? '' : `<button class="btn ghost" data-act="import">${ic(I.upload)} Восстановить из бэкапа</button>`}
    <p class="foot muted">${ic(I.shield)} Данные шифруются и хранятся только на этом устройстве</p>
  </section>`;
}

function summaryCard() {
  const t = totals();
  return `<section class="glass card summary">
    <div><div class="label">В месяц</div><div class="big ${Object.keys(t).length > 1 ? 'multi' : ''}">${fmtTotals(t, 1)}</div></div>
    <div><div class="label">В год</div><div class="big sm ${Object.keys(t).length > 1 ? 'multi' : ''}">${fmtTotals(t, 12)}</div></div>
  </section>`;
}

function searchResults() {
  const d = S.data;
  {
    const q = ui.q.trim().toLowerCase();
    const hits = d.items.filter((it) => {
      const t = TYPES[it.type];
      const hay = [it.title, shelf(it.shelfId)?.name, ...t.fields.filter((f) => !f.secret).map((f) => it.f[f.k]), it.f.method, it.f.note]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    return hits.length
      ? `<div class="glass list">${hits.map((i) => row(i, true)).join('')}</div>`
      : `<div class="glass card empty">Ничего не найдено</div>`;
  }
}

function homeBody(desk = false) {
  const d = S.data;
  if (!desk && ui.q.trim()) return searchResults();

  let html = '';
  const ago = d.meta.lastBackup ? Math.floor((Date.now() - d.meta.lastBackup) / 864e5) : null;
  if (d.items.length && (ago === null || ago >= 14)) {
    html += `<div class="glass banner">
      <span class="ti t-warn">${ic(I.alert)}</span>
      <span class="rt"><b>${ago === null ? 'Бэкап ещё не делался' : `Бэкап был ${nDays(ago)} назад`}</b><small>Сохраните копию на случай потери диска</small></span>
      <button class="pill" data-act="export">Сохранить</button>
    </div>`;
  }

  const hasPay = d.items.some((i) => i.type === 'payment');
  if (hasPay) html += summaryCard();

  const due = dueList();
  let soon = due.filter((x) => x.d.days <= Math.max(45, x.d.warn));
  if (!soon.length && due.length) soon = due.slice(0, 1);
  if (soon.length) {
    html += `<h2 class="sec"><span>Скоро</span>${hasPay ? '<a href="#/payments">Все платежи</a>' : ''}</h2>
      <div class="glass list">${soon.map((x) => row(x.it, true)).join('')}</div>`;
  } else if (hasPay) {
    html += `<h2 class="sec"><span>Скоро</span><a href="#/payments">Все платежи</a></h2>`;
  }

  if (desk && d.shelves.length) return html || `<div class="glass card empty">Платежей и сроков пока нет.<br>Добавьте оплату VPS или домена — здесь появятся напоминания.</div>`;
  if (!d.shelves.length) {
    html += `<section class="glass card welcome stack">
      <b>Начните с полки</b>
      <p class="muted">Полка — это проект или сервис: «Hetzner VPS», «Домен example.com», «GitHub». На ней лежит всё, что к нему относится: пароли, SSH-ключи, токены и даты оплат.</p>
      <a class="btn primary" href="#/shelfedit/new">${ic(I.plus)} Создать полку</a>
    </section>`;
  } else {
    html += `<h2 class="sec"><span>Полки</span></h2><div class="grid">
      ${shelvesSorted().map((s) => {
        const n = itemsIn(s.id).length;
        return `<a class="shelf glass" href="#/shelf/${s.id}" style="--c:${esc(s.color)}"><span class="dot"></span><b>${esc(s.name)}</b><small>${nItems(n)}</small></a>`;
      }).join('')}
      <a class="shelf glass add" href="#/shelfedit/new">${ic(I.plus)}<small>Новая полка</small></a>
    </div>`;
  }
  return html;
}

function vHome() {
  const th = getTheme();
  return `${top('Связка', `
      <button class="icon-btn glass" data-act="theme-cycle" aria-label="Тема: ${THEMES.find((x) => x[0] === th)[1]}">${ic(I[th === 'auto' ? 'auto' : th === 'light' ? 'sun' : 'moon'])}</button>
      <a class="icon-btn glass" href="#/settings" aria-label="Настройки">${ic(I.sliders)}</a>
      <button class="icon-btn glass" data-act="lock" aria-label="Заблокировать">${ic(I.lock)}</button>`, null, 'home')}
    <label class="search glass">${ic(I.search)}<input id="q" type="search" placeholder="Поиск" value="${esc(ui.q)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <div id="home-body">${homeBody()}</div>
    <a class="fab" href="#/new" aria-label="Добавить">${ic(I.plus)}</a>`;
}

function vShelf(s) {
  const items = itemsIn(s.id).sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.title.localeCompare(b.title, 'ru'));
  return `${top(`<i class="hdot" style="--c:${esc(s.color)}"></i>${esc(s.name)}`, `<a class="icon-btn glass" href="#/shelfedit/${s.id}" aria-label="Изменить полку">${ic(I.edit)}</a>`, '#/')}
    ${items.length
      ? `<div class="glass list">${items.map((i) => row(i, false, true)).join('')}</div>`
      : `<div class="glass card empty">Пока пусто.<br>Добавьте пароль, SSH-ключ или оплату.</div>`}
    <a class="fab" href="#/new/${s.id}" aria-label="Добавить">${ic(I.plus)}</a>`;
}

function vPicker(sid) {
  const s = sid && sid !== '-' && shelf(sid) ? sid : '-';
  return `${top('Что добавить?', '', s !== '-' ? '#/shelf/' + s : '#/')}
    <div class="types">${Object.entries(TYPES).map(([k, t]) => `
      <a class="type glass" href="#/new/${s}/${k}">
        <span class="ti t-${k}">${ic(I[t.icon])}</span>
        <span class="rt"><b>${t.label}</b><small>${t.desc}</small></span>
      </a>`).join('')}
    </div>`;
}

function payFields(f) {
  return `
    <div class="two">
      ${fld({ k: 'amount', l: 'Сумма', ph: '500', num: 1 }, f.amount).replace('inputmode="numeric"', 'inputmode="decimal"')}
      <label class="f"><span>Валюта</span><select name="f.currency">${[...new Set([...CURRENCIES, f.currency].filter(Boolean))].map((c) => `<option ${c === f.currency ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    </div>
    <label class="f"><span>Периодичность</span><select name="f.period">${PERIODS.map(([v, l]) => `<option value="${v}" ${+f.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="two">
      <label class="f"><span>Следующий платёж</span><input type="date" name="f.nextDate" value="${esc(f.nextDate || '')}" required></label>
      ${fld({ k: 'remind', l: 'Напомнить за, дней', ph: '7', num: 1 }, f.remind)}
    </div>
    <label class="check"><input type="checkbox" name="f.autoRenew" ${f.autoRenew ? 'checked' : ''}><span>Автосписание с карты</span></label>
    ${fld({ k: 'method', l: 'Чем платить', ph: 'Карта •• 1234', cap: 1 }, f.method)}
    ${fld({ k: 'url', l: 'Где оплачивать', ph: 'https://', url: 1 }, f.url)}
    ${fld({ k: 'note', l: 'Заметка', multi: 1, cap: 1 }, f.note)}`;
}

function vEdit(it, isNew) {
  const t = TYPES[it.type];
  const shelves = shelvesSorted();
  const opts = shelves.length
    ? shelves.map((s) => `<option value="${s.id}" ${s.id === it.shelfId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
    : '<option value="__default">Разное</option>';
  return `${top(isNew ? 'Новая запись' : 'Изменить', '', isNew ? '#/new/' + (it.shelfId || '-') : '#/item/' + it.id)}
    <form id="f-item" class="stack" data-id="${it.id}" data-new="${isNew ? 1 : ''}" data-type="${it.type}" autocomplete="off">
      <div class="glass card stack">
        <div class="tag"><span class="ti sm t-${it.type}">${ic(I[t.icon])}</span>${t.label}</div>
        ${fld({ k: 'title', l: 'Название', ph: t.ph, req: 1, cap: 1 }, it.title, 'title')}
        <label class="f"><span>Полка</span><select name="shelfId">${opts}<option value="__new">+ Новая полка…</option></select></label>
      </div>
      <div class="glass card stack">
        ${it.type === 'payment' ? payFields(it.f) : t.fields.map((f) => fld(f.k === 'note' || f.k === 'text' || f.k === 'usage' ? { ...f, cap: 1 } : f, it.f[f.k])).join('')}
      </div>
      <button class="btn primary" type="submit">${ic(I.check)} Сохранить</button>
      ${isNew ? '' : `<button class="btn danger" type="button" data-act="del-item" data-id="${it.id}">${ic(I.trash)} Удалить запись</button>`}
    </form>`;
}

function vItem(it) {
  const t = TYPES[it.type];
  const sh = shelf(it.shelfId);
  const f = it.f;
  let body = '';
  if (it.type === 'payment') {
    const d = dueOf(it);
    const next = +f.period && f.nextDate ? addMonths(f.nextDate, +f.period, f.anchor) : null;
    body = `<section class="glass card pay stack">
        <div class="amount">${esc(fmtMoney(f.amount, f.currency))}<small> / ${periodShort(f.period)}</small></div>
        ${f.done ? '<div class="due-line"><span>Разовый платёж</span><span class="chip green">оплачено</span></div>'
          : d ? `<div class="due-line"><span>Следующий платёж <b>${fmtDate(f.nextDate)}</b></span>${dueChip(d, true)}</div>` : ''}
        ${!f.done && f.nextDate ? `<button class="btn primary" data-act="paid" data-id="${it.id}">${ic(I.check)} Оплачено${next ? `<small>→ ${fmtDate(next)}</small>` : ''}</button>` : ''}
      </section>
      <div class="glass list">
        ${staticField('Автосписание', f.autoRenew ? 'Да' : 'Нет')}
        ${staticField('Напомнить за', nDays(+f.remind || 7))}
        ${viewField(it, { k: 'method', l: 'Чем платить' })}
        ${viewField(it, { k: 'url', l: 'Где оплачивать', url: 1 })}
        ${viewField(it, { k: 'note', l: 'Заметка', multi: 1 })}
      </div>
      ${f.history?.length ? `<h2 class="sec"><span>История оплат</span></h2><div class="glass list">${f.history.slice(0, 12).map((h) => `
        <div class="fv"><div class="fval">${fmtDate(h.date)}</div><div class="fa muted">${esc(fmtMoney(h.amount, h.currency))}</div></div>`).join('')}</div>` : ''}`;
  } else {
    let rows = t.fields.map((fd) => viewField(it, fd)).join('');
    if (it.type === 'ssh' && f.host) {
      const cmd = sshCmd(f);
      rows = `<div class="fv"><div class="fl">Подключение</div><div class="fval mono">${esc(cmd)}</div>
        <div class="fa"><button class="mini" data-act="copy-text" data-text="${esc(cmd)}" aria-label="Скопировать">${ic(I.copy)}</button></div></div>` + rows;
    }
    if (it.type === 'token' && f.expires) {
      const d = dueOf(it);
      rows = `<div class="fv"><div class="fl">Срок</div><div class="fval">${dueChip({ ...d, warn: 30 }, true)}</div></div>` + rows;
    }
    body = `<div class="glass list">${rows || '<div class="empty">Пусто</div>'}</div>`;
  }
  return `${top('', `<a class="icon-btn glass" href="#/edit/${it.id}" aria-label="Изменить">${ic(I.edit)}</a>`, sh ? '#/shelf/' + sh.id : '#/')}
    <div class="hero">
      <span class="ti big t-${it.type}">${ic(I[t.icon])}</span>
      <div><h1>${esc(it.title)}</h1><small class="muted">${t.label}${sh ? ' · ' + esc(sh.name) : ''}</small></div>
    </div>
    <div class="actions">
      <button class="btn glass" data-act="copy-access" data-id="${it.id}">${ic(I.copy)} ${it.type === 'payment' ? 'Скопировать реквизиты' : it.type === 'note' ? 'Скопировать заметку' : 'Скопировать доступ'}</button>
    </div>
    ${body}
    <p class="foot muted">Изменено ${fmtDateTime(it.updated)}</p>`;
}

function vShelfEdit(s, isNew) {
  return `${top(isNew ? 'Новая полка' : 'Полка', '', isNew ? '#/' : '#/shelf/' + s.id)}
    <form id="f-shelf" class="stack" data-id="${s.id}" data-new="${isNew ? 1 : ''}">
      <div class="glass card stack">
        ${fld({ k: 'name', l: 'Название', ph: 'Hetzner VPS', req: 1, cap: 1 }, s.name, 'name')}
        <div class="f"><span>Цвет</span><div class="swatches">
          ${COLORS.map((c) => `<label class="sw" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === s.color ? 'checked' : ''}><i></i></label>`).join('')}
        </div></div>
      </div>
      <button class="btn primary" type="submit">${ic(I.check)} Сохранить</button>
      ${isNew ? '' : `<button type="button" class="btn danger" data-act="del-shelf" data-id="${s.id}">${ic(I.trash)} Удалить полку</button>`}
    </form>`;
}

function vPayments() {
  const ps = S.data.items.filter((i) => i.type === 'payment');
  const active = ps.filter((i) => !i.f.done).sort((a, b) => ((a.f.nextDate || '9') < (b.f.nextDate || '9') ? -1 : 1));
  const done = ps.filter((i) => i.f.done);
  return `${top('Платежи', '', '#/')}
    ${summaryCard()}
    ${active.length ? `<h2 class="sec"><span>Регулярные</span></h2><div class="glass list">${active.map((i) => row(i, true)).join('')}</div>`
      : '<div class="glass card empty">Платежей пока нет</div>'}
    ${done.length ? `<h2 class="sec"><span>Разовые, оплачены</span></h2><div class="glass list">${done.map((i) => row(i, true)).join('')}</div>` : ''}`;
}

function vSettings() {
  const d = S.data;
  const lb = d.meta.lastBackup ? fmtDateTime(d.meta.lastBackup) : 'ещё не делался';
  return `${top('Настройки', '', '#/')}
    <div class="glass list">
      <div class="row static"><span class="ti t-neutral">${ic(I.auto)}</span><span class="rt"><b>Тема</b></span>
        <div class="seg">${THEMES.map(([k, l]) => `<button data-act="theme" data-t="${k}" class="${getTheme() === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <label class="row static"><span class="ti t-neutral">${ic(I.clock)}</span><span class="rt"><b>Автоблокировка</b><small>При бездействии</small></span>
        <select id="autolock">${[1, 3, 5, 15, 30].map((m) => `<option value="${m}" ${+d.settings.autoLock === m ? 'selected' : ''}>${m} мин</option>`).join('')}</select>
      </label>
    </div>
    <h2 class="sec"><span>Резервная копия</span></h2>
    <div class="glass list">
      <button class="row" data-act="export"><span class="ti t-ssh">${ic(I.download)}</span><span class="rt"><b>Сохранить бэкап</b><small>Последний: ${lb}</small></span></button>
      <button class="row" data-act="import"><span class="ti t-password">${ic(I.upload)}</span><span class="rt"><b>Импорт из файла</b><small>Бэкап заменит данные, файл импорта — добавит</small></span></button>
    </div>
    <h2 class="sec"><span>Безопасность</span></h2>
    <div class="glass list">
      <button class="row" data-act="chpw"><span class="ti t-token">${ic(I.lock)}</span><span class="rt"><b>Сменить мастер-пароль</b></span></button>
      <button class="row danger" data-act="wipe"><span class="ti t-danger">${ic(I.trash)}</span><span class="rt"><b>Стереть всё с устройства</b></span></button>
    </div>
    <p class="foot muted">Данные зашифрованы AES-256-GCM и хранятся только на этом устройстве. Ключ получается из мастер-пароля (PBKDF2-SHA256, 600 000 итераций). Бэкап — это тот же зашифрованный файл: без мастер-пароля его не открыть.<br><br>Связка ${VERSION} · ${nItems(d.items.length)}</p>`;
}

/* ───────────── render / routing ───────────── */

/* ───────────── десктоп: три колонки ───────────── */

const DESK_MQ = matchMedia('(min-width: 900px)');
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const isDesk = () => DESK_MQ.matches;

function placeholder(text) {
  return `<div class="placeholder"><div>${ic(I.key)}<p>${text}</p></div></div>`;
}

function vSide(selShelf, nav) {
  const th = getTheme();
  const urgent = dueList().filter((x) => x.d.days <= x.d.warn);
  const overdue = urgent.filter((x) => x.d.days < 0).length;
  const badge = urgent.length ? `<b class="badge ${overdue ? '' : 'amber'}">${urgent.length}</b>` : '';
  return `<aside class="side">
    <div class="brand"><span class="logo-s">${ic(I.key)}</span><b>Связка</b></div>
    <label class="search glass">${ic(I.search)}<input id="q" type="search" placeholder="Поиск   ${MOD}F" value="${esc(ui.q)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <nav class="snav">
      <a class="sn ${nav === 'home' ? 'on' : ''}" href="#/">${ic(I.clock)}<span>Обзор</span>${badge}</a>
      <a class="sn ${nav === 'payments' ? 'on' : ''}" href="#/payments">${ic(I.card)}<span>Платежи</span></a>
    </nav>
    <div class="slabel"><span>Полки</span><a href="#/shelfedit/new" title="Новая полка">${ic(I.plus)}</a></div>
    <nav class="snav shelves">
      ${shelvesSorted().map((s) => `<a class="sn ${s.id === selShelf ? 'on' : ''}" href="#/shelf/${s.id}"><i class="hdot" style="--c:${esc(s.color)}"></i><span>${esc(s.name)}</span><em>${itemsIn(s.id).length}</em></a>`).join('')
        || '<a class="sn muted" href="#/shelfedit/new"><span>Создайте первую полку</span></a>'}
    </nav>
    <div class="sfoot">
      <button class="icon-btn" data-act="theme-cycle" title="Тема: ${THEMES.find((x) => x[0] === th)[1]}">${ic(I[th === 'auto' ? 'auto' : th === 'light' ? 'sun' : 'moon'])}</button>
      <a class="icon-btn ${nav === 'settings' ? 'on' : ''}" href="#/settings" title="Настройки">${ic(I.sliders)}</a>
      <span class="grow"></span>
      <button class="icon-btn" data-act="lock" title="Заблокировать (${MOD}L)">${ic(I.lock)}</button>
    </div>
  </aside>`;
}

function midShelf(s) {
  const items = itemsIn(s.id).sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.title.localeCompare(b.title, 'ru'));
  return `<header class="mhead">
      <i class="hdot" style="--c:${esc(s.color)}"></i><h2>${esc(s.name)}</h2><span class="cnt">${items.length}</span>
      <a class="mini" href="#/shelfedit/${s.id}" title="Изменить полку">${ic(I.edit)}</a>
      <a class="btn-add" href="#/new/${s.id}" title="Новая запись (${MOD}N)">${ic(I.plus)}Добавить</a>
    </header>
    ${items.length ? `<div class="glass list">${items.map((i) => row(i, false, true)).join('')}</div>`
      : `<div class="glass card empty">Пока пусто.<br>Добавьте пароль, SSH-ключ или оплату.</div>`}`;
}

function midHome() {
  return `<header class="mhead"><h2>Обзор</h2><a class="btn-add" href="#/new" title="Новая запись (${MOD}N)">${ic(I.plus)}Добавить</a></header>${homeBody(true)}`;
}

function midSearch() {
  return `<header class="mhead"><h2>Поиск</h2><span class="cnt">«${esc(ui.q.trim())}»</span></header>${searchResults()}`;
}

function vDesk(p, a, b) {
  let mid = '', det = placeholder('Выберите запись'), wide = false, selShelf = null, selItem = null, nav = null;
  switch (p) {
    case 'shelf': { const s = shelf(a); if (!s) return null; selShelf = s.id; mid = midShelf(s); break; }
    case 'item': case 'edit': {
      const it = item(a); if (!it) return null;
      selShelf = it.shelfId; selItem = it.id; mid = midShelf(shelf(it.shelfId));
      det = p === 'item' ? vItem(it) : vEdit(structuredClone(it), false);
      break;
    }
    case 'new': {
      const s = a && a !== '-' ? shelf(a) : null;
      selShelf = s?.id; mid = s ? midShelf(s) : midHome(); nav = s ? null : 'home';
      det = b && TYPES[b] ? vEdit(blankItem(a, b), true) : vPicker(a);
      break;
    }
    case 'shelfedit':
      if (a === 'new') { mid = midHome(); nav = 'home'; det = vShelfEdit({ id: uid(), name: '', color: COLORS[S.data.shelves.length % COLORS.length] }, true); }
      else { const s = shelf(a); if (!s) return null; selShelf = s.id; mid = midShelf(s); det = vShelfEdit(s, false); }
      break;
    case 'payments': nav = 'payments'; mid = vPayments(); break;
    case 'settings': nav = 'settings'; wide = true; mid = vSettings(); break;
    case '': case undefined: nav = 'home'; mid = midHome(); break;
    default: return null;
  }
  if (ui.q.trim()) mid = midSearch();
  ui.selItem = selItem;
  return `<div class="desk">${vSide(selShelf, nav)}<section class="mid ${wide ? 'wide' : ''}" id="mid">${mid}</section>${wide ? '' : `<section class="detail" id="detail">${det}</section>`}</div>`;
}

function blankItem(sid, type) {
  const shelfId = sid && sid !== '-' && shelf(sid) ? sid : (shelvesSorted()[0]?.id || '');
  const f = type === 'payment' ? { currency: S.data.settings.currency, period: 1, remind: 7, autoRenew: false } : {};
  return { id: uid(), shelfId, type, title: '', f };
}

function render() {
  if (!S) {
    app.innerHTML = vLock();
    if (hasVault() && BIO && !ui.bioTried) { ui.bioTried = true; setTimeout(tryBio, 150); }
    else setTimeout(() => $('#f-lock input')?.focus(), 50);
    ui.lastHash = null;
    return;
  }
  const hash = location.hash;
  const [p, a, b] = hash.replace(/^#\/?/, '').split('/');
  let html = null;
  if (isDesk()) {
    html = vDesk(p, a, b);
    if (!html) { location.replace('#/'); return; }
    const keep = $('#mid')?.scrollTop || 0;
    const sameMid = ui.lastHash && ui.lastHash.split('/')[1] === hash.split('/')[1];
    app.innerHTML = html;
    if (ui.selItem) $(`.mid a.row[href="#/item/${ui.selItem}"]`)?.classList.add('sel');
    if (sameMid || p === 'item' || p === 'edit') $('#mid').scrollTop = keep;
    ui.lastHash = hash;
    return;
  }
  switch (p) {
    case 'shelf': { const s = shelf(a); html = s && vShelf(s); break; }
    case 'item': { const it = item(a); html = it && vItem(it); break; }
    case 'edit': { const it = item(a); html = it && vEdit(structuredClone(it), false); break; }
    case 'new': html = b && TYPES[b] ? vEdit(blankItem(a, b), true) : vPicker(a); break;
    case 'shelfedit':
      if (a === 'new') html = vShelfEdit({ id: uid(), name: '', color: COLORS[S.data.shelves.length % COLORS.length] }, true);
      else { const s = shelf(a); html = s && vShelfEdit(s, false); }
      break;
    case 'payments': html = vPayments(); break;
    case 'settings': html = vSettings(); break;
    case '': case undefined: html = vHome(); break;
  }
  if (!html) { location.replace('#/'); return; }
  app.innerHTML = html;
  if (ui.lastHash !== hash) { window.scrollTo(0, 0); ui.lastHash = hash; }
}
window.addEventListener('hashchange', render);
DESK_MQ.addEventListener('change', () => { if (S) render(); });

// горячие клавиши на компьютере
addEventListener('keydown', (e) => {
  if (!S || !(e.metaKey || e.ctrlKey) || document.querySelector('.scrim')) return;
  const k = e.key.toLowerCase();
  if ((k === 'f' || k === 'а') && $('#q')) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  else if (k === 'n' || k === 'т') { e.preventDefault(); const sh = (location.hash.match(/^#\/(?:shelf|item|edit)\/([^/]+)/) || [])[1]; const sid = location.hash.startsWith('#/shelf/') ? sh : sh && item(sh)?.shelfId; location.hash = '#/new/' + (sid || '-'); }
  else if (k === 'l' || k === 'д') { e.preventDefault(); A.lock(); }
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S && isDesk() && !document.querySelector('.scrim')) {
    if ($('#q') === document.activeElement && ui.q) { ui.q = ''; render(); return; }
    const m = location.hash.match(/^#\/(item|edit|new|shelfedit)\//);
    if (m) { const it = (location.hash.match(/^#\/(?:item|edit)\/([^/]+)/) || [])[1]; location.hash = it && item(it) ? (m[1] === 'edit' ? '#/item/' + it : '#/shelf/' + item(it).shelfId) : '#/'; }
  }
});

/* ───────────── modal / toast / clipboard ───────────── */

function modal({ title, text = '', fields = [], ok = 'OK', cancel = 'Отмена', alt = null, danger = false, validate = null }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'scrim';
    el.innerHTML = `<form class="sheet glass stack" autocomplete="off">
      <h3>${esc(title)}</h3>
      ${text ? `<p class="muted">${esc(text)}</p>` : ''}
      ${fields.map((f) => `<input name="${f.name}" type="${f.type || 'text'}" placeholder="${esc(f.ph || '')}" value="${esc(f.value || '')}" autocomplete="off" autocapitalize="${f.cap ? 'sentences' : 'off'}">`).join('')}
      <p class="err" hidden></p>
      ${alt ? `<button type="button" class="btn ghost" data-alt>${esc(alt)}</button>` : ''}
      <div class="${cancel ? 'two' : ''}">
        ${cancel ? `<button type="button" class="btn ghost" data-x>${esc(cancel)}</button>` : ''}
        <button type="submit" class="btn ${danger ? 'danger solid' : 'primary'}">${esc(ok)}</button>
      </div>
    </form>`;
    document.body.append(el);
    const form = el.querySelector('form');
    const err = el.querySelector('.err');
    const close = (v) => { el.classList.add('out'); setTimeout(() => el.remove(), 180); resolve(v); };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-alt]')) return close({ _alt: true });
      if (e.target === el || e.target.closest('[data-x]')) close(null);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      if (validate) {
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        const msg = await validate(v);
        btn.disabled = false;
        if (msg) { err.textContent = msg; err.hidden = false; return; }
      }
      close(v);
    });
    setTimeout(() => form.querySelector('input')?.focus(), 60);
  });
}
const confirmBox = (title, text, ok, danger = true) => modal({ title, text, ok, danger });

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2400);
}

let clipT;
async function copyText(v, msg = 'Скопировано') {
  try {
    await navigator.clipboard.writeText(v);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = v; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  toast(`${msg} · очистка через 30 с`);
  clearTimeout(clipT);
  clipT = setTimeout(() => navigator.clipboard?.writeText('').catch(() => {}), 30000);
}

function genPassword(n = 20) {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?';
  const max = 256 - (256 % cs.length);
  let out = '';
  while (out.length < n) for (const x of rand(n * 2)) if (x < max && out.length < n) out += cs[x % cs.length];
  return out;
}

function pickFile() {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.json,application/json'; i.hidden = true;
    i.onchange = () => { resolve(i.files[0] || null); i.remove(); };
    document.body.append(i);
    i.click();
  });
}

/* ───────────── actions ───────────── */

function lock() {
  document.querySelectorAll('.scrim').forEach((e) => e.remove());
  ui.bioTried = true; // после блокировки не спрашиваем отпечаток сам — только по кнопке
  S = null;
  ui.q = '';
  render();
}

// Открыть сессию ключом, который отдал агент (после Touch ID / Windows Hello или проверки пароля)
async function openRaw(r) {
  await store.init();
  const key = await importRaw(b64d(r.raw));
  S = { key, salt: b64d(r.salt), iter: r.iter, data: await decryptWith(JSON.parse(store.get()), key) };
}

async function tryBio() {
  const hint = $('#lock-hint');
  const btn = $('[data-act="bio"]');
  if (btn) btn.disabled = true;
  if (hint) hint.textContent = `Ждём ${BIO}…`;
  const r = await store.unlock().catch(() => ({ ok: false }));
  if (r.ok) {
    try { await openRaw(r); normalize(S.data); lastAct = Date.now(); render(); return; } catch {}
  }
  if (btn) btn.disabled = false;
  if (hint) hint.textContent = r.code === 'NEED_PASSWORD'
    ? `Первый раз — мастер-пароль. Дальше Связка будет открываться по ${BIO}.`
    : r.code === 'DENIED' ? `${BIO} не подтверждён — попробуйте ещё раз или введите пароль` : 'Введите мастер-пароль';
  $('#f-lock input')?.focus();
}

async function onLockSubmit(form) {
  const fd = new FormData(form);
  const pw = fd.get('pw');
  const btn = form.querySelector('[type=submit]');
  const err = form.querySelector('.err');
  const stored = store.get();
  const label = btn.textContent;
  err.hidden = true;
  try {
    if (!stored) {
      if (pw.length < 8) throw new Error('Минимум 8 символов');
      if (pw !== fd.get('pw2')) throw new Error('Пароли не совпадают');
    }
    btn.disabled = true; btn.textContent = 'Открываю…';
    if (stored) {
      const r = await store.unlock(pw);
      if (!r.ok) throw new Error(r.code === 'BAD_PASSWORD' ? 'Неверный пароль' : (r.error || 'Не удалось открыть'));
      await openRaw(r);
    } else {
      const salt = rand(16);
      S = { key: await deriveKey(pw, salt, ITER), salt, iter: ITER, data: newVault() };
      await save();
    }
    normalize(S.data);
    navigator.storage?.persist?.().catch(() => {});
    lastAct = Date.now();
    render();
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
    btn.disabled = false; btn.textContent = label;
    form.pw.select();
  }
}

async function saveItem(form) {
  const fd = new FormData(form);
  const isNew = !!form.dataset.new;
  const type = form.dataset.type;
  const title = String(fd.get('title') || '').trim();
  if (!title) return toast('Укажите название');

  let it = isNew ? { id: form.dataset.id, type, created: Date.now(), f: {} } : item(form.dataset.id);
  if (!it) return;
  const f = {};
  for (const [k, v] of fd) if (k.startsWith('f.')) f[k.slice(2)] = String(v).replace(/\r\n/g, '\n');

  if (type === 'payment') {
    f.autoRenew = fd.has('f.autoRenew');
    f.amount = (f.amount || '').replace(',', '.').replace(/[^\d.]/g, '');
    f.period = +f.period;
    f.remind = f.remind === '' ? 7 : Math.max(0, parseInt(f.remind, 10) || 0);
    if (f.nextDate) {
      if (f.nextDate !== it.f.nextDate) f.done = false;
      f.anchor = +f.nextDate.slice(8, 10);
    }
    S.data.settings.currency = f.currency;
  }

  let shelfId = fd.get('shelfId');
  if (shelfId === '__default' || shelfId === '__new' || !shelf(shelfId)) {
    const s = S.data.shelves[0] || { id: uid(), name: 'Разное', color: COLORS[0], created: Date.now() };
    if (!shelf(s.id)) S.data.shelves.push(s);
    shelfId = s.id;
  }

  it.title = title;
  it.shelfId = shelfId;
  it.f = { ...it.f, ...f };
  it.updated = Date.now();
  if (isNew) S.data.items.push(it);
  await save();
  toast('Сохранено');
  location.replace('#/item/' + it.id);
}

async function saveShelf(form) {
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  if (!name) return toast('Укажите название');
  const color = fd.get('color') || COLORS[0];
  const id = form.dataset.id;
  if (form.dataset.new) S.data.shelves.push({ id, name, color, created: Date.now(), updated: Date.now() });
  else Object.assign(shelf(id), { name, color, updated: Date.now() });
  await save();
  location.replace('#/shelf/' + id);
}

async function newShelfInline(sel) {
  const r = await modal({ title: 'Новая полка', fields: [{ name: 'name', ph: 'Название', cap: 1 }], ok: 'Создать' });
  const name = r?.name?.trim();
  if (!name) { sel.selectedIndex = 0; return; }
  const s = { id: uid(), name, color: COLORS[S.data.shelves.length % COLORS.length], created: Date.now() };
  S.data.shelves.push(s);
  await save();
  sel.querySelector('option[value="__default"]')?.remove();
  const o = new Option(name, s.id, true, true);
  sel.insertBefore(o, sel.querySelector('option[value="__new"]'));
  sel.value = s.id;
}

async function exportBackup() {
  const raw = store.get();
  if (!raw) return;
  const file = new File([raw], `svyazka-backup-${todayISO()}.json`, { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  S.data.meta.lastBackup = Date.now();
  await save();
  toast('Бэкап сохранён');
  render();
}

async function importBackup() {
  const file = await pickFile();
  if (!file) return;
  let blob;
  try {
    blob = JSON.parse(await file.text());
  } catch { return toast('Не удалось прочитать JSON'); }
  if (isPlainImport(blob)) return importPlain(blob);
  if (!isVaultBlob(blob)) return toast('Это не файл Связки');
  let mode = 'replace';
  if (S) {
    const m = await modal({
      title: 'Загрузить бэкап', text: 'Объединить — добавит новое и обновит изменённое (так переносят данные между компьютерами). Заменить — сотрёт текущие данные.',
      ok: 'Объединить', alt: 'Заменить всё',
    });
    if (!m) return;
    mode = m._alt ? 'replace' : 'merge';
    if (mode === 'replace' && !(await confirmBox('Заменить данные?', 'Текущее хранилище будет полностью заменено содержимым бэкапа.', 'Заменить'))) return;
  } else if (hasVault()) {
    if (!(await confirmBox('Заменить данные?', 'Текущее хранилище на этом устройстве будет полностью заменено содержимым бэкапа.', 'Заменить'))) return;
  }
  let opened = null;
  const r = await modal({
    title: 'Пароль бэкапа', text: 'Мастер-пароль, с которым был сделан этот файл.',
    fields: [{ name: 'pw', type: 'password', ph: 'Мастер-пароль' }], ok: mode === 'merge' ? 'Объединить' : 'Восстановить',
    validate: async (v) => { try { opened = await openVault(blob, v.pw); } catch { return 'Неверный пароль'; } },
  });
  if (!r || !opened) return;
  if (mode === 'merge') {
    const { data, stats } = mergeData(S.data, opened.data);
    S.data = data;
    await save();
    render();
    return toast(`Объединено: новых ${stats.added}, обновлено ${stats.updated}, удалено ${stats.removed}`);
  }
  S = opened;
  normalize(S.data);
  await save();
  lastAct = Date.now();
  location.hash = '#/';
  render();
  toast(`Восстановлено: ${nItems(S.data.items.length)}`);
}

async function importPlain(src) {
  if (!S) return toast('Сначала создайте хранилище, затем импорт в Настройках');
  const { shelves, items, newShelves, skipped } = planPlainImport(S.data, src);
  if (!items.length) return toast(skipped ? `Новых записей нет, пропущено: ${skipped}` : 'В файле нет записей');

  const byType = TYPE_ORDER.map((t) => [t, items.filter((i) => i.type === t).length]).filter(([, n]) => n)
    .map(([t, n]) => `${TYPES[t].label.toLowerCase()} — ${n}`).join(', ');
  const ok = await modal({
    title: `Импорт: ${nItems(items.length)}`,
    text: `${byType}.${newShelves ? ` Новых полок: ${newShelves}.` : ''}${skipped ? ` Пропущено (дубли или пустые): ${skipped}.` : ''}`,
    ok: 'Добавить',
  });
  if (!ok) return;
  S.data.shelves = shelves;
  S.data.items.push(...items);
  await save();
  location.hash = '#/';
  render();
  await modal({
    title: 'Готово',
    text: 'Файл импорта не зашифрован. Удалите его (и из Загрузок, и из мессенджеров) и сохраните свежий бэкап.',
    ok: 'Понятно', cancel: null,
  });
}

const A = {
  lock: () => { store.lockAgent(); lock(); },
  bio: () => tryBio(),
  import: importBackup,
  export: exportBackup,
  copy: (el) => { const v = item(el.dataset.id)?.f[el.dataset.k]; if (v) copyText(v); },
  'copy-text': (el) => copyText(el.dataset.text),
  'copy-access': (el) => { const it = item(el.dataset.id); if (it) copyText(accessText(it), 'Доступ скопирован'); },
  theme: (el) => { setTheme(el.dataset.t); render(); },
  'theme-cycle': () => {
    const order = THEMES.map((x) => x[0]);
    const next = order[(order.indexOf(getTheme()) + 1) % order.length];
    setTheme(next);
    render();
    toast('Тема: ' + THEMES.find((x) => x[0] === next)[1]);
  },
  reveal: (el) => {
    const it = item(el.dataset.id);
    const fv = el.closest('.fv');
    const box = fv.querySelector('.fval');
    const f = TYPES[it.type].fields.find((x) => x.k === el.dataset.k);
    const open = box.classList.toggle('open');
    box.classList.toggle('masked', !open);
    box.innerHTML = open ? esc(it.f[el.dataset.k]) : maskOf(it.f[el.dataset.k], f);
    el.innerHTML = ic(open ? I.eyeOff : I.eye);
  },
  'toggle-vis': (el) => {
    const inp = el.closest('.in').querySelector('input,textarea');
    let shown;
    if (inp.tagName === 'INPUT') { shown = inp.type === 'password'; inp.type = shown ? 'text' : 'password'; }
    else shown = inp.classList.toggle('shown');
    el.innerHTML = ic(shown ? I.eyeOff : I.eye);
  },
  gen: (el) => {
    const inp = el.closest('.in').querySelector('input');
    inp.value = genPassword();
    inp.type = 'text';
    el.closest('.in').querySelector('[data-act="toggle-vis"]').innerHTML = ic(I.eyeOff);
    toast('Сгенерирован пароль из 20 символов');
  },
  paid: async (el) => {
    const it = item(el.dataset.id);
    const f = it.f;
    markPaid(it);
    await save();
    render();
    toast(+f.period ? `Следующий платёж — ${fmtDate(f.nextDate)}` : 'Отмечено как оплачено');
  },
  'del-item': async (el) => {
    const it = item(el.dataset.id);
    if (!(await confirmBox('Удалить запись?', `«${it.title}» будет удалена без возможности восстановления.`, 'Удалить'))) return;
    S.data.items = S.data.items.filter((i) => i.id !== it.id);
    tombstone(S.data, 'item', it.id);
    await save();
    location.replace('#/shelf/' + it.shelfId);
  },
  'del-shelf': async (el) => {
    const s = shelf(el.dataset.id);
    const n = itemsIn(s.id).length;
    if (!(await confirmBox('Удалить полку?', n ? `Вместе с полкой «${s.name}» удалятся ${nItems(n)}.` : `Полка «${s.name}» пустая.`, 'Удалить'))) return;
    S.data.shelves = S.data.shelves.filter((x) => x.id !== s.id);
    for (const i of itemsIn(s.id)) tombstone(S.data, 'item', i.id);
    tombstone(S.data, 'shelf', s.id);
    S.data.items = S.data.items.filter((i) => i.shelfId !== s.id);
    await save();
    location.replace('#/');
  },
  chpw: async () => {
    let next = null;
    const r = await modal({
      title: 'Новый мастер-пароль', text: 'Старые бэкапы останутся со старым паролем.',
      fields: [{ name: 'pw', type: 'password', ph: 'Новый пароль' }, { name: 'pw2', type: 'password', ph: 'Повторите' }], ok: 'Сменить',
      validate: async (v) => {
        if (v.pw.length < 8) return 'Минимум 8 символов';
        if (v.pw !== v.pw2) return 'Пароли не совпадают';
        const salt = rand(16);
        next = { key: await deriveKey(v.pw, salt, ITER), salt, iter: ITER };
      },
    });
    if (!r || !next) return;
    Object.assign(S, next);
    await save();
    toast('Мастер-пароль изменён');
  },
  wipe: async () => {
    const r = await modal({
      title: 'Стереть всё?', text: 'Все записи будут удалены с устройства. Если нет бэкапа — навсегда. Введите УДАЛИТЬ для подтверждения.',
      fields: [{ name: 'c', ph: 'УДАЛИТЬ' }], ok: 'Стереть', danger: true,
      validate: async (v) => (v.c.trim().toUpperCase() === 'УДАЛИТЬ' ? null : 'Введите УДАЛИТЬ'),
    });
    if (!r) return;
    await store.remove();
    location.hash = '#/';
    lock();
  },
};

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !A[el.dataset.act]) return;
  e.preventDefault();
  await A[el.dataset.act](el, e);
});
app.addEventListener('submit', (e) => {
  e.preventDefault();
  ({ 'f-lock': onLockSubmit, 'f-item': saveItem, 'f-shelf': saveShelf })[e.target.id]?.(e.target);
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'q' && isDesk()) {
    ui.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos);
    return;
  }
  if (e.target.id === 'q') { ui.q = e.target.value; $('#home-body').innerHTML = homeBody(); }
});
app.addEventListener('change', (e) => {
  if (e.target.name === 'shelfId' && e.target.value === '__new') newShelfInline(e.target);
  if (e.target.id === 'autolock') { S.data.settings.autoLock = +e.target.value; save(); toast('Сохранено'); }
});

/* ───────────── auto-lock & privacy ───────────── */

let lastAct = Date.now();
let hiddenAt = 0;
['pointerdown', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true, capture: true }));
setInterval(() => {
  if (S && Date.now() - lastAct > (S.data.settings.autoLock || 5) * 60000) lock();
}, 5000);
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('veil', document.hidden);
  if (document.hidden) hiddenAt = Date.now();
  else if (S && hiddenAt && Date.now() - hiddenAt > Math.min((S.data.settings.autoLock || 5) * 60000, 60000)) lock();
  else if (S) pullExternal().then(async (changed) => { if (changed) { await save(); render(); toast('Обновлено'); } });
});

/* ───────────── boot ───────────── */

if (!store.ready) {
  app.innerHTML = `<section class="lock"><div class="glass card stack"><b>Откройте Связку через приложение</b><p class="muted">Эта страница работает только из приложения «Связка» или команды <code>svyazka ui</code>.</p></div></section>`;
} else {
  store.init().then(render, (e) => {
    app.innerHTML = `<section class="lock"><div class="glass card stack"><b>Связка не отвечает</b><p class="muted">${esc(e.message)}. Обновите окно (${MOD}R) или запустите: svyazka ui</p></div></section>`;
  });
}
