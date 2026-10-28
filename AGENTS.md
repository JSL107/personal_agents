# AGENTS.md

자동화 에이전트(Codex CLI, Claude Code, Cursor 등)가 이 레포를 건드릴 때 따르는 **공통 규칙의 단일 소스**다. Claude Code 는 `CLAUDE.md` 가 이 파일을 `@AGENTS.md` 로 import 하므로, 공통 규칙은 여기에만 쓰고 `CLAUDE.md` 에는 Claude 전용 내용만 둔다.

- 사람용 README: [`README.md`](./README.md)
- 세부 코드 규칙: [`CODE_RULES.md`](./CODE_RULES.md) — 자동 로드되지 않는다. **코드를 새로 작성하거나 리뷰할 때 해당 절을 직접 읽는다** (빈출 위반은 §2 요약).
- 상위 기획서 `jarvis_agents_plan_2026.md` 는 owner 로컬에만 있고 git 추적 제외다. 이 문서가 없다고 가정하고 동작한다.

---

## 0. 정체성과 스택 사실 (틀리면 빌드부터 깨짐)

**이대리** — Slack 기반 멀티 에이전트 업무 자동화 봇. NestJS + Prisma + PostgreSQL + BullMQ + Slack Bolt(Socket Mode).

- **패키지 매니저: `pnpm@9.15.9`** — `npm` / `yarn` 사용 금지 (`packageManager` 필드로 강제).
- Node 22.12+ (`engines` 로 명시 — 하한 22.12 는 puppeteer 25 요구), NestJS 11, Prisma 6, Slack Bolt 4, BullMQ. **NestJS 11 은 Express 5** — 라우트 와일드카드 문법과 `req.query` 파서가 4 와 다르다.
- DB: **PostgreSQL @ 5434**, Redis @ 6381 (로컬 docker). 앱은 `PORT=3002`. 다른 포트 가정 X.
- LLM: `codex` CLI (ChatGPT 구독) + `claude` CLI (Claude Max 구독). 자식 프로세스 spawn 으로만 호출 — 직접 API SDK 사용 X, API key 불필요. 라우팅은 §6.
- **Router (Hierarchical Manager Pattern)**: 자연어 멘션 (`@이대리 ...`) → `IdaeriRouterUsecase` → `IntentClassifierUsecase` (multi-turn 5 turn / TTL 30분) → 등록된 worker dispatcher 중 1 (목록은 `router.module.ts` 의 `inject` 배열이 정본) → handoff chain (audit log via `AgentRun.parentId`). 슬래시는 기존 핸들러 유지 (병행).
- **NestJS multi-provider 는 single module scope** — 분산 등록 X. dispatcher 류는 PreviewGate.forRoot 패턴처럼 한 모듈 (RouterModule) 의 useFactory + inject 로 중앙 등록.
- BE 워커 5종(`/plan-task` `/be-schema` `/be-test` `/be-sre` `/be-fix`)과 CTO 배정(`/assign` `/auto-flow`)은 폐지했다 — 되살리지 말 것.

## 1. 명령과 완료 조건

| 의도 | 명령 |
|---|---|
| 의존성 설치 | `pnpm install` |
| 인프라 기동 | `pnpm db:up` |
| 스키마 동기화 | `pnpm db:push` |
| 개발 서버 | `pnpm dev` |
| 린트 검사 / 자동수정 | `pnpm lint:check` / `pnpm lint` |
| 단위 테스트 | `pnpm test` |
| 빌드 (type 검증 포함) | `pnpm build` |
| 모듈 DI 연결 검사 (build 후, DB 연결 없이 그래프만) | `node --env-file=.env scripts/check-di.cjs` (CI 는 `pnpm check:di`) |
| schema 변경 시 | `pnpm prisma format` |

**완료 조건** — 하나라도 exit 0 이 아니면 끝난 것 X. 고치거나, 보고하고 멈춘다.

