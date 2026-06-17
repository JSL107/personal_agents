# personal_agents (이대리)

Slack 기반 멀티 에이전트 업무 자동화 시스템 — 코드명 **이대리**.
GitHub / Notion / Postman / Slack 등을 연결해 PM · BE · Code Reviewer · Work Reviewer 역할을 수행하는 개인 비서형 백엔드.
자동화 규칙은 [AGENTS.md](./AGENTS.md), 코드 컨벤션은 [CODE_RULES.md](./CODE_RULES.md) 참고.

## 현재 상태

- ✅ NestJS + DDD/Hexagonal 기반 골격 (`common/`, `config/`, `prisma/`)
- ✅ Prisma + PostgreSQL 영속성 계층 (`AgentRun`, `EvidenceRecord` 모델)
- ✅ Slack Bolt 어댑터 (`src/slack/`) — Socket Mode, 10개 이상의 슬래시 커맨드 및 Interactive 버튼 대응
- ✅ Model Router (`src/model-router/`) — CodexCliProvider (ChatGPT) / ClaudeCliProvider (Claude) + 자동 격리 실행
- ✅ AgentRun 라이프사이클 (`src/agent-run/`) — 실행 기록 및 EvidenceRecord 자동 추적
- ✅ GitHub 커넥터 (`src/github/`) — Octokit 기반 Read/Write (Issue 코멘트 작성 지원)
- ✅ Slack collector (`src/slack-collector/`) — 본인 멘션 24h 수집
- ✅ Notion 커넥터 (`src/notion/`) — Read/Write 지원, Daily Plan 자동 기록 (Append) 기능
- ✅ PM Agent (`src/agent/pm/`) — `/today`. 5종 컨텍스트 자동 수집 및 Notion/GitHub 동기화
- ✅ Work Reviewer (`src/agent/work-reviewer/`) — `/worklog`. 정량 근거 기반 회고 및 Notion 기록
- ✅ Code Reviewer (`src/agent/code-reviewer/`) — `/review-pr`. Claude 기반 심층 리뷰
- ✅ BE 에이전트 (`src/agent/be/`) — `/plan-task`. 구현 계획 및 API 설계 생성
- ✅ PO Shadow (`src/agent/po-shadow/`) — `/po-shadow`. 계획의 비즈니스 가치 및 리스크 재검토
- ✅ Impact Reporter (`src/agent/impact-reporter/`) — `/impact-report`. 작업 성과 보고서 자동화
- ✅ Preview Gate (`src/preview-gate/`) — 외부 시스템 전송 전 사용자 승인(✅/❌) 공통 처리
- ✅ Router (`src/router/`) — V3 비전 Hierarchical Manager Pattern. 자연어 멘션 (`@이대리 ...`) + DM (`message.im`) → intent classifier (자연어→AgentType) → 15 worker dispatcher → handoff chain (audit via `AgentRun.parentId`)
- ✅ V3 phase loop 워커 — CTO (`/assign`) / PO_EVAL (`/po-eval`) / CEO (`/ceo-review`) + `/auto-flow` chain + AgentRun chain audit walk (`findChainFromRoot`)
- ✅ careerLog → Notion 적재 (`PoEvalCareerlogApplier`, PreviewGate 게이트), `/impact-report --recent <N>d` 다중 PR 종합 (env 활성)
- ✅ Conversation Memory (`src/router/application/conversation-memory.service.ts`) — Redis 우선 / in-memory Map fallback. 사용자+채널당 최대 5 turn, TTL 30분
- ✅ GitHub Webhook 자동 트리거 (`src/webhook/`) — `issues.opened` / `pull_request.opened` → Impact Reporter, `pull_request.opened` → BE-FIX + (조건부) code-reviewer, `check_run.completed` (failure) → BE-SRE, `pull_request.closed` (merged=true) → PR careerLog Notion 자동 적재, `issues.opened` → Issue Auto-Label (vocab 안 LLM 분류)
- ✅ **Autopilot 자동화** (`src/autopilot/`) — 수동 슬래시 → 자동 proactive 전환. 선언적 "워크데이 플레이북" + 얇은 오케스트레이터가 출근(아침 PM 계획) / 퇴근(PO_EVAL 회고 + 오늘 plan 기반 worklog 한 건) / 주간(Weekly·CEO·Impact) cron 을 단일 엔진으로 통합. **리스크 티어**(읽기·요약은 자동 발송 T0 / 비가역 외부쓰기는 PreviewGate T1), **다중 타깃**(콤마 fan-out), **digest 그룹**(같은 시각 여러 작업 → 한 메시지). 전체 게이트 `AUTOPILOT_OWNER_SLACK_USER_ID`, 멱등(그룹·일자당 1회) + 활동 0이면 skip
- ✅ Notification (`src/notification/`) — Producer/Consumer 분리 (BullMQ `notification` queue). claude CLI 인증 의심 침묵 실패 + cron 실패 owner DM (30분 dedupe per kind)
- ✅ PR careerLog 자동 적재 (`src/pr-careerlog/`) — 본인 PR 머지 시 Notion 부모 페이지 아래 일별 자식 페이지 (`YYYY-MM-DD (요일)`) 에 자동 누적
- ✅ Issue Auto-Label (`src/agent/issue-labeler/`) — `issues.opened` 시 repo 의 기존 label vocab 안에서 LLM 분류 → octokit `addLabels` (새 label 생성 X, 5개 cap)
- ✅ Pushpin Task (`src/pushpin-task/`) — Slack 메시지에 📌 reaction → Notion 일별 페이지에 to-do 자동 적재 (Slack permalink 포함)
- ✅ `/search-runs` (`src/agent-run/application/search-agent-runs.usecase.ts`) — SUCCEEDED AgentRun 의 input/output 본문 ILIKE 키워드 검색
- ✅ Vacation (`src/agent/vacation/`) — `/휴가`. 입사일 기반 연차 발생/잔여 결정론 계산 + 사용 등록/내역/취소 (반차 0.5일 지원, LLM 미사용 — 자연어 멘션 시 파라미터 추출에만 ChatGPT)
- ✅ BLOG 릴레이 (`src/agent/blog/`) — 자연어 멘션 전용 (`@이대리 ... 블로그 써줘`). `BlogDispatcher` → `GenerateBlogDraftUsecase` → `hermes -z` 로 Hermes `tistory-blog` 스킬 spawn (route() 미경유, 외부 CLI). 리서치 → Notion '블로그 초안' DB 적재 → Slack DM 링크 회신
- ✅ 크롤러 도메인 (`src/crawler/`) — BullMQ + Puppeteer 기반 아키텍처
- ⏳ 장기 기억 (Long-term memory), 토론 모드 — 개발 중


