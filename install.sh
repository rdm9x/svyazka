#!/bin/sh
# Связка — установка на Mac одним запуском:
#   приложение «Связка» в ~/Applications, команда svyazka, Touch ID, навык и правило для Claude Code и Codex.
# Хранилище (~/.svyazka/vault.json) не трогается: повторный запуск = обновление.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.svyazka/app"
ok() { printf '✓ %s\n' "$1"; }
die() { printf '✗ %s\n' "$1"; exit 1; }

[ "$(uname)" = "Darwin" ] || die "Нужен macOS"
command -v node >/dev/null 2>&1 || die "Нужен Node.js 20+ (brew install node или https://nodejs.org)"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || die "Node.js $(node -v) слишком старый — нужен 20+"
xcrun --find swiftc >/dev/null 2>&1 || die "Нужны Command Line Tools: xcode-select --install"
ok "macOS, Node.js $(node -v), Swift — есть"

# остановить старую версию, если была
[ -x "$HOME/.local/bin/svyazka" ] && "$HOME/.local/bin/svyazka" stop >/dev/null 2>&1 || true
pkill -f "Связка.app/Contents/MacOS/Svyazka" 2>/dev/null || true

mkdir -p "$HOME/.svyazka"
chmod 700 "$HOME/.svyazka"
if [ "$SRC" != "$DEST" ]; then
  rm -rf "$DEST.new"
  mkdir -p "$DEST.new"
  (cd "$SRC" && tar cf - --exclude .git --exclude dist .) | (cd "$DEST.new" && tar xf -)
  rm -rf "$DEST"
  mv "$DEST.new" "$DEST"
fi
ok "файлы Связки — в $DEST"

sh "$DEST/cli/install.sh" >/dev/null
ok "команда svyazka → ~/.local/bin/svyazka, Touch ID-помощник собран"
ok "навык svyazka → ~/.claude/skills$( [ -d "$HOME/.codex" ] && printf ' и ~/.codex/skills')"

sh "$DEST/cli/build-app.sh" >/dev/null
ok "приложение → ~/Applications/Связка.app"

node "$DEST/cli/agent-rules.mjs" install

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ok "~/.local/bin в PATH" ;;
  *) printf '! ~/.local/bin нет в PATH — добавьте в ~/.zprofile:\n    export PATH="$HOME/.local/bin:$PATH"\n' ;;
esac

if [ -f "$HOME/.svyazka/vault.json" ]; then
  ok "хранилище уже есть — данные не тронуты"
else
  printf '\nДальше: создать хранилище —  svyazka init   (или svyazka import <бэкап>)\n'
fi
