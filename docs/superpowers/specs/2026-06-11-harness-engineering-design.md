# 하네스 엔지니어링 이식 설계서

- 작성일: 2026-06-11
- 대상 레포: `personal_agents` (이대리, NestJS 10 / pnpm / Prisma)
- 출처/영감: `sbe-slack-bot` 의 하네스 엔지니어링 (docs-as-code 생성 + 드리프트 게이트 + CI 강제 + 로컬 스모크 하네스)
- 상태: 설계 제안 — 사용자 리뷰 대기

## 0. 배경 · 원칙

`sbe-slack-bot` 감사에서 얻은 핵심 통찰: **"규칙은 풍부한데 자동 강제가 없다."** 이 레포도 동일 — CLAUDE.md/AGENTS.md 에 에이전트표·env 규칙이 상세하지만 모두 수동 동기다.

`sbe` 의 하네스를 *통째로 복사하지 않는다*(org 규칙: 불필요한 cross-repo 현대화 회피). 대신 **이 레포가 실제로 드리프트하는 지점**(env, 에이전트 레지스트리)에만 docs-as-code + 게이트를 적용하고, sbe 의 *철학*(코드 SoT → 문서 생성 → `--check` 로 CI 강제)을 repo-native 로 재구현한다.

이미 적용된 기반(별도 작업): `.github/workflows/ci.yml`(lint+test+build 강제), `scripts/check-env-sync.cjs`(`.env.example` ⇄ `app.config.ts` 체커), `app.config.ts` 의 `CLAUDE_MODEL` 드리프트 수정.

