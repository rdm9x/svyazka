# Security

Svyazka stores your most sensitive data, so here is exactly what it does and does not protect against.
It has **not** been independently audited.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security → Report a vulnerability) instead of a public issue.
You should get a reply within a week.

## Design

| Part | How it works |
|---|---|
| Vault file | `~/.svyazka/vault.json`, mode `0600`, directory `0700`. One JSON object: format header + AES-256-GCM ciphertext. |
| Key | PBKDF2-SHA256, 600 000 iterations, 16-byte random salt, from your master password. Files with fewer than 100 000 iterations are rejected. |
| Integrity | Format v2 binds the header (`app`, `v`, `kdf`, `iter`, `salt`) as GCM additional data — tampering with parameters makes decryption fail. Fresh 12-byte IV on every save. |
| Agent | Started on demand, holds the derived key in memory, listens on a Unix socket (`0600`). Locks after 30 min idle and after 8 h in any case. Never writes plaintext to disk. |
| Unlock | macOS dialog (`osascript`). Without a GUI session (SSH) — asked in the terminal of the calling command. |
| Reveal / copy / delete | Touch ID (`LocalAuthentication`, falls back to the Mac login password). Without a GUI — the master password in the terminal. |
| `run` | Secrets are passed as environment variables to the child process. Output is scanned and known secret values (and their lines ≥ 8 chars) are replaced with `•••`. |
| `ssh` | The private key is piped to `ssh-add -t 900 -` — it lives in your ssh-agent for 15 minutes and never touches disk. |
| Secrets as arguments | Refused (`--password hunter2` fails): they would end up in shell history and agent logs. Use `gen`, `@file`, `-` or `ask`. |
| Desktop UI | Served by the agent on `127.0.0.1` only, a random per-session token is required for the vault API, the `Host` header is checked (DNS-rebinding), only a fixed allowlist of static files is served. The page decrypts the vault itself with your master password. CSP: no external connections. |
| Audit log | `~/.svyazka/audit.log`: time, caller (terminal / Claude / Codex), operation, item. Never values. |

## Threat model

**Svyazka protects against:**
- secrets leaking into AI agent conversations, terminal scrollback, logs, commits, and project files;
- a copied or stolen vault file or backup (an offline attacker has to brute-force PBKDF2 — use a strong passphrase);
- someone at your unlocked Mac revealing or copying a value without your fingerprint;
- an agent accidentally printing a secret it uses.

**Svyazka does not protect against:**
- **malware running as your user while the vault is unlocked.** Like `ssh-agent` or a browser's password store, any
  process of yours can connect to the agent socket and ask it to run a command with secrets. Lock the vault
  (`svyazka lock`, ⌘L) when you don't need it.
- **a program deliberately exfiltrating a secret it was given** via `run` (e.g. encoding it before printing). Redaction
  is a safety net for accidents, not a sandbox. Every `run` is in the audit log — review it.
- a compromised macOS, keyloggers, or someone who knows your master password;
- loss of the master password — there is no recovery. Keep a backup of the vault (`svyazka sync`) *and* remember the password.

## Test mode

The test suite answers dialogs through environment variables. This only works when **both** `SVYAZKA_TEST=1` is set
**and** the vault directory is inside the system temp directory, never for `~/.svyazka`.
