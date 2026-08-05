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

# 포트를 실제로 점유한 프로세스를 종료한다.
#
# 아래 백엔드는 `서브셸 → pnpm → nest CLI → node dist/src/main` 4단 트리로 뜨는데,
# listen 하는 건 맨 끝의 node 다. cleanup 이 서브셸(BACKEND_PID)만 죽이면 그 손자가
# 고아(PPID=1)로 살아남아 포트를 계속 쥐고, 다음 `pnpm dev` 가 EADDRINUSE 로 즉사한다.
# PID 를 따라가는 대신 "포트를 쥔 놈"을 기준으로 잡아, 이전 세션이 남긴 좀비와
# 다른 터미널에서 띄운 인스턴스까지 같은 코드로 정리한다.
release_port() {
  local pids
  # set -e 하에서 lsof 는 매칭이 없으면 exit 1 이므로 || true 로 삼킨다.
  pids="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return 0
  fi

  echo "▶ 포트 $PORT 를 점유 중인 기존 프로세스 종료: $(echo "$pids" | tr '\n' ' ')"
  kill $pids 2>/dev/null || true

  # SIGTERM 후 포트가 실제로 풀릴 때까지 최대 5초 대기 — 바로 listen 하면 아직 안 풀려 있다.
  for _ in $(seq 20); do
    if ! lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  echo "  … 정상 종료에 응답하지 않아 강제 종료(SIGKILL)"
  kill -9 $(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true) 2>/dev/null || true
  sleep 0.5
}

release_port

echo "▶ 콘솔 백엔드 기동 (PORT=$PORT) …"
(cd "$ROOT" && PORT="$PORT" pnpm exec nest start) &
BACKEND_PID=$!

cleanup() {
  echo ""
  echo "▶ 백엔드 정리 (PID $BACKEND_PID) …"
  kill "$BACKEND_PID" 2>/dev/null || true
  # 서브셸만 죽으면 실제 listen 하던 손자가 남는다 — 포트 기준으로 한 번 더 훑는다.
  release_port
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

# -F: 위 패턴은 정규식이 아니라 고정 문자열이다. 지금 문구엔 메타문자가 없지만 나중에
#     '.' 이나 '(' 가 섞인 문구로 바꿔도 의도치 않게 매칭되지 않도록 못박는다.
# --line-buffered: 파이프에 물려도 로그가 즉시 흐르게 한다(없으면 버퍼링돼 늦게 보인다).
# set +e / PIPESTATUS: grep -v 는 걸러낸 뒤 출력할 줄이 없거나(GNU/BSD grep), 패턴이 매칭되면
#     (ugrep) exit 1 을 낸다 — 앱이 정상이어도 1 이 나오는 게 정상이다. pipefail 이 그 1 을
#     파이프라인 결과로 올려 errexit 를 터뜨리지 않게 끄고, 앱의 실제 종료 코드는
#     PIPESTATUS[0] 으로 따로 집는다(백엔드 정리는 trap 이 담당).
set +e
IDAERI_CONSOLE_URL="http://127.0.0.1:$PORT" swift run IdaeriConsole 2>&1 \
  | grep -F --line-buffered -v "$NOISE_PATTERN"
APP_EXIT=${PIPESTATUS[0]}
set -e

exit "$APP_EXIT"
