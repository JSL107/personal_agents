#!/usr/bin/env python3
"""아침신문 cron 용 기사 수집기.

hermes 의 web_search 도구는 Tavily 를 topic 지정 없이 부른다(plugins/web/tavily/provider.py).
그래서 일반 웹 문서가 뉴스 자리를 차지하고(블로그·기관 홈페이지), 발행일 필터가 없어
몇 달 지난 기사가 상위에 올라온다. 이 스크립트는 Tavily 를 news 토픽 + 기간 제한으로
직접 호출해 그 두 문제를 API 차원에서 끊는다.

AI 영역은 AIHOT(aihot.news)의 편집 선별 목록을 후보로 함께 싣는다. Tavily 검색어는 표현 하나로
결과가 출렁이고 보도자료 배포처가 섞이는데(2026-10-06 실측: einnews.com/pr_news), AIHOT 은 지난 24시간
소식을 사람이 고른 목록이라 그 문제가 없다. 근거·판단 기준은
docs/superpowers/plans/2026-10-06-morning-news-aihot.md.

출력(stdout)은 hermes cron 의 --script 경로로 job 프롬프트에 그대로 주입된다.
따라서 stdout 에는 기사 목록만, 진단 메시지는 stderr 로 보낸다. 단 hermes 는 성공한 실행의 stderr 를
버리므로(cron/scheduler.py `_run_job_script`) 나중에 다시 볼 기록은 후보 원장(LEDGER_PATH)에 남긴다.

이 레포가 정본이고 `~/.hermes/scripts/morning-news.py` 에 복사본을 둔다. hermes cron job
`아침신문`(91a2c90c75b8) 이 매일 08:00 에 `--script` 로 그 복사본을 호출한다.

심볼릭 링크로 묶을 수는 없다. `_run_job_script` 가 경로를 resolve 한 뒤 scripts 디렉터리 안인지
검사해 symlink escape 를 차단한다(`cron/scheduler.py:882-896`). 링크를 걸면 실행 시점에
`Blocked: script path resolves outside the scripts directory` 로 job 이 죽는다.
따라서 이 파일을 고치면 복사본도 함께 갱신해야 한다:
`cp scripts/hermes-morning-news.py ~/.hermes/scripts/morning-news.py`

hermes 본체(`~/.hermes/hermes-agent`)는 업스트림 클론이라 개인 스크립트를 두지 않는다.

뉴스 세 영역 뒤에 "오늘의 도구" 후보(AIHOT 제품·팁, GitHub 신규 저장소, Show HN, 요즘IT)를 따로 싣는다.
모델이 그중 최대 3건을 골라 무엇인지·어떻게 써 보는지까지 풀어 쓴다. 지난 발송본에 나온 URL 은 후보에서 뺀다.
GitHub 후보는 토픽 검색(claude-code·agent-skills·claude-skills·mcp)을 앞세우고 스타순 일반 검색으로 보충한다.
크랙·미끼로 보이는 저장소 이름은 거른다. 후보에는 README 앞부분(설치·사용 절 먼저)을 붙여 "써 보려면"을 쓸 근거를 준다.
도구 후보 뒤에는 내 스킬 목록(이름·한 줄 설명)을 실어, 모델이 후보와 대응되는 내 스킬을 알려 주게 한다.
job 프롬프트 사본은 `scripts/hermes-morning-news.prompt.md`(실행 정본은 `~/.hermes/cron/jobs.json`).
고른 도구를 설명하는 그림 카드는 후속 job(hermes-morning-news-images.py)이 그려 Slack 에 올린다.

`python3 scripts/hermes-morning-news.py --self-check` 는 네트워크 없이 변환·필터 로직만 검사한다.
"""

from __future__ import annotations

import functools
import html
import json
import os
import pwd
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Callable
from xml.etree import ElementTree

TAVILY_ENDPOINT = "https://api.tavily.com/search"
# hermes 는 스크립트 자식 프로세스에 HERMES_HOME 을 항상 주입한다(cron/scheduler.py).
# HOME 은 프로필 기능(~/.hermes/home)이 켜지면 바뀌므로 기준으로 삼지 않는다.
HERMES_HOME = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
ENV_PATH = HERMES_HOME / ".env"

# 후보 원장. 실행마다 후보 전부와 남김/제외 사유를 한 줄씩 붙인다.
# AIHOT 을 계속 쓸지(2026-10-13 판단)를 발송된 브리핑 URL 과 대조해 세는 데 쓴다.
LEDGER_PATH = HERMES_HOME / "logs" / "morning-news-candidates.jsonl"

# 인젝션 스캐너를 hermes 본체에서 그대로 빌려 온다. 패턴을 이 파일에 복사하면 두 벌이 되어
# 한쪽만 바뀌는 날 사전 선별이 실제 차단과 어긋난다.
HERMES_AGENT_DIR = HERMES_HOME / "hermes-agent"

# 최근 며칠치를 후보로 볼지. 매일 도는 브리핑이라 2~3일이면 충분하고,
# 주말·공휴일에 기사가 마르는 경우를 감안해 3 으로 둔다.
RECENCY_DAYS = 3

# 쿼리 하나가 가져올 후보 건수. 영역마다 쿼리를 2개 쓰므로 영역당 6건이 된다.
# 최종 3건을 고르는데 후보가 3건뿐이면 고를 여지가 없어 검색 순위에 그대로 종속된다.
CANDIDATES_PER_QUERY = 3

# 요약 스니펫 상한. 18건 × 이 길이가 프롬프트에 실리므로 컨텍스트 예산과 직결된다.
SNIPPET_LIMIT = 180

REQUEST_TIMEOUT_SEC = 30

# AIHOT 의 프로그램용 JSON API. 에이전트용 Markdown 엔드포인트(/api/v1/agent/*)는 경계 표식·라벨을
# 파싱해야 하고 연도 없는 베이징 시각을 주므로 쓰지 않는다 — AIHOT 가이드도 정기 실행 프로그램에는
# 이 JSON 을 쓰라고 한다. User-Agent 도 가이드가 지정한 값이다.
AIHOT_ENDPOINT = "https://aihot.news/api/v1/items?mode=selected&window=24h&limit=20"
AIHOT_USER_AGENT = "aihot-api/2.0.0"
# hermes 의 스크립트 전체 상한은 120초다(cron/scheduler.py `_DEFAULT_SCRIPT_TIMEOUT`).
# Tavily 5회 × 30초와 합쳐도 넘지 않게 짧게 둔다.
AIHOT_TIMEOUT_SEC = 15
# 정상 응답은 20건에 수십 KB 다. 이보다 크면 뭔가 잘못된 응답이라 읽기를 끊는다.
AIHOT_MAX_BYTES = 1_000_000
# AI 영역에 싣는 AIHOT 후보 상한. 넘치면 Tavily 후보가 사실상 묻혀 영어권 검색 시각이 사라진다.
AIHOT_MAX_CANDIDATES = 5

