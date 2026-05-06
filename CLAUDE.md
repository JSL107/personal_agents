# CLAUDE.md

이대리 (Slack 멀티 에이전트) — Claude Code 가 이 레포를 토큰 효율적이고 정확하게 다루기 위한 작업 가이드.
전체 규칙은 [AGENTS.md](./AGENTS.md), 코드 컨벤션은 [CODE_RULES.md](./CODE_RULES.md).

---

## 0. 스택 사실 (틀리면 빌드부터 깨짐)

- **패키지 매니저: `pnpm@9.15.9`** — `npm` / `yarn` 사용 금지 (`packageManager` 필드로 강제).
- Node 20+, NestJS 10, Prisma 6 (TypeORM 절대 X), Slack Bolt 4, BullMQ.
- DB: **PostgreSQL @ 5434**, Redis @ 6381 (로컬 docker). 다른 포트 가정 X.
- LLM: `codex` CLI (ChatGPT 구독) + `claude` CLI (Claude Max 구독). API key 사용 X — 자식 프로세스 spawn 만.

---

## 1. 토큰 절약 — 자주 쓰는 파일은 grep/glob 하지 말고 바로 읽어라

| 의도 | 파일 |
|---|---|
| 슬래시 커맨드 핸들러 (모든 라우팅 진입점) | `src/slack/handler/agent-command.handler.ts` |
| 에이전트 → 모델 라우팅 | `src/model-router/application/model-router.usecase.ts` (`AGENT_TO_PROVIDER`) |
| CLI 격리 유틸 (보안 핵심) | `src/model-router/infrastructure/cli-process.util.ts` (`buildSafeChildEnv`) |
| 모듈 등록 한곳 | `src/app.module.ts` |
| env 검증 (class-validator) | `src/config/app.config.ts` |
| Prisma 스키마 (DB 단일 소스) | `prisma/schema.prisma` |
| 인프라 컨테이너 정의 | `docker-compose.yml` |
| AgentRun 라이프사이클 | `src/agent-run/application/agent-run.service.ts` |
| Preview Gate (외부 부작용 ✅ 게이트) | `src/preview-gate/` |

**모듈 전체 보기**: `Glob src/**/*.module.ts` (현재 29개).
**진행 추적**: `git log --oneline -20` — 커밋 메시지에 `V3 §X` 표기 있음.

### 에이전트 → 슬래시 → 진입 usecase 매핑

> 모델 매핑 source-of-truth: `src/model-router/application/model-router.usecase.ts` 의 `AGENT_TO_PROVIDER`. 아래 표는 슬래시명 + usecase 경로 (코드에 분산) 까지 한 번에 보기 위한 집약 인덱스.

| 에이전트 | 슬래시 | Usecase | 모델 |
|---|---|---|---|
| PM | `/today` | `src/agent/pm/application/generate-daily-plan.usecase.ts` | ChatGPT |
| Work Reviewer | `/worklog` | `src/agent/work-reviewer/application/generate-worklog.usecase.ts` | ChatGPT |
| Code Reviewer | `/review-pr` | `src/agent/code-reviewer/application/review-pull-request.usecase.ts` | Claude |
| BE | `/plan-task` | `src/agent/be/application/generate-backend-plan.usecase.ts` | Claude |
| PO Shadow | `/po-shadow` | `src/agent/po-shadow/application/generate-po-shadow.usecase.ts` | ChatGPT |
| Impact Reporter | `/impact-report` | `src/agent/impact-reporter/application/generate-impact-report.usecase.ts` | ChatGPT |
| BE Schema | `/be-schema` | `src/agent/be-schema/application/generate-schema-proposal.usecase.ts` | Claude |
| BE Test | `/be-test` | `src/agent/be-test/application/generate-test.usecase.ts` | Claude |
| BE SRE | `/be-sre` | `src/agent/be-sre/application/analyze-stack-trace.usecase.ts` | Claude |
| BE Fix | `/be-fix` | `src/agent/be-fix/application/analyze-pr-convention.usecase.ts` | Claude |

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

- 패턴 구현: `src/slack/handler/agent-command.handler.ts` (9개 핸들러 일관 적용)
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
- **claude --bare**: keychain/OAuth 무시 → 인증 실패. 절대 사용 X.
- **3000 포트 EADDRINUSE**: 이대리는 `PORT=3002`.
- **PrismaClient regen 누락**: schema 변경 후 `pnpm db:push` 만 하고 build 하면 type 안 맞을 수 있음 → `pnpm prisma:generate` 후 재빌드.

---

## 7. 진행 중 작업 추적

Dated reference snapshots — 단일 커밋 결정 기록, 사후 갱신 X (신규 결정은 새 파일):

- **V3 plan 인덱스**: `docs/superpowers/plans/2026-04-29-v3-roadmap.md` (#6~#11 단계별)
- **직전 audit**: `docs/superpowers/audits/2026-04-29-v3-mid-progress-audit.md` (P2 잔여 항목 §8)
- 결정 문서들: `docs/superpowers/plans/2026-04-30-mcp-rbac-decision.md` 등 (보류/deprecate 결정 명문화)

신규 plan 은 `docs/superpowers/plans/{YYYY-MM-DD}-{slug}.md` 형식.

---

## 8. commit / 리뷰 워크플로우

- 의미 단위 atomic commit. 한국어 OK. 형식: `<type>(<scope>): <subject>` ([CODE_RULES §8](./CODE_RULES.md))
- 의미 있는 변경마다 `/codex:review` 동반 (owner 의 로컬 oh-my-claudecode 명령 — Claude 가 직접 호출 X, 사용자 트리거).
- 자동화 에이전트 (Claude Code/Cursor 등) 는 자체 review 수단으로 대체 가능 — 단 사용자 명시 요청 전 commit X.

---

## 9. 이 레포에서 안 하는 것

- TypeORM 추가, raw SQL, `process.env` 직접, prompt 를 argv 로, mock `MockModelProvider` 외 production 분기, GitHub PAT/Slack token 코드 하드코딩, `.env` commit, 사용자 요청 없는 commit, prod 배포 자동화.