1. 코드 변경: `pnpm lint:check && pnpm test && pnpm build` 3중 green + `check:di` green. `check:di` 는 3중 green 이 못 보는 DI 배선 오류를 잡는다.
2. env / agent-registry / `AgentType` 변경 시 추가: `pnpm docs:sync` 후 `pnpm docs:check` green — 생성 문서 `docs/env-catalog.md`·`docs/agent-catalog.md` 가 코드와 어긋나면 CI `verify` 가 실패한다. `docs/` 는 gitignore 지만 이 카탈로그는 tracked 라 `git add -f docs/env-catalog.md` 로 스테이징. **codex-flow 위임 시 이 단계를 codex 프롬프트와 `.ai/design.md` 검증 항목에도 명시할 것** (codex 는 명시한 게이트만 실행한다).

### 브랜치 / worktree 격리

- 새 기능, 다파일 리팩터링, 또는 PR로 낼 작업은 올바른 base 브랜치에서 만든 전용 `git worktree`에서 진행한다.
- 착수 전 `git branch --show-current`, `git status --short`, `git worktree list`로 현재 브랜치·변경·등록된 worktree를 확인한다. 이 명령들은 다른 세션의 점유 여부까지 증명하지 않으므로, 점유를 별도로 확인할 수 없으면 전용 worktree를 사용한다. 현재 트리에 무관한 변경이 있거나 다른 세션이 사용 중이면 그 트리를 수정하지 않는다.
- Codex가 사용할 worktree는 `codex exec`의 non-ASCII 절대경로 문제(§8)를 피하도록 `/private/tmp` 등 ASCII 경로에 만든다.
- 오탈자·설정·한두 줄의 casual 변경은 커밋하거나 PR로 제출하지 않을 때에만, 현재 트리가 clean이고 대상 브랜치가 맞으면 직접 수정할 수 있다. 커밋 또는 PR로 남길 계획이 생기면 변경 규모와 무관하게 전용 worktree로 옮긴다.
- 충돌이 예상되면 자동으로 해소하지 않는다. push가 non-fast-forward로 거부되어도 force push하지 말고, 원격 후속 커밋을 보존한 채 충돌 근거와 안전한 통합 방안을 보고한다.

### 파일 지도 — 자주 쓰는 파일은 grep/glob 하지 말고 바로 읽는다

실제 동작은 현재 코드로 확인한다.

| 의도 | 파일 |
|---|---|
| 슬래시 커맨드 핸들러 | `src/slack/handler/agent-command.handler.ts` (`/po-eval` `/ceo-review` 는 `phase-command.handler.ts`) |
| 재실행 판정·디스패치 (Slack `/retry-run`·콘솔 공용) | `src/run-replay/application/replay-failed-run.usecase.ts` |
| 자연어 멘션 진입점 (`app_mention`) | `src/slack/handler/router-message.handler.ts` |
| Router 본체 (manager + handoff chain) | `src/router/application/idaeri-router.usecase.ts` |
| Router dispatcher 중앙 등록 (useFactory + `inject` 배열) | `src/router/router.module.ts` |
| AgentDispatcher 인터페이스 + `AGENT_DISPATCHER_PORT` | `src/router/domain/port/agent-dispatcher.port.ts` |
| Conversation memory (in-memory, key=slackUserId:channelId) | `src/router/application/conversation-memory.service.ts` |
| Autopilot 워크데이 플레이북 (모든 cron 통합 — 출근/퇴근/주간) | `src/autopilot/domain/autopilot.playbook.ts`, `src/autopilot/application/autopilot.orchestrator.ts` |
| 모델 선택·CLI 호출 | `src/model-router/application/model-router.usecase.ts` → `infrastructure/codex-cli.provider.ts` · `claude-cli.provider.ts` |
| 에이전트 → 모델 매핑 | `src/model-router/domain/agent-provider.map.ts` (`AGENT_TO_PROVIDER`) |
| CLI 격리 유틸 (보안 핵심) | `src/model-router/infrastructure/cli-process.util.ts` (`buildSafeChildEnv`) |
| 모듈 등록 / env 검증 | `src/app.module.ts` / `src/config/app.config.ts` |
| Prisma 스키마 (DB 단일 소스) / 인프라 컨테이너 | `prisma/schema.prisma` / `docker-compose.yml` |
| AgentRun 라이프사이클 + setParentId (chain audit) | `src/agent-run/application/agent-run.service.ts` |
| Preview Gate (외부 부작용 ✅ 게이트) | `src/preview-gate/` |
| 백테스트 재생 루프 (추천=평일 / 체결=거래일 두 축) / CLI | `src/backtest/application/replay-backtest.usecase.ts` / `scripts/backtest.ts` + `src/backtest/interface/backtest-cli.parser.ts` |
| 데스크톱 콘솔 | `clients/idaeri-console/Sources/ConsoleCore/` |

