# Svyazka

**A local, encrypted keyring for macOS, Windows and Linux that AI coding agents can use — without seeing your secrets.**

[Русская версия](README.ru.md)

![Svyazka on macOS](docs/screenshot-dark.png)

<details><summary>Light theme</summary>

![Svyazka — light theme](docs/screenshot-light.png)

</details>

Coding agents like Claude Code and Codex constantly need SSH keys, API tokens, `.env` files and passwords.
Usually they end up pasted into the chat, left in project files, or scattered across notes.
Svyazka keeps them in one encrypted vault on your computer and gives agents a way to **use** them without **reading** them:

```bash
svyazka ssh "prod/root@vps" -- 'docker ps'                 # key goes to ssh-agent for 15 min, never to disk
svyazka run "my-app/.env prod" -- docker compose up -d     # secrets become env vars of that process only
svyazka add token "Cloudflare API" --shelf my-app --value ask   # you type the value in a macOS dialog
```

If a command prints a secret, it is replaced with `•••`. Revealing a value (`svyazka get`) requires **your Touch ID or Windows Hello**.
Every access is logged with who did it — you, Claude or Codex.

## Features

- **Menu bar key** (macOS) — a key icon next to the clock that blinks when an AI agent uses a key (lavender) or saves
  one (green); click it for the latest agent actions, open or lock Svyazka. Closing the window keeps it there.
- **Desktop app** — `Связка.app` on macOS, a Start-menu app on Windows (Edge app window), `svyazka ui` on Linux. Shelves (one per project or server), passwords, SSH keys, tokens, notes, upcoming payments for
  servers, domains and subscriptions. Three-pane layout, dark and light themes, ⌘F / ⌘N / ⌘L.
- **`svyazka` CLI + agent** — the key stays in memory like `ssh-agent`, auto-locks after 30 min idle.
- **Unlock with Touch ID / Windows Hello** — type the master password once; after that the app and the agents open
  Svyazka with your fingerprint (`svyazka config quick-unlock off` to disable).
- **Built for agents** — a skill for Claude Code and Codex, plus a standing rule: *any new secret goes into Svyazka
  immediately*. Generated a DB password, created a deploy key, received a token — the agent saves it and tells you where.
- **No server, no account** — AES-256-GCM, key derived from your master password (PBKDF2-SHA256, 600k iterations).
  The vault is a single file, `~/.svyazka/vault.json`.
- **Backup and multiple computers** — `svyazka sync` writes an encrypted copy to a folder (iCloud Drive / OneDrive by default)
  and merges changes from your other computers.
- **Move in and out** — import from Bitwarden, 1Password, KeePassXC and browsers (Settings → Import or `svyazka import`);
  notes and 2FA secrets land in hidden fields agents never see. Export back to Bitwarden JSON or CSV.
- **Works over SSH too** — with no GUI session, passwords and confirmations are asked in the terminal.

## Install

Nothing to install first: macOS 13+, Windows 10/11 or Linux (x64 / arm64).
If Node.js 20+ is missing, the installer downloads it from nodejs.org (checksum-verified) into `~/.svyazka/node` —
a private copy for Svyazka only. On a Mac the Touch ID helper and the app come prebuilt in the release, so Xcode and
its Command Line Tools are not needed.

**macOS / Linux** — one line in Terminal:

```bash
curl -fsSL https://github.com/rdm9x/svyazka/releases/latest/download/install.sh | sh
```

**Windows** — PowerShell:

```powershell
irm https://github.com/rdm9x/svyazka/releases/latest/download/install.ps1 -OutFile $env:TEMP\svyazka-install.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\svyazka-install.ps1
```

Then create the vault: `svyazka init` (a dialog asks for the master password). Running the installer again updates
Svyazka; the vault is never touched.

