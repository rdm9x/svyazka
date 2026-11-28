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
| Agent | Started on demand, holds the derived key in memory. macOS/Linux: Unix socket (`0600`). Windows: `127.0.0.1` on a random port; a random token in `~\.svyazka\agent.json` (your profile) must accompany every request, others are dropped. Locks after 30 min idle and after 8 h in any case. Never writes plaintext to disk. |
| Unlock | Touch ID / Windows Hello if quick unlock is on (default), otherwise a system dialog for the master password (macOS `osascript`, Windows Forms, Linux `zenity`). Without a GUI session (SSH) — the master password in the terminal of the calling command. |
| Quick unlock | After a successful password unlock the derived **vault key** (not the password) is stored: macOS — login Keychain item created by the `svyazka-touchid` helper, which reads it only after Touch ID (other programs get a macOS access prompt); Windows — a file encrypted with DPAPI for your user, decrypted only after Windows Hello. The gate is enforced by Svyazka's helper, not by hardware: a process running as you on Windows could decrypt the DPAPI file without Hello. Changing the master password changes the salt, so an old stored key no longer matches and is deleted. `svyazka config quick-unlock off` deletes it. |
| Reveal / copy / delete | macOS: Touch ID (`LocalAuthentication`, falls back to the login password). Windows: Windows Hello (`UserConsentVerifier`: fingerprint, face or PIN). Where neither is available — a confirmation dialog (weaker: any process of yours could click it). Without a GUI — the master password in the terminal. |
| `run` | Secrets are passed as environment variables to the child process. Output is scanned and known secret values (and their lines ≥ 8 chars) are replaced with `•••`. |
| `ssh` | The private key is piped to `ssh-add -t 900 -` — it lives in your ssh-agent for 15 minutes and never touches disk. On Windows, if the OpenSSH agent rejects the lifetime, the key is added without it and removed by Svyazka after 15 minutes. |
| Secrets as arguments | Refused (`--password hunter2` fails): they would end up in shell history and agent logs. Use `gen`, `@file`, `-` or `ask`. |
| Desktop UI | Served by the agent on `127.0.0.1` only, a random per-session token is required for the vault API (and for `/api/unlock`, which hands the page the vault key after Touch ID / Windows Hello or the master password), the `Host` header is checked (DNS-rebinding), only a fixed allowlist of static files is served. The page decrypts the vault itself with your master password. CSP: no external connections. |
| Installation | The one-line installer downloads the release zip from GitHub and checks it against the release's `SHA256SUMS.txt`. The macOS Touch ID helper and `Связка.app` in the zip are compiled from the tagged source by GitHub Actions (`release.yml`, universal arm64 + x86_64) and ad-hoc signed — not notarized by Apple, so the installer removes the download quarantine flag from just these two; a git clone compiles them locally instead. The helper is replaced only when its bytes change, because macOS ties the Keychain item to the helper's signature and asks once (“Always Allow”) after it changes. If Node.js 20+ is missing, the current Node LTS is downloaded from `nodejs.org` over HTTPS into `~/.svyazka/node` and checked against `SHASUMS256.txt` of the same Node release (this catches corrupted or tampered downloads from a mirror, not a compromise of nodejs.org itself; PGP signatures are not checked). Nothing else is downloaded; no `sudo`. |
| Audit log | `~/.svyazka/audit.log`: time, caller (terminal / Claude / Codex), operation, item. Never values. |

## Threat model

On Windows the vault file relies on the default ACL of your user profile (`%USERPROFILE%`) instead of Unix modes.

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
