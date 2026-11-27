#!/bin/sh
# Сборка Связка.app в ~/Applications (окно для Связки на Mac; нужен установленный svyazka — cli/install.sh)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
APP="$HOME/Applications/Связка.app"
NODE="$(command -v node)"
SCRIPT="$HERE/svyazka.mjs"
[ -n "$NODE" ] || { echo "Нужен Node.js"; exit 1; }

B="$(mktemp -d)"
trap 'rm -rf "$B"' EXIT
printf 'let NODE = "%s"\nlet SCRIPT = "%s"\n' "$NODE" "$SCRIPT" > "$B/paths.swift"
swiftc -O -o "$B/Svyazka" "$HERE/mac-app/main.swift" "$B/paths.swift" -framework Cocoa -framework WebKit

# иконка
swift "$HERE/mac-app/make-icon.swift" "$ROOT/icons/icon-512.png" "$B/icon-1024.png"
mkdir "$B/AppIcon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$B/icon-1024.png" --out "$B/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$B/icon-1024.png" --out "$B/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$B/AppIcon.iconset" -o "$B/AppIcon.icns"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$B/Svyazka" "$APP/Contents/MacOS/Svyazka"
cp "$B/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<'EOF'
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
  <key>CFBundleShortVersionString</key><string>1.3.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF
codesign --force -s - "$APP" >/dev/null 2>&1 || true
touch "$APP"
echo "Готово: $APP"