## 아키텍처

```
src/
  {domain}/
    domain/          # 엔티티, Port 인터페이스, 도메인 예외/검증
    application/     # 유스케이스
    infrastructure/  # Port 어댑터 (DB, 큐, 외부 API 클라이언트)
    interface/       # Controller, DTO, 큐 Provider
  common/            # 공통 응답/예외/필터/인터셉터
  config/            # 환경변수 검증
  prisma/            # PrismaService, PrismaModule (Global)
prisma/
  schema.prisma      # Prisma 스키마 (DB 단일 소스)
```

상세 컨벤션은 [`CODE_RULES.md`](./CODE_RULES.md).

## 사전 요구사항

- Node.js 20+
- pnpm 9+
- Docker (로컬 PostgreSQL + Redis 컨테이너)
- **`codex` CLI** (로그인 완료) — PM / Work Reviewer 에이전트가 ChatGPT Plus 구독 쿼터로 호출. ModelRouter 의 `CodexCliProvider` 가 `codex exec` 를 spawn.
- **`claude` CLI** (로그인 완료) — Code Reviewer / BE 에이전트가 Claude Max 구독 쿼터로 호출. `ClaudeCliProvider` 가 `claude -p --output-format json` 을 spawn.
- 두 CLI 모두 prompt-injection 방지를 위해 빈 임시 디렉토리 + env allowlist(`PATH`/`HOME`/`CODEX_HOME`/`CLAUDE_HOME` 등)로 격리해 실행한다 (`src/model-router/infrastructure/cli-process.util.ts`).

## 처음 실행

```bash
pnpm install               # @prisma/client postinstall 이 schema 만으로 Prisma Client 생성 (DATABASE_URL 불필요)
cp .env.example .env       # 앱 부팅·db:push·db:studio 에 필요

pnpm db:up                 # PostgreSQL + Redis 컨테이너 기동 (--wait 로 healthy 까지 대기)
pnpm db:push               # 스키마 동기화 (synchronize 방식, 마이그레이션 파일 미생성)

pnpm dev                   # watch 모드로 NestJS 기동
```

> `DATABASE_URL` 은 **앱 부팅 시점에 `config/app.config.ts` 가 class-validator 로 강제**합니다. `pnpm install` 자체(`prisma generate`)는 schema 파싱만 하므로 `DATABASE_URL` 없이도 성공합니다. 실제 DB 연결은 PrismaService 의 lazy connect 로 처리되어, DB 가 일시적으로 다운돼도 앱은 기동되며 첫 쿼리 시점에서 에러가 드러납니다.

