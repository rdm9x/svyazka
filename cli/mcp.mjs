// svyazka mcp — MCP-сервер (stdio) для Cursor, Claude Desktop, Gemini CLI и других агентов.
// Ходит к тому же агенту Связки, что и команда svyazka. Инструменты пользуются секретами, не показывая их:
// значения не возвращаются никогда — ни get, ни copy, ни rm здесь нет. Вывод run очищается агентом (•••).
// Протокол: JSON-RPC 2.0 построчно в stdin/stdout. В stdout — только ответы протокола, всё прочее — в stderr.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_OUT = 100000; // символов вывода run в ответе (хвост)

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

function tools(core) {
  const types = Object.keys(core.FIELDS);
  return [
    {
      name: 'svyazka_list',
      description: 'List shelves (projects/servers) in the user\'s Svyazka vault, or the items on one shelf. Secret values are never shown — only which secret fields exist.',
      inputSchema: S({ shelf: str('Shelf name (or part of it). Omit to list shelves.') }),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'svyazka_find',
      description: 'Search items by title, shelf, host, login, URL and other non-secret fields.',
      inputSchema: S({ query: str('Text to search for') }, ['query']),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'svyazka_show',
      description: 'Show one item: its non-secret fields and the names of its secret fields (values stay hidden).',
      inputSchema: S({ item: str('Item title, part of it, or "Shelf/Title"') }, ['item']),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'svyazka_run',
      description: 'Run a command with secrets from Svyazka in its environment, without seeing them. Defaults: password → SVYAZKA_LOGIN, SVYAZKA_PASSWORD, SVYAZKA_URL; token → SVYAZKA_TOKEN plus every KEY=VALUE line of the token; ssh → SVYAZKA_HOST/USER/PORT and the key added to ssh-agent for 15 min; note → SVYAZKA_TEXT. Secret values in the output are replaced with •••. Use env vars in the command (e.g. "$SVYAZKA_PASSWORD"), never ask for values.',
      inputSchema: S({
        items: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Items whose secrets the command needs ("Shelf/Title")' },
        command: {
          description: 'Command: a string (run by the shell: sh -c, or cmd /c on Windows) or an argv array (run directly)',
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1 }],
        },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra variables: {"CF_API_TOKEN": "value"} — variable name → item field' },
        cwd: str('Working directory (default: where the MCP server was started)'),
      }, ['items', 'command']),
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    {
      name: 'svyazka_ssh',
      description: 'Run a command on a server over SSH with a key from Svyazka (the key goes to ssh-agent for 15 minutes, never to disk). Non-interactive. Output is redacted like svyazka_run.',
      inputSchema: S({ item: str('SSH item ("Shelf/Title")'), command: str('Command to run on the server') }, ['item', 'command']),
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    {
      name: 'svyazka_add',
      description: `Save a new item to Svyazka — do it right away whenever a new secret appears (generated password, created token, received credentials). Types: ${types.join(', ')}. Secret fields (password, totp, privateKey, passphrase, value, hidden) accept ONLY "gen" / "gen:32" (generate inside Svyazka), "ask" (the user types it in a system dialog — tell them in chat first) or "@/path/to/file" (read from a file). Other fields are plain text. Payment fields: amount, currency, period (months: 1,3,6,12,24,36, 0 = once), nextDate (YYYY-MM-DD), remind (days), autoRenew, method, url, note.`,
      inputSchema: S({
        type: { type: 'string', enum: types },
        title: str('Item title'),
        shelf: str('Shelf (project or server); created if missing'),
        fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Field → value, e.g. {"login": "me@example.com", "password": "gen", "url": "https://…"}' },
      }, ['type', 'title']),
    },
    {
      name: 'svyazka_payments',
      description: 'Upcoming payments for servers, domains and subscriptions, sorted by date.',
      inputSchema: S({}),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'svyazka_mark_paid',
      description: 'Mark a payment item as paid: moves its next date by the period and records it in history.',
      inputSchema: S({ item: str('Payment item ("Shelf/Title")') }, ['item']),
    },
  ];
}

const SECRET_OK = /^(ask|gen(:\d+)?|@.+)$/;

// Поля для агента: секреты — только gen / ask / @файл (как в командной строке)
function fieldsFor(core, type, raw, t) {
  const known = new Set((core.FIELDS[type] || []).map((f) => f.k));
  const secrets = new Set(core.SECRET_FIELDS[type] || []);
  const out = {};
  for (const [k, v0] of Object.entries(raw || {})) {
    const v = String(v0);
    if (!known.has(k)) throw new Error(t('У типа {0} нет поля {1}. Поля: {2}', type, k, [...known].join(', ')));
    if (secrets.has(k) && !SECRET_OK.test(v)) {
      throw new Error(t('Секрет {0} не передаётся текстом: используйте "gen", "ask" или "@путь/к/файлу".', k));
    }
    if (v === 'ask') out[k] = { ask: 1 };
    else if (/^gen(:\d+)?$/.test(v)) out[k] = { gen: +(v.split(':')[1] || 24) };
    else if (v.startsWith('@')) {
      const p = v.slice(1).replace(/^~(?=[/\\])/, os.homedir());
      out[k] = fs.readFileSync(p, 'utf8').replace(/\r?\n$/, '');
      if (k === 'privateKey' && !raw.publicKey && fs.existsSync(p + '.pub')) out.publicKey = fs.readFileSync(p + '.pub', 'utf8').trim();
    } else out[k] = v;
  }
  return out;
}

