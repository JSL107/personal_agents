#!/usr/bin/env python3
"""아침신문 '오늘의 도구'를 그림 카드로 그려 Slack DM 에 올리는 후속 job.

아침신문 응답의 도구 코너(`*1. 이름*` + `뭔가요`·`흐름`·`왜 볼 만한가`·`출처` 불릿)를 읽어, 도구마다
"넣는 것 → 도구가 하는 일 → 결과" 도식 카드를 HTML 로 짜고 헤드리스 Chrome 으로 PNG 를 찍는다.
원문 대표 이미지(og:image)는 발표자 사진·로고처럼 도구가 하는 일을 보여 주지 못하는 경우가 많아 쓰지 않는다.

그림을 아침신문 job 이 직접 첨부하지 못하는 이유: hermes cron 은 응답의 `MEDIA:<경로>` 를 첨부로 넘기지만,
Slack 앱 토큰 없이 도는 이 설치에서는 텍스트 전용 경로(tools/send_message_tool.py `_send_slack`)로 발송돼
첨부가 소리 없이 버려진다. 앱 토큰을 넣으면 이대리와 Socket Mode 연결을 나눠 써서 이대리가 망가진다.

hermes job `아침신문사진`(--no-agent, 08:05)이 `~/.hermes/scripts/morning-news-images.py` 복사본을 실행한다.
성공·할 일 없음이면 stdout 을 비워 조용히 끝나고(hermes no_agent 규약), 실패면 한 줄을 출력해 DM 으로 알린다.
같은 발송본은 한 번만 처리한다(STATE_PATH).

`python3 scripts/hermes-morning-news-images.py --self-check` 는 네트워크·Chrome 없이 응답 파싱과 카드 HTML 만 검사한다.
"""

from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
MORNING_NEWS_JOB_ID = "91a2c90c75b8"
OUTPUT_DIR = HERMES_HOME / "cron" / "output" / MORNING_NEWS_JOB_ID
CARD_DIR = HERMES_HOME / "image_cache" / "morning-news"
STATE_PATH = HERMES_HOME / "cron" / "morning-news-images.last"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
CHROME_TIMEOUT_SEC = 60
REQUEST_TIMEOUT_SEC = 30
KST = timezone(timedelta(hours=9))

# 도식 칸 이름. 흐름이 세 칸이 아니면(두 칸·네 칸) 가운데 강조만 하고 이름표는 붙이지 않는다.
STEP_LABELS = ("넣으면", "이 도구가", "결과")
# 글·사례 카드(응답에 '종류: 글' 불릿)는 흐름이 '다루는 문제 → 해법 → 얻는 것'이라 이름표도 그에 맞춘다.
ARTICLE_STEP_LABELS = ("문제", "해법", "얻는 것")
# 출처 배지. 모델이 쓴 링크 주소로 정한다 — 모델에게 출처 이름을 따로 쓰게 하면 한 군데가 더 틀릴 수 있다.
SOURCE_BADGES = (
    ("github.com", "GitHub", "#24292f"),
    ("yozm.wishket.com", "요즘IT", "#5b3df5"),
    ("news.ycombinator.com", "Hacker News", "#ff6600"),
)
DEFAULT_BADGE_COLOR = "#e8590c"

_FIELD_NAMES = {"뭔가요": "what", "왜 볼 만한가": "why", "흐름": "flow", "출처": "url", "종류": "kind"}
_TITLE_PATTERN = re.compile(r"^(\d+)\.\s*(.+)$")
_BULLET_PATTERN = re.compile(r"^[-•·]\s*(뭔가요|왜 볼 만한가|흐름|출처|종류)\s*:\s*(.+)$")


def parse_tools(briefing: str) -> list[dict]:
    """발송본 응답의 도구 코너에서 도구마다 {number, name, what, why, flow, url} 을 뽑는다.

    모델은 굵게 표시(`*`·`**`)를 섞어 쓰므로 별표를 지운 뒤 읽는다. 흐름이 2~4칸이 아니면 카드를 그릴 수 없어 뺀다.
    """
    _, marker, response = briefing.rpartition("## Response")
    _, corner, tools_part = response.partition("오늘의 도구")
    if not marker or not corner:
        return []
    tools: list[dict] = []
    for raw_line in tools_part.splitlines():
        line = raw_line.replace("*", "").strip()
        bullet = _BULLET_PATTERN.match(line)
        if bullet and tools:
            tools[-1][_FIELD_NAMES[bullet.group(1)]] = bullet.group(2).strip()
            continue
        title = _TITLE_PATTERN.match(line)
        if title:
            tools.append({"number": title.group(1), "name": title.group(2).strip()})
    for tool in tools:
        tool["flow"] = [step.strip() for step in tool.get("flow", "").split("→") if step.strip()]
    return [tool for tool in tools if 2 <= len(tool["flow"]) <= 4 and tool.get("what")]


