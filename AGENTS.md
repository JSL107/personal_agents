# AGENTS.md

이 파일은 자동화 에이전트(Codex CLI, Claude Code, Cursor 등) 가 이 레포를 건드릴 때 따라야 할 규칙을 한곳에 모은 안내서다. 사람이 읽어도 OK 하되 우선순위는 "에이전트가 즉시 따를 수 있는 규칙".

사람용 README: [`README.md`](./README.md)
세부 코드 규칙: [`CODE_RULES.md`](./CODE_RULES.md)
> 참고: 상위 기획서 `jarvis_agents_plan_2026.md` 는 owner 로컬에만 있고 git 추적 제외(`.gitignore`)다. 자동화 에이전트는 이 문서가 없다고 가정하고 동작해야 한다.

---

## 0. 프로젝트 한 줄 정체성

**이대리** — Slack 기반 멀티 에이전트(PM/Work Reviewer/Code Reviewer/BE) 업무 자동화 봇. NestJS + Prisma + PostgreSQL + BullMQ + Slack Bolt(Socket Mode). 모델은 ChatGPT(codex CLI) / Claude(claude CLI) 구독 쿼터로 호출(API key 불필요).

## 1. 즉시 실행 가능한 명령

| 의도 | 명령 |
|---|---|
| 의존성 설치 | `pnpm install` |
| 인프라 기동 | `pnpm db:up` (Postgres 5434 / Redis 6381) |
| 스키마 동기화 | `pnpm db:push` |
| 개발 서버 | `pnpm dev` |
| 단위 테스트 | `pnpm test` |
| 빌드 | `pnpm build` |
| 린트 검사 | `pnpm lint:check` |
| 린트 자동수정 | `pnpm lint` |

**모든 코드 변경 후 lint:check + test + build 3중 green 확인 필수.** 하나라도 실패하면 PR 불가.

## 2. DDD 폴더 구조 (이대리 컨벤션)

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

규칙 (자세히는 [CODE_RULES.md](./CODE_RULES.md)):
- 의존 방향은 **항상 바깥(interface) → 안쪽(domain)**. 역방향 금지.
- Domain Layer 는 NestJS / 외부 라이브러리에 의존 안 함 (pure TS).
- Repository 는 영속성만. 비즈니스 규칙은 Application/Domain 에.
- 변수명에 줄임말 금지(`req` → `request`), 진행형(`-ing`) 금지.
- `if` 단일 라인이라도 `{}` 필수.
- `try-catch` 안에서는 `return await` 사용 (rejection 이 catch 에서 잡히도록).

## 3. 핵심 도메인 한 줄 정리

| 도메인 | 책임 | 진입점 |
|---|---|---|
| `agent-run/` | 모든 에이전트 실행의 라이프사이클 (begin → run → finish) + EvidenceRecord 기록 | `AgentRunService.execute({...})` |
| `model-router/` | AgentType → 모델(ChatGPT/Claude/Gemini) 라우팅, CLI provider 어댑터 | `ModelRouterUsecase.route({ agentType, request })` |
| `github/` | Octokit 기반 read-only GitHub 클라이언트 (assigned issues/PRs, PR detail/diff) | `ListAssignedTasksUsecase`, `OctokitGithubClient` |
| `agent/pm/` | PM Agent — `/today` 슬래시 커맨드. 사용자 입력 + GitHub assigned + 전일 plan → DailyPlan | `GenerateDailyPlanUsecase` |
| `agent/work-reviewer/` | Work Reviewer — `/worklog` 슬래시 커맨드. 정량 근거 강제 | `GenerateWorklogUsecase` |
| `agent/code-reviewer/` | Code Reviewer — `/review-pr` 슬래시 커맨드. PR diff → Claude 리뷰 | `ReviewPullRequestUsecase` |
| `slack/` | Slack Bolt Socket Mode 어댑터 + 모든 슬래시 커맨드 핸들러 + 응답 포맷터 | `SlackService` |
| `crawler/` | Puppeteer + Cheerio + BullMQ 크롤러 (이대리에 위임 가능성으로 보존) | `POST /v1/crawl-jobs` |

