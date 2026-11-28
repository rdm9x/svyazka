// Перенос из других менеджеров паролей и обратно. Общий для окна (браузер) и svyazka (Node), без зависимостей.
//   convertForeign(bytes, имяФайла, { inflateRaw }) → { source, data, skipped } | null
//     Bitwarden (.json без пароля, .csv), 1Password (.1pux, .csv), KeePassXC (.csv), Chrome / Edge / Firefox / Safari (.csv).
//     data — открытый формат импорта Связки (IMPORT.md); дальше его разбирает core.planPlainImport.
//   toCSV(data), toBitwarden(data) — экспорт для других менеджеров.
// Правило: всё, что могло быть секретом (пароли, коды 2FA, скрытые поля, заметки), ложится в скрытые поля Связки —
// агенты видят только названия, логины и адреса.

const dec = new TextDecoder();

/* ───────── CSV ───────── */

export function parseCSV(text) {
  const rows = [];
  let row = [], f = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCSVRows = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

// строки CSV → объекты по заголовку (заголовки в нижнем регистре)
function records(rows) {
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/* ───────── zip (.1pux) ───────── */

// Найти файл в zip по имени и распаковать. inflateRaw(u8) → Promise<u8> | u8.
export async function unzipFile(u8, name, inflateRaw) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip');
  let p = dv.getUint32(eocd + 16, true);
  const n = dv.getUint16(eocd + 10, true);
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const fname = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    if (fname === name) {
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const raw = u8.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return new Uint8Array(await inflateRaw(raw));
      throw new Error('zip method ' + method);
    }
    p += 46 + nl + el + cl;
  }
  return null;
}

/* ───────── общее ───────── */

