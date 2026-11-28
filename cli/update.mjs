// svyazka update — обновление до последнего релиза с GitHub.
// Цепочка доверия: SHA256SUMS.txt подписан ключом Ed25519 автора (открытая часть — release-key.pub, зашита в установку),
// архив сверяется с суммой из подписанного файла. Подмена на GitHub без секретного ключа не пройдёт.
// Ничего не ставится без команды человека: проверка только сообщает, что есть новая версия.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RELEASES = 'https://github.com/rdm9x/svyazka/releases/latest/download';

// «1.10.0» > «1.9.2»
export function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function get(url) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// Подписанный список сумм последнего релиза → { version, zip, sha256 }. Ошибка подписи — исключение SIGNATURE.
export async function latest({ base = RELEASES, pubkey, t = (s) => s } = {}) {
  const sums = await get(base + '/SHA256SUMS.txt');
  const sig = Buffer.from((await get(base + '/SHA256SUMS.txt.sig')).toString('utf8').trim(), 'base64');
  const pub = pubkey || fs.readFileSync(path.join(HERE, 'release-key.pub'), 'utf8');
  if (!crypto.verify(null, sums, pub, sig)) { const e = new Error('SIGNATURE'); e.code = 'SIGNATURE'; throw e; }
  const m = sums.toString('utf8').match(/^([0-9a-f]{64})\s+(svyazka-(\d+\.\d+\.\d+)\.zip)$/m);
  if (!m) throw new Error(t('В SHA256SUMS.txt нет архива Связки'));
  return { version: m[3], zip: m[2], sha256: m[1], base };
}

// Скачать архив, сверить сумму, распаковать, запустить его установщик. Возвращает новую версию.
export async function install(rel, { lang, t = (s) => s } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svyazka-update-'));
  try {
    const zip = await get(rel.base + '/' + rel.zip);
    if (crypto.createHash('sha256').update(zip).digest('hex') !== rel.sha256) throw new Error(t('Контрольная сумма архива не совпала — не устанавливаю'));
    const file = path.join(dir, rel.zip);
    fs.writeFileSync(file, zip);
    // распаковка: unzip (Linux), tar (macOS и Windows 10+ понимают zip)
    const un = process.platform === 'linux' ? spawnSync('unzip', ['-q', file, '-d', dir]) : spawnSync('tar', ['-xf', file, '-C', dir]);
    if (un.status !== 0) throw new Error(process.platform === 'linux' ? t('Не удалось распаковать архив (нужен unzip)') : t('Не удалось распаковать архив'));
    const src = path.join(dir, 'svyazka');
    const env = { ...process.env, SVYAZKA_LANG: lang || process.env.SVYAZKA_LANG || '' };
    const r = process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(src, 'install.ps1')], { stdio: 'inherit', env })
      : spawnSync('sh', [path.join(src, 'install.sh')], { stdio: 'inherit', env });
    if (r.status !== 0) throw new Error(t('Установщик завершился с ошибкой'));
    return rel.version;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
