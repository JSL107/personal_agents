# 아침신문 AI 영역에 AIHOT 후보 추가 (v2)

- 날짜: 2026-10-06 (v2: 같은 날 검토 반영 — 변경 이력은 맨 아래)
- 브랜치: `feat/morning-news-aihot` (worktree `~/worktrees/morning-news-aihot`)
- 대상: `scripts/hermes-morning-news.py`(정본) → `~/.hermes/scripts/morning-news.py`(복사본),
  `~/.hermes/cron/jobs.json` 의 `아침신문`(91a2c90c75b8) 프롬프트 한 줄

## 왜

아침신문 「AI/LLM — 글로벌 동향」 후보는 Tavily 영어 검색어 2개에서 나온다. 검색어 품질에 따라 결과가
출렁인다. 2026-10-06 브리핑의 AI 후보에도 보도자료 배포처(`einnews.com/pr_news`)·재게시 사이트
(`news.lavx.hu`)가 섞였다. AIHOT(aihot.news)는 지난 24시간 AI 소식을 편집해 고른 목록을 익명으로
제공하고, 프로그램용 JSON API(`/api/v1/items`)를 따로 둔다.

## 설계

### 1. 소스: JSON API 사용 (Markdown 에이전트 엔드포인트 아님)

`GET https://aihot.news/api/v1/items?mode=selected&window=24h&limit=20`, User-Agent `aihot-api/2.0.0`.

- AIHOT 가이드가 "정기 동기화·푸시 프로그램은 Markdown 주소 말고 JSON 을 쓰라"고 명시
  (`/api/v1/agent` 본문 41행). OpenAPI 는 `/api/v1` 경로의 하위호환을 선언.
- 항목 필드(실측): `title`(중국어 편집 제목), `originalTitle`(**원문 언어 제목**), `summary`(중국어),
  `links.original`(원문 URL), `publishedAt`(ISO 8601 UTC), `category`, `selected`.
- 이 선택으로 사라지는 것: `［…资料开始/结束］` 경계 파싱, `回答提示` 제거, `MM-DD HH:MM`(연도 없음·UTC+8)
  시각 해석. 형식 변경 위험은 "필드 누락" 하나로 줄어든다.
- 라이선스: `/terms` 가 개인 비상업 자동화를 허용 범위로 명시. 하루 1회 호출(레이트리밋 약 60회/분).

### 2. 변환 — Tavily 결과와 같은 dict 로

| 기사 dict 키 | AIHOT 필드 |
|---|---|
| `title` | `originalTitle` (없거나 빈 값이면 항목 제외) |
| `url` | `links.original` (없으면 항목 제외) |
| `published_date` | `publishedAt` → KST `YYYY-MM-DD HH:MM` |
| `content` | `summary` (중국어 — 모델이 한국어로 옮긴다) |

제목이 원문 언어이므로 후보 목록에서 모델이 읽는 제목은 영어가 된다. 요약만 중국어다.

Tavily `published_date` 도 같은 KST `YYYY-MM-DD HH:MM` 로 정규화한다 — 두 소스의 시각 표기가 섞이면
job 프롬프트의 "발행일 최신 우선" 비교가 흔들린다.

### 3. 중국 원문 제외 — 원문 제목의 문자로 판정

`originalTitle` 에 한자(CJK 통합 한자 U+4E00–U+9FFF)가 있으면 제외한다. 도메인 블록리스트는 쓰지 않는다.
실측 8건에서 중국 원문은 `mp.weixin.qq.com` 1건이었고 그 `originalTitle` 이 중국어였다. 나머지 7건은
영어였다. 일본어 원문도 함께 빠질 수 있으나 의도와 어긋나지 않는다.

### 4. 후보 구성

| | 지금 | 바꾼 뒤 |
|---|---|---|
| Tavily `"AI LLM open source model release"` | 3건 | 제거 |
| Tavily `"OpenAI Anthropic Google AI model announcement"` | 3건 | 유지(영어권 시각) |
| AIHOT selected 24h | — | 필터 후 **최대 5건**(API 순서 그대로 앞에서부터) |

상한 5건: AIHOT 이 후보를 독점해 Tavily 시각이 사실상 사라지는 것을 막는다.

### 5. 스캐너 사전 선별 — 기존 Tavily 에도 적용 (근본 원인 위치)

