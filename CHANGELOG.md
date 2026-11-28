# Changelog

## 2.1.0 — 2026-11-28

- **English name: Keyhandoff** (Russian stays «Связка») — keys are handed off between you and your agents by
  themselves. The command is `keyhandoff`, with the short alias `kh`; `svyazka` keeps working forever, so existing
  skills, rules and MCP configs don't change. On an English (or any non-Russian) Mac the app shows as Keyhandoff in
  Finder, Dock and Spotlight; the Windows shortcut is “Keyhandoff”.
- The repository moved to **github.com/rdm9x/keyhandoff** (the old address redirects). Installers and
  `keyhandoff update` use the new address and fall back to the old one.
- The English rule written to `CLAUDE.md` / `AGENTS.md`, the MCP server (`keyhandoff`, tools `keyhandoff_*`), help and
  installer messages use the new name.
- **Project constitution** ([CONSTITUTION.md](CONSTITUTION.md)): what Keyhandoff is for and the principles every change
  is checked against. New README.
- Menu bar wording: agents *use* keys.

## 2.0.1 — 2026-11-28

- English interface: no stray “Back” button above an item in the three-column window.

## 2.0.0 — 2026-11-28

- **Updates in one click**: `svyazka update` (and “Update Svyazka” in the menu bar key, which shows a dot when a new
  version is out; checked once a day, `svyazka config update-check off` to disable). Releases are signed with the
  author's Ed25519 key; an update whose signature doesn't match is refused. `svyazka status` mentions a new version.
- The installer restarts the menu bar key after an update if it was running.
- Installed before 2.0? Update once with the install line from the README; after that — `svyazka update`.

## 1.9.0 — 2026-11-28

- **Key in the macOS menu bar**: blinks when an AI agent uses a key (lavender: command, SSH, reveal, copy) or saves
  one (green); its menu shows the latest agent actions, opens or locks Svyazka. Closing the window keeps Svyazka in the
  menu bar without a Dock icon; it starts at login with the icon only (toggle in the menu).
- **Compact window**: 960×620 by default, narrower columns, denser rows; the background now runs under the title bar.
- When the window is closed, the page is unloaded — the decrypted vault does not stay in memory.

## 1.8.2 — 2026-11-28

- **New icon**: a classic key on a dark blue glass square — the Mac app, the Windows shortcut, the browser tab, and
  the logo on the lock screen and in the sidebar. The icon is drawn by `cli/mac-app/make-icon.swift`;
  `cli/make-icons.sh` rebuilds `icons/`.
- New README screenshots.

## 1.8.1 — 2026-11-28

Fixes after a full review:

- **Security:** values in `.env` tokens written with quotes (`API_KEY="…"`) were not hidden in `run` output (also
  through MCP). Now they are.
- **Security:** hidden notes and 2FA secrets can no longer be passed to commands (`--env X=hidden`), so an agent
  can't read them in a disguised form.
- Only one agent per vault: several commands started at once could leave an extra agent running after `svyazka stop`.
- The app's password form no longer piggybacks on an unlock started elsewhere without checking the password.
- `svyazka get` on a note works again; `gen:0` is refused (8–256 characters).
- Import: password-protected Bitwarden exports get a clear message; Bitwarden organisation exports keep collections
  as shelves; nested KeePassXC groups keep their path; 1Password bank accounts, documents and licences go to hidden
  notes; items without a title no longer get “undefined”; “Browser” shelf in English.
- English amounts like `1,200` are read as 1200 (not 1.2); new English vaults default to USD.
- App: Escape closes dialogs; password and 2FA fields no longer overlap their buttons; theme and language switches fit
  narrow windows; “1 line” instead of “1 lines”; the 2FA field is labelled “2FA secret”; action errors show a message.
- MCP: string commands run through the shell correctly on Windows; requests without a method get a proper error.
- The CLI messages follow the language of the calling terminal even when the agent was started from another one.
- `curl … | sh` always installs the latest release, even when run inside a clone; updates keep the language you chose.

## 1.8.0 — 2026-11-28

- **Import from other password managers and browsers**: Bitwarden (`.json`, `.csv`), 1Password (`.1pux`, `.csv`),
  KeePassXC (`.csv`), Chrome / Edge / Firefox / Safari (`.csv`) — `svyazka import <file>` or Settings → Import.
  Folders and vaults become shelves; several accounts on one site keep separate items; cards and identities are skipped.
- **Export back**: `svyazka export file.json` (Bitwarden, all items) or `file.csv` (passwords) — after Touch ID;
  in the app: Settings → Export for another manager.
- New hidden fields: **hidden notes** (all types except payments) and **2FA secret (TOTP)** for passwords. Notes and
  secrets from other managers go there, so agents never see them.
