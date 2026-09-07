#!/usr/bin/env bash
# 오피스 화면을 한 번에 최신 상태로 맞춘다.
#
#   pnpm office:refresh
#
# 부서 편성이나 좌석을 바꾼 뒤에 해야 하는 일이 네 갈래로 흩어져 있었다 — 앱 다시 빌드,
# 웹·윈도우용 평면도 두 벌 다시 뽑기, 그림으로 확인하기. 순서를 틀리면 조용히 낡은 값이
# 박히므로(백엔드가 옛 코드면 옛 편성이 그대로 스냅샷에 들어간다) 한 곳에 모아 두고
# 앞단에서 먼저 막는다.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONSOLE_DIR="$REPO_ROOT/clients/idaeri-console"
WEB_DIR="$REPO_ROOT/clients/office-web"
CONSOLE_URL="${IDAERI_CONSOLE_URL:-http://127.0.0.1:3099}"
RENDER_OUT="${OFFICE_RENDER_OUT:-/tmp/office-refresh.png}"
RENDER_SIZE="${OFFICE_RENDER_SIZE:-1440x860}"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── 1. 백엔드가 살아 있고 최신 코드인가 ────────────────────────────────────────
# 평면도는 백엔드가 준 명단으로 뽑는다. 꺼져 있으면 빈 배치가, 옛 코드면 옛 편성이
# 그대로 박히는데 둘 다 파일이 정상으로 만들어져 **성공처럼 보인다.** 여기서 끊는다.
step "백엔드 확인 ($CONSOLE_URL)"
SNAPSHOT="$(curl -fsS -m 5 "$CONSOLE_URL/v1/console/snapshot" 2>/dev/null)" \
  || fail "백엔드에 못 붙었다. 이대리 서버를 먼저 띄울 것 (기본 포트 3099).
   다른 주소면 IDAERI_CONSOLE_URL 로 지정한다."

SERVED="$(printf '%s' "$SNAPSHOT" | python3 -c \
  'import sys,json; print(len(json.load(sys.stdin)["data"]["agents"]))')"
DEFINED="$(grep -c '\[AgentType\.' "$REPO_ROOT/src/agent-registry/agent-contract.ts")"

if [ "$SERVED" != "$DEFINED" ]; then
  fail "백엔드가 워커 ${SERVED}명을 주는데 사규에는 ${DEFINED}종이 있다 — 실행 중인 서버가
   옛 코드다. 지금 평면도를 뽑으면 낡은 편성이 그대로 박힌다.
   **백엔드를 다시 띄운 뒤 이 명령을 다시 실행할 것.**"
fi
printf '   워커 %s명 · 사규와 일치\n' "$SERVED"

# ── 2. 앱 빌드 ────────────────────────────────────────────────────────────────
step "콘솔 앱 빌드"
(cd "$CONSOLE_DIR" && swift build) || fail "빌드 실패"

step "콘솔 검증"
(cd "$CONSOLE_DIR" && swift run ConsoleCoreTests) || fail "검증 실패 — 평면도를 뽑지 않는다"

# ── 3. 평면도 두 벌 ───────────────────────────────────────────────────────────
# 웹·윈도우 렌더러가 이 스냅샷을 본다. 창 모양에 따라 2열·3열 배치를 고르므로 둘 다 뽑는다.
step "평면도 재생성"
for COLUMNS in 2 3; do
  TARGET="$WEB_DIR/layout-$COLUMNS.json"
  (cd "$CONSOLE_DIR" && IDAERI_CONSOLE_URL="$CONSOLE_URL" \
    swift run IdaeriConsole --layout-json "$TARGET" --zone-columns "$COLUMNS") \
    || fail "평면도 생성 실패 (${COLUMNS}열)"
  printf '   %s\n' "$TARGET"
done

# ── 4. 눈으로 확인할 그림 ─────────────────────────────────────────────────────
# 1440×860 은 3열 배치가 40px 로 서는 가장 작은 크기다. 더 작게 주면 타일이 20px 로
# 떨어져 "왜 작지" 를 다시 묻게 되므로 기본값을 여기에 맞춰 둔다.
step "렌더 ($RENDER_SIZE)"
(cd "$CONSOLE_DIR" && IDAERI_CONSOLE_URL="$CONSOLE_URL" \
  swift run IdaeriConsole --render "$RENDER_OUT" --hour 14 --size "$RENDER_SIZE" >/dev/null) \
  || fail "렌더 실패"

printf '\n\033[32m✓ 완료\033[0m\n'
printf '   그림: %s\n' "$RENDER_OUT"
printf '   앱 실행: cd clients/idaeri-console && swift run IdaeriConsole\n'
