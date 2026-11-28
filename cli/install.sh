#!/bin/sh
# Установка svyazka (macOS, Linux): команда в ~/.local/bin, навык; на Mac ещё помощник Touch ID.
# Node: SVYAZKA_NODE_BIN (путь к node) или node из PATH.
# Помощник Touch ID: готовый из релиза (prebuilt/macos), иначе сборка из исходников (нужен swiftc).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DIR="${SVYAZKA_HOME:-$HOME/.svyazka}"
NODE="${SVYAZKA_NODE_BIN:-$(command -v node || true)}"
[ -n "$NODE" ] || { echo "Нужен Node.js 20+ (или запустите install.sh — он скачает Node сам)"; exit 1; }
mkdir -p "$DIR/bin" "$HOME/.local/bin"
chmod 700 "$DIR"

if [ "$(uname)" = "Darwin" ]; then
  T="$DIR/bin/svyazka-touchid"
  if [ -f "$ROOT/prebuilt/macos/svyazka-touchid" ]; then
    # заменяем, только если файл другой: иначе macOS заново спросит доступ к связке ключей
    if ! cmp -s "$ROOT/prebuilt/macos/svyazka-touchid" "$T"; then
      cp "$ROOT/prebuilt/macos/svyazka-touchid" "$T.new" && mv "$T.new" "$T"
    fi
    xattr -d com.apple.quarantine "$T" 2>/dev/null || true
  elif xcrun --find swiftc >/dev/null 2>&1; then
    swiftc -O "$HERE/touchid.swift" -o "$T"
  else
    echo "! Нет готового помощника Touch ID и Command Line Tools — Touch ID не будет работать (вместо него — окно подтверждения)" >&2
  fi
fi

# Команды keyhandoff, kh и svyazka — одна программа: обёртки с полным путём к node (окно приложения и агенты
# запускают их без вашего PATH). svyazka остаётся навсегда: на неё опираются навык, правила и MCP-настройки.
# Сначала удаляем: раньше здесь была ссылка на svyazka.mjs, запись через неё испортила бы сам скрипт.
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
for name in svyazka keyhandoff kh; do
  W="$HOME/.local/bin/$name"
  # чужую программу с тем же именем (например, другую kh) не трогаем
  if [ -e "$W" ] && [ ! -L "$W" ] && ! grep -q "файл создал установщик" "$W" 2>/dev/null; then
    echo "! $W — другая программа, пропускаю" >&2
    continue
  fi
  rm -f "$W"
  cat > "$W" <<EOF
#!/bin/sh
# $name — Связка / Keyhandoff (файл создал установщик)
N=$(q "$NODE")
[ -x "\$N" ] || N=node
exec "\$N" $(q "$HERE/svyazka.mjs") "\$@"
EOF
  chmod 755 "$W"
done
W="$HOME/.local/bin/keyhandoff"

mkdir -p "$HOME/.claude/skills" && ln -sfn "$HERE/skill" "$HOME/.claude/skills/svyazka"   # навык для Claude Code
[ -d "$HOME/.codex" ] && mkdir -p "$HOME/.codex/skills" && ln -sfn "$HERE/skill" "$HOME/.codex/skills/svyazka"   # тот же навык для Codex
echo "Готово: $W (Node: $NODE)"
echo "Дальше: keyhandoff init  (или keyhandoff import <бэкап>; команды svyazka и kh — то же самое)"