- “Copy access” no longer includes hidden notes or the 2FA secret.

## 1.7.0 — 2026-11-28

- **MCP server** `svyazka mcp` for Cursor, Claude Desktop, Gemini CLI and other agents: list, find and show items,
  run commands and SSH with secrets (output redacted), save new secrets (`gen` / `ask` / `@file`), payments.
  No tool returns a secret value. `svyazka mcp config` prints the snippet for the client's settings.
- The audit log and dialogs name the MCP client (`MCP: Cursor`).

## 1.6.0 — 2026-11-28

- **English interface**: the app window, the `svyazka` command and its help, system dialogs, the Mac app menu, the
  installers and the rule written to `CLAUDE.md` / `AGENTS.md`. The language follows the system; switch it with
  `svyazka config lang en|ru|auto` or in the app (Settings → Language). Updating an existing install keeps Russian.
- README: “How the AI doesn't see your keys” — a plain answer to the most common question.
- On macOS the app is named “Svyazka” in Finder and Spotlight on an English system.
- Settings rows with switches are aligned to the left like the others.

## 1.5.0 — 2026-11-28

- **Install without preparation**: one line (`curl … | sh` on macOS / Linux, two PowerShell lines on Windows) downloads
  the latest release and checks its checksum. Xcode Command Line Tools are no longer needed: the Touch ID helper and
  `Связка.app` come prebuilt in the release (universal: Apple Silicon and Intel). No Node.js 20+ → the installer
  downloads Node LTS from nodejs.org (checksum-verified) into `~/.svyazka/node`, only for Svyazka.
- `~/.local/bin/svyazka` (and `svyazka.cmd` on Windows) is now a small wrapper with the full path to Node, so the app,
  the Start-menu shortcut and agents find it without your `PATH`. The app no longer has paths built in.
- After this update macOS may ask once to let `svyazka-touchid` use the “Svyazka” Keychain item — enter your Mac
  password and click “Always Allow”. Later updates replace the helper only when it actually changes.
- The installer now closes only its own `Связка.app`, not any running copy.

## 1.4.1 — 2026-11-27

- **Fix:** the app window opened without Touch ID when the agent was already unlocked (e.g. after an agent used
  Svyazka), and its password form accepted any password in that state. Now the window always requires Touch ID /
  Windows Hello or the correct master password; agents keep working within the unlocked session.

## 1.4.0 — 2026-11-27

- **Unlock with Touch ID / Windows Hello**: after one password unlock the vault key is kept in the macOS Keychain
  (behind the Touch ID helper) or in a DPAPI-protected file (behind Windows Hello). The app asks for the fingerprint
  when it opens; one unlock covers the app and the agents. `svyazka config quick-unlock on|off`.
- The app's lock (button, ⌘/Ctrl+L) also locks the agent.
- Clear wording in the dialog where an agent asks you to type a value; the skill avoids such dialogs when the agent
  can save the value itself.
- Touch ID helper distinguishes “cancelled” from “unavailable” (then falls back to a confirmation dialog).

## 1.3.0 — 2026-11-27

- **Windows support**: `install.ps1`, `svyazka` command, Start-menu shortcut (Edge app window), Windows Hello for
  `get` / `copy` / `rm`, Windows dialogs and clipboard, OpenSSH agent for `svyazka ssh`. The agent talks over
  `127.0.0.1` with a per-run token.
- **Linux support** (CLI): terminal prompts or `zenity` dialogs, `wl-copy` / `xclip`, `svyazka ui` in the browser.
- `svyazka sync` defaults to OneDrive on Windows.
- Shortcut hints in the UI follow the platform (⌘ / Ctrl).
- CI runs the full test suite and installer smoke tests on macOS, Windows and Linux.

## 1.2.0 — 2026-11-27

First public release.

- Desktop app for macOS (`Связка.app`): shelves, passwords, SSH keys, tokens, notes, payments with reminders;
  three-pane layout, dark and light themes, keyboard shortcuts.
- `svyazka` CLI with a background agent: `run` and `ssh` use secrets without revealing them, output redaction,
  Touch ID for `get` / `copy` / `rm`, audit log with the caller (terminal / Claude / Codex).
- Skill for Claude Code and Codex and a standing rule: new secrets go into Svyazka immediately.
- Vault format v2: the header is authenticated (AES-GCM additional data); v1 vaults are read and upgraded on save.
- Works without a GUI session (SSH): passwords and confirmations in the terminal.
- `svyazka sync` with a configurable folder: encrypted backup and merge between Macs.
- One-shot `install.sh`, `AGENT_INSTALL.md` for agent-driven setup, tests and CI.

## Planned

- TOTP (2FA) codes; macOS notifications for upcoming payments; Homebrew tap; signed and notarized builds.
