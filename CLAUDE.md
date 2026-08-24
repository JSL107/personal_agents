# CLAUDE.md

이대리 (Slack 멀티 에이전트) — Claude Code 가 이 레포를 토큰 효율적이고 정확하게 다루기 위한 작업 가이드.
전체 규칙은 [AGENTS.md](./AGENTS.md), 코드 컨벤션은 [CODE_RULES.md](./CODE_RULES.md).

---

## 0. 스택 사실 (틀리면 빌드부터 깨짐)

- **패키지 매니저: `pnpm@9.15.9`** — `npm` / `yarn` 사용 금지 (`packageManager` 필드로 강제).
- Node 22+, NestJS 10, Prisma 6 (TypeORM 절대 X), Slack Bolt 4, BullMQ. (`package.json` `engines` 로 명시 — 20 은 지원 종료)
- DB: **PostgreSQL @ 5434**, Redis @ 6381 (로컬 docker). 다른 포트 가정 X.
- LLM: `codex` CLI (ChatGPT 구독) + `claude` CLI (Claude Max 구독). 자식 프로세스 spawn 으로만 호출 — 직접 API SDK 사용 X. 인증: 기본은 각 CLI 의 keychain/OAuth (구독). Claude 는 keychain ACL 미등록 환경 (nest start --watch child PID 변동 등) 우회용으로 `CLAUDE_CODE_OAUTH_TOKEN` env 경로 지원 — `.env` 에 `claude setup-token` 발급 OAuth token (`sk-ant-oat01-...`) 두면 자식 env 로 forward, docs precedence priority 5 (OAUTH_TOKEN) > priority 6 (keychain) 라 keychain 시도 자체가 안 일어남 (§6 참조). `ANTHROPIC_API_KEY` 도 backward-compat alias 로 동일하게 인식. 2026-07-02 부터 전체 에이전트가 ChatGPT(codex) 단일 provider — provider 간 fallback 없음 (codex 실패 시 재시도 없이 즉시 실패, 쿼터 소진 시 reset 시각 안내). ClaudeCliProvider 코드·인증 경로는 롤백 대비 보존 (라우팅 경로 없음). 이전 Gemini fallback 은 2026-06-04, Claude 는 2026-07-02 제거.
- **Router (Hierarchical Manager Pattern)**: 자연어 멘션 (`@이대리 ...`) → `RouterModule.IdaeriRouterUsecase` → `IntentClassifierUsecase` (자연어 분류, multi-turn 5 turn / TTL 30분) → 13 worker dispatcher 중 1. 슬래시는 기존 핸들러 유지 (병행).
- **NestJS multi-provider 는 single module scope** — 분산 등록 X. dispatcher 류는 PreviewGate.forRoot 패턴처럼 한 모듈 (RouterModule) 의 useFactory + inject 로 중앙 등록.

---

## 1. 토큰 절약 — 자주 쓰는 파일은 grep/glob 하지 말고 바로 읽어라

| 의도 | 파일 |
|---|---|
| 슬래시 커맨드 핸들러 (모든 라우팅 진입점) | `src/slack/handler/agent-command.handler.ts` |
| 자연어 멘션 진입점 (`app_mention` event) | `src/slack/handler/router-message.handler.ts` |
| Router 본체 (manager + handoff chain) | `src/router/application/idaeri-router.usecase.ts` |
| Router dispatcher 중앙 등록 (useFactory + inject 13) | `src/router/router.module.ts` |
| `/auto-flow` PM→CTO→BE 체인 (PreviewGate 버튼 2단) | `src/slack/handler/auto-flow.handler.ts` |
| Conversation memory (in-memory, key=slackUserId:channelId) | `src/router/application/conversation-memory.service.ts` |
| Autopilot 워크데이 플레이북 (모든 cron 통합 — 출근/퇴근/주간) | `src/autopilot/` (`domain/autopilot.playbook.ts`, `application/autopilot.orchestrator.ts`) |
| AgentDispatcher 인터페이스 + AGENT_DISPATCHER_PORT | `src/router/domain/port/agent-dispatcher.port.ts` |
| 에이전트 → 모델 라우팅 | `src/model-router/domain/agent-provider.map.ts` (`AGENT_TO_PROVIDER`) |
| CLI 격리 유틸 (보안 핵심) | `src/model-router/infrastructure/cli-process.util.ts` (`buildSafeChildEnv`) |
| 모듈 등록 한곳 | `src/app.module.ts` |
| env 검증 (class-validator) | `src/config/app.config.ts` |
| Prisma 스키마 (DB 단일 소스) | `prisma/schema.prisma` |
| 인프라 컨테이너 정의 | `docker-compose.yml` |
| AgentRun 라이프사이클 + setParentId (chain audit) | `src/agent-run/application/agent-run.service.ts` |
| Preview Gate (외부 부작용 ✅ 게이트) | `src/preview-gate/` |
| 백테스트 재생 루프 (추천=평일 / 체결=거래일 두 축) | `src/backtest/application/replay-backtest.usecase.ts` |
| 백테스트 CLI 진입점 | `scripts/backtest.ts` + `src/backtest/interface/backtest-cli.parser.ts` |

