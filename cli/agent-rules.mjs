#!/usr/bin/env node
// Постоянное правило о Связке в общих инструкциях агентов:
//   ~/.claude/CLAUDE.md (Claude Code) и ~/.codex/AGENTS.md (Codex, если установлен).
// node agent-rules.mjs install | remove — блок между метками заменяется целиком, остальной файл не трогается.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LANGS, langFromTag } from '../i18n.js';
import { systemLang } from './platform.mjs';

const HOME = os.homedir();
// язык — как у svyazka: config lang → SVYAZKA_LANG → язык системы
const LANG = (() => {
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(process.env.SVYAZKA_HOME || path.join(HOME, '.svyazka'), 'config.json'), 'utf8')).lang; } catch {}
  const e = process.env.SVYAZKA_LANG;
  return LANGS.includes(c) ? c : LANGS.includes(e) ? e : langFromTag(e || systemLang());
})();
const en = LANG === 'en';
const BEGIN = '<!-- svyazka:begin -->';
const END = '<!-- svyazka:end -->';
const BLOCK_RU = `${BEGIN}
## Доступы и секреты — в Связке

Пароли, SSH-ключи, токены, .env и оплаты серверов/доменов/подписок хранятся в «Связке» (команда \`svyazka\`, навык \`svyazka\`).
- Нужен доступ — бери его из Связки через навык svyazka (\`svyazka run\`, \`svyazka ssh\`). Значения не выводи и не пиши в чат.
- **Появился новый секрет** (сгенерировал пароль или ключ, создал токен или пользователя, получил доступы от сервиса или от меня) —
  **сразу сохрани его в Связку** (\`svyazka add\`, секрет через \`gen\` / \`@файл\` / \`ask\`) и скажи, на какую полку положил.
  Не оставляй секреты в файлах проекта, заметках, коммитах и в чате.
- Новый сервер, домен или подписка с ценой и датой — добавь оплату (\`svyazka add payment\`).
${END}`;

const BLOCK_EN = `${BEGIN}
## Credentials and secrets live in Keyhandoff

Passwords, SSH keys, tokens, .env files and payments for servers/domains/subscriptions are kept in Keyhandoff (the \`keyhandoff\` command — also \`kh\` and \`svyazka\` — and the \`svyazka\` skill).
- Need access — use it through Keyhandoff (\`keyhandoff run\`, \`keyhandoff ssh\`). Never print values or put them in the chat.
- **A new secret appeared** (you generated a password or key, created a token or user, received credentials from a service or from me) —
  **save it to Keyhandoff right away** (\`keyhandoff add\`, the secret via \`gen\` / \`@file\` / \`ask\`) and say which shelf you put it on.
  Don't leave secrets in project files, notes, commits or the chat.
- A new server, domain or subscription with a price and date — add a payment (\`keyhandoff add payment\`).
${END}`;
const BLOCK = en ? BLOCK_EN : BLOCK_RU;

const targets = [
  { file: path.join(HOME, '.claude', 'CLAUDE.md'), name: 'Claude Code', need: path.join(HOME, '.claude') },
  { file: path.join(HOME, '.codex', 'AGENTS.md'), name: 'Codex', need: path.join(HOME, '.codex') },
];

const strip = (text) => {
  const i = text.indexOf(BEGIN), j = text.indexOf(END);
  if (i < 0 || j < i) return text;
  return (text.slice(0, i).replace(/\n+$/, '') + '\n' + text.slice(j + END.length).replace(/^\n+/, '\n')).replace(/^\n+/, '');
};

const mode = process.argv[2] || 'install';
for (const t of targets) {
  if (!fs.existsSync(t.need)) { console.log(en ? `· ${t.name}: not installed — skipping` : `· ${t.name}: не установлен — пропускаю`); continue; }
  const old = fs.existsSync(t.file) ? fs.readFileSync(t.file, 'utf8') : '';
  const base = strip(old).replace(/\s+$/, '');
  const next = mode === 'remove' ? (base ? base + '\n' : '') : (base ? base + '\n\n' : '') + BLOCK + '\n';
  if (next === old) { console.log(en ? `· ${t.name}: unchanged (${t.file})` : `· ${t.name}: без изменений (${t.file})`); continue; }
  if (old) fs.copyFileSync(t.file, t.file + '.bak-svyazka');
  fs.writeFileSync(t.file, next);
  console.log(en
    ? `✓ ${t.name}: ${mode === 'remove' ? 'rule removed from' : 'Keyhandoff rule in'} ${t.file}${old ? ' (backup: .bak-svyazka)' : ''}`
    : `✓ ${t.name}: ${mode === 'remove' ? 'правило убрано из' : 'правило о Связке в'} ${t.file}${old ? ' (копия: .bak-svyazka)' : ''}`);
}
