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
- ✅ Morning Briefing (`src/morning-briefing/`) — BullMQ 스케줄러 기반의 매일 아침 자동 브리핑
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

| 키 | 필수 | 설명 |
|---|---|---|
| `PORT` | ❌ | HTTP 서버 포트 (기본 3002 권장) |
| `REDIS_HOST` / `REDIS_PORT` | ✅ | BullMQ 연결용 Redis 정보 (6381) |
| `DATABASE_URL` | ✅ | PostgreSQL 연결 문자열 (5434) |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` / `SLACK_SIGNING_SECRET` | ⭕ | Slack 봇 기동용 (Socket Mode 대응) |
| `GITHUB_TOKEN` | ⭕ | GitHub PAT (Classic). 미설정 시 GitHub 연동 기능 skip |
| `NOTION_TOKEN` / `NOTION_TASK_DB_IDS` | ⭕ | Notion API 토큰 및 수집 대상 DB ID 리스트 |
| `NOTION_DAILY_PLAN_DATABASE_ID` | ⭕ | **[V2]** 일일 회고/계획을 자동 기록할 Notion DB ID |
| `CLAUDE_MODEL` | ❌ | Claude 에이전트가 사용할 모델 (기본: `opus`, 옵션: `sonnet`, `haiku`) |


> 설치와 `.env` 생성 순서는 서로 독립적입니다. `pnpm install` 은 DATABASE_URL 없이도 성공하지만, `pnpm dev` / `pnpm db:push` 이전에는 반드시 `.env` 가 준비돼야 합니다.

## 주요 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| POST | `/v1/crawl-jobs` | 크롤링 작업 큐 등록 |

## Slack 슬래시 커맨드

| Command | 설명 | 에이전트 / 모델 |
|---|---|---|
| `/ping` | 이대리 생존 확인 | — |
| `/today` | 오늘 할 일 계획 생성 (자동 수집 + Notion 기록) | PM Agent / ChatGPT |
| `/worklog` | 오늘 한 일 회고 (정량 근거 + Notion 기록) | Work Reviewer / ChatGPT |
| `/plan-task` | 백엔드 구현 계획 및 API 설계 생성 | BE Agent / Claude |
| `/po-shadow` | 직전 계획에 대한 PO 시점의 재검토 및 리스크 분석 | PO Shadow / ChatGPT |
| `/impact-report` | 특정 작업에 대한 임팩트 보고서 생성 | Impact Reporter / ChatGPT |
| `/sync-plan` | 생성된 계획을 외부(GitHub/Notion)로 전송 (승인 게이트) | PM-2 / (System) |
| `/sync-context` | 외부 컨텍스트(GitHub/Notion/Slack) 강제 재수집 | — |
| `/quota` | 본인의 에이전트 사용량 통계 확인 | — |
| `/review-pr` | GitHub PR 심층 리뷰 (Must-fix 등 도출) | Code Reviewer / Claude |


### Slack 봇 설정 (최초 1회)

1. https://api.slack.com/apps 에서 앱 생성
2. **Socket Mode** 활성화 → App-Level Token 발급 (scope: `connections:write`) → `SLACK_APP_TOKEN`
3. **OAuth & Permissions** → Bot Token Scopes: `commands`, `chat:write` → 워크스페이스에 install → Bot User OAuth Token → `SLACK_BOT_TOKEN`
4. **Basic Information** → Signing Secret → `SLACK_SIGNING_SECRET`
5. **Slash Commands** → 아래 10개 등록 (Request URL 은 Socket Mode 라 불필요하지만 UI 가 요구하면 `https://example.com/command` 같은 더미 값 입력):
   - `/ping` — 이대리 생존 확인
   - `/today` — 오늘 할 일 우선순위 정리 (Usage hint: `<오늘 할 일을 자유롭게 적어주세요>`)
   - `/worklog` — 오늘 한 일 회고 (Usage hint: `<오늘 한 일을 자유롭게 적어주세요>`)
   - `/review-pr` — PR 리뷰 (Usage hint: `<PR URL 또는 owner/repo#번호>`)
   - `/plan-task` — 백엔드 구현 계획 (Usage hint: `<구현할 기능 설명 또는 PR URL>`)
   - `/po-shadow` — 계획 재검토 (Usage hint: `[선택] 추가 컨텍스트`)
   - `/impact-report` — 임팩트 보고서 (Usage hint: `<작업 설명 또는 PR URL>`)
   - `/sync-plan` — 외부 시스템 동기화 (Preview Gate 연동)
   - `/sync-context` — 외부 컨텍스트 강제 재수집
   - `/quota` — 사용량 통계 확인 (Usage hint: `[today|week]`)
   > 또는 좌측 **`App Manifest`** 에서 `slash_commands` 배열에 위 커맨드들을 선언하고 **Save Changes** → **Reinstall your app** 으로 반영.
6. `.env` 에 세 값 채운 뒤 `pnpm dev` 재기동 → `이대리 Slack 봇이 Socket Mode 로 기동되었습니다.` 로그 확인
7. Slack 채널에서 `/ping` 입력해 응답 확인

## 참고 문서

- [자동화 규칙 (AGENTS.md)](./AGENTS.md)
- [코드 규칙](./CODE_RULES.md)
- [과거 설계/기획 (archive)](./docs/archive/)