모듈 전체 보기: `Glob src/**/*.module.ts`.

| 에이전트 | 슬래시 | Usecase |
|---|---|---|
| PM | `/today` | `src/agent/pm/application/generate-daily-plan.usecase.ts` |
| Work Reviewer | `/worklog` | `src/agent/work-reviewer/application/generate-worklog.usecase.ts` |
| Code Reviewer | `/review-pr` | `src/agent/code-reviewer/application/review-pull-request.usecase.ts` |
| PO Shadow | `/po-shadow` | `src/agent/po-shadow/application/generate-po-shadow.usecase.ts` |
| Impact Reporter | `/impact-report` | `src/agent/impact-reporter/application/generate-impact-report.usecase.ts` |
| PO_EVAL | `/po-eval` | `src/agent/po-eval/application/generate-po-evaluation.usecase.ts` |
| CEO | `/ceo-review` | `src/agent/ceo/application/generate-ceo-meta.usecase.ts` |

## 2. DDD 폴더 구조와 코드 스타일

```
src/
  {domain}/
    domain/          # 엔티티, Port 인터페이스, 도메인 예외/검증, prompt
    application/     # 유스케이스
    infrastructure/  # Port 어댑터 (DB, 외부 API 클라이언트)
    interface/       # Controller, DTO, Slack handler 등
    {domain}.module.ts
  common/            # 공통 응답/예외/필터/인터셉터
  config/            # 환경변수 검증 (class-validator)
```

- 의존 방향은 **항상 바깥(interface) → 안쪽(domain)**. 역방향 금지. Domain Layer 는 NestJS / 외부 라이브러리에 의존 안 함 (pure TS).
- Repository 는 영속성만, 비즈니스 규칙은 Application/Domain 에. Domain Repository (비즈니스 의미 함수명) ↔ Write Repository (`save`/`findOne` — DB 접근만) ([CODE_RULES §4](./CODE_RULES.md)).
- 파일명: kebab-case + role suffix (`user.repository.ts`, `pm.formatter.ts`, `daily-plan.usecase.ts`, `daily-plan.usecase.spec.ts`).

빈출 위반:

```ts
// ❌ 줄임말 / 진행형 변수명
catch (err) { ... }              // → catch (error)
const existing = await find();   // → const found = ...
const repo = ...;                // → const repository = ...
const req = ...;                 // → const request = ...

// ❌ if 단일 라인 중괄호 생략
if (cond) return;                // → if (cond) { return; }

// ❌ try-catch 안에서 return await 생략 (rejection 이 catch 에 안 잡힘)
async function bad() {
  try { return doAsync(); }      // → return await doAsync();
  catch (error) { ... }
}

// ❌ 인라인 반환 타입
function foo(): { data: string } // → 별도 type/interface 로 추출

// ❌ 분기 복잡 시 if 중첩
if (a) { if (b) { ... } }        // → ts-pattern 의 match 검토
```

## 3. 핵심 도메인 한 줄 정리

