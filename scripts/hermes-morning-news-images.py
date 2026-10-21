#!/usr/bin/env python3
"""아침신문 '오늘의 도구' 사진을 Slack DM 에 올리는 후속 job.

아침신문 응답에는 고른 도구마다 `MEDIA:<경로>` 줄이 있다(수집기 hermes-morning-news.py 가 받아 둔 og:image).
hermes cron 은 그 줄을 본문에서 지우지만, Slack 앱 토큰 없이 도는 이 설치에서는 텍스트 전용 경로
(tools/send_message_tool.py `_send_slack` = chat.postMessage)로 발송돼 첨부가 소리 없이 버려진다.
앱 토큰을 넣으면 이대리와 Socket Mode 연결을 나눠 써서 이대리가 망가지므로, 사진은 이 스크립트가 따로 올린다.

hermes job `아침신문사진`(--no-agent, 08:05)이 `~/.hermes/scripts/morning-news-images.py` 복사본을 실행한다.
성공·할 일 없음이면 stdout 을 비워 조용히 끝나고(hermes no_agent 규약), 실패면 한 줄을 출력해 DM 으로 알린다.
같은 발송본은 한 번만 올린다(STATE_PATH).

`python3 scripts/hermes-morning-news-images.py --self-check` 는 네트워크 없이 응답 파싱만 검사한다.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
MORNING_NEWS_JOB_ID = "91a2c90c75b8"
OUTPUT_DIR = HERMES_HOME / "cron" / "output" / MORNING_NEWS_JOB_ID
# 수집기가 그림을 받아 두는 곳. 이 밖의 경로는 모델이 무엇을 쓰든 올리지 않는다.
IMAGE_DIR = HERMES_HOME / "image_cache" / "morning-news"
STATE_PATH = HERMES_HOME / "cron" / "morning-news-images.last"
REQUEST_TIMEOUT_SEC = 30
KST = timezone(timedelta(hours=9))

_TITLE_PATTERN = re.compile(r"^\*{1,2}(\d+\.\s*.+?)\*{1,2}\s*$")
_MEDIA_PATTERN = re.compile(r"^MEDIA:\s*(\S+)\s*$")


def chosen_images(briefing: str) -> list[tuple[str, str]]:
    """발송본의 응답 부분에서 (도구 제목, 그림 경로) 를 순서대로 뽑는다. 제목은 바로 위의 '*1. 이름*' 줄이다."""
    _, marker, response = briefing.rpartition("## Response")
    if not marker:
        return []
    pairs: list[tuple[str, str]] = []
    title = "오늘의 도구"
    for line in response.splitlines():
        stripped = line.strip()
        title_match = _TITLE_PATTERN.match(stripped)
        if title_match:
            title = title_match.group(1)
            continue
        media_match = _MEDIA_PATTERN.match(stripped)
        if media_match:
            pairs.append((title, media_match.group(1)))
    return pairs


def is_inside_image_dir(path: Path) -> bool:
    try:
        return path.resolve(strict=True).is_relative_to(IMAGE_DIR.resolve()) and path.is_file()
    except OSError:
        return False


def read_env_value(name: str) -> str:
    from_env = os.environ.get(name, "").strip()
    if from_env:
        return from_env
    env_path = HERMES_HOME / ".env"
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.strip().partition("=")
        if separator and key.strip() == name:
            return value.strip().strip("'\"")
    return ""


def delivery_channel() -> str:
    """아침신문 job 의 발송 대상(`slack:<채널>`)을 그대로 따른다 — 채널 ID 를 두 곳에 적지 않으려고."""
    jobs = json.loads((HERMES_HOME / "cron" / "jobs.json").read_text(encoding="utf-8"))
    job = next(job for job in jobs["jobs"] if job.get("id") == MORNING_NEWS_JOB_ID)
    platform, _, channel = str(job.get("deliver", "")).partition(":")
    if platform != "slack" or not channel:
        raise ValueError(f"morning news is not delivered to slack: {job.get('deliver')!r}")
    return channel


def slack_call(token: str, method: str, fields: dict) -> dict:
    request = urllib.request.Request(
        f"https://slack.com/api/{method}",
        data=urllib.parse.urlencode(fields).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as response:
        body = json.loads(response.read().decode("utf-8"))
    if not body.get("ok"):
        raise RuntimeError(f"{method}: {body.get('error')}")
    return body


def upload_images(token: str, channel: str, images: list[tuple[str, Path]]) -> None:
    """Slack 의 외부 업로드 3단계(주소 받기 → 바이트 올리기 → 채널에 공유)로 그림들을 한 메시지에 묶어 올린다."""
    files: list[dict] = []
    for title, path in images:
        raw = path.read_bytes()
        ticket = slack_call(token, "files.getUploadURLExternal", {"filename": path.name, "length": len(raw)})
        request = urllib.request.Request(ticket["upload_url"], data=raw, method="POST")
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC):
            pass
        files.append({"id": ticket["file_id"], "title": title})
    slack_call(
        token,
        "files.completeUploadExternal",
        {"files": json.dumps(files, ensure_ascii=False), "channel_id": channel, "initial_comment": "🛠 오늘의 도구 사진"},
    )


def main() -> int:
    today = datetime.now(KST).strftime("%Y-%m-%d")
    briefings = sorted(OUTPUT_DIR.glob(f"{today}_*.md"))
    if not briefings:
        # 아침신문이 실패했으면 그 job 이 이미 알린다. 여기서 또 알릴 일은 없다.
        return 0
    latest = briefings[-1]
    if STATE_PATH.exists() and STATE_PATH.read_text(encoding="utf-8").strip() == latest.name:
        return 0

    images: list[tuple[str, Path]] = []
    for title, raw_path in chosen_images(latest.read_text(encoding="utf-8", errors="replace")):
        path = Path(raw_path)
        if is_inside_image_dir(path):
            images.append((title, path))
        else:
            print(f"skip image outside {IMAGE_DIR}: {raw_path}", file=sys.stderr)

    if images:
        token = read_env_value("SLACK_BOT_TOKEN")
        if not token:
            print("아침신문 사진 업로드 실패: SLACK_BOT_TOKEN 없음")
            return 0
        try:
            upload_images(token, delivery_channel(), images)
        except Exception as error:  # noqa: BLE001 — 무엇으로 실패하든 DM 한 줄로 알리고 끝낸다
            print(f"아침신문 사진 업로드 실패: {type(error).__name__}: {error}")
            return 0
    STATE_PATH.write_text(latest.name, encoding="utf-8")
    return 0


def self_check() -> None:
    briefing = (
        "## Prompt\nMEDIA:/not/chosen.png\n## Response\n🛠 오늘의 도구\n\n"
        "*1. DeepInfer*\n- 뭔가요: 추론 프레임워크\nMEDIA:/x/github-com-deepseek-ai-DeepInfer.png\n\n"
        "**2. 글로만 소개**\n- 뭔가요: 그림 없음\n\n"
        "*3. Knowledge Layer*\n  MEDIA: /x/yozm-3998.png \n"
    )
    assert chosen_images(briefing) == [
        ("1. DeepInfer", "/x/github-com-deepseek-ai-DeepInfer.png"),
        ("3. Knowledge Layer", "/x/yozm-3998.png"),
    ], chosen_images(briefing)
    assert chosen_images("응답 표식 없음 MEDIA:/a.png") == []
    assert not is_inside_image_dir(Path("/etc/hosts"))
    print("self-check ok")


if __name__ == "__main__":
    if "--self-check" in sys.argv[1:]:
        self_check()
        sys.exit(0)
    sys.exit(main())