## 일상 명령

```bash
pnpm dev                   # 개발 watch 모드
pnpm start                 # 일반 실행
pnpm start:prod            # 프로덕션 빌드 산출물 실행

pnpm db:up                 # 로컬 DB/Redis 기동
pnpm db:down               # 로컬 DB/Redis 종료
pnpm db:push               # 스키마 변경 후 DB 즉시 반영 (synchronize 방식)
pnpm db:studio             # Prisma Studio (브라우저 DB 뷰어)
```

## 검증

```bash
pnpm build                 # nest build
pnpm test                  # jest 단위 테스트
pnpm test:e2e              # e2e 테스트
pnpm lint                  # ESLint --fix
pnpm lint:check            # ESLint 검사 only
pnpm format:check          # Prettier 검사
```

## DB 변경 워크플로우

> 현재 단계는 **synchronize 방식 (`prisma db push`)** — 마이그레이션 파일을 만들지 않고 스키마를 직접 DB에 반영한다. 프로덕션 운영 시작 전에 `prisma migrate dev` 워크플로우로 전환할 예정.

1. `prisma/schema.prisma` 수정
2. `pnpm db:push` — DB에 스키마 반영 + Prisma Client 자동 재생성
3. 앱 재시작

## 환경변수

> 단일 source-of-truth 는 [`src/config/app.config.ts`](src/config/app.config.ts) 의 `EnvironmentVariables` (class-validator 강제). 아래 표는 가장 자주 만지는 키만 발췌 — cron / webhook / careerLog / impact-report 세부 옵션은 해당 파일의 주석을 참조.

### 인프라 (앱 부팅 필수)

| 키 | 필수 | 설명 |
|---|---|---|
| `PORT` | ❌ | HTTP 서버 포트 (기본 3002 권장) |
| `REDIS_HOST` / `REDIS_PORT` | ✅ | BullMQ + Router conversation memory (6381) |
| `DATABASE_URL` | ✅ | PostgreSQL 연결 문자열 (5434) |

### Slack / 외부 커넥터 (선택)