| 도메인 | 책임 | 진입점 |
|---|---|---|
| `agent-run/` | 모든 에이전트 실행의 라이프사이클 (begin → run → finish) + EvidenceRecord 기록 | `AgentRunService.execute({...})` |
| `model-router/` | AgentType → ChatGPT primary 라우팅 + Claude 단방향 fallback, CLI provider 어댑터 | `ModelRouterUsecase.route({ agentType, request })` |
| `github/` | Octokit 기반 read-only GitHub 클라이언트 (assigned issues/PRs, PR detail/diff) | `ListAssignedTasksUsecase`, `OctokitGithubClient` |
| `agent/*/` | 워커별 도메인 — 슬래시·usecase 는 §1 표 | 각 `application/*.usecase.ts` |
| `slack/` | Slack Bolt Socket Mode 어댑터 + 슬래시 핸들러 + `app_mention` 진입 + 응답 포맷터 | `SlackService` |
| `router/` | 자연어 멘션 → intent classifier → worker dispatcher → handoff chain (§0) | `IdaeriRouterUsecase.dispatch({...})` (`IDAERI_ROUTER_PORT`) |
| `crawler/` | Puppeteer + Cheerio + BullMQ 크롤러 | `POST /v1/crawl-jobs` |

## 4. 새 에이전트 / 명령 추가 시 체크리스트

1. `src/agent/{name}/domain/` 에 type / error-code enum / exception / system prompt / output parser 작성
2. `src/agent/{name}/application/{usecase}.usecase.ts` 가 `AgentRunService.execute` 안에서 `ModelRouterUsecase.route` 호출
3. 모든 외부 의존성(GitHub 등) 호출은 **graceful fallback** — 실패해도 사용자 입력만으로 진행
4. Slack 슬래시 커맨드 추가 시 `SlackService.registerCommands` 에 핸들러 + `formatXxx` 포맷터 + `ack(body)` + `respond(replace_original)` 패턴 (§6)
5. `AppModule` / `SlackModule` 에 모듈 등록
6. `ResponseCode` enum 에 도메인 ErrorCode 와 1:1 동기화 항목 추가 (AllExceptionsFilter 가 매칭에 씀)
7. `src/agent-run/domain/agent-run.type.ts` 의 `TriggerType` enum 에 `SLACK_COMMAND_*` 추가
8. `src/model-router/domain/model-router.type.ts` 의 `AgentType` enum 추가 → **`AgentType` 을 키로 쓰는 exhaustive 지점 4곳을 전부 채운다**
   - `src/model-router/domain/agent-provider.map.ts` 의 `AGENT_TO_PROVIDER`
   - `src/agent-registry/agent-contract.ts` 의 `AGENT_CONTRACTS`
   - `src/router/domain/agent-safety.map.ts` 의 `AGENT_SAFETY_LEVEL`
   - `src/agent-registry/agent-registry.ts` 의 `AGENT_REGISTRY` (닉네임 포함)

   앞 셋은 `Record<AgentType, ...>` 라 빠뜨리면 빌드가 끊는다. **`AGENT_REGISTRY` 만 `readonly AgentRegistryEntry[]` 라 컴파일러가 못 잡고 `agent-registry.spec.ts` 가 잡는다.** 이 표를 하나로만 알고 계획하면 작업 범위를 과소 추정한다.
9. `src/run-replay/application/replay-failed-run.usecase.ts` 의 switch 에 새 `case '{AGENT_TYPE}'` 추가 (FAILURE_REPLAY 라우팅) — 새 에이전트가 FAILED 되면 재실행 가능해야 함. 재실행을 지원하면 `src/run-replay/domain/run-replay.type.ts` 의 `REPLAYABLE_AGENT_TYPES`(콘솔 재시도 버튼 기준)와 `src/slack/handler/retry-run.handler.ts` 의 Slack 포맷 case 도 함께 추가
10. spec: parser / usecase / formatter 단위 테스트 (CODE_RULES §5)
11. README 의 슬래시 커맨드 표 + Slack 봇 설정 단계에 명령 추가
12. 새 환경변수가 필요하면 §5 환경변수 규칙의 4곳 동기 갱신
13. Slack manifest 에 슬래시 커맨드 등록 (사용자 액션, README 에 가이드 포함)
14. **자연어 멘션도 호출 가능해야 하면** `src/agent/{name}/infrastructure/{name}.dispatcher.ts` (AgentDispatcher) 작성 + `src/router/router.module.ts` 의 `AGENT_DISPATCHER_PORT` useFactory `inject` 배열 끝에 등록 + `src/router/domain/prompt/intent-classifier-system.prompt.ts` 의 분류 후보 표에 한 줄 추가. **같은 파일의 「UNKNOWN 으로 분류할 케이스」에 새 워커가 맡아야 할 발화가 예시로 박혀 있지 않은지 함께 확인** — 박혀 있으면 그 줄을 **치환**한다 (덧붙이면 충돌 라인이 이겨서, 워커를 등록해도 영영 호출되지 않는다. 실례: `DELAY_REPORT` 등록 때 UNKNOWN 예시에 `"지금 뭐해?"` · `"잘 되고 있어?"` 가 있었다). 분산 multi-provider 패턴 X (§0). 자세한 lesson 은 [`docs/superpowers/plans/2026-05-27-router-step-1-to-8-impl-notes.md`](./docs/superpowers/plans/2026-05-27-router-step-1-to-8-impl-notes.md) §2.1

