#!/bin/sh
# Установка svyazka (macOS, Linux): команда в ~/.local/bin, навык; на Mac ещё помощник Touch ID
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${SVYAZKA_HOME:-$HOME/.svyazka}"
mkdir -p "$DIR/bin" "$HOME/.local/bin"
chmod 700 "$DIR"
[ "$(uname)" = "Darwin" ] && swiftc -O "$HERE/touchid.swift" -o "$DIR/bin/svyazka-touchid"
chmod +x "$HERE/svyazka.mjs"
ln -sf "$HERE/svyazka.mjs" "$HOME/.local/bin/svyazka"
mkdir -p "$HOME/.claude/skills" && ln -sfn "$HERE/skill" "$HOME/.claude/skills/svyazka"   # навык для Claude Code
[ -d "$HOME/.codex" ] && mkdir -p "$HOME/.codex/skills" && ln -sfn "$HERE/skill" "$HOME/.codex/skills/svyazka"   # тот же навык для Codex
echo "Готово: $(command -v svyazka || echo "$HOME/.local/bin/svyazka")"
echo "Дальше: svyazka init  (или svyazka import <бэкап>)"
