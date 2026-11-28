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

# Язык сообщений: SVYAZKA_LANG → выбранный в Связке (config.json) → при обновлении русский → язык системы
detect_lang() {
  case "${SVYAZKA_LANG:-}" in ru|en) echo "$SVYAZKA_LANG"; return ;; esac
  c="$(sed -n 's/.*"lang": *"\([a-z]*\)".*/\1/p' "$HOME/.svyazka/config.json" 2>/dev/null | head -1)"
  case "$c" in ru|en) echo "$c"; return ;; esac
  [ -f "$HOME/.svyazka/vault.json" ] && { echo ru; return; }
  t="$(defaults read -g AppleLanguages 2>/dev/null | sed -n 's/^[^A-Za-z]*\([A-Za-z][A-Za-z_-]*\).*/\1/p' | head -1)"
  case "${t:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}" in ru|ru[-_.]*) echo ru ;; *) echo en ;; esac
}
IL="$(detect_lang)"
m() { if [ "$IL" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

ok() { printf '✓ %s\n' "$1"; }
warn() { printf '! %s\n' "$1"; }
die() { printf '✗ %s\n' "$1"; exit 1; }

sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }
fetch() { curl -fsSL --retry 2 "$1" -o "$2"; }

# Запуск одной строкой (curl | sh): скачать последний релиз, проверить сумму и запустить его install.sh
bootstrap() {
  command -v curl >/dev/null 2>&1 || die "$(m "Нужен curl" "curl is required")"
  command -v unzip >/dev/null 2>&1 || die "$(m "Нужен unzip (например: sudo apt install unzip)" "unzip is required (e.g. sudo apt install unzip)")"
  REL="${SVYAZKA_RELEASE_URL:-https://github.com/rdm9x/svyazka/releases/latest/download}"
  T="$(mktemp -d)"
  trap 'rm -rf "$T"' EXIT
  fetch "$REL/SHA256SUMS.txt" "$T/SUMS" || die "$(m "Не удалось скачать" "Could not download") $REL/SHA256SUMS.txt"
  ZIP="$(grep -o 'svyazka-[0-9][0-9.]*\.zip' "$T/SUMS" | head -1)"
  [ -n "$ZIP" ] || die "$(m "В SHA256SUMS.txt нет архива Связки" "No Svyazka archive in SHA256SUMS.txt")"
  fetch "$REL/$ZIP" "$T/$ZIP" || die "$(m "Не удалось скачать" "Could not download") $ZIP"
  [ "$(sha256 "$T/$ZIP")" = "$(grep " $ZIP\$" "$T/SUMS" | cut -d' ' -f1)" ] || die "$(m "Контрольная сумма $ZIP не совпала — не устанавливаю" "Checksum of $ZIP does not match — not installing")"
  ok "$(m "скачан $ZIP, контрольная сумма совпала" "downloaded $ZIP, checksum OK")"
  unzip -q "$T/$ZIP" -d "$T"
  SVYAZKA_LANG="$IL" sh "$T/svyazka/install.sh"
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
    *) die "$(m "Нет готового Node для" "No Node build for") $(uname -s) $(uname -m) — $(m "поставьте Node.js 20+ сами" "install Node.js 20+ yourself")" ;;
  esac
  if [ "$P" != "${P#linux}" ] && ldd --version 2>&1 | grep -qi musl; then
    die "$(m "Здесь musl (Alpine): поставьте Node.js 20+ из пакетов (apk add nodejs)" "This is musl (Alpine): install Node.js 20+ from packages (apk add nodejs)")"
  fi
  command -v curl >/dev/null 2>&1 || die "$(m "Нужен curl, чтобы скачать Node.js (или поставьте Node.js 20+ сами)" "curl is required to download Node.js (or install Node.js 20+ yourself)")"
  T="$(mktemp -d)"
  if ! fetch "$DIST/SHASUMS256.txt" "$T/SUMS"; then
    rm -rf "$T"
    node_ok "$ND/bin/node" && { warn "$(m "nodejs.org недоступен — оставляю Node" "nodejs.org is unreachable — keeping Node") $("$ND/bin/node" -v)"; NODE="$ND/bin/node"; return; }
    die "$(m "Не удалось скачать Node.js с $DIST — проверьте интернет или поставьте Node.js 20+ сами" "Could not download Node.js from $DIST — check the connection or install Node.js 20+ yourself")"
  fi
  F="$(grep -o "node-v[0-9.]*-$P\.tar\.gz" "$T/SUMS" | head -1)"
  [ -n "$F" ] || die "$(m "Не нашёл Node для $P в $DIST" "No Node for $P in $DIST")"
  if [ "$(cat "$ND/.svyazka-node" 2>/dev/null)" = "$F" ] && node_ok "$ND/bin/node"; then
    rm -rf "$T"; NODE="$ND/bin/node"; ok "Node.js $("$NODE" -v) — $(m "свой, в ~/.svyazka/node" "private copy in ~/.svyazka/node")"; return
  fi
  printf "$(m '… Node.js 20+ не найден — скачиваю %s с nodejs.org (~50 МБ, только для Связки)' '… Node.js 20+ not found — downloading %s from nodejs.org (~50 MB, for Svyazka only)')\n" "$F"
  fetch "$DIST/$F" "$T/$F" || die "$(m "Не удалось скачать" "Could not download") $F"
  [ "$(sha256 "$T/$F")" = "$(grep " $F\$" "$T/SUMS" | cut -d' ' -f1)" ] || die "$(m "Контрольная сумма $F не совпала — не устанавливаю" "Checksum of $F does not match — not installing")"
  mkdir -p "$T/x" && tar xzf "$T/$F" -C "$T/x" --strip-components 1
  rm -rf "$ND.new" && mv "$T/x" "$ND.new" && rm -rf "$ND" && mv "$ND.new" "$ND"
  printf '%s\n' "$F" > "$ND/.svyazka-node"
  rm -rf "$T"
  NODE="$ND/bin/node"
  node_ok "$NODE" || die "$(m "Скачанный Node не запускается" "The downloaded Node does not run")"
  ok "Node.js $("$NODE" -v) — $(m "скачан в ~/.svyazka/node, контрольная сумма совпала" "downloaded to ~/.svyazka/node, checksum OK")"
}

