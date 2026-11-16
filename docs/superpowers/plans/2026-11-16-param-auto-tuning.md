# 투자 파라미터 자동 조정 루프 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주 1회 별도 프로세스가 파라미터 축 하나를 walk-forward 로 재고, 엄격 기준을 넘으면 모의투자 활성값을 CAS 로 바꾸며, 시험 기간 뒤 재생 비교로 자동 롤백한다.

**Architecture:** 새 도메인 `src/param-tune/` 에 순수 판정 함수(채택·롤백·일정)와 원장 리포지토리를 둔다. 재생이 필요한 일은 전부 `scripts/parameter-tune.ts` 자식 프로세스가 하고, autopilot task `param-tune` 은 회차 선점 → 자식 대기 → 미발송 행 발송만 한다. 값 변경은 `StrategyParameterPort.activateNewVersion` 의 4축 스냅샷 CAS 한 곳으로만 일어난다.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL), BullMQ autopilot, jest, ts-node(transpile-only) 자식 프로세스.

**Spec:** `docs/superpowers/specs/2026-11-16-param-auto-tuning-design.md` (2판, 2026-11-16 승인)

## Global Constraints

- 패키지 매니저 `pnpm` 만. ORM 은 Prisma 만, raw SQL 금지(AGENTS.md §5).
- `process.env` 직접 참조 금지 → `ConfigService.get`. 자식 스크립트는 DI 컨텍스트 밖이 아니라 Nest application context 안에서 `ConfigService` 를 쓴다.
- 새 env `PARAM_AUTO_TUNE_MODE` (`off|observe|apply`, 기본 `observe`) — `.env.example`·`.env`·`src/config/app.config.ts`·README 4곳 + `pnpm docs:sync` → `git add -f docs/env-catalog.md`.
- 탐색 입력 고정값: `from=2021-10-01`, 창 6개월·이동 6개월, 슬리피지 `[0, 0.1, 0.2]`, `includeBandless=false`.
- 격자: 익절 `[2,5,10,15,20,30]`, 손절 `[-1,-2,-3,-5,-7,-10,-15]`, 거래대금 하한 `[100_000_000, 300_000_000, 500_000_000, 1_000_000_000]`, 비중 `[15,20,25]`.
- 채택: 판정 가능 창 ≥ 6, 같은 조합을 고른 창 ≥ 4, 그중 `wonEveryCondition===true` 비율 ≥ 2/3, 평균 초과수익 차이 ≥ 0.5%p, 현행값에서 격자 한 칸 이내(넘으면 같은 방향 한 칸).
- 롤백: 시험 구간 거래일 ≥ 20 이고 새 값 청산 ≥ 5 일 때 판정, 12주(84일) 넘도록 표본 부족이면 `INCONCLUSIVE(표본 부족)`. 모든 슬리피지에서 새 값이 낮고 차이 ≥ 0.5%p 면 `ROLLBACK`. 롤백 값은 8주(56일) 제외.
- 축 회전 기준 주: `2026-11-16`(월). 순서 `EXIT_TAKE_PROFIT_PERCENT → EXIT_STOP_LOSS_PERCENT → MINIMUM_TURNOVER60 → MAXIMUM_WEIGHT_PERCENT`.
- cron 기본값 `'0 2 * * 6'`, `Asia/Seoul`. 자식 타임아웃 60분, `RUNNING` 만료 90분.
- 원장은 `AgentType.INVEST`, `modelUsed: 'deterministic'`. 새 AgentType 만들지 않는다.
- 코드 스타일: `catch (error)`, 한 줄 if 금지, try 안 `return await`, 인라인 반환 타입 금지(AGENTS.md §2).
- commit 은 사용자가 요청할 때만. 각 Task 의 Commit 단계는 요청이 있을 때 실행한다.
- 작업은 ASCII 경로의 전용 worktree 에서 하고(AGENTS.md §1), `.env` 를 메인 트리에서 복사한다.

**스펙에서 달라진 한 곳:** 스펙 §4.1 의 `probationEndsOn` 컬럼은 두지 않는다. 거래일 계산은 재생 결과의 `tradeDateCount` 가 이미 주므로, 판정 시점을 "시험 구간 재생의 거래일 ≥ 20" 으로 정하면 휴장 달력을 따로 들 필요가 없다.

## Review Focus

1. **자식이 60분 타임아웃에 걸림** — 행이 `FAILED(timeout)` 로 닫히고 자식 프로세스가 kill 돼야 한다. 좀비 자식이 나중에 결과를 쓰면 안 된다 → Task 9 테스트.
2. **observe 로 내렸는데 시험 중 값이 있음** — 롤백 평가는 계속 돌고 실제 롤백까지 일어나야 한다(신규 반영만 막힘) → Task 8 테스트.
3. **활성 행이 하나라도 없는 전략(seed 안 된 DB)** — 엄격 읽기가 실패해 그 전략만 `FAILED(활성 행 없음)`, 다른 전략은 계속 → Task 8 테스트.
4. **같은 주 재시도가 RUNNING 90분 이내 행을 만남** — 자식을 다시 띄우지 않고 "이미 실행 중" 으로 끝나야 한다 → Task 6 테스트.
5. **알릴 행이 0건인 주(판정 재사용, 변화 없음)** — Slack 에 빈 카드가 가지 않고 `skip: true, emptyReason` 이어야 하며, 결번 감시가 이를 정상 회차로 봐야 한다 → Task 10 테스트.