def source_badge(url: str) -> tuple[str, str]:
    host = urllib.parse.urlparse(url).netloc.removeprefix("www.")
    for domain, label, color in SOURCE_BADGES:
        if host == domain:
            return label, color
    return (host or "웹"), DEFAULT_BADGE_COLOR


def card_html(tool: dict) -> str:
    """도구 하나의 1200×675 카드. 글은 모델이 쓴 것이라 전부 이스케이프한다."""
    escape = html.escape
    label, color = source_badge(tool.get("url", ""))
    flow = tool["flow"]
    middle = len(flow) // 2
    labels = ARTICLE_STEP_LABELS if tool.get("kind") == "글" else STEP_LABELS
    steps = []
    for index, step in enumerate(flow):
        caption = labels[index] if len(flow) == len(labels) else str(index + 1)
        css_class = "step tool" if index == middle else "step"
        steps.append(f'<div class="{css_class}"><span class="label">{escape(caption)}</span><span>{escape(step)}</span></div>')
    why = f'<div class="why"><b>왜 볼 만한가</b> · {escape(tool["why"])}</div>' if tool.get("why") else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
*{{box-sizing:border-box;margin:0}}
body{{width:1200px;height:675px;overflow:hidden;font-family:"Apple SD Gothic Neo",sans-serif;background:#f7f8fa;color:#16181d;
padding:52px 64px;display:flex;flex-direction:column;gap:26px}}
.top{{display:flex;gap:12px;align-items:center}}
.chip{{color:#fff;font-weight:800;font-size:22px;padding:8px 16px;border-radius:999px;background:#16181d}}
.chip.src{{background:{color}}}
h1{{font-size:54px;font-weight:800;letter-spacing:-1.5px;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}}
.what{{font-size:29px;color:#3b4049;line-height:1.4;font-weight:500}}
.flow{{display:flex;align-items:stretch;gap:12px;margin-top:6px}}
.step{{flex:1;background:#fff;border:2px solid #dde1e7;border-radius:20px;padding:22px 22px 26px;font-size:28px;font-weight:700;
display:flex;flex-direction:column;gap:12px;line-height:1.3;word-break:keep-all}}
.step.tool{{border-color:{color};box-shadow:0 0 0 5px {color}22}}
.label{{align-self:flex-start;font-size:19px;font-weight:800;color:#5c6370;background:#eef0f3;padding:5px 12px;border-radius:999px}}
.tool .label{{background:{color};color:#fff}}
.arrow{{align-self:center;font-size:40px;color:#9aa1ac;font-weight:800}}
.why{{margin-top:auto;font-size:24px;color:#3b4049;background:#fff;border-left:8px solid {color};padding:16px 22px;border-radius:12px;line-height:1.4}}
.why b{{color:{color}}}
</style></head><body>
<div class="top"><span class="chip">🛠 오늘의 도구 {escape(tool["number"])}</span><span class="chip src">{escape(label)}</span></div>
<h1>{escape(tool["name"])}</h1>
<div class="what">{escape(tool["what"])}</div>
<div class="flow">{'<div class="arrow">→</div>'.join(steps)}</div>
{why}
</body></html>"""


def render_card(page: str, out: Path) -> None:
    # --blink-settings=scriptEnabled=false 를 주면 새 헤드리스 모드가 스크린샷을 남기지 않고 0 으로 끝난다(2026-10-21 실측).
    # 카드 글은 이스케이프돼 스크립트가 들어갈 수 없으므로 그 옵션 없이 찍는다.
    with tempfile.TemporaryDirectory() as workdir:
        source = Path(workdir) / "card.html"
        source.write_text(page, encoding="utf-8")
        subprocess.run(
            [str(CHROME), "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={workdir}/profile",
             "--window-size=1200,675", f"--screenshot={out}", source.as_uri()],
            check=True, capture_output=True, timeout=CHROME_TIMEOUT_SEC,
        )
    if not out.is_file():
        raise RuntimeError(f"Chrome 이 카드를 만들지 않음: {out.name}")


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
        {"files": json.dumps(files, ensure_ascii=False), "channel_id": channel, "initial_comment": "🛠 오늘의 도구 한눈에 보기"},
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

    tools = parse_tools(latest.read_text(encoding="utf-8", errors="replace"))
    if tools:
        try:
            CARD_DIR.mkdir(parents=True, exist_ok=True)
            for old in CARD_DIR.glob("*.png"):
                old.unlink()
            images: list[tuple[str, Path]] = []
            for tool in tools:
                out = CARD_DIR / f"tool-{tool['number']}.png"
                render_card(card_html(tool), out)
                images.append((f"{tool['number']}. {tool['name']}", out))
            token = read_env_value("SLACK_BOT_TOKEN")
            if not token:
                raise RuntimeError("SLACK_BOT_TOKEN 없음")
            upload_images(token, delivery_channel(), images)
        except Exception as error:  # noqa: BLE001 — 무엇으로 실패하든 DM 한 줄로 알리고 끝낸다
            print(f"아침신문 도구 카드 실패: {type(error).__name__}: {error}")
            return 0
    STATE_PATH.write_text(latest.name, encoding="utf-8")
    return 0


def self_check() -> None:
    briefing = (
        "## Prompt\n🛠 오늘의 도구 후보\n*9. 프롬프트 속 가짜*\n- 흐름: a → b → c\n- 뭔가요: x\n"
        "## Response\n📈 경제\n- **코스피 1. 상승** — 요약\n\n🛠 오늘의 도구\n\n"
        "*1. DeepInfer*\n- **뭔가요:** 추론 엔진이에요.\n- 왜 볼 만한가: 속도.\n"
        "- 흐름: 모델 가중치 → DeepInfer로 서빙 → 빠른 응답\n· ↔ 내 스킬: 테스트\n- 출처: https://github.com/deepseek-ai/DeepInfer\n\n"
        "**2. 흐름 없는 도구**\n- 뭔가요: 그림 없음\n- 출처: https://yozm.wishket.com/magazine/detail/1\n\n"
        "*3. <script>alert(1)</script>*\n- 뭔가요: a & b\n- 흐름: 넣고 → 뺀다\n- 출처: https://tessl.io/blog/x\n\n"
        "2026년 10월 21일 · 뉴스 9건\n"
    )
    tools = parse_tools(briefing)
    assert [tool["number"] for tool in tools] == ["1", "3"], tools
    assert tools[0] == {
        "number": "1", "name": "DeepInfer", "what": "추론 엔진이에요.", "why": "속도.",
        "flow": ["모델 가중치", "DeepInfer로 서빙", "빠른 응답"], "url": "https://github.com/deepseek-ai/DeepInfer",
    }, tools[0]
    assert parse_tools("## Response\n뉴스만 있음") == []

    assert source_badge("https://github.com/o/r") == ("GitHub", "#24292f")
    assert source_badge("https://www.tessl.io/blog/x") == ("tessl.io", DEFAULT_BADGE_COLOR)

    page = card_html(tools[0])
    assert "넣으면" in page and "이 도구가" in page and "GitHub" in page
    unsafe = card_html(tools[1])
    assert "<script>" not in unsafe and "&lt;script&gt;" in unsafe and "a &amp; b" in unsafe
    assert "넣으면" not in unsafe  # 두 칸 흐름은 번호만 붙인다
    article = parse_tools("## Response\n🛠 오늘의 도구\n*1. 회귀 줄이기*\n- 뭔가요: 글\n- 종류: 글\n"
                          "- 흐름: 배포 후 회귀 → 스모크 테스트 → 배포 전 차단\n- 출처: https://yozm.wishket.com/x\n")
    assert article[0]["kind"] == "글", article
    article_page = card_html(article[0])
    assert "문제" in article_page and "해법" in article_page and "넣으면" not in article_page
    print("self-check ok")


if __name__ == "__main__":
    if "--self-check" in sys.argv[1:]:
        self_check()
        sys.exit(0)
    sys.exit(main())