**모듈 전체 보기**: `Glob src/**/*.module.ts`.
**진행 추적**: `git log --oneline -20` — 커밋 메시지에 `V3 §X` 표기 있음.

### 에이전트 → 슬래시 → 진입 usecase 매핑

> 모델 매핑 source-of-truth: `src/model-router/domain/agent-provider.map.ts` 의 `AGENT_TO_PROVIDER`. 아래 표는 슬래시명 + usecase 경로 (코드에 분산) 까지 한 번에 보기 위한 집약 인덱스.

| 에이전트 | 슬래시 | Usecase | 모델 |
|---|---|---|---|
| PM | `/today` | `src/agent/pm/application/generate-daily-plan.usecase.ts` | ChatGPT |
| Work Reviewer | `/worklog` | `src/agent/work-reviewer/application/generate-worklog.usecase.ts` | ChatGPT |
| Code Reviewer | `/review-pr` | `src/agent/code-reviewer/application/review-pull-request.usecase.ts` | ChatGPT |
| BE | `/plan-task` | `src/agent/be/application/generate-backend-plan.usecase.ts` | ChatGPT |
| PO Shadow | `/po-shadow` | `src/agent/po-shadow/application/generate-po-shadow.usecase.ts` | ChatGPT |
| Impact Reporter | `/impact-report` | `src/agent/impact-reporter/application/generate-impact-report.usecase.ts` | ChatGPT |
| BE Schema | `/be-schema` | `src/agent/be-schema/application/generate-schema-proposal.usecase.ts` | ChatGPT |
| BE Test | `/be-test` | `src/agent/be-test/application/generate-test.usecase.ts` | ChatGPT |
| BE SRE | `/be-sre` | `src/agent/be-sre/application/analyze-stack-trace.usecase.ts` | ChatGPT |
| BE Fix | `/be-fix` | `src/agent/be-fix/application/analyze-pr-convention.usecase.ts` | ChatGPT |
| CTO | `/assign` | `src/agent/cto/application/generate-assignment.usecase.ts` | ChatGPT |
| PO_EVAL | `/po-eval` | `src/agent/po-eval/application/generate-po-evaluation.usecase.ts` | ChatGPT |
| CEO | `/ceo-review` | `src/agent/ceo/application/generate-ceo-meta.usecase.ts` | ChatGPT |
| (chain) AUTO_FLOW | `/auto-flow` | `src/slack/handler/auto-flow.handler.ts` (PM → CTO → BE 1-shot, PreviewGate 버튼) | — (chain) |

> `/be-test`, `/be-sre`, `/be-fix` Slack 핸들러는 각각 `src/slack/handler/be-{test,sre,fix}.handler.ts` (agent-command.handler.ts 가 아님). `/assign` `/po-eval` `/ceo-review` 는 `src/slack/handler/phase-command.handler.ts`, `/auto-flow` 는 `src/slack/handler/auto-flow.handler.ts` (체인 + button action).

---

## 2. 정확성 — 어기면 PR 자체가 막히는 hard rule