---

### Task 1: 원장 스키마 · 타입 · env

**Files:**
- Modify: `prisma/schema.prisma` (모델 `ParameterTuneRun` 추가, `AgentRun` 역관계 추가)
- Create: `src/param-tune/domain/param-tune.type.ts`
- Modify: `src/config/app.config.ts`, `.env.example`, `.env`, `README.md` (env 표)
- Test: `src/config/app.config.spec.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Produces (`param-tune.type.ts`):
  - `type ParamTuneMode = 'off' | 'observe' | 'apply'`
  - `type TuneRunStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED_PROBATION'`
  - `type TuneDecision = 'APPLIED' | 'WOULD_APPLY' | 'NO_CHANGE'`
  - `type TuneEvaluation = 'KEEP' | 'ROLLBACK' | 'ROLLBACK_SKIPPED' | 'INCONCLUSIVE' | 'WOULD_KEEP' | 'WOULD_ROLLBACK'`
  - `interface ParameterSnapshotEntry { name: StrategyParameterName; parameterId: number; version: number; value: number }`
  - `type ParameterSnapshot = ParameterSnapshotEntry[]` (항상 4개, `STRATEGY_PARAMETER_NAMES` 순서)
  - 상수 `TUNE_GRID: Record<StrategyParameterName, readonly number[]>`, `TUNE_SLIPPAGE_PERCENTS = [0, 0.1, 0.2]`, `TUNE_SEARCH_FROM = '2021-10-01'`, `TUNE_WINDOW_MONTHS = 6`, `TUNE_ADOPTION_MARGIN_PERCENT = 0.5`, `TUNE_ROTATION_ANCHOR = '2026-11-16'`, `TUNE_AXIS_ORDER`, `TUNE_EXCLUSION_DAYS = 56`, `TUNE_PROBATION_MAX_DAYS = 84`, `TUNE_PROBATION_MIN_TRADE_DAYS = 20`, `TUNE_PROBATION_MIN_CLOSED = 5`, `TUNE_CHILD_TIMEOUT_MS = 3_600_000`, `TUNE_RUNNING_STALE_MS = 5_400_000`

Prisma 모델 컬럼(테이블 `parameter_tune_run`, snake_case `@map`): `id`, `weekStart @db.Date`, `strategy`, `axis`, `status`, `attemptToken`, `startedAt`, `failureReason @db.Text?`, `parameterSnapshot Json?`, `verdictKey String?`, `verdict Json?`, `decision String?`, `decisionReason String?`, `previousValue Decimal? @db.Decimal(18,4)`, `candidateValue Decimal? @db.Decimal(18,4)` (APPLIED·WOULD_APPLY 의 반영(예정) 값 — observe 가상 시험과 롤백 제외 목록이 읽는다), `previousParameterId Int?`, `appliedParameterId Int?`, `appliedAt DateTime?`, `evaluation String?`, `evaluatedAt DateTime?`, `evaluationDetail Json?`, `notifiedAt DateTime?`, `agentRunId Int?` (FK SetNull), `createdAt`, `updatedAt`. `@@unique([weekStart, strategy])`, `@@index([strategy, appliedAt])`, `@@index([verdictKey])`.

- [ ] **Step 1:** `app.config.spec.ts` 에 실패 테스트 — `PARAM_AUTO_TUNE_MODE: 'apply'` 통과, `'on'` 은 검증 오류, 미설정은 통과.
- [ ] **Step 2:** `pnpm test src/config/app.config.spec.ts` → 새 케이스 FAIL.
- [ ] **Step 3:** `app.config.ts` 에 `@IsOptional() @IsIn(['off','observe','apply']) PARAM_AUTO_TUNE_MODE?: string;` (기존 L967 `@IsIn(['legacy','shadow','hybrid'])` 블록과 같은 모양). `.env.example`·`.env` 에 `PARAM_AUTO_TUNE_MODE=observe`, README env 표에 한 줄. 스키마 모델과 `param-tune.type.ts` 작성.
- [ ] **Step 4:** `pnpm prisma format && pnpm db:push && pnpm prisma:generate && pnpm test src/config/app.config.spec.ts` → PASS, db:push 출력에 DROP 없음.
- [ ] **Step 5:** `pnpm docs:sync && pnpm docs:check` → exit 0.
- [ ] **Step 6: Commit** (요청 시) `feat(param-tune): 자동 조정 원장과 모드 env 를 더한다` — `git add -f docs/env-catalog.md` 포함.

### Task 2: 엄격 읽기와 스냅샷 CAS 쓰기

