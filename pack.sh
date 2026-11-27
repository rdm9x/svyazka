#!/bin/sh
# Собрать архив Связки для передачи: dist/svyazka-<версия>.zip (только файлы из git, без .git и личного)
set -e
cd "$(dirname "$0")"
VER=$(sed -n "s/^const VERSION = '\(.*\)';/\1/p" app.js)
OUT="dist/svyazka-$VER.zip"
B="$(mktemp -d)"
trap 'rm -rf "$B"' EXIT
mkdir -p "$B/svyazka" dist
git -c core.quotepath=off ls-files -co --exclude-standard | grep -v -e '^pack.sh$' -e '^.gitignore$' -e '^.github/' -e '^docs/' | while IFS= read -r f; do
  mkdir -p "$B/svyazka/$(dirname "$f")"
  cp -p "$f" "$B/svyazka/$f"
done
chmod +x "$B/svyazka/install.sh" "$B/svyazka/cli/"*.sh "$B/svyazka/cli/svyazka.mjs"
rm -f "$OUT"
(cd "$B" && COPYFILE_DISABLE=1 zip -qrX "$OLDPWD/$OUT" svyazka)
echo "$OUT ($(du -h "$OUT" | cut -f1 | tr -d ' '), $(unzip -l "$OUT" | tail -1 | awk '{print $2}') файлов)"