| 키 | 필수 | 설명 |
|---|---|---|
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` / `SLACK_SIGNING_SECRET` | ⭕ | Slack 봇 기동용 (Socket Mode). 3개 모두 있어야 SlackService 활성 |
| `GITHUB_TOKEN` | ⭕ | GitHub PAT (Classic). 미설정 시 GitHub 연동 기능 skip |
| `NOTION_TOKEN` / `NOTION_TASK_DB_IDS` | ⭕ | Notion API 토큰 및 수집 대상 DB ID 리스트 |
| `NOTION_DAILY_PLAN_DATABASE_ID` | ⭕ | 일일 회고/계획을 자동 기록할 Notion DB ID |
| `CLAUDE_MODEL` | ❌ | Claude 에이전트 모델 (기본: `opus`, 옵션: `sonnet`, `haiku`) |

### Webhook 자동 트리거 (선택)

| 키 | 필수 | 설명 |
|---|---|---|
| `WEBHOOK_SECRET` | ⭕ | 자체 포맷 `/v1/agent/trigger` HMAC-SHA256 키. 미설정 시 모든 요청 거부 |
| `GITHUB_WEBHOOK_SECRET` | ⭕ | GitHub 표준 `/v1/agent/github` HMAC-SHA256 키. 미설정 시 모든 요청 거부 |
| `GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID` | ⭕ | GitHub payload 에는 Slack user 가 없으므로 자동 발화(impact-report / BE-FIX / BE-SRE)의 사용자 컨텍스트 매핑. 미설정 시 200 OK 만 응답하고 자동 발화 skip |
| `GITHUB_WEBHOOK_OWNER_LOGIN` | ⭕ | `pull_request.opened` 자동 code-reviewer + `pull_request.closed (merged=true)` PR careerLog 가드. payload `pull_request.user.login` 일치 + bot 제외 시에만 발화 |
| `GITHUB_ISSUE_AUTO_LABEL_ENABLED` | ❌ | `true` 일 때만 `issues.opened` → Issue Auto-Label 활성. default off |
| `GITHUB_ISSUE_AUTO_LABEL_REPOS` | ❌ | 콤마 구분 "owner/repo" allowlist. 빈 값/미설정 → 모든 repo 적용 |
| `PR_CAREERLOG_AUTO_ENABLED` | ❌ | `true` 일 때만 `pull_request.closed (merged=true)` → Notion careerLog 자동 적재 활성 (`CAREER_LOG_NOTION_PAGE_ID` + `GITHUB_WEBHOOK_OWNER_LOGIN` 동시 set 필요) |

### Cron 자동 발화 (env 미설정 = 해당 cron 비활성)

| 키 | 필수 | 설명 |
|---|---|---|
| `AUTOPILOT_OWNER_SLACK_USER_ID` | ⭕ | **Autopilot 워크데이 플레이북 전체 게이트** — 모든 자동 cron(출근/퇴근/주간)이 이 한 값으로 활성. 미설정 시 전체 비활성(graceful). |
| `AUTOPILOT_TARGET` | ❌ | 발송 대상 — 슬랙 user(`U...`)/channel(`C.../G...`) ID, **콤마로 다중 발송**. 미설정 시 owner DM. |
| `AUTOPILOT_<ID>_SCHEDULE` / `_TIMEZONE` | ❌ | 항목별 cron/타임존 override. ID: `DAILY_EVAL`(19:00)·`MORNING_BRIEFING`(08:30)·`WEEKLY_SUMMARY`(금 17:00)·`CEO_META`(월 09:00)·`IMPACT_REPORT`(토 09:00). 미설정 시 플레이북 기본값. |

> 구 `DAILY_EVAL_*`·`MORNING_BRIEFING_*`·`WEEKLY_SUMMARY_*`·`CEO_META_CRON_*`·`IMPACT_REPORT_RECENT_*`(owner/target/cron/tz)은 Autopilot 으로 흡수됨 — `AUTOPILOT_OWNER_SLACK_USER_ID` + `AUTOPILOT_TARGET` 로 일원화. impact 의 task 고유 config(`IMPACT_REPORT_GITHUB_AUTHOR`, `_GITHUB_REPO`, `_DAYS`)는 그대로 유지.

### 운영 알람 / careerLog / 다중 PR (선택)

| 키 | 필수 | 설명 |
|---|---|---|
| `CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID` | ⭕ | claude CLI 인증 만료 / 쿼터 소진 침묵 실패 감지 시 owner 에게 DM (30분 dedupe). 미설정 시 stdout warn 만 |
| `CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID` | ⭕ | Daily Eval / Impact Report Cron / CEO Meta Cron 등 cron consumer 가 throw 직전 owner DM (cron 별 30분 dedupe). 미설정 시 stdout warn 만 |
| `CAREER_LOG_NOTION_PAGE_ID` | ⭕ | `/po-eval` 결과의 "✅ 적용" 버튼 + `pull_request.closed (merged=true)` 자동 PR careerLog 의 적재 대상 Notion 페이지. 미설정 시 버튼 미부착 + PR careerLog 자동 skip |
| `IMPACT_REPORT_GITHUB_AUTHOR` | ⭕ | `/impact-report --recent <N>d` 의 GitHub username (필수: recent mode 핵심) |
| `IMPACT_REPORT_GITHUB_REPO` | ❌ | `owner/repo` 스코프. 미설정 시 author 의 모든 repo 머지 PR (글로벌 모드) |
| `STALE_DATA_CUTOFF_DAYS` | ❌ | GitHub assigned / Notion task 의 cutoff (기본 60일) |
| `VACATION_HIRE_DATE` | ❌ | `/휴가` 명령 사용자 입사일 (YYYY-MM-DD). 미설정 시 `/휴가` 명령에서 친절한 에러 안내. 1인 봇 단일값 (향후 멀티 사용자 시 테이블로 승격) |
| `SLACK_INBOX_EMOJI` | ❌ | Reaction → Inbox 큐잉 트리거 이모지 (기본 `raised_hand`) |
| `SLACK_PUSHPIN_REACTION_EMOJI` | ❌ | 📌 → Notion task 트리거 이모지 (기본 `pushpin`). `SLACK_INBOX_EMOJI` 와 다른 값 권장 |
| `SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID` | ⭕ | 📌 → Notion task 적재 부모 페이지. 미설정 시 service 가 graceful skip. `CAREER_LOG_NOTION_PAGE_ID` 와 동일 페이지 공유해도 OK (일별 자식 페이지 공통 key) |

> Model fallback chain — Claude primary 실패 시 ChatGPT (Codex CLI) 로 자동 재시도. ChatGPT primary (PM / WorkReviewer / ImpactReporter / PoShadow) 는 primary == fallback 이라 재시도 없이 즉시 COMPLETION_FAILED. (이전 Gemini fallback 은 사용자 미구독 정책으로 2026-06-04 제거됨.)

> 설치와 `.env` 생성 순서는 서로 독립적입니다. `pnpm install` 은 DATABASE_URL 없이도 성공하지만, `pnpm dev` / `pnpm db:push` 이전에는 반드시 `.env` 가 준비돼야 합니다.

## 주요 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| POST | `/v1/crawl-jobs` | 크롤링 작업 큐 등록 |
| POST | `/v1/agent/trigger` | 자체 포맷 webhook 진입 — HMAC-SHA256 (`WEBHOOK_SECRET`) 검증 후 지정 에이전트 발화 |
| POST | `/v1/agent/github` | GitHub 표준 webhook 진입 — `X-Hub-Signature-256` (`GITHUB_WEBHOOK_SECRET`) 검증 후 아래 표대로 자동 발화 |

### GitHub Webhook 자동 트리거

`/v1/agent/github` 에 GitHub App / repo webhook 을 붙이면 다음 이벤트가 사용자 입력 없이 자동 발화된다 (사용자 컨텍스트는 `GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID` 로 매핑).

| GitHub 이벤트 | 발화 에이전트 | 설명 | 추가 활성화 env |
|---|---|---|---|
| `issues.opened` | Impact Reporter | 새 이슈 본문 기반 임팩트 보고서 자동 생성 | — |
| `issues.opened` | Issue Auto-Label | repo 의 기존 label vocab 안에서 LLM 분류 → `addLabels` (새 label 생성 X) | `GITHUB_ISSUE_AUTO_LABEL_ENABLED=true` (+ 선택 `GITHUB_ISSUE_AUTO_LABEL_REPOS`) |
| `pull_request.opened` | Impact Reporter | 새 PR diff 기반 임팩트 보고서 자동 생성 | — |
| `pull_request.opened` | BE-FIX | PR 컨벤션 분석 (네이밍/파일 구조/테스트 누락 등) 자동 | — |
| `pull_request.opened` | Code Reviewer (조건부) | 본인 PR (owner login 일치 + bot 제외) 만 자동 `/review-pr` → owner DM | `GITHUB_WEBHOOK_OWNER_LOGIN` |
| `pull_request.closed` (merged=true) | PR careerLog | 본인 머지 PR 메타 (title / body / additions / deletions / files) 를 Notion 일별 자식 페이지에 자동 적재 (LLM 호출 X) | `PR_CAREERLOG_AUTO_ENABLED=true` + `CAREER_LOG_NOTION_PAGE_ID` + `GITHUB_WEBHOOK_OWNER_LOGIN` |
| `check_run.completed` (conclusion=failure) | BE-SRE | CI 실패 로그 → stack trace 분석 자동 | — |

> `GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID` 미설정 시 webhook 은 200 OK 만 반환하고 자동 발화는 모두 skip — graceful.

## Slack 슬래시 커맨드

| Command | 설명 | 에이전트 / 모델 |
|---|---|---|
| `/today` | 오늘 할 일 계획 생성 (자동 수집 + Notion 기록) | PM Agent / ChatGPT |
| `/worklog` | 오늘 한 일 회고 (정량 근거 + Notion 기록) | Work Reviewer / ChatGPT |
| `/po-shadow` | 직전 계획에 대한 PO 시점의 재검토 및 리스크 분석 | PO Shadow / ChatGPT |
| `/impact-report` | PR 1건 또는 작업 설명 → 단일 임팩트 보고서. `--recent <N>d` (env 활성 시) 는 최근 N일 머지 PR 자동 종합 | Impact Reporter / ChatGPT |
| `/sync-plan` | 생성된 계획을 외부(GitHub/Notion)로 전송 (승인 게이트) | PM-2 / (System) |
| `/sync-context` | 외부 컨텍스트(GitHub/Notion/Slack) 강제 재수집 | — |
| `/quota` | 본인의 에이전트 사용량 통계 확인 | — |
| `/ping` | 봇 헬스체크 (Socket Mode 연결 확인 — 즉시 pong 응답) | — |
| `/review-pr` | GitHub PR 심층 리뷰 (Must-fix 등 도출) | Code Reviewer / Claude |
| `/be plan` | 백엔드 구현 계획 및 API 설계 생성 | BE Agent / Claude |
| `/be schema` | 자연어 DB 변경 요청을 Prisma 스키마 제안으로 변환 (V3 BE-3) | BE Schema / Claude |
| `/be test` | Tree-sitter AST 기반 Jest spec 생성 (V3 BE-2) | BE Test / Claude |
| `/retry-run` | FAILED 된 AgentRun 을 본인 입력으로 재실행 (OPS-5) | (선행 run 의 agent) |
| `/search-runs` | SUCCEEDED AgentRun 의 input/output 본문에서 키워드 ILIKE 검색 → 최신 5건 | — |
| `/review-feedback` | 직전 PR 리뷰의 accept / reject 학습 데이터 저장 (QA-1) | — |
| `/assign` | 직전 PM plan 의 `assignableTaskIds` 를 BE worker 3종으로 자동 분배 (V3 P2) | CTO / Claude |
| `/po-eval` | Work Reviewer / PO Shadow / Impact Reporter 직전 snapshot 합성 + 이력서용 careerLog (V3 P4) | PO_EVAL / Claude |
| `/ceo-review` | 직전 PO_EVAL + PM/CTO snapshot 합성 → contextDrift / docsQuality / finalSummary (V3 P5 minimal) | CEO / Claude |
| `/auto-flow` | PM → CTO → BE chain 자동 진행 (각 step 사이 사용자 confirm 안전판) — V3 비전 phase loop chain | PM + CTO + BE worker |
| `/휴가` | 연차 발생/잔여 계산 + 사용 등록/내역/취소 (입사일 기반 결정론적 계산, LLM 미사용) | — (결정론) |

> 백엔드 사용자-트리거 에이전트 3종은 `/be <subcommand>` 단일 진입점으로 통합돼 있다. 인자 없이 `/be` 만 입력하면 사용법이 노출된다.
> **BE-SRE (V3 BE-1) / BE-FIX (V3 BE-4)** 는 GitHub webhook (`check_run.completed` failure / `pull_request.opened`) 으로 **자동 트리거**되며, 수동 재실행은 `/retry-run <AgentRun ID>` 를 사용한다.

### 자연어 멘션 진입 (V3 Router)

슬래시 외에 **`@이대리 ...`** 형태로 자연어 메시지를 보내면 `IdaeriRouterUsecase` 가 intent classifier (1 LLM call) 로 worker 를 분류해 위 15 에이전트 (PM/Work Reviewer/Code Reviewer/Impact Reporter/PO Shadow/BE/BE_SCHEMA/BE_TEST/BE_SRE/BE_FIX + V3 CTO/PO_EVAL/CEO + VACATION/BLOG) 중 1개로 dispatch. 처리 결과는 thread 답글로 worker formatter 결과 + `agentRunId` 푸터. 자세한 동작 흐름은 [`docs/superpowers/plans/2026-05-27-router-step-1-to-8-impl-notes.md`](./docs/superpowers/plans/2026-05-27-router-step-1-to-8-impl-notes.md).

> **BLOG 는 자연어 멘션 전용** — 슬래시가 없고, `IdaeriRouterUsecase` 가 분류하면 `BlogDispatcher` 가 ModelRouter `route()` 를 거치지 않고 `hermes -z` (Hermes `tistory-blog` 스킬) 를 직접 spawn 한다 (`AGENT_TO_PROVIDER` 의 BLOG 엔트리는 exhaustive 타입 충족용 sentinel). **VACATION 도 자연어 멘션** (`@이대리 연차 며칠 남았어?`) 으로 진입하면 LLM 으로 파라미터만 추출하고 잔여 계산 자체는 결정론.

**자연어 multi-turn 메모리** — 같은 채널/DM 의 사용자별 대화 컨텍스트가 최대 5 turn / TTL 30분 보존. **Redis 백엔드** (REDIS_HOST/REDIS_PORT) 사용 — multi-instance / 재시작 안전. Redis 미주입 또는 read/write 실패 시 in-memory Map 으로 graceful fallback. 지시대명사 ("그거 분배해") 가 직전 worker run 을 자동 참조해 자연어 chain 가능 (예: `@이대리 오늘 plan?` → `@이대리 그거 분배해` → CTO 가 직전 PM run 참조).

### Slack 봇 설정 (최초 1회)

1. https://api.slack.com/apps 에서 앱 생성
2. **Socket Mode** 활성화 → App-Level Token 발급 (scope: `connections:write`) → `SLACK_APP_TOKEN`
3. **OAuth & Permissions** → Bot Token Scopes: `commands`, `chat:write` → 워크스페이스에 install → Bot User OAuth Token → `SLACK_BOT_TOKEN`
4. **Basic Information** → Signing Secret → `SLACK_SIGNING_SECRET`
5. **Slash Commands** → 아래 18개 등록 (Request URL 은 Socket Mode 라 불필요하지만 UI 가 요구하면 `https://example.com/command` 같은 더미 값 입력):
   - `/today` — 오늘 할 일 우선순위 정리 (Usage hint: `<오늘 할 일을 자유롭게 적어주세요>`)
   - `/worklog` — 오늘 한 일 회고 (Usage hint: `<오늘 한 일을 자유롭게 적어주세요>`)
   - `/review-pr` — PR 리뷰 (Usage hint: `<PR URL 또는 owner/repo#번호>`)
   - `/po-shadow` — 계획 재검토 (Usage hint: `[선택] 추가 컨텍스트`)
   - `/be` — 백엔드 3종 사용자-트리거 에이전트 통합 진입점 (Usage hint: `plan|schema|test <인자>`) — SRE/FIX 는 webhook 자동 트리거
   - `/impact-report` — 임팩트 보고서 (Usage hint: `<작업 설명 또는 PR URL>`)
   - `/sync-plan` — 외부 시스템 동기화 (Preview Gate 연동)
   - `/sync-context` — 외부 컨텍스트 강제 재수집
   - `/quota` — 사용량 통계 확인 (Usage hint: `[today|week]`)
   - `/ping` — 봇 헬스체크 (Socket Mode 연결 확인, Usage hint 불필요)
   - `/retry-run` — FAILED AgentRun 재실행 (Usage hint: `<AgentRun ID>`)
   - `/search-runs` — SUCCEEDED AgentRun input/output ILIKE 검색 (Usage hint: `<키워드>`)
   - `/review-feedback` — PR 리뷰 accept/reject 피드백 저장 (Usage hint: `<AgentRun ID> accept|reject [이유]`)
   - `/assign` — 직전 PM plan 의 task 를 BE worker 로 자동 분배 (V3 P2 CTO worker)
   - `/po-eval` — Work Reviewer / PO Shadow / Impact Reporter 합성 + 이력서 careerLog (V3 P4) (Usage hint: `[today|week]`)
   - `/ceo-review` — 직전 PO_EVAL + PM/CTO 합성 → drift/docs review (V3 P5 minimal) (Usage hint: `[today|week]`)
   - `/auto-flow` — PM → CTO → BE chain 자동 (각 step 사용자 confirm 안전판) — V3 phase loop chain (Usage hint: `[선택] 오늘 할 일 자유 텍스트`)
   - `/휴가` — 연차 발생/잔여 계산 + 사용 등록/내역/취소 (Usage hint: `[등록|취소|내역|잔여] [날짜]`) ※ 한글 슬래시 커맨드 — Slack 앱 설정에서 `/휴가` 그대로 등록
   > 또는 좌측 **`App Manifest`** 에서 `slash_commands` 배열에 위 커맨드들을 선언하고 **Save Changes** → **Reinstall your app** 으로 반영.
