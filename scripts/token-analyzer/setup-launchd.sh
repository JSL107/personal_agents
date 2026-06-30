#!/usr/bin/env bash
# FinLens launchd 설치 — 서버 상시 가동 + 6시간마다 data.json 자동 갱신.
#   설치:   bash scripts/token-analyzer/setup-launchd.sh
#   제거:   bash scripts/token-analyzer/setup-launchd.sh uninstall
# 절대경로는 실행 환경에서 자동 감지한다 (하드코딩 X).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
NODE="$(command -v node)"
LA="$HOME/Library/LaunchAgents"
PORT="${FINLENS_PORT:-8091}"
SRV_LABEL="com.finlens.server"
REF_LABEL="com.finlens.refresh"
SRV_PLIST="$LA/$SRV_LABEL.plist"
REF_PLIST="$LA/$REF_LABEL.plist"

unload() {
  launchctl unload "$SRV_PLIST" 2>/dev/null || true
  launchctl unload "$REF_PLIST" 2>/dev/null || true
}

if [ "${1:-}" = "uninstall" ]; then
  unload
  rm -f "$SRV_PLIST" "$REF_PLIST"
  echo "✅ FinLens launchd 제거 완료"
  exit 0
fi

[ -n "$NODE" ] || { echo "❌ node 를 찾을 수 없습니다"; exit 1; }
mkdir -p "$LA"
NODE_DIR="$(dirname "$NODE")"

# 1) 서버 (상시 가동)
cat > "$SRV_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$SRV_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$SCRIPT_DIR/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FINLENS_PORT</key><string>$PORT</string>
    <key>PATH</key><string>$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$SCRIPT_DIR/.finlens-server.log</string>
  <key>StandardErrorPath</key><string>$SCRIPT_DIR/.finlens-server.log</string>
</dict></plist>
PLIST

# 2) 갱신 (부팅 시 1회 + 6시간마다 analyze 재실행 → data.json)
cat > "$REF_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$REF_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>-r</string><string>ts-node/register</string>
    <string>$SCRIPT_DIR/analyze.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TS_NODE_TRANSPILE_ONLY</key><string>1</string>
    <key>NODE_OPTIONS</key><string>--max-old-space-size=4096</string>
    <key>PATH</key><string>$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>21600</integer>
  <key>StandardOutPath</key><string>$SCRIPT_DIR/.finlens-refresh.log</string>
  <key>StandardErrorPath</key><string>$SCRIPT_DIR/.finlens-refresh.log</string>
</dict></plist>
PLIST

unload
launchctl load -w "$SRV_PLIST"
launchctl load -w "$REF_PLIST"

echo "✅ 설치 완료"
echo "   서버:  http://127.0.0.1:$PORT  (상시 가동)"
echo "   갱신:  부팅 시 + 6시간마다 data.json 재생성 (첫 갱신은 백그라운드로 ~1분)"
echo "   로그:  $SCRIPT_DIR/.finlens-{server,refresh}.log"
echo "   제거:  bash $SCRIPT_DIR/setup-launchd.sh uninstall"
