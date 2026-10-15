#!/usr/bin/env python3
"""Hermes 모델 점검 — 기본 모델이 ChatGPT 계정 허용 목록에서 빠지면 아침신문이 돌기 전에 바꿔 둔다.

OpenAI 는 ChatGPT 구독 계정으로 쓸 수 있는 Codex 모델 목록을 예고 없이 바꾼다. 목록에서 빠진 모델을 부르면
`400 - The '<model>' model is not supported when using Codex with a ChatGPT account` 로 job 이 통째로 죽는다
(2026-09-09 `gpt-5.4-mini`, 2026-10-15 `gpt-5.5` — 두 번 모두 우리 쪽 변경 없이 아침신문이 실패했다).

이 스크립트는 hermes cron 이 매시 `--no-agent` 로 돌린다. stdout 이 비면 hermes 는 아무것도 보내지 않고,
비어 있지 않으면 그대로 Slack 에 전달한다(`scripts/hermes-idaeri-down-watch.py` 와 같은 계약).

판정 순서:
1. 허용 목록은 codex CLI 가 같은 계정·같은 서버에서 받아 둔 `~/.codex/models_cache.json` 을 쓴다.
   Hermes 도 `chatgpt.com/backend-api/codex` 를 같은 ChatGPT 계정으로 부른다. 목록은 codex CLI 가 돌 때만
   갱신되므로, MAX_CACHE_AGE_SECONDS 보다 오래됐으면 아무것도 바꾸지 않고 알리기만 한다 — 낡은 목록을 믿고
   멀쩡한 설정을 고치는 쪽이 더 나쁘다.
2. `~/.hermes/config.yaml` 의 `model.default` 가 목록에 있으면 끝(조용함).
3. 없으면 `~/.codex/config.toml` 의 `model` 로 바꾼다. 이대리가 매일 실제로 쓰는 모델이라 동작이 검증돼 있다.
   목록의 우선순위 1등을 고르지 않는 이유: 무거운 모델이 걸리면 아침신문이 900초 넘게 무응답으로 끊긴
   전례가 있다(2026-07-10). 그 모델도 목록에 없으면 바꾸지 않고 알리기만 한다.
4. job 별로 `model` 을 박아 둔 경우(`~/.hermes/cron/jobs.json`)는 알리기만 한다. jobs.json 은 gateway 가
   실행 중에 다시 쓰는 파일이라 이 스크립트가 손대지 않는다.

Hermes 는 job 을 실행할 때마다 config.yaml 을 다시 읽으므로(파일 mtime 캐시) 바꾼 값은 다음 실행부터 적용된다.
하루 한 번이 아니라 매시 돌리는 이유: 목록 변화를 07:00 에 알게 되면 08:00 아침신문 전에 고쳐 둘 수 있다.
한계: 이 스크립트는 codex CLI 가 받아 둔 목록을 볼 뿐이라, 목록이 바뀐 뒤 codex CLI 가 아직 한 번도 돌지
않았으면 알아채지 못한다. 그날은 job 이 400 으로 실패하고, 이대리 hermes-watchdog 의 고장 알림이 대신 잡는다.

같은 경고는 ALERT_REPEAT_SECONDS(하루)에 한 번만 다시 보낸다. 교체 알림은 한 번 일어나는 사건이라 바로 보낸다.

이 레포가 정본이고 `~/.hermes/scripts/model-guard.py` 에 복사본을 둔다(심볼릭 링크 불가 — 이유는
`scripts/hermes-morning-news.py` 머리말). 고치면 복사본도 갱신한다:
`cp scripts/hermes-model-guard.py ~/.hermes/scripts/model-guard.py`

`python3 scripts/hermes-model-guard.py --self-check` 는 파일을 건드리지 않고 판정 로직만 검사한다.
"""

from __future__ import annotations

import json
import os
import pwd
import re
import shutil
import sys
import tomllib
from datetime import datetime
from pathlib import Path

# hermes 는 스크립트 자식 프로세스에 HERMES_HOME 을 주입하고, 프로필 홈이 있으면 HOME 을 바꾼다
# (cron/scheduler.py). codex 경로는 그 영향을 받지 않게 실제 사용자 홈에서 잡는다.
HERMES_HOME = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
CODEX_HOME = Path(
    os.environ.get("CODEX_HOME") or (Path(pwd.getpwuid(os.getuid()).pw_dir) / ".codex")
)
HERMES_CONFIG_PATH = HERMES_HOME / "config.yaml"
HERMES_JOBS_PATH = HERMES_HOME / "cron" / "jobs.json"
CODEX_CACHE_PATH = CODEX_HOME / "models_cache.json"
CODEX_CONFIG_PATH = CODEX_HOME / "config.toml"
STATE_PATH = HERMES_HOME / "cache" / "model-guard.json"