# ── 오늘의 도구 코너 ──
# hermes 는 스크립트를 120초에 끊고, 그러면 그날 브리핑이 통째로 사라진다(cron/scheduler.py `_DEFAULT_SCRIPT_TIMEOUT`).
# 도구 코너는 뉴스 수집 뒤에 돌므로, 시작부터 이 시간 안에 끝낼 수 없는 소스는 건너뛰어 뉴스만이라도 나가게 한다.
_STARTED_AT = time.monotonic()
TOOL_DEADLINE_SEC = 100
# 스크립트 전체 상한(120초) 안에 Tavily·AIHOT 과 함께 들어가도록 소스당 짧게 둔다.
TOOL_TIMEOUT_SEC = 10
# 요즘IT RSS 는 본문 전체를 실어 약 0.9MB 다(2026-10-21 실측).
TOOL_MAX_BYTES = 2_000_000
TOOL_CANDIDATES_PER_SOURCE = 3
# 도구 소개는 "어떻게 써 보나"까지 쓰므로 뉴스보다 길게 싣는다. 4소스 × 3건 × 이 길이가 컨텍스트에 더해진다.
TOOL_SNIPPET_LIMIT = 300
AIHOT_TOOL_CATEGORIES = {"ai-products", "tip"}
GITHUB_ENDPOINT = "https://api.github.com/search/repositories"
GITHUB_NEW_REPO_DAYS = 7
GITHUB_MIN_STARS = 200
# GitHub 후보 설명은 저장소 한 줄 소개뿐이라 모델이 흐름·"써 보려면"을 채울 사실이 없다(10-22~28 카드 21장 중
# "링크에서 확인" 15장). 채택된 후보에만 README 앞부분을 붙인다. 3건 × 이 길이가 입력에 더해지는데,
# 아침신문 입력은 약 16.5K 토큰이고 codex TTFB 감시가 꺼지는 25K(agent/chat_completion_helpers.py) 아래여야 한다.
README_EXCERPT_LIMIT = 1_200
# 설치·사용 절을 README 앞쪽으로 당겨 싣는다. 중국어 README 도 GitHub 상위에 자주 오른다(2026-10-28 후보 3건 중 2건).
_README_USAGE_HEADING = re.compile(
    r"install|getting started|quick ?start|usage|how to use|setup|설치|사용법|시작하기|安装|使用|运行|快速开始", re.IGNORECASE
)
_README_HEADING = re.compile(r"^#{1,6}\s", re.MULTILINE)
_README_NOISE = re.compile(r"!\[[^\]]*\]\([^)]*\)|<[^>]+>|```\w*")
_README_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
# 토픽 검색은 개발자 도구에 직접 맞는 저장소를 먼저 얻는다(일반 스타순 검색은 광고 차단·단어 앱이 상위를 차지했다 — 2026-10-30).
# 검색 1회는 토픽 1개다. `topic:a topic:b` 는 AND 라 OR 가 안 된다. 신규 저장소라 스타 문턱은 낮게 둔다.
GITHUB_TOPICS = ["claude-code", "agent-skills", "claude-skills", "mcp"]
GITHUB_TOPIC_MIN_STARS = 20
# 크랙·미끼 저장소 이름 거르기. 오탐을 줄이려고 저장소 이름(소유자 제외)을 토큰으로 쪼개 두 경우만 잡는다:
# 단독으로 의심스러운 낱말, 또는 유명 상용 앱 이름 + 무료·크랙 유인어 조합(`Canva-Pro`, `Windows-Optimizer`).
# `Pro`·`Optimizer` 단독은 정상 저장소에도 흔해 통과시킨다.
BAIT_NAME_TOKENS = {"cracked", "keygen", "warez", "nulled"}
BAIT_BRAND_TOKENS = {"canva", "photoshop", "office", "windows", "autocad", "adobe", "netflix", "spotify", "idm", "capcut"}
# `crack`·`activator`·`unlocked` 는 `crack-the-interview-kit` 처럼 정상 이름에도 나와 상용 앱 이름과 함께일 때만 잡는다.
BAIT_LURE_TOKENS = {"pro", "premium", "free", "full", "download", "optimizer", "activate", "activator", "license", "lifetime",
                    "crack", "unlocked"}

# 내 스킬 목록. 도구 후보가 내 스킬과 대응되면 모델이 짝을 지어 알려 주는 데 쓴다.
# hermes 는 프로필 기능이 켜지면 HOME 을 바꾸므로 Path.home() 대신 계정 홈을 직접 찾는다.
MY_SKILLS_DIR = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".claude" / "skills"
MY_SKILL_DESC_LIMIT = 50
# 입력 예산: 아침신문 입력 약 18.6K 토큰 + 이 블록 + 프롬프트 증가분이 25K 아래여야 한다(RATIONALE.md 계산).
MY_SKILLS_MAX_CHARS = 2_400
HN_ENDPOINT = "https://hn.algolia.com/api/v1/search"
HN_MIN_POINTS = 50
YOZM_FEED = "https://yozm.wishket.com/magazine/feed/"
# 최근 발송본에 실린 URL 은 도구 후보에서 뺀다. 요즘IT RSS 에는 발행일이 없고 GitHub 스타 순위는
# 며칠씩 그대로라, 이걸 안 하면 같은 도구를 매일 소개한다. 파일 수 기준이라 수동 재실행이 있으면 며칠 짧아진다.
SENT_LOOKBACK_FILES = 7
SENT_OUTPUT_DIR = HERMES_HOME / "cron" / "output" / "91a2c90c75b8"
_URL_PATTERN = re.compile(r"https?://[^\s<>()\[\]\"']+")
_HTML_TAG_PATTERN = re.compile(r"<[^>]+>")

# 원문 제목에 한자가 있으면 원문이 중국어(위챗 공중호 등)라 링크를 눌러도 읽을 수 없다.
# 도메인 목록보다 단순하고, 영문 원문은 AIHOT 이 originalTitle 을 영어로 준다(2026-10-06 실측 7/8).
_CJK_PATTERN = re.compile(r"[\u4e00-\u9fff]")

KST = timezone(timedelta(hours=9))

# 영역마다 쿼리를 둘로 쪼갠다. 하나로 6건을 뽑으면 상위권이 한 사건에 쏠려
# (2026-09-09 실측: 한국 영역 6건 중 3건이 같은 행사 기사) 고를 후보가 실질 3~4개로 준다.
# 서로 다른 축을 노리는 쿼리 두 개면 같은 건수라도 주제 폭이 넓어진다.
# AI 영역은 AIHOT 이 넓은 축을 맡으므로 Tavily 는 대형 연구소 발표 한 축만 남긴다.
SECTIONS = [
    {
        "label": "AI/LLM — 글로벌 동향",
        "aihot": True,
        "queries": [
            # "benchmark" 를 넣으면 벤치마크 설명글이, "funding launch" 를 넣으면
            # 코인 홍보·소규모 보도자료가 올라온다(2026-09-09 실측). 둘 다 뺀 형태.
            "OpenAI Anthropic Google AI model announcement",
        ],
    },
    {
        "label": "한국 IT·스타트업·테크",
        "queries": [
            "한국 스타트업 투자 유치 시리즈 라운드",
            # "신제품 서비스 출시 실적" 은 언론사 기사목록 페이지를 물어온다(실측 4건 전부).
            "국내 테크 기업 AI 서비스 출시 협력",
        ],
    },
    {
        "label": "경제·시장",
        "queries": [
            "코스피 코스닥 증시 마감 외국인 기관 순매수",
            "원달러 환율 기준금리 물가 한국은행 거시지표",
        ],
    },
]