**Files:**
- Modify: `src/strategy-parameter/domain/port/strategy-parameter.port.ts`
- Modify: `src/strategy-parameter/infrastructure/strategy-parameter.prisma.repository.ts`
- Test: `src/strategy-parameter/infrastructure/strategy-parameter.prisma.repository.spec.ts`

**Interfaces:**
- Consumes: `ParameterSnapshot` (Task 1)
- Produces (포트에 추가):
  - `findSnapshotStrict(strategy: StrategyParameterStrategy): Promise<ParameterSnapshot>` — 4개 이름 중 활성 행이 하나라도 없으면 `StrategyParameterSnapshotError` throw(조회 예외는 그대로 전파, fallback 금지).
  - `activateNewVersion(input: ActivateNewVersionInput): Promise<ActivateNewVersionResult>`
  - `interface ActivateNewVersionInput { strategy; name: StrategyParameterName; expectedSnapshot: ParameterSnapshot; value: number; reason: string; agentRunId: number | null }`
  - `type ActivateNewVersionResult = { kind: 'ACTIVATED'; parameterId: number; version: number } | { kind: 'CONFLICT'; actual: ParameterSnapshot }`

`activateNewVersion` 은 `prisma.$transaction` 한 번 안에서: 4축 활성 행을 다시 읽어 `(parameterId, version)` 이 `expectedSnapshot` 과 전부 같은지 비교 → 다르면 CONFLICT → 같으면 대상 행 `supersededAt = now` update 후 `version = (그 이름의 max version) + 1` create. 트랜잭션 격리는 `Serializable`, 직렬화 실패(P2034)는 CONFLICT 로 돌려준다.

- [ ] **Step 1: 실패 테스트**
  - `findSnapshotStrict` — 활성 행 3개만 있으면 `StrategyParameterSnapshotError`, 4개면 `STRATEGY_PARAMETER_NAMES` 순서로 반환.
  - `activateNewVersion` — 스냅샷 일치 시 update(supersede) 가 create 보다 먼저 호출되고 `version: 4`(max 3) 로 create, 결과 `ACTIVATED`.
  - 다른 축의 version 이 다르면 update/create 미호출, `CONFLICT`.
  - A→B→A: 값은 같고 parameterId 가 다르면 `CONFLICT`.
  - `$transaction` 이 P2034 로 reject 하면 `CONFLICT`.
- [ ] **Step 2:** `pnpm test strategy-parameter.prisma.repository` → FAIL.
- [ ] **Step 3:** 구현. 기존 `findActiveParameters` 와 `ResolveStrategyParametersUsecase` 는 건드리지 않는다.
- [ ] **Step 4:** 같은 명령 → PASS.
- [ ] **Step 5: Commit** (요청 시) `feat(strategy-parameter): 스냅샷이 맞을 때만 새 버전을 활성화한다`

### Task 3: 일정 함수 (주차 · 축 회전 · 완결 창)

**Files:**
- Create: `src/param-tune/domain/tune-schedule.ts`
- Test: `src/param-tune/domain/tune-schedule.spec.ts`

**Interfaces:**
- Produces:
  - `weekStartOf(firedAtKst: string): string` — 그 날짜가 속한 주의 월요일(YYYY-MM-DD)
  - `axisForWeek(weekStart: string): StrategyParameterName` — `TUNE_ROTATION_ANCHOR` 로부터 지난 주 수 mod 4 → `TUNE_AXIS_ORDER`
  - `lastCompletedWindowEnd(today: string): string` — `buildSearchWindows({ from: TUNE_SEARCH_FROM, to: today, windowMonths: 6, stepMonths: 6 })` 중 끝이 `today` 이전인 완결 창의 마지막 `to`. 부분 창 제외.

- [ ] **Step 1: 실패 테스트**
  - `weekStartOf('2026-11-21')` → `'2026-11-16'`, `weekStartOf('2026-11-16')` → `'2026-11-16'`, `weekStartOf('2027-01-02')` → `'2026-12-28'`.
  - `axisForWeek('2026-11-16')` → `'EXIT_TAKE_PROFIT_PERCENT'`, `+7일` → `'EXIT_STOP_LOSS_PERCENT'`, `'2026-12-28'`(W53)와 `'2027-01-04'`(W01)의 축이 서로 다르다.
  - `lastCompletedWindowEnd('2026-11-21')` → `'2026-09-30'`, `lastCompletedWindowEnd('2026-09-30')` → `'2026-03-31'`(당일 끝나는 창은 아직 완결 아님).
- [ ] **Step 2:** `pnpm test tune-schedule` → FAIL.
- [ ] **Step 3:** 구현. 날짜 연산은 `parameter-search.ts` 의 `addMonths` 와 UTC Date 를 쓴다(로컬 시간대 금지).
- [ ] **Step 4:** PASS 확인. 위 기대값이 `buildSearchWindows` 실제 출력과 다르면 테스트 기대값이 아니라 그 함수 출력을 정본으로 보고 이 문서에 적힌 값을 고친 뒤 이유를 남긴다.
- [ ] **Step 5: Commit** (요청 시) `feat(param-tune): 주차·축 회전·완결 창 계산을 더한다`