MAX_CACHE_AGE_SECONDS = 3 * 24 * 60 * 60
ALERT_REPEAT_SECONDS = 24 * 60 * 60

_DEFAULT_LINE = re.compile(r"^(?P<prefix>[ \t]+default:[ \t]*)(?P<quote>['\"]?)(?P<value>[^\s'\"#]+)(?P=quote)")


def find_default_line(config_text: str) -> tuple[int, re.Match[str]] | None:
    """최상위 `model:` 블록 안의 `default:` 줄 번호와 매치. 없으면 None."""
    lines = config_text.splitlines()
    try:
        start = next(index for index, line in enumerate(lines) if line.rstrip() == "model:")
    except StopIteration:
        return None
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if line.strip() and not line[0].isspace():
            return None
        found = _DEFAULT_LINE.match(line)
        if found:
            return index, found
    return None


def replace_default(config_text: str, model: str) -> str:
    located = find_default_line(config_text)
    if located is None:
        raise ValueError("config.yaml 에서 model.default 를 찾지 못함")
    index, found = located
    lines = config_text.splitlines(keepends=True)
    line = lines[index]
    lines[index] = f"{found['prefix']}{found['quote']}{model}{found['quote']}{line[found.end():]}"
    return "".join(lines)


def decide(
    current: str,
    allowed: set[str],
    fallback: str | None,
    cache_age_seconds: float,
    pinned_jobs: dict[str, str],
) -> tuple[str | None, str | None, list[str]]:
    """(바꿀 모델, 교체 알림, 경고 목록). 경고는 상태가 이어지는 동안 하루 한 번 다시 보낸다."""
    if cache_age_seconds > MAX_CACHE_AGE_SECONDS:
        days = int(cache_age_seconds // 86400)
        return None, None, [
            f"⚠️ Hermes 모델 점검 보류 — codex 모델 목록(`{CODEX_CACHE_PATH}`)이 {days}일째 갱신되지 않아 "
            "허용 여부를 판정하지 않았습니다. codex CLI 를 한 번 실행하면 목록이 갱신됩니다."
        ]

    warnings = [
        f"⚠️ Hermes job `{name}` 이 허용 목록에 없는 모델 `{model}` 로 고정돼 있습니다. "
        f"다음 실행에서 400 으로 실패합니다. `{HERMES_JOBS_PATH}` 의 `model` 을 비우거나 바꾸세요. "
        f"허용: {', '.join(sorted(allowed))}"
        for name, model in sorted(pinned_jobs.items())
        if model not in allowed
    ]
    if current in allowed:
        return None, None, warnings
    if fallback and fallback in allowed:
        notice = (
            f"🔧 Hermes 기본 모델 교체 — `{current}` 가 ChatGPT 계정 허용 목록에서 빠져 "
            f"`{fallback}`(codex CLI 설정과 같은 모델)로 바꿨습니다. 다음 job 실행부터 적용됩니다."
        )
        return fallback, notice, warnings
    warnings.append(
        f"⚠️ Hermes 기본 모델 `{current}` 가 ChatGPT 계정 허용 목록에 없는데, 대체할 codex 설정 모델 "
        f"`{fallback}` 도 목록에 없어 바꾸지 않았습니다. `{HERMES_CONFIG_PATH}` 의 `model.default` 를 "
        f"직접 고쳐야 합니다. 허용: {', '.join(sorted(allowed))}"
    )
    return None, None, warnings


def due_warnings(state: dict, warnings: list[str], now: float) -> tuple[dict, list[str]]:
    """이번에 보낼 경고와 새 상태. 사라진 경고는 상태에서 지워, 재발하면 바로 다시 알린다."""
    previous = state.get("alerted", {})
    alerted = {}
    due = []
    for warning in warnings:
        last = previous.get(warning)
        if isinstance(last, (int, float)) and now - last < ALERT_REPEAT_SECONDS:
            alerted[warning] = last
        else:
            alerted[warning] = now
            due.append(warning)
    return {"alerted": alerted}, due


def load_allowed() -> tuple[set[str], float]:
    cache = json.loads(CODEX_CACHE_PATH.read_text())
    allowed = {model["slug"] for model in cache["models"] if model.get("slug")}
    if not allowed:
        raise ValueError("codex 모델 목록이 비어 있음")
    fetched_at = datetime.fromisoformat(cache["fetched_at"]).timestamp()
    return allowed, fetched_at


def load_codex_model() -> str | None:
    model = tomllib.loads(CODEX_CONFIG_PATH.read_text()).get("model")
    return model if isinstance(model, str) else None


def load_pinned_jobs() -> dict[str, str]:
    data = json.loads(HERMES_JOBS_PATH.read_text())
    jobs = data["jobs"] if isinstance(data, dict) else data
    return {
        job.get("name") or job.get("id"): job["model"]
        for job in jobs
        if isinstance(job.get("model"), str) and job["model"]
    }


def load_state() -> dict:
    try:
        loaded = json.loads(STATE_PATH.read_text())
    except (OSError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) and isinstance(loaded.get("alerted"), dict) else {}


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text)
    os.replace(temporary, path)