class AihotSchemaChanged(Exception):
    """응답은 왔는데 기대한 구조·필드가 없다. 조용히 0건으로 흘려보내지 않으려고 실패로 올린다."""


class AihotResponseTooLarge(Exception):
    """응답 본문이 AIHOT_MAX_BYTES 를 넘었다."""


def load_api_key() -> str:
    """TAVILY_API_KEY 를 환경변수에서, 없으면 ~/.hermes/.env 에서 읽는다.

    hermes 가 스크립트 자식 프로세스에 .env 를 실어주는지는 보장되지 않으므로
    파일 경로를 폴백으로 둔다.
    """
    from_env = os.environ.get("TAVILY_API_KEY", "").strip()
    if from_env:
        return from_env

    if not ENV_PATH.exists():
        return ""

    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, separator, value = stripped.partition("=")
        if separator and key.strip() == "TAVILY_API_KEY":
            return value.strip().strip("'\"")
    return ""


def load_threat_scanner() -> Callable[[str], str] | None:
    """hermes 의 strict 인젝션 스캐너(`_scan_cron_prompt`)를 가져온다. 못 가져오면 None.

    hermes 는 스크립트 stdout 을 포함한 조립 프롬프트 전체에 이 스캐너를 걸고, 한 건만 걸려도
    모델 호출 없이 그날 job 을 통째로 막는다(cron/scheduler.py `CronPromptInjectionBlocked`).
    AI 보안 기사 제목·요약에 "ignore previous instructions" 같은 인용이 실리면 그 한 건 때문에
    브리핑이 사라지므로, 같은 함수로 기사 단위 사전 선별을 한다.
    """
    agent_dir = str(HERMES_AGENT_DIR)
    if agent_dir not in sys.path:
        sys.path.insert(0, agent_dir)
    try:
        from tools.cronjob_tools import _scan_cron_prompt
    except Exception as error:  # noqa: BLE001 — import 실패 원인은 무엇이든 "선별 불가"로 같다
        print(f"threat scanner import failed: {error}", file=sys.stderr)
        return None
    return _scan_cron_prompt


def normalize_published(value: object) -> str:
    """발행 시각을 KST `YYYY-MM-DD HH:MM` 으로 맞춘다. 해석 못 하면 원문 그대로 둔다.

    Tavily 는 RFC 2822(`Mon, 05 Oct 2026 14:21:00 GMT`), AIHOT 은 ISO 8601 UTC 를 준다.
    표기가 섞이면 job 프롬프트의 "발행일 최신 우선" 비교를 모델이 잘못할 수 있다.
    이 함수는 소스별 예외 격리 밖(출력 단계)에서 불리므로, 외부가 준 값이 문자열이 아니어도 죽으면 안 된다.
    """
    if not isinstance(value, str):
        return "발행일 미상"
    raw = value.strip()
    if not raw:
        return "발행일 미상"

    parsed: datetime | None = None
    try:
        parsed = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        parsed = None
    if parsed is None:
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return raw

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(KST).strftime("%Y-%m-%d %H:%M")