hermes 는 스크립트 stdout 을 포함한 조립 프롬프트 전체에 strict 인젝션 스캐너를 건다
(`cron/scheduler.py:1191`, 패턴 `tools/cronjob_tools.py:67-76`). 한 건만 걸려도 **그날 브리핑 전체가
차단**된다(`scheduler.py:1365`, 스크립트 실패와 달리 모델 호출 자체가 없다). AI 보안 기사 제목에
"ignore previous instructions" 류 인용이 실릴 수 있어 AIHOT 추가로 노출이 늘지만, Tavily 도 같은 위험을
이미 갖고 있다.

- `format_article` 직후, 출력 직전의 한 지점에서 기사 텍스트에 hermes 의 위협 패턴을 돌려 걸리는 항목만
  뺀다. 소스와 무관하게 모든 후보가 지나는 자리라 Tavily 도 함께 보호된다.
- 패턴은 복사하지 않는다(두 벌이 되면 한쪽만 바뀜). `HERMES_HOME/hermes-agent` 를 `sys.path` 에 넣고
  hermes 의 스캐너 함수 `tools.cronjob_tools._scan_cron_prompt` 자체를 import 해 기사마다 호출한다
  (구현 시 변경: 스캐너가 위협 패턴 외에 유출 명령 패턴·전처리도 쓰므로 함수째 쓰는 쪽이 실제 차단과 같다).
- AIHOT 상한 5건은 이 선별 **뒤에** 자른다(구현 리뷰 반영: 먼저 자르면 걸린 자리를 뒤 후보로 못 채운다).
  import 가 실패하면 선별 없이 진행하고 출력 헤더에 `(인젝션 사전 선별 불가)` 를 남긴다 — 브리핑을
  막지 않되 사실은 드러낸다.

### 6. 실패 거동

| 상황 | 거동 |
|---|---|
| 네트워크·HTTP·타임아웃·JSON 디코드 오류, 그 외 예외 | AIHOT 호출만 `except Exception` 으로 격리. `(일부 검색 실패: AIHOT <예외명>)` 표기, Tavily 로 진행 |
| 200 인데 최상위 `items` 배열이 없음 (실측 최상위 키: `schemaVersion`·`query`·`page`·`items`) | 실패로 표기(`AIHOTSchemaChanged`) |
| 항목은 있으나 `originalTitle`·`links.original` 을 가진 항목이 0건 | 실패로 표기 — 필드명이 바뀐 경우를 "필터로 0건"과 구분 |
| 유효 항목은 있으나 한자 필터로 0건 | 정상. 후보 원장에 사유 기록 |
| 응답 본문 1MB 초과 | 읽기를 끊고 실패로 표기 |
| AIHOT 응답이 정상적으로 0건(조용한 날) | 정상 |
| `TAVILY_API_KEY` 없음 | AIHOT 은 그대로 수집(지금은 키가 없으면 전부 건너뜀) |

- 스크립트는 어떤 경우에도 exit 0. 다만 **5의 스캐너 차단 경로는 이 보장 밖**이었으므로 5가 그 대비다.
- AIHOT 타임아웃은 15초. 전체 스크립트 상한 120초(`scheduler.py:813`) 안에서 Tavily 5회 × 30초와
  겹치지 않게 짧게 둔다.

### 7. 후보 원장 — 일주일 뒤 판단용

hermes 는 성공 시 stderr 를 버린다(`scheduler.py:961-970`). 그래서 측정값은 파일로 남긴다.

- 매 실행 `HERMES_HOME/logs/morning-news-candidates.jsonl` 에 한 줄씩 append:
  `{date, source: "aihot"|"tavily", url, title, kept: bool, reason}`
  (`reason`: `cjk_title`·`no_original`·`over_cap`·`threat_pattern`·`duplicate`)
- 판단 시 발송된 브리핑(`~/.hermes/cron/output/91a2c90c75b8/*.md`)의 URL 과 대조한다.

### 8. 헤더 문구

`## 오늘 수집한 기사 후보 (Tavily news, 최근 3일)` → 소스가 둘이 되므로
`## 오늘 수집한 기사 후보 (Tavily news 최근 3일 · AIHOT 최근 24시간)`.

### 9. job 프롬프트 (`~/.hermes/cron/jobs.json`)

- 백업: `jobs.json.bak.20261006_before_aihot`
- `원문이 영어면 헤드라인과 요약을 한국어로 옮겨 쓴다.` → `원문이 영어·중국어면 …`
- 「기업 홍보성 링크」 규칙은 건드리지 않는다. AIHOT 후보에는 회사 공식 발표 원문(openai.com 등)이 많아
  해석이 회차마다 갈릴 수 있으나, 원장으로 실제 탈락 빈도를 본 뒤 결정한다.