### Task 4: 채택 기준

**Files:**
- Create: `src/param-tune/domain/adoption-rule.ts`
- Test: `src/param-tune/domain/adoption-rule.spec.ts`

**Interfaces:**
- Consumes: `RobustWalkForwardVerdict[]` (`src/backtest/domain/parameter-search.ts`), `ParameterCombination`, `TUNE_GRID`
- Produces:
  - `decideAdoption(input: AdoptionInput): AdoptionDecision`
  - `interface AdoptionInput { axis: StrategyParameterName; verdicts: RobustWalkForwardVerdict[]; combinationByLabel: ReadonlyMap<string, ParameterCombination>; currentValue: number }`
  - `type AdoptionDecision = { kind: 'ADOPT'; value: number; reason: string } | { kind: 'NO_CHANGE'; reason: string }`
  - `axisValueOf(combination: ParameterCombination, axis: StrategyParameterName): number | null`

판정 순서는 스펙 §4.4 그대로: ① 판정 가능 창 < 6 → `NO_CHANGE('판정 가능 창 부족')` ② 마지막 verdict 의 `chosenLabel` 과 같은 창 < 4 → `NO_CHANGE('선택 불안정')` ③ 그 창들의 승률 < 2/3 → `NO_CHANGE('승률 미달')` ④ 그 창들에서 `byCondition` 전부의 (chosen − baseline) 평균 < 0.5 → `NO_CHANGE('개선 폭 미달')` ⑤ 후보 값 = `axisValueOf`, 현행과 같으면 `NO_CHANGE('현행 유지')`, 격자 인덱스 차가 1 초과면 같은 방향 한 칸 값.

- [ ] **Step 1: 실패 테스트** — 판정 가능 5창 → 부족; 4창 중 같은 선택 3 → 불안정; 같은 선택 6창 중 승 3 → 승률 미달; 승 4·평균 차 0.4 → 개선 폭 미달; 승 4·차 0.6·손절 후보 −10 현행 −5 → `ADOPT value: -7`(한 칸); 후보 −3 현행 −5 → `ADOPT -3`; `wonEveryCondition === null` 창은 분모에서 빠진다.
- [ ] **Step 2:** `pnpm test adoption-rule` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** (요청 시) `feat(param-tune): 자동 반영 채택 기준을 더한다`

### Task 5: 롤백 판정

**Files:**
- Create: `src/param-tune/domain/rollback-rule.ts`
- Test: `src/param-tune/domain/rollback-rule.spec.ts`

**Interfaces:**
- Produces:
  - `decideRollback(input: RollbackInput): RollbackDecision`
  - `interface ProbationReplay { slippagePercent: number; previousExcessPercent: number | null; appliedExcessPercent: number | null; appliedClosedCount: number; tradeDateCount: number; invariantViolated: boolean }`
  - `interface RollbackInput { replays: ProbationReplay[]; daysSinceApplied: number }`
  - `type RollbackDecision = { kind: 'WAIT' } | { kind: 'INCONCLUSIVE'; reason: '판정 불가' | '표본 부족' } | { kind: 'KEEP' } | { kind: 'ROLLBACK'; meanGapPercent: number }`

순서: 불변식 위반 또는 null 하나라도 → `INCONCLUSIVE('판정 불가')` / 거래일 < 20 또는 청산 < 5 → `daysSinceApplied > 84` 면 `INCONCLUSIVE('표본 부족')`, 아니면 `WAIT` / 모든 조건 applied < previous 이고 평균 gap ≤ −0.5 → `ROLLBACK` / 그 외 `KEEP`. `INCONCLUSIVE('판정 불가')` 는 확정이 아니라 다음 주 재평가 대상이다(Task 8 이 `evaluation` 을 쓰지 않는다).

- [ ] **Step 1: 실패 테스트** — 각 분기 1개씩 + 경계: 한 조건만 열세 → KEEP, 전 조건 열세·평균 gap −0.4 → KEEP, gap −0.5 → ROLLBACK, 거래일 19 → WAIT, 85일·청산 4 → INCONCLUSIVE('표본 부족').
- [ ] **Step 2:** `pnpm test rollback-rule` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** (요청 시) `feat(param-tune): 시험 기간 롤백 판정을 더한다`

### Task 6: 원장 리포지토리

**Files:**
- Create: `src/param-tune/domain/port/param-tune-run.port.ts`, `src/param-tune/infrastructure/param-tune-run.prisma.repository.ts`
- Test: `src/param-tune/infrastructure/param-tune-run.prisma.repository.spec.ts`