def search_news(api_key: str, query: str) -> list[dict]:
    """Tavily 를 news 토픽으로 호출한다. 실패는 예외로 올려 호출부가 표기하게 한다."""
    payload = {
        "api_key": api_key,
        "query": query,
        # 이 두 줄이 이 스크립트의 존재 이유다.
        # topic=news 는 뉴스 기사만, days 는 발행일 기준 최근 N일만 남긴다.
        "topic": "news",
        "days": RECENCY_DAYS,
        "max_results": CANDIDATES_PER_QUERY,
        "include_raw_content": False,
        "include_images": False,
    }
    request = urllib.request.Request(
        TAVILY_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as response:
        body = json.loads(response.read().decode("utf-8"))
    results = body.get("results")
    if not isinstance(results, list):
        return []
    # 원소 타입까지 보는 이유: dict 아닌 값이 하나만 섞여도 아래 .get() 에서 AttributeError 가 나고,
    # collect_section 의 except 는 그걸 안 잡아 스크립트가 통째로 죽는다(= 그날 브리핑 유실).
    # 한 건이 이상하다고 나머지 후보까지 버릴 이유는 없으므로 그 원소만 떨군다.
    return [dict(article, source="tavily") for article in results if isinstance(article, dict)]


@functools.lru_cache(maxsize=1)
def fetch_aihot() -> dict:
    """AIHOT JSON 을 받아 dict 로 돌려준다. 네트워크·디코드 실패와 과대 응답은 예외로 올린다.

    AI 영역과 도구 코너가 같은 응답을 쓰므로 한 번만 받는다(실패는 캐시되지 않아 도구 코너가 한 번 더 시도한다).
    """
    request = urllib.request.Request(AIHOT_ENDPOINT, headers={"User-Agent": AIHOT_USER_AGENT})
    with urllib.request.urlopen(request, timeout=AIHOT_TIMEOUT_SEC) as response:
        raw = response.read(AIHOT_MAX_BYTES + 1)
    if len(raw) > AIHOT_MAX_BYTES:
        raise AihotResponseTooLarge(f"{len(raw)}+ bytes")
    body = json.loads(raw.decode("utf-8"))
    if not isinstance(body, dict):
        raise AihotSchemaChanged("top-level is not an object")
    return body


def select_aihot_items(body: dict) -> tuple[list[dict], list[tuple[dict, str]]]:
    """AIHOT 응답을 기사 dict 로 바꾸고 거른다. (남긴 것, [(뺀 것, 사유)]) 를 돌려준다.

    네트워크와 분리한 순수 함수라 --self-check 가 고정 샘플로 검사한다.
    """
    items = body.get("items")
    if not isinstance(items, list):
        raise AihotSchemaChanged("missing 'items' array")

    usable: list[dict] = []
    dropped: list[tuple[dict, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        links = item.get("links") if isinstance(item.get("links"), dict) else {}
        title = item.get("originalTitle")
        url = links.get("original")
        article = {
            "source": "aihot",
            "title": title.strip() if isinstance(title, str) else "",
            "url": url.strip() if isinstance(url, str) else "",
            "published_date": item.get("publishedAt"),
            # 요약은 AIHOT 편집부의 중국어 요약이다. 모델이 한국어로 옮긴다(job 프롬프트).
            "content": item.get("summary") if isinstance(item.get("summary"), str) else "",
            "category": item.get("category"),
        }
        if not article["title"] or not article["url"]:
            dropped.append((article, "no_original"))
            continue
        usable.append(article)

    # 항목은 왔는데 원문 제목·URL 을 가진 게 하나도 없으면 필드 이름이 바뀐 것이다.
    # 이걸 "필터로 0건"과 같이 취급하면 AIHOT 이 영구히 조용히 빠진다.
    if items and not usable:
        raise AihotSchemaChanged("no item has originalTitle + links.original")

    # 상한(AIHOT_MAX_CANDIDATES)은 여기서 자르지 않는다. 인젝션 사전 선별(main)이 뒤에 있어,
    # 먼저 자르면 앞쪽 한 건이 선별에 걸렸을 때 뒤의 정상 후보로 채우지 못한다.
    kept: list[dict] = []
    for article in usable:
        if _CJK_PATTERN.search(article["title"]):
            dropped.append((article, "cjk_title"))
        else:
            kept.append(article)
    return kept, dropped


# 네이버 블로그 등 일부 출처는 본문에 제로폭 문자를 박아 넣는다. 그게 스니펫에 실려 오면
# hermes cron 의 인젝션 스캐너가 조립된 프롬프트 전체를 차단해 job 이 실행조차 안 된다
# (2026-09-13·14 '아침신문' 실패. 차단 목록은 tools/cronjob_tools.py `_CRON_INVISIBLE_CHARS`).
# str.split() 은 이 문자들을 공백으로 보지 않으므로 아래 스니펫 정리로는 걸러지지 않는다.
_INVISIBLE_TRANSLATION = dict.fromkeys(
    map(ord, "\u200b\u200c\u200d\u2060\ufeff\u202a\u202b\u202c\u202d\u202e")
)


def format_article(index: int, article: dict, snippet_limit: int = SNIPPET_LIMIT) -> str:
    title = (article.get("title") or "(제목 없음)").strip()
    url = (article.get("url") or "").strip()
    published = normalize_published(article.get("published_date"))
    snippet = " ".join((article.get("content") or "").split())
    if len(snippet) > snippet_limit:
        snippet = snippet[:snippet_limit] + "…"
    # 기사에서 온 값은 전부 이 한 줄을 통과한다 — 제목·스니펫·URL 어디에 섞여 있어도 여기서 벗겨진다.
    return f"{index}. [{published}] {title}\n   {snippet}\n   {url}".translate(_INVISIBLE_TRANSLATION)


# 제목 비교용 키가 이보다 짧으면 제목 중복 판정을 하지 않는다. "속보"·"마감시황" 같은 짧은 제목은
# 서로 다른 기사끼리도 같아질 수 있다.
TITLE_KEY_MIN_LENGTH = 12


def title_key(title: str) -> str:
    """같은 기사가 다른 URL 로 재게시된 것(언론사 원문·포털 재게시)을 잡기 위한 제목 정규화 키.

    대소문자와 공백만 정규화하고 제목 전체를 그대로 비교한다. 재게시본은 제목이 글자 그대로 같으므로
    (2026-10-06 news1·daum 실측) 이것으로 충분하다. 더 느슨하게 하면 다른 기사를 같은 기사로 지운다:
    - 문장부호를 지우면 `코스피 +1.2% 마감` / `코스피 -1.2% 마감` 이 같은 키가 된다.
    - 끝의 매체명(`… - 머니투데이`)을 떼면 `… - 협력 확대` / `… - 협력 종료` 를 구별하지 못한다.
    """
    return " ".join(title.lower().split())


def ledger_row(article: dict, kept: bool, reason: str | None) -> dict:
    return {
        "date": datetime.now(KST).strftime("%Y-%m-%d"),
        "source": article.get("source", "tavily"),
        "url": (article.get("url") or "").strip(),
        "title": (article.get("title") or "").strip(),
        "kept": kept,
        "reason": reason,
    }


def collect_section(
    api_key: str, section: dict, ledger: list[dict]
) -> tuple[list[dict], list[str]]:
    """영역 하나의 후보를 소스 순서대로 모은다. 중복 제거는 main 이 선별을 마친 뒤에 한다.

    소스·쿼리 하나가 실패해도 나머지는 살린다 — 한 축이 막혔다고 영역을 통째로 비우면
    실제로는 절반이 멀쩡한데도 "수집 실패" 로 보고하게 된다.
    반환값의 두 번째 항목은 실패한 소스·쿼리들의 예외 이름이다(호출부가 표기용으로 쓴다).
    """
    label = section["label"]
    collected: list[dict] = []
    failures: list[str] = []

    if section.get("aihot"):
        try:
            kept, dropped = select_aihot_items(fetch_aihot())
        # AIHOT 은 덧붙인 소스라 어떤 이유로 실패해도 영역·브리핑을 끌고 내려가면 안 된다.
        # Tavily 쪽처럼 예외를 골라 잡으면 RemoteDisconnected 같은 누락 하나가 스크립트를 죽인다.
        except Exception as error:  # noqa: BLE001
            failures.append(f"AIHOT {type(error).__name__}")
            print(f"section '{label}' AIHOT failed: {error!r}", file=sys.stderr)
        else:
            for article, reason in dropped:
                ledger.append(ledger_row(article, False, reason))
            collected.extend(kept)

    for query in section["queries"]:
        if not api_key:
            failures.append("TavilyKeyMissing")
            continue
        try:
            articles = search_news(api_key, query)
        # 예외를 골라 잡으면 목록 밖의 실패(RemoteDisconnected·IncompleteRead·ConnectionResetError 등) 하나가
        # 스크립트를 죽이고, 그날 브리핑은 기사 대신 Script Error 만 받는다. 쿼리 하나의 실패로 끝나야 한다.
        except Exception as error:  # noqa: BLE001
            failures.append(type(error).__name__)
            print(f"section '{label}' query '{query}' failed: {error}", file=sys.stderr)
            continue
        collected.extend(articles)

    return collected, failures


def fetch_bytes(url: str, headers: dict | None = None) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (morning-news)", **(headers or {})})
    with urllib.request.urlopen(request, timeout=TOOL_TIMEOUT_SEC) as response:
        raw = response.read(TOOL_MAX_BYTES + 1)
    if len(raw) > TOOL_MAX_BYTES:
        raise ValueError(f"response over {TOOL_MAX_BYTES} bytes")
    return raw


# 아래 *_tools 는 응답을 기사 dict 로만 바꾸는 순수 함수다(--self-check 가 고정 샘플로 검사한다).
def aihot_tools(body: dict) -> list[dict]:
    kept, _ = select_aihot_items(body)
    return [article for article in kept if article.get("category") in AIHOT_TOOL_CATEGORIES]


def github_tools(body: dict) -> list[dict]:
    return [
        {
            "source": "github",
            "title": f"{repo.get('full_name')} (스타 {repo.get('stargazers_count')})",
            "url": repo["html_url"],
            "published_date": repo.get("created_at"),
            "content": repo.get("description") or "",
        }
        for repo in body.get("items", [])
        if isinstance(repo, dict) and isinstance(repo.get("html_url"), str)
    ]


def hn_tools(body: dict) -> list[dict]:
    hits = [hit for hit in body.get("hits", []) if isinstance(hit, dict) and isinstance(hit.get("points"), int)]
    hits.sort(key=lambda hit: hit["points"], reverse=True)
    return [
        {
            "source": "hn",
            "title": f"{hit.get('title')} ({hit['points']}점)",
            # 링크 없는 Show HN 은 토론 글 자체가 소개다.
            "url": hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
            "published_date": hit.get("created_at"),
            "content": html.unescape(_HTML_TAG_PATTERN.sub(" ", hit.get("story_text") or "")),
        }
        for hit in hits
    ]


def yozm_tools(raw: bytes) -> list[dict]:
    """요즘IT RSS 를 최신순 그대로 바꾼다. RSS 에 발행일이 없어 날짜는 비워 둔다(2026-10-21 실측)."""
    return [
        {
            "source": "yozm",
            "title": item.findtext("title") or "",
            "url": (item.findtext("link") or "").strip(),
            "published_date": None,
            "content": item.findtext("description") or "",
        }
        for item in ElementTree.fromstring(raw).iter("item")
    ]


def is_bait_repo(url: str) -> bool:
    """저장소 이름이 크랙·미끼로 보이면 True. 소유자 이름은 보지 않는다(`Sourcecladrag/Windows-Optimizer` 는 이름만으로 잡는다)."""
    name = urllib.parse.urlparse(url).path.strip("/").rpartition("/")[2].lower()
    tokens = set(re.split(r"[^a-z0-9]+", name))
    return bool(tokens & BAIT_NAME_TOKENS) or bool(tokens & BAIT_BRAND_TOKENS and tokens & BAIT_LURE_TOKENS)


def merge_github_tools(batches: list[list[dict]]) -> list[dict]:
    """검색 결과 묶음들을 순위별로 번갈아 합치고 URL 중복을 뺀다.

    스타순으로 이어 붙이면 상위 3건이 한 토픽(`claude-code` 64건)으로 채워져 다른 토픽이 보이지 않는다.
    """
    merged: list[dict] = []
    seen: set[str] = set()
    for rank in range(max((len(batch) for batch in batches), default=0)):
        for batch in batches:
            if rank < len(batch) and batch[rank]["url"].lower() not in seen:
                seen.add(batch[rank]["url"].lower())
                merged.append(batch[rank])
    return merged


def fetch_github_tools() -> list[dict]:
    since = (datetime.now(KST) - timedelta(days=GITHUB_NEW_REPO_DAYS)).strftime("%Y-%m-%d")
    # 소스당 3건만 쓰므로 토픽이 4개면 뒤쪽은 늘 밀린다. 시작 토픽을 날마다 돌려 네 토픽이 고르게 나오게 한다.
    offset = datetime.now(KST).timetuple().tm_yday % len(GITHUB_TOPICS)
    topics = GITHUB_TOPICS[offset:] + GITHUB_TOPICS[:offset]
    queries = [f"topic:{topic} created:>{since} stars:>{GITHUB_TOPIC_MIN_STARS}" for topic in topics]
    queries.append(f"created:>{since} stars:>{GITHUB_MIN_STARS}")
    batches: list[list[dict]] = []
    last_error: Exception | None = None
    for query in queries:
        # 뒤에 HN·요즘IT·README 가 남아 있으므로 검색에 쓸 수 있는 시간을 그만큼 남겨 둔다.
        if time.monotonic() - _STARTED_AT > TOOL_DEADLINE_SEC - 3 * TOOL_TIMEOUT_SEC:
            print(f"github search skipped (time budget): {query}", file=sys.stderr)
            continue
        params = urllib.parse.urlencode({"q": query, "sort": "stars", "order": "desc", "per_page": 10})
        try:
            raw = fetch_bytes(f"{GITHUB_ENDPOINT}?{params}", {"Accept": "application/vnd.github+json"})
            batches.append(github_tools(json.loads(raw)))
        # 비인증 검색은 분당 10회라 중간에 403 이 날 수 있다. 일부만 성공해도 그 후보로 간다.
        except Exception as error:  # noqa: BLE001
            last_error = error
            print(f"github search '{query}' failed: {error!r}", file=sys.stderr)
    # 전부 실패했을 때만 소스 실패로 올려 호출부가 "GitHub <오류>" 로 표기하게 한다.
    if not batches and last_error is not None:
        raise last_error
    return merge_github_tools(batches)


def readme_excerpt(markdown: str) -> str:
    """README 를 절 단위로 나눠 설치·사용 절을 앞에 두고, 그림·배지·태그를 걷어 README_EXCERPT_LIMIT 로 자른다."""
    starts = [0] + [match.start() for match in _README_HEADING.finditer(markdown)]
    sections = [markdown[start:end] for start, end in zip(starts, starts[1:] + [len(markdown)])]
    usage: list[str] = []
    rest: list[str] = []
    # 설치 절 아래 하위 절(`## Installation` → `### With pip`)에 명령이 있는 README 가 많아 하위 절째 옮긴다.
    usage_level = 0
    for section in sections:
        level = len(section) - len(section.lstrip("#"))
        if usage_level and level > usage_level:
            usage.append(section)
            continue
        usage_level = 0
        if level and _README_USAGE_HEADING.search(section.split("\n", 1)[0]):
            usage_level = level
            usage.append(section)
        else:
            rest.append(section)
    text = _README_LINK.sub(r"\1", _README_NOISE.sub(" ", "\n".join(usage + rest)))
    # 줄 경계를 "; " 로 남긴다. 공백 하나로 이으면 여러 줄 명령이 `cd x npm ci` 처럼 한 명령으로 읽힌다.
    text = "; ".join(" ".join(line.split()) for line in text.splitlines() if line.strip())
    return text[:README_EXCERPT_LIMIT] + "…" if len(text) > README_EXCERPT_LIMIT else text


def parse_skill_frontmatter(text: str) -> tuple[str, str]:
    """SKILL.md 맨 위 frontmatter 의 (name, description). 한 줄·따옴표·`>`/`|` 여러 줄 설명을 읽고, 없으면 빈 문자열."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return "", ""
    fields: dict[str, str] = {}
    key = ""
    for line in lines[1:]:
        if line.strip() == "---":
            break
        match = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
        if match:
            key = match.group(1)
            value = match.group(2).strip()
            fields[key] = "" if value in (">", "|", ">-", "|-") else value.strip("\"'")
        elif key and line[:1] in (" ", "\t"):
            fields[key] = f"{fields.get(key, '')} {line.strip()}".strip()
    return fields.get("name", ""), fields.get("description", "")


def load_my_skills(root: Path = MY_SKILLS_DIR) -> list[dict]:
    """내 스킬을 이름순 [{name, description, path}] 로 돌려준다. 디렉터리가 없거나 못 읽으면 빈 목록.

    `_archive`·`.trash` 처럼 `_`·`.` 로 시작하거나 SKILL.md 가 없는 디렉터리(`synced` 등)는 스킬이 아니다.
    심볼릭 링크 스킬(`caveman -> ../../.agents/skills/caveman`)은 따라간다.
    """
    skills: list[dict] = []
    try:
        entries = sorted(root.iterdir())
    except OSError as error:
        print(f"skills dir read failed: {error}", file=sys.stderr)
        return []
    for entry in entries:
        path = entry / "SKILL.md"
        if entry.name[:1] in (".", "_") or not path.is_file():
            continue
        try:
            with path.open(encoding="utf-8", errors="replace") as skill_file:
                head = skill_file.read(4_000)
        except OSError as error:
            print(f"skill read failed '{entry.name}': {error}", file=sys.stderr)
            continue
        name, description = parse_skill_frontmatter(head)
        skills.append({"name": name or entry.name, "description": description, "path": path})
    return sorted(skills, key=lambda skill: skill["name"])


def format_my_skills(skills: list[dict], scan: Callable[[str], str] | None = None) -> list[str]:
    """`- 이름: 설명` 줄들. 설명은 MY_SKILL_DESC_LIMIT 자로 자르고 전체는 MY_SKILLS_MAX_CHARS 를 넘기지 않는다."""
    lines: list[str] = []
    used = 0
    for index, skill in enumerate(skills):
        description = " ".join(skill["description"].split())
        if len(description) > MY_SKILL_DESC_LIMIT:
            description = description[:MY_SKILL_DESC_LIMIT] + "…"
        line = f"- {skill['name']}: {description}".translate(_INVISIBLE_TRANSLATION)
        if scan is not None and scan(line):
            continue
        if used + len(line) + 1 > MY_SKILLS_MAX_CHARS:
            lines.append(f"- (외 {len(skills) - index}개 생략)")
            break
        used += len(line) + 1
        lines.append(line)
    return lines


def with_readme(article: dict) -> dict:
    """GitHub 후보에 README 발췌를 붙인다. 못 받아도 한 줄 소개만으로 후보는 살린다."""
    path = urllib.parse.urlparse(article.get("url") or "").path.strip("/")
    try:
        raw = fetch_bytes(f"https://api.github.com/repos/{path}/readme", {"Accept": "application/vnd.github.raw"})
    except Exception as error:  # noqa: BLE001 — README 는 덧붙이는 정보라 어떤 실패도 후보를 버릴 이유가 아니다
        print(f"github readme '{path}' failed: {error!r}", file=sys.stderr)
        return article
    excerpt = readme_excerpt(raw.decode("utf-8", errors="replace"))
    return dict(article, content=f"{article.get('content') or ''} README: {excerpt}") if excerpt else article


def fetch_hn_tools() -> list[dict]:
    since = int(datetime.now(timezone.utc).timestamp()) - 86_400
    query = urllib.parse.urlencode(
        {"tags": "show_hn", "numericFilters": f"created_at_i>{since},points>{HN_MIN_POINTS}", "hitsPerPage": 20}
    )
    return hn_tools(json.loads(fetch_bytes(f"{HN_ENDPOINT}?{query}")))


TOOL_SOURCES: list[tuple[str, Callable[[], list[dict]]]] = [
    ("AIHOT", lambda: aihot_tools(fetch_aihot())),
    ("GitHub", fetch_github_tools),
    ("HN", fetch_hn_tools),
    ("요즘IT", lambda: yozm_tools(fetch_bytes(YOZM_FEED))),
]


def normalize_url(url: str) -> str:
    return url.strip().rstrip("/.,")


def sent_urls(texts: list[str]) -> set[str]:
    """발송본에서 모델이 실제로 쓴 URL 만 뽑는다.

    출력 파일에는 프롬프트(=후보 전체)도 함께 있어서, `## Response` 뒤만 봐야 고르지 않은 후보까지 빠지지 않는다.
    """
    urls: set[str] = set()
    for text in texts:
        _, marker, response = text.rpartition("## Response")
        if marker:
            urls.update(normalize_url(url) for url in _URL_PATTERN.findall(response))
    return urls


def load_recent_sent_urls() -> set[str]:
    # 못 읽으면 중복 제외만 빠질 뿐 브리핑은 나가야 한다.
    try:
        files = sorted(SENT_OUTPUT_DIR.glob("*.md"))[-SENT_LOOKBACK_FILES:]
        return sent_urls([path.read_text(encoding="utf-8", errors="replace") for path in files])
    except OSError as error:
        print(f"sent briefing read failed: {error}", file=sys.stderr)
        return set()


def collect_tools(
    scan: Callable[[str], str] | None, ledger: list[dict], exclude: set[str], started_at: float = _STARTED_AT
) -> tuple[list[str], list[str]]:
    """도구 후보를 소스마다 최대 TOOL_CANDIDATES_PER_SOURCE 건씩 모은다. (출력 줄, 실패 소스) 를 돌려준다."""
    lines: list[str] = []
    failures: list[str] = []
    # 소스 하나가 가장 오래 기다리는 경우는 AIHOT 재시도(앞서 실패했으면 캐시가 없다)다.
    longest_wait = max(TOOL_TIMEOUT_SEC, AIHOT_TIMEOUT_SEC)
    for name, fetch in TOOL_SOURCES:
        if time.monotonic() - started_at > TOOL_DEADLINE_SEC - longest_wait:
            failures.append(f"{name} 시간 부족으로 건너뜀")
            continue
        try:
            articles = fetch()
        # 덧붙인 코너라 소스 하나의 어떤 실패도 뉴스 브리핑을 끌고 내려가면 안 된다.
        except Exception as error:  # noqa: BLE001
            failures.append(f"{name} {type(error).__name__}")
            print(f"tool source '{name}' failed: {error!r}", file=sys.stderr)
            continue
        taken = 0
        # 인젝션 선별로 빠진 후보도 README 를 이미 받았으므로, 채택 수가 아니라 요청 수로 센다.
        readme_left = TOOL_CANDIDATES_PER_SOURCE
        for article in articles:
            if taken >= TOOL_CANDIDATES_PER_SOURCE:
                break
            url = normalize_url(article.get("url") or "")
            if not url:
                ledger.append(ledger_row(article, False, "no_url"))
                continue
            if url in exclude:
                ledger.append(ledger_row(article, False, "already_used"))
                continue
            if article.get("source") == "github" and is_bait_repo(url):
                ledger.append(ledger_row(article, False, "bait_name"))
                continue
            labeled = dict(article, title=f"[{name}] {(article.get('title') or '').strip()}")
            snippet_limit = TOOL_SNIPPET_LIMIT
            # README 는 실릴 후보에만, 소스당 TOOL_CANDIDATES_PER_SOURCE 회까지, 시간 예산이 남았을 때만 받는다.
            # 모자라면 한 줄 소개로 간다.
            if (
                article.get("source") == "github"
                and readme_left > 0
                and time.monotonic() - started_at < TOOL_DEADLINE_SEC - TOOL_TIMEOUT_SEC
            ):
                readme_left -= 1
                labeled = with_readme(labeled)
                snippet_limit += README_EXCERPT_LIMIT + len(" README: …")
            text = format_article(len(lines) + 1, labeled, snippet_limit)
            if scan is not None and scan(text):
                ledger.append(ledger_row(article, False, "threat_pattern"))
                continue
            exclude.add(url)
            taken += 1
            ledger.append(ledger_row(article, True, None))
            lines.append(text)
    return lines, failures


def write_ledger(rows: list[dict]) -> None:
    # 원장은 사후 분석용이다. 쓰기에 실패해도 브리핑은 나가야 하므로 stderr 에만 남긴다.
    try:
        LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LEDGER_PATH.open("a", encoding="utf-8") as ledger_file:
            for row in rows:
                ledger_file.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError as error:
        print(f"ledger write failed: {error}", file=sys.stderr)


def main() -> int:
    api_key = load_api_key()
    if not api_key:
        # 키가 없어도 AIHOT 은 수집한다. Tavily 쿼리는 영역마다 "검색 실패(TavilyKeyMissing)" 로
        # 표기되므로, 모델이 그 사실을 모른 채 지어내는 일은 없다.
        print("TAVILY_API_KEY missing", file=sys.stderr)

    scan = load_threat_scanner()

    print(f"## 오늘 수집한 기사 후보 (Tavily news 최근 {RECENCY_DAYS}일 · AIHOT 최근 24시간)")
    if not api_key:
        print("(TAVILY_API_KEY 를 찾지 못해 Tavily 검색은 하지 못했습니다. 기사를 지어내지 마세요.)")
    if scan is None:
        print("(인젝션 사전 선별 불가)")
    print()

    total = 0
    ledger: list[dict] = []
    news_urls: set[str] = set()
    for section in SECTIONS:
        print(f"### {section['label']}")
        articles, failures = collect_section(api_key, section, ledger)

        lines: list[str] = []
        aihot_count = 0
        seen_urls: set[str] = set()
        seen_titles: set[str] = set()
        for article in articles:
            text = format_article(len(lines) + 1, article)
            # 기사 하나가 걸리면 hermes 가 그날 job 전체를 막는다. 걸리는 기사만 빼고 나머지를 살린다.
            if scan is not None and scan(text):
                ledger.append(ledger_row(article, False, "threat_pattern"))
                print(f"section '{section['label']}' dropped by threat scan: {article.get('url')}", file=sys.stderr)
                continue
            if article.get("source") == "aihot":
                if aihot_count >= AIHOT_MAX_CANDIDATES:
                    ledger.append(ledger_row(article, False, "over_cap"))
                    continue
            url = (article.get("url") or "").strip()
            # 두 쿼리(또는 AIHOT 과 Tavily)가 같은 기사를 물어오는 경우가 있다. 그대로 두면 후보 수만
            # 부풀고 모델이 같은 사건을 두 번 고를 수 있다. 선별·상한 뒤에 거르는 이유: 앞에서 거르면
            # 선별·상한에 걸려 빠질 AIHOT 사본이 자리를 차지해 멀쩡한 Tavily 사본까지 함께 사라진다.
            if url and url in seen_urls:
                ledger.append(ledger_row(article, False, "duplicate"))
                continue
            # 같은 기사가 언론사 원문과 포털 재게시(news1 → v.daum.net 등)로 URL 만 달리 들어오는 경우.
            # URL 비교로는 못 잡아 후보 칸을 하나 낭비한다(2026-10-06 한국 IT 영역 실측).
            key = title_key(article.get("title") or "")
            if len(key) >= TITLE_KEY_MIN_LENGTH and key in seen_titles:
                ledger.append(ledger_row(article, False, "duplicate_title"))
                continue
            if url:
                seen_urls.add(url)
                news_urls.add(normalize_url(url))
            if len(key) >= TITLE_KEY_MIN_LENGTH:
                seen_titles.add(key)
            if article.get("source") == "aihot":
                aihot_count += 1
            ledger.append(ledger_row(article, True, None))
            lines.append(text)

        if not lines:
            if failures:
                print(f"- 검색 실패({', '.join(failures)}). 이 영역은 수집하지 못했습니다.")
            else:
                print(f"- 최근 {RECENCY_DAYS}일 내 기사가 검색되지 않았습니다.")
            print()
            continue

        for line in lines:
            print(line)
        if failures:
            # 후보가 평소보다 적은 이유를 모델에게 알려, 억지로 3건을 채우지 않게 한다.
            print(f"   (일부 검색 실패: {', '.join(failures)} — 후보가 평소보다 적습니다)")
        total += len(lines)
        print()

    print(f"(총 후보 {total}건)")
    print()

    # 뉴스 후보와 최근 발송본에 이미 나온 것은 도구 후보에서 뺀다.
    print("### 오늘의 도구 후보 (AIHOT 제품·팁 · GitHub 최근 7일 신규 저장소 · Show HN 24시간 · 요즘IT 최신글)")
    tool_lines, tool_failures = collect_tools(scan, ledger, load_recent_sent_urls() | news_urls)
    for line in tool_lines:
        print(line)
    if not tool_lines:
        print("- 도구 후보를 수집하지 못했습니다.")
    if tool_failures:
        print(f"   (일부 소스 수집 실패: {', '.join(tool_failures)})")

    # 모델이 도구 후보와 대응되는 내 스킬을 알려 주게 한다. 없거나 못 읽으면 이 블록만 빠진다.
    skill_lines = format_my_skills(load_my_skills(), scan)
    if skill_lines:
        print()
        print("### 내 스킬 목록 (후보와 대응되는 것이 있을 때만 쓰는 참고용 · 이름: 설명)")
        for line in skill_lines:
            print(line)

    print(f"collected {total} articles, {len(tool_lines)} tools", file=sys.stderr)
    write_ledger(ledger)
    return 0


def self_check() -> None:
    """AIHOT 변환·필터의 고정 샘플 검사. 2026-10-06 실측 응답에서 필드 구조를 그대로 따왔다."""

    def item(title: str, url: str | None, published: str = "2026-10-05T23:56:47.000Z") -> dict:
        links = {"aihot": "https://aihot.news/items/x"}
        if url is not None:
            links["original"] = url
        return {"title": "中文编辑标题", "originalTitle": title, "summary": "摘要", "links": links, "publishedAt": published}

    sample = {
        "schemaVersion": 1,
        "items": [
            item("Quoting Felix Rieseberg", "https://simonwillison.net/2026/Oct/5/felix-rieseberg/"),
            item("聊聊A16Z这两份AI报告", "https://mp.weixin.qq.com/s?x=1"),
            item("No original link", None),
        ]
        + [item(f"English title {n}", f"https://example.com/{n}") for n in range(6)],
    }
    kept, dropped = select_aihot_items(sample)
    reasons = [reason for _, reason in dropped]
    # 상한은 main 에서 인젝션 선별 뒤에 자른다 — 여기서는 한자·원문 누락만 빠진다.
    assert len(kept) == 7, kept
    assert kept[0]["title"] == "Quoting Felix Rieseberg" and kept[0]["url"].startswith("https://simonwillison.net/")
    assert all(article["source"] == "aihot" for article in kept)
    assert sorted(reasons) == ["cjk_title", "no_original"], reasons

    # 필드 이름이 바뀌면 "필터로 0건"이 아니라 실패여야 한다.
    renamed = {"items": [{"originalTitleV2": "x", "links": {"original": "https://a.b"}}]}
    for broken in (renamed, {"page": {}}):
        try:
            select_aihot_items(broken)
        except AihotSchemaChanged:
            pass
        else:
            raise AssertionError(f"schema change not detected: {broken}")

    # 조용한 날(0건)은 정상이다.
    assert select_aihot_items({"items": []}) == ([], [])

    assert normalize_published("2026-10-05T23:56:47.000Z") == "2026-10-06 08:56"
    assert normalize_published("Mon, 05 Oct 2026 14:21:00 GMT") == "2026-10-05 23:21"
    assert normalize_published(None) == "발행일 미상"
    # 출력 단계는 소스별 예외 격리 밖이라, 문자열이 아닌 값에 죽으면 그날 브리핑이 사라진다.
    assert normalize_published(1759708607) == "발행일 미상"
    assert normalize_published({"at": "x"}) == "발행일 미상"
    assert normalize_published("어제") == "어제"

    # 같은 기사의 원문·포털 재게시는 같은 키(공백·대소문자 차이 무시), 의미가 다른 기사는 다른 키.
    news1 = "스타트업 투자, 3분기 만에 10조 돌파…AI 반도체·바이오 자금 쏠림"
    assert title_key(news1) == title_key("  " + news1.replace(" ", "  ").replace("AI", "ai") + " ")
    assert title_key("OpenAI와 마이크로소프트 - 협력 확대") != title_key("OpenAI와 마이크로소프트 - 협력 종료")
    assert title_key("코스피 +1.2% 마감…외국인 순매수") != title_key("코스피 -1.2% 마감…외국인 순매수")
    assert len(title_key("[속보] 마감시황")) < TITLE_KEY_MIN_LENGTH

    # 도구 코너: AIHOT 은 제품·팁만, 다른 소스는 형태만 바꾼다.
    tool_sample = {"items": [dict(item("Product A", "https://a.example/p"), category="ai-products"),
                             dict(item("Industry B", "https://b.example/i"), category="industry")]}
    assert [article["title"] for article in aihot_tools(tool_sample)] == ["Product A"]
    repos = github_tools({"items": [{"full_name": "o/r", "html_url": "https://github.com/o/r",
                                     "stargazers_count": 1944, "description": None}, "broken"]})
    assert repos == [{"source": "github", "title": "o/r (스타 1944)", "url": "https://github.com/o/r",
                      "published_date": None, "content": ""}], repos
    hits = hn_tools({"hits": [{"title": "Show HN: low", "points": 60, "objectID": "1"},
                              {"title": "Show HN: high", "points": 120, "url": "https://x.dev", "story_text": "<p>it&#x27;s</p>"}]})
    assert [hit["url"] for hit in hits] == ["https://x.dev", "https://news.ycombinator.com/item?id=1"]
    assert hits[0]["content"].split() == ["it's"]
    feed = ("<rss><channel><item><title>클로드 코드 팁</title><link>https://yozm.wishket.com/magazine/detail/3993</link>"
            "<description>요약</description></item></channel></rss>").encode("utf-8")
    assert yozm_tools(feed)[0]["url"] == "https://yozm.wishket.com/magazine/detail/3993"

    # 발송본 중복 제외는 모델이 쓴 부분(Response)만 본다 — 프롬프트에 실린 후보 URL 은 제외 대상이 아니다.
    briefing = "## Prompt\n2. 후보 https://not-chosen.example/x\n## Response\n- 고른 것 https://github.com/o/r/\n"
    assert sent_urls([briefing]) == {"https://github.com/o/r"}

    # README 발췌: 설치 절이 맨 앞으로 오고, 그림·태그·코드펜스 표식은 걷히되 명령은 남는다. 서두의 "install" 은 절로 치지 않는다.
    readme = ("# Tool\nno install needed ![b](x.svg) <img src=y>\n## Features\n[fast](https://x)\n## Installation\n"
              "### With pip\n```bash\npip install tool\ntool init\n```\n## License\nMIT\n")
    expected = "## Installation; ### With pip; pip install tool; tool init; # Tool; no install needed; ## Features; fast; ## License; MIT"
    assert readme_excerpt(readme) == expected, readme_excerpt(readme)
    assert len(readme_excerpt("x" * 5000)) == README_EXCERPT_LIMIT + 1

    # 미끼 이름 필터: 크랙·유명 앱+유인어 조합만 잡고, `Pro`·`Optimizer` 단독이나 소유자 이름은 건드리지 않는다.
    for bait in ("https://github.com/UniteCuttlefishBolt/Canva-Pro", "https://github.com/Sourcecladrag/Windows-Optimizer",
                 "https://github.com/x/photoshop_cracked", "https://github.com/x/Some-Keygen-2026",
                 "https://github.com/x/office-crack"):
        assert is_bait_repo(bait), bait
    for fine in ("https://github.com/crack-labs/claude-code-hooks", "https://github.com/x/adam-optimizer",
                 "https://github.com/x/pro-mcp-server", "https://github.com/x/windows-mcp", "https://github.com/x/office-hours-skill",
                 "https://github.com/x/crack-the-interview-kit", "https://github.com/x/skill-activator"):
        assert not is_bait_repo(fine), fine

    # 토픽 결과 병합: 순위별로 번갈아 담고(한 토픽이 상위를 독식하지 않게), 여러 토픽에 걸린 저장소는 한 번만.
    def repo(name: str) -> dict:
        return {"url": f"https://github.com/o/{name}"}

    merged = merge_github_tools([[repo("a1"), repo("a2"), repo("shared")], [repo("b1"), repo("SHARED")], []])
    assert [article["url"].rsplit("/", 1)[1].lower() for article in merged] == ["a1", "b1", "a2", "shared"], merged
    assert merge_github_tools([]) == [] and merge_github_tools([[], []]) == []

    # frontmatter: 한 줄·따옴표·`>` 여러 줄 설명, frontmatter 없음.
    assert parse_skill_frontmatter("---\nname: a\ndescription: one line\n---\nbody") == ("a", "one line")
    assert parse_skill_frontmatter('---\nname: b\ndescription: "quoted"\n---\n') == ("b", "quoted")
    folded = "---\nname: c\ndescription: >\n  first\n  second\nversion: 1\n---\n"
    assert parse_skill_frontmatter(folded) == ("c", "first second")
    assert parse_skill_frontmatter("# no frontmatter") == ("", "")

    # 내 스킬 목록: 비스킬 디렉터리(_·. 시작, SKILL.md 없음)는 빼고 이름순, 심볼릭 링크는 따라간다. 없는 디렉터리는 빈 목록.
    with tempfile.TemporaryDirectory() as workdir:
        root = Path(workdir) / "skills"
        for dirname, body in (("zeta", "---\nname: zeta\ndescription: Z skill\n---\n"), ("alpha", "---\ndescription: no name field\n---\n"),
                              ("_archive", "---\nname: old\n---\n"), (".trash", "---\nname: t\n---\n")):
            (root / dirname).mkdir(parents=True)
            (root / dirname / "SKILL.md").write_text(body, encoding="utf-8")
        (root / "synced").mkdir()
        (Path(workdir) / "real").mkdir()
        (Path(workdir) / "real" / "SKILL.md").write_text("---\nname: linked\ndescription: L\n---\n", encoding="utf-8")
        (root / "linked").symlink_to(Path(workdir) / "real")
        loaded = load_my_skills(root)
        assert [skill["name"] for skill in loaded] == ["alpha", "linked", "zeta"], loaded
        assert load_my_skills(Path(workdir) / "missing") == []

    # 목록 상한: 설명은 잘리고, 스킬이 아무리 많아도 전체가 MY_SKILLS_MAX_CHARS 를 넘지 않으며 생략 수를 알린다. 스캐너에 걸린 줄은 뺀다.
    many = [{"name": f"skill-{n:03d}", "description": "가" * 200} for n in range(100)]
    capped = format_my_skills(many)
    assert sum(len(line) + 1 for line in capped) <= MY_SKILLS_MAX_CHARS + 40, len(capped)
    assert capped[0] == f"- skill-000: {'가' * MY_SKILL_DESC_LIMIT}…" and "생략" in capped[-1], capped[-1]
    assert format_my_skills(many[:3]) == [f"- skill-00{n}: {'가' * MY_SKILL_DESC_LIMIT}…" for n in range(3)]
    assert format_my_skills([{"name": "evil", "description": "bad"}, {"name": "ok", "description": "fine"}],
                            scan=lambda text: "x" if "bad" in text else "") == ["- ok: fine"]

    # 시간 예산을 넘겼으면 네트워크를 건드리지 않고 모든 소스를 건너뛴다.
    skipped_lines, skipped = collect_tools(None, [], set(), started_at=time.monotonic() - TOOL_DEADLINE_SEC)
    assert skipped_lines == [] and len(skipped) == len(TOOL_SOURCES), skipped
    print("self-check ok")


if __name__ == "__main__":
    if "--self-check" in sys.argv[1:]:
        self_check()
        sys.exit(0)
    sys.exit(main())
