#!/bin/sh
# Связка — установка на macOS или Linux одним запуском (Windows — install.ps1):
#   команда svyazka, навык и правило для Claude Code и Codex; на Mac ещё приложение «Связка» и Touch ID.
# Хранилище (~/.svyazka/vault.json) не трогается: повторный запуск = обновление.
#
#   curl -fsSL https://github.com/rdm9x/svyazka/releases/latest/download/install.sh | sh
#   sh install.sh                      # из распакованного релиза или клона
#
# Ничего ставить заранее не нужно: если нет Node.js 20+, установщик скачает Node с nodejs.org
# (проверяет контрольную сумму) в ~/.svyazka/node — только для Связки, систему не трогает.
# На Mac помощник Touch ID и приложение берутся готовыми из релиза (собраны GitHub Actions);
# в клоне без них — собираются из исходников (тогда нужны Command Line Tools).
#
# Переменные: SVYAZKA_NODE=download — всегда свой Node; SVYAZKA_RELEASE_URL, SVYAZKA_NODE_DIST — откуда качать.
set -e

ok() { printf '✓ %s\n' "$1"; }
warn() { printf '! %s\n' "$1"; }
die() { printf '✗ %s\n' "$1"; exit 1; }

sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }
fetch() { curl -fsSL --retry 2 "$1" -o "$2"; }

# Запуск одной строкой (curl | sh): скачать последний релиз, проверить сумму и запустить его install.sh
bootstrap() {
  command -v curl >/dev/null 2>&1 || die "Нужен curl"
  command -v unzip >/dev/null 2>&1 || die "Нужен unzip (например: sudo apt install unzip)"
  REL="${SVYAZKA_RELEASE_URL:-https://github.com/rdm9x/svyazka/releases/latest/download}"
  T="$(mktemp -d)"
  trap 'rm -rf "$T"' EXIT
  fetch "$REL/SHA256SUMS.txt" "$T/SUMS" || die "Не удалось скачать $REL/SHA256SUMS.txt"
  ZIP="$(grep -o 'svyazka-[0-9][0-9.]*\.zip' "$T/SUMS" | head -1)"
  [ -n "$ZIP" ] || die "В SHA256SUMS.txt нет архива Связки"
  fetch "$REL/$ZIP" "$T/$ZIP" || die "Не удалось скачать $ZIP"
  [ "$(sha256 "$T/$ZIP")" = "$(grep " $ZIP\$" "$T/SUMS" | cut -d' ' -f1)" ] || die "Контрольная сумма $ZIP не совпала — не устанавливаю"
  ok "скачан $ZIP, контрольная сумма совпала"
  unzip -q "$T/$ZIP" -d "$T"
  sh "$T/svyazka/install.sh"
}

node_ok() { [ -n "$1" ] && [ -x "$1" ] && "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null; }

# Свой Node в ~/.svyazka/node: последняя версия LTS-ветки, сумма — из SHASUMS256.txt того же выпуска Node
private_node() {
  ND="$HOME/.svyazka/node"
  DIST="${SVYAZKA_NODE_DIST:-https://nodejs.org/dist/latest-v24.x}"
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) P=darwin-arm64 ;;
    Darwin-x86_64) P=darwin-x64 ;;
    Linux-x86_64) P=linux-x64 ;;
    Linux-aarch64|Linux-arm64) P=linux-arm64 ;;
    *) die "Нет готового Node для $(uname -s) $(uname -m) — поставьте Node.js 20+ сами" ;;
  esac
  if [ "$P" != "${P#linux}" ] && ldd --version 2>&1 | grep -qi musl; then
    die "Здесь musl (Alpine): поставьте Node.js 20+ из пакетов (apk add nodejs)"
  fi
  command -v curl >/dev/null 2>&1 || die "Нужен curl, чтобы скачать Node.js (или поставьте Node.js 20+ сами)"
  T="$(mktemp -d)"
  if ! fetch "$DIST/SHASUMS256.txt" "$T/SUMS"; then
    rm -rf "$T"
    node_ok "$ND/bin/node" && { warn "nodejs.org недоступен — оставляю Node $("$ND/bin/node" -v)"; NODE="$ND/bin/node"; return; }
    die "Не удалось скачать Node.js с $DIST — проверьте интернет или поставьте Node.js 20+ сами"
  fi
  F="$(grep -o "node-v[0-9.]*-$P\.tar\.gz" "$T/SUMS" | head -1)"
  [ -n "$F" ] || die "Не нашёл Node для $P в $DIST"
  if [ "$(cat "$ND/.svyazka-node" 2>/dev/null)" = "$F" ] && node_ok "$ND/bin/node"; then
    rm -rf "$T"; NODE="$ND/bin/node"; ok "Node.js $("$NODE" -v) — свой, в ~/.svyazka/node"; return
  fi
  printf '… Node.js 20+ не найден — скачиваю %s с nodejs.org (~50 МБ, только для Связки)\n' "$F"
  fetch "$DIST/$F" "$T/$F" || die "Не удалось скачать $F"
  [ "$(sha256 "$T/$F")" = "$(grep " $F\$" "$T/SUMS" | cut -d' ' -f1)" ] || die "Контрольная сумма $F не совпала — не устанавливаю"
  mkdir -p "$T/x" && tar xzf "$T/$F" -C "$T/x" --strip-components 1
  rm -rf "$ND.new" && mv "$T/x" "$ND.new" && rm -rf "$ND" && mv "$ND.new" "$ND"
  printf '%s\n' "$F" > "$ND/.svyazka-node"
  rm -rf "$T"
  NODE="$ND/bin/node"
  node_ok "$NODE" || die "Скачанный Node не запускается"
  ok "Node.js $("$NODE" -v) — скачан в ~/.svyazka/node, контрольная сумма совпала"
}

