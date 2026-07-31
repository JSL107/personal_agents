#!/usr/bin/env bash
# 이대리 콘솔 개발 편의 실행 — 콘솔 백엔드(PORT=3099)와 macOS 앱을 한 번에 띄운다.
# 앱 창을 닫거나 Ctrl+C 하면 백엔드도 함께 정리된다.
#
# 사용:  pnpm dev          (기본 포트 3099)
#        CONSOLE_PORT=3010 pnpm dev
#
# 순수 백엔드만 개발하려면:  pnpm dev:server
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${CONSOLE_PORT:-3099}"

if [ ! -f "$ROOT/.env" ]; then
  echo "⚠  $ROOT/.env 가 없습니다 — 백엔드 env 검증(DATABASE_URL·REDIS_*)이 실패합니다."
  echo "   메인 트리에서 한 번 복사하세요:"
  echo "     cp \"<메인 repo 경로>/.env\" \"$ROOT/.env\""
  exit 1
fi

if ! command -v swift >/dev/null 2>&1; then
  echo "⚠  swift 툴체인이 없습니다. macOS + Command Line Tools 환경에서 실행하세요."
  exit 1
fi

echo "▶ 콘솔 백엔드 기동 (PORT=$PORT) …"
(cd "$ROOT" && PORT="$PORT" pnpm exec nest start) &
BACKEND_PID=$!

cleanup() {
  echo ""
  echo "▶ 백엔드 정리 (PID $BACKEND_PID) …"
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "▶ macOS 콘솔 앱 기동 (→ http://127.0.0.1:$PORT) …"
echo "  (백엔드 부팅 전이면 앱이 잠깐 '재연결 중' 을 표시한 뒤 자동 연결됩니다)"
cd "$ROOT/clients/idaeri-console"

# SpriteKit 이 Metal drawable 을 제때 못 잡으면 그 프레임을 건너뛰며 아래 한 줄을 남긴다.
# 창이 가려졌을 때뿐 아니라 온전히 보이는 상태에서도 간헐적으로 나고(실측), 화면·기능에는
# 영향이 없다. 렌더를 멈춰 막으려던 접근은 무효였으므로(SpriteView 의 shouldRender 콜백이
# 호출되지 않음) 개발 콘솔의 노이즈만 여기서 걷어낸다. 원본을 보려면 아래를 직접 실행:
#   cd clients/idaeri-console && swift run IdaeriConsole
NOISE_PATTERN='SKView: no drawables available for rendering'

# --line-buffered: 파이프에 물려도 로그가 즉시 흐르게 한다(없으면 버퍼링돼 늦게 보인다).
# set +e / PIPESTATUS: 필터가 아무것도 못 지웠을 때의 grep exit 1 이 pipefail 로 스크립트를
# 실패시키지 않게 하고, 앱의 실제 종료 코드를 보존한다(백엔드 정리는 trap 이 담당).
set +e
IDAERI_CONSOLE_URL="http://127.0.0.1:$PORT" swift run IdaeriConsole 2>&1 \
  | grep --line-buffered -v "$NOISE_PATTERN"
APP_EXIT=${PIPESTATUS[0]}
set -e

exit "$APP_EXIT"