**Interfaces:**
- Produces (`PARAM_TUNE_RUN_PORT`):
  - `claim(input: { weekStart: string; strategy; axis; now: Date }): Promise<ClaimResult>` — `type ClaimResult = { kind: 'CLAIMED'; runId: number; attemptToken: string } | { kind: 'ALREADY_RUNNING'; runId: number } | { kind: 'ALREADY_DONE'; runId: number }`. 행이 없으면 create. `FAILED` 이거나 `RUNNING` 인데 `startedAt + 90분 < now` 면 새 토큰으로 조건부 update(`where: { id, attemptToken: old }`). `DONE`/`SKIPPED_PROBATION` 은 ALREADY_DONE.
  - `finish(input: { runId; attemptToken; patch: TuneRunPatch }): Promise<boolean>` — `updateMany where { id, status: 'RUNNING', attemptToken }`, count 1 이면 true.
  - `markFailed(input: { runId; attemptToken; reason: string }): Promise<boolean>` — 같은 조건부.
  - `interface OpenProbation { runId: number; axis: StrategyParameterName; previousValue: number; candidateValue: number; previousParameterId: number | null; appliedParameterId: number | null; startedOn: Date }`
  - `findOpenProbation(strategy): Promise<OpenProbation | null>` — `decision='APPLIED' AND evaluation IS NULL` 최신 1건, `startedOn = appliedAt`.
  - `findWouldApplyUnevaluated(strategy): Promise<OpenProbation[]>` — observe 가상 시험 대상(`decision='WOULD_APPLY' AND evaluation IS NULL`), `startedOn = createdAt`, 두 parameterId 는 null. **이 건은 시험 중 판정(SKIPPED_PROBATION)에 쓰지 않는다.**
  - `type TuneRunPatch = Partial<Pick<TuneRunRow, 'status' | 'failureReason' | 'parameterSnapshot' | 'verdictKey' | 'verdict' | 'decision' | 'decisionReason' | 'previousValue' | 'candidateValue' | 'previousParameterId' | 'appliedParameterId' | 'appliedAt'>>`, `TuneRunRow` 는 Prisma 행을 도메인 타입(Decimal→number)으로 옮긴 것.
  - `settleEvaluation(input: { runId; evaluation: TuneEvaluation; detail: unknown }): Promise<boolean>` — `where { id, evaluatedAt: null }`.
  - `findExcludedValues(input: { strategy; axis; now: Date }): Promise<number[]>` — 최근 56일 `evaluation='ROLLBACK'` 행의 적용 값.
  - `findVerdictByKey(verdictKey: string): Promise<CachedVerdict | null>`
  - `findUnnotified(): Promise<TuneRunRow[]>`, `markNotified(ids: number[], at: Date): Promise<void>`

- [ ] **Step 1: 실패 테스트** (기존 리포지토리 spec 처럼 prisma mock) — 빈 주 → CLAIMED; RUNNING 30분 전 → ALREADY_RUNNING (Review Focus 4); RUNNING 100분 전 → 새 토큰 CLAIMED, update where 에 옛 토큰; FAILED → CLAIMED; DONE → ALREADY_DONE; `finish` 가 다른 토큰이면 false; `settleEvaluation` 두 번째 호출 count 0 → false; `findExcludedValues` 가 56일 경계를 `gte now−56d` 로 거른다.
- [ ] **Step 2:** `pnpm test param-tune-run.prisma.repository` → FAIL.
- [ ] **Step 3:** 구현. 유니크 위반(P2002, 동시 create)은 재조회 후 ALREADY_RUNNING.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** (요청 시) `feat(param-tune): 회차 선점과 조건부 기록 원장을 더한다`

### Task 7: 탐색 루프 추출

**Files:**
- Create: `src/backtest/application/robust-parameter-search.ts`
- Modify: `scripts/parameter-search.ts` (루프를 새 함수 호출로 교체, 출력 형식 불변)
- Test: `src/backtest/application/robust-parameter-search.spec.ts`

**Interfaces:**
- Consumes: `ReplayBacktestUsecase`, `createReplayWindowCache`, `buildParameterGrid`, `buildSearchWindows`
- Produces:
  - `runRobustSearch(input: RobustSearchInput, replay: ReplayBacktestUsecase): Promise<RobustSearchOutput>`
  - `interface RobustSearchInput { strategy; windows: SearchWindow[]; slippagePercents: number[]; baseline: ParameterCombination; combinations: ParameterCombination[] }`
  - `interface RobustSearchOutput { conditions: ConditionOutcomes[]; baselineLabel: string; combinationByLabel: Map<string, ParameterCombination>; windowSummaries: Map<number, SearchWindowSummary[]> }`
  - `replayParameters(input: { strategy; from; to; combination; slippagePercent }, replay, cache?): Promise<ReplayBacktestResult>` — 단일 재생(Task 8 롤백 평가가 쓴다). 고정 인자는 지금 스크립트 L200-234 의 값을 그대로 옮긴다.

불변식 위반 시 throw 하는 현재 동작을 유지한다.