## 5. 인프라 / 보안 규칙 (절대 위반 금지)

### CLI Provider 격리
- `CodexCliProvider` / `ClaudeCliProvider` 는 **반드시** `cli-process.util.ts` 의 `buildSafeChildEnv({ cwd, homeDir })` 로 자식 프로세스 env 를 만든다.
- Codex 는 `mkdtemp` 로 만든 throwaway HOME 을 쓰고, 인증은 실제 `CODEX_HOME` 을 전달해 보존한다. Claude 는 OAuth token 이 있으면 throwaway HOME 을 쓰고, 없으면 Keychain 인증을 위해 실제 HOME 을 쓴다. `CLAUDE_CONFIG_DIR` 는 기본값을 주입하지 않고 부모가 `CLAUDE_CONFIG_DIR` 또는 `CLAUDE_HOME` 을 명시했을 때만 전달한다 (이유는 §8).
- 단 현재 `SAFE_ENV_KEYS` 에는 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_CACHE_HOME` 도 부모 값 그대로 forward 된다 — XDG 가 export 된 환경에서는 자식 CLI 가 그 디렉토리들도 읽을 수 있다. 시크릿이 들어 있을 가능성이 있으면 allowlist 에서 제외하거나 throwaway 경로로 override 할 것.
- prompt 는 **argv 가 아니라 stdin** 으로 전달. `ps aux` 로 prompt 노출되면 안 됨.
- spawn 에 `cwd: workDir` 필수 — codex agent 가 repo 파일 못 읽도록.

### Credential
- `.env` 는 git 제외. 절대 커밋하지 말 것. GitHub PAT / Slack token 을 코드에 하드코딩하지 말 것.
- `docker-compose.yml` 은 `${POSTGRES_USER:?...}` 식 interpolation. 하드코딩 credential 금지 (GitGuardian).
- Slack/GitHub 토큰은 사용자가 채팅에 노출 시 즉시 rotate 권고.

### DB
- ORM 은 **Prisma 만** 사용. TypeORM / `@nestjs/typeorm` import 금지, raw SQL 금지.
- 변경 워크플로우: `prisma/schema.prisma` 수정 → `pnpm db:push` (synchronize). 마이그레이션 파일 미생성. db:push 함정은 §8.
- `DATABASE_URL` 은 부팅 시 `app.config.ts` class-validator 가 강제 (install 단계엔 불필요 — `prisma generate` 는 schema 파싱만).

### 환경변수
- `process.env` 직접 참조 금지 → `ConfigService.get(...)` (DI 컨텍스트 밖만 예외, [CODE_RULES §9](./CODE_RULES.md)).
- 새 env 추가 시 `.env.example` + `.env` + `src/config/app.config.ts` (class-validator) + README 표 4곳 동기 갱신.

### 이 레포에서 안 하는 것
- `MockModelProvider` 외 production 분기, prod 배포 자동화, 사용자 요청 없는 commit.

## 6. 모델 라우팅과 Slack 응답 패턴

- **전체 에이전트** → ChatGPT (`codex exec`) 가 primary (`AGENT_TO_PROVIDER`).
- **Fallback** — `CHATGPT → CLAUDE` 단방향. primary 실패 시 `ClaudeCliProvider` 로 한 번 재시도하고, 둘 다 실패해야 `MODEL_COMPLETION_FAILED` throw (쿼터 소진 시 reset 시각 안내). **폴백을 타지 않는 예외 둘**: `noFallback: true` (HUMANIZER 등 best-effort 후처리), `outputSchema` 를 건 요청 (claude CLI 에 형태 강제 인자가 없어 "스키마를 걸었으니 파싱은 안전하다" 는 전제가 깨진다).
- 인증: 각 CLI 의 keychain/OAuth (구독). Claude token env 경로는 §8.

CLI latency 10~40초 → Slack 3초 안 ack 강제: 즉시 `ack(body)` → 모델 호출 → `respond({ replace_original: true })` 로 덮어쓰기.

- 구현: `agent-command.handler.ts` (단일 워커 슬래시) + 카테고리 핸들러 (`phase-command.handler.ts` — `/po-eval` `/ceo-review`, `feedback-command.handler.ts` — `/review-feedback`) + 개별 파일 (`retry-run.handler.ts` — 판정은 `src/run-replay/`, `write-back.handler.ts`, `diagnosis.handler.ts`)
- `replace_original: true` 헬퍼: `src/slack/handler/slack-handler.helper.ts` 의 `runEphemeral` / `runAgentCommand`
- ephemeral 응답에서 `replace_original` 가 가끔 안 먹는 건 Slack API 한계, 그대로 둠.
- LLM output 을 Slack mrkdwn 으로 직접 보낼 때는 control char (`*`, `_`, `~`, `<`, `>`, `&`, `` ` ``) escape 검토 — formatter 에서 처리.

