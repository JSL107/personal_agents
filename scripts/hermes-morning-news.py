#!/usr/bin/env python3
"""아침신문 cron 용 기사 수집기.

hermes 의 web_search 도구는 Tavily 를 topic 지정 없이 부른다(plugins/web/tavily/provider.py).
그래서 일반 웹 문서가 뉴스 자리를 차지하고(블로그·기관 홈페이지), 발행일 필터가 없어
몇 달 지난 기사가 상위에 올라온다. 이 스크립트는 Tavily 를 news 토픽 + 기간 제한으로
직접 호출해 그 두 문제를 API 차원에서 끊는다.

출력(stdout)은 hermes cron 의 --script 경로로 job 프롬프트에 그대로 주입된다.
따라서 stdout 에는 기사 목록만, 진단 메시지는 stderr 로 보낸다.

이 레포가 정본이고 `~/.hermes/scripts/morning-news.py` 에 복사본을 둔다. hermes cron job
`아침신문`(91a2c90c75b8) 이 매일 08:00 에 `--script` 로 그 복사본을 호출한다.

심볼릭 링크로 묶을 수는 없다. `_run_job_script` 가 경로를 resolve 한 뒤 scripts 디렉터리 안인지
검사해 symlink escape 를 차단한다(`cron/scheduler.py:882-896`). 링크를 걸면 실행 시점에
`Blocked: script path resolves outside the scripts directory` 로 job 이 죽는다.
따라서 이 파일을 고치면 복사본도 함께 갱신해야 한다:
`cp scripts/hermes-morning-news.py ~/.hermes/scripts/morning-news.py`

hermes 본체(`~/.hermes/hermes-agent`)는 업스트림 클론이라 개인 스크립트를 두지 않는다.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

TAVILY_ENDPOINT = "https://api.tavily.com/search"
# hermes 는 스크립트 자식 프로세스에 HERMES_HOME 을 항상 주입한다(cron/scheduler.py).
# HOME 은 프로필 기능(~/.hermes/home)이 켜지면 바뀌므로 기준으로 삼지 않는다.
ENV_PATH = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes")) / ".env"

# 최근 며칠치를 후보로 볼지. 매일 도는 브리핑이라 2~3일이면 충분하고,
# 주말·공휴일에 기사가 마르는 경우를 감안해 3 으로 둔다.
RECENCY_DAYS = 3

# 쿼리 하나가 가져올 후보 건수. 영역마다 쿼리를 2개 쓰므로 영역당 6건이 된다.
# 최종 3건을 고르는데 후보가 3건뿐이면 고를 여지가 없어 검색 순위에 그대로 종속된다.
CANDIDATES_PER_QUERY = 3

# 요약 스니펫 상한. 18건 × 이 길이가 프롬프트에 실리므로 컨텍스트 예산과 직결된다.
SNIPPET_LIMIT = 180

REQUEST_TIMEOUT_SEC = 30

# 영역마다 쿼리를 둘로 쪼갠다. 하나로 6건을 뽑으면 상위권이 한 사건에 쏠려
# (2026-09-09 실측: 한국 영역 6건 중 3건이 같은 행사 기사) 고를 후보가 실질 3~4개로 준다.
# 서로 다른 축을 노리는 쿼리 두 개면 같은 건수라도 주제 폭이 넓어진다.
SECTIONS = [
    {
        "label": "AI/LLM — 글로벌 동향",
        "queries": [
            # "benchmark" 를 넣으면 벤치마크 설명글이, "funding launch" 를 넣으면
            # 코인 홍보·소규모 보도자료가 올라온다(2026-09-09 실측). 둘 다 뺀 형태.
            "AI LLM open source model release",
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
    return [article for article in results if isinstance(article, dict)]


# 네이버 블로그 등 일부 출처는 본문에 제로폭 문자를 박아 넣는다. 그게 스니펫에 실려 오면
# hermes cron 의 인젝션 스캐너가 조립된 프롬프트 전체를 차단해 job 이 실행조차 안 된다
# (2026-09-13·14 '아침신문' 실패. 차단 목록은 tools/cronjob_tools.py `_CRON_INVISIBLE_CHARS`).
# str.split() 은 이 문자들을 공백으로 보지 않으므로 아래 스니펫 정리로는 걸러지지 않는다.
_INVISIBLE_TRANSLATION = dict.fromkeys(
    map(ord, "\u200b\u200c\u200d\u2060\ufeff\u202a\u202b\u202c\u202d\u202e")
)


def format_article(index: int, article: dict) -> str:
    title = (article.get("title") or "(제목 없음)").strip()
    url = (article.get("url") or "").strip()
    published = (article.get("published_date") or "발행일 미상").strip()
    snippet = " ".join((article.get("content") or "").split())
    if len(snippet) > SNIPPET_LIMIT:
        snippet = snippet[:SNIPPET_LIMIT] + "…"
    # 기사에서 온 값은 전부 이 한 줄을 통과한다 — 제목·스니펫·URL 어디에 섞여 있어도 여기서 벗겨진다.
    return f"{index}. [{published}] {title}\n   {snippet}\n   {url}".translate(_INVISIBLE_TRANSLATION)


def collect_section(api_key: str, queries: list[str], label: str) -> tuple[list[dict], list[str]]:
    """영역 하나를 여러 쿼리로 수집하고 URL 기준 중복을 제거한다.

    쿼리 하나가 실패해도 나머지는 살린다 — 한 축이 막혔다고 영역을 통째로 비우면
    실제로는 절반이 멀쩡한데도 "수집 실패" 로 보고하게 된다.
    반환값의 두 번째 항목은 실패한 쿼리들의 예외 이름이다(호출부가 표기용으로 쓴다).
    """
    collected: list[dict] = []
    seen_urls: set[str] = set()
    failures: list[str] = []

    for query in queries:
        try:
            articles = search_news(api_key, query)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as error:
            failures.append(type(error).__name__)
            print(f"section '{label}' query '{query}' failed: {error}", file=sys.stderr)
            continue

        for article in articles:
            url = (article.get("url") or "").strip()
            # 두 쿼리가 같은 기사를 물어오는 경우가 있다. 그대로 두면 후보 수만 부풀고
            # 모델이 같은 사건을 두 번 고를 수 있다.
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            collected.append(article)

    return collected, failures


def main() -> int:
    api_key = load_api_key()
    if not api_key:
        # 키가 없으면 기사 0건이 된다. 조용히 빈 목록을 넘기면 모델이 그 사실을 모른 채
        # 지어내거나 엉뚱한 브리핑을 만들므로, 실패를 프롬프트에 명시적으로 싣는다.
        print("## 수집된 기사 없음")
        print()
        print("TAVILY_API_KEY 를 찾지 못해 기사 수집에 실패했습니다.")
        print("이 경우 기사를 지어내지 말고, 수집 실패 사실만 보고하세요.")
        print("TAVILY_API_KEY missing", file=sys.stderr)
        return 0

    print(f"## 오늘 수집한 기사 후보 (Tavily news, 최근 {RECENCY_DAYS}일)")
    print()

    total = 0
    for section in SECTIONS:
        print(f"### {section['label']}")
        articles, failures = collect_section(api_key, section["queries"], section["label"])

        if not articles:
            if failures:
                print(f"- 검색 실패({', '.join(failures)}). 이 영역은 수집하지 못했습니다.")
            else:
                print(f"- 최근 {RECENCY_DAYS}일 내 기사가 검색되지 않았습니다.")
            print()
            continue

        for index, article in enumerate(articles, start=1):
            print(format_article(index, article))
        if failures:
            # 후보가 평소보다 적은 이유를 모델에게 알려, 억지로 3건을 채우지 않게 한다.
            print(f"   (일부 검색 실패: {', '.join(failures)} — 후보가 평소보다 적습니다)")
        total += len(articles)
        print()

    print(f"(총 후보 {total}건)")
    print(f"collected {total} articles", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
