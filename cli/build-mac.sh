#!/bin/sh
# Сборка программ Связки для macOS из исходников (нужны Command Line Tools: xcode-select --install):
#   OUT/svyazka-touchid — помощник Touch ID и связки ключей,
#   OUT/Связка.app      — окно приложения (запускает ~/.local/bin/svyazka).
# По умолчанию — под этот Mac; ARCHS="arm64 x86_64" — универсальная сборка (так собирает релиз в CI).
#   sh cli/build-mac.sh OUT
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="${1:?укажите папку: sh cli/build-mac.sh OUT}"
ARCHS="${ARCHS:-$(uname -m)}"
VER=$(sed -n "s/^const VERSION = '\(.*\)';/\1/p" "$ROOT/app.js")
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

B="$(mktemp -d)"
trap 'rm -rf "$B"' EXIT

# swiftc под каждую архитектуру, затем склейка в один файл
build() { # name, sources…, -- флаги
  name="$1"; shift
  parts=""
  for a in $ARCHS; do
    swiftc -O -target "$a-apple-macos13" -o "$B/$name-$a" "$@" 2>"$B/log" || { cat "$B/log" >&2; exit 1; }
    parts="$parts $B/$name-$a"
  done
  # shellcheck disable=SC2086
  lipo -create $parts -output "$B/$name"
}

build svyazka-touchid "$HERE/touchid.swift"
build Svyazka "$HERE/mac-app/main.swift" -framework Cocoa -framework WebKit

# иконка
swift "$HERE/mac-app/make-icon.swift" "$ROOT/icons/icon-512.png" "$B/icon-1024.png"
mkdir "$B/AppIcon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$B/icon-1024.png" --out "$B/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$B/icon-1024.png" --out "$B/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$B/AppIcon.iconset" -o "$B/AppIcon.icns"

APP="$OUT/Связка.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$B/Svyazka" "$APP/Contents/MacOS/Svyazka"
cp "$B/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
# имя в Finder, Dock и Spotlight — по языку системы (папка остаётся Связка.app)
mkdir -p "$APP/Contents/Resources/ru.lproj" "$APP/Contents/Resources/en.lproj"
printf '"CFBundleDisplayName" = "Связка";\n"CFBundleName" = "Связка";\n' > "$APP/Contents/Resources/ru.lproj/InfoPlist.strings"
printf '"CFBundleDisplayName" = "Svyazka";\n"CFBundleName" = "Svyazka";\n' > "$APP/Contents/Resources/en.lproj/InfoPlist.strings"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Связка</string>
  <key>CFBundleDisplayName</key><string>Связка</string>
  <key>CFBundleIdentifier</key><string>local.svyazka.app</string>
  <key>CFBundleExecutable</key><string>Svyazka</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleDevelopmentRegion</key><string>ru</string>
  <key>LSHasLocalizedDisplayName</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF
cp "$B/svyazka-touchid" "$OUT/svyazka-touchid"
codesign --force -s - "$OUT/svyazka-touchid" >/dev/null 2>&1
codesign --force -s - "$APP" >/dev/null 2>&1
echo "Готово: $OUT/svyazka-touchid, $APP ($(lipo -archs "$OUT/svyazka-touchid"))"
