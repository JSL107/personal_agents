# PO Shadow v2 — 근거 기반 정오 대조 (2026-08-19)

**Goal:** `.ai/design.md`대로 정오 실조회 사실표와 아침 계획을 결정론으로 대조하고, 이상이 없으면 모델 호출 없이 성공 원장을 남기며, 이상이 있으면 fact ID를 인용한 지적만 Slack에 노출한다.

**Architecture:** `PoShadowContextCollector`가 기존 조회 usecase 5종을 graceful하게 모은다. `buildPlanRealityFacts`가 계획과 현실을 안정 키로 대조하고 `hasPlanRealityMismatch`가 quiet 여부를 결정한다. 비-quiet 모델 출력은 JSON schema·runtime parser·`guardPoShadowReport`의 3중 경계를 거친다. formatter와 humanizer는 사실 ID/요약을 보존한다.

**Contract:** `.ai/design.md`가 source of truth다. Prisma schema/DB/env/dependency/public command를 바꾸지 않는다. `pnpm`, Node 22, 기존 DDD·명명·중괄호·`return await` 규칙을 지킨다. commit/PR/DB 명령은 실행하지 않는다.

**Rulings:**
- 설계의 `findFailedRunsSince({ sinceDays: 1 })`는 실제 API와 달라 `findFailedRunsSince({ withinMinutes: 1440 })` 및 `FailedRunDetail[]`을 사용한다. 의미는 같은 최근 24시간이다.
- `WaitingItem`에 repo/number가 없으므로 collector가 원본 PR의 URL과 분류 결과 URL을 결합해 안정 키를 복원한다. 공용 GitHub 타입은 변경하지 않는다.
- 현재 재사용 API는 assigned **open** issue/PR만 제공해 실제 merge/close를 권위 있게 확인할 수 없다. `PLANNED_MERGED` 타입과 quiet 판정은 구현하되, 조회 결과만으로 머지를 추정하지 않는다. 실물 부재는 계약대로 `PLANNED_NOT_FOUND`로 남긴다.
- `topPriority`, `morning`, `afternoon`의 같은 task ID는 한 계획 항목으로 dedup한다. 같은 사실을 여러 번 만들지 않는다.

- [x] **Task 1 — RED/GREEN: 순수 plan-reality diff.** `plan-reality.diff.spec.ts`에 exact key, `#N` fallback, 미매칭, non-GITHUB, waiting reason, unplanned assigned/mention, worker failure, merged+unverifiable quiet를 literal fixture로 먼저 추가해 feature 부재 FAIL을 확인한다. `plan-reality.diff.ts`에 `PlanRealityFact`, `buildPlanRealityFacts(plan, context)`, `hasPlanRealityMismatch(facts)`를 최소 구현하고 focused GREEN을 확인한다.
- [x] **Task 2 — RED/GREEN + mutation: 근거 guard.** `po-shadow.guard.spec.ts`에 invalid-only finding 폐기/count 증가, partial factIds 정제, 모두 폐기 시 headline/factSummary 보존을 먼저 추가해 FAIL을 확인한다. `po-shadow.guard.ts`를 구현해 GREEN으로 만든 뒤 유효 ID 필터 assertion을 일부러 깨뜨려 RED를 확인하고 즉시 복원한다.
- [x] **Task 3 — RED/GREEN: collector.** `po-shadow-context.collector.spec.ts`에 sinceHours 하한/상한, GitHub 분류 성공, 각 5개 source와 engagement 분류 reject의 null/empty graceful 결과를 먼저 추가한다. `po-shadow-context.collector.ts`는 `Promise.all`로 독립 조회를 병렬화하고 GitHub 성공 뒤 분류만 후속 호출한다. `PoShadowModule`에 `GithubModule`, `SlackCollectorModule`, `NotionModule`, collector provider를 배선한다.
- [x] **Task 4 — RED/GREEN: v2 usecase·schema·prompt.** `PoShadowReport`/shape/parser fixture를 v2로 바꾸고 `PO_SHADOW_OUTPUT_SCHEMA`를 추가한다. usecase spec에 quiet 모델 미호출+SUCCESS 원장, non-quiet fact table prompt/outputSchema, guard drop, `PRIOR_DAILY_PLAN`+`PO_SHADOW_FACT_TABLE` evidence, freshness/trigger/extra context 회귀를 먼저 고정한다. collector→facts→quiet 또는 route→parse→guard 흐름을 구현한다.
- [x] **Task 5 — RED/GREEN: 소비처.** formatter spec을 quiet 한 줄, non-quiet 근거, purposeConflict/drop count 조건부, 모든 자유텍스트 escape로 교체한다. autopilot spec에 quiet humanize skip과 non-quiet 선택 필드 윤문·fact 필드 보존을 추가한다. formatter, `humanizePoShadowReport`, autopilot task를 최소 수정한다.
- [x] **Task 6 — 통합·리뷰·문서.** 전역 v1 필드 참조와 Prisma/env/dependency 변경 부재를 확인한다. focused tests 후 `pnpm lint:check && pnpm test && pnpm build`를 fresh 실행해 모두 exit 0으로 만든다. `git diff --check`, 최종 diff와 `.ai/design.md` §1~§5 대조를 수행한다. `.ai/implementation-summary.md`에 파일별 목적, 설계 이탈, 정확한 명령/exit code, 미검증 사항, guard mutation RED를 기록한다.

## Review

- quiet 회차도 `AgentRunService.execute` 안에서 `modelUsed: deterministic`으로 SUCCESS를 남기고 모델/윤문을 호출하지 않는다.
- non-quiet 모델 출력은 strict output schema, runtime parser, fact ID guard를 순서대로 통과한다. invalid finding은 제거 수가 사용자 카드에 드러난다.
- collector는 4개 독립 source를 `Promise.all`로 시작하고 PR 분류만 GitHub 결과 뒤 수행한다. 5개 의존 경계 실패와 전체 실패가 throw 없이 degrade함을 검증했다.
- guard production 조건을 고의로 반전해 4건 RED를 확인하고 복원했다.
- 최종 독립 리뷰의 3개 minor(schema exact/nonblank, formatter index 방어, 병렬 시작 테스트)를 한 번의 fix wave로 모두 보완했고 scoped 재리뷰 READY를 받았다.
- 설계와 충돌한 잔여 risk 2건은 숨기지 않았다: open-only API 때문에 `PLANNED_MERGED`를 생성할 수 없고, GitHub 수집 실패가 quiet 긍정 headline으로 보일 수 있다. `.ai/implementation-summary.md`에 후속 설계 필요성을 기록했다.
- final fresh gate: lint exit 0(error 0/warning 57), 일반 test 417 suites/3,617 tests, code-graph 5 suites/40 tests, build exit 0, `git diff --check` exit 0.
- Prisma/env/dependency/DB는 변경하지 않았고 `db:push`, commit, PR 생성도 실행하지 않았다.

---

# 모의투자 3-B 추천 성적 채점 (2026-08-13)

**Goal:** 추천별 실제·그림자·벤치마크 성적과 계좌 지표를 정확히 집계해 CLI와 금요일 Slack 리포트로 제공한다.

**Contract:** `.ai/design.md`와 정본 §6을 따른다. 사용자 정정으로 그림자 진입·청산가는 모두 저장된 `DailyPrice.close`를 사용한다. 실제 성적은 `PaperTrade` 체결가·양쪽 비용을 쓴다. 스키마/3-A 로직/DB/git index는 변경하지 않는다.

- [x] T1 RED/GREEN: 추천 매칭, 비용 포함 실현 수익률, 3분류, 이상치·`realizedPnl` 교차검증 도메인을 구현한다.
- [x] T2/T3 RED/GREEN: 동일 저장 계열 그림자 수익률과 추천별 KOSPI 초과수익을 구현한다.
- [x] T4 RED/GREEN: 기간 제한 repository 조회, usecase, 포트폴리오 지표, Slack formatter를 구현한다.
- [x] T5 RED/GREEN: `score` CLI와 금요일 standalone autopilot task를 연결한다.
- [x] 요구 테스트 7종과 추가 경계 테스트를 확인하고 최종 diff를 독립 리뷰한다.
- [x] `pnpm lint:check`, `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm test`, `pnpm docs:check`를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- pending 상태를 `SUGGESTIONS | AWAITING_INPUT`으로 일반화했다. 새 put은 이전 상태를 덮어쓰고 둘 다 30분 뒤 만료한다.
- catch 분기는 의도 분류 실패, 비도메인 reject, 선행 체이닝, 입력 부족 되묻기, 나머지 reject 순서를 지킨다. 내부 slash 문구는 SSE에 노출하지 않고 log에만 남긴다.
- 후속 입력은 awaiting 상태를 먼저 consume해 저장 worker로 보낸다. `"3번"`도 그대로 인자가 되며 제안 번호 해석을 거치지 않는다.
- RED는 신규 분기·union·store 부재로 실패했고, focused 3 suites/30 tests가 GREEN이다. 최종 lint/test/build/docs check와 diff check 모두 exit 0이다. 전체 테스트는 일반 353 suites/2,954 tests + code-graph 5 suites/40 tests다.
- Swift/Slack/worker/env/DB/Prisma와 git index/commit/push는 변경하지 않았다.

---

# 콘솔 의도 분류 실패 → 실측 기반 할 일 제안 (2026-08-13)

**Goal:** `REMOTE_CONSOLE`의 `INTENT_CLASSIFY_FAILED`를 내부 오류 노출 대신 최근 성공 주기 기반 최대 3개 제안으로 전환하고, 번호 답변으로 선택 worker를 착수시킨다.