## 7. commit / 리뷰 워크플로우

1. **commit 은 사용자가 명시 요청한 후에만.** 자발적 commit X.
2. 의미 단위 atomic commit. 한국어 OK. 형식 `<type>(<scope>): <subject>` ([CODE_RULES §8](./CODE_RULES.md)), subject 50자 이내, 명령형 현재시제.
3. 의미 있는 변경 후 `/codex:review` — owner 가 사용자 트리거로 실행한다. 자동화 에이전트(Claude Code/Cursor 등)는 직접 호출 X, 자체 코드리뷰 수단으로 대체 가능.

### 이대리 자동 리뷰 봇 응답 규약

이 레포의 PR 에 `🤖 **이대리 자동 리뷰**` 로 시작하는 인라인 코멘트가 달리면
**답변·리액션 전에 [docs/pr-review-bot-protocol.md](./docs/pr-review-bot-protocol.md) 를 읽고 그대로 따른다.**

봇이 채택/기각을 학습하므로 답변만으로는 부족하다 — 정탐 👍 / 오탐은 반박 답변을 **먼저** 게시한 뒤 👎.
**맞는 지적을 이번 PR 에서 안 고치는 경우도 👍** 다 — 👎 의 답글은 규약이 되어 같은 지적을 억제한다.
순서를 뒤집으면 24시간 유예 안에 답글을 달지 못한 기각은 이유 없이 확정된다. 🔴 정탐에 👎 는 역학습이라 금지.
나머지(식별 표식, API 호출, 되돌리기 `pnpm review:unlearn`, 표식으로 시작 금지)는 위 문서에 있다.

## 8. 자주 마주치는 함정

