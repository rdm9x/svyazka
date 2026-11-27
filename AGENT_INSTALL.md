# Installing Svyazka — instructions for an AI agent (Claude Code, Codex, …)

You are installing **Svyazka** for the user: a local encrypted keyring for macOS with a `svyazka` CLI, a desktop app and
a skill for Claude Code and Codex. This folder is the unpacked release (or a clone of the repository).

**Talk to the user in their language** (the app's interface is Russian). Keep messages short and plain.

**Rule for the whole installation: never read or print secrets** — not key contents, not `.env` values, not
`~/.svyazka/vault.json`. Values are moved by `svyazka` itself from files; you only handle names and paths.

## 1. Explain and ask

In one message tell the user what will happen and wait for a yes:
- the app goes to `~/Applications/Связка.app`, the command to `~/.local/bin/svyazka`, files to `~/.svyazka`;
- the `svyazka` skill is linked into `~/.claude/skills` (and `~/.codex/skills` if Codex is installed);
- a short rule block is added to `~/.claude/CLAUDE.md` (and `~/.codex/AGENTS.md`) between
  `<!-- svyazka:begin/end -->` markers: “take credentials from Svyazka; save every new secret there immediately”.
  An existing file is backed up as `.bak-svyazka`.

## 2. Check requirements

```bash
sw_vers -productVersion; node -v; xcrun --find swiftc
```
- macOS 13 or newer.
- No Node.js or older than 20 → suggest `brew install node` (if Homebrew is present) or the installer from nodejs.org.
  Install only with the user's consent.
- No `swiftc` → ask the user to run `xcode-select --install` and wait until it finishes (they do it themselves).

## 3. Install

```bash
sh "<this folder>/install.sh"
```
It copies Svyazka to `~/.svyazka/app`, builds the Touch ID helper and the app, links the skills and adds the rules.
Re-running it updates an existing installation; the vault is never touched.
If it reports that `~/.local/bin` is not in `PATH`, add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zprofile`
(with consent); until the terminal restarts, call `~/.local/bin/svyazka`.

## 4. Create the vault

Ask whether the user has a Svyazka backup from another Mac:
- **yes** → `svyazka import <file>` — a dialog asks for that backup's master password;
- **no** → `svyazka init`. Warn first: a macOS dialog will appear; the password must be **at least 8 characters**,
  a 3–4 word phrase is best, and **it cannot be recovered**. The command waits for input — tell the user to look at
  the screen. If it answers “Минимум 8 символов” or “Отменено”, don't retry silently — ask.

## 5. Codex

If `~/.codex` exists, the skill and rule are already installed. Explain one thing: the Codex sandbox blocks the
Svyazka agent socket, so Codex will ask permission to run `svyazka` outside the sandbox — approve it (it can be
allowed permanently). Codex picks up the skill after it restarts. No Codex — skip.

## 6. Move existing credentials (optional)

Ask whether to import the user's existing keys now. If yes:
1. Find candidates **by name only**, without opening contents: private keys in `~/.ssh` (files with a matching `.pub`
   or whose first line is `-----BEGIN`), hosts in `~/.ssh/config` (`Host`, `HostName`, `User`, `Port`, `IdentityFile`
   are not secrets), `.env` files in project folders the user names.
2. Show the list (name → proposed shelf and type) and ask what to import.
3. Import with `svyazka add`, values only from files:
   ```bash
   svyazka add ssh "user@host" --shelf "Server X" --host … --user … --port … --private-key @~/.ssh/key_x
   svyazka add token ".env prod" --shelf "Project Y" --usage "docker compose" --value @/path/to/.env
   ```
   Passwords the user knows by heart — `--password ask` (they type it in a dialog).
   Many items — build a plain JSON in the `IMPORT.md` format **with a script that reads the files itself**
   (never prints values), run `svyazka import file.json`, then delete that JSON immediately.
4. Don't delete the original files — let the user decide once they've checked everything is there.

## 7. Verify and summarize

```bash
svyazka status; svyazka ls
open ~/Applications/Связка.app
```
Tell the user in 4–6 lines: what was installed, where the app is (Spotlight → “Связка”), that in Claude Code and Codex
it's now enough to ask “connect to …” / “save this key”, that `get` and `copy` need their Touch ID, that the audit
log is `svyazka log`. Remind them about backups (`svyazka sync`, encrypted copy in iCloud Drive) and that the master
password cannot be recovered.

## Updating

New release → run its `install.sh`. The vault and data are untouched.
