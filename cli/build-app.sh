#!/bin/sh
# Собрать Связка.app из исходников и положить в ~/Applications (для разработки; нужны Command Line Tools).
# Обычная установка берёт готовое приложение из релиза — см. install.sh.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
B="$(mktemp -d)"
trap 'rm -rf "$B"' EXIT
sh "$HERE/build-mac.sh" "$B" >/dev/null
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Связка.app"
cp -R "$B/Связка.app" "$HOME/Applications/Связка.app"
touch "$HOME/Applications/Связка.app"
echo "Готово: $HOME/Applications/Связка.app"
