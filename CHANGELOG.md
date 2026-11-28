# Changelog

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