6. **Event Subscriptions** → Enable → Subscribe to Bot Events 에 **`app_mention`** + **`message.im`** 추가 + **OAuth & Permissions** 의 Bot Token Scopes 에 **`app_mentions:read`** + **`im:history`** 추가 → Reinstall.
   - `app_mention` + `app_mentions:read` → 채널에서 `@이대리 ...` 자연어 진입.
   - `message.im` + `im:history` → 봇과의 DM 1:1 자연어 진입.
   - 둘 다 Router (IdaeriRouterUsecase) 로 위임됨. DM 만 필요하면 `message.im` 만, 채널 멘션만 필요하면 `app_mention` 만 활성화해도 됨.
7. `.env` 에 세 값 채운 뒤 `pnpm dev` 재기동 → `이대리 Slack 봇이 Socket Mode 로 기동되었습니다.` 로그 확인
8. Slack 채널에서 `/today` 또는 `/be` 입력해 봇 응답 확인. 추가로 봇을 채널에 초대 후 `@이대리 오늘 plan 짜줘` 형태로 자연어 멘션 + 봇 DM 으로 `오늘 plan 짜줘` 직접 보내 자연어 진입 둘 다 작동하는지 검증

### 자동화 cron (사용자 환경 env 설정 시 활성)

**Autopilot 워크데이 플레이북** (`src/autopilot/`) — 모든 cron 이 단일 엔진/플레이북으로 통합. `AUTOPILOT_OWNER_SLACK_USER_ID` 한 값으로 전체 활성, 미설정 시 비활성(graceful). 같은 그룹(예: 퇴근)은 한 메시지로 묶여 발송(digest), 활동 0이면 skip.