def switch_model(config_text: str, model: str, now: datetime) -> Path:
    backup = HERMES_CONFIG_PATH.with_name(
        f"config.yaml.bak.{now.strftime('%Y%m%d_%H%M%S')}_model_guard"
    )
    shutil.copy2(HERMES_CONFIG_PATH, backup)
    write_atomic(HERMES_CONFIG_PATH, replace_default(config_text, model))
    return backup


def run(now: datetime) -> list[str]:
    try:
        config_text = HERMES_CONFIG_PATH.read_text()
        located = find_default_line(config_text)
        if located is None:
            raise ValueError("config.yaml 에서 model.default 를 찾지 못함")
        current = located[1]["value"]
        allowed, fetched_at = load_allowed()
        target, notice, warnings = decide(
            current,
            allowed,
            load_codex_model(),
            now.timestamp() - fetched_at,
            load_pinned_jobs(),
        )
    except (OSError, ValueError, KeyError, TypeError, tomllib.TOMLDecodeError) as error:
        # 예외로 죽으면 hermes 가 매시 "script failed" 를 보낸다. 같은 문제는 하루 한 번만 알린다.
        target, notice = None, None
        warnings = [f"⚠️ Hermes 모델 점검 실패 — {type(error).__name__}: {error}"]

    messages = []
    if target:
        backup = switch_model(config_text, target, now)
        messages.append(f"{notice}\n백업: `{backup}`")
    state, due = due_warnings(load_state(), warnings, now.timestamp())
    write_atomic(STATE_PATH, json.dumps(state, ensure_ascii=False))
    return messages + due


def self_check() -> None:
    config = (
        "model:\n"
        "  default: gpt-5.5  # 주석\n"
        "  provider: openai-codex\n"
        "agent:\n"
        "  default: keep-me\n"
    )
    located = find_default_line(config)
    assert located and located[1]["value"] == "gpt-5.5"
    replaced = replace_default(config, "gpt-6-sol")
    assert "  default: gpt-6-sol  # 주석\n" in replaced
    assert "  default: keep-me\n" in replaced, "다른 블록의 default 는 그대로"
    assert replace_default("model:\n  default: 'a'\n", "b") == "model:\n  default: 'b'\n"
    assert find_default_line("agent:\n  default: x\nmodel:\n  provider: p\n") is None
    assert find_default_line("model:\n  provider: p\nother:\n  default: x\n") is None

    allowed = {"gpt-6-sol", "gpt-5.6-luna"}
    day = 86400

    target, notice, warnings = decide("gpt-6-sol", allowed, "gpt-6-sol", day, {})
    assert (target, notice, warnings) == (None, None, []), "정상이면 조용함"

    target, notice, warnings = decide("gpt-5.5", allowed, "gpt-6-sol", day, {})
    assert target == "gpt-6-sol" and "`gpt-5.5`" in notice and warnings == []

    target, notice, warnings = decide("gpt-5.5", allowed, "gpt-5.4", day, {})
    assert target is None and notice is None and "직접 고쳐야" in warnings[0]
    target, _, warnings = decide("gpt-5.5", allowed, None, day, {})
    assert target is None and len(warnings) == 1

    target, _, warnings = decide("gpt-5.5", allowed, "gpt-6-sol", 4 * day, {})
    assert target is None and "4일째" in warnings[0], "낡은 목록으로는 바꾸지 않음"

    target, _, warnings = decide(
        "gpt-6-sol", allowed, "gpt-6-sol", day, {"아침신문": "gpt-5.4-mini", "감시": "gpt-5.6-luna"}
    )
    assert target is None and len(warnings) == 1 and "`아침신문`" in warnings[0]

    t0 = 1_000_000.0
    state, due = due_warnings({}, ["a"], t0)
    assert due == ["a"]
    state, due = due_warnings(state, ["a"], t0 + 3600)
    assert due == [], "하루 안에는 다시 안 보냄"
    state, due = due_warnings(state, ["a", "b"], t0 + day)
    assert due == ["a", "b"]
    state, due = due_warnings(state, [], t0 + day + 60)
    assert due == [] and state == {"alerted": {}}
    state, due = due_warnings(state, ["a"], t0 + day + 120)
    assert due == ["a"], "사라졌다 재발하면 바로 알림"

    print("self-check ok")


def main() -> None:
    if "--self-check" in sys.argv:
        self_check()
        return
    messages = run(datetime.now().astimezone())
    if messages:
        print("\n\n".join(messages))


if __name__ == "__main__":
    main()
