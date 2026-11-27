#!/usr/bin/env node
// Постоянное правило о Связке в общих инструкциях агентов:
//   ~/.claude/CLAUDE.md (Claude Code) и ~/.codex/AGENTS.md (Codex, если установлен).
// node agent-rules.mjs install | remove — блок между метками заменяется целиком, остальной файл не трогается.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const BEGIN = '<!-- svyazka:begin -->';
const END = '<!-- svyazka:end -->';
const BLOCK = `${BEGIN}
## Доступы и секреты — в Связке

Пароли, SSH-ключи, токены, .env и оплаты серверов/доменов/подписок хранятся в «Связке» (команда \`svyazka\`, навык \`svyazka\`).
- Нужен доступ — бери его из Связки через навык svyazka (\`svyazka run\`, \`svyazka ssh\`). Значения не выводи и не пиши в чат.
- **Появился новый секрет** (сгенерировал пароль или ключ, создал токен или пользователя, получил доступы от сервиса или от меня) —
  **сразу сохрани его в Связку** (\`svyazka add\`, секрет через \`gen\` / \`@файл\` / \`ask\`) и скажи, на какую полку положил.
  Не оставляй секреты в файлах проекта, заметках, коммитах и в чате.
- Новый сервер, домен или подписка с ценой и датой — добавь оплату (\`svyazka add payment\`).
${END}`;

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
  if (!fs.existsSync(t.need)) { console.log(`· ${t.name}: не установлен — пропускаю`); continue; }
  const old = fs.existsSync(t.file) ? fs.readFileSync(t.file, 'utf8') : '';
  const base = strip(old).replace(/\s+$/, '');
  const next = mode === 'remove' ? (base ? base + '\n' : '') : (base ? base + '\n\n' : '') + BLOCK + '\n';
  if (next === old) { console.log(`· ${t.name}: без изменений (${t.file})`); continue; }
  if (old) fs.copyFileSync(t.file, t.file + '.bak-svyazka');
  fs.writeFileSync(t.file, next);
  console.log(`✓ ${t.name}: ${mode === 'remove' ? 'правило убрано из' : 'правило о Связке в'} ${t.file}${old ? ' (копия: .bak-svyazka)' : ''}`);
}