| 그룹 | 항목 | 시간 (KST) | 동작 |
|---|---|---|---|
| 출근 (morning) | Morning Briefing | 매일 08:30 | PM `/today` 자동 계획 + Slack. 자동 컨텍스트 없으면 안내. |
| 퇴근 (evening) | Daily Eval + Work Reviewer | 매일 19:00 | PO_EVAL(TODAY) 회고 + 오늘 plan 기반 worklog 를 **한 메시지로** 발송. 대상 부재 시 graceful skip. |
| 주간 | Weekly Summary | 매주 금 17:00 | Worklog(1주) + CEO meta(WEEK). |
| 주간 | CEO Meta | 매주 월 09:00 | CEO meta 종합. PO_EVAL 부재 시 graceful skip. |
| 주간 | Impact Report | 매주 토 09:00 | `/impact-report --recent <N>d`(default 7) — 본인 머지 PR 종합. 0건 시 skip. (+ `IMPACT_REPORT_GITHUB_AUTHOR`) |

세부 스케줄/타임존 override 는 `AUTOPILOT_<ID>_SCHEDULE`/`_TIMEZONE`, 플레이북 선언은 [`src/autopilot/domain/autopilot.playbook.ts`](src/autopilot/domain/autopilot.playbook.ts), env 검증은 [`src/config/app.config.ts`](src/config/app.config.ts) 참조.