### 제약 (설계를 규정함)
- **`.env*` 접근 불가**: 이 작업 환경에서 `.env.example` 은 읽기/쓰기 모두 권한 차단. → 생성기는 `.env.example` 을 **생성하지 않는다**. `.env.example` 동기는 기존 `check-env-sync.cjs`(런타임 node fs 로 읽기만) 가 담당. 생성 대상은 **README 의 마킹된 섹션**뿐.
- **jest `rootDir: src`**, `testRegex: .*\.spec\.ts$`: `pnpm test` 가 수집하는 spec 은 `src/**` 아래에만. 테스트 헬퍼는 `test/` 에 두되(빌드 산출물 오염 방지) spec 은 `src/` 에 둔다.
- **commit 정책(§2 #1)**: 사용자 명시 요청 전 commit 금지. 본 작업도 검증까지만, commit 은 별도 승인.

## 1. 컴포넌트 A — 에이전트 레지스트리 SoT + 교차검증

**문제**: 에이전트 → slash/usecase/설명 메타데이터가 6+개 핸들러에 흩어져 있어 코드만으로 표를 생성할 수 없다. `AGENT_TO_PROVIDER`(agent→model)만 통합돼 있다.

**해결**: thin 메타데이터 SoT 1개 신설.

- 신규 `src/agent-registry/agent-registry.ts`
  ```ts
  export interface AgentRegistryEntry {
    agentType: AgentType;       // model-router/domain 의 enum 재사용
    displayName: string;        // "PM", "Code Reviewer", "Backend"
    slashCommands: string[];    // ["/today"]; webhook-only 에이전트는 [] 가능
    usecasePath: string;        // "src/agent/pm/application/generate-daily-plan.usecase.ts"
    description: string;        // 한 줄 설명
  }
  export const AGENT_REGISTRY: readonly AgentRegistryEntry[] = [ /* 전 에이전트 */ ];
  ```
  - `model` 은 **중복 저장하지 않는다** — 생성기/표에서 `AGENT_TO_PROVIDER[agentType]` 로 파생.
- 신규 `src/agent-registry/agent-registry.spec.ts` — 교차검증(드리프트 방지의 핵심):
  1. `AGENT_REGISTRY` 의 agentType 집합 == `AGENT_TO_PROVIDER` 키 집합 == `AgentType` enum 값 집합 (양방향). → "새 에이전트 추가 후 레지스트리/문서 누락" 차단.
  2. `slashCommands` 중복 없음, 형식 `^/[\w가-힣-]+$`.
  3. `usecasePath` 가 실제 존재하는 파일 (fs.existsSync).

> 이는 sbe 의 TEST-MANIFEST 양방향 동기 철학을 "에이전트 레지스트리"에 적용한 것.

## 2. 컴포넌트 B — sync-docs 생성기 + `--check`

- 신규 `scripts/sync-docs.cjs` (순수 node, sbe `sync-docs.cjs` 대응). 두 SoT 를 파싱:
  - **env**: `src/config/app.config.ts` — 각 속성의 이름, `@IsOptional` 유무(필수/선택), 속성 직전 `//` 주석 블록(데코레이터 라인 건너뛰고 수집)을 설명으로. → README 환경변수 표.
  - **agents**: `src/agent-registry/agent-registry.ts`(텍스트 파싱) + `model-router.usecase.ts` 의 `AGENT_TO_PROVIDER`(텍스트 파싱) → README 슬래시/에이전트 표.
- README 에 마커 삽입: `<!-- GENERATED:env:start -->` … `:end`, `<!-- GENERATED:agents:start --> … :end`. 생성기는 마커 사이만 치환. (현 수동 "환경변수"·"Slack 슬래시 커맨드" 섹션을 마커 블록으로 교체.)
- 모드:
  - `node scripts/sync-docs.cjs` → README 재생성(쓰기).
  - `node scripts/sync-docs.cjs --check` → 메모리 재생성 후 디스크와 비교, 드리프트 시 stderr + exit 1.
- pnpm scripts: `"docs:sync"`, `"docs:check"`.
- **파싱 견고성**: app.config 주석 수집은 `check-env-sync.cjs` 와 동일한 라인 기반 규칙(ALL_CAPS 속성, `@`=데코레이터, `//`=주석). 단위 동작은 구현 시 음성 픽스처로 검증.

## 3. 컴포넌트 C — 로컬 스모크/replay 하네스

**목표**: 실 Slack/LLM CLI/DB/Redis 없이 라우터 스택을 in-process 부팅해 "자연어 텍스트 → 분류 → dispatch 결정"을 재생.

**구성 (Tier-3, feasibility 정찰 확정)**: `AppModule` 부팅 안 함(=`validateEnv` 우회). NestJS `Test.createTestingModule` 로 다음만 조립:
- 모델 프로바이더 2개(`MODEL_PROVIDER_TOKENS[CHATGPT|CLAUDE]`) → mock(분류용 JSON 반환).
- `ModelRouterUsecase`, `IntentClassifierUsecase`, `IdaeriRouterUsecase` (실제 클래스).
- `AGENT_DISPATCHER_PORT` → **14개 dispatcher 전부 mock 스텁**(agentType + dispatch 반환).
- `AGENT_RUN_REPOSITORY_PORT` → mock repo(begin/finish/recordEvidence).
- `ConversationMemoryService` → Redis 없이 in-memory.

**산출물**:
- `test/harness/router-harness.ts` — 위 모듈을 조립해 컴파일된 `TestingModule` 반환(재사용 빌더). `test/` 에 둬 dist 오염 방지.
- `src/router/application/router-replay.spec.ts` — 픽스처 케이스(텍스트 → 기대 agentType + dispatch 성공). `pnpm test` 가 수집(rootDir=src).
- `scripts/harness-replay.ts` (ts-node) — `pnpm harness:replay -- --text "오늘 plan"` → 빌더 부팅 → 라우팅된 에이전트 + mock outcome 출력. 빠른 수동 스모크용.
- pnpm scripts: `"harness:replay": "ts-node scripts/harness-replay.ts"`.

**정직한 한계 (스펙에 명시)**: 모든 dispatcher 가 mock 이므로 이 하네스는 **라우터/IntentClassifier/dispatch 배선**(에이전트 등록 누락, 핸드오프 체인, 분류 파싱)을 검증할 뿐, 실 에이전트 로직(PM context 수집, GitHub/Notion 호출 등)은 검증하지 않는다. 그 부분은 기존 1025개 단위테스트가 담당. → 하네스의 가치 = "라우터 배선이 깨졌는지"의 빠른 스모크 + RouterModule 와이어링 회귀 방지.

## 4. 컴포넌트 D — CI 연동

`.github/workflows/ci.yml` 검증 단계 확장 (배포 없음 유지):
```
prisma:generate → check:env → docs:check → lint:check → test → build
```
- `docs:check` 추가 → 문서 드리프트가 머지 전 차단.
- `harness:replay` 는 수동 스모크 도구라 CI 필수 아님(스모크 spec `router-replay.spec.ts` 는 `pnpm test` 로 이미 실행됨).

## 5. 신규/변경 파일 요약

| 파일 | 종류 | 비고 |
|---|---|---|
| `src/agent-registry/agent-registry.ts` | 신규 | thin SoT (코드 구조 추가) |
| `src/agent-registry/agent-registry.spec.ts` | 신규 | 교차검증 |
| `scripts/sync-docs.cjs` | 신규 | 생성기 + `--check` |
| `test/harness/router-harness.ts` | 신규 | 스모크 모듈 빌더 |
| `src/router/application/router-replay.spec.ts` | 신규 | 스모크 spec |
| `scripts/harness-replay.ts` | 신규 | 수동 replay CLI |
| `README.md` | 변경 | GENERATED 마커 섹션으로 교체 |
| `package.json` | 변경 | `docs:sync` `docs:check` `harness:replay` |
| `.github/workflows/ci.yml` | 변경 | `docs:check` 단계 추가 |

## 6. 검증 기준 (완료 정의)

- `pnpm docs:check` → green; 의도적으로 README 마커 내용을 깨뜨리면 exit 1 (음성 테스트).
- `pnpm check:env` → green (기존).
- `agent-registry.spec.ts` 교차검증 통과; 레지스트리에서 임의 에이전트 1개 제거 시 실패(음성 테스트).
- `router-replay.spec.ts` 통과; `pnpm harness:replay -- --text "오늘 plan"` 가 PM 라우팅 출력.
- `pnpm lint:check && pnpm test && pnpm build` 3중 green (4중: + docs:check).
- commit 없음 — 사용자 승인 후 atomic commit.

## 7. 의도적 제외 (YAGNI)

- `.env.example` 자동 생성 (권한 + sbe 도 수동).
- env-catalog.json 별도 시스템 (README 생성으로 충분).
- 풀 e2e(실 에이전트 1개라도 부팅) — 에이전트당 ~8개 전이 의존성 mock 필요, 과투자.
- `.ai-context` 핸드오프 — Serena memory + docs/superpowers 와 중복.

## 8. 구현 노트 (2026-06-11, 설계 대비 변경점)

구현하며 설계 §2 에서 다음을 조정함 (이유 명시):

- **생성기는 `scripts/sync-docs.ts` (ts-node)** — `.cjs` 대신 `.ts`. 레지스트리를 텍스트 파싱하지 않고 `import` 로 안전하게 읽기 위함(멀티라인 객체 파싱 fragility 회피). `AGENT_TO_PROVIDER`(model) 만 안정적 단일라인 패턴이라 텍스트 파싱.
- **README 마커 덮어쓰기 대신 `docs/agent-catalog.md` + `docs/env-catalog.md` 별도 생성** — 현 README 의 env/슬래시 섹션이 "발췌 + 그룹핑 + 부속키 묶음"으로 잘 큐레이션돼 있어, 56개 평면 덤프로 덮으면 오히려 나빠짐. 큐레이션 README 는 보존하고 머신-정확 카탈로그를 별도 파일로 생성(+`--check` 게이트). sbe 의 env-catalog 분리 방식과 동일. (사용자 합의: "접두사 그룹 추론 보존" → env-catalog 가 접두사 그룹.)
- **교차검증은 `AGENT_TO_PROVIDER` 대신 `AgentType` enum 대조** — `AGENT_TO_PROVIDER: Record<AgentType, ...>` 타입이 provider 완전성을 컴파일타임 보장하므로, enum 일치 검사가 곧 provider 일치를 함의. (AGENT_TO_PROVIDER 는 모듈 private 이라 import 불가이기도 함.)

검증 결과: check:env / docs:check / lint:check(0 errors) / build / test(122 suites, 1035 tests) 전부 green. 게이트 음성 테스트(드리프트·레지스트리 누락 시 실패)도 확인.