function text(v) {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 1);
}

// Строка для настроек клиента: node + скрипт по полным путям (у приложений нет вашего PATH)
export function clientConfig(script) {
  return { mcpServers: { svyazka: { command: process.execPath, args: [script, 'mcp'] } } };
}

export async function serveMcp({ call, core, t, version, setCaller }) {
  const list = tools(core);
  const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  async function runTool(name, a) {
    const sink = { buf: '', out(s) { this.buf += s; }, err(s) { this.buf += s; } };
    switch (name) {
      case 'svyazka_list': return call('list', { shelf: a.shelf || null });
      case 'svyazka_find': return call('find', { q: String(a.query || '') });
      case 'svyazka_show': return call('show', { ref: String(a.item || '') });
      case 'svyazka_payments': return call('pay');
      case 'svyazka_mark_paid': return call('paid', { ref: String(a.item || '') });
      case 'svyazka_add': {
        const fields = fieldsFor(core, a.type, a.fields, t);
        return call('add', { type: a.type, title: String(a.title || ''), shelf: a.shelf || null, fields });
      }
      case 'svyazka_run': {
        const items = Array.isArray(a.items) ? a.items.map(String) : [];
        if (!items.length) throw new Error(t('Укажите запись'));
        const cmd = Array.isArray(a.command) ? a.command.map(String)
          : process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', String(a.command)] : ['/bin/sh', '-c', String(a.command)];
        if (!cmd.length || !cmd[0]) throw new Error(t('Нужна команда'));
        const cwd = a.cwd ? path.resolve(String(a.cwd)) : process.cwd();
        const r = await call('run', { refs: items, envmap: a.env || {}, cmd, cwd, env: process.env, sock: process.env.SSH_AUTH_SOCK }, sink);
        return { exitCode: r.code, output: (r.error ? r.error + '\n' : '') + tail(sink.buf) };
      }
      case 'svyazka_ssh': {
        const it = await call('show', { ref: String(a.item || '') });
        if (it.type !== 'ssh') throw new Error(t('«{0}» — не SSH-запись', it.title));
        if (!it.fields.host) throw new Error(t('У «{0}» не указан хост', it.title));
        const target = (it.fields.user ? it.fields.user + '@' : '') + it.fields.host;
        const cmd = ['ssh', '-o', 'BatchMode=yes', ...(it.fields.port ? ['-p', String(it.fields.port)] : []), target, String(a.command || '')];
        const r = await call('run', { refs: [it.id], envmap: {}, cmd, cwd: process.cwd(), env: process.env, sock: process.env.SSH_AUTH_SOCK }, sink);
        return { exitCode: r.code, output: (r.error ? r.error + '\n' : '') + tail(sink.buf) };
      }
      default: return undefined;
    }
  }
  const tail = (s) => (s.length > MAX_OUT ? t('…(начало вывода обрезано)…') + '\n' + s.slice(-MAX_OUT) : s);

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch { return error(null, -32700, 'Parse error'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return error(null, -32600, 'Invalid Request');
    const { id, method, params = {} } = m;
    const isRequest = id !== undefined && id !== null;
    const p = (async () => {
      if (method === 'initialize') {
        const name = String(params.clientInfo?.name || 'MCP').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'MCP';
        setCaller('MCP: ' + name);
        const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
        return reply(id, {
          protocolVersion: v,
          capabilities: { tools: {} },
          serverInfo: { name: 'svyazka', title: 'Svyazka', version },
          instructions: 'Svyazka is the user\'s encrypted keyring. Use secrets without seeing them: find items with svyazka_list/svyazka_find/svyazka_show, '
            + 'then pass them to svyazka_run or svyazka_ssh. Never ask the user to paste a secret into the chat. '
            + 'Whenever a new secret appears (you generated a password, created a token or a user), save it immediately with svyazka_add '
            + '(secrets only as "gen", "ask" or "@file") and tell the user which shelf it went to.',
        });
      }
      if (!isRequest) return; // уведомления (initialized, cancelled) — ответа не требуют
      if (method === 'ping') return reply(id, {});
      if (method === 'tools/list') return reply(id, { tools: list });
      if (method === 'tools/call') {
        const name = params.name;
        if (!list.some((x) => x.name === name)) return error(id, -32602, `Unknown tool: ${name}`);
        try {
          const r = await runTool(name, params.arguments || {});
          const isError = name === 'svyazka_run' || name === 'svyazka_ssh' ? r.exitCode !== 0 : false;
          return reply(id, { content: [{ type: 'text', text: text(r) }], structuredContent: r && typeof r === 'object' && !Array.isArray(r) ? r : undefined, isError });
        } catch (e) {
          return reply(id, { content: [{ type: 'text', text: e.message || String(e) }], isError: true });
        }
      }
      return error(id, -32601, `Method not found: ${method}`);
    })().catch((e) => { if (isRequest) error(id, -32603, e.message || String(e)); });
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  await new Promise((res) => rl.on('close', res));
  await Promise.allSettled([...pending]);
}