### 선택 외부 적재 (env 설정 시 활성)

| 통합 | 트리거 | 동작 | 활성화 env |
|---|---|---|---|
| **careerLog → Notion (수동)** | `/po-eval` 결과 화면의 "✅ 적용" 버튼 (30분 안) | PreviewGate 경유 → 지정 Notion 페이지에 careerLog heading + 성과 bullet + 기술 스택 + impact append. 사용자 confirm 후만 부작용 발생. | `CAREER_LOG_NOTION_PAGE_ID` |
| **PR careerLog → Notion (자동)** | `pull_request.closed` webhook (`merged=true` + owner 본인 PR + bot 제외) | LLM 호출 X. 부모 페이지 아래 일별 자식 페이지 (`YYYY-MM-DD (요일)`) 를 찾거나 만들고 PR 메타 (title / body / additions / deletions / changedFiles) 를 careerLog block 으로 append. BullMQ jobId dedup. | `PR_CAREERLOG_AUTO_ENABLED=true` + `CAREER_LOG_NOTION_PAGE_ID` + `GITHUB_WEBHOOK_OWNER_LOGIN` |
| **📌 reaction → Notion to-do** | Slack 메시지에 📌 (default `pushpin`) reaction | LLM 호출 X. 부모 페이지 아래 일별 자식 페이지에 todo block append + Slack permalink 부착. | `SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID` (+ 선택 `SLACK_PUSHPIN_REACTION_EMOJI`) |
| **Issue Auto-Label** | `issues.opened` webhook | repo 의 기존 label vocab (`listLabelsForRepo`) 조회 → LLM 분류 → `addLabels` (vocab 안 + 5개 cap). 새 label 생성 X. | `GITHUB_ISSUE_AUTO_LABEL_ENABLED=true` (+ 선택 `GITHUB_ISSUE_AUTO_LABEL_REPOS`) |
| **`/impact-report --recent <N>d`** | `/impact-report --recent 7d` (또는 임의 N=1~365) | 지정 author 의 최근 N일 머지 PR 을 GitHub 에서 자동 fetch (최대 20건) → 정량 합산 (PR수 / +LOC / -LOC / files) + body summary 종합 → ImpactReport 생성. `REPO` 미설정 시 author 의 **모든 repo** 머지 PR (본인 작성, fork merge 포함). | `IMPACT_REPORT_GITHUB_AUTHOR` (필수) + `IMPACT_REPORT_GITHUB_REPO` (선택) |