- **Nest DI 가 `Number` provider 못 찾음**: 생성자에 default-value 파라미터 (`timeoutMs: number = 180_000`) 두면 reflection 이 Number type 으로 해석. **default 는 클래스 필드로**.
- **3000 포트 EADDRINUSE**: 로컬에 다른 docker (`dockers-socket-1`) 가 점유. 이대리는 `PORT=3002`.
- **codex CLI exit=0 인데 빈 응답**: 인증 만료/쿼터 소진. `CodexCliProvider` 가 명시 에러로 끊음.
- **Codex 가 한글 경로 (`기타`) 에서 실행 실패**: `codex exec` 는 workspace 절대경로를 HTTP 헤더 (`x-codex-turn-metadata`) 에 싣는데 non-ASCII 면 헤더 변환 실패로 websocket 이 5회 재시도 후 **exit 2 로 죽는다** (무시 불가). → codex 를 쓸 worktree 는 **ASCII 절대경로**에. 이미 한글 경로에 만들었으면 `git worktree move <old> <ascii-new>` 로 node_modules·.ai 째 이동 가능.
- **claude OAuth token 경로** (keychain ACL 우회): `claude setup-token` 발급 OAuth token (`sk-ant-oat01-...`) 을 `.env` 의 `CLAUDE_CODE_OAUTH_TOKEN` (backward-compat alias `ANTHROPIC_API_KEY`) 에 두면 ClaudeCliProvider 가 자식 env 로 forward 한다. CLI 인증 우선순위상 OAUTH_TOKEN > keychain 이라 `nest start --watch` 의 child PID 변동으로 생기는 keychain ACL 침묵 exit=1 을 피한다. `--bare` / `CLAUDE_CODE_SIMPLE=1` 은 쓰지 않는다 (keychain/OAuth 를 무시하고 OAuth token 을 "Invalid API key" 로 거부). token 미설정 시 keychain 경로로 fallback — **fallback 이 안 되면 ACL 보다 먼저 아래 `CLAUDE_CONFIG_DIR` 를 의심할 것.**
- **`CLAUDE_CONFIG_DIR` 를 자식 env 에 넣으면 keychain fallback 이 죽는다**: 이 env 가 있으면 claude CLI 는 keychain 대신 그 디렉토리의 자격증명 파일을 찾고, macOS 구독 환경엔 `~/.claude/.credentials.json` 이 없어 `Not logged in · Please run /login` + exit=1 로 끊긴다. 그 exit=1 은 `isClaudeAuthSuspect` 를 타 "인증 만료 / 쿼터 소진 의심" owner 알람으로 **오진**된다. codex 는 반대로 `CODEX_HOME` 명시 전달이 **필요**하니 둘을 같이 묶지 말 것.
- **PrismaClient regen 누락**: schema 변경 후 `pnpm db:push` 만 하고 build 하면 type 안 맞을 수 있음 → `pnpm prisma:generate` 후 재빌드.
- **`db:push` 는 수동 생성 인덱스를 지운다 — 마지막 단계가 자동으로 되살린다**: Prisma 스키마로 표현할 수 없는 인덱스 3종(`idx_agent_run_output_fts`(GIN), `idx_episodic_memory_embedding`(pgvector HNSW), `idx_strategy_parameter_active`(부분 유니크))은 `src/prisma/manual-index.sql.ts` 한 곳에 있고, 앱 부팅(`prisma.service.ts`)과 `pnpm db:push` 마지막 단계(`pnpm db:restore-indexes`)가 같은 목록으로 멱등 재생성한다. 어느 것이 지워질지는 미리 알 수 없다. 출력의 `복구 <이름>` 줄이 push 가 지운 것이다. `prisma db push` 를 직접 부르면 이 단계를 건너뛰니 그때는 `pnpm db:restore-indexes` 를 따로 돌린다. 새 수동 인덱스는 `manual-index.sql.ts` 에만 추가한다.
- **`db:push` 는 파괴적 변경이면 멈춘다**: `scripts/db-push-guard.mjs` 가 push 전에 drift 를 떠서 `DROP TABLE`·`DROP COLUMN` 이 있으면 무엇이 지워지는지 출력하고 끊는다. 로컬 DB 를 worktree 전체가 공유하므로 뒤처진 브랜치에서 돌리면 남의 컬럼이 사라진다 (실사고: `preview_action.last_failed_at` 소실 → `main` 앱 `/v1/console/snapshot` 500). 컬럼이 비어 있으면 Prisma 내장 확인은 통과시키므로 그것만으로는 안 막힌다. 막히면 리베이스가 먼저고, 정말 지워야 하면 `DB_PUSH_ALLOW_DROP=1 pnpm db:push`. `DROP INDEX` 는 위 항목의 수동 인덱스라 통과시킨다.
- **worktree 에서 prisma 명령이 안 돈다**: `.env` 가 gitignore 라 worktree 에 따라오지 않아 `DATABASE_URL` 이 없다. 메인 트리에서 `.env` 를 복사한 뒤 실행.

