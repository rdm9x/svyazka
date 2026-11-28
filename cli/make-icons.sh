#!/bin/sh
# Пересобрать иконки в icons/ из генератора cli/mac-app/make-icon.swift (нужен macOS с Command Line Tools):
#   icons/icon-512.png — без полей (веб, README), icons/icon.ico — Windows (16–256 px).
# icons/icon.svg — векторная копия того же рисунка, правится вручную.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
B="$(mktemp -d)"
trap 'rm -rf "$B"' EXIT
swift "$HERE/mac-app/make-icon.swift" "$ROOT/icons/icon-512.png" 512 full
for s in 16 24 32 48 64 128 256; do swift "$HERE/mac-app/make-icon.swift" "$B/$s.png" "$s" full; done
# .ico из PNG-кадров (так Windows Vista+ читает их напрямую)
node -e '
const fs = require("fs"), dir = process.argv[1], out = process.argv[2];
const sizes = [16, 24, 32, 48, 64, 128, 256], imgs = sizes.map((s) => fs.readFileSync(dir + "/" + s + ".png"));
const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = head.length;
sizes.forEach((s, i) => { const e = 6 + 16 * i; head[e] = s % 256; head[e + 1] = s % 256; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(off, e + 12); off += imgs[i].length; });
fs.writeFileSync(out, Buffer.concat([head, ...imgs]));
' "$B" "$ROOT/icons/icon.ico"
echo "Готово: icons/icon-512.png, icons/icon.ico"