1. **commit 은 사용자가 명시 요청한 후에만**. 자발적 commit X.
2. **`pnpm lint:check && pnpm test && pnpm build` 3중 green** 안 나오면 작업 미완 — 끝났다고 보고 X.
3. `process.env` 직접 참조 X → `ConfigService.get(...)`. (DI 컨텍스트 밖만 예외, [CODE_RULES §9](./CODE_RULES.md))
4. CLI provider 자식 프로세스 env 는 `buildSafeChildEnv({ cwd, homeDir })` 만 사용. prompt 는 **stdin** (argv 금지 — `ps aux` 노출 방지).
5. ORM 은 **Prisma 만**. TypeORM/`@nestjs/typeorm` import 금지.
6. DB 변경: `prisma/schema.prisma` 수정 → `pnpm db:push` (synchronize 방식, 마이그레이션 파일 X).
7. 새 env 추가 시 4곳 동기 갱신: `.env.example` + `.env` + `src/config/app.config.ts` (class-validator) + README 표.
8. 새 슬래시/에이전트 추가 시 [AGENTS.md §4](./AGENTS.md) 의 13개 체크리스트 그대로 (특히 `AGENT_TO_PROVIDER` + `/retry-run` switch + `ResponseCode` enum).

---

## 3. 코드 스타일 cheat sheet (CODE_RULES 빈출 위반 모음)

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

**파일명**: kebab-case + role suffix (`user.repository.ts`, `pm.formatter.ts`, `daily-plan.usecase.ts`, `daily-plan.usecase.spec.ts`).
**Repository**: Domain Repository (비즈니스 의미 함수명) ↔ Write Repository (`save`/`findOne` — DB 접근만). [CODE_RULES §4](./CODE_RULES.md).

---

## 4. 슬래시 응답 패턴 (Slack)

CLI latency 10~40초 → Slack 3초 안 ack 강제 (즉시 `ack` → 모델 호출 → `respond({ replace_original: true })` 로 덮어쓰기).

- 패턴 구현: `src/slack/handler/agent-command.handler.ts` (단일 워커 슬래시) + 카테고리 핸들러 (`phase-command.handler.ts` — `/assign` `/po-eval` `/ceo-review`, `feedback-command.handler.ts` — `/review-feedback`) + 개별 파일 (`be-test.handler.ts`, `be-sre.handler.ts`, `be-fix.handler.ts`, `auto-flow.handler.ts`, `retry-run.handler.ts`, `write-back.handler.ts`, `diagnosis.handler.ts`)
- `replace_original: true` 헬퍼: `src/slack/handler/slack-handler.helper.ts:60-74`
- ephemeral 응답에서 `replace_original` 가끔 안 먹는 건 Slack API 한계, 그대로 둠.