- [ ] **Step 1: 실패 테스트** — 가짜 replay(조합별 고정 결과)로: 창 2 × 조합 3 × 슬리피지 2 → replay 12회, `conditions` 길이 2, `combinationByLabel` 에 3개, 불변식 위반 결과가 하나 섞이면 reject.
- [ ] **Step 2:** `pnpm test robust-parameter-search` → FAIL.
- [ ] **Step 3:** 구현 후 `scripts/parameter-search.ts` 를 이 함수로 교체.
- [ ] **Step 4:** PASS. 그리고 보고 모드 회귀: `pnpm param-search --strategy SWING --from 2025-04-01 --to 2026-03-31 --stop-loss -3,-5 > after.md` 를 교체 전 커밋에서 같은 명령으로 만든 `before.md` 와 `diff` (소요 시간 줄 제외) → 차이 없음.
- [ ] **Step 5: Commit** (요청 시) `refactor(backtest): 강건 탐색 루프를 함수로 뽑는다`

### Task 8: 자동 조정 유스케이스 (자식 프로세스 본체)

**Files:**
- Create: `src/param-tune/application/run-param-tune.usecase.ts`, `src/param-tune/param-tune.module.ts`
- Test: `src/param-tune/application/run-param-tune.usecase.spec.ts`

**Interfaces:**
- Consumes: Task 2 포트, Task 3·4·5 함수, Task 6 포트, Task 7 `runRobustSearch`·`replayParameters`, `ConfigService`(`PARAM_AUTO_TUNE_MODE`)
- Produces:
  - `RunParamTuneUsecase.execute(input: { runId: number; attemptToken: string; strategy; axis; today: string; agentRunId: number | null }): Promise<void>` — 끝에 반드시 `finish` 또는 `markFailed` 중 하나를 부른다.
  - `ParamTuneModule` (imports `PrismaModule`, `BacktestModule`, `StrategyParameterModule`; **AppModule 에 넣지 않는다** — 자식 전용)

흐름(스펙 §3 a~f):
1. `findSnapshotStrict` — 실패 시 `markFailed('활성 행 없음: …')` 후 return (Review Focus 3).
2. 시험 평가: `findOpenProbation` → 있으면 구간 `[appliedAt, today]` 를 이전·새 값으로 슬리피지 3단계 재생 → `decideRollback`. `ROLLBACK` 이면 `activateNewVersion(value=이전 값, expectedSnapshot=현재 스냅샷)` — 단 현재 스냅샷의 대상 축 `parameterId !== appliedParameterId` 면 `ROLLBACK_SKIPPED`. `WAIT`·`INCONCLUSIVE('판정 불가')` 는 `settleEvaluation` 하지 않는다. **모드와 무관하게 수행** (Review Focus 2). observe 일 때는 `findWouldApplyUnevaluated` 건도 같은 판정을 `WOULD_KEEP/WOULD_ROLLBACK` 으로 기록(값 변경 없음).
3. 시험 중(평가 후에도 열린 건 존재) → `finish(status 'SKIPPED_PROBATION')`.
4. 모드 `off` → `finish(status 'DONE', decision null, decisionReason 'off')`.
5. `verdictKey = [axis, lastCompletedWindowEnd(today), snapshot 의 version 4개, excluded 값 정렬].join('|')` → 캐시 있으면 그 verdict 재사용, 없으면 `runRobustSearch` (대상 축만 `TUNE_GRID` − excluded, 나머지 축은 현행값 하나).
6. `decideAdoption` → `ADOPT` 이고 모드 `apply` 면 `activateNewVersion`; `CONFLICT` 면 `NO_CHANGE('활성값 변경 감지')`. observe 면 `WOULD_APPLY`.
7. `finish(status 'DONE', …)` — snapshot, verdictKey, verdict(창별 판정 + `chosenCombination`), decision 기록.

- [ ] **Step 1: 실패 테스트** (포트·replay 전부 mock)
  - 엄격 읽기 실패 → `markFailed` 1회, `runRobustSearch` 미호출.
  - observe + 열린 시험 + 롤백 판정 → `activateNewVersion` 이 이전 값으로 호출됨.
  - 열린 시험의 대상 축 parameterId 가 바뀜 → `settleEvaluation('ROLLBACK_SKIPPED')`, `activateNewVersion` 미호출.
  - 같은 verdictKey 캐시 존재 → `runRobustSearch` 미호출.
  - excluded 값은 탐색 격자에서 빠진다(`combinations` 에 손절 −7 없음).
  - apply + ADOPT + CONFLICT → decision `NO_CHANGE`, reason `활성값 변경 감지`.
  - observe + ADOPT → decision `WOULD_APPLY`, `activateNewVersion` 미호출.
  - off + 열린 시험 없음 → 탐색 미호출, status DONE.
- [ ] **Step 2:** `pnpm test run-param-tune.usecase` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** (요청 시) `feat(param-tune): 탐색·반영·롤백을 한 번에 도는 유스케이스`

### Task 9: 자식 진입점과 기동기

**Files:**
- Create: `scripts/parameter-tune.ts`, `src/param-tune/infrastructure/param-tune-child.launcher.ts`
- Test: `src/param-tune/infrastructure/param-tune-child.launcher.spec.ts`