const s = (v) => (v == null ? '' : String(v).replace(/\r\n/g, '\n').trim());
const host = (u) => { if (!u || !String(u).trim()) return ''; try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const join = (...parts) => parts.map(s).filter(Boolean).join('\n\n');

// Сборщик результата: полки по имени, уникальные названия внутри полки и типа
function collector(source, defaultShelf) {
  const shelves = new Map();
  const skipped = {};
  const add = (shelfName, item) => {
    const name = s(shelfName).replace(/\//g, ' · ') || defaultShelf;
    if (!shelves.has(name)) shelves.set(name, []);
    const list = shelves.get(name);
    for (const k of Object.keys(item)) if (item[k] === '' || item[k] == null) delete item[k];
    const base = s(item.title) || host(item.url) || s(item.login) || source;
    let title = base;
    const taken = (x) => list.some((o) => o.type === item.type && o.title.toLowerCase() === x.toLowerCase());
    if (taken(title) && item.login && s(item.login) !== base) title = `${base} (${s(item.login)})`;
    for (let i = 2; taken(title); i++) title = `${base} (${i})`;
    list.push({ ...item, title });
  };
  const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  const done = () => ({
    source,
    data: { format: 'svyazka-import', version: 1, shelves: [...shelves].map(([name, items]) => ({ name, items })) },
    skipped,
  });
  return { add, skip, done };
}

/* ───────── Bitwarden ───────── */

function fromBitwardenJSON(j) {
  if (j.encrypted) throw new Error('BW_ENCRYPTED');
  const c = collector('Bitwarden', 'Bitwarden');
  const folders = new Map((j.folders || []).map((f) => [f.id, f.name]));
  const collections = new Map((j.collections || []).map((f) => [f.id, f.name])); // экспорт организации
  for (const it of j.items || []) {
    const shelf = folders.get(it.folderId) || collections.get(it.collectionIds?.[0]) || 'Bitwarden';
    const fields = it.fields || [];
    const shown = fields.filter((f) => f.type === 0 || f.type === 2).map((f) => `${s(f.name)}: ${s(f.value)}`);
    const hiddenF = fields.filter((f) => f.type === 1).map((f) => `${s(f.name)}: ${s(f.value)}`);
    const hidden = join(it.notes, hiddenF.join('\n'));
    if (it.type === 1) {
      const l = it.login || {};
      c.add(shelf, { type: 'password', title: it.name, login: l.username, password: l.password, url: l.uris?.[0]?.uri, totp: l.totp, note: shown.join('\n'), hidden });
    } else if (it.type === 2) {
      c.add(shelf, { type: 'note', title: it.name, text: shown.join('\n'), hidden });
    } else if (it.type === 5 && it.sshKey) {
      c.add(shelf, { type: 'ssh', title: it.name, privateKey: it.sshKey.privateKey, publicKey: it.sshKey.publicKey, note: shown.join('\n'), hidden });
    } else c.skip(it.type === 3 ? 'cards' : it.type === 4 ? 'identities' : 'other');
  }
  return c.done();
}

function fromBitwardenCSV(recs) {
  const c = collector('Bitwarden', 'Bitwarden');
  for (const r of recs) {
    const shelf = r.folder || (r.collections || '').split(',')[0] || 'Bitwarden';
    if (r.type === 'note') c.add(shelf, { type: 'note', title: r.name, hidden: join(r.notes, r.fields) });
    else if (r.type === 'login' || !r.type) {
      c.add(shelf, { type: 'password', title: r.name, login: r.login_username, password: r.login_password, url: r.login_uri.split(',')[0], totp: r.login_totp, hidden: join(r.notes, r.fields) });
    } else c.skip('other');
  }
  return c.done();
}

/* ───────── 1Password ───────── */

const OP = { login: '001', card: '002', note: '003', identity: '004', password: '005', server: '110', api: '112', ssh: '114' };
// категории, где обычные поля можно показать агентам (адреса, имена); у остальных (банк, паспорт, лицензия, SSN…) всё — в скрытое
const OP_VISIBLE = new Set(['001', '005', '110', '112', '114', '102', '109', '111']);

function fromOnePux(j) {
  const c = collector('1Password', '1Password');
  for (const acc of j.accounts || []) {
    for (const vault of acc.vaults || []) {
      const shelf = vault.attrs?.name || '1Password';
      for (const it of vault.items || []) {
        if (it.state === 'trashed') continue;
        const o = it.overview || {}, d = it.details || {};
        const cat = it.categoryUuid;
        const lf = d.loginFields || [];
        let login = s(lf.find((f) => f.designation === 'username')?.value);
        let password = s(lf.find((f) => f.designation === 'password')?.value) || s(d.password);
        let totp = '', key = null, credential = '';
        const shown = [], hidden = [];
        for (const sec of d.sections || []) {
          for (const f of sec.fields || []) {
            const v = f.value || {};
            const title = s(f.title) || s(f.id);
            if (v.totp != null) { totp ||= s(v.totp); continue; }
            if (v.sshKey) { key = v.sshKey; continue; }
            if (v.concealed != null) {
              if (cat === OP.api && (f.id === 'credential' || !credential)) credential = s(v.concealed);
              else if (!password && /pass|пароль/i.test(title)) password = s(v.concealed);
              else hidden.push(`${title}: ${s(v.concealed)}`);
              continue;
            }
            const text = v.string ?? v.url ?? v.email?.email_address ?? v.email ?? v.phone ?? v.menu ?? v.date ?? v.monthYear;
            if (text == null || typeof text === 'object') continue;
            if (!login && /^(username|user|login|логин|имя пользователя)$/i.test(title)) login = s(text);
            else (OP_VISIBLE.has(cat) ? shown : hidden).push(`${title}: ${s(text)}`);
          }
        }
        const url = s(o.url) || s(o.urls?.[0]?.url);
        const note = shown.join('\n');
        const hid = join(d.notesPlain, hidden.join('\n'));
        if (cat === OP.card || cat === OP.identity) { c.skip(cat === OP.card ? 'cards' : 'identities'); continue; }
        if (cat === OP.note) c.add(shelf, { type: 'note', title: o.title, text: note, hidden: hid });
        else if (cat === OP.ssh && key) {
          c.add(shelf, { type: 'ssh', title: o.title, privateKey: key.privateKey, publicKey: key.metadata?.publicKey, note, hidden: hid });
        } else if (cat === OP.api && credential) {
          c.add(shelf, { type: 'token', title: o.title, value: credential, note: join(note, url), hidden: hid });
        } else if (login || password || url || totp) {
          c.add(shelf, { type: 'password', title: o.title, login, password, url, totp, note, hidden: hid });
        } else if (note || hid) c.add(shelf, { type: 'note', title: o.title, text: note, hidden: hid });
        else c.skip('other');
      }
    }
  }
  return c.done();
}

/* ───────── CSV менеджеров и браузеров ───────── */

function fromLoginCSV(recs, source, map) {
  const c = collector(source, source);
  for (const r of recs) {
    const x = map(r);
    if (x === null) { c.skip('other'); continue; }
    if (!x.login && !x.password && !x.url && !x.hidden) { c.skip('other'); continue; }
    c.add(x.shelf || source, { type: 'password', title: x.title, login: x.login, password: x.password, url: x.url, totp: x.totp, hidden: x.hidden });
  }
  return c.done();
}

const keepassShelf = (g) => {
  const parts = s(g).split('/').filter(Boolean);
  if (parts[0] && /^(root|корень|passwords|база)$/i.test(parts[0])) parts.shift(); // корневая группа базы
  return parts.length ? parts.join(' · ') : 'KeePassXC';
};

function fromCSV(rows, browserName) {
  const recs = records(rows);
  const h = new Set(rows[0].map((x) => x.trim().toLowerCase()));
  const has = (...k) => k.every((x) => h.has(x));
  if ((h.has('folder') || h.has('collections')) && has('type', 'name', 'login_username', 'login_password')) return fromBitwardenCSV(recs);
  if (has('group', 'title', 'username', 'password', 'url')) {
    return fromLoginCSV(recs, 'KeePassXC', (r) => ({ shelf: keepassShelf(r.group), title: r.title, login: r.username, password: r.password, url: r.url, totp: r.totp, hidden: r.notes }));
  }
  if (has('title', 'url', 'username', 'password') && (h.has('otpauth') || h.has('archived'))) {
    const op = h.has('archived') || h.has('tags');
    const name = op ? '1Password' : 'Safari';
    return fromLoginCSV(recs, name, (r) => ({ title: r.title, login: r.username, password: r.password, url: r.url, totp: r.otpauth, hidden: r.notes }));
  }
  if (has('url', 'username', 'password', 'guid')) {
    return fromLoginCSV(recs, 'Firefox', (r) => (/^chrome:\/\//.test(r.url) ? null : { title: host(r.url), login: r.username, password: r.password, url: r.url }));
  }
  if (has('folder', 'name', 'url', 'username', 'password', 'totp')) { // свой CSV (toCSV)
    return fromLoginCSV(recs, 'CSV', (r) => ({ shelf: r.folder, title: r.name, login: r.username, password: r.password, url: r.url, totp: r.totp, hidden: r.note }));
  }
  if (has('name', 'url', 'username', 'password')) {
    return fromLoginCSV(recs, browserName, (r) => ({ title: r.name || host(r.url), login: r.username, password: r.password, url: r.url, hidden: r.note || r.notes }));
  }
  return null;
}

/* ───────── распознать файл ───────── */

// bytes — Uint8Array или строка. null — формат не распознан (тогда это файл Связки или неизвестный).
export async function convertForeign(bytes, name = '', { inflateRaw, browserName = 'Browser' } = {}) {
  const u8 = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  if (u8[0] === 0x50 && u8[1] === 0x4b) { // zip → 1Password .1pux
    if (!inflateRaw) throw new Error('ZIP_UNSUPPORTED');
    const data = await unzipFile(u8, 'export.data', inflateRaw);
    if (!data) return null;
    return fromOnePux(JSON.parse(dec.decode(data)));
  }
  const text = dec.decode(u8).replace(/^﻿/, '');
  const t0 = text.trimStart()[0];
  if (t0 === '{') {
    let j;
    try { j = JSON.parse(text); } catch { return null; }
    if (j && j.encrypted === true) throw new Error('BW_ENCRYPTED'); // экспорт Bitwarden с паролем или привязанный к аккаунту
    if (j && Array.isArray(j.items) && ('encrypted' in j || 'folders' in j || 'collections' in j)) return fromBitwardenJSON(j);
    if (j && Array.isArray(j.accounts)) return fromOnePux(j); // распакованный export.data
    return null;
  }
  if (/\.json$/i.test(name)) return null;
  const rows = parseCSV(text);
  if (rows.length < 1 || rows[0].length < 3) return null;
  return fromCSV(rows, browserName);
}

/* ───────── экспорт ───────── */

// CSV в духе Chrome/Bitwarden: его принимают почти все менеджеры (только пароли; остальное — в toBitwarden)
export function toCSV(data) {
  const shelf = new Map(data.shelves.map((x) => [x.id, x.name]));
  const rows = [['folder', 'name', 'url', 'username', 'password', 'totp', 'note']];
  for (const it of data.items) {
    if (it.type !== 'password') continue;
    const f = it.f || {};
    rows.push([shelf.get(it.shelfId) || '', it.title, f.url, f.login, f.password, f.totp, join(f.note, f.hidden)]);
  }
  return toCSVRows(rows);
}

// Bitwarden JSON (без шифрования): полки → папки; пароли → логины, SSH → SSH-ключи, токены/заметки/оплаты → заметки
export function toBitwarden(data) {
  const folders = data.shelves.map((x) => ({ id: x.id, name: x.name }));
  const items = [];
  const base = (it) => ({ id: it.id, folderId: it.shelfId, favorite: false, name: it.title, reprompt: 0, collectionIds: null });
  const fld = (name, value, hidden) => (value ? [{ name, value: String(value), type: hidden ? 1 : 0, linkedId: null }] : []);
  for (const it of data.items) {
    const f = it.f || {};
    if (it.type === 'password') {
      items.push({ ...base(it), type: 1, notes: join(f.note, f.hidden) || null, fields: [],
        login: { username: f.login || null, password: f.password || null, totp: f.totp || null, uris: f.url ? [{ match: null, uri: f.url }] : [] } });
    } else if (it.type === 'ssh') {
      items.push({ ...base(it), type: 5, notes: join(f.note, f.hidden) || null, fields: [...fld('host', f.host), ...fld('user', f.user), ...fld('port', f.port), ...fld('passphrase', f.passphrase, 1)],
        sshKey: { privateKey: f.privateKey || '', publicKey: f.publicKey || '', keyFingerprint: '' } });
    } else {
      const visible = Object.entries(f).filter(([k, v]) => !['value', 'hidden', 'history', 'anchor'].includes(k) && v !== '' && v != null && typeof v !== 'object');
      const notes = it.type === 'note' ? join(f.text, f.hidden) : join(visible.map(([k, v]) => `${k}: ${v}`).join('\n'), f.note, f.hidden);
      items.push({ ...base(it), type: 2, secureNote: { type: 0 }, notes: notes || null, fields: [...fld('value', f.value, 1)] });
    }
  }
  return JSON.stringify({ encrypted: false, folders, items }, null, 2);
}
