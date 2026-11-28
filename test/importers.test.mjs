// node --test — перенос из Bitwarden, 1Password, KeePassXC, браузеров и выгрузка обратно. Данные выдуманные.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { convertForeign, parseCSV, toCSV, toBitwarden } from '../importers.js';
import { newVault, planPlainImport } from '../core.js';

const inflateRaw = (u8) => zlib.inflateRawSync(u8);
const conv = (x, name = '') => convertForeign(typeof x === 'string' ? x : x, name, { inflateRaw });
const all = (r) => r.data.shelves.flatMap((s) => s.items.map((i) => ({ shelf: s.name, ...i })));

// минимальный zip с одним файлом (deflate) — как .1pux
function zip(name, text) {
  const data = Buffer.from(text), comp = zlib.deflateRawSync(data), fn = Buffer.from(name);
  const crc = zlib.crc32 ? zlib.crc32(data) : 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fn.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(fn.length, 28); cen.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, fn, comp]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + fn.length, 12); end.writeUInt32LE(body.length, 16);
  return new Uint8Array(Buffer.concat([body, cen, fn, end]));
}

test('CSV: кавычки, запятые, переводы строк, BOM', () => {
  assert.deepEqual(parseCSV('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\n'), [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2']]);
});

test('Bitwarden JSON: папки → полки, заметки и скрытые поля — в скрытое, карты пропускаются', async () => {
  const bw = {
    encrypted: false,
    folders: [{ id: 'f1', name: 'Hosting' }],
    items: [
      { type: 1, name: 'Panel', folderId: 'f1', notes: 'recovery: abc', fields: [{ name: 'PIN', value: '1234', type: 1 }, { name: 'Plan', value: 'pro', type: 0 }],
        login: { username: 'me@example.com', password: 'pw-1', totp: 'otpauth://totp/x?secret=JBSWY3DP', uris: [{ uri: 'https://panel.example.com' }] } },
      { type: 2, name: 'Seed', folderId: null, notes: 'word word word', secureNote: { type: 0 } },
      { type: 3, name: 'Visa', card: {} },
      { type: 5, name: 'deploy key', folderId: 'f1', sshKey: { privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----', publicKey: 'ssh-ed25519 AAAA test' } },
    ],
  };
  const r = await conv(JSON.stringify(bw), 'bitwarden.json');
  assert.equal(r.source, 'Bitwarden');
  assert.deepEqual(r.skipped, { cards: 1 });
  const items = all(r);
  const p = items.find((i) => i.title === 'Panel');
  assert.equal(p.shelf, 'Hosting');
  assert.equal(p.type, 'password');
  assert.equal(p.login, 'me@example.com');
  assert.equal(p.totp, 'otpauth://totp/x?secret=JBSWY3DP');
  assert.equal(p.note, 'Plan: pro');
  assert.match(p.hidden, /recovery: abc/);
  assert.match(p.hidden, /PIN: 1234/);
  const n = items.find((i) => i.title === 'Seed');
  assert.equal(n.type, 'note');
  assert.equal(n.shelf, 'Bitwarden');
  assert.equal(n.hidden, 'word word word');
  assert.ok(!n.text);
  assert.equal(items.find((i) => i.title === 'deploy key').type, 'ssh');

  // в хранилище: секреты — в секретных полях
  const plan = planPlainImport(newVault(), r.data);
  assert.equal(plan.items.length, 3);
  assert.equal(plan.items.find((i) => i.title === 'Seed').f.hidden, 'word word word');

  await assert.rejects(conv(JSON.stringify({ encrypted: true, items: [] })), /BW_ENCRYPTED/);
});

test('Bitwarden CSV', async () => {
  const csv = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n'
    + 'Mail,,login,Mailbox,note here,,0,https://mail.example.com,me,pw-2,\n,,note,Wifi,"pass: x",,0,,,,\n';
  const items = all(await conv(csv, 'bw.csv'));
  assert.equal(items.length, 2);
  assert.equal(items[0].shelf, 'Mail');
  assert.equal(items[0].hidden, 'note here');
  assert.equal(items[1].type, 'note');
});

test('1Password .1pux: хранилища → полки, категории, скрытые поля, TOTP, SSH', async () => {
  const data = {
    accounts: [{ vaults: [{ attrs: { name: 'Work' }, items: [
      { categoryUuid: '001', overview: { title: 'GitHub', url: 'https://github.com' }, details: {
        loginFields: [{ designation: 'username', value: 'octo' }, { designation: 'password', value: 'gh-pw' }], notesPlain: 'backup codes: 1 2 3',
        sections: [{ fields: [{ title: 'one-time password', value: { totp: 'otpauth://totp/gh?secret=ABC' } }, { title: 'API', value: { concealed: 'k-1' } }, { title: 'team', value: { string: 'core' } }] }] } },
      { categoryUuid: '112', overview: { title: 'Stripe' }, details: { sections: [{ fields: [{ id: 'credential', title: 'credential', value: { concealed: 'sk_test_1' } }] }] } },
      { categoryUuid: '114', overview: { title: 'server key' }, details: { sections: [{ fields: [{ title: 'private key', value: { sshKey: { privateKey: 'PRIV', metadata: { publicKey: 'ssh-ed25519 PUB' } } } }] }] } },
      { categoryUuid: '003', overview: { title: 'Recovery' }, details: { notesPlain: 'secret words' } },
      { categoryUuid: '004', overview: { title: 'Me' }, details: {} },
      { categoryUuid: '001', state: 'trashed', overview: { title: 'Old' }, details: {} },
    ] }] }],
  };
  const r = await conv(zip('export.data', JSON.stringify(data)), 'export.1pux');
  assert.equal(r.source, '1Password');
  assert.deepEqual(r.skipped, { identities: 1 });
  const items = all(r);
  const gh = items.find((i) => i.title === 'GitHub');
  assert.equal(gh.shelf, 'Work');
  assert.equal(gh.login, 'octo');
  assert.equal(gh.password, 'gh-pw');
  assert.equal(gh.totp, 'otpauth://totp/gh?secret=ABC');
  assert.equal(gh.note, 'team: core');
  assert.match(gh.hidden, /backup codes/);
  assert.match(gh.hidden, /API: k-1/);
  assert.equal(items.find((i) => i.title === 'Stripe').value, 'sk_test_1');
  const k = items.find((i) => i.title === 'server key');
  assert.equal(k.type, 'ssh');
  assert.equal(k.publicKey, 'ssh-ed25519 PUB');
  assert.equal(items.find((i) => i.title === 'Recovery').hidden, 'secret words');
  assert.ok(!items.some((i) => i.title === 'Old'));
});

test('KeePassXC, 1Password CSV, Safari, Chrome, Firefox', async () => {
  let r = await conv('"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n'
    + '"Root/Servers/Prod","db","admin","pw","https://db.example.com","note","otpauth://totp/a?secret=X","0","",""\n');
  assert.equal(r.source, 'KeePassXC');
  assert.equal(all(r)[0].shelf, 'Servers · Prod');
  assert.equal(all(r)[0].totp, 'otpauth://totp/a?secret=X');

  r = await conv('Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nMail,https://mail.example.com,me,pw,,false,false,,n\n');
  assert.equal(r.source, '1Password');

  r = await conv('Title,URL,Username,Password,Notes,OTPAuth\nexample.com (me),https://example.com,me,pw,,\n');
  assert.equal(r.source, 'Safari');

  // Chrome: два аккаунта на одном сайте — оба сохраняются под разными названиями
  r = await conv('name,url,username,password,note\nexample.com,https://example.com/login,alice,p1,\nexample.com,https://example.com/login,bob,p2,\n');
  const titles = all(r).map((i) => i.title);
  assert.deepEqual(titles, ['example.com', 'example.com (bob)']);
  assert.equal(planPlainImport(newVault(), r.data).items.length, 2);

  r = await conv('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n'
    + '"https://www.example.org","u","p",,"https://www.example.org","{1}","1","1","1"\n');
  assert.equal(r.source, 'Firefox');
  assert.equal(all(r)[0].title, 'example.org');

  assert.equal(await conv('just,some,random\n1,2,3\n'), null);
  assert.equal(await conv('{"hello":1}', 'x.json'), null);
});

test('выгрузка: Bitwarden JSON и CSV читаются обратно', async () => {
  const d = newVault();
  d.shelves.push({ id: 's1', name: 'VPS' });
  d.items.push(
    { id: 'i1', shelfId: 's1', type: 'password', title: 'Panel', f: { login: 'me', password: 'pw', url: 'https://p.example.com', totp: 'otpauth://totp/p?secret=Q', hidden: 'h' } },
    { id: 'i2', shelfId: 's1', type: 'ssh', title: 'root@vps', f: { host: '203.0.113.10', user: 'root', privateKey: 'PRIV', publicKey: 'PUB' } },
    { id: 'i3', shelfId: 's1', type: 'token', title: 'API', f: { value: 'tok', usage: 'ci' } },
  );
  const back = all(await conv(toBitwarden(d), 'out.json'));
  assert.equal(back.length, 3);
  const p = back.find((i) => i.title === 'Panel');
  assert.equal(p.shelf, 'VPS');
  assert.equal(p.password, 'pw');
  assert.equal(p.totp, 'otpauth://totp/p?secret=Q');
  assert.equal(back.find((i) => i.title === 'root@vps').privateKey, 'PRIV');

  const csv = toCSV(d);
  assert.equal(csv.split('\r\n')[0], 'folder,name,url,username,password,totp,note');
  const c = all(await conv(csv, 'out.csv'));
  assert.equal(c.length, 1);
  assert.equal(c[0].shelf, 'VPS');
  assert.equal(c[0].password, 'pw');
});

test('крайние случаи: пустые поля, коллекции Bitwarden, корень KeePassXC, только заголовок', async () => {
  let r = await conv(JSON.stringify({ encrypted: false, folders: null, items: [{ type: 1, name: null, notes: null, fields: null, login: { username: null, password: 'p', uris: null, totp: null } }] }), 'x.json');
  assert.equal(all(r)[0].title, 'Bitwarden');
  r = await conv(JSON.stringify({ encrypted: false, collections: [{ id: 'c', name: 'Team' }], items: [{ type: 1, name: 'org', collectionIds: ['c'], login: { username: 'u', password: 'p' } }] }), 'x.json');
  assert.equal(all(r)[0].shelf, 'Team');
  r = await conv('"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\r\n"Root","t","u","p","","","","0","",""\r\n');
  assert.equal(all(r)[0].shelf, 'KeePassXC');
  r = await conv('name,url,username,password,note\r\n');
  assert.equal(all(r).length, 0);
});

test('Bitwarden с паролем — понятная ошибка; имя полки для браузера задаётся', async () => {
  await assert.rejects(conv(JSON.stringify({ encrypted: true, passwordProtected: true, salt: 'x', data: 'y' }), 'bw.json'), /BW_ENCRYPTED/);
  const r = await convertForeign('name,url,username,password\nA,https://a.example,u,p\n', 'c.csv', { browserName: 'Browser' });
  assert.equal(r.source, 'Browser');
});
