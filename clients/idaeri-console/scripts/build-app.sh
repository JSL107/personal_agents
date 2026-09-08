#!/usr/bin/env bash
# 터미널 실행 파일을 맥 앱(.app 번들)으로 감싼다.
#
#   ./scripts/build-app.sh              # .build/IdaeriConsole.app 을 굽는다
#   ./scripts/build-app.sh /Applications  # 만든 뒤 그 자리에 설치까지
#
# 얻는 것 — Finder 더블클릭 실행과 Dock 고정 유지. 파일 접근 권한(TCC)이 터미널이 아니라
# 앱 단위로 붙는 것도 노렸지만 그건 아직 확인 못 했다: 서명이 링커의 ad-hoc 뿐이라
# 재빌드마다 다른 앱으로 인식될 여지가 있다(제대로 하려면 codesign 이 필요하다).
#
# ─────────────────────────────────────────────────────────────────────────────
# 함정 1 — 리소스 번들을 같이 옮기지 않으면 앱이 뜨자마자 죽는다.
#
# SwiftPM 은 리소스를 실행 파일 옆의 별도 번들(IdaeriConsole_IdaeriConsole.bundle)로
# 굽고, `Bundle.module` 이 그것을 찾는다. 스프라이트 26종과 Dock 아이콘이 전부 거기서
# 나오므로 실행 파일만 옮기면 사무실 그림이 통째로 사라진다 — 아니, 그 전에 접근자가
# `fatalError` 로 프로세스를 끊는다(생성 코드는
# `.build/<arch>/release/IdaeriConsole.build/DerivedSources/resource_bundle_accessor.swift`).
#
# **그 접근자가 보는 곳은 `Contents/Resources/` 가 아니라 `.app` 루트다** —
# `Bundle.main.bundleURL` 에 번들 이름을 그대로 이어 붙인다. 표준 위치가 아니라서
# 눈에 거슬리지만, 규칙을 정하는 쪽이 SwiftPM 이라 여기서는 그 자리에 맞춘다.
# 툴체인이 규칙을 바꾸면 아래 검증에서 걸린다.
#
# 함정 2 — 릴리스 빌드는 제품을 지목해야 한다.
#
# `swift build -c release` 는 `ConsoleCoreTests` 의 `@testable import` 에서 깨진다
# (릴리스에는 `-enable-testing` 이 없다). `--product IdaeriConsole` 로 끊어야 실행
# 파일이 나온다. 파이프로 로그를 흘리면 이 실패가 exit 0 으로 삼켜지니 주의.
set -euo pipefail

CONSOLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CONSOLE_DIR"

APP_NAME="IdaeriConsole"
BUNDLE_ID="com.juneseok.idaeri-console"
RESOURCE_BUNDLE="${APP_NAME}_${APP_NAME}.bundle"
APP="$CONSOLE_DIR/.build/$APP_NAME.app"
INSTALL_DIR="${1:-}"

echo "▶ 릴리스 빌드"
swift build -c release --product "$APP_NAME"

BUILD_DIR="$(swift build -c release --show-bin-path)"
EXECUTABLE="$BUILD_DIR/$APP_NAME"
SOURCE_BUNDLE="$BUILD_DIR/$RESOURCE_BUNDLE"
[ -x "$EXECUTABLE" ] || { echo "✗ 실행 파일이 없다: $EXECUTABLE" >&2; exit 1; }
[ -d "$SOURCE_BUNDLE" ] || { echo "✗ 리소스 번들이 없다: $SOURCE_BUNDLE" >&2; exit 1; }

echo "▶ 아이콘 변환 (appicon.png → AppIcon.icns)"
ICON_SOURCE="$CONSOLE_DIR/Sources/$APP_NAME/Resources/appicon.png"
[ -f "$ICON_SOURCE" ] || { echo "✗ 아이콘 원본이 없다 — python3 scripts/draw-appicon.py 로 굽는다" >&2; exit 1; }
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
# iconutil 이 요구하는 이름 규칙. @2x 는 같은 논리 크기의 두 배 픽셀이라 512@2x 가 1024 다.
for spec in "16:icon_16x16" "32:icon_16x16@2x" "32:icon_32x32" "64:icon_32x32@2x" \
            "128:icon_128x128" "256:icon_128x128@2x" "256:icon_256x256" \
            "512:icon_256x256@2x" "512:icon_512x512" "1024:icon_512x512@2x"; do
  pixels="${spec%%:*}"
  name="${spec##*:}"
  sips -z "$pixels" "$pixels" "$ICON_SOURCE" --out "$ICONSET/$name.png" >/dev/null
done

echo "▶ 번들 배치"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
iconutil --convert icns "$ICONSET" --output "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$(dirname "$ICONSET")"
cp "$EXECUTABLE" "$APP/Contents/MacOS/$APP_NAME"
# 함정 1 — 접근자가 `.app` 루트를 본다. Contents/Resources 에 두면 못 찾는다.
cp -R "$SOURCE_BUNDLE" "$APP/$RESOURCE_BUNDLE"

# `CFBundleVersion` 은 점으로 구분한 숫자여야 한다(Apple 규격) — 짧은 해시를 넣으면
# 규격 밖이고 Launch Services 가 버전을 견줄 때 기댈 것이 없어진다. 커밋 수는 숫자이면서
# 단조 증가라 「어느 시점 빌드인가」를 그대로 답한다.
VERSION="$(git -C "$CONSOLE_DIR" rev-list --count HEAD 2>/dev/null || echo 0)"

