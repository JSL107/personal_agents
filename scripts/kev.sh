#!/usr/bin/env bash
# 로컬 Kev(Jev 호환 System One 결정 모델) 서버 켜기·끄기·상태.
#   pnpm kev:start | pnpm kev:stop | pnpm kev:status
#
# subconscious 게이트를 shadow 로 비교할 때 쓴다(SUBCONSCIOUS_GATE_MODE=shadow). 운영 판정은 바꾸지 않는다.
# 설치본과 모델은 레포 밖(KEV_HOME)에 둔다 — worktree 마다 2GB 가 복사되지 않게.
#
# 셸 변수(앱 설정 아님):
#   KEV_HOME   기본 ~/.cache/idaeri-kev
#   KEV_PORT   기본 8009
#   KEV_MODEL  기본 jaredpalmer/kev-4b (9B 는 jaredpalmer/kev-9b, 메모리 약 2배)
#   KEV_REF    기본 84847f0 (2026-10-02 M4 Max 에서 실측한 커밋)
set -euo pipefail

KEV_HOME="${KEV_HOME:-$HOME/.cache/idaeri-kev}"
KEV_PORT="${KEV_PORT:-8009}"
KEV_MODEL="${KEV_MODEL:-jaredpalmer/kev-4b}"
KEV_REF="${KEV_REF:-84847f0}"
KEV_REPO_URL="https://github.com/jaredpalmer/kev.git"
KEV_DIR="$KEV_HOME/kev"
PID_FILE="$KEV_HOME/kev.pid"
LOG_FILE="$KEV_HOME/kev.log"
ENDPOINT="http://127.0.0.1:$KEV_PORT/v1/systemone"
# 첫 실행은 베이스 모델(4B 약 8GB)을 받는다.
START_TIMEOUT_SECONDS=1800

probe_body='{"state":"health check","model":"kev-latest","questions":{"ok":{"type":"noul","instructions":"Is this a health check?"}}}'

listening_pid() {
  lsof -ti "tcp:$KEV_PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

# 포트 주인이 Kev 인지 — 다른 프로세스가 8009 를 쓰고 있는데 "이미 실행 중" 으로 끝나지 않게.
is_kev_process() {
  ps -p "$1" -o command= 2>/dev/null | grep -q 'kev.serve'
}

# TERM → 최대 10초 대기 → KILL. 끝까지 살아 있으면 1 을 돌려준다.
terminate() {
  local pid="$1"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  kill -9 "$pid" 2>/dev/null || true
  sleep 1
  ! kill -0 "$pid" 2>/dev/null
}

probe() {
  curl -s -m 30 "$ENDPOINT" -H 'content-type: application/json' -d "$probe_body"
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ $1 이 필요합니다. ($2)" >&2
    exit 1
  fi
}

print_env_hint() {
  cat <<EOF
.env 에 아래를 넣고 앱을 재시작하면 shadow 비교가 시작됩니다:
  SUBCONSCIOUS_GATE_MODE=shadow
  SUBCONSCIOUS_JEV_API_URL=$ENDPOINT
  SUBCONSCIOUS_JEV_MODEL=$(probe | sed -n 's/.*"model":"\([^"]*\)".*/\1/p')
  SUBCONSCIOUS_JEV_TIMEOUT_MS=15000
EOF
}

start() {
  require git "brew install git"
  require uv "brew install uv"
  require lsof "macOS 기본 포함"
  mkdir -p "$KEV_HOME"

  local owner
  owner="$(listening_pid)"
  if [ -n "$owner" ]; then
    if is_kev_process "$owner"; then
      echo "이미 실행 중입니다 (포트 $KEV_PORT, pid $owner)."
      print_env_hint
      return 0
    fi
    echo "❌ 포트 $KEV_PORT 를 다른 프로세스(pid $owner)가 쓰고 있습니다. KEV_PORT 를 바꾸세요." >&2
    exit 1
  fi

  if [ ! -d "$KEV_DIR/.git" ]; then
    echo "Kev 설치: $KEV_DIR"
    git clone --quiet "$KEV_REPO_URL" "$KEV_DIR"
  fi
  git -C "$KEV_DIR" fetch --quiet origin || true
  git -C "$KEV_DIR" checkout --quiet "$KEV_REF"
  (cd "$KEV_DIR" && uv sync --quiet --extra serve)

  echo "Kev 시작: $KEV_MODEL (포트 $KEV_PORT, 로그 $LOG_FILE)"
  # 서브셸로 감싸면 $! 가 uv 가 아니라 서브셸 pid 가 된다(bash 3.2) — 이 셸에서 직접 띄운다.
  cd "$KEV_DIR"
  nohup uv run --extra serve python -m kev.serve \
    --run "$KEV_MODEL" --port "$KEV_PORT" >"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" >"$PID_FILE"

  # curl 대기(최대 30초)까지 포함한 실제 경과로 잰다.
  local started_at=$SECONDS
  until probe | grep -q '"answers"'; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "❌ Kev 프로세스가 종료됐습니다. 로그 끝부분:" >&2
      tail -20 "$LOG_FILE" >&2
      rm -f "$PID_FILE"
      exit 1
    fi
    if [ $((SECONDS - started_at)) -ge "$START_TIMEOUT_SECONDS" ]; then
      echo "❌ ${START_TIMEOUT_SECONDS}초 안에 응답하지 않습니다. 로그: $LOG_FILE (pnpm kev:stop 으로 정리)" >&2
      exit 1
    fi
    sleep 5
  done
  echo "✅ 응답 확인 ($((SECONDS - started_at))초)."
  print_env_hint
}

stop() {
  local stopped=0 pid
  # uv run(부모)과 python kev.serve(자식, 포트 주인)를 둘 다 내린다. uv 를 KILL 하면 자식에게
  # 시그널이 전달되지 않으므로 포트 주인을 따로 확인해 내린다. pid 재사용을 피하려고 명령줄을 본다.
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= 2>/dev/null | grep -q 'kev.serve'; then
      terminate "$pid" || true
      stopped=1
    fi
  fi
  pid="$(listening_pid)"
  if [ -n "$pid" ] && is_kev_process "$pid"; then
    if ! terminate "$pid"; then
      echo "❌ pid $pid 가 내려가지 않습니다." >&2
      exit 1
    fi
    stopped=1
  fi
  rm -f "$PID_FILE"

  pid="$(listening_pid)"
  if [ -n "$pid" ] && is_kev_process "$pid"; then
    echo "❌ 포트 $KEV_PORT 에 Kev 가 아직 떠 있습니다 (pid $pid)." >&2
    exit 1
  fi
  if [ "$stopped" -eq 1 ]; then
    echo "Kev 종료."
  else
    echo "실행 중이 아닙니다."
  fi
}

status() {
  local pid
  pid="$(listening_pid)"
  if [ -z "$pid" ]; then
    echo "중지됨 (포트 $KEV_PORT)."
    return 0
  fi
  if ! is_kev_process "$pid"; then
    echo "중지됨 — 포트 $KEV_PORT 는 Kev 가 아닌 프로세스(pid $pid)가 쓰고 있습니다."
    return 0
  fi
  local response
  response="$(probe || true)"
  echo "실행 중: pid $pid · 포트 $KEV_PORT · 설정 모델 $KEV_MODEL"
  echo "  응답 model: $(echo "$response" | sed -n 's/.*"model":"\([^"]*\)".*/\1/p')"
  echo "  응답 latency_ms: $(echo "$response" | sed -n 's/.*"latency_ms":\([0-9.]*\).*/\1/p')"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    echo "사용법: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac
