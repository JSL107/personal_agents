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
IDAERI_CONSOLE_URL="http://127.0.0.1:$PORT" swift run IdaeriConsole