## 4. 새 에이전트 / 명령 추가 시 체크리스트

1. `src/agent/{name}/domain/` 에 type / error-code enum / exception / system prompt / output parser 작성
2. `src/agent/{name}/application/{usecase}.usecase.ts` 가 `AgentRunService.execute` 안에서 `ModelRouterUsecase.route` 호출
3. 모든 외부 의존성(GitHub 등) 호출은 **graceful fallback** — 실패해도 사용자 입력만으로 진행
4. Slack 슬래시 커맨드 추가 시 `SlackService.registerCommands` 에 핸들러 + `formatXxx` 포맷터 + `ack(body)` + `respond(replace_original)` 패턴
5. `AppModule` / `SlackModule` 에 모듈 등록
6. `ResponseCode` enum 에 도메인 ErrorCode 와 1:1 동기화 항목 추가 (AllExceptionsFilter 가 매칭에 씀)
7. `src/agent-run/domain/agent-run.type.ts` 의 `TriggerType` enum 에 `SLACK_COMMAND_*` 추가
8. `src/model-router/domain/model-router.type.ts` 의 `AgentType` enum + `model-router.usecase.ts` 의 `AGENT_TO_PROVIDER` 매핑 추가
9. `src/slack/handler/agent-command.handler.ts` 의 `/retry-run` switch 에 새 `case '{AGENT_TYPE}'` 추가 (FAILURE_REPLAY 라우팅) — 새 에이전트가 FAILED 되면 재실행 가능해야 함
10. spec: parser / usecase / formatter 단위 테스트 (CODE_RULES §5)
11. README 의 슬래시 커맨드 표 + Slack 봇 설정 단계에 명령 추가
12. 새 환경변수가 필요하면 `.env.example` + `.env` + `src/config/app.config.ts` (class-validator) + README 표 4곳 동기 갱신 (§5 환경변수 규칙)
13. Slack manifest 에 슬래시 커맨드 등록 (사용자 액션, README 에 가이드 포함)

## 5. 인프라 / 보안 규칙 (절대 위반 금지)

