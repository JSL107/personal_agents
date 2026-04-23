# personal_agents (이대리)

Slack 기반 멀티 에이전트 업무 자동화 시스템 — 코드명 **이대리**.
GitHub / Notion / Postman / Slack 등을 연결해 PM · BE · Code Reviewer · Work Reviewer 역할을 수행하는 개인 비서형 백엔드.
상위 기획은 [`jarvis_agents_plan_2026.md`](./jarvis_agents_plan_2026.md) 참고.

## 현재 상태

- ✅ NestJS + DDD/Hexagonal 기반 골격 (`common/`, `config/`, `prisma/`)
- ✅ Prisma + PostgreSQL 영속성 계층 (`AgentRun`, `EvidenceRecord` 모델)
- ✅ Slack Bolt 어댑터 (`src/slack/`) — Socket Mode, `/ping` · `/today` · `/worklog` 슬래시 커맨드
- ✅ Model Router (`src/model-router/`) — Port 인터페이스 + **CodexCliProvider (ChatGPT) / ClaudeCliProvider (Claude)** + Mock (Gemini), 에이전트→모델 라우팅 매핑 + cwd·env allowlist 격리
- ✅ AgentRun 라이프사이클 (`src/agent-run/`) — `AgentRunService.execute({ begin → run → finish })` 템플릿, EvidenceRecord 자동 기록
- ✅ PM Agent (`src/agent/pm/`) — `/today` 슬래시 커맨드, DailyPlan JSON 스키마 파서
- ✅ Work Reviewer (`src/agent/work-reviewer/`) — `/worklog` 슬래시 커맨드, DailyReview JSON 스키마 파서 (정량 근거 + 개선 전/후 + 다음 액션 + 한 줄 성과)
- ✅ 크롤러 도메인 (`src/crawler/`) — Port-Adapter 구조, BullMQ 큐, Puppeteer + Cheerio
- ⏳ Work Reviewer / Code Reviewer / BE 에이전트, Notion/GitHub 커넥터 — 미구현

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
| `PORT` | ❌ | HTTP 서버 포트 (기본 3000) |
| `REDIS_HOST` | ✅ | BullMQ 연결용 Redis 호스트 |
| `REDIS_PORT` | ✅ | BullMQ 연결용 Redis 포트 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | ✅ | `docker-compose.yml` 의 postgres 서비스 environment 에 interpolation 되는 값. 저장소에 credential 을 하드코딩하지 않기 위함. 기본값 `idaeri/idaeri/idaeri`. 비밀번호를 강하게 바꾸면 `DATABASE_URL` 도 같이 갱신. |
| `DATABASE_URL` | ✅ | PostgreSQL 연결 문자열 (Prisma). 앱 부팅 시 config 검증과 Prisma CLI(`db:push` / `db:studio`) 에서 요구. `pnpm install` 의 `prisma generate` 는 schema 파싱만 하므로 DATABASE_URL 없이도 성공. 실제 DB 연결은 PrismaService 의 lazy connect 로 처리. `POSTGRES_*` 자격증명 + 호스트 포트 5434 와 짝을 이룬다. 로컬에 이미 상주 중인 타 프로젝트 5432/5433/6379/6380 점유자와 충돌을 피하기 위한 전용 포트. Redis 도 동일하게 `REDIS_PORT=6381`. |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` / `SLACK_SIGNING_SECRET` | ⭕ | Slack 봇 기동용 (Socket Mode). 3개 모두 설정된 경우에만 Slack 봇 기동, 하나라도 비면 앱은 정상 부팅하되 Slack 기능만 비활성화. |

> 설치와 `.env` 생성 순서는 서로 독립적입니다. `pnpm install` 은 DATABASE_URL 없이도 성공하지만, `pnpm dev` / `pnpm db:push` 이전에는 반드시 `.env` 가 준비돼야 합니다.

## 주요 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| POST | `/v1/crawl-jobs` | 크롤링 작업 큐 등록 |

## Slack 슬래시 커맨드

| Command | 설명 | 에이전트 / 모델 |
|---|---|---|
| `/ping` | 이대리 생존 확인. `pong — <ISO 시각>` 응답 | — |
| `/today <오늘 할 일>` | 자유 텍스트로 받은 할 일을 우선순위 + 오전/오후 + 예상 소요 + 근거로 재구성해 응답 (ephemeral). AgentRun / EvidenceRecord 자동 기록. 소요 10~20초. | PM Agent / ChatGPT (codex CLI) |
| `/worklog <오늘 한 일>` | 오늘 한 일을 받아 요약 + 정량 근거 + 질적 영향 + 개선 전/후 + 다음 액션 + 한 줄 성과로 재구성해 응답 (ephemeral). 정량 근거 없으면 "추정 수준" 으로 표기 (기획서 §8). 소요 10~20초. | Work Reviewer / ChatGPT (codex CLI) |

### Slack 봇 설정 (최초 1회)

1. https://api.slack.com/apps 에서 앱 생성
2. **Socket Mode** 활성화 → App-Level Token 발급 (scope: `connections:write`) → `SLACK_APP_TOKEN`
3. **OAuth & Permissions** → Bot Token Scopes: `commands`, `chat:write` → 워크스페이스에 install → Bot User OAuth Token → `SLACK_BOT_TOKEN`
4. **Basic Information** → Signing Secret → `SLACK_SIGNING_SECRET`
5. **Slash Commands** → 아래 3개 등록 (Request URL 은 Socket Mode 라 불필요하지만 UI 가 요구하면 `https://example.com/command` 같은 더미 값 입력):
   - `/ping` — 이대리 생존 확인
   - `/today` — 오늘 할 일 우선순위 정리 (Usage hint: `<오늘 할 일을 자유롭게 적어주세요>`)
   - `/worklog` — 오늘 한 일 회고 (Usage hint: `<오늘 한 일을 자유롭게 적어주세요>`)
   > 또는 좌측 **`App Manifest`** 에서 `slash_commands` 배열에 세 커맨드를 한 번에 선언하고 **Save Changes** → **Reinstall your app** 으로 반영.
6. `.env` 에 세 값 채운 뒤 `pnpm dev` 재기동 → `이대리 Slack 봇이 Socket Mode 로 기동되었습니다.` 로그 확인
7. Slack 채널에서 `/ping` 입력해 응답 확인

## 참고 문서

- [기획서](./jarvis_agents_plan_2026.md)
- [코드 규칙](./CODE_RULES.md)
