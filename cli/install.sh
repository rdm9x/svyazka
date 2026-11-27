#!/bin/sh
# Установка svyazka на Mac: помощник Touch ID + команда в ~/.local/bin
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${SVYAZKA_HOME:-$HOME/.svyazka}"
mkdir -p "$DIR/bin" "$HOME/.local/bin"
chmod 700 "$DIR"
swiftc -O "$HERE/touchid.swift" -o "$DIR/bin/svyazka-touchid"
chmod +x "$HERE/svyazka.mjs"
ln -sf "$HERE/svyazka.mjs" "$HOME/.local/bin/svyazka"
mkdir -p "$HOME/.claude/skills" && ln -sfn "$HERE/skill" "$HOME/.claude/skills/svyazka"   # навык для Claude Code
[ -d "$HOME/.codex" ] && mkdir -p "$HOME/.codex/skills" && ln -sfn "$HERE/skill" "$HOME/.codex/skills/svyazka"   # тот же навык для Codex
echo "Готово: $(command -v svyazka || echo "$HOME/.local/bin/svyazka")"
echo "Дальше: svyazka import <бэкап с телефона>  или  svyazka init"