install_here() {
  DEST="$HOME/.svyazka/app"
  OS="$(uname)"
  case "$OS" in Darwin|Linux) ;; *) die "$(m "Для Windows запустите install.ps1" "On Windows run install.ps1")" ;; esac
  mkdir -p "$HOME/.svyazka"
  chmod 700 "$HOME/.svyazka"

  NODE=""
  if [ "${SVYAZKA_NODE:-}" != download ]; then
    for c in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.svyazka/node/bin/node"; do
      node_ok "$c" && { NODE="$c"; break; }
    done
  fi
  if [ -n "$NODE" ]; then ok "Node.js $("$NODE" -v) — $(m "есть" "found") ($NODE)"; else private_node; fi

  # остановить старую версию, если была
  [ -x "$HOME/.local/bin/svyazka" ] && "$HOME/.local/bin/svyazka" stop >/dev/null 2>&1 || true
  # значок в строке меню был запущен — после установки запустим новый (без окна)
  RELAUNCH=""
  if [ "$OS" = "Darwin" ] && pgrep -f "$HOME/Applications/Связка.app/Contents/MacOS/Svyazka" >/dev/null 2>&1; then RELAUNCH=1; fi
  [ "$OS" = "Darwin" ] && pkill -f "$HOME/Applications/Связка.app/Contents/MacOS/Svyazka" 2>/dev/null || true

  if [ "$SRC" != "$DEST" ]; then
    rm -rf "$DEST.new"
    mkdir -p "$DEST.new"
    (cd "$SRC" && tar cf - --exclude .git --exclude dist .) | (cd "$DEST.new" && tar xf -)
    rm -rf "$DEST"
    mv "$DEST.new" "$DEST"
  fi
  ok "$(m "файлы Связки — в" "Svyazka files →") $DEST"

  SVYAZKA_NODE_BIN="$NODE" sh "$DEST/cli/install.sh" >/dev/null
  # обновление: прежний интерфейс был только русским — закрепляем его, пока язык не выбрали явно
  [ -f "$HOME/.svyazka/vault.json" ] && "$NODE" "$DEST/cli/svyazka.mjs" config lang "$IL" --if-unset >/dev/null 2>&1 || true
  ok "$(m "команда svyazka" "svyazka command") → ~/.local/bin/svyazka"
  ok "$(m "навык svyazka" "svyazka skill") → ~/.claude/skills$( [ -d "$HOME/.codex" ] && printf ' + ~/.codex/skills')"

  if [ "$OS" = "Darwin" ]; then
    APP="$HOME/Applications/Связка.app"
    if [ -d "$DEST/prebuilt/macos/Связка.app" ]; then
      mkdir -p "$HOME/Applications"
      rm -rf "$APP"
      cp -R "$DEST/prebuilt/macos/Связка.app" "$APP"
      xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
      touch "$APP"
      ok "$(m "приложение → ~/Applications/Связка.app, Touch ID — готово" "app → ~/Applications/Связка.app, Touch ID — ready")"
    elif xcrun --find swiftc >/dev/null 2>&1; then
      sh "$DEST/cli/build-app.sh" >/dev/null
      ok "$(m "приложение собрано из исходников" "app built from source") → ~/Applications/Связка.app"
    else
      warn "$(m "в этой копии нет готового приложения, а Command Line Tools не установлены — окно: svyazka ui" "no prebuilt app in this copy and no Command Line Tools — use: svyazka ui")"
    fi
  fi

  SVYAZKA_LANG="$IL" "$NODE" "$DEST/cli/agent-rules.mjs" install
  [ -n "$RELAUNCH" ] && [ -d "$HOME/Applications/Связка.app" ] && open -g -a "$HOME/Applications/Связка.app" --args --background || true

  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ok "~/.local/bin $(m "в PATH" "is in PATH")" ;;
    *) printf '! %s\n    export PATH="$HOME/.local/bin:$PATH"\n' "$(m '~/.local/bin нет в PATH — добавьте в ~/.zprofile (Linux: ~/.profile):' '~/.local/bin is not in PATH — add to ~/.zprofile (Linux: ~/.profile):')" ;;
  esac

  if [ -f "$HOME/.svyazka/vault.json" ]; then
    ok "$(m "хранилище уже есть — данные не тронуты" "vault already exists — data untouched")"
  else
    printf '\n%s\n' "$(m 'Дальше: создать хранилище —  svyazka init   (или svyazka import <бэкап>)' 'Next: create the vault —  svyazka init   (or svyazka import <backup>)')"
  fi
}

# curl | sh: $0 — это «sh», а не файл; тогда всегда качаем релиз (а не ставим то, что лежит в текущей папке)
case "$(basename -- "$0")" in install.sh) SRC="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)" ;; *) SRC="" ;; esac
if [ -f "$SRC/cli/svyazka.mjs" ] && [ -f "$SRC/install.sh" ]; then install_here; else bootstrap; fi
