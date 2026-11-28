# Contributing

Thanks for helping! Svyazka is deliberately small: no build step and **no runtime dependencies** — Node's standard
library, WebCrypto, Swift for two tiny macOS helpers. Please keep it that way; a password tool should be easy to read
end to end.

## Layout

| Path | What |
|---|---|
| `i18n.js`, `lang/` | languages: `t('Русский текст')` and the English dictionaries |
| `core.js` | vault format, encryption, merge, import, payments — shared by the UI and the CLI |
| `app.js`, `styles.css`, `index.html` | desktop UI (served by the agent, shown in `Связка.app` / `svyazka ui`) |
| `cli/svyazka.mjs` | the `svyazka` command and the background agent |
| `cli/mcp.mjs` | `svyazka mcp` — MCP server (stdio) on top of the agent |
| `cli/platform.mjs` | everything OS-specific: dialogs, Touch ID / Windows Hello, clipboard, opening the UI |
| `cli/touchid.swift` | Touch ID confirmation helper |
| `cli/mac-app/` | `Связка.app` (WebKit window) and its icon |
| `cli/build-mac.sh` | compile the helper and the app (`ARCHS="arm64 x86_64"` — universal, as the release does) |
| `cli/skill/SKILL.md` | the skill for Claude Code and Codex |
| `cli/agent-rules.mjs` | the standing rule in `~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md` |
| `install.sh`, `install.ps1` | install on macOS & Linux / on Windows |
| `cli/win/` | Windows Start-menu launcher |
| `pack.sh` | build a release zip (includes `prebuilt/` if present) |
| `test/` | `node --test` suites |

## Develop

```bash
sh cli/install.sh       # ~/.local/bin/svyazka runs your checkout; compiles the Touch ID helper
sh cli/build-app.sh     # compiles ~/Applications/Связка.app from source
npm test                # or: node --test 'test/*.test.mjs'
```

Use a throw-away vault while developing — never your real one:

```bash
export SVYAZKA_HOME=$(mktemp -d) SVYAZKA_TEST=1 SVYAZKA_TEST_PASSWORD=dev-pass-123 SVYAZKA_TEST_CONFIRM=1
svyazka init && svyazka ui
```
(Test mode only works inside the system temp directory — see SECURITY.md.)

## Pull requests

- Add or update tests for behaviour changes; CI runs them on macOS, Windows and Linux.
- Anything touching crypto, the vault format, the agent socket or redaction: explain the reasoning in the PR —
  these get extra review.
- Never log, print or commit secret values, including in tests and examples (use `example.com`, `203.0.113.x`).
- Text is written in Russian and wrapped in `t('…')` (see `i18n.js`); add the English to `lang/en-app.js` (window) or
  `lang/en-cli.js` (command, dialogs). Keys are single-quoted literals with `{0}` placeholders — `test/i18n.test.mjs`
  checks every key is translated; `node test/i18n-left.mjs <file>` lists strings not wrapped yet.

## Releases

Bump `VERSION` in `app.js` and `version` in `package.json` (the app's bundle version is taken from `app.js`), add a
`CHANGELOG.md` section, tag `vX.Y.Z`. The Release workflow builds the universal macOS helper and app into `prebuilt/`,
packs the zip and publishes it with `install.sh`, `install.ps1` and `SHA256SUMS.txt`.