**Contract:** `.ai/design.md`가 source of truth다. 최근 60일 성공 최대 6건의 인접 간격 중위값으로 지연률을 계산하고, 성공 2건 미만 worker는 제외하며 `skippedUnknownCycle`로 관측한다. LLM 추가 호출, Slack 동작 변경, env/DB/Prisma, UI 레이아웃·색상 변경, commit은 금지한다.

- [x] 기존 Console/AgentRun/Router/Swift DI·타입·테스트 패턴과 worktree baseline을 확인한다.
- [x] TS RED: `SuggestNextWorkUsecase`의 주기 정규화, 미도래 제외, unknown cycle 집계, 최대 3개, busy state 제외를 고정한다.
- [x] TS GREEN: `WorkSuggestionResult`와 중위 간격·사람친화 포맷·병렬 원장 조회를 최소 구현한다.
- [x] TS RED/GREEN: `PendingSuggestionStore`의 30분 TTL과 `consume` 동작을 구현한다.
- [x] TS RED: `INTENT_CLASSIFY_FAILED` answered, 다른 `DomainException` rejected, 제안 0개 친화 오류를 고정한다.
- [x] TS GREEN: orchestrator에 제안 fallback·event·로그를 연결하고 ConsoleModule DI를 갱신한다.
- [x] TS RED/GREEN: 보관 제안의 `2번` 선택과 보관 없음 일반 경로를 `ConsoleWriteService`에 연결한다.
- [x] 공용 `parseTopicSelection` 유틸과 spec을 `src/common/util`로 이동하고 Slack import만 갱신한다.
- [x] Swift RED/GREEN: `command.answered` decoding/store 반영과 `.answered` stale 비강등 대조군을 구현한다.
- [x] Swift: `.answered` badge와 30분 완료 정리를 최소 반영하고 UI 레이아웃·색상은 보존한다.
- [x] focused RED→GREEN 근거와 최종 diff를 검토하고 설계 1~8·필수 테스트·범위 금지를 대조한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm docs:check`, `swift build`, `swift test`를 각각 fresh 실행해 exit code를 기록한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 작성한다.

## Review

- 원장 성공 간격 중위값으로 지연률을 정규화했고, 성공 2건 미만 worker는 제외·계측했다.
- 분류 실패만 회색 제안으로 전환하며 다른 도메인 오류는 기존 rejected를 유지한다. 번호 선택은 보관 제안이 있을 때만 worker hint로 해석한다.
- Swift는 answered 상태를 실패와 분리하고 30분 뒤 제거한다. 대조군 포함 TS/Swift 테스트를 추가했다.
- TS 4종 gate와 matching SDK Swift build/harness는 exit 0이다. 지정한 raw Swift 명령 2개는 system compiler/SDK 및 package testTarget 구조 때문에 exit 1이며 상세는 `.ai/implementation-summary.md`에 기록했다.
- 실제 성적은 양쪽 비용 포함 정본 식으로 계산하며 보유 중은 적중률 분모에서 제외하고 `EXPIRED`는 건수만 보고한다.
- 그림자는 진입·청산 모두 저장된 조정 계열 `DailyPrice.close`로 통일했다. 실제 시가 진입과 그림자 종가 진입의 비교 한계를 리포트에 표시한다.
- 추천별 exact KOSPI 초과수익 평균, 결손 카운터, 5/60 저장 행 그림자, non-backfilled 포트폴리오 지표를 구현했다.
- CLI와 금요일 18:10 standalone autopilot은 같은 usecase·formatter를 쓴다. 기존 digest group 선두는 바꾸지 않았다.
- 필수 7종 테스트가 각각 존재하며 최종 독립 리뷰는 READY다.
- fresh gate: lint/tsc/build/test/docs/diff check 모두 exit 0. 전체 test는 일반 356 suites/2,949 tests와 code-graph 5 suites/40 tests가 통과했다.
- DB/실데이터/Slack 통합 실행은 금지 지시에 따라 미검증이며 staging/commit/push도 수행하지 않았다.

---

# AI CLI 환경 자동 싱크 (2026-08-12)

**Goal:** `.ai/design.md` 계약대로 AI CLI 환경 스냅샷을 Autopilot에서 자동 export하고, 다른 PC 스냅샷은 PreviewGate 승인 후 hooks 없이 적용한다.

**Contract:** `.ai/design.md`가 source of truth다. `AgentType` 추가, `--with-hooks`, force push, main 직접 조작, `process.env` 직접 참조, `scripts/*.cjs` 수정, commit은 금지한다. 신규 env 6개는 `.env.example`·`.env`·`src/config/app.config.ts`·README에 동기화한다.

- [x] 필수 문서·참고 구현을 끝까지 읽고 linked worktree·clean status·baseline test를 확인한다.
- [x] 신규 태스크 2종, PreviewApplier, adapter 계약 spec을 먼저 작성하고 의도한 RED를 확인한다.
- [x] `src/ai-cli-env/` domain port/type, adapter, applier, module을 최소 구현한다.
- [x] Autopilot 태스크 2종을 구현하고 중앙 task registry에 등록한다.
- [x] `PREVIEW_KIND`, AppModule applier, 플레이북 기본값·배열 끝 항목을 계약대로 연결한다.
- [x] 신규 env 6개를 4곳에 동기화하고 docs catalog를 갱신한다.
- [x] focused test를 GREEN으로 만들고 최종 diff를 설계·금지 범위와 대조한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm check:env`, `pnpm check:invariants`, `pnpm docs:check`를 각각 fresh 실행해 exit 0을 확인한다.
- [x] `.ai/implementation-summary.md`와 아래 Review에 파일 목록·설계 이탈·실제 검증 결과·재확인 지점을 기록한다.

## Review

- AI CLI snapshot export(T0)와 cross-PC apply preview(T1), adapter/port/module, PreviewGate applier를 추가했다. bootstrap에는 hooks 관련 인자를 넘기지 않는다.
- 플레이북 두 항목은 배열 끝에 추가했고, 중앙 `AUTOPILOT_TASKS` 및 AppModule PreviewApplier에 등록했다. 지정 `AI_CLI_ENV_*_CRON/TIMEZONE`이 실제 scheduler에서 소비되도록 최소 alias를 연결했다.
- env 6개는 `.env.example`, ignored `.env`, `app.config.ts`, README에 동기화했고 `docs/env-catalog.md`를 재생성했다. 빈 repo gate와 `~/` 경로도 회귀 spec으로 고정했다.
- TDD RED는 신규 모듈/kind/cron key 부재, `~` 미확장, 빈 gate validator 실패를 확인했다. focused GREEN 후 독립 리뷰 fix wave와 재리뷰에서 Critical/Important 0건을 확인했다.
- fresh gate: lint exit 0(기존 warning 57), test exit 0(일반 332 suites/2,748 tests + code-graph 5 suites/40 tests), build/check:env/check:invariants/docs:check 모두 exit 0. `git diff --check`도 exit 0.
- 승인 SHA 불일치와 bootstrap warning 은 후속 수정에서 해소했다. 실제 private repo 인증·push와 Slack 승인 적용은 호출자가 통합 환경에서 재확인해야 한다.
- commit/stage/push/PR 없음. `scripts/*.cjs`, `AgentType` 무변경.

---

# 계획 없는 기간 worklog 생성 (#270 후속 C, 2026-08-11)

**Goal:** PM plan run이 없어도 머지 실적이 있으면 daily/weekly 회고를 생성하고, plan과 실적이 모두 없을 때만 기존 안내문으로 skip한다.

**Contract:** `.ai/design.md`. `WorklogInputSource` 시그니처와 `buildWorklogInput()` 본문, 프롬프트, DB/schema, env는 수정하지 않는다. commit/push/PR 없음.

- [x] 설계·대상 production/spec·formatter·`CODE_RULES.md`·관련 lessons를 읽고 linked worktree/baseline을 확인한다.
- [x] Task 1의 plan 0건 + 실적 있음/없음/조회 실패 spec을 추가하고 RED를 실제 확인한다.
- [x] Task 1을 최소 구현하고 focused GREEN을 확인한다.
- [x] Task 2의 대응 3개 spec을 추가하고 RED를 실제 확인한다.
- [x] Task 2를 최소 구현하고 focused GREEN을 확인한다.
- [x] skip 조건 역변이로 plan 0건 + 실적 있음 회귀 spec 실패를 확인하고 원복한다.
- [x] 설계의 5개 게이트를 각각 파이프 없이 실행해 exit code와 테스트 집계를 기록한다.
- [x] final diff·금지 범위·설계 정합성을 검토하고 `.ai/implementation-summary.md`와 아래 Review를 갱신한다.

## Review

- daily/weekly 모두 plan run이 없어도 GitHub 실적을 먼저 조회하고, 실적이 있으면 no-plan 표식과 함께 worklog를 생성한다. plan과 실적이 모두 없을 때만 기존 skip 문구를 유지한다.
- Task 1 RED 2 failures → 26 suites/252 tests GREEN, Task 2 RED 2 failures → 26 suites/254 tests GREEN을 확인했다.
- skip 조건 역변이는 대상 회귀 spec 1건을 실패시켰고 원복했다.
- 독립 리뷰 Critical/Important 0건. Minor 1건(파싱 실패 폴백 직접 assertion 부재)은 기존 spec을 보강해 해소했다.
- 최종 gate: lint/tsc/focused/full/build 모두 exit 0. focused 26 suites/254 tests, 전체 일반 307 suites/2,544 tests + code-graph 5 suites/40 tests 통과.
- 설계 이탈, 금지 파일 변경, commit/push/PR은 없다.

---

# 워커 건강진단 보고서 사실 검증 (2026-08-11)

**Goal:** 보고서의 10개 코드 주장과 3개 DB 집계를 원문·실코드·실데이터로 독립 검증한다.

- [x] 보고서 원문과 명시된 file:line을 대조한다.
- [x] fallback·BullMQ backoff·quota clamp·LLM retry 실행 의미를 검산한다.
- [x] L4 쌍 선정·주식 평단 상태·선호 학습·리뷰 판정의 상하류 호출 경로를 끝까지 추적한다.
- [ ] Postgres에서 14일 실패, daily_plan 결손, L4 밴드 쌍을 재집계한다.
- [x] 각 항목을 확인/반박/부분정확으로 판정하고 반증을 명시한다.
- [x] 결과와 미검증 리스크를 Review에 기록한다.

## Review

- 코드 10항목 대조 완료: 확인 4건, 부분정확 6건, 전면 반박 0건.
- 핵심 반증: Autopilot retry는 그룹 전멸 시에만 발동하며, L4 상위 5쌍은 신규 memory/supersede로 바뀐다. 주식 상태 줄은 평일·성공 점검 종목에 한한다.
- DB 재집계는 현재 샌드박스에서 Docker socket `permission denied`, `127.0.0.1:5434` `Operation not permitted`로 미완료. 보고서의 34/30건·daily_plan 결손·120쌍은 독립 확인하지 못했다.

---

# PR #270 리뷰 반영 A·B·D (2026-08-11)

**Goal:** 상세 조회 부분 실패를 실적 0건으로 오인하지 않고, 머지일을 KST로 표시하며, daily/weekly 실적 조회 기간의 상한을 고정한다.

**Contract:** `.ai/design-review-fix.md`가 구현 계약이다. `ListAuthorMergedPullRequestsOptions`에 옵셔널 필드 2개만 추가하고 반환 타입과 기존 production caller 3곳은 바꾸지 않는다. C, env, DB/schema, commit/push/PR은 범위 밖이다.

- [x] 변경 대상과 기존 caller 3곳의 baseline을 확인한다.
- [x] GitHub 범위 쿼리와 상세 조회 실패 정책 spec을 추가하고 RED를 확인한다.
- [x] KST 자정 경계·invalid 입력·formatter fallback spec을 추가하고 RED를 확인한다.
- [x] daily/weekly options 전달과 예외의 `evidenceUnavailableReason` 착지 spec을 추가하고 RED를 확인한다.
- [x] options/client, KST util/formatter, daily/weekly task를 최소 구현해 focused GREEN을 확인한다.
- [x] KST 변환 가드와 상세 실패 가드를 각각 제거하는 역변이로 신규 spec의 실패를 확인하고 원복한다.
- [x] 기존 production caller 3곳과 C가 수정되지 않았는지 final diff로 확인한다.
- [x] `pnpm lint:check`, `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build`를 각각 실행한다.
- [x] `.ai/implementation-summary.md`에 `## 리뷰 반영 (A·B·D)` 절과 아래 Review를 실제 결과로 기록한다.

## Review

- A: strict 상세 조회 실패는 실패/전체 건수 예외로 바꾸고, 기본 옵션은 기존 skip 동작을 보존했다.
- B: ISO 시각을 KST 날짜로 변환하며 자정 경계와 invalid/null fallback을 고정했다.
- D: daily/weekly에 다음 날 KST 00:00 상한을 전달하고 기존 caller의 하한-only 쿼리는 보존했다.
- RED 5 suites 실패, focused GREEN 5 suites/75 tests, A/B 역변이 각각 exit 1 후 원복을 확인했다.
- 최종 게이트 lint/tsc/test/build 모두 exit 0. 일반 307 suites/2,532 tests + code-graph 5 suites/40 tests 통과.
- 기존 caller 3곳과 C는 무변경. 독립 최종 리뷰 Blocker/Should Fix/Minor 0건.

**실증 (실제 GitHub 조회, KST 2026-08-10 하루)** — 유닛 테스트가 못 보는 두 가지를 실데이터로 확인했다.

- 기간 상한이 실제로 자른다: 상한 있음 9건 vs 상한 없음 17건, 결과 중 KST 8/10 이 아닌 PR 0건.
  `merged:A..B` 문법이 유효하다는 확인도 겸한다 — 잘못된 문법이면 422 없이 조용히 0건이 나올 수 있어
  쿼리 문자열 단언만으로는 못 잡는다.
- B 결함의 실제 피해 사례: `schoolbell-e/sbe-api-v5#971`·`#972` 는 UTC `2026-08-09T23:52Z` 머지로
  KST 8/10 실적인데, 기존 `slice(0, 10)` 에서는 `merged 2026-08-09` 로 출력됐을 값이다.

**후속으로 남긴 것 (리뷰 지적 C — PR #270 에서 답변만 하고 미수정)**

`WorkReviewerAutopilotTask` / `WeeklySummaryAutopilotTask` 는 PM plan run 이 0건이면 실적 조회 전에
반환한다(`work-reviewer.autopilot-task.ts` · `weekly-summary.autopilot-task.ts` 의 `runs.length === 0`
early return). 이 때문에 계획이 없는 기간에는 실적이 있어도 회고가 생성되지 않는다 — "계획에 없었는데
한 일을 드러낸다" 는 목표와 어긋난다.

이번에 고치지 않은 이유: (1) 이 PR 이 만든 결함이 아니라 기존 동작이고, (2) `agent_run` 실측에서
최근 14일 PM 실행이 매일 1건 이상 있어(8/3 만 10건) 실제 발생이 0회다. 고치면 skip 이던 자리가
실행으로 바뀌어, 계획 없는 날의 회고 형식·발송 여부·Notion 적재 기준을 다시 정해야 한다.

착수 조건: plan 0건인 날이 실제로 관측되거나(cron 실패·장기 휴가 등), 계획 없이 진행한 작업의
회고 누락이 문제로 드러날 때.

---

# Autopilot 저빈도 cron 재시도 + Toss 401 복구 (2026-08-10)

**Goal:** `.ai/design.md`의 C1/C2/C3 계약대로 전멸 그룹은 BullMQ 재시도를 살리고, 저빈도 cron은 시간 단위 backoff를 쓰며, Toss 401은 토큰을 1회 재발급한다.

**Constraints:** 세 결함을 별도 atomic commit으로 만든다. 부분 실패·skip·preview 동작은 보존한다. 신규 env, DB/schema, 스케줄 시각, model-router 정책은 건드리지 않는다.

- [x] `.ai/design.md`, repo 규칙, 세 production 대상 파일 전체를 읽는다.
- [x] 변경 전 `pnpm lint:check`, `pnpm test`, `pnpm build` baseline exit 0을 확인한다.
- [x] C1 회귀 spec RED 후 전멸 그룹 throw를 최소 구현하고 focused GREEN·review한다. (Git metadata EPERM으로 commit 보류)
- [x] C2 판별/queue option spec RED 후 저빈도 retry 정책을 최소 구현하고 focused GREEN·review한다. (Git metadata EPERM으로 commit 보류)
- [x] C3 HTTP 상태/error와 401 1회 재발급 spec RED 후 최소 구현하고 focused GREEN·review한다. (Git metadata EPERM으로 commit 보류)
- [x] consumer 실패 통지 경로와 final diff를 검토한다.
- [x] 최종 `pnpm lint:check`, `pnpm test`, `pnpm build` exit 0을 확인한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 작성한다.

## Review

- C1은 전멸 그룹을 발송 가드·슬롯 완주 표식 전에 실패시켜 BullMQ retry를 살렸다. 부분 실패·skip·preview 동작은 유지했다.
- C2는 resolved cron의 일/요일 단일 고정값을 기준으로 주간·월간 그룹에만 4 attempts / 30분 exponential backoff를 적용했다.
- C3는 구조적 HTTP status로 401만 구분해 토큰 캐시를 비우고 1회 재발급한다. 두 번째 401과 403/500/429는 추가 재시도하지 않는다.
- TDD RED/GREEN과 task별 review, 최종 2-lane review를 완료했다. 최종 gate는 lint/test/build 모두 exit 0이다.
- fully-failed group은 consumer catch에서 `publishCronFailure` 후 rethrow되므로 설정된 alert owner에게 통지되고 BullMQ retry도 유지된다.
- Git metadata `index.lock` 쓰기가 sandbox에서 거부돼 요청된 atomic commit 3개는 생성하지 못했다. 변경은 working tree에 미커밋 상태로 남아 있다.

---

# PR #246 봇 리뷰 대응 2차 (2026-08-06)

**Goal:** Study Brief 도메인 포트에서 CTO 타입 의존을 제거하고, Notion 페이지 생성 후 URL 저장만 실패한 부분 성공을 링크 발송으로 보존한다.

**Architecture:** `study-brief-cron` 도메인에 로컬 verdict DTO를 두고 consumer가 CTO 결과를 명시 변환한다. Notion `publish`와 `updateNotionUrl`의 실패 경계를 분리한다.

**Constraints:** `.env`, `pnpm db:push`, git add/commit/push를 실행하지 않는다. 기존 fallback·멱등·발송 실패 가드 단언을 약화하지 않는다.

- [x] 100블록 초과 발행의 후속 append 실패·보상 실패 회귀 spec을 먼저 추가하고 RED를 확인한다.
- [x] `NotionClientPort`에 기존 시그니처를 보존한 `archivePage`를 추가하고 `NotionApiClient`에서 `pages.update({ page_id, archived: true })`를 구현한다.
- [x] publisher가 append 실패 시 page URL/id를 포함해 아카이브 성패를 로그로 남기고 원래 append 오류를 다시 던지게 한다.
- [x] publisher·Notion adapter focused spec을 GREEN으로 만들고 정상 100블록 이하/초과 경로를 확인한다.
- [x] `.ai/implementation-summary.md`의 "봇 리뷰 대응 2차" 절에 보상 처리·TDD·검증 결과를 덧붙인다.
- [x] 최종 diff와 `pnpm lint:check && pnpm test && pnpm build`, `pnpm docs:check && pnpm check:env && pnpm check:invariants`를 검증한다.
- [x] 지침·설계·기존 포트·consumer·spec·작업 트리를 확인한다.
- [x] `publish` 성공 + `updateNotionUrl` 실패 회귀 spec을 추가하고 RED를 확인한다.
- [x] 로컬 verdict DTO와 CTO 결과 변환을 추가하고 두 포트의 CTO import를 제거한다.
- [x] Notion 발행 실패와 URL 저장 실패 경계를 분리하고 구분 가능한 warn을 남긴다.
- [x] focused spec을 GREEN으로 만들고 기존 Notion fallback·성공·미설정·멱등·발송 실패 가드를 확인한다.
- [x] `.ai/implementation-summary.md`에 "봇 리뷰 대응 2차" 절을 추가한다.
- [x] 요청된 전체 게이트, CTO import grep, final diff를 검증한다.

## Review

- `StudyBriefVerdict` 로컬 union을 추가하고 두 도메인 포트, formatter, Notion publisher가 자기 도메인 타입만 사용하게 했다. consumer만 CTO 결과를 받아 kind별 필드를 명시 복사한다.
- Notion 페이지 발행 실패는 전체 카드 fallback, URL 저장 실패는 warn 후 이미 생성된 페이지 링크 발송으로 분리했다. 두 warn 문구도 페이지 발행/URL 저장으로 구분한다.
- 100블록 초과 발행의 후속 append 실패 시 생성 페이지를 best-effort archive한다. 시도·성공·실패 로그에 page URL/id를 남기며, archive 실패는 삼키고 원래 append 오류를 다시 던진다.
- `NotionClientPort.archivePage`와 `NotionApiClient`의 `pages.update({ page_id, archived: true })` adapter를 추가했다. 기존 메서드 시그니처는 바꾸지 않았다.
- TDD RED는 URL 저장 실패 케이스가 링크 1회 대신 fallback 2회를 발송해 실패함을 확인했다. GREEN은 consumer 15건, 영향 spec 4 suites/28건 통과다.
- 후속 P2 TDD RED는 archive 호출 0회와 adapter 메서드 부재를 각각 확인했다. GREEN은 publisher·adapter 2 suites/15 tests 통과다.
- Verification: lint/test/build와 docs/env/invariants 모두 exit 0. 일반 304 suites/2,328 tests, code-graph 5 suites/40 tests 통과. lint는 기존 warning 57건, 오류 0건이다.
- `src/study-brief-cron/domain/`의 `agent/cto` grep은 0건이다. `.env`, `pnpm db:push`, git add/commit/push는 실행하지 않았다.

---

# 콘솔 4단계 — 디자인 시스템 (PR #229)

**Goal:** 화면에서 임의 여백 숫자를 없애고, 부서·통로처럼 정본이 둘이거나 우연히 정해진 값을 닫는다.

**Architecture:** 간격·글자는 `Theme.swift`(IdaeriConsole) 단일 소스. 부서는 백엔드 사규가 정본이고
앱은 `departmentFromRaw` 로 변환만. 판정이 필요한 것은 전부 `ConsoleCore`(순수)에 둬서 실행형
러너가 닿게 한다.

**Constraints:** 백엔드(`src/`) 무변경. 에셋 추가 0. 표본은 운영 스냅샷 27명 그대로.
게이트 = `swift build` + `swift run ConsoleCoreTests` 각각 exit 0.

- [x] 간격 6단계(+tight) · 모서리 3 · 점/테두리 · 레이아웃 치수 · 글자 역할 13종 정의
- [x] 대시보드 5개 뷰의 손으로 박은 숫자 15종 치환
- [x] 통로 바닥을 전용 `FloorTile.corridor` 로 승격 + 칠하기 누락 회귀 테스트
- [x] `department(for:)` 매핑 표 제거 → 백엔드 값 소비, 호출처 5곳 교체
- [x] `ConsoleAgent.replacing(...)` 으로 필드 복사 누락 차단
- [x] 전사 요약 HUD 의 고정 폰트 크기·폰트 이름 누락 수정
- [x] 실앱 확인 (대시보드·오피스 × 980x712 / 760x592)
- [x] 봇 리뷰 3건 대응 (전부 정탐 → 수정 반영 + 답변 + resolve)

## Review

- **스펙 항목의 실체가 예상과 달랐다.** "통로 바닥색 결정" 에는 통로가 없었다 — 열 0·10·20·30 이
  전부 칸막이 벽이고 문 칸조차 부서 바닥재로 덮여, 기본값은 화면에 도달하지 못하는 죽은 값이었다.
  하필 그 값(`woodA`)이 리뷰 부서 바닥재라 칠하기 누락이 생기면 위장됐다. 실질은 색 고르기가
  아니라 **누락 감지**라 판단해 회귀 테스트를 "기본값으로 남은 칸 0" 으로 세웠다.
- **부서 이관 전 전수 대조가 결함 1건을 드러냈다.** 백엔드 계약 27종 대 앱 매핑을 스크립트로
  비교하니 `REVIEW_REPLY_JUDGE` 가 백엔드=리뷰 / 앱=폴백(내부)이었다. 대조 없이 옮겼으면 사람이
  조용히 다른 방으로 갔을 것이다.
- **필드 추가의 진짜 위험은 복사 지점이었다.** `ConsoleStore` 세 곳이 필드를 손으로 나열해
  재생성하는데 기본값이 있어 컴파일러가 침묵한다 → `replacing(...)` 으로 모았다. 같은 계열의
  두 번째 함정을 리뷰봇이 잡았다 — `CharacterNode` 는 재사용되므로 부서가 바뀌어도 `init` 에서
  굳은 셔츠색이 남는다. **두 봇이 같은 지적을 한 것이 내 위험 평가가 낮았다는 신호였다.**
- 검증: 566건 통과·실패 0, CI verify pass. 실앱은 두 탭 × 두 크기에서 조판 유지 확인.
  미검증 — 요약 글자의 타일 비례는 이 창 크기에서 하한(13)에 걸려 눈으로 확인되지 않는다.
---

# 콘솔 오피스 6단계 — 성능·품질 보증

스펙: `docs/superpowers/specs/2026-08-04-office-living-product-design.md` §4 "6단계".

## 기준선 (측정으로 확정)

`ps` 누적 CPU 시간 델타 / 경과 시간. 로그는 판정 근거로 쓰지 않는다 —
"no drawables" 는 같은 조건에서도 90초당 0~7회로 요동쳐 효과 판정이 불가능하다(#183).

| 조건 | CPU | 비고 |
|---|---|---|
| 오피스 탭 · 창 보임 · 비활성 | 7.4~11.6% | 진행 0·승인 0·대기 24 (완전 유휴) |
| 대시보드 탭 | 0.3~0.6% | 연결·타이머·재동기화 등 나머지 전부 |
| 오피스 탭 · 창 최소화 | 7.9~10.8% | **안 보이는데 그대로 태운다** |

두 가지가 확정됐다. (1) 비용의 전부가 오피스 씬이다. (2) macOS 는 최소화된 창의
렌더를 알아서 멈춰주지 않는다 — #177 의 "최소화는 macOS 가 렌더를 정지한다" 는
로그를 보고 한 판단이었고 CPU 로는 사실이 아니다.

## Plan

- [x] 기준선·조건별 CPU 측정 (60초 구간, 조건은 앱이 스스로 기록해 사후 대조)
- [x] 레버 실측 — `scene.isPaused` / `preferredFramesPerSecond` / `SKView.isPaused`
      한 실행 안에서 켜기 전·후를 비교(창 크기·데이터·가시성 동일)
- [x] 창 가시성 감지 실측 — 최소화·가려짐에 통지가 실제로 오는지 앱 로그로 확인
- [x] 절전 최종 구현 + 계측 코드 제거
- [x] 접근성 — 씬 요약 한 문장(`officeAccessibilitySummary`, 순수 + 테스트)
- [x] 화면 회귀 — `scripts/console-screens.sh` 캡처 + 기준 이미지 육안 대조
- [x] 검증 — `swift build`, `ConsoleCoreTests`, 절전 효과 재측정

## Review

**레버 선택** — 한 실행 안에서 레버 켜기 전·후를 비교했다(조건 동일).

| 레버 | OFF | ON | 판정 |
|---|---|---|---|
| 없음(대조군) | 7.4% | 9.1% | 구간 간 자연 변동 ±1.7%p |
| `scene.isPaused` | 9.3% | 1.9% | **채택** |
| `SpriteView(preferredFramesPerSecond:)` | 5.9% | 9.3% | 무효 — 레버가 먹지 않음 |
| `SKView.isPaused`(`NSViewRepresentable`) | 4.8% | 0.7% | 이득 1.2%p, 렌더 경로 교체 비용이 큼 |

#183 은 "`isPaused` 는 씬 클럭만 멈추니 절감이 작을 것" 으로 봤지만, 실제로는 비용의 대부분이
렌더 루프가 아니라 24명의 몸짓·배회 경로 계산이었다. 그래서 씬 시계만 세워도 80% 가 사라진다.

**최종 검증** (최종 코드, 60초 구간, 창 900×650)

| 조건 | CPU |
|---|---|
| 창이 맨 앞(보임) | 14.6% |
| **최소화** | **0.7%** |
| 복원 | 15.1% |
| 덮개 치운 뒤(드러남) | 15.5% |

**접근성** — 접근성 트리가 `image 1 … image 10`(이름 없는 이미지 10개)에서
`AXUnknown → "완료 4명: 코드 리뷰, PO 대행, CTO, 휴가 관리. 나머지 23명 대기."` 로 바뀐 것을
실앱에서 확인했다(AX API 직접 조회 — AppleScript 로는 attributed description 을 못 읽는다).

**빌드·테스트** — `swift build` exit 0, `ConsoleCoreTests` 552건 통과(접근성 9건 추가).

**정직히 남기는 한계**
- "가려짐" 경로는 macOS 가 occlusion 을 보고할 때만 동작한다. 주 모니터 실험에서는 덮개를
  씌우자 `occ=false` → 씬 정지가 로그로 확인됐지만, 보조 모니터 실험에서는 덮개를 씌워도
  macOS 가 occluded 로 보고하지 않아 CPU 가 떨어지지 않았다(원인 미확정). **CPU 감소까지
  함께 확인된 것은 최소화 경로다.**
- 비활성(다른 앱 사용 중이지만 창은 보임)은 일부러 재우지 않는다. 절감분이 기계 전체 CPU 의
  1% 미만인데 관제 화면의 가치를 깎기 때문이다.
- 전력(W) 직접 측정은 하지 않았다(`powermetrics` 는 sudo 필요). CPU 시간으로 대신했다.

**측정 중 사고** — 측정 인스턴스를 정리하려고 `pkill -f "debug/IdaeriConsole"` 을 써서 사용자가
띄워둔 앱까지 종료시켰다(같은 경로의 같은 바이너리). 이후로는 띄울 때 받은 PID 로만 종료한다.

**후속으로 남긴 것** — 창 높이가 줄면 부서 문패가 바로 아래 이름표를 덮는다(960×820 에서 재현,
960×1050 에서는 정상). 화면 회귀 캡처를 처음 돌리자마자 드러난 조판 결함이며 이번 범위 밖이다.

---

# 오피스 5단계 — 걷기·배치·시각 정리 + 회의실·세션 (브랜치 feat/office-phase5-natural)

사용자 지적 6건에서 출발. 1~4는 시각 결함, 5~6은 미구현 기능.

- [x] 5-1 걷기가 옆으로 통통 뛰던 문제 — 걸음 그림 위에 옛 대체 연출(튐·기울임·눌림)이 겹침
- [x] 5-1 부서 문패가 각 방 세 번째 좌석 이름을 덮던 문제 — 문패 높이를 이름표에서 파생
- [x] 5-2 부서마다 다른 자리 배치 + 공용 공간(회의실·대표실·탕비실) 문패
- [x] 5-3 시간대 색막이 레터박스 여백까지 덮던 문제 · 바닥에 부서 색조 · 좁은 창 이름표 정리 · 숨쉬기 위상 분산
- [x] 5-4 체인 참여자 3명 이상이면 회의실 소집
- [x] 5-5 내 CLI 세션을 대표 앞줄에 표시 + 요약에 총계

## 검증

- ConsoleCoreTests 710건 통과(신규 84건). 대조군 확인: 옛 문패 오프셋으로 되돌리면 36건 실패.
- 실앱 확인 완료: 5-1(가림 해소·걷기 발생), 5-2(배치 분화·이름표 겹침 해소), 5-3(여백 복구·방 구분).
- 실앱 미확인: 5-4 회의 소집(3단 체인 실행 필요), 5-5 세션 표시(캡처 시점에 화면이 잠김).
- TS 게이트(lint/test/build)는 미실행 — 이번 변경은 Swift 전용이고 worktree에 node_modules 없음.

## 남은 것

- 최소 창(640×560)에서 이름표 숨김이 실제로 어떻게 보이는지 눈 확인.
- 상단 공용 밴드가 여전히 넓고 비어 있음(높이 4칸). 줄이려면 격자 규격 변경이 필요.
- 리뷰·경영 방은 인원이 적어 오른쪽 절반이 빈다.

---

# 오피스 스프라이트 시트 생성·연결

## Plan

- [x] 현재 `raw/` 시트, `build-sprites.py`, `FurnitureKind`, 평면도 배치, 시각 공백을 대조한다.
- [x] 캐릭터·가구 중 우선 대상과 정확한 셀 순서·파일명·배치 위치를 확정한다.
- [x] 기존 화풍을 참조해 새 시트를 생성하고 마젠타·셀 분리·도트 균일성·순서를 검수한다.
- [x] `build-sprites.py`로 분리하고 필요한 최소 코드·배치·회귀 테스트만 반영한다.
- [x] focused test, Swift build/test, repo 전체 gate, 최종 스프라이트를 검증한다.
- [x] 최종 diff와 기존 dirty 파일 보존을 확인하고 Review를 기록한다.

## Review

- `character-e` 시트를 짧은 단발 여성·평균 체형으로 생성했다. 생성기가 낸 근사 마젠타는 오브젝트를 보존하며 배경 판정 픽셀만 순수 `#FF00FF`로 정규화했다.
- 5개 셀을 경고 없이 분리했고 `chare-down/up/side/sit` 4장과 걸음 6장을 생성했다. 크기는 24~25 × 58~61px로 기존 시트 범위다.
- `characterSheetPrefixes`에 `chare`를 추가하고, 상한 클램프·걸음 프레임 30장·최신 시트 실배정을 회귀 테스트로 고정했다.
- 검증: 호환 SDK + `--disable-sandbox` Swift build 통과, `ConsoleCoreTests` 726건 통과, `pnpm test` 298+5 suites / 2281+40 tests 통과, `pnpm build` 통과, `git diff --check` 통과.
- 원문 `swift build`는 로컬 compiler 6.3.3과 SDK 6.3.2 불일치로 코드 compile 전 실패했다. `pnpm lint:check`는 기존 untracked `scripts/check-env-cron.ts` 4 errors로 실패했으며 범위 밖 파일은 수정하지 않았다.
- 기존 dirty `scripts/console-dev.sh`, `prop-*.png`, `ASSET-SHEET-SPEC.md`, `draw-props.py`, 진단 script들은 보존했다. commit·push 없음.
- 사용자 후속 요청으로 Swift 수정 3곳(`AgentRole.swift`, `OfficeChoreographyTests.swift`, `OfficeFloorPlanTests.swift`)을 전부 원복했다. `character-e` 에셋과 Python 생성 매핑만 남겼다.

---

# 오피스 복도 신설 — 방을 벽으로 닫고 복도로 잇는다

## 문제

- 상단 세 방(회의실·대표실·탕비실)에 벽이 없다. 벽 세우는 루프에 `y < zoneAreaRows` 가드가
  걸려 밴드 영역에는 애초에 벽을 세울 수 없었다. 세 방은 바닥재만으로 갈린다.
- 복도가 한 칸도 없다. `FloorTile.corridor` 는 있지만 화면에 0개다(테스트가 0을 고정).
  가로 이동 경로는 밴드 맨 아래 줄 하나뿐이고 그 줄도 방 바닥재라 통로로 읽히지 않는다.
- 그래서 경영방 → 내부방 이동이 다른 방 넷을 관통한다.

## 설계 — 35×19 (줄 추가 없음)

타일 크기는 `min(창너비/열, 창높이/줄)` 이고 **항상 세로가 병목**이다(창 1440×760 에서
가로 여백 200px). 36열까지는 타일 크기가 줄지 않으므로 **열 추가는 공짜, 줄 추가는 −10%**.
그래서 세로 복도는 열로 새로 내고, 가로 복도는 기존 밴드 맨 아래 줄을 전환해 쓴다.

열: `벽0 | 방1-9 | 벽10 | 복도11 | 벽12 | 방13-21 | 벽22 | 복도23 | 벽24 | 방25-33 | 벽34`

줄(그대로 19): 아래방 0-5 · 천장벽 6 · 위방 7-12 · 열림 13 · **가로복도 14** · 밴드방 15-16 · 바깥벽 17-18

- 세로 복도 x=11·23 이 y=0~16 을 관통해 가로 복도 y=14 와 ㅜㅜ 로 만난다.
- 부서 방 6개는 복도에 면한 벽마다 문 한 칸(x=10·12·22·24, y=원점+3). 기존 천장 문은 유지.
- 밴드 세 방은 세로 벽 + 복도로 갈리고, y=14 복도로 직접 열린다(방·복도 사이 벽 없음).
- `zoneWidth` 10 은 뜻을 유지하고 `zoneStride` 12 를 새로 둔다(원점 간 거리).

## Plan

- [x] `zoneStride` 도입 — 격자 폭·구역 원점·밴드 좌표를 stride 기반으로 옮긴다.
- [x] 세로 복도 2열 + 가로 복도 1줄을 `.corridor` 로 칠하고 통행 가능하게 둔다.
- [x] 밴드에 세로 벽을 세우고(y=15·16) 밴드 가구를 새 내부 범위로 옮긴다.
- [x] 부서 방 벽에 복도 문을 낸다.
- [x] 회귀 테스트: corridor 0개 검사를 "복도 칸과 정확히 일치" 로 바꾸고, 복도 연결·문·도달성을 고정한다.
- [x] `swift build --disable-sandbox` + ConsoleCoreTests + 오프스크린 렌더로 눈 확인.

## Review

### 결과

격자가 31×19 → **35×19** 가 됐다. 줄은 그대로여서 가로로 긴 창에서는 타일 크기가 변하지 않는다.

- 방 아홉 개(부서 6 + 공용 3)가 모두 벽으로 닫혔다. 위 구역 천장도 막았다 — 예전에는 그 줄이
  밴드로 나가는 유일한 출구여서 열어 둘 수밖에 없었는데, 복도가 생겨 막을 수 있게 됐다.
- 복도는 ㅜㅜ 모양이다. 세로 x=11·23 이 y=0~16 을 관통하고 가로 y=14 와 교차한다.
- 방마다 출구가 둘이다: 복도 쪽 벽의 문(y=3·10), 그리고 천장 문(y=6·13, x=8·20·32).
- 승인 대기 줄은 대표실 안이 아니라 **문 앞 복도**에 선다(그 줄이 가로 복도가 됐다).

### 복도가 보이지 않던 문제 — 두 번 고쳤다

처음 렌더는 구조만 맞고 복도가 통로로 읽히지 않았다. 눈으로 판단하지 않고 렌더 픽셀을 실측해
원인을 찾았다.

1. **너무 어두웠다.** `muteStrength 0.78` → 밝기 26.9 로 벽(87.0)의 3분의 1, 바깥벽(33.4)보다도
   어두워 바닥에 뚫린 구멍처럼 보였다. 이 값은 복도가 화면에 한 칸도 없던 시절 정해져
   **실제로 어떻게 보이는지 확인된 적이 없었다**(코드 주석이 "화면에 나오지 않는다" 고 명시).
2. **방과 같은 색이었다.** 복도 RGB (80,39,17) 이 리뷰방 (71,34,16) · 경영방 (69,33,12) 과
   거의 같았다 — 같은 `tile-wood-a` 텍스처를 재사용했기 때문이다. "부서 바닥재가 통로와 같으면
   안 된다" 는 회귀 테스트가 있었지만 `FloorTile` 값만 비교해서, 값이 다르고 텍스처가 같은
   이 경우를 통과시켰다.

다섯 텍스처가 여섯 방에 이미 쓰여 안 겹치는 선택지가 없으므로, 세라믹을 재사용하고 **밝기로**
갈랐다. 방향은 위로 잡았다 — 복도에는 사람이 지나가고, 배경이 사람보다 어두우면 셔츠의 부서
색이 죽는다. 다만 끝까지 밀면(0.30 → 밝기 184) 셔츠(186)와 겹쳐 같은 문제가 반대편에서
돌아왔다. 최종 **0.43 → 밝기 157** 로, 가장 밝은 방(115)과 42, 셔츠와 29 떨어져 있다.

### 테스트에서 배운 것

`muteStrength` 는 원본 텍스처 대비 누르는 양이라 **타일끼리 비교해도 밝기 순서를 알 수 없다**
(어두운 카펫은 값이 복도보다 작은데 화면 밝기는 66 대 157). 예전 단언은 이 비교로 만들어져
화면을 검증하지 못했고, 그 상태로 잘못된 값을 초록으로 지켜 주고 있었다. 그래서 상호 비교를
전부 걷어내고 값 범위만 고정하되, 실제 판정 근거(렌더 실측 수치)를 주석에 남겼다.

새로 고정한 것: 복도 칸 집합과 통로 타일이 **정확히 일치**(예전 "0개" 검사의 대체, 더 강하다) ·
복도 전 구간 통행 가능 · 세로·가로 복도 교차 · 방마다 복도 문 존재 · 위아래 구역 천장 문 한 칸 ·
밴드 세 방의 좌우 칸막이가 방 높이 전체를 덮음.

### 검증

- `swift build --disable-sandbox` 통과.
- `ConsoleCoreTests` **809건 통과**. 도중 2건이 실제 결함을 잡았다: 회의실 화분을 (3,15) 에
  뒀다가 회의 자리로 올라가는 유일한 통로를 막아 좌석 3개가 고립됐고(밴드 아래 줄이 복도에서
  가구줄로 올라가는 목이다), 벽·복도 밝기를 `muteStrength` 로 비교한 자기모순 단언이 걸렸다.
- 오프스크린 렌더 + 픽셀 실측으로 밝기 관계를 확인했다(복도 157 · 방 41~115 · 벽 87 · 셔츠 186).
- 기본 창(980×680)으로도 렌더해 복도·이름표가 읽히는 것을 확인했다 — `--size WxH` 옵션을 새로
  추가했다. 렌더 크기가 한 값으로 고정돼 있으면 창 비율에 따라 병목이 옮겨 가는 것을 볼 수 없다.
- `pnpm lint:check / test / build` 는 **실행하지 않았다.** 변경이 Swift 4개 파일뿐이고 TS 코드는
  0줄이다(worktree 에 node_modules 도 없다).

### 리스크 · 미검증

- **타일 크기가 창 비율에 따라 최대 11% 작아진다.** 열을 늘렸으므로 가로가 병목인 창에서만
  줄어든다: 기본 창 980×680 은 31.6 → 28.0px(-11.4%), 최소 창 640×480 은 20.6 → 18.3px(-11.4%).
  가로로 긴 창(1920×680 비율)은 세로가 병목이라 35.8px 그대로다. 가로 병목 창에서는 세로 여백도
  79 → 148px 로 늘어난다.
- **복도를 걷는 사람이 실제로 잘 보이는지는 미검증이다.** 렌더는 정지 화면이고 스냅샷이 전원
  착석 상태여서 복도에 사람이 없었다. 셔츠(186)와 복도(157)의 차이 29 가 충분한지는 걷는 모습을
  봐야 판정된다.
- 문은 "벽이 끊긴 칸" 으로만 표현된다. 문 스프라이트는 메인 트리에서 진행 중인 별도 작업 몫이라
  건드리지 않았다.
- 메인 트리의 미커밋 벽걸이 작업(`/private/tmp/idaeri-wall-balance`)과 같은 파일의 인접한 부분을
  고쳤다. 논리는 양립하지만(벽걸이는 구역 상대 x=0 벽, 복도는 구역 사이 열) 텍스트 충돌이 예상된다.
# 가구 자세 후속 시각 결함 수정 (2026-08-12)

**Goal:** lounge 자세가 캐릭터 몸만 옮겨 상태 링·이름표와 분리되는 결함을 없애고, 1칸 가구 실루엣을 보존하는 0.30칸 겹침과 앞쪽 depth를 적용한다.

**Constraints:** 전체 `CharacterNode`만 이동한다. `place`가 절대 위치·depth를 다시 잡을 때 interaction 위치 오프셋 상태도 함께 초기화한다. 책상 `officeSeatedSpriteDrop`은 보존한다. 렌더·git·TypeScript·에셋·의존성 변경은 하지 않는다.

- [x] 방향별 lounge 오프셋 순수 spec을 추가하고 RED를 확인한다.
- [x] `officeLoungeSpriteShift = 0.30`과 방향별 순수 오프셋 계산을 최소 구현한다.
- [x] `CharacterNode` 전체 위치 오프셋 적용/멱등 원복을 구현한다.
- [x] `OfficeScene.place`가 절대 배치와 interaction 오프셋 상태를 한 번에 초기화하게 한다.
- [x] sprite 전용 interaction 오프셋을 제거하고 `spriteBaseY` 기준 동작을 확인한다.
- [x] focused GREEN 후 `swift build`, `swift run ConsoleCoreTests`를 실행한다.
- [x] 최종 변경 범위·depth·책상 앉기 회귀를 검토하고 `.ai/implementation-summary.md`에 후속 절을 덧붙인다.

## Review

- 몸이 아니라 `CharacterNode.position`을 이동해 상태 링·이름표·선택 테두리·손 소품까지 함께 움직인다.
- `place`는 절대 위치를 정본으로 잡고 저장 오프셋을 초기화한 뒤 필요 시 새 기준에서 재계산한다. resize/texture 재적용은 delta 갱신이라 누적되지 않는다.
- sitting 5곳은 기존 depth 계산에서 가구보다 `+1` 앞이어서 별도 z 보정은 넣지 않았다.
- TDD RED는 신규 함수 부재 compile failure로 확인했다. 우회 환경 test `1989/1989`, 전체 build exit 0.
- 지정 명령 두 개는 기존 compiler/SDK·cache 환경 문제로 코드 컴파일 전 exit 1. 렌더·git·TypeScript·에셋·의존성 변경 없음.

---

---
# 오피스 가독성 4건 — 사람의 정체·활동·자세와 벽/길 구분 (2026-08-12)

**Goal:** 사무실 화면에서 "이 사람이 누구고 지금 무엇을 하는지", "어디가 벽이고 어디가 길인지"를
읽히게 한다.

- [x] 멈춰 있던 `feat/office-activity-bubble`(활동 말풍선) 미커밋 작업을 이 브랜치로 흡수 — 방치하면
      같은 자리를 두 세션이 고쳐 한쪽이 버려진다.
- [x] 벽 경계 외곽선 — 벽 밝기(117~127)가 바닥(72~92)과 복도(141~155)의 중간값이라 명도로는
      갈리지 않는다. 도트 그림에서 면을 가르는 수단은 외곽선.
- [x] 호버 쪽지에 직무 한 줄 — 백엔드는 `job` 을 계속 보내고 있었고(29명 전원 실측) 앱 모델에
      필드가 없어 버려졌다.
- [x] 가구 20종 자세 + 바라보는 방향 + 손 소품 (`--pose-demo` 회귀 입구 포함)
- [x] 검증: ConsoleCoreTests 1989 / pnpm lint:check·test·build 3중 green / 렌더 전후 비교

**남은 것**
- 실앱에서 8초 주기 배회가 도는 모습과 마우스 호버 쪽지 모양은 사람이 봐야 한다.
- 앉기는 `char-sit` 이 사무용 의자까지 그려진 그림이라, 소파에 앉으면 의자가 함께 보인다
  (에셋 한 장의 한계 — 새 스프라이트를 그리지 않는 선에서의 절충).

**리뷰 후속 (PR #276 에서 답변으로 남긴 것)**
- `state.changed` 이벤트에 말풍선 문구를 실어 보내기. 지금은 이벤트가 `agentType`·`state` 만
  싣고(`console.type.ts:117-120`) 문구는 스냅샷에만 있어, 화면이 상태 변경 직후 스냅샷을 한 번 더
  당겨오는 방식으로 우회했다. 근본 수정은 백엔드 이벤트 계약 변경이라 별도 PR 로 분리.
# 저녁 승인 카드에서 블로그 발행 후보 자동 생성 (2026-08-18)

**Goal:** 기존 `/blog-publish`·자연어·재실행 동작을 보존하면서 저녁 autopilot digest에 Notion 블로그 초안 1건의 GitHub 발행 승인 preview를 추가한다.

**Contract:** `.ai/task.md`와 `.ai/design.md`를 따른다. `buildPublishCandidate`는 preview를 만들지 않으며, `execute`만 기존 24시간 preview를 생성한다. 저녁 그룹 선두와 기존 schedule override는 유지한다. `.env`, DB, 배포, git index/commit은 변경하지 않는다.

- [x] 기존 usecase 반환 계약, autopilot task/playbook/module/spec, config/docs 패턴을 확인한다.
- [x] `PublishNotionDraftUsecase.buildPublishCandidate`를 부작용 없는 후보 준비 단계로 분리하고 기존 `execute` 계약을 유지한다.
- [x] `blog-github-publish` autopilot task와 empty/blocked/ready/disabled 회귀 테스트를 추가한다.
- [x] playbook 저녁 그룹 끝과 autopilot module provider를 연결한다.
- [x] `BLOG_GITHUB_PUBLISH_ENABLED`를 `.env.example`, config validation, README, 생성 문서에 동기화한다.
- [x] focused test 후 `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm docs:check`를 각각 fresh 실행한다.
- [x] 최종 diff를 설계·보안·회귀 관점에서 검토하고 `.ai/implementation-summary.md`와 Review를 실제 결과로 작성한다.

## Review

- 후보 준비는 AgentRun·Preview를 만들지 않고 `empty | blocked | ready`를 반환한다. 수동 `execute`는 기존 AgentRun 경계, 24시간 TTL, 반환 shape, retry snapshot을 유지한다.
- 신규 task는 기본 ON이며 disabled/empty/blocked/ready 4상태를 회귀 테스트로 고정했다. blocked summary는 기존 마스킹 메시지만 사용해 `term`·`excerpt`를 공개하지 않는다.
- 독립 리뷰에서 autopilot blocked 메시지가 존재하지 않는 AgentRun 원문 확인을 안내하는 결함을 찾았다. 수동 메시지는 유지하고 autopilot summary에서 해당 문구만 제거했다.
- evening 순서는 `work-reviewer`, `daily-eval`, `evening-retro-publish`, `blog-github-publish`로 고정했다. 그룹 선두와 schedule override는 그대로다.
- focused 3 suites/42 tests, 최종 lint/test/build/docs check와 diff check가 모두 exit 0이다. 전체 test는 일반 394 suites/3,288 tests와 code-graph 5 suites/40 tests다.
- `.env`, DB, Slack/GitHub 운영 쓰기, commit/staging/push는 건드리지 않았다. 실제 외부 통합은 미검증이다.

---
# 콘솔 대표 창구 대화창 승격 (2026-08-21)

**Goal:** `.ai/design.md`의 A~D 계약대로 콘솔 지시창을 맥락 보존 대화창으로 확장한다.

**Contract:** A→D 순서를 지키고, 지정 태스크에만 TDD를 적용한다. `pnpm db:push`, commit, `AppRootView.swift`, `OfficeScene.swift`, `main.swift` 수정은 금지한다. 기존 `pendingCommands` 배지와 `answerWithSuggestions` 최후 폴백을 보존한다.

- [x] T1 RED/GREEN: `HandleConversationTurnUsecase` 성공·분류 실패·그 외 예외 3분기를 테스트 먼저 추가하고 최소 구현한다.
- [x] T2: `RouterModule` providers/exports에 신규 usecase를 등록하고 build 배선을 확인한다.
- [x] T3: `PreconditionChainOrchestrator` spec을 계약으로 먼저 갱신한 뒤, 콘솔 전용 key·prior turns·대화 응답·최후 제안 폴백 배선을 구현한다.
- [x] T4 RED/GREEN: 최종 worker `formattedText`의 599/600/601자 경계를 테스트 먼저 추가하고 600자 상한 발행을 구현한다.
- [x] T5: `askForInput` 안내 문구에 현재 입력의 전달 대상을 명시한다.
- [x] T6 RED/GREEN: `ConsoleStoreTests`에 발화/응답 2턴·40턴 상한을 추가하고, `ConsoleTurn` 모델과 Store conversation 배선을 구현한다. 기존 pending 단언을 유지한다.
- [x] T7: `OfficeView.swift`의 `presidentBar`에 최대 260pt 대화 로그, 좌우 정렬, 최신 턴 자동 스크롤을 기존 `Theme.swift` 토큰만으로 구현한다.
- [x] focused 테스트와 mutation 관점 회귀 점검을 수행한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `swift build` + canonical runner 를 fresh 실행해 모두 exit 0을 확인한다.
- [x] 금지 파일·DB·commit 미변경, 계약 이탈, 최종 diff를 검토하고 `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 작성한다.
- [x] 구현과 분리된 리뷰 패스에서 Blocker 1건·Should Fix 1건을 잡아 고치고 가드를 대조군으로 검증한다.

## Review

- backend `lint=0 test=0 build=0`. Jest 436 suites / 3,847 tests + code-graph 5 suites / 40 tests 전부 통과.
- Swift `swift build` exit 0, canonical runner `swift run ConsoleCoreTests` 2,796건 exit 0.
- `swift test` 는 이 package 에 `.testTarget` 이 없어 baseline 에서도 `error: no tests found` 로
  exit 1 이다. canonical runner 가 정본이므로 test infra 는 건드리지 않았다.
- **리뷰에서 잡은 Blocker**: 빈 사용자 발화(`text: input.text ?? ''`)가 대화 기억에 user turn 으로
  쌓여, 체이닝 3-hop 이면 6턴이 5턴 한도를 밀어내 사용자의 실제 발화가 사라졌다. 빈 발화 가드 +
  `shouldRemember` 로 선행 worker turn 을 기억에서 빼 해결. 두 가드를 무력화해 새 테스트 2건이
  실제로 실패하는지 대조군으로 확인했다.
- **리뷰에서 잡은 Should Fix**: 대표 바 안에 대화 로그와 `pendingBadgeRow` 가 동시에 있어 한
  응답이 두 번 보였다. 바 안 배지만 제거하고 `idleBar` 의 배지는 남겼다.
- 동작 변화: 분류 실패 시 제안 목록 대신 대화 응답이 온다. 제안 목록은 대화 응답까지 실패할 때만
  나오므로 실질적으로 도달하지 않는다 — 이번 작업의 의도된 대체다.
- 미검증: 실앱 대화 실증(worktree 백엔드 부팅이 운영 cron 을 재등록해 지우므로 미수행), 대화 로그
  실제 렌더, 한 턴 최대 2회 codex 호출 지연 실측.
- 금지 파일, Prisma/env/dependency, DB 변경 없음.

---
# 계약 검수를 점수로 — 스텁 해제와 산출물 품질 추이 (2026-08-24)

**Goal:** 성공 실행 1,067건에서 계약 위반이 0건인 원인(스텁 24종·검사 면제 458건)을 실측 근거로 해소하고, 이진 판정을 0~1 점수로 바꿔 워커별 산출물 품질 추이를 관측 가능하게 만든다.

**Architecture:** `inspectContract`는 얇은 래퍼로 남기고, 분모(검사 항목 수)를 아는 `evaluateContract`를 새 본체로 둔다. 점수는 `agent_run.contract_score`에 기록하고 기존 `contract_violations`는 그대로 유지한다. 검사 항목이 0개인 스텁은 점수를 `null`로 남긴다 — `1.0`으로 두면 무검사가 만점으로 위장된다.

**Contract:** `deliverableFields`는 `agent_run` 실측(2026-08-24, 성공 실행 전건 100% 등장)만 근거로 채운다. 표본 n≤2·usecase 분기로 형태가 갈리는 워커·실행 0건 워커는 스텁을 유지한다. 금칙어 목록은 실측 적중이 0건이지만 추측으로 늘리지 않는다. LLM 검수는 도입하지 않는다(결정론 검사만). 차단 모드 전환·회귀 게이트는 이번 범위 밖.

- [x] 실측 기반으로 스텁 7종(CTO·HUMANIZER·SUBCONSCIOUS_GATE·EVENING_RETRO·PAPER_RECOMMEND·PAPER_TRADE·BLOG_PUBLISH)의 `deliverableFields`를 채운다.
- [x] `skipPreamble` 플래그를 추가해 HUMANIZER의 프롬프트 머리말 주입만 차단한다(입력 텍스트를 그대로 다듬는 워커라 머리말이 산출물을 오염시킨다 — 설계문서 §3.6 경고).
- [x] RED/GREEN: `evaluateContract`가 분모·분자·점수를 내고, 검사 항목 0개면 `null`을 돌려준다.
- [x] RED/GREEN: 금칙어는 분모에 넣지 않고 적중 시 분자에서만 차감한다(공짜 만점 방지).
- [x] `agent_run.contract_score Float?` 추가 + repository port·prisma repository·service 기록 배선.
- [x] `check-contract-violations.ts`에 워커별 평균 점수와 주별 추이를 추가한다.
- [x] 계약 무결성 테스트: 채운 계약의 필드가 실측 목록과 일치, `skipPreamble`이 켜진 계약은 `buildContractPreamble`이 null.
- [x] `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check` 4중 green.
- [x] 실측 재실행으로 위반·점수 분포가 0%를 벗어났는지 확인하고 정직하게 보고한다.
- [x] 리뷰 수정: `skipPreamble` 적용 범위를 HUMANIZER 1종 → 조립 output 5종으로 넓힌다.
- [x] 리뷰 수정: `passedCount` 에서 금칙어 차감을 걷어내 이름과 의미를 맞춘다(차감은 `score` 만).
- [x] 리뷰 수정: 주별 추이의 주 경계를 UTC → KST 로 옮긴다(`started_at` 은 UTC 저장).
- [x] `agent_run.contract_score` 컬럼 추가 — `pnpm db:push` 대신 `ALTER TABLE` 한 줄만 직접
      실행했다. diff 첫 줄이 `DROP INDEX "idx_episodic_memory_embedding"`(Prisma 스키마에 없는
      pgvector 수동 인덱스)여서 push 를 돌리면 벡터 검색이 죽는다. 실행 전후로 인덱스 3 개를
      직접 조회해 그대로 살아 있음을 확인했다.
- [x] 실앱 경로 실증 — `AgentRunService.execute` 를 직접 조립해(AppModule 미부팅) 4 케이스가
      DB 에 기록되는지 확인하고 검증 행을 삭제했다.

## Review

- **훔친 것**: Mastra Evals 의 Scorer 개념 — 계약 검수를 통과/위반 이진에서 0~1 점수로 바꿨다.
  회귀 게이트(과거 산출물을 고정 평가셋으로 삼아 배포 전 점수 하락 검사)는 이번 범위 밖이다.
  기준선이 이번 계약 변경으로 흔들리므로, 점수 분포가 안정된 뒤 붙이는 것이 맞다.
- **실측이 드러낸 것**: 위반 0/1,067 건은 "다 지킨다" 가 아니라 "검사기가 잡을 게 없다" 였다.
  32 종 중 24 종이 스텁이어서 실행 458 건(43%)이 무검사였고, 공통 금칙어 4 개의 적중은
  1,067 건에서 0 건이었다. 계약 파일이 예고한 "위반 통계를 보고 2단계를 판단한다" 는 통계가
  0 이라 영구히 판단할 수 없는 상태였다.
- **성과**: 무검사 실행 458 → 157 건(43% → 14.7%). 301 건이 검사망에 들어왔고 점수 축과
  주별 추이가 생겼다.
- **정직한 한계**: 모든 점수가 1.000 이다. 계약을 "실측 전건 100% 등장 키" 로 채웠으므로 과거
  데이터에 대해서는 정의상 만점이다. 이 변경의 실익은 지금 드러나는 결함이 아니라 **기준선**
  이다 — 지금까지 항상 있던 필드가 앞으로 빠지면 점수가 내려간다.
- **계측기가 실제로 무는지는 실데이터로 확인했다**: 채운 7 종의 최근 실행에서 필수 필드를
  하나씩 지우고 금칙어를 주입해 점수 하락을 대조했다. 21 개 필드 삭제와 7 개 금칙어 주입
  전부 하락, "변화없음" 0 건.
- **리뷰에서 잡은 Blocker**: `deliverableFields` 가 두 뜻으로 쓰인다는 것을 놓쳤다. 검수기는
  `agent_run.output` 의 키로 읽지만 프롬프트 머리말은 "모델이 낼 응답의 키" 로 적어 보낸다.
  PAPER_RECOMMEND·PAPER_TRADE·SUBCONSCIOUS_GATE·BLOG_PUBLISH·HUMANIZER 는 output 을 usecase 가
  조립하므로, 머리말이 모델에게 **존재하지 않는 스키마를 요구**해 응답 파서를 깨뜨릴 수
  있었다. `skipPreamble` 을 5 종으로 넓혀 막았다. CTO·EVENING_RETRO 는 output 이 모델 응답
  그대로라(전자는 `result: output` + 타입가드, 후자는 프롬프트가 같은 키를 직접 요구) 유지했다.
- **동작 변화**: CTO·EVENING_RETRO 프롬프트에 사규 머리말(약 200 바이트)이 새로 붙는다.
  실측 근거로 필드를 뽑았고 EVENING_RETRO 는 기존 프롬프트가 같은 키를 이미 요구하지만,
  **실제 모델 호출로 산출물이 그대로인지는 검증하지 못했다.**
- **실앱 경로 실증(2026-08-24)**: `AgentRunService.execute` 를 직접 조립해 — AppModule 을
  부팅하면 운영 중 서비스의 repeatable job 을 재등록하므로 — 네 케이스를 돌리고 DB 를 조회했다.
  준수 `score=1`, 필드 누락 `score=0` + violations 기록, CTO 3 필드 중 1 개 누락 `score=0.667`,
  스텁 계약(INVEST) `score=null`. 경고 로그도 실제로 찍혔다. 검증 행 4 건은 삭제해 원장을
  오염시키지 않았다(잔존 0 건 확인).
- **DB 변경**: `pnpm db:push` 를 쓰지 않았다. diff 첫 줄이 `DROP INDEX
  "idx_episodic_memory_embedding"` 로, Prisma 스키마에 없는 pgvector 수동 인덱스를 함께 지운다.
  `ALTER TABLE "agent_run" ADD COLUMN IF NOT EXISTS "contract_score" DOUBLE PRECISION;` 만
  실행하고, 전후로 `pg_indexes` 를 직접 조회해 인덱스 3 개가 그대로임을 확인했다. 이 pgvector
  드리프트는 이번 작업과 무관한 기존 문제로 남아 있다.
- **미검증**: CTO·EVENING_RETRO 에 머리말이 새로 붙은 뒤 실제 모델 호출로 산출물 형식이
  그대로인지, 점수가 1.000 을 벗어나는 실제 회귀 관측.
# 과거 시세 확장 수집 구현 (2026-08-25)

**Contract:** `.ai/design.md` 변경 대상 1~9와 필수 테스트 전체. 기존 `CollectUniversePricesUsecase`, `prisma/schema.prisma` 불변. DB·외부 API 호출 및 `pnpm db:push` 금지.

- [x] baseline 테스트와 기존 코드 패턴을 확인한다.
- [x] RED/GREEN: market-data port·Toss/Yahoo adapter·저장 통계 계약과 단위 테스트를 구현한다.
- [x] RED/GREEN: 커서 조립 helper와 `BackfillUniversePricesUsecase` 필수 5개 동작 테스트를 구현한다.
- [x] RED/GREEN: backfill 요약 formatter와 CLI `backfill-prices` parser 테스트를 구현한다.
- [x] `scripts/screener.ts`와 `ScreenerModule`에 신규 경로를 배선한다.
- [x] 금지 파일·기존 일일 수집 경로 불변 및 전체 diff를 검수한다.
- [x] `pnpm lint:check && pnpm test && pnpm build`를 모두 exit 0까지 반복한다.
- [x] `.ai/implementation-summary.md`에 파일 목록·설계 이탈·실제 게이트 출력을 기록한다.

## Review

- `.ai/design.md` §1~9와 필수 테스트 전부 구현. 비진전 cursor는 두 번째 fetch에서 `exhausted`로 끝나며 같은 페이지는 재저장하지 않는다.
- 기존 mapper가 raw Toss 순서를 오름차순으로 정렬하므로 application에서는 가장 오래된 봉을 날짜 최솟값으로 고른다.
- `CollectUniversePricesUsecase`, `prisma/schema.prisma` 무변경. DB/API 호출, `pnpm db:push`, commit, PR 없음.
- 독립 리뷰: Critical 0, 코드 계약 §1~9 통과. Minor는 failures 20건 cap·200종목 progress log 전용 테스트 부재이며 설계 필수 테스트 범위 밖이라 보류.
- 전체 gate: lint exit 0(0 errors, 기존 warning 57), test 439 suites/4,015 tests + code-graph 5 suites/40 tests, build exit 0.

---
