#!/usr/bin/env python3
"""이대리 앱 다운 감시 — 앱 바깥(hermes cron)에서 이대리가 응답하는지 본다.

이대리 안의 감시(cuj-check ↔ 아침 브리핑 결번 감시)는 앱이 꺼지면 함께 멈춘다. 이 스크립트는
hermes cron 이 5분마다 `--no-agent` 로 돌려, 앱이 일정 시간 이상 응답하지 않으면 Slack 으로 알린다.
hermes 는 stdout 이 비면 아무것도 보내지 않고, 비어 있지 않으면 그대로 전달한다
(`cron/scheduler.py` no_agent 분기). 스크립트가 예외로 죽어도 hermes 가 "script failed" 를 대신 보낸다.

살아 있음 판정: `GET http://127.0.0.1:3099/` 에 HTTP 응답이 오면 무엇이든(404 포함) 산 것으로 본다.
이대리에는 상태 확인 전용 주소가 없지만, 404 가 돌아왔다는 것 자체가 Node HTTP 서버와 이벤트 루프가
돈다는 증거다. DB·Redis·워커 상태는 cuj-check 의 몫이라 여기서 보지 않는다.

유예: 첫 실패부터 GRACE_SECONDS(10분) 이상 지났고 연속 MIN_CONSECUTIVE_FAILURES(2)회 이상 실패해야
알린다. 재시작(`scripts/console-dev.sh` 의 포트 정리 최대 ~5.5초 + `nest start` 컴파일·부팅, 2026-10-14
실측 nest CLI → node 기동 7초)은 1~2분이면 끝나므로 10분이면 점검 두 번 분량의 여유가 있다.
연속 2회 조건은 절전에서 깬 직후 한 번 삐끗한 것으로 울리지 않게 한다. 알림은 장애 시작 1회, 회복 1회뿐이다.

맥북이 잠들면 앱과 이 감시가 함께 멈춘다 — 그동안은 울리지도, 잘못 울리지도 않는다.
hermes 가 멈추면 이 job 의 next_run_at 이 굳어 이대리 hermes-watchdog(매일 08:30, 60분 초과 정지 판정)이 잡는다.

이 레포가 정본이고 `~/.hermes/scripts/idaeri-down-watch.py` 에 복사본을 둔다. 심볼릭 링크는 hermes 가
scripts 디렉터리 밖으로 resolve 되는 경로를 막아서 쓸 수 없다(`scripts/hermes-morning-news.py` 머리말 참고).
이 파일을 고치면 복사본도 갱신한다: `cp scripts/hermes-idaeri-down-watch.py ~/.hermes/scripts/idaeri-down-watch.py`

`python3 scripts/hermes-idaeri-down-watch.py --self-check` 는 네트워크 없이 판정 로직만 검사한다.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

TARGET_URL = os.environ.get("IDAERI_DOWN_WATCH_URL", "http://127.0.0.1:3099/")
STATE_PATH = Path(
    os.environ.get(
        "IDAERI_DOWN_WATCH_STATE",
        str(Path.home() / ".hermes" / "cache" / "idaeri-down-watch.json"),
    )
)
TIMEOUT_SECONDS = 5
GRACE_SECONDS = 10 * 60
MIN_CONSECUTIVE_FAILURES = 2


def probe(url: str) -> str | None:
    """살아 있으면 None, 아니면 실패 사유."""
    # 로컬 주소라 프록시 환경변수를 타면 안 된다.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url, timeout=TIMEOUT_SECONDS):
            return None
    except urllib.error.HTTPError:
        return None
    except urllib.error.URLError as error:
        return str(error.reason)
    except OSError as error:
        return str(error) or type(error).__name__


def clock(epoch: float) -> str:
    return datetime.fromtimestamp(epoch).strftime("%m-%d %H:%M")


def minutes(seconds: float) -> int:
    return int(seconds // 60)


def step(state: dict, failure: str | None, now: float) -> tuple[dict, str | None]:
    """점검 결과 하나를 상태에 반영하고, 보낼 메시지가 있으면 함께 돌려준다."""
    if failure is None:
        message = None
        if state.get("alerted"):
            since = state["first_failure_at"]
            message = (
                f"🟢 이대리 앱 회복 — 약 {minutes(now - since)}분 응답 없었음 "
                f"({clock(since)} ~ {clock(now)})"
            )
        return {"last_ok_at": now}, message

    first_failure_at = state.get("first_failure_at", now)
    failures = state.get("consecutive_failures", 0) + 1
    next_state = {
        **state,
        "first_failure_at": first_failure_at,
        "consecutive_failures": failures,
    }
    down_for = now - first_failure_at
    if (
        state.get("alerted")
        or failures < MIN_CONSECUTIVE_FAILURES
        or down_for < GRACE_SECONDS
    ):
        return next_state, None

    last_ok_at = state.get("last_ok_at")
    last_ok = clock(last_ok_at) if last_ok_at else "기록 없음"
    message = (
        f"🔴 이대리 앱 응답 없음 — {minutes(down_for)}분째 "
        f"({clock(first_failure_at)}부터, 마지막 정상 {last_ok})\n"
        f"대상 {TARGET_URL} · 사유: {failure}\n"
        "앱이 꺼져 있는 동안 아침 브리핑·CUJ 점검·Slack 응답이 모두 멈춘다. "
        "`pnpm dev` 로 다시 띄우면 회복 알림이 온다."
    )
    return {**next_state, "alerted": True}, message


def load_state() -> dict:
    try:
        loaded = json.loads(STATE_PATH.read_text())
    except (OSError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(state))
    os.replace(temporary, STATE_PATH)


def self_check() -> None:
    t0 = 1_000_000.0
    state, message = step({}, None, t0)
    assert message is None and state == {"last_ok_at": t0}

    # 재시작 공백(첫 실패 후 10분 미만)은 조용하다.
    state, message = step(state, "refused", t0 + 300)
    assert message is None and state["consecutive_failures"] == 1
    state, message = step(state, "refused", t0 + 300 + 540)
    assert message is None, "9분째는 유예 안"

    # 10분째, 연속 2회 이상 → 한 번 울린다.
    state, message = step(state, "refused", t0 + 300 + 600)
    assert message and message.startswith("🔴") and "10분째" in message
    assert "refused" in message

    # 이미 울렸으면 계속 실패해도 조용하다.
    state, message = step(state, "refused", t0 + 300 + 3600)
    assert message is None

    # 회복 시 한 번 알리고 상태를 비운다.
    state, message = step(state, None, t0 + 300 + 3900)
    assert message and message.startswith("🟢") and "65분" in message
    assert state == {"last_ok_at": t0 + 300 + 3900}

    # 알림 전에 회복하면 회복 알림도 없다.
    state, _ = step(state, "timed out", t0 + 5000)
    state, message = step(state, None, t0 + 5300)
    assert message is None

    # 절전에서 깬 직후처럼 마지막 정상에서 오래 지났어도 실패 1회만으로는 울리지 않는다.
    state, message = step({"last_ok_at": t0}, "timed out", t0 + 8 * 3600)
    assert message is None, "연속 2회 미만"

    print("self-check ok")


def main() -> None:
    if "--self-check" in sys.argv:
        self_check()
        return
    state, message = step(load_state(), probe(TARGET_URL), datetime.now().timestamp())
    save_state(state)
    if message:
        print(message)


if __name__ == "__main__":
    main()