**Or let your agent do it.** Download the latest [release](https://github.com/rdm9x/svyazka/releases), unzip, open Claude Code (or Codex) in the folder and say:

> Install Svyazka following AGENT_INSTALL.md

It installs everything, creates your vault, connects Codex if present and offers to move your
existing keys from `~/.ssh` and `.env` files — without printing their values.

From a git clone: `sh install.sh` (macOS / Linux) or `powershell -ExecutionPolicy Bypass -File install.ps1` (Windows).
A clone has no prebuilt Mac programs, so there they are compiled — that needs Command Line Tools (`xcode-select --install`).

Optional extras: OpenSSH client for `svyazka ssh` on Windows (Windows Hello recommended); on Linux `zenity` for dialogs
and `wl-copy`/`xclip` for the clipboard.

The installer adds a short block to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` between
`<!-- svyazka:begin/end -->` markers (the original file is backed up as `.bak-svyazka`).

## Using it

Open **Svyazka** from Spotlight (Mac) or the Start menu (Windows), or run `svyazka ui`. In Claude Code or Codex just ask: “connect to the prod server”,
“deploy with the tokens from Svyazka”, “generate a password for the new database”.

| Command | What it does |
|---|---|
| `svyazka ls [shelf]`, `find <text>`, `show <item>` | list and search — secrets stay hidden |
| `svyazka add <type> <title> --shelf S [--field value]…` | add an item. Secrets only via `gen`, `@file`, `-` (stdin) or `ask` (dialog) — never as plain arguments |
| `svyazka run <item> [--env NAME=field] -- cmd` | run a command with secrets in its environment; output is redacted |
| `svyazka ssh <item> [-- cmd]`, `ssh-add <item>` | SSH with a key from the vault |
| `svyazka get` / `copy` / `rm` | reveal, copy to clipboard (cleared after 30 s), delete — **Touch ID / Windows Hello required** |
| `svyazka pay`, `paid <item>` | upcoming payments, mark as paid |
| `svyazka sync`, `config sync-dir <folder>` | encrypted backup and merge between your computers |
| `svyazka import <file>` | a Svyazka backup (merge), JSON in the [import format](IMPORT.md), or an export from Bitwarden, 1Password, KeePassXC, Chrome / Edge / Firefox / Safari |
| `svyazka export <file>` | for another manager: `.json` (Bitwarden, all items) or `.csv` (passwords) — after Touch ID, unencrypted |
| `svyazka log`, `status`, `lock` | audit log, state, lock now |
| `svyazka mcp`, `mcp config` | MCP server for Cursor, Claude Desktop, Gemini CLI; the snippet for their settings |
| `svyazka config lang en\|ru\|auto` | interface language (auto — by the system) |

Item types: `password`, `ssh`, `token` (a value or a whole `.env`), `payment`, `note`. `svyazka help` for details.

### Codex

Codex runs commands in a sandbox that blocks the Svyazka agent socket. The skill tells Codex to ask you to run
`svyazka` outside the sandbox — approve it (you can allow it permanently).

### Cursor, Claude Desktop, Gemini CLI and other agents (MCP)

`svyazka mcp` is an MCP server with the same rules: the agent can list and search items, run commands and SSH with
secrets, save new secrets (`gen`, `ask` or `@file` only) and see payments — there is no tool that returns a value.
Print the settings snippet and paste it into the client's MCP config:

```bash
svyazka mcp config
```

| Client | Where |
|---|---|
| Cursor | `~/.cursor/mcp.json` |
| Claude Desktop | Settings → Developer → Edit Config (`claude_desktop_config.json`) |
| Gemini CLI | `~/.gemini/settings.json` |
| Claude Code | not needed — it uses the skill; or `claude mcp add svyazka -- svyazka mcp` |

The log shows such calls as `MCP: <client name>`.

## How the AI doesn't see your keys

A common question: “if Claude uses my keys, doesn't it see them?” Not when it works through `svyazka`:

1. **The agent works with names.** `svyazka ls`, `find`, `show` list shelves, items, hosts and logins; secrets show up
   only as a marker that they exist (`🔒password`).
2. **Secrets go straight into the command.** `svyazka run "Project/.env prod" -- docker compose up -d` — the Svyazka
   agent starts the command itself and puts the values into its environment. They never appear in the chat, in
   arguments or on disk. `svyazka ssh` hands the key to `ssh-agent` for 15 minutes, also bypassing the disk.
3. **Output is scrubbed.** If the command prints a secret anyway (say, `env` or an error containing a token),
   Svyazka replaces it with `•••` before the agent sees the text.
4. **New keys stay hidden too.** Passwords are generated inside Svyazka (`--password gen`), values come from a file
   (`@path`) or another command's output (`-`), and if only you have the key, the agent asks you to paste it into a
   system dialog (`ask`). Passing a secret as a plain argument is refused.
5. **Only a person can reveal a value.** `svyazka get` / `copy` need your Touch ID or Windows Hello, and every access
   is logged (`svyazka log`) with who did it — you, Claude or Codex.

**Where the line is.** This protects against accidental leaks — into chat history, logs, commits, project files. It
does not stop an agent that *deliberately* wants to steal a key: a program given a secret via `run` can encode it
(`base64`) before printing or send it over the network. So keep an eye on which commands the agent runs with
secrets — they are all in the audit log. Details in [SECURITY.md](SECURITY.md).

## Security

Read [SECURITY.md](SECURITY.md) for the full threat model. In short:

- **Protects against:** secrets leaking into agent chats, logs, commits and project files; a stolen or copied vault file;
  someone reading values off your screen without your fingerprint.
- **Does not protect against** malware running as your user while the vault is unlocked — like `ssh-agent`, any process
  of yours can talk to the agent. Output redaction is a safety net against accidents, not a sandbox: a determined
  program can still exfiltrate a value it was given.
- Not audited. Your master password cannot be recovered.

## Status

macOS, Windows and Linux. English and Russian interface (by your system language; `svyazka config lang en|ru` or Settings → Language). See the [changelog](CHANGELOG.md). Windows dialogs and Windows Hello are tested by CI only up to the point where a
person has to click — feedback from Windows users is very welcome. Contributions welcome: [CONTRIBUTING.md](CONTRIBUTING.md).

## Uninstall

```bash
$(command -v node || echo ~/.svyazka/node/bin/node) ~/.svyazka/app/cli/agent-rules.mjs remove
rm -f ~/.local/bin/svyazka ~/.claude/skills/svyazka ~/.codex/skills/svyazka
rm -rf ~/Applications/Связка.app ~/.svyazka/app ~/.svyazka/node ~/Library/LaunchAgents/local.svyazka.menubar.plist
```
Windows: `node $HOME\.svyazka\app\cli\agent-rules.mjs remove`, then delete `~\.svyazka\app`, `~\.svyazka\bin`, `~\.svyazka\node`,
`~\.claude\skills\svyazka`, `~\.codex\skills\svyazka` and the «Связка» Start-menu shortcut.
The vault (`~/.svyazka/vault.json`) is left in place — delete it only if you have a backup or don't need it.

## License

[MIT](LICENSE)
