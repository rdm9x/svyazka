// node --test — ядро: шифрование, формат файла, слияние, импорт, оплаты.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../core.js';

const ITER = 100000; // быстрее в тестах, но не ниже минимума формата
const session = async (pw = 'correct horse') => {
  const salt = c.rand(16);
  return { key: await c.deriveKey(pw, salt, ITER), salt, iter: ITER, data: c.newVault() };
};

test('шифрование: запечатать и открыть паролем', async () => {
  const s = await session();
  s.data.items.push({ id: 'a', shelfId: 'x', type: 'note', title: 'T', f: { text: 'привет' }, created: 1, updated: 1 });
  const blob = await c.seal(s);
  assert.equal(blob.v, c.FORMAT);
  assert.ok(!JSON.stringify(blob).includes('привет'));
  const o = await c.openVault(blob, 'correct horse');
  assert.equal(o.data.items[0].f.text, 'привет');
  await assert.rejects(c.openVault(blob, 'wrong'));
});

test('формат v2: подмена заголовка ломает расшифровку', async () => {
  const s = await session();
  const blob = await c.seal(s);
  for (const [k, v] of [['iter', ITER + 1], ['salt', c.b64e(c.rand(16))], ['v', 1], ['kdf', 'PBKDF2-SHA256 ']]) {
    await assert.rejects(c.decryptWith({ ...blob, [k]: v }, s.key), `подмена ${k}`);
  }
  await assert.rejects(c.decryptWith({ ...blob, iter: 1000 }, s.key), /параметры/);
  await assert.rejects(c.decryptWith({ ...blob, v: 99 }, s.key), /новой версии/);
});

test('формат v1 (без AAD) по-прежнему читается', async () => {
  const s = await session();
  const iv = c.rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, s.key, new TextEncoder().encode(JSON.stringify(s.data)));
  const v1 = { app: 'svyazka', v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: c.b64e(s.salt), iv: c.b64e(iv), ct: c.b64e(new Uint8Array(ct)) };
  const d = await c.decryptWith(v1, s.key);
  assert.deepEqual(d.items, []);
});

test('слияние: новое, обновлённое, удалённое, одноимённые полки', () => {
  const a = c.newVault(), b = c.newVault();
  a.shelves.push({ id: 's1', name: 'VPS', created: 1 });
  b.shelves.push({ id: 's2', name: 'vps', created: 2 });
  a.items.push({ id: 'i1', shelfId: 's1', type: 'note', title: 'старое', f: { text: '1' }, created: 1, updated: 10 });
  a.items.push({ id: 'i3', shelfId: 's1', type: 'note', title: 'удалят', f: {}, created: 1, updated: 5 });
  b.items.push({ id: 'i1', shelfId: 's2', type: 'note', title: 'новое', f: { text: '2' }, created: 1, updated: 20 });
  b.items.push({ id: 'i2', shelfId: 's2', type: 'note', title: 'с другого', f: {}, created: 3, updated: 3 });
  b.deleted.push({ kind: 'item', id: 'i3', at: 30 });
  const { data, stats } = c.mergeData(a, b);
  assert.deepEqual(stats, { added: 1, updated: 1, removed: 1 });
  assert.equal(data.shelves.length, 1, 'полки склеены по имени');
  assert.equal(data.items.find((i) => i.id === 'i1').title, 'новое');
  assert.ok(data.items.every((i) => i.shelfId === 's1'));
  assert.ok(!data.items.some((i) => i.id === 'i3'));
});

test('слияние: правка позже удаления — запись остаётся', () => {
  const a = c.newVault(), b = c.newVault();
  a.shelves.push({ id: 's', name: 'S', created: 1 });
  a.items.push({ id: 'i', shelfId: 's', type: 'note', title: 'x', f: {}, created: 1, updated: 50 });
  b.deleted.push({ kind: 'item', id: 'i', at: 40 });
  assert.equal(c.mergeData(a, b).data.items.length, 1);
});

test('импорт открытого JSON: дубли и пустые пропускаются', () => {
  const d = c.newVault();
  const src = { format: 'svyazka-import', shelves: [{ name: 'A', items: [
    { type: 'password', login: 'u', password: 'p', url: 'https://ex.com/x' },
    { type: 'password', title: 'ex.com', login: 'u2' },
    { type: 'token' },
    { type: 'bogus', title: 'x' },
    { type: 'payment', title: 'Pay', amount: '4,50', currency: 'eur', period: 12, nextDate: '2026-01-31' },
  ] }] };
  const r = c.planPlainImport(d, src);
  assert.equal(r.items.length, 2);
  assert.equal(r.skipped, 3);
  assert.equal(r.items[0].title, 'ex.com');
  const pay = r.items.find((i) => i.type === 'payment');
  assert.equal(pay.f.amount, '4.50');
  assert.equal(pay.f.currency, 'EUR');
  assert.equal(pay.f.anchor, 31);
});

test('оплата: перенос даты с учётом коротких месяцев', () => {
  assert.equal(c.addMonths('2026-01-31', 1, 31), '2026-02-28');
  assert.equal(c.addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(c.addMonths('2026-11-15', 12), '2027-11-15');
  const it = { type: 'payment', f: { amount: '5', currency: 'USD', period: 1, nextDate: '2026-01-31', anchor: 31 } };
  c.markPaid(it);
  assert.equal(it.f.nextDate, '2026-02-28');
  assert.equal(it.f.history.length, 1);
  const once = { type: 'payment', f: { period: 0, nextDate: '2026-05-01' } };
  c.markPaid(once);
  assert.equal(once.f.done, true);
});