**Interfaces:**
- Produces:
  - `scripts/parameter-tune.ts` — 인자 `--run-id <n> --attempt-token <t> --strategy <S> --axis <A> --today YYYY-MM-DD [--agent-run-id <n>]`, `NestFactory.createApplicationContext(ParamTuneModule)` 로 `RunParamTuneUsecase.execute` 1회 후 close. 인자 파싱 실패는 exit 2.
  - `ParamTuneChildLauncher.run(input: { args: string[]; logPath: string; timeoutMs: number }): Promise<ChildOutcome>` — `type ChildOutcome = { kind: 'EXITED'; code: number; tail: string } | { kind: 'TIMEOUT'; tail: string } | { kind: 'SPAWN_FAILED'; message: string }`. `spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'scripts/parameter-tune.ts', ...args], { cwd: <레포 루트>, stdio: ['ignore', fd, fd] })`, 타임아웃 시 `SIGTERM` → 10초 뒤 `SIGKILL`. `tail` 은 로그 마지막 20줄. 로그 디렉터리 `logs/param-tune/` 는 없으면 만든다.
  - 레포 루트는 `ConfigService` 가 아니라 `path.resolve(__dirname, '../../..')` 로 정하고 그 아래 `scripts/parameter-tune.ts` 존재를 기동 전에 확인한다(없으면 `SPAWN_FAILED`).

- [ ] **Step 1: 실패 테스트** — `child_process.spawn` 을 mock: exit 0 → `EXITED code 0`; 타임아웃(fake timers) → kill 순서 SIGTERM→SIGKILL, `TIMEOUT` (Review Focus 1); `error` 이벤트(ENOENT) → `SPAWN_FAILED`.
- [ ] **Step 2:** `pnpm test param-tune-child.launcher` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS. 그리고 실제 기동 확인: `node -r ts-node/register/transpile-only scripts/parameter-tune.ts` (인자 없음) → exit 2 와 사용법 출력.
- [ ] **Step 5: Commit** (요청 시) `feat(param-tune): 자식 진입점과 타임아웃 기동기`

### Task 10: autopilot task · 발송 · 등록

**Files:**
- Create: `src/autopilot/infrastructure/tasks/param-tune.autopilot-task.ts`, `src/param-tune/infrastructure/param-tune.formatter.ts`
- Modify: `src/autopilot/domain/autopilot.playbook.ts`, `src/autopilot/domain/autopilot.playbook-defaults.ts`, `src/autopilot/domain/autopilot-delivery-route.ts`, `src/autopilot/autopilot.module.ts` (provider·factory 인자·배열 3곳, `paperScore` 와 같은 자리), `src/autopilot/domain/ledger-gap-watch.ts`
- Test: `param-tune.autopilot-task.spec.ts`, `param-tune.formatter.spec.ts`, 기존 `autopilot.playbook.spec.ts`·`autopilot-delivery-route` spec 이 새 항목을 통과하는지

**Interfaces:**
- Consumes: Task 3 `weekStartOf`·`axisForWeek`, Task 6 포트(`claim`·`markFailed`·`findUnnotified`·`markNotified`), Task 9 launcher, `AgentRunService`
- Produces: `ParamTuneAutopilotTask` (`id = 'param-tune'`), `formatParamTuneReport(rows: TuneRunRow[]): string`

`run(context)`:
1. `AgentRunService.execute({ agentType: AgentType.INVEST, triggerType: <기존 autopilot 트리거>, inputSnapshot: { weekStart, axis }, run })` 안에서 전략 `['SWING','LONG_TERM']` 마다 `claim` → `CLAIMED` 일 때만 launcher 실행 → `EXITED code≠0`/`TIMEOUT`/`SPAWN_FAILED` 면 `markFailed(tail 포함)`. `SPAWN_FAILED` 는 마킹 뒤 throw 해서 BullMQ 재시도에 맡긴다. `modelUsed: 'deterministic'`.
2. `findUnnotified()` → 0건이면 `{ skip: true, emptyReason: '이번 주 알릴 자동 조정 없음' }` (Review Focus 5) → 있으면 `summaryText = formatParamTuneReport(rows)` 와 `onDelivered: () => markNotified(ids, new Date())`.

포매터는 행마다 한 줄: 전략·축·결정(`APPLIED -5→-7`, `WOULD_APPLY`, `NO_CHANGE(사유)`, `ROLLBACK -7→-5`, `ROLLBACK_SKIPPED`, `FAILED(사유 첫 줄)`), 롤백 줄에는 "재생 모형 비교 기준" 문구를 붙인다. LLM 출력이 아니므로 mrkdwn escape 는 사유 문자열에만 적용.