## 9. 진행 추적과 메모

- **잔여 판정은 여기부터**: `docs/superpowers/plans/2026-10-23-remaining-work-inventory.md` (최신 재고). 개별 plan 의 체크박스는 완료 후에도 갱신하지 않으므로 잔여 신호가 아니다. `## Review` 헤딩 유무도 신호가 아니다.
- 완료 작업 로그 `tasks/archive/`, 잔여 꼬리 `tasks/todo.md`, V3 출발점 `docs/superpowers/plans/2026-04-29-v3-roadmap.md`, 최신 결정은 `ls docs/superpowers/plans/` 역순. 신규 plan 은 `docs/superpowers/plans/{YYYY-MM-DD}-{slug}.md` (dated snapshot, 사후 갱신 X).
- 운영 중 알게 된 항목은 commit message body 에 기록한다 (다른 contributor 도 git log 로 확인 가능). 일회성 임시 노트는 [.claude](./.claude/) 가 아닌 conversation memory 에만.
- **PM Agent 응답 품질이 떨어지면 가장 먼저 의심할 곳**:
  1. ModelRouter 매핑이 의도한 모델로 가는지 (`AGENT_TO_PROVIDER`)
  2. CLI provider 의 `complete()` 가 `--ephemeral` / `--no-session-persistence` 유지 중인지 (세션 오염 방지)
  3. AgentRun 의 inputSnapshot 에 prompt 가 너무 길어지진 않았는지 (GitHub task 수, 전일 plan 반복)

## Code Review Rules

> Codex GitHub 리뷰(`@codex review` / 자동 리뷰)가 이 섹션을 읽어 리뷰 지침으로 사용한다.
> 번호를 붙이지 않는 이유는 Codex 가 정확히 `## Code Review Rules` 헤딩을 찾기 때문.

### 리뷰 방식

- 모든 리뷰 댓글과 요약은 한국어로 작성한다.
- 코드 식별자, 함수명, 타입명, 파일 경로, API 이름, 로그·오류 메시지는 원문을 유지한다.
- 실제 버그, 회귀, 크래시, 데이터 손상, 동시성·보안 문제를 우선 검토한다.
- 스타일, 포맷, 명명 취향, 확신이 낮은 추측은 생략한다 (`pnpm lint:check` 가 잡는 영역과 중복 금지).
- 각 지적은 문제·영향·수정 방향을 담아 간결하게 작성한다.
- PR diff 와 직접 관련된 코드를 우선하되, 아래 '레포 불변식' 은 diff 밖 파일이어도 정합성을 확인한다.

### 레포 불변식 (Codex 가 모르는 이 레포 관례 — 위반 시 P1)

- CLI 자식 프로세스 env 는 `buildSafeChildEnv` 만 쓰고, 프롬프트는 stdin 으로 넘긴다 (argv 금지 — `ps aux` 노출).
- ORM 은 Prisma 전용. `@nestjs/typeorm`·TypeORM import 는 금지.
- `process.env` 직접 참조 금지 → `ConfigService.get(...)` (DI 컨텍스트 밖만 예외).
- 새 env 추가 시 `.env.example`·`.env`·`src/config/app.config.ts`·README 4곳을 함께 갱신했는지 확인한다.
- 새 슬래시·에이전트 추가 시 `AgentType` exhaustive 4곳(§4 체크리스트 #8)·재실행 switch(`replay-failed-run.usecase.ts`)·`ResponseCode` enum 이 함께 갱신됐는지 확인한다.
- NestJS 생성자에 기본값 파라미터를 두지 않는다 (`timeoutMs: number = 180_000` → `Number` provider 오류). 기본값은 클래스 필드로.