LLM output 을 Slack mrkdwn 으로 직접 보낼 때는 control char (`*`, `_`, `~`, `<`, `>`, `&`, `` ` ``) escape 검토 — formatter 에서 처리.

---

## 5. 검증 명령

```bash
pnpm lint:check     # 변경 후 가장 먼저
pnpm test           # jest 단위
pnpm build          # nest build (type 검증 포함)
pnpm prisma format  # schema 변경 시
```

3개 다 exit 0 안 나오면 끝난 것 X — fix 또는 보고 후 멈춤.

---

## 6. 자주 마주치는 함정

- **`Number` provider not found**: 생성자에 `timeoutMs: number = 180_000` 같은 default 두면 reflection 이 Number 타입으로 잡음. **default 는 클래스 필드로**.
- **codex CLI exit=0 인데 빈 응답**: 인증 만료/쿼터 소진. `CodexCliProvider` 가 명시 에러로 끊음.
- **claude OAuth subscription token 경로** (keychain ACL 우회): `claude setup-token` 으로 발급한 long-lived OAuth token (`sk-ant-oat01-...`) 을 `.env` 의 `CLAUDE_CODE_OAUTH_TOKEN` (또는 backward-compat `ANTHROPIC_API_KEY` alias) 에 두면 ClaudeCliProvider 가 자식 env 의 `CLAUDE_CODE_OAUTH_TOKEN` 으로 forward. docs precedence priority 5 (OAUTH_TOKEN) > priority 6 (keychain) 라 keychain 시도 자체가 안 일어남 = **macOS Keychain ACL 미등록 환경 (nest start --watch 의 child PID 변동) 의 침묵 exit=1 자연 우회**. `--bare` / `CLAUDE_CODE_SIMPLE=1` 은 안 씀 (docs 의 Bare/SIMPLE 모드는 `ANTHROPIC_API_KEY` 를 API key `sk-ant-api03-` 형식만 받고 OAuth subscription token 은 "Invalid API key" 로 거부 — 2026-06-05 manual test 확정). token 미설정 시 기존 keychain 경로 fallback (ACL 등록된 환경만 동작).
- **3000 포트 EADDRINUSE**: 이대리는 `PORT=3002`.
- **PrismaClient regen 누락**: schema 변경 후 `pnpm db:push` 만 하고 build 하면 type 안 맞을 수 있음 → `pnpm prisma:generate` 후 재빌드.

---

## 7. 진행 중 작업 추적

Dated reference snapshots — 단일 커밋 결정 기록, 사후 갱신 X (신규 결정은 새 파일):

- **⚠️ 잔여 판정은 여기부터**: `docs/superpowers/plans/2026-08-24-remaining-work-inventory.md`
  — `tasks/todo.md` 의 「남은 것」 18개를 코드와 대조한 최신 재고 (확인 6 · 수정 3 · 치울 것 3).
  배경은 `2026-08-13-remaining-work-inventory.md` (문서 142개 전수 대조 · 판정 절차 3단계).
  **개별 plan 의 체크박스는 완료 후에도 갱신하지 않으므로 잔여 신호가 아니다**(머지 완료된 작업이
  "미완 55/55" 로 남아 있는 실례 포함). `## Review` 헤딩 유무도 신호가 아니다 — 「검증」 등
  다른 이름을 쓴 블록이 있다.
- **완료 작업 로그**: `tasks/archive/todo-completed-2026-08-24.md` (2026-08-24 분리한 70블록).
  `tasks/todo.md` 에는 잔여 꼬리가 남은 블록만 둔다.
- **V3 plan 인덱스 (출발점)**: `docs/superpowers/plans/2026-04-29-v3-roadmap.md` (#6~#11 단계별)
- **V3 mid-progress audit**: `docs/superpowers/audits/2026-04-29-v3-mid-progress-audit.md` (P2 잔여 항목 §8)
- **최신 결정**: `ls docs/superpowers/plans/` 로 timestamp 역순 확인 (보류/deprecate/방향 변경 결정 명문화)

신규 plan 은 `docs/superpowers/plans/{YYYY-MM-DD}-{slug}.md` 형식.

---

## 8. commit / 리뷰 워크플로우

- 의미 단위 atomic commit. 한국어 OK. 형식: `<type>(<scope>): <subject>` ([CODE_RULES §8](./CODE_RULES.md))
- 의미 있는 변경 후 `/codex:review` (owner 가 사용자 트리거로 실행 — Claude Code/Cursor 등 자동화 에이전트는 직접 호출 X. 자체 review 수단으로 대체 가능).
- 어떤 경우든 사용자 명시 요청 전 commit X.

### 8-1. 이대리 자동 리뷰 봇 응답 규약 (이 레포 전용)

이대리 봇은 **자기 리뷰의 채택/기각을 학습**한다. 그래서 답변만으로 끝내지 않고 **정탐/오탐 판정을 이모지로 남기는 것이
필수**다. 이모지가 학습 신호의 결정론적 입력이고, 답변 텍스트가 기각 이유(학습 재료)다.
(수집·평가·triage·인라인 답변 등 공통 절차는 `~/.claude/CLAUDE.md` §「PR 봇 리뷰 대응」)

- **식별**: 코멘트 본문이 `🤖 **이대리 자동 리뷰**` 로 시작하는 인라인 코멘트. 봇이 owner PAT로 달아서
  **작성자 계정이 사람과 같다** — 계정으로 구분하려 하지 말고 이 표식으로 판별한다.
- **정탐 → 👍**
  `gh api --method POST repos/<owner>/<repo>/pulls/comments/<comment_id>/reactions -f content=+1`
- **오탐(부정확·반박) → 반박 근거를 인라인 답변으로 먼저 게시하고, 그 다음 👎**
  `... /reactions -f content=-1` (REST 값은 `+1`/`-1`)
  🔴 **순서가 중요하다.** `harvest-signal.ts:68-72` 는 리액션을 먼저 보고 `replyBody` 가 비어 있어도
  즉시 `REJECTED` 를 반환한다. 👎를 먼저 붙이면 다음 `*/5` 스윕이 답변보다 앞질러 돌아
  `rejectReason: null` 로 적재되고(`harvest-review-signals.usecase.ts:262`), 카드가 종결돼
  `status='OPEN' AND resolvedAt IS NULL` 조회에서 빠진다 — **뒤늦게 단 답변은 영영 수확되지 않는다.**
  이유 없는 기각은 학습 재료로서 가치가 없다.
- **멘션은 불필요**(봇이 폴링 스윕으로 읽는다). 외부 봇용 멘션 규칙은 이 봇에 적용되지 않는다.
- **답변 본문을 `🤖 **이대리 자동 리뷰**` 로 시작하지 않는다** — 표식으로 시작하면 봇이 자기 글로 걸러내
  답변이 신호에서 빠진다(`harvest-signal.ts:43`).
- **owner 계정 리액션만 신호로 인정**된다(`harvest-signal.ts:52`). 다른 계정의 👍👎는 무시된다.
- 이모지가 없으면 답글을 LLM(`REVIEW_REPLY_JUDGE`)이 배치 판정한다(`harvest-signal.ts:66-75`) — 이모지를 남기면
  그 LLM 호출과 오판 가능성을 건너뛴다. 이게 이모지를 요구하는 실질적 이유.
- 🔴 **정탐에 👎 금지 (되돌릴 수 없다)**: `REJECTED` 카드만 episodic memory에 적재되고, 이후 리뷰 프롬프트에
  "무시된 리뷰 패턴, 피하세요"로 주입된다 → 좋은 지적을 피하도록 **역학습**한다. 반대로 오탐에 👍를 누르면
  채택률이 부풀려져 억제 게이트가 잘못 학습한다. **판정은 실제 코드 근거로만** (맹종·맹반 금지).
- 이모지 부착도 게시와 같은 outward 액션 → **승인 게이트 적용**(무엇에 👍/👎를 달지 + 답변 초안을 먼저 보고).

---

## 9. 이 레포에서 안 하는 것

- TypeORM 추가, raw SQL, `process.env` 직접, prompt 를 argv 로, mock `MockModelProvider` 외 production 분기, GitHub PAT/Slack token 코드 하드코딩, `.env` commit, 사용자 요청 없는 commit, prod 배포 자동화.

---

## 10. 도구 활용 (이 레포 한정 권장)

글로벌 OMC 가이드 (`~/.claude/CLAUDE.md`) 와 중복 회피용 — 본 레포에서 가성비 좋은 선택지만 적시.

- **Serena MCP**: 프로젝트 등록됨. 6 memories 보유 (`project_overview`, `hot_paths_and_gotchas`, `code_conventions`, `suggested_commands`, `task_completion_checklist`, `progress_tracking`). 심볼 단위 편집은 `find_symbol` + `replace_symbol_body` 우선 — `Read` 전체 파일 로드 회피.
- **context7 MCP**: NestJS / Prisma / Slack Bolt / BullMQ / class-validator / Octokit API 막힐 때 사용 (학습 데이터 cutoff 보다 최신 docs). 본 레포 의존성 전부 해당.
- **OMC subagent**: 멀티파일 변경 → `executor`, 디버깅 → `debugger`, 테스트 전략 → `test-engineer`, 보안 검토 → `security-reviewer`, 종합 리뷰 → `code-reviewer`.
- **OMC skill**: 큰 자율 작업은 `/ralph` 또는 `/autopilot`. 단 §2 #1 (commit 정책), §2 #2 (3중 green) 은 skill 도 준수.