- `CAREER_LOG_NOTION_PAGE_ID` 미설정 → `/po-eval` 응답은 기존 텍스트만 (버튼 미부착), PR careerLog 자동 적재도 skip.
- `IMPACT_REPORT_GITHUB_AUTHOR` 미설정 → `/impact-report --recent ...` 만 `RECENT_MODE_ENV_MISSING` 으로 거절 (기존 단일 PR / 자유 텍스트 모드 영향 없음). `IMPACT_REPORT_GITHUB_REPO` 는 선택 — 미설정 시 author 모든 repo 글로벌 모드.
- `SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID` 와 `CAREER_LOG_NOTION_PAGE_ID` 는 동일 페이지 공유 가능 — 같은 날짜 자식 페이지에 PR careerLog (정량/정성 분리) + 📌 to-do 가 같이 누적된다.
- `GITHUB_ISSUE_AUTO_LABEL_ENABLED=true` + `GITHUB_TOKEN` 이 `Issues: Read+Write` scope 보유해야 동작. allowlist 미설정 → owner 모든 repo 적용.

## 참고 문서

- [자동화 규칙 (AGENTS.md)](./AGENTS.md)
- [코드 규칙](./CODE_RULES.md)
- [과거 설계/기획 (archive)](./docs/archive/)