## 범위 밖

- AIHOT 스킬 설치, `news-aggregator-skill` 도입, 다른 영역(한국 IT·경제) 변경.
- 영어로 쓰인 중국 기업 소식(Qwen·DeepSeek 영문 블로그 등) 제외 — 원문 제목이 영어면 통과.
- 기존 `collect_section` 의 좁은 except(`hermes-morning-news.py:169`, `RemoteDisconnected` 등 미포함) —
  Tavily 쪽 기존 결함. 이번 변경과 분리해 후속으로 남긴다.

## 검증

합격이 아닌 것: exit 0, 출력에 항목이 있음, AIHOT 후보가 보임. 이것들은 아래 실패 경로가 깨져 있어도
참이 된다.

1. 정상 실행 — `python3 scripts/hermes-morning-news.py`
   - AI 영역에 AIHOT 후보 ≤5건, 제목이 원문 언어, 링크가 원문 URL, 시각이 KST `YYYY-MM-DD HH:MM`
   - Tavily 시각도 같은 형식
   - 원장 jsonl 에 aihot·tavily 양쪽 줄과 `kept`/`reason` 이 기록됨
   - 당일 목록에 한자 원문 제목이 있으면 `cjk_title` 로 빠졌는지
2. 실패 경로 (각각 강제 후 실행, 다른 영역 정상·exit 0·실패 표기 확인)
   - 엔드포인트를 잘못된 호스트로 → 네트워크 실패 표기
   - 응답의 `originalTitle` 키 이름을 바꾼 샘플 주입 → `필터로 0건`이 아니라 **실패**로 표기
   - 항목 구조 키 제거 샘플 → `AIHOTSchemaChanged`
   - 제목에 `ignore all previous instructions` 를 넣은 가짜 항목 → 그 항목만 빠지고 원장 `threat_pattern`,
     최종 stdout 이 hermes `_scan_cron_prompt` 를 통과하는지 직접 호출로 확인
   - hermes import 경로를 깨뜨림 → `(인젝션 사전 선별 불가)` 표기
3. 자체검사 — 실측 응답 샘플(`items.json`)을 고정 입력으로 쓰는 assert 함수 하나:
   변환 결과, 한자 필터, 상한 5, 필드 누락 시 실패 판정. 별도 테스트 프레임워크는 붙이지 않는다.
4. 실제 발송 job 수동 실행은 하지 않는다(외부 메시지 발송). 첫 실측은 다음 날 08:00 정기 실행이고,
   그 출력과 원장을 함께 확인한다.

## 반영

1. 정본 수정 → `cp scripts/hermes-morning-news.py ~/.hermes/scripts/morning-news.py`
   (심볼릭 링크는 hermes 가 차단 — 스크립트 docstring 참조) → `diff` 로 동일 확인.
2. jobs.json 백업 후 한 줄 수정 → 다시 읽어 반영 확인.
3. 커밋·PR 은 사용자 요청 후.

## 일주일 뒤 판단 (2026-10-13)

원장과 발송 브리핑 URL 을 대조해 센다.

- **AIHOT 이 아니었으면 후보에 없었을 사건**(같은 날 Tavily 후보 URL·제목에 없는 것)이 브리핑 AI 3건에
  하루 평균 1건 이상 들어갔으면 유지. "AIHOT 출처가 뽑혔는가"만 세면 후보 구성상 거의 항상 참이라
  기준이 되지 못한다.
- 그렇지 않거나, 원장에서 AIHOT 실패·0건이 잦으면 AIHOT 호출을 빼고 Tavily 쿼리를 원복.
- 원장의 `cjk_title`·`threat_pattern` 건수로 필터가 실제로 일하는지 함께 본다.

## 변경 이력

- v1 → v2 (2026-10-06): Markdown `/agent/latest` 파싱 → JSON `/api/v1/items`. 도메인 블록리스트 →
  `originalTitle` 한자 판정. AIHOT 상한 5건. 시각 정규화 추가. 스캐너 사전 선별(모든 후보) 추가.
  stderr 측정 → 후보 원장 jsonl. 성공 기준을 "AIHOT 덕에 새로 들어온 사건"으로 교체. 예외 격리·응답 크기
  상한·필드 누락 실패 판정 추가.