install_here() {
  DEST="$HOME/.svyazka/app"
  OS="$(uname)"
  case "$OS" in Darwin|Linux) ;; *) die "Для Windows запустите install.ps1" ;; esac
  mkdir -p "$HOME/.svyazka"
  chmod 700 "$HOME/.svyazka"

  NODE=""
  if [ "${SVYAZKA_NODE:-}" != download ]; then
    for c in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.svyazka/node/bin/node"; do
      node_ok "$c" && { NODE="$c"; break; }
    done
  fi
  if [ -n "$NODE" ]; then ok "Node.js $("$NODE" -v) — есть ($NODE)"; else private_node; fi

  # остановить старую версию, если была
  [ -x "$HOME/.local/bin/svyazka" ] && "$HOME/.local/bin/svyazka" stop >/dev/null 2>&1 || true
  [ "$OS" = "Darwin" ] && pkill -f "$HOME/Applications/Связка.app/Contents/MacOS/Svyazka" 2>/dev/null || true

  if [ "$SRC" != "$DEST" ]; then
    rm -rf "$DEST.new"
    mkdir -p "$DEST.new"
    (cd "$SRC" && tar cf - --exclude .git --exclude dist .) | (cd "$DEST.new" && tar xf -)
    rm -rf "$DEST"
    mv "$DEST.new" "$DEST"
  fi
  ok "файлы Связки — в $DEST"

  SVYAZKA_NODE_BIN="$NODE" sh "$DEST/cli/install.sh" >/dev/null
  ok "команда svyazka → ~/.local/bin/svyazka"
  ok "навык svyazka → ~/.claude/skills$( [ -d "$HOME/.codex" ] && printf ' и ~/.codex/skills')"

  if [ "$OS" = "Darwin" ]; then
    APP="$HOME/Applications/Связка.app"
    if [ -d "$DEST/prebuilt/macos/Связка.app" ]; then
      mkdir -p "$HOME/Applications"
      rm -rf "$APP"
      cp -R "$DEST/prebuilt/macos/Связка.app" "$APP"
      xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
      touch "$APP"
      ok "приложение → ~/Applications/Связка.app, Touch ID — готово"
    elif xcrun --find swiftc >/dev/null 2>&1; then
      sh "$DEST/cli/build-app.sh" >/dev/null
      ok "приложение собрано из исходников → ~/Applications/Связка.app"
    else
      warn "в этой копии нет готового приложения, а Command Line Tools не установлены — окно: svyazka ui"
    fi
  fi

  "$NODE" "$DEST/cli/agent-rules.mjs" install

  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ok "~/.local/bin в PATH" ;;
    *) printf '! ~/.local/bin нет в PATH — добавьте в ~/.zprofile (Linux: ~/.profile):\n    export PATH="$HOME/.local/bin:$PATH"\n' ;;
  esac

  if [ -f "$HOME/.svyazka/vault.json" ]; then
    ok "хранилище уже есть — данные не тронуты"
  else
    printf '\nДальше: создать хранилище —  svyazka init   (или svyazka import <бэкап>)\n'
  fi
}

SRC="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -f "$SRC/cli/svyazka.mjs" ] && [ -f "$SRC/install.sh" ]; then install_here; else bootstrap; fi