등록: 플레이북 항목 `{ id: 'param-tune', taskId: 'param-tune', trigger: { kind: 'CRON', schedule: DEFAULT_PARAM_TUNE_CRON, timezone: DEFAULT_PARAM_TUNE_TIMEZONE }, riskTier: 'T0_AUTO', line: 'invest' }` 를 `paper-score` 뒤 독립 항목으로. defaults 에 `DEFAULT_PARAM_TUNE_CRON = '0 2 * * 6'`, `DEFAULT_PARAM_TUNE_TIMEZONE = 'Asia/Seoul'`. delivery route `'param-tune': 'slack'`. `LEDGER_GAP_WATCHES` 에 `{ taskId: 'param-tune', label: '파라미터 자동 조정' }`.

- [ ] **Step 1: 실패 테스트** — claim 이 ALREADY_RUNNING 이면 launcher 미호출; TIMEOUT → `markFailed` 사유에 tail 포함; SPAWN_FAILED → markFailed 후 reject; 미알림 0건 → `skip: true` + emptyReason; 미알림 2건 → `onDelivered` 가 두 id 로 `markNotified`. 포매터 스냅샷 1개(APPLIED·ROLLBACK·FAILED 섞음).
- [ ] **Step 2:** `pnpm test param-tune` → FAIL.
- [ ] **Step 3:** 구현과 등록.
- [ ] **Step 4:** `pnpm test autopilot param-tune` → PASS, `pnpm build && node --env-file=.env scripts/check-di.cjs` → exit 0.
- [ ] **Step 5: Commit** (요청 시) `feat(autopilot): 주간 파라미터 자동 조정을 등록한다`

### Task 11: 주간 성적 카드에 자동 반영 표시

**Files:**
- Modify: `src/paper-trading/application/score-recommendations.usecase.ts` (결과에 `autoTuneAppliedCount: number` 추가 — 직전 주간 카드 이후 `appliedAt` 이 있는 `parameter_tune_run` 수, ROLLBACK 포함)
- Modify: `src/paper-trading/infrastructure/paper-score.formatter.ts`
- Test: 두 파일의 기존 spec

**Interfaces:**
- Consumes: Task 6 포트에 `countAppliedSince(since: Date): Promise<number>` 추가 (이 Task 에서 포트·리포지토리·spec 함께 수정)

- [ ] **Step 1: 실패 테스트** — 포매터: `autoTuneAppliedCount: 2` 면 `이 구간에 자동 반영 2건` 줄 포함, 0 이면 그 줄 없음.
- [ ] **Step 2:** `pnpm test paper-score` → FAIL.
- [ ] **Step 3:** 구현. `ScoreRecommendationsUsecase` 가 속한 모듈에 `PARAM_TUNE_RUN_PORT` 를 주입하려면 리포지토리만 export 하는 작은 provider 를 쓴다(`ParamTuneModule` 전체는 AppModule 에 넣지 않는다 — BacktestModule 이 딸려 온다).
- [ ] **Step 4:** PASS, `pnpm build && node --env-file=.env scripts/check-di.cjs` exit 0.
- [ ] **Step 5: Commit** (요청 시) `feat(paper-score): 자동 반영이 있던 구간을 표시한다`

### Task 12: 완료 게이트와 observe 실주행

- [ ] **Step 1:** `pnpm verify` → exit 0 (파이프 없이 실행, 종료 코드로 판정).
- [ ] **Step 2:** `pnpm check:di` → exit 0.
- [ ] **Step 3:** 실주행 — `PARAM_AUTO_TUNE_MODE=observe` 로 이번 주 행을 `claim` 한 뒤 `node -r ts-node/register/transpile-only scripts/parameter-tune.ts --run-id <id> --attempt-token <t> --strategy SWING --axis EXIT_STOP_LOSS_PERCENT --today 2026-11-21`. 기대: 행 `status=DONE`, `decision ∈ {WOULD_APPLY, NO_CHANGE}`, `strategy_parameter` 활성 행 변화 없음, 로그에 소요 시간. 같은 명령을 새 토큰으로 재실행하면 캐시 재사용으로 수 초 안에 끝남.
- [ ] **Step 4:** 실측 소요 시간과 판정 결과를 PR 본문 §검증과 검증 노트 초안에 적는다(스펙의 6~20분 추정 갱신).
- [ ] **Step 5:** PR 생성 전 사용자 확인을 받는다.

## Self-Review 결과

- 스펙 대응: §3 흐름 → T8·T10, §4.1 → T1(probationEndsOn 은 tradeDateCount 로 대체, 상단에 명시), §4.2 → T2, §4.3 → T1 상수·T3·T8, §4.4 → T4, §4.5 → T5·T8, §4.6 → T8, §4.7 → T9·T10, §5 → T6·T9·T10, §6 → T11, §8 → 각 Task + T12, §9 → T10.
- 타입 이름 일관성: `ParameterSnapshot`, `TuneRunRow`, `OpenProbation`, `ClaimResult`, `ChildOutcome` 은 정의 Task 와 사용 Task 에서 같은 이름을 쓴다.
- 미정 사항 없음. 단 Task 3 기대 날짜는 `buildSearchWindows` 실제 출력이 정본이다(Step 4 에 처리 규칙 명시).