### CLI Provider 격리
- `CodexCliProvider` / `ClaudeCliProvider` 는 **반드시** `cli-process.util.ts` 의 `buildSafeChildEnv({ cwd, homeDir })` 로 자식 프로세스 env 를 만든다.
- HOME 은 `mkdtemp` 로 throwaway 임시 디렉토리에 고정. CODEX_HOME / CLAUDE_CONFIG_DIR 는 실제 경로로 명시 (인증 보존).
- 단 현재 `SAFE_ENV_KEYS` 에는 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_CACHE_HOME` 도 부모 값 그대로 forward 된다 — XDG 가 export 된 환경에서는 자식 CLI 가 그 디렉토리들도 읽을 수 있다. 시크릿이 들어 있을 가능성이 있으면 allowlist 에서 제외하거나 throwaway 경로로 override 할 것.
- prompt 는 **argv 가 아니라 stdin** 으로 전달. `ps aux` 로 prompt 노출되면 안 됨.
- spawn 에 `cwd: workDir` 필수 — codex agent 가 repo 파일 못 읽도록.

### Credential
- `.env` 는 git 제외 (`.gitignore:35`). 절대 커밋하지 말 것.
- `docker-compose.yml` 은 `${POSTGRES_USER:?...}` 식 interpolation. 하드코딩 credential 금지 (GitGuardian).
- Slack/GitHub 토큰은 사용자가 채팅에 노출 시 즉시 rotate 권고.

### DB
- ORM 은 **Prisma 만** 사용 (TypeORM 절대 금지).
- 변경 워크플로우: `prisma/schema.prisma` 수정 → `pnpm db:push` (synchronize). 마이그레이션 파일 미생성.
- `DATABASE_URL` 은 부팅 시 `app.config.ts` class-validator 가 강제 (install 단계엔 불필요 — `prisma generate` 는 schema 파싱만).
- 포트는 5434 (Postgres) / 6381 (Redis) — 로컬에 다른 프로젝트 컨테이너와 충돌 회피 위해 분리.

### 환경변수
- `process.env` 직접 참조 금지. `ConfigService.get` 사용.
- 새 env 추가 시 `.env.example` + `.env` + `app.config.ts` (class-validator) + README 표 4곳 동기 갱신.

## 6. 모델 / CLI 라우팅

현재 매핑 (`src/model-router/application/model-router.usecase.ts` 의 `AGENT_TO_PROVIDER`):
- **PM / Work Reviewer** → ChatGPT (`codex` CLI, `codex exec`)
- **Code Reviewer / BE** → Claude (`claude` CLI, `claude -p --output-format json`)
- **Gemini** → 보조. 현재 `gemini` CLI 미설치, `MockModelProvider`.

CLI 응답 latency 10~40초. Slack `ack(body)` 즉시 + `respond(replace_original)` 패턴 강제 (사용자가 19초 침묵 X).

## 7. 코드 변경 시 동반 워크플로우

**MUST (모든 자동화 에이전트 공통):**
1. **변경 후 즉시**: `pnpm lint:check && pnpm test && pnpm build` 3중 green
2. **commit 메시지**: 한국어 OK. `<type>(<scope>): <subject>` 형식 ([CODE_RULES.md](./CODE_RULES.md) §8). subject 50자 이내, 명령형 현재시제.
3. 사용자가 명시 요청 전엔 commit 하지 않음.

**Codex CLI 사용자 한정 추가 권장**: 의미 있는 변경마다 `/codex:review` 동반 (owner 의 로컬 oh-my-claudecode 플러그인에 정의된 명령). 다른 에이전트(Claude Code/Cursor/직접 작업)는 자체 코드리뷰 수단으로 대체 가능.

## 8. 자주 마주치는 함정

- **3000 포트 EADDRINUSE**: 로컬에 다른 docker (`dockers-socket-1`) 가 점유. 이대리는 PORT=3002 분리.
- **codex CLI exit=0 인데 빈 응답**: 인증 만료/쿼터 소진. `CodexCliProvider` 가 명시 에러로 끊음.
- **claude --bare 쓰면 인증 실패**: keychain/OAuth 무시되므로 절대 사용 X.
- **Nest DI 가 `Number` provider 못 찾음**: 생성자에 default-value 파라미터 (`timeoutMs: number = 180_000`) 두면 reflection 이 Number type 으로 해석. **default 는 클래스 필드로 옮길 것**.
- **Slack ephemeral 응답에서 `replace_original: true` 가 가끔 안 먹음**: Slack API 한계. UX 퇴보는 없으니 그대로 둠.
- **Codex 가 Korean path (`기타`) 인코딩 에러**: 무시 가능. Codex 내부 텔레메트리 이슈.

## 9. 메모리 / 노트

이대리 운영 중 알게 된 항목은 commit message body 에 기록 (다른 contributor 도 git log 로 확인 가능). 개인 기획서가 있으면 거기에 동기화. 일회성 임시 노트는 [.claude](./.claude/) 가 아닌 conversation memory 에만.

특히 **PM Agent 응답 품질이 떨어지면 가장 먼저 의심할 곳**:
1. ModelRouter 매핑이 의도한 모델로 가는지 (`AGENT_TO_PROVIDER`)
2. CLI provider 의 `complete()` 가 `--ephemeral` / `--no-session-persistence` 유지 중인지 (세션 오염 방지)
3. AgentRun 의 inputSnapshot 에 prompt 가 너무 길어지진 않았는지 (GitHub task 수, 전일 plan 반복)