# 백엔드 주소를 번들에 굽는다.
#
# Finder 더블클릭은 셸을 거치지 않아 `IDAERI_CONSOLE_URL` 이 앱에 닿지 않는다 — 그대로 두면
# 코드 기본값 3002 로 붙어 「백엔드에 연결하지 못했습니다」만 뜬다(실측). 실 운영은 3099 다.
# `LSEnvironment` 는 Launch Services 가 앱을 띄울 때 주입하므로 그 경로를 메운다.
# 셸에서 직접 실행할 때는 셸 env 가 그대로 이긴다 — 이 값은 Finder 실행에만 관여한다.
# plist 는 XML 이라 `&` `<` `>` 가 그대로 들어가면 문법이 깨진다. `&` 를 먼저 바꾼다 —
# 나중에 하면 앞서 만든 `&lt;` 의 `&` 까지 다시 바꿔 버린다.
xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

CONSOLE_URL="${IDAERI_CONSOLE_URL:-}"
if [ -z "$CONSOLE_URL" ] && [ -f "$CONSOLE_DIR/../../.env" ]; then
  ENV_PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$CONSOLE_DIR/../../.env" | tail -1)"
  [ -n "$ENV_PORT" ] && CONSOLE_URL="http://127.0.0.1:$ENV_PORT"
fi
LS_ENVIRONMENT=""
if [ -n "$CONSOLE_URL" ]; then
  LS_ENVIRONMENT="	<key>LSEnvironment</key>
	<dict>
		<key>IDAERI_CONSOLE_URL</key>
		<string>$(xml_escape "$CONSOLE_URL")</string>
	</dict>
"
fi
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>ko</string>
	<key>CFBundleDisplayName</key>
	<string>이대리 콘솔</string>
	<key>CFBundleExecutable</key>
	<string>$APP_NAME</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundleIdentifier</key>
	<string>$BUNDLE_ID</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>이대리 콘솔</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>$VERSION</string>
$LS_ENVIRONMENT	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<!-- 없으면 레티나에서 2배 스케일이 꺼져 픽셀아트가 흐려진다. -->
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST

echo "▶ 검증"
# 배치가 맞는지 파일로 확인한다. 실행으로는 확인이 안 된다 — 접근자의 두 번째 후보가
# 빌드 머신의 `.build` 절대경로라, 번들을 안 넣어도 이 기계에서는 멀쩡히 뜬다.
for required in \
  "$APP/Contents/MacOS/$APP_NAME" \
  "$APP/Contents/Info.plist" \
  "$APP/Contents/Resources/AppIcon.icns" \
  "$APP/$RESOURCE_BUNDLE/appicon.png" \
  "$APP/$RESOURCE_BUNDLE/sprites"; do
  [ -e "$required" ] || { echo "✗ 빠졌다: $required" >&2; exit 1; }
done
# 접근자가 보는 경로가 바뀌었는지 — 툴체인이 규칙을 바꾸면 여기서 걸린다.
#
# **파일이 없어도 실패시킨다.** 방금 릴리스 빌드를 했으니 반드시 있어야 하고, 없다는 것은
# 생성 경로 자체가 바뀌었다는 뜻이다 — 건너뛰면 이 가드가 겨냥한 바로 그 경우에 눈을 감는다.
ACCESSOR="$CONSOLE_DIR/.build/$(uname -m)-apple-macosx/release/$APP_NAME.build/DerivedSources/resource_bundle_accessor.swift"
if [ ! -f "$ACCESSOR" ]; then
  echo "✗ 리소스 접근자 생성 파일이 없다: $ACCESSOR" >&2
  echo "  경로 규칙이 바뀌었을 수 있다 — 실제 생성 위치를 찾아 이 스크립트를 맞춰라." >&2
  exit 1
fi
if ! grep -q 'Bundle.main.bundleURL.appendingPathComponent' "$ACCESSOR"; then
  echo "✗ Bundle.module 탐색 규칙이 바뀌었다 — $ACCESSOR 를 읽고 배치를 맞춰라" >&2
  exit 1
fi
plutil -lint "$APP/Contents/Info.plist" >/dev/null

if [ -n "$INSTALL_DIR" ]; then
  [ -d "$INSTALL_DIR" ] || { echo "✗ 설치할 디렉터리가 없다: $INSTALL_DIR" >&2; exit 1; }
  echo "▶ 설치 → $INSTALL_DIR/$APP_NAME.app"
  rm -rf "${INSTALL_DIR:?}/$APP_NAME.app"
  cp -R "$APP" "$INSTALL_DIR/"
  APP="$INSTALL_DIR/$APP_NAME.app"
fi

# 같은 경로에 다시 구우면 Launch Services 가 옛 Info.plist 를 들고 있을 수 있다 —
# 그러면 방금 바꾼 LSEnvironment 나 아이콘이 Finder 실행에 반영되지 않는다.
# 설치까지 한 경우 최종 실행 대상은 설치본이므로 그쪽을 등록한다.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP" 2>/dev/null || true

echo "✓ $APP"
echo
echo "  열기        open '$APP'"
echo "  CLI 진입점  '$APP/Contents/MacOS/$APP_NAME' --render /tmp/office.png"
if [ -n "$CONSOLE_URL" ]; then
  echo "  백엔드 주소  $CONSOLE_URL (Finder 실행용으로 번들에 구움)"
else
  echo "  백엔드 주소  못 정했다 — Finder 실행은 코드 기본값 3002 로 붙는다."
  echo "              IDAERI_CONSOLE_URL=http://127.0.0.1:3099 ./scripts/build-app.sh 로 다시 구워라."
fi
echo
echo "  서명은 링커가 붙인 ad-hoc 뿐이라 번들 단위 검증(spctl)은 통과하지 못한다."
echo "  직접 만든 앱은 quarantine 이 안 붙어 그냥 열리고, 내려받아 옮긴 것은 막힌다 —"
echo "  그때는 우클릭 → 열기, 또는 xattr -dr com.apple.quarantine '$APP'"
