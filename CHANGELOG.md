# Changelog

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

- English interface.
- MCP server (`svyazka mcp`) for Cursor, Gemini CLI, Claude Desktop and other agents.
- Import from Bitwarden, 1Password, KeePassXC, browser exports; export back.
- TOTP (2FA) codes; macOS notifications for upcoming payments; Homebrew tap.
