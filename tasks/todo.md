# PR #303 리뷰 2건 반영 — 밴드 복도 관통·리사이즈 중복 판정 (2026-08-13)

**Goal:** 밴드와 부서 격자가 어긋나도 세로 복도가 방 내부를 관통하지 않게 하고, 리사이즈 배치 변경 판정을 `sync` 한 곳에 둔다.

**Contract:** c=3의 밴드 경계 복도는 상단까지 유지한다. c=2 특수 분기는 금지한다. 일반 데이터 갱신의 `rebuildPlan = true` 동작은 유지한다. `departmentDeskSpots`·`departmentFurnitureSpots`·`fallbackDeskSpots`, GUI, git index/commit은 건드리지 않는다.

- [x] RED: c=2·c=3 모두에서 각 밴드 방 내부 바닥이 `.corridor`가 아니고 `presidentTile`이 방 바닥임을 단언한다.
- [x] RED 증명: 현재 구현에서 c=2의 `(11,23)`·`(11,24)`와 대표 자리가 실패하는지 focused runner로 확인한다.
- [x] GREEN: 복도 열이 밴드 span 끝 경계에 정렬된 경우에만 `wallableRows`까지 연장하고, 그 외에는 `corridorRow`에서 끊는다.
- [x] Scene 정리: `didChangeSize`의 중복 `officeZoneColumns` 계산을 제거하고 `sync(..., rebuildPlan: false)`로 판정 주체를 단일화한다. 기본값 `true`는 유지한다.
- [x] Mutation RED: 밴드 경계 가드를 고의로 제거해 신규 테스트가 실패하는지 확인한 뒤 복원한다.
- [x] VERIFY: `swift build`, `swift run ConsoleCoreTests`, `git diff --check`, 금지 심볼 diff를 fresh 실행하고 2,318건 이상인지 확인한다.
- [x] `.ai/implementation-summary.md`에 변경·red/green/mutation·게이트 결과를 덧붙이고 아래 Review를 채운다.

## Review

- 복도 열이 `bandSpans.dropFirst()`의 시작 바로 왼쪽 경계인지 계산한다. c=3의 11·23은 상단까지 유지되고 c=2의 11은 가로 복도에서 끝난다.
- 신규 단언은 수정 전과 가드 mutation에서 모두 같은 3건을 잡았다: c=2 대표실 `(11,23)`·`(11,24)`과 대표 자리.
- 독립 리뷰가 c=3 상단 연장의 직접 단언 공백을 찾았다. x=11·23의 밴드 구간을 `.corridor`로 고정했고, 경계 집합을 비우는 mutation에서 신규 4건과 기존 1건이 실패했다.
- `didChangeSize`는 `sync(..., rebuildPlan: false)`만 호출한다. 창 크기 기반 layout 판정은 `sync`가 한 번만 수행하고, 일반 데이터 sync의 기본값 `true`는 유지한다.
- `officeZoneColumns`의 최초 선택·동률·양방향 5% 히스테리시스 8건은 기존 `ConsoleCoreTests`가 이미 검증한다. Package 타깃 경계상 Scene 직접 테스트는 추가하지 않았다.
- fresh `swift build` exit 0, `swift run ConsoleCoreTests` exit 0·2,416건 통과. 직전 기준 2,318건보다 98건 많다.

---

# macOS 콘솔 오피스 도면 창 비율 적응형 배치 (2026-08-13)

**Goal:** `.ai/design.md` 계약대로 창 크기에 따라 부서 구역을 3열×2행 또는 2열×3행으로 선택하고, 배치 전환 때만 도면을 재구성한다.

**Contract:** `clients/idaeri-console/`과 요구된 `.ai/implementation-summary.md`만 구현 범위다. `departmentDeskSpots`·`departmentFurnitureSpots`·`fallbackDeskSpots`, `zoneWidth = 10`·`zoneHeight = 7`·`zoneStride = 12`, 사실과 맞는 기존 주석은 변경하지 않는다. GUI 렌더·git index·commit은 실행하지 않는다.

- [x] 현재 3열 baseline과 공개 API 호출부를 확인한다. 초기 baseline 실행은 sandbox 캐시 권한으로 막혀 격리 cache 명령으로 전환했다.
- [x] RED: `officeZoneColumns(width:height:currentZoneColumns:)`가 960×1010→2, 1400×820→3, 동률→3, 반대 배치가 5% 이상 유리할 때만 전환하는 테스트를 추가한다.
- [x] RED: `officeFloorPlan(agents:zoneColumns:)`가 c=3에서 35×20, c=2에서 23×27이고 두 배치의 복도·천장·좌석·대기줄·휴식자리 도달성을 지키는 파라미터 테스트를 추가한다.
- [x] RED: c=2 표본 31명 전원이 서로 다른 좌석을 받고, c=2·c=3의 모든 상단 밴드 가구 footprint가 해당 `CommonArea` 폭 안에 드는 테스트를 추가한다.
- [x] GREEN: `officePlanSize(zoneColumns:)`, `officeCorridorColumns(zoneColumns:)`, `officeCorridorRow(zoneColumns:)`와 2/3열 선택 순수 함수를 추가하고, 기존 3열 기본 호출 호환성을 유지한다.
- [x] GREEN: 도면 열·행, 부서 원점, 행별 문·천장, 복도를 `zoneColumns`/`zoneRows`에서 계산한다. 부서 내부 배치표와 구역 규격 상수는 그대로 둔다.
- [x] GREEN: `bandSpans`의 35→12/12/11, 23→8/8/7 구간으로 바닥·벽·문패·창·벽등·대표·대기줄·휴식자리를 유도하고, 방별 기존 우선순위 후보를 폭으로 필터링한다.
- [x] GREEN: `OfficeScene`이 현재 열 수를 보관하고 resize에서 5% 히스테리시스로 열 수를 선택하며, 열 수 변경 때만 새 도면을 만들고 크기만 바뀌면 기존 도면으로 좌표를 재계산한다.
- [x] REFACTOR: 바뀐 사실과 충돌하는 주석만 같은 사고 기록 톤으로 갱신하고, 금지 함수·상수와 무관한 코드는 손대지 않는다.
- [x] VERIFY: `swift build`, `swift run ConsoleCoreTests`, `git diff --check`, 금지 심볼 diff 검사를 fresh 실행하고 전체 diff를 `.ai/design.md`와 대조한다.
- [x] `.ai/implementation-summary.md`에 변경 파일/이유, 설계 이탈, 실제 테스트 건수, Claude 재검증 지점을 기록하고 아래 Review를 채운다.
- [x] GUI 렌더 실증(960×1010·1400×820)으로 목표 수치와 시각 회귀를 확인한다.
- [x] 렌더에서 드러난 밴드·부서 문패 x 충돌을 고치고, 두 배치 모두에서 겹침을 막는 회귀 테스트를 추가한다.

## Review

- 3열 기본 API 호환을 유지하면서 2열×3행 도면을 추가했다. 960×1010은 2열, 1400×820은 3열을 선택한다.
- 독립 리뷰가 첫 배치부터 히스테리시스를 적용한 결함을 찾았다. 초기 열 상태를 nil로 바꿔 첫 렌더는 순수 최대값, 이후 리사이즈만 5% 히스테리시스를 적용했다.
- `departmentDeskSpots`·`departmentFurnitureSpots`·`fallbackDeskSpots`와 zone 규격 값, 백엔드 `src/`는 변경하지 않았다.
- GUI 렌더 실증에서 2열 배치의 "탕비실"과 "개발" 문패가 겹쳤다. 원인은 밴드가 도면 폭을 3등분하고 부서는 stride 12로 나뉘어, "밴드와 부서가 같은 x 격자를 쓴다"는 기존 회피 규칙의 전제가 깨진 것이다. 실제 문패 판의 x 범위를 계산해 비충돌 위치로 미루는 방식으로 고쳤고, 조건 분기 대신 격자 어긋남 자체를 견디게 했다.
- 렌더 실측: 960×1010에서 타일 27.4px→37.4px(+36%), 세로 여백 46%→0%. 1400×820은 3열 유지로 시각 회귀 없음. 두 배치 모두 31명 전원 배치.
- `swift build` 성공, `swift run ConsoleCoreTests` 2194건 전부 통과, diff check clean.
- 병합 시 `#298`(밴드 문패 세로 회피)과 같은 자리를 고쳐 충돌 1건. 두 수정은 축이 달라 함께 살렸다 — 가로는 부서 문패 회피, 세로는 아래 방 말풍선 회피.

---

# PR #301 리뷰 지적 수정 (2026-08-13)

**Goal:** 정탐 리뷰 5건을 최소 변경으로 수정하고 제안 입력 우선순위·원장 표본·오류 공개 경계·앱 표시를 회귀 테스트로 고정한다.

**Contract:** 사용자 최신 명세가 정본이다. Node 22.23.1을 사용하고, UI 레이아웃·색상 토큰·env·DB/Prisma·Slack 동작·dependency·git commit은 변경하지 않는다.

- [x] `.ai/design.md`, 관련 구현·테스트·원장 조회 순서를 확인하고 원인을 추적한다.
- [x] RED: hint 우선순위, 고밀도 날짜 표본, 내부 오류 비노출 테스트를 추가해 기대한 실패를 확인한다.
- [x] 성공일 4개·간격 1일/5일/2일의 홀수 중위 주기 문구 테스트를 추가한다.
- [x] hint 없는 번호 선택을 보존하면서 hint 있는 입력은 원문·보관을 유지한다.
- [x] `HISTORY_LIMIT=300`, 운영 실측 주석, 상한 도달·성공일 6개 미만 warn을 구현한다.
- [x] 제안 계산 원본 오류는 warn에만 남기고 사용자에게 고정 문구를 발행한다.
- [x] 두 SwiftUI 경로에서 `.answered`만 줄 제한을 해제한다.
- [x] focused 3 suites / 40 tests GREEN을 확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm docs:check` exit 0을 확인한다.
- [x] Swift raw 명령의 환경 실패와 matching SDK·cache·sandbox 우회 build/test exit 0을 확인한다.
- [x] 최종 diff·금지 범위·whitespace를 검토하고 `.ai/implementation-summary.md`에 실제 결과를 기록한다.

## Review

- hint 있는 `2번 이슈 검토`는 본문·hint·보관을 유지하고, hint 없는 `2번`은 기존 제안 선택을 유지한다.
- 성공 원장은 300건을 읽고 상한에서 성공일 6개 미만이면 warn한다. 300건 고밀도 표본과 간격 1/5/2일 중위 2일을 회귀 테스트로 고정했다.
- 제안 계산 내부 오류는 logger warn에만 남고 SSE에는 고정 문구만 발행된다. `.answered`만 두 SwiftUI 표시 경로의 줄 제한을 해제했다.
- 독립 리뷰의 로그 중복 지적을 반영해 제안 계산 실패 warn은 원본 1회만 남긴다. `tasks/todo.md` 변경 제외 의견은 상위 `AGENTS.md`의 계획 기록 의무 때문에 적용하지 않았다.
- focused 3 suites/40 tests와 최종 TS 4종 gate, Swift 우회 build/2,133 tests, `git diff --check`가 exit 0이다.
- raw `swift build`/`swift run ConsoleCoreTests`는 시스템 compiler 6.3.3과 기본 SDK 6.3.2 불일치 및 sandbox 권한으로 각각 exit 1이다. matching MacOSX15.4 SDK, `/tmp` cache, `--disable-sandbox`에서는 각각 exit 0이다.
- env·DB/Prisma·Slack·dependency·UI 레이아웃/색상·git commit은 변경하지 않았다.

---

# 콘솔 worker 입력 부족 되묻기·재착수 (2026-08-13)

**Goal:** `agentTypeHint`로 직접 지목한 worker가 빈 입력 때문에 `BAD_REQUEST`를 내면 내부 슬래시 문법을 숨긴 채 사람 말로 되묻고, 다음 콘솔 입력을 같은 worker 인자로 재착수한다.

**Contract:** 사용자 최신 명세가 `.ai/design.md`의 제안 선택 후 빈 text dispatch 계약을 대체한다. `resolveChain` 가능한 예외가 우선이며, `agentTypeHint` + 빈 text + `BAD_REQUEST DomainException`만 되묻는다. Swift/Slack/worker/env/DB/Prisma, worker 하드코딩 목록, commit은 금지한다.

- [x] 현재 orchestrator catch 순서, pending store 소비자, write service 번호 분기와 focused baseline을 확인한다.
- [x] RED: 되묻기 발동·원본 메시지 비노출과 text 있음/선행 체인/BAD_REQUEST 아님 대조군을 추가한다.
- [x] RED: `AWAITING_INPUT`에서 `"3번"`을 번호가 아닌 worker 인자로 전달하는 spec을 추가한다.
- [x] RED: `SUGGESTIONS`를 `AWAITING_INPUT`이 덮어쓰고 TTL 만료 시 `null`인 store spec을 추가한다.
- [x] GREEN: `PendingConsoleTurnStore` 판별 유니온, rename, module/import 갱신을 최소 구현한다.
- [x] GREEN: orchestrator의 `resolveChain` 이후 입력 부족 분기와 안전한 `command.answered` 문구·로그를 구현한다.
- [x] GREEN: write service에서 `AWAITING_INPUT`을 최우선 소비하고 `SUGGESTIONS`만 번호 해석한다.
- [x] focused GREEN, 최종 diff·금지 범위·mutation 관점 검토를 수행한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm docs:check`를 리다이렉트하고 실제 exit code를 확인한다.
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

# 모의투자 3-A 체결 관측 교정 B-1/B-2 (2026-08-13)

**Goal:** 장중 당일 봉 부재를 조기 만료하지 않고 별도 계측하며, 마감 회차의 처리 대상 수와 실제 만료 수를 분리한다.

**Contract:** 최신 사용자 B-1/B-2가 `.ai/design.md`의 장중 무봉 즉시 만료 규칙을 대체한다. 마감 사유는 마지막 조회 결과를 영속하지 않는 현재 구조에서 새 schema 없이 구분할 수 없으므로 기존 `체결가 조회 실패`를 유지하고 이유를 summary에 남긴다.

- [x] 기존 장중 무봉·마감 bulk expire·autopilot summary 테스트 경계를 확인한다.
- [x] B-1 RED: 장중 무봉은 PENDING 유지 + `notYetTraded` 별도 집계를 고정한다.
- [x] B-2 RED: 마감 `attempted`와 실제 `expired`가 다른 결과를 고정한다.
- [x] GREEN: usecase/repository/task summary를 최소 수정한다.
- [x] focused Jest, 독립 diff 리뷰, 5종 gate와 `git diff --check`를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- `TRADING`에서 성공 응답에 당일 봉이 없어도 주문을 만료하지 않고 `notYetTraded`만 증가시킨다. fetch 예외·가격 누락의 `lookupFailure`와 분리했다.
- `AFTER_CLOSE`는 due 대상 `attempted`와 compare-and-set으로 실제 만료된 `expired`를 별도로 반환한다.
- 마지막 조회 결과는 주문에 영속하지 않으므로 마감 사유는 기존 `체결가 조회 실패`를 유지한다. 이를 구분하려면 schema/원장 변경이 필요해 범위를 넓히지 않았다.
- focused 3 suites/20 tests, lint, tsc, build, 전체 test, docs check, diff check가 모두 exit 0이다. 전체 test는 일반 350 suites/2,904 tests와 code-graph 5 suites/40 tests가 통과했다.
- residual risk는 토스가 장중에 당일 봉을 실제로 제공하는지 아직 운영 실증하지 않았다는 점이다.

---

# 모의투자 3-A 완성 — 리뷰 결함·체결·실행 입구 (2026-08-13)

**Goal:** A-1~A-3를 회귀 방지하고, 다음 거래일 시가 체결과 CLI/autopilot 실행 입구를 구현한다.

**Contract:** `.ai/design.md`가 기본 계약이다. 최신 사용자 확정으로 추천 스케줄만 `30 19 * * 1-5`로 대체한다. 체결 usecase는 09:30 이전 skip, 09:30~15:30 처리, 15:30 이후 남은 PENDING 만료를 직접 판정한다. DB 접속·schema sync·git index/commit/push·3-B는 금지한다.

- [x] `.ai/design.md`, lessons, 기존 T1/T2 diff와 T3/T4 실행 패턴을 매핑한다.
- [x] 실측 종료 시각과 기존 `18:30` schedule 충돌을 보고하고 사용자 확정 `19:30` override를 기록한다.
- [x] A-1 RED/GREEN: `sells`/`buys` nullish는 빈 배열, 다른 비배열은 오류로 고정한다.
- [x] A-2 RED/GREEN: 모든 필터와 0주 탈락 뒤 앞의 유효 매수 3종만 채택한다.
- [x] A-3 RED/GREEN: 계좌 생성 뒤 진짜 record를 재조회하고 null이면 명시 오류를 낸다.
- [x] T3 RED: 시간 창, due 조회, 시가 체결, 인프라 실패/시장 무봉 분리, 수량 축소, 반환 집계를 고정한다.
- [x] T3 GREEN: repository compare-and-set/원자적 FILLED 전이와 `FillPendingOrdersUsecase`를 구현한다.
- [x] T4 RED/GREEN: CLI `recommend`/`fill`, 추천 19:30, 체결 평일 10분 cadence, task 하나, playbook/module 등록을 구현한다.
- [x] focused Jest와 `git diff --check` 후 요구사항·보안·동시성·범위 이탈을 리뷰한다.
- [x] `pnpm lint:check`, `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm test`, `pnpm docs:check`를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 작성한다.

## Review

- A-1은 nullish 필드만 빈 배열로 바꾸고 malformed non-array는 기존 도메인 오류를 유지했다.
- A-2는 보유·후보 밖·중복·가격/비중 오류·0주를 제거한 뒤 유효 매수 3건에서 멈춘다.
- A-3은 계좌 생성 뒤 repository 재조회 record만 사용하며, 성공 뒤 null과 생성 race를 구분한다.
- T3는 KST 시간 창을 usecase가 판정하고, 개별 미조정 봉의 시가만 쓴다. fetch 예외/open 누락과 성공 응답의 당일 봉 없음은 서로 다른 카운터로 집계하며 모두 장중 `PENDING`을 유지한다.
- 자동 체결은 account lock 뒤 최신 현금/position으로 수량을 줄이고, 주문 claim·trade·position·cash를 한 transaction에 반영한다.
- T4는 전용 CLI module과 동일 production usecase를 사용한다. 추천은 universe-sweep 뒤 평일 19:30, 체결은 평일 09~15시 10분 cron + usecase 창 guard다.
- 사용자 계약 정정에 따라 독립 리뷰의 장중 무봉 PENDING 제안을 반영했다. CLI 수동 반복의 일일 claim 제안은 T1/T2 schema 재설계 범위라 residual risk로 summary에 기록했다.
- fresh gate 5종과 diff check 모두 exit 0이다. 전체 test는 350 suites/2,904 tests와 code-graph 5 suites/40 tests가 통과했다.

---

# 모의투자 3-A 앞부분 — 추천 도메인·주문 생성 (2026-08-13)

**Goal:** T1/T2만 구현해 전략별 후보를 계좌당 LLM 1회로 판단하고, 코드 제약을 강제한 `PaperOrder`를 `PENDING`으로 기록한다.

**Contract:** `.ai/design.md`와 정본 `docs/superpowers/specs/2026-08-12-paper-trading-phase3-design.md`가 구현 계약이다. 선행 `indicatorSnapshot` schema/client는 보존한다. T3/T4, DB 접속·스키마 동기화, git index/commit/push는 금지한다.

- [x] 계약·정본을 끝까지 대조하고 T1/T2 직접 충돌이 없음을 확인한다.
- [x] 기존 AgentType/registry/AgentRun/ModelRouter/screener/paper repository/module/retry 패턴을 매핑한다.
- [x] T1 RED: parser 오류와 최대 3종·20% 절단·후보 밖/보유 매수 제거·전량 매도·현금 수량 축소·주말 날짜 spec을 작성하고 실패를 확인한다.
- [x] T1 GREEN: 추천 prompt/parser/error/순수 제약 함수와 AgentType/TriggerType/provider/registry/contract/ResponseCode 등록을 최소 구현한다.
- [x] T2 RED: 계좌 생성·재사용, 전략별 screener/LLM 1회, 주문 필드·지표 snapshot, 계좌별 graceful spec을 작성하고 실패를 확인한다.
- [x] T2 GREEN: repository 주문 저장/평가액 조회와 추천 usecase/module DI를 최소 구현한다.
- [x] `/retry-run`에 PAPER_RECOMMEND 재실행 경로를 연결하고 전체 registry/contract 정합성을 확인한다.
- [x] focused GREEN 후 독립 요구사항·코드 품질 리뷰를 반영한다.
- [ ] `pnpm lint:check`, `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm test`, `pnpm docs:check`, `git diff --check`를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 작성한다.

## Review

- T1/T2 focused 4 suites/29 tests, tsc, build, 전체 test(일반 350 suites/2,902 tests + code-graph 5 suites/40 tests), docs check, diff check와 scoped ESLint는 exit 0이다.
- T2 리뷰의 동시성·감사·prompt·retry·계좌 race 5건을 회귀 RED→GREEN으로 수정했고 재리뷰와 final review는 READY다.
- 전체 `pnpm lint:check`만 동시 진행된 범위 밖 T3/T4 파일의 formatting 오류 9건으로 exit 1이다. 사용자 변경이라 수정·되돌림하지 않았다.
- DB/schema sync/Prisma generate/commit/staging/push는 실행하지 않았다.

### Fix round 1/5

- [x] 회귀 RED: 원장 내부 전체 전략 실행, full indicator prompt, account 생성 race를 고정한다.
- [x] 회귀 RED: locked state 재검증, pending cash/BUY/SELL 제약, recommendation identity 동시 중복 차단을 고정한다.
- [x] GREEN: repository locked callback과 application 재제약/저장을 구현한다.
- [x] GREEN: retry identity guard와 account real record refetch를 구현한다.
- [x] focused Jest, tsc, scoped lint 후 Task 2 report에 결과를 추가한다.

---

# PR 봇 리뷰 반영 — 벤치마크 증분 공백 탐지 (2026-08-12)

**Goal:** 저장된 KOSPI 최신 거래일부터 현재까지의 캘린더 일수로 증분 조회 범위를 정해 5거래일 초과 중단 뒤 영구 결손을 막고, 200봉 상한 초과 공백은 운영 로그에 드러낸다.

**Contract:** 사용자 리뷰 지적과 수정 방향이 승인된 구현 계약이다. `options.days`와 최초 200봉 동작은 유지하고, 페이지네이션·API client·DB/schema·env는 변경하지 않는다. commit, staging, push, PR 생성은 금지한다.

- [x] 기존 고정 5봉 경로와 날짜·Logger 테스트 패턴을 확인한다.
- [x] 20일 공백, 최초 200봉, `options.days` 우선, 200일 초과 경고 spec을 추가하고 RED를 확인한다.
- [x] KST 캘린더 일수 계산, 5..200 clamp, 상한 경고를 최소 구현하고 주석으로 근거를 남긴다.
- [x] focused Jest GREEN과 최종 diff 검토를 수행한다.
- [x] 지정된 lint, screener Jest, 전체 test, build, tsc를 각각 fresh 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- 저장 최신일이 있으면 KST 현재 날짜와의 캘린더 일수 차이를 계산해 5..200봉으로 제한한다. 거래일 수의 보수적 상한이라 중단 기간을 덮고, 최근 봉 5개 재수집 계약도 유지한다.
- 최초 수집 200봉과 명시 `options.days` 우선은 유지한다. 자동 계산 공백이 200일을 넘으면 페이지네이션 없이 완전 복구할 수 없음을 `Logger.warn`으로 남긴다.
- RED는 장기 공백 두 케이스가 모두 5봉을 요청해 2 failures였고, 최종 focused spec은 10/10 통과했다. 독립 리뷰의 clamp 경계 제안도 정확히 5일·200일과 200일 무경고 spec으로 해소했다.
- fresh gate는 lint exit 0(기존 warning 57), screener 9 suites/45 tests, 전체 일반 342 suites/2,847 tests + code-graph 5 suites/40 tests, build, tsc 모두 exit 0이다.
- DB/schema/env/API client와 git index/commit/push는 변경하지 않았다.

---

# 유동성 하한 + 코스피 벤치마크 수집 (2026-08-12)

**Goal:** `.ai/design.md` 계약대로 60일 평균 거래대금 5억원 하한을 스크리너 공통 게이트로 적용하고, 토스 시장지표 전용 경로로 KOSPI 일별 종가를 수집·적재·자동/수동 실행한다.

**Contract:** `BenchmarkDailyClose` schema와 생성된 Prisma client는 사용자 선행 변경으로 보존한다. DB/network 재조사·`db:push`·commit/git write는 금지한다. TDD RED→GREEN, 명시 주석, 기존 DDD/DI/CLI 패턴을 따른다.

- [x] A1: `IndicatorBar.close`와 repository select/mapping spec을 RED로 만들고 원본 종가를 연결한다.
- [x] A2: 60봉 미만 `null`, 정확히 60봉 경계, 최근 60봉 `close × volume` 평균 spec을 RED로 만들고 `turnover60`을 구현한다.
- [x] A3: 5억원 미만/null 탈락과 명시적 통과 fixture spec을 RED로 만들고 공통 게이트·rule version 2·필요한 formatter를 구현한다.
- [x] B1: 지수 응답 정상/currency 없음/존재하지 않는 날짜/역순 정렬/부분 파싱 실패 spec을 RED로 만들고 전용 매퍼를 구현한다.
- [x] B2: count 200 상한·URL encoding·429 정규화 spec을 RED로 만들고 `TossMarketIndicatorClient`와 module export를 구현한다.
- [x] B3: repository latest/upsert 계약과 첫 200봉·증분 5봉·days override·장중 차단 usecase spec을 RED로 만들고 repository/usecase/module DI를 구현한다.
- [x] B4: `sync → collectPrices → collectBenchmark` 순서, 성공 요약, 벤치마크 실패 비치명 요약 spec을 RED로 만들고 universe-sweep 3단계를 구현한다.
- [x] B5: `collect-benchmark [--days]` parser/USAGE/handler spec을 RED로 만들고 CLI 수동 실행 입구를 구현한다.
- [x] 설계 요구 주석(`close` 조정가 현재 한계, 페이지네이션 미사용 `ponytail:`)과 범위 밖 무변경을 final diff로 검토한다.
- [x] focused Jest 후 `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm exec tsc --noEmit`, `pnpm check:env`, `pnpm docs:check`, `git diff --check`를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 출력 기준으로 작성한다.

## Review

- 유동성 하한은 두 전략 공통 gate이며 `turnover60`은 랭킹 축에서 제외했다. 최근 60봉 원본 종가 기준과 59/60/61봉 경계를 고정했다.
- 시장지표 전용 mapper/client/repository/usecase와 module DI, autopilot 3단계, CLI 수동 실행 입구를 추가했다.
- 독립 리뷰 P2인 stale 응답의 `latestTradeDate` 후퇴를 regression RED→GREEN으로 수정했다. LOW 랭킹 회귀 공백도 보강했다.
- 최종 gate: lint(0 errors, 기존 warning 57), 일반 337 suites/2,800 tests + code-graph 5 suites/40 tests, build, tsc, check:env, docs:check, diff check 모두 exit 0.
- DB/network/commit/git write는 실행하지 않았다. 실제 DB 반영과 토스 통합 실행은 메인 세션 재검증 대상으로 남겼다.

---

# PR #284 재리뷰 origin·pathspec 결함 2건 반영 (2026-08-12)

**Goal:** 설정한 private repo와 다른 기존 clone을 거부하고, exporter 관리 산출물 외 파일이 변경 감지·staging·commit에 들어가지 않게 한다.

**Contract:** 기존 clone은 자동 삭제·재clone하지 않는다. GitHub HTTPS/SSH URL 표기 차이는 같은 `owner/repo`로 정규화한다. clean tree를 강제하지 않고 `manifest.json`, `SECRETS-TODO.md`, `claude`, `codex`에만 `status --porcelain`과 `add -A` pathspec을 적용한다. commit/stage/push 금지.

- [x] 다른 origin이면 remote 확인 뒤 pull/export 없이 설정값·현재 origin·디렉터리를 담은 예외를 내는 spec을 RED로 만든다.
- [x] 동일 repo URL 3형태가 모두 pull까지 통과하는 spec을 RED로 만든다.
- [x] 산출물 밖 미추적 파일은 status/add 대상에서 제외되고 산출물 변경은 commit/push되는 spec을 RED로 만든다.
- [x] origin 정규화 검증과 관리 pathspec 상수를 최소 구현하고 focused GREEN을 확인한다.
- [x] 독립 재리뷰, 6종 gate, `git diff --check`를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`, `tasks/lessons.md`, 아래 Review를 실제 결과로 갱신한다.

## Review

- 기존 clone은 `origin`을 읽어 설정 `owner/repo`와 비교한다. HTTPS `.git`/no-`.git`, SCP형 SSH, `ssh://`를 같은 저장소로 정규화하며 credential-bearing HTTP(S)는 userinfo를 제거한 뒤 비교·표시한다.
- mismatch는 설정값·sanitized current origin·sync directory를 담은 예외로 중단하며 pull/export를 실행하지 않는다. 자동 삭제·재clone은 없다.
- 변경 감지는 exporter의 실제 산출물 4개에만 한정한다. 항상 생성되는 파일 2개는 함께 `add -A`, 선택 디렉터리는 scoped status가 있을 때만 개별 `add -A`해 미존재 pathspec과 tracked deletion을 함께 처리한다.
- RED는 origin 검증 부재와 전역 status/add 때문에 6건, 추가 SSH/credential hardening 2건이 실패하는 것을 확인했다. 최종 adapter 25 tests, focused 4 suites/39 tests를 GREEN으로 만들었다.
- 독립 재리뷰는 Critical/Important 0건, Ready. 혼합 상태 test Minor도 관리 변경+외부 미추적 동시 fixture로 보강했다.
- fresh gate: lint exit 0(기존 warning 57), test exit 0(일반 338 suites/2,806 tests + code-graph 5 suites/40 tests), build/check:env/check:invariants/docs:check/diff check 모두 exit 0.
- commit/stage/push 없음.

---

# PR #284 AI CLI 환경 동기화 리뷰 6건 반영 (2026-08-12)

**Goal:** 장치 식별, 승인 스냅샷 불변성, 동시 push 복구, 부분 적용 재승인, 자격 증명 차단, 자식 env 격리를 실제 실패 입력으로 보장한다.

**Contract:** 사용자 최신 A~F가 구현 계약이다. `scripts/export-ai-cli-env.cjs` 수정은 `sourceHost`와 구조적 credential warning을 위해 허용한다. 기본 브랜치 하드코딩, force push, 앱 전체 env 상속, commit은 금지한다.

- [x] A: 같은 `sourceHome`·다른 `sourceHost`, 구 manifest의 카드/문구 spec을 RED로 만들고 hostname 판별을 구현한다.
- [x] B: dirty working tree에서 bootstrap 미실행 spec을 RED로 만들고 clean guard를 구현한다.
- [x] C: 첫 push 실패 후 fetch/default-ref/reset/re-export/retry 및 두 번째 실패 spec을 RED로 만들고 1회 복구를 구현한다.
- [x] D: bootstrap warning 시 적용 이력 미기록과 재승인 안내 spec을 RED로 만들고 성공 기록 경계를 고친다.
- [x] E: 구조적 credential warning 시 add/commit/push 미실행 spec을 RED로 만들고 export manifest/adapter gate를 구현한다.
- [x] F: 기본 allowlist와 `secretsRequired`만 자식 env에 전달하는 spec을 RED로 만들고 실제 HOME 보존 근거를 주석으로 남긴다.
- [x] focused GREEN과 최종 diff로 A~F 및 금지 범위를 재검토한다.
- [x] 6종 gate와 `git diff --check`를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`, `tasks/lessons.md`, 아래 Review를 실제 결과로 갱신한다.

## Review

- exporter manifest에 `sourceHost`와 구조적 `credentialWarnings`를 추가했다. 적용 태스크는 hostname을 장치 식별자로 쓰며 구 manifest는 특정 불가 안내와 함께 승인 카드로 보낸다.
- apply는 승인 SHA 일치 뒤 clean tree까지 확인하고, bootstrap warning이 한 건이라도 있으면 적용 이력을 남기지 않는다. applier가 재승인을 명시한다.
- push 실패만 복구 대상으로 잡아 remote 기본 ref를 동적으로 구하고 reset한 뒤 전체 export/commit/push를 1회만 재시도한다.
- credential warning은 status/add/commit/push 전에 차단하며 MCP label을 오류에 포함한다. 모든 child는 기본 allowlist env만 받고 bootstrap만 `secretsRequired` 키를 추가로 받는다.
- guard-breaking RED 6건을 확인한 뒤 focused 4 suites/31 tests, 최종 adapter 18 tests를 GREEN으로 만들었다.
- fresh gate: lint exit 0(기존 warning 57), test exit 0(일반 338 suites/2,799 tests + code-graph 5 suites/40 tests), build/check:env/check:invariants/docs:check/diff check 모두 exit 0.
- 설계 범위 이탈, `process.env`, force push, main 하드코딩, `--with-hooks`, commit/stage/push 없음.

---

# PR #281 봇 리뷰 4건 반영 (2026-08-12)

**Goal:** 200봉 지표의 기간 계약을 지키고, 서로 다른 기준일의 종목을 분리하며, 429 재시도 정책의 계층 의존성을 바로잡고, 일봉 조회량에 캘린더 하한을 둔다.

**Contract:** 사용자가 코드로 확정한 A~D가 구현 계약이다. raw SQL, DB/network/schema/env/dependency/git index는 건드리지 않는다.

- [x] A: 60/199/200봉 경계 spec을 RED로 만들고 `high200Position` 최소 봉 수를 200으로 고친다.
- [x] B: 서로 다른 최신 거래일 spec을 고쳐 RED를 확인하고 `staleCount` 및 CLI 출력을 구현한다.
- [x] C: domain rate-limit error 기준 spec을 RED로 만들고 Toss adapter에서 429를 변환한다.
- [x] D: 저장 최신일 기준 400일 하한 repository spec을 RED로 만들고 query filter를 구현한다.
- [x] focused tests와 최종 diff로 계층·기간·조회량 계약을 검토한다.
- [x] 5종 gate와 `git diff --check`를 실행한다.
# AI CLI 승인 SHA 고정·bootstrap 경고 노출 (2026-08-12)

**Goal:** PreviewGate에서 승인한 snapshot SHA만 bootstrap하고, 성공 종료 안의 부분 복원 warning을 사용자 메시지에 노출한다.

**Contract:** 사용자 최신 수정 지시가 `.ai/design.md`의 기존 무인자 port 계약을 대체한다. `applySnapshot(expectedSha: string)`으로 변경하고 bootstrap 전 HEAD 일치 검증, expected SHA 이력 기록, stdout warning 파싱, 성공 stderr warning 합류를 구현한다. `scripts/*.cjs`는 수정하지 않고 commit하지 않는다.

- [x] port mock과 실제 호출부를 전수 확인하고 수정 전 데이터 단절을 기록한다.
- [x] HEAD 불일치 시 bootstrap 미실행·행동 가능한 오류를 검증하는 adapter spec을 추가해 RED를 확인한다.
- [x] bootstrap warning 파싱·stderr 합류·무경고 반환을 검증하는 adapter spec을 추가해 RED를 확인한다.
- [x] applier가 expected SHA를 전달하고 warning 유무에 따라 메시지를 달리하는 spec을 추가해 RED를 확인한다.
- [x] port·adapter·applier를 최소 수정하고 focused GREEN을 확인한다.
- [x] 독립 리뷰와 final diff 검토로 승인 SHA·warning·금지 범위를 재확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm check:env`, `pnpm check:invariants`, `pnpm docs:check`를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- `high200Position`은 200봉부터만 계산하며 60/199/200 경계를 고정했다.
- 서로 다른 최신일 후보는 최대 기준일 순위에서 제외하고 `staleCount`를 CLI까지 노출했다.
- Toss adapter가 HTTP 429를 Domain 오류로 정규화해 Application의 infrastructure import를 제거했다.
- 저장 최신일의 400일 전을 DB 하한으로 적용하고 종목별 limit 절단은 유지했다.
- 최종 gate: lint(error 0, 기존 warning 57), build, tsc, 전체 test(일반 333 suites / 2,763 tests + code-graph 5 suites / 40 tests), docs check, diff check 모두 exit 0.
- DB/network/schema/dependency/env/git index/commit은 건드리지 않았다.

---

# PR-B 실데이터 결함 2건 수정 (2026-08-12)

**Goal:** `high200Position`의 종가 기준 한계를 코드 계약으로 드러내고, Toss 429로 누락되는 종목을 1초 뒤 1회 복구하면서 회복 건수를 운영 출력에 남긴다.

**Contract:** 상태 코드는 기존 `TossApiHttpError.status`를 사용한다. 문자열 매칭, 다른 오류 재시도, 지수 backoff, 종목당 복수 재시도는 추가하지 않는다. DB/network/schema/env/dependency/git index는 건드리지 않는다.

- [x] 429 후 성공, 429 두 번, 비429 즉시 실패 spec과 `retried` 출력 spec을 작성해 RED를 확인한다.
- [x] `TossApiHttpError`를 상태 코드 판별에 필요한 최소 범위로 export한다.
- [x] 종목당 1회 예산의 1초 고정 재시도를 구현하고 최종 성공 시 `retried`를 집계한다.
- [x] Autopilot 요약과 CLI 출력에 `retried`를 연결하고 관련 mock을 완전하게 갱신한다.
- [x] `high200Position` 타입과 계산부에 종가 기준·장중 고점 미반영 이유를 주석으로 명시한다.
- [x] focused GREEN, 전체 diff·금지 범위 검토, 5종 gate와 `git diff --check`를 완료한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- `high200Position`이 최고 조정 종가 기준이며 장중 고점을 반영하지 못하는 이유를 타입과 계산부에 명시했다. 이름과 동작은 보존했다.
- 기존 비공개 `TossApiHttpError.status`를 최소 공개해 429만 구조적으로 판별한다. 문자열 매칭은 없다.
- 최초 조회와 소급 재수집이 종목당 한 번의 예산을 공유하며, 첫 429만 1초 후 재시도한다. 최종 종목 처리 성공만 `retried`에 집계한다.
- Autopilot summary/audit와 CLI 요약에 429 재시도 성공 건수를 노출했다.
- 독립 재리뷰 Critical 0. 예산 공유·999ms 경계·typed HTTP 500 spec 공백을 모두 보강했다.
- 최종 gate: lint(error 0, 기존 warning 57), build, tsc, 전체 test(일반 333 suites / 2,758 tests + code-graph 5 suites / 40 tests), docs check, diff check 모두 exit 0.
- DB/network/schema/dependency/env/git index/commit은 건드리지 않았다.

---

# 모의투자 2단계 PR-B — 지표 계산과 스크리너 (2026-08-12)

**Goal:** PR-A의 보통주 유니버스와 조정 일봉으로 200거래일 한계 안의 순수 지표를 계산하고, 고정 규칙으로 장투·단타 후보를 결정론적으로 선별해 CLI로 출력한다.

**Contract:** 새 `.ai/design.md` 전문이 source of truth다. `DecimalValue`, 빈 봉 `null`, 명문화된 순위합 점수 공식을 따른다. DB/schema, 네트워크, dependency, env, autopilot, LLM/추천/자동매매, git index/commit은 건드리지 않는다.

- [x] T1 봉 부족·정배열·거래량 0·고정 입력 spec을 작성하고 RED를 확인한다.
- [x] T1 `calculateIndicators()`를 `adjClose` 전용 순수 함수로 최소 구현하고 focused GREEN을 확인한다.
- [x] T2 장투/단타 조건과 1개/3개/null 순위 점수 spec을 작성하고 RED를 확인한다.
- [x] T2 고정 순위합 점수와 결정론적 tie-break를 최소 구현하고 focused GREEN을 확인한다.
- [x] T3 repository 청크 쿼리·종목별 limit spec과 usecase 200종목 청크·집계 spec을 RED→GREEN으로 만든다.
- [x] T4 CLI 인자·전략별 표·0건 설명 spec을 RED→GREEN으로 만들고 module/CLI를 연결한다.
- [x] focused tests와 최종 diff로 200봉·adjClose·4컬럼 select·금지 범위를 검토한다.
- [x] 5종 gate와 `git diff --check`를 실행한다.
- [x] `.ai/implementation-summary.md`를 PR-B 기준으로 새로 작성하고 아래 Review를 실제 결과로 갱신한다.

## Review

- `DecimalValue` 기반 순수 지표 11종을 추가했다. 빈 봉은 null이며 기간 부족 지표만 null로 남는다. high200은 공용 함수 내부에서 마지막 200봉으로 제한한다.
- 장투·단타 통과 조건과 명문화된 1..n 순위합 점수를 구현했다. 단일 후보, 3개 고정 순위, null 최하위, code tie-break를 spec으로 고정했다.
- repository는 호출당 findMany 1회와 4컬럼 select를 사용하고, usecase는 200 ticker씩 읽는다. 봉 없는 종목과 limit 전 전체 통과 수를 분리한다.
- CLI에 기본 LONG_TERM인 `screen` 명령과 전략별 표, 0건 원인 문구를 추가했다. 기존 두 명령은 보존했다.
- 독립 리뷰 Critical 0. Important 1(high200 caller 의존)은 201봉 RED→GREEN으로 수정했고, Minor 1(표본분산 분모 spec)은 non-zero 고정 입력으로 보강했다.
- 최종 focused 9 suites / 40 tests, lint(error 0, 기존 warning 57), build, tsc, 전체 test(일반 332 suites / 2,752 tests + code-graph 5 suites / 40 tests), docs check, diff check 모두 통과했다.
- 설계 편차 없음. DB/schema/network/dependency/env/autopilot/LLM/추천/매매/git index는 건드리지 않았다.
- `applySnapshot(expectedSha)`로 port 계약을 바꾸고 bootstrap 직전 local HEAD exact match를 강제했다. 불일치 시 승인/현재 SHA 앞 7자리와 재승인 안내를 포함한 예외를 던지며 bootstrap과 이력 기록은 실행하지 않는다.
- bootstrap stdout의 `--- 결과 ---` 이후 `주의 N건:` 목록만 파싱하고, 성공 stderr도 사용자 warning에 합쳤다. 다른 generic 명령의 성공 stderr는 `Logger.warn`으로 보존한다.
- applier는 preview payload SHA를 그대로 전달한다. warning이 있으면 건수와 목록을, 없으면 기존 간결 성공 메시지만 반환한다.
- RED는 기존 무인자 시그니처 `TS2554`, applier SHA 미전달, generic stderr 로그 0회를 확인했다. focused 4 suites/22 tests와 adapter 11 tests를 GREEN으로 만들었다.
- 독립 scoped 리뷰는 Critical/Important 0건. 7자리 SHA 축약 Minor는 exact 존재·full SHA 부재 spec으로 보강했다.
- fresh gate: lint exit 0(기존 warning 57), test exit 0(일반 332 suites/2,754 tests + code-graph 5 suites/40 tests), build/check:env/check:invariants/docs:check 모두 exit 0.
- 남은 재확인은 실제 private repo clone/pull/push와 Slack 승인/bootstrap e2e다. commit/stage/push/PR 없음. `scripts/*.cjs` 무변경.

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

# PR #278 봇 리뷰 3건 반영 (2026-08-12)

**Goal:** 잘린 KRX 응답이 대량 상장폐지로 이어지지 않게 이중 방어하고, 부분 일봉 이력을 최초 적재 완료로 오인하지 않으며, KRX 관리 표식을 기준으로 상장폐지를 반영한다.

**Contract:** 사용자가 검증한 리뷰 3건이 구현 계약이다. DB/schema, env, 실제 KRX/DB 호출, dependency, git index/commit은 건드리지 않는다. production과 대응 spec만 최소 수정한다.

- [x] KRX 2,000건 절대 하한과 직전 활성 대비 95% 비율 가드 spec을 추가해 RED를 확인한다.
- [x] `source='TOSS'`이면서 `krxMarket`이 있는 행도 상장폐지하는 repository spec을 추가해 RED를 확인한다.
- [x] 저장 일봉 통계를 봉 수와 최신 거래일로 반환하는 repository spec을 추가해 RED를 확인한다.
- [x] 0봉/4봉/200봉 종목이 각각 insert/full upsert/incremental 경로를 타는 usecase spec을 추가해 RED를 확인한다.
- [x] production을 최소 수정하고 focused Jest GREEN을 확인한다.
- [x] `pnpm lint:check`, `pnpm build`, `pnpm exec tsc --noEmit -p tsconfig.json`, `pnpm test`, `pnpm docs:check`, `git diff --check`를 실행한다.
- [x] 최종 diff를 검토하고 `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- KRX 합계 절대 하한을 정상 약 2,595건의 77%인 2,000건으로 올리고, repository에서 직전 활성 유니버스 대비 95% 미만 감소도 `-1`로 차단한다. 첫 활성 0건일 때만 상대 가드를 건너뛴다.
- 상장폐지 대상은 `source`가 아니라 유니버스 관리 표식인 `krxMarket != null`로 정한다. Ticker 행은 삭제하지 않아 Holding 기반 감시 대상에는 영향이 없다.
- 저장 상태 조회를 봉 수와 최신 거래일을 함께 반환하는 단일 `groupBy`로 바꿨다. 0봉은 200봉 insert, 1~199봉은 200봉 upsert, 200봉 이상은 5봉 증분과 소급 재작성 감지를 수행한다.
- 수정 전 focused test는 신규 API 부재와 1,729건 응답 통과로 3 suites 실패했고, 수정 후 3 suites / 20 tests가 통과했다.
- 최종 gate는 lint(error 0, 기존 warning 57), build, tsc, docs check, diff check 모두 exit 0이다. 전체 test는 일반 327 suites / 2,727 tests와 code-graph 5 suites / 40 tests가 통과했다.
- 설계 이탈과 DB/schema/env/dependency 변경은 없다. 실제 KRX/DB 호출과 git index/commit은 수행하지 않았다.

---

# PR #274 리뷰 4건 반영 (2026-08-12)

**Goal:** 활동 대상 번호를 양의 안전한 정수로 제한하고, 동적 bubble·Prisma JSON 정규화 회귀를 고정하며, `run.started` 직후 앱이 활동 bubble 스냅샷을 즉시 다시 받게 한다.

**Contract:** 사용자 요청이 승인된 구현 설계다. 백엔드 SSE 이벤트 타입·발행부, DB/schema, env, UI 스타일은 바꾸지 않는다. 기존 패턴을 따르는 production/spec과 `.ai/implementation-summary.md`만 최소 수정하며 commit하지 않는다.

- [x] A1 경계값 spec(`pullNumber`: 0/-1/1.5/unsafe, `issueNumber`: 0)을 추가하고 수정 전 RED를 확인한다.
- [x] `readInteger()`를 `Number.isSafeInteger(value) && value > 0`으로 제한하고 focused GREEN을 확인한다.
- [x] A2 `ConsoleReadService`의 동적 `#273 리뷰 중` 전달 및 번호 누락 시 `일하는 중…` 폴백 spec을 추가해 기존 production 경로를 검증한다.
- [x] A3 객체/배열/스칼라/null 혼합 Prisma fixture spec을 추가해 객체 보존·나머지 null·`triggerType` 전달을 검증한다.
- [x] A4 `AppRootView.connect()`에서 `.runStarted` 처리 직후 `resyncSnapshot()`을 호출하고 스냅샷 전용 bubble 때문에 필요한 이유를 주석으로 남긴다.
- [x] focused Jest와 Swift compile/test를 실행해 변경 단위 GREEN을 확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm exec tsc --noEmit -p tsconfig.json`을 각각 파이프 없이 실행해 exit 0을 확인한다.
- [x] 최종 diff·금지 범위·설계 정합성을 검토하고 `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- A1은 수정 전 0·음수 경계 3 failures를 확인한 뒤 양의 safe integer guard로 focused GREEN을 만들었다.
- A2는 등록된 `CODE_REVIEWER`의 동적 `#273 리뷰 중`과 번호 누락 `일하는 중…` 폴백을 최종 `ConsoleAgent.bubble`에서 고정했다.
- A3는 한 Prisma 조회 fixture에서 객체만 보존하고 배열·스칼라·null을 `null`로 접으며 `triggerType`을 보존하는 계약을 고정했다.
- A4는 `.runStarted` 이벤트를 store에 먼저 적용한 뒤 즉시 snapshot resync한다. 백엔드 이벤트 계약은 무변경이다.
- focused 3 suites/82 tests, lint(기존 warning 57), 일반 308 suites/2,591 tests + code-graph 5 suites/40 tests, build, tsc, diff check가 모두 exit 0이다.
- 지정 `MacOSX15.4.sdk` 원문 명령은 현재 Swift 6.3.3 compiler와 SDK Swift 6.1 불일치로 exit 1이었다. matching `MacOSX26.5.sdk` + writable cache에서는 Swift build exit 0, ConsoleCoreTests 1,763건 exit 0이다.
- A4는 실제 앱 실행 없이 컴파일과 ConsoleCoreTests까지만 검증했다. commit 없음.
- 독립 리뷰는 Critical 0, Important 0, Minor 1, `Ready`. Minor는 A4 앱-level wiring 직접 테스트 부재로 기록했다.

---

# 오피스 에이전트 활동 말풍선 (2026-08-12)

**Goal:** 진행 중인 에이전트의 `triggerType`과 안전한 `inputSnapshot` 값으로 12자 이하의 구체적 활동 문구를 만들고, 미등록·잘못된 입력은 기존 상태 문구로 폴백한다.

**Contract:** `.ai/design.md`가 source of truth다. 계약에 적힌 TypeScript 5개 파일과 Swift 1개 파일만 코드 변경한다. 신규 env·DB/schema·Swift 문구 규칙은 추가하지 않으며 commit하지 않는다.

- [x] `agent-activity-bubble.spec.ts`에 설계 §6 전체 케이스를 작성하고, production 모듈 부재로 RED임을 확인한다.
- [x] `agent-activity-bubble.ts`에 쌍 키 우선 매핑, 안전한 대상 추출, 12자 상한을 최소 구현해 focused GREEN을 확인한다.
- [x] `ActiveRunSnapshot`과 Prisma `findActiveRuns()`에 `triggerType`·객체형 `inputSnapshot`을 연결한다.
- [x] `ConsoleReadService`가 최신 활성 런을 agentType별로 한 번만 접고 `IN_PROGRESS`에서만 활동 문구를 사용하도록 연결한다.
- [x] `OfficeSceneRender.swift`에서 `updateCompanySummary` 직후 `refreshOverlays`를 호출한다.
- [x] 타입 오류가 난 기존 `ActiveRunSnapshot` mock은 필드를 완전하게 채우되 타입을 느슨하게 만들지 않는다.
- [x] focused Jest, `pnpm lint:check`, `pnpm test`, `pnpm build`, `swift build`를 각각 실행해 exit code를 확인한다.
- [x] 최종 diff와 12자·자유 텍스트·비진행 상태·Swift 단일 변경 제약을 검토한다.
- [x] `.ai/implementation-summary.md`와 아래 Review에 변경점·검증·설계 이탈을 기록한다.

## Review

- `triggerType`과 객체형 `inputSnapshot`을 활성 런 조회에 추가하고, pair-key 우선 활동 문구 매핑과 12자 최종 guard를 구현했다. 자유 텍스트는 사용하지 않는다.
- `ConsoleReadService`는 fresh run을 agentType별 최신 1건으로 접고, 파생 상태가 `IN_PROGRESS`일 때만 활동 문구를 쓴다. 미등록·잘못된 대상·승인 대기는 기존 상태 문구를 유지한다.
- 신규 순수 함수 spec은 production 모듈 부재로 RED(exit 1) 후 35/35 GREEN. 최신 런 비교와 상태 gate 역변이도 각각 기대한 1 test 실패 후 원복했다.
- 최종 gate: `pnpm lint:check` exit 0(기존 warning 57), `pnpm test` exit 0(일반 308 suites/2,576 tests + code-graph 5 suites/40 tests), `pnpm build` exit 0.
- Swift는 기본 cache/toolchain 환경 실패 후 writable cache, `MacOSX15.4.sdk`, `--disable-sandbox`로 `swift build` exit 0. `OfficeSceneRender.swift` 포함 전체 target 컴파일 완료.
- 독립 최종 리뷰: Critical 0, Important 0, Minor 1(P3 repository JSON 경계 전용 spec 제안), merge-ready. 설계 이탈 없음. commit 없음.

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

# PR quota backoff 리뷰 반영 (2026-08-11)

**Goal:** 늦게 끝난 성공 호출이 더 최신 quota 차단을 해제하지 못하게 하고, codex 상대 reset hint를 실제 기간으로 해석한다.

**Constraints:** production/spec 두 파일만 코드 수정한다. 기존 spawn `1 → 1 → 2` 대조군을 유지한다. 최종 결과만 `.ai/implementation-summary.md`에 덧붙인다. commit 금지.

- [x] 현재 성공 경로 state mutation과 quota 테스트 패턴을 확인한다.
- [x] 상대 시간 3개와 동시성 레이스 회귀 spec을 추가해 RED를 확인한다.
- [x] 상대 시간 파싱과 성공 경로 `clearQuotaBlock()` 제거를 최소 구현한다.
- [x] focused spec GREEN을 확인한다.
- [x] 성공 경로 clear를 임시 복원해 동시성 spec이 실패하는 역변이 검증 후 원복한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm exec tsc --noEmit`을 각각 실행한다.
- [x] final diff를 검토하고 `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- 성공 경로의 quota clear를 제거해 더 최신 quota 감지가 stale success에 의해 지워지지 않게 했다. 만료 경로의 clear는 유지했다.
- `second`/`minute`/`hour`/`day` 상대 hint를 현재 시각 기준으로 계산하고 기존 24시간 clamp를 적용한다. `0 seconds`도 즉시 만료로 고정했다.
- TDD RED는 상대 시간 3건이 30분 fallback을 받고 레이스 후 spawn이 3회로 늘어나는 4 failures를 확인했다. 역변이도 `Expected 2 / Received 3`으로 실패했다.
- focused 44/44, 최종 lint/test/build/tsc 모두 exit 0. 독립 review Critical/Important/Minor 0건.

---

# PR #262 리뷰 반영 (2026-08-10)

**Goal:** 전달 산출물이 없고 실패가 있는 그룹의 BullMQ 재시도를 보존하고, BullMQ가 허용하는 6필드 cron도 저빈도 정책으로 정확히 분류한다.

**Constraints:** orchestrator·scheduler와 인접 spec만 최소 수정한다. 기존 all-skip·partial success·preview-only 동작을 보존한다. 신규 env, DB, commit, push, PR 없음.

- [x] skip+throw 및 6필드 cron 회귀 spec을 추가하고 수정 전 RED를 확인한다.
- [x] fully-failed 조건을 실패 존재 + summary 산출물 없음 + preview 없음으로 바꾼다.
- [x] 5/6필드 cron을 정규화하고 나머지 필드 수는 false로 유지한다.
- [x] focused spec과 최종 diff review를 완료한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`를 파이프 없이 실행한다.
- [x] `.ai/implementation-summary.md`에 `리뷰 반영`과 fresh gate 출력을 기록한다.

## Review

- `executedTaskCount`를 제거하고 실제 summary/preview 산출물 기준으로 재시도 조건을 표현했다. skip+throw는 가드/슬롯 표식 전에 reject하고, all-skip·partial summary·preview-only는 기존 성공 동작을 유지한다.
- 6필드 cron은 seconds 필드를 제거한 뒤 기존 저빈도 판별을 재사용하며, 지원하지 않는 필드 수는 false다.
- TDD RED에서 skip+throw가 reject 대신 resolve됨과 6필드 주간 cron이 false로 분류됨을 각각 확인했다. focused 2 suites/53 tests 통과.
- fresh gate: lint/test/build 모두 exit 0. 일반 306 suites/2,495 tests, code-graph 5 suites/40 tests 통과.
- 독립 review는 Critical/Important/Minor 0건, merge-ready다. 설계 이탈과 commit/push/PR/DB/env 변경은 없다.

---

# PR #261 자동 리뷰 반영

- [x] 현재 `unresolvedStreak` 계산과 기존 회귀 테스트를 확인하고 원인을 기록한다.
- [x] 질문이 아닌 assistant/null 2회가 방향 전환을 잘못 발동하는 회귀 테스트를 추가한다.
- [x] 되묻기 2회 연속과 되묻기-정상종결-되묻기 경계 테스트를 정리한다.
- [x] 수정 전 구현에서 신규 테스트가 의도한 이유로 실패하는지 RED를 확인한다.
- [x] `?`/`？` + trailing whitespace만 인정하는 최소 판정 로직과 `ponytail:` 한계 주석을 추가한다.
- [x] focused spec을 GREEN으로 만든다.
- [x] streak 0~1 시스템 프롬프트 해시 고정 테스트를 포함한 focused 테스트를 확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build` exit 0을 확인한다.
- [x] 최종 diff를 검토하고 `.ai/implementation-summary.md`에 `리뷰 반영` 절을 추가한다.

## Review

- 결과: 질문 종결 fallback만 streak에 포함하고 정상 종결에서 연속을 끊었다.
- 검증: RED 2건 확인, handler 25/25, prompt 25/25, lint/test/build exit 0.
- 설계 이탈: 없음. 되묻기 양성 경로는 기존 동작 보존 테스트라 수정 전에도 통과한다.

---

# C1 전멸 그룹 silent failure 회귀 수정 (2026-08-10)

**Goal:** 전멸 그룹의 per-task 실패 안내를 발송 가드 없이 Slack에 직접 보내고, 알림 발송 성패와 무관하게 원래 전멸 오류를 throw해 BullMQ retry를 유지한다.

**Constraints:** `targets` 파싱은 한 번만 수행한다. `acquireOnce`/`markSlotDone`을 소비하지 않는다. 부분 실패·전부 skip 동작은 보존한다. 신규 env, DB, commit, push, PR 없음.

- [x] notification fallback의 optional DI·env 기본값·early return을 확인한다.
- [x] 전멸 안내 발송 및 안내 발송 실패 회귀 spec을 추가하고 RED를 확인한다.
- [x] 공통 targets 계산과 best-effort 전멸 안내 발송을 최소 구현한다.
- [x] focused spec GREEN과 독립 review를 완료한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`를 파이프 없이 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 fresh 결과로 갱신한다.

## Review

- 전멸 시 기존 per-task 실패 item을 정규화된 모든 target에 가드 없이 best-effort 발송하고 원래 전멸 오류를 throw한다.
- Slack 안내 실패는 target별 warn으로 격리돼 BullMQ retry와 원래 오류를 가리지 않는다.
- production과 같은 non-null `slotId` spec으로 발송 가드와 슬롯 완주 표식 모두 미소비를 고정했다.
- 부분 실패와 전부 skip 회귀는 유지했다. focused 24/24, 최종 review Critical/Important/Minor 0.
- fresh gate: lint/test/build 모두 exit 0. 일반 306 suites/2,457 tests, code-graph 5 suites/40 tests 통과.

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

# 포트폴리오 노출 부분 실패 차단 (2026-08-06)

**Goal:** 종목 수집·저장 또는 잔고 동기화가 일부라도 실패하면 혼합된 값으로 포트폴리오 노출을 게시하지 않는다.

**Constraints:** 정상·휴장 분기 모두 적용한다. 시장 간 가격 시점 일치는 검사하지 않는다. 실제 보유 종목 정보, `.env`, DB, git index/commit/push는 건드리지 않는다.

- [x] 작업 트리·설계·기존 호출 흐름을 확인한다.
- [x] 부분 수집 실패와 잔고 동기화 실패 회귀 spec 2건을 추가한다.
- [x] focused Jest에서 두 spec의 RED를 확인한다.
- [x] `withPortfolioExposure`에 실패 입력·생략 로그·근거 주석을 최소 구현한다.
- [x] focused Jest GREEN과 최종 diff를 검토한다.
- [x] `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check && pnpm check:invariants`를 실행한다.
- [x] 아래 Review에 실제 결과를 기록한다.

## Review

- 정상·휴장 분기 모두 `failures`와 `sync.error`를 노출 계산에 전달한다. 하나라도 있으면 포트폴리오 조회 전 생략하고 원인을 `logger.log`에 남긴다.
- 수집·저장 실패의 직전 거래일 시세 혼합과 동기화 실패의 일부 수량·평단 갱신 위험을 주석으로 기록했다. 시장별 가격 시점 일치 검사는 추가하지 않았다.
- TDD RED: 새 회귀 2건이 노출 줄 포함으로 실패하고 기존 31건은 통과했다. GREEN: focused spec 33/33 통과.
- 최종 gate: `lint:check` exit 0(기존 warning 57건), 일반 test 306 suites/2,421 tests, code-graph 5 suites/40 tests, build/docs/invariants 모두 exit 0.
- `.env`, DB, git index/commit/push는 건드리지 않았다.

---
# T4 재구현 — 대화 fallback 2연속 제동 (2026-08-10)

**Goal:** `unresolvedStreak >= 2`에서 되묻기 유도 규칙을 제거·치환해 실제 모델이 질문/선택지로 끝내지 않고 실행 불가와 가능한 방향 1~2개를 진술하게 한다.

**Constraints:** T1~T3 변경 금지. streak 0~1의 `buildSystemPrompt` 결과는 기존 경로와 byte-for-byte 동일하게 유지한다. 커밋하지 않는다.

- [x] 기존 T4 구현·테스트를 조사하고 충돌하는 4개 규칙 및 회귀 공백을 확인한다.
- [x] streak 2 이상에서 4개 기존 문구 부재, 관측 가능한 방향 전환 지시 존재, streak 0~1 exact equality를 검증하는 spec을 추가해 RED를 확인한다.
- [x] `buildSystemPrompt`만 최소 수정해 streak 조건에서 되묻기 규칙과 분량 규칙을 제거·치환한다.
- [x] focused spec을 GREEN으로 만들고 T1~T3 diff가 바뀌지 않았는지 확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`를 각각 실행해 exit 0을 확인한다.
- [x] `.ai/implementation-summary.md`에 `T4 재구현` 절을 덧붙이고 Review를 작성한다.

## Review

- streak 2·3 prompt에서 기존 되묻기 유도 4문구를 제거하고, 질문 종결·선택지 금지와 진술형 방향 제안을 명시했다. repo 확인 예외도 질문 금지로 치환해 모순을 남기지 않았다.
- streak 0·1은 no-streak prompt와 exact equality이며 기존 prompt SHA-256까지 고정했다.
- TDD RED는 기존 `follow-up 질문으로 끌어주세요.` 잔존으로 신규 2 tests가 실패했고, 수정 후 focused 25/25 통과했다.
- 최종 gate는 lint exit 0(기존 warning 57), 일반 test 306 suites/2,450 tests, code-graph 5 suites/40 tests, build exit 0이다.
- untracked `scripts/_dump2.ts`는 lint 중 임시 분리 후 같은 SHA-256으로 복원했다. T1~T3 production code와 commit은 건드리지 않았다.

---

# 학습 브리핑 3차 최종 Notion 실발행 확인 스크립트 (2026-08-06)

**Goal:** `548d2c4`의 최신 파서·CTO 판정·Notion publisher로 새 `study_brief`를 1회 저장·발행해 콜아웃 줄 수와 불릿 병합을 육안 확인할 일회성 스크립트를 작성한다.

**Constraints:** 스크립트는 실행하지 않는다. `AppModule`, `StudyBriefCronModule`, `CronIdempotencyService`를 사용하지 않는다. `.env`, DB schema, git index/commit/push를 건드리지 않는다. 검증은 `pnpm exec tsc --noEmit`만 수행한다.

- [x] HEAD `548d2c4`와 직전 실발행 계약, production 생성자·입출력 타입을 확인한다.
- [x] `scripts/tmp-notion-final-check.ts`에 Hermes 파싱, 새 CTO 판정, Prisma 저장을 연결한다.
- [x] `NotionApiClient` + `StudyBriefNotionPublisher.publish()` + `updateNotionUrl()`로 실발행 경로를 연결한다.
- [x] 단계별 stdout, URL/brief id, verdict 문자 수, 콜아웃 전문, 실패 메시지 시크릿 마스킹을 구현한다.
- [x] 금지 구성요소·부수효과를 정적 점검하고 `pnpm exec tsc --noEmit`로 타입만 검증한다.
- [x] 아래 Review에 실제 검증 결과와 미실행 범위를 기록한다.

## Review

- `/tmp/hermes2.txt` 파싱부터 새 CTO verdict, `agentRunId: null` 원장 저장, production Notion publisher, URL 연결까지 7단계로 연결했다.
- 최종 출력에 Notion URL, `study_brief.id`, kind별 verdict 텍스트 필드의 Unicode 글자 수, publisher와 동일한 label의 콜아웃 전문을 남긴다.
- `AppModule`, `StudyBriefCronModule`, `CronIdempotencyService`, `PrismaService.onModuleInit()` 사용 없음을 정적 확인했다. 오류는 env secret 실값과 DB connection string/token 패턴을 마스킹한 메시지만 출력한다.
- 스크립트는 실행하지 않았다. `pnpm exec tsc --noEmit` exit 0. `.env`, DB schema, git index/commit/push는 건드리지 않았다.

---

# Markdown continuation 빈 줄 경계 수정 (2026-08-06)

**Goal:** 빈 줄 이후의 들여쓴 줄을 빈 줄 이전 블록에 병합하지 않고 별도 paragraph로 변환한다.

**Constraints:** 기존 미커밋 divider 수정과 code fence 내부 빈 줄 보존을 유지한다. `.env`, `pnpm db:push`, git add/commit/push를 실행하지 않는다.

- [x] 최신 `origin/main` 기반 브랜치와 기존 divider diff를 확인한다.
- [x] 불릿 continuation의 빈 줄 경계 및 요구 회귀 spec을 추가하고 RED를 확인한다.
- [x] 직전 원본 줄의 continuation 가능 상태를 루프에 추가해 빈 줄에서 병합 대상을 끊는다.
- [x] focused spec에서 빈 줄 경계·무경계 병합·code fence 빈 줄·divider 회귀를 확인한다.
- [x] 요청된 6개 게이트와 `git diff --check`를 실행한다.
- [x] `.ai/implementation-summary.md`에 이번 수정 절과 실제 결과를 기록한다.

## Review

- `continuationAllowed`로 원본 줄 경계를 관리해 빈 줄·code fence 종료 후에는 이전 block 병합을 차단했다.
- TDD: 빈 줄 후 들여쓴 문단이 불릿에 합쳐져 1 failed / 25 passed를 확인한 뒤 focused spec 26/26 GREEN을 확인했다.
- divider 미커밋 수정과 code fence 내부 `\n\n` 보존 회귀를 같은 spec에서 확인했다.
- 최종 gate: `pnpm lint:check` exit 0(기존 warning 57건), `pnpm test` exit 0(304 suites / 2,361 tests + code-graph 5 suites / 40 tests), `pnpm build`, `pnpm docs:check`, `pnpm check:env`, `pnpm check:invariants` 모두 exit 0.

---

# PR #249 봇 리뷰 대응 (2026-08-06)

**Goal:** 들여쓴 divider를 continuation에서 제외해 Notion divider block으로 보존한다.

**Constraints:** bullet 문법과 code fence 동작을 보존한다. `.env`, `pnpm db:push`, git add/commit/push를 실행하지 않는다.

- [x] 기존 divider·continuation·code fence 흐름과 작업 트리를 확인한다.
- [x] 들여쓴 divider 및 요구된 회귀 spec을 추가하고 RED를 확인한다.
- [x] divider 문법을 bullet과 분리해 continuation 차단과 block 변환에 같은 기준을 적용한다.
- [x] focused spec GREEN과 최종 diff를 검토한다.
- [x] 요청된 6개 게이트와 `git diff --check`를 실행한다.
- [x] `.ai/implementation-summary.md`에 `봇 리뷰 대응` 절과 실제 결과를 기록한다.

## Review

- 들여쓴 divider를 continuation에서 제외하고 `divider` block으로 변환했다. code fence 순서는 유지했다.
- TDD: 새 회귀 3건 RED(들여쓴 divider의 paragraph/bullet 병합, `----` paragraph 변환) 후 GREEN.
- PR #249 gate: `pnpm lint:check` exit 0 (기존 warning 57건), `pnpm test` exit 0 (304 suites / 2,353 tests + code-graph 5 suites / 40 tests), `pnpm build` exit 0, `pnpm docs:check` exit 0, `pnpm check:env` exit 0, `pnpm check:invariants` exit 0, `git diff --check` exit 0.

---

# 학습 브리핑 3차 개선 구현 계획

**Goal:** CTO verdict 중복 필드를 제거하고 Notion 콜아웃을 400자 이하로 방어하며 Markdown 들여쓰기 연속 줄을 직전 블록에 유지한다.

**Architecture:** 축소된 verdict 계약을 CTO→Study Brief DTO→formatter/publisher까지 동기화한다. Notion publisher는 초과 항목을 paragraph로 내리고, Markdown 변환기는 code fence 밖의 들여쓰기 연속 줄만 직전 rich_text에 합친다.

**Constraints:** `.ai/design.md` A–D 준수. `.env`, DB schema, `parseStudyResearch`, `buildStudyResearchPrompt` 수정 금지. `pnpm db:push`, git add/commit/push 금지.

- [x] 계약·관련 코드·전체 참조·회귀 경계를 조사한다.
- [x] A/B verdict 타입·프롬프트·파서 실패 spec을 확인한 뒤 최소 구현한다.
- [x] Study Brief 로컬 DTO·consumer mapping·Slack formatter를 새 계약에 맞춘다.
- [x] C Notion callout 축소와 400자 overflow paragraph를 TDD로 구현한다.
- [x] D Markdown 들여쓰기 연속 줄 필수 5개 spec을 RED→GREEN으로 구현한다.
- [x] 제거 필드 prompt/production 참조 0건과 Study Brief domain의 CTO import 0건을 확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm docs:check`, `pnpm check:env`, `pnpm check:invariants`를 순서대로 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 작성한다.

## Review

- CTO verdict와 Study Brief 로컬 DTO에서 중복 필드 2개를 제거하고, prompt schema·parser·consumer mapping·Slack·Notion·fixture를 끝까지 동기화했다.
- callout은 표시 text 400자까지 유지하고 초과 항목은 paragraph로 내린다. 첫 항목 자체가 초과하면 빈 callout 없이 전체 항목을 paragraph로 내린다.
- Markdown 들여쓰기 연속 줄을 code fence 밖에서 직전 block에 붙이고, 새 block 문법·첫 줄·code·Unicode 2,000자 경계를 spec으로 고정했다.
- 최종 검증: lint exit 0(기존 warning 57), test 304 suites/2,347 + code-graph 5 suites/40, build/docs/env/invariants 모두 exit 0.
- 최종 독립 review: Critical/Important/Minor 0건, `Ready: Yes`. 설계 방어 경계와 실제 Notion 재검증 지점은 `.ai/implementation-summary.md`에 기록했다.

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

# 학습 브리핑 Notion 실발행 확인 스크립트 (2026-08-06)

**Goal:** `/tmp/hermes2.txt`를 머지된 조사 파서, CTO 판정, DB 원장, Notion publisher에 순서대로 태우는 1회성 확인 스크립트를 작성한다.

**Constraints:** 스크립트는 실행하지 않는다. `AppModule`, `StudyBriefCronModule`, `CronIdempotencyService`를 사용하지 않는다. `.env`, DB schema, git index/commit/push는 건드리지 않는다. 검증은 `pnpm exec tsc --noEmit`만 수행한다.

- [x] 유사 스크립트와 parser/prompt/provider/repo collector/Prisma/Notion 실제 시그니처를 확인한다.
- [x] `scripts/tmp-notion-publish-check.ts`에 단계별 파싱, CTO 판정, `agentRunId: null` 저장을 구현한다.
- [x] 실제 `StudyBriefNotionPublisher.publish()`와 repository `updateNotionUrl()` 호출을 연결한다.
- [x] 오류 메시지의 token·connection string 마스킹과 요청된 최종 출력값을 구현한다.
- [x] `pnpm exec tsc --noEmit`로 타입만 검증하고 실행 금지·금지 작업 미실행을 diff로 확인한다.

## Review

- `/tmp/hermes2.txt`를 머지된 parser로 읽고, 최신 CareerProfile과 `RepoContextCollector` 결과를 CTO prompt에 넣는다.
- `CodexCliProvider`를 직접 호출하며 AgentRun은 만들지 않는다. 원장은 Prisma로 `agentRunId: null` 저장한다.
- `StudyBriefNotionPublisher.publish()` 결과 URL을 `StudyBriefPrismaRepository.updateNotionUrl()`로 연결한다.
- 실행하지 않았다. `pnpm exec tsc --noEmit` exit 0. `.env`, DB schema, git index/commit/push도 건드리지 않았다.

# 리베이스 후 콘솔 총원·성장 좌석 정리 (2026-08-05)

**Goal:** INVEST와 CTO_STUDY가 함께 들어온 운영 29명 상태에 현재 총원 표기를 맞추고, 성장 부서 6명이 기존 좌석·경계·통행 불변식을 만족하는지 확인한다.

**Root cause:** 양쪽 브랜치가 같은 총원 문구를 27에서 28로 독립 수정해 3-way merge가 충돌 없이 28을 유지했다. 운영 registry는 리베이스 결과 29개다.

**Constraints:** 과거 결함 기록의 26/27은 보존한다. 좌석 실패 시 단언을 완화하지 않고 배치만 고친다. `.env`, DB push, git index/commit/push는 건드리지 않는다.

- [x] registry 29개와 console의 26~29명/종 문구를 전수 조사해 현재 상태와 과거 기록을 분류한다.
- [x] 현재 총원을 뜻하는 28명/종 문구를 29명/종으로 바꾼다.
- [x] `swift build && swift run ConsoleCoreTests`로 전원 배정과 성장 방 좌석·경계·통행을 확인한다.
- [x] 실패 시 기존 배치 규칙에 맞춰 성장 좌석을 늘리고 focused/full Swift 검증을 다시 실행한다. (통과해 배치 변경 불필요)
- [x] `pnpm lint:check && pnpm test && pnpm build`를 실행한다.
- [x] `.ai/implementation-summary.md`에 "리베이스 후 정리" 절과 실제 결과를 기록한다.
- [x] 최종 diff와 금지 작업 미실행을 확인하고 Review를 작성한다.

## Review

- 현재 상태의 28명/종 20건을 29명/종으로 갱신했다. 사용자 목록 밖 `scripts/build-sprites.py` 1건을 포함하고, 과거 26/27 기록 5건은 보존했다.
- 성장 방은 현재 6석 배정이며 기존 배치로 7명까지 안전 수용 가능해 여유는 1석이다. 전원 배정·경계·문·벽·통행 검사가 통과해 좌석 배치는 수정하지 않았다.
- 원문 Swift 게이트는 compiler/SDK 불일치로 코드 compile 전 exit 1. 호환 SDK 게이트는 build/test exit 0, 1,016건 통과했다.
- 백엔드 lint/test/build exit 0. `.env`, DB push, git add/commit/push는 실행하지 않았다.

---

# 콘솔 오피스 — 세션을 사람에서 "대표 책상 위 화면"으로 (2026-08-05)

## 문제

대표실에 세션 캐릭터 열 명이 한 칸 간격으로 도열하고, 머리 위 이름표가 서로 이어 붙어 한
줄짜리 글자 뭉치가 됐다. 대부분 반투명(쉬는 세션)이라 "없던 직원이 갑자기 생긴" 유령 무리로
읽혔다. 데이터는 정확했다 — 잡힌 세션 13개 전부 실제로 살아 있는 프로세스였고, 문제는
전적으로 표현이었다.

사람으로 세우는 접근 자체가 틀렸다는 것이 도중에 드러났다. 세션은 편집기 창 하나당 하나씩
잡히는데, 그건 사규가 배정한 일이 아니라 **대표 본인의 작업**이다. 대표가 이미 화면에 서 있는데
그 사람이 다섯으로 복제돼 자기 앞에 늘어선 꼴이라 은유가 성립하지 않았다.

## Plan

- [x] 회귀 렌더가 세션을 그리게 한다(`syncSessions` 누락으로 이 결함이 점검을 통째로 빠져나갔다).
- [x] 라벨 헬퍼에 외곽선을 넣어 가구 무늬 위에서도 읽히게 한다.
- [x] 창 크기 변경 시 세션이 재배치·재계산에서 빠지던 버그를 고친다.
- [x] 세션 캐릭터를 걷어내고 대표실에 **작업 책상 5개**를 고정 배치한다.
- [x] 도는 작업이 있는 책상만 모니터 화면이 켜지게 한다.
- [x] 한 번 잡은 책상은 지키게 한다(`officeAssignSessionSeats`).
- [x] 쓰이지 않게 된 세션 캐릭터 코드(셔츠 오버라이드·발치 이름표)를 지운다.

## Review

- **사람을 늘리지 않는다.** 늘어나는 것은 켜진 화면이다. 일이 끝나면 화면이 꺼질 뿐 아무도
  사라지지 않으므로 "갑자기 생겼다 사라지는" 현상이 원천적으로 없다.
- **창 크기 변경 버그가 진짜 원인이었다.** `repositionEveryone()` 이 에이전트만 다시 놓고
  세션을 빼먹어, 좌표계가 바뀐 뒤 세션만 옛 좌표에 남아 **부서 방 한가운데 떠 있었다**.
  같은 이유로 크기 재계산도 못 받아 에이전트와 크기가 어긋나 보였다. 실좌표를 찍어 확인했다
  (목적지·경로는 정상이었고 문제는 재배치 누락).
- 화면에서 빠지는 기준은 "쉬는 중"이 아니라 **15분간 조용함**이다. 백엔드 `idle` 은 60초짜리라
  그 기준으로 지우면 답변을 기다리는 사이 표시가 깜빡인다(실측으로 25초 만에 하나가 빠졌다).
- 검증: 콘솔 테스트 895건 통과, 오프스크린 렌더로 수정 전/후 대조. **실앱 반영은 재시작 필요.**
- 범위 밖: 상단 밴드 확장은 실험 후 되돌렸다(타일이 10% 작아지고 밴드 가구가 전부 벽에서
  떨어져 붕 뜬다). 가구와 사람의 축척 편차는 에셋 가로세로비에서 오는 기존 한계로
  (`FurnitureKind.sizeBoost` 주석), 이번 범위 밖이다.

---

# 문서 정합성 정리 Todo

## Plan

- [x] `README.md`의 구현 현황 숫자와 모델 라우팅 설명을 코드 기준으로 갱신한다.
- [x] `README.md`의 Autopilot, BE sandbox, 내부 agent 설명을 현재 구현 상태에 맞게 재분류한다.
- [x] `.env.example`의 Claude 라우팅 설명을 "보존/롤백용"으로 낮추고 현재 Codex 단일 라우팅 정책과 맞춘다.
- [x] `CODE_RULES.md`에서 TypeORM/DDD_BE/BaseEntity 이식 잔재를 제거하고 Prisma/NestJS 기준으로 정리한다.
- [x] `pnpm docs:check`, `pnpm check:env`, `pnpm lint:check`로 문서 변경 후 상태를 확인한다.

## Review

- `README.md`의 구현 현황을 코드 기준으로 갱신했다: 전체 AgentType 25종, 사용자-facing worker 17개, Prisma model 14개, Codex 단일 provider, Autopilot/BE sandbox 현황을 반영.
- `.env.example`의 Claude 설명을 롤백 대비용으로 낮추고 optional env 문서화를 보강해 `check:env` 경고를 0개로 줄였다.
- `CODE_RULES.md`의 `DDD_BE`, TypeORM, BaseEntity 이식 잔재를 제거하고 Prisma/NestJS 기준 규칙으로 정리했다.
- Verification: `pnpm docs:check` OK, `pnpm check:env` OK, `pnpm lint:check` exit 0. `lint:check`는 기존 spec 파일의 `no-explicit-any` warning 47개를 출력했다.

---

# 문서 정합성 패치 Push Todo

## Plan

- [x] 로컬 `main`과 `origin/main` 차이를 확인하고 원격 최신 커밋 위에 작업을 얹는다.
- [x] 이번 문서 정리 파일만 stage 한다: `README.md`, `CODE_RULES.md`, `.env.example`, `tasks/todo.md`.
- [x] 문서 검증 명령과 repo 기본 검증 명령을 다시 실행한다.
- [x] 커밋을 만들고 `origin/main`으로 push 한다.

## Review

- `origin/main` 최신 커밋 위로 rebase 완료.
- Stage/commit 대상은 `README.md`, `CODE_RULES.md`, `.env.example`, `tasks/todo.md`로 제한했다.
- Verification: `pnpm docs:check` OK, `pnpm check:env` OK, `pnpm lint:check` exit 0, `pnpm test` OK, `pnpm build` OK.
- `pnpm lint:check`는 기존 spec 파일의 `no-explicit-any` warning 47개를 출력했다.

---

# Lodash 취약점 제거 Todo

## Plan

- [x] 직접 `lodash` import/use 여부와 `pnpm why lodash` 경로를 확인한다.
- [x] `@nestjs/config`를 vulnerable `lodash@4.17.23`를 끌지 않는 최신 patch로 올린다.
- [x] lockfile에서 prod `lodash@4.17.23` 경로가 제거됐는지 확인한다.
- [x] `pnpm audit --prod`에서 lodash advisory가 사라졌는지 확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`로 회귀를 확인한다.

## Review

- 앱 코드의 직접 `lodash` import/use 는 없었다. 따라서 `es-toolkit`으로 바꿀 코드 사용처도 없고, unused dependency 로 추가하지 않았다.
- prod `lodash` 경로는 `@nestjs/config@4.0.3 -> lodash@4.17.23` 하나였고, `@nestjs/config@4.0.4`로 올려 `lodash@4.18.1` 경로로 갱신했다.
- `pnpm audit --prod`에서 lodash advisory(`GHSA-r5fr-rjxr-66jc`)가 사라졌고, 전체 취약점 수는 22개에서 20개로 줄었다.
- 남은 audit 항목은 `basic-ftp`, `multer`, `undici`, `file-type`, `uuid`, `qs`, `js-yaml` 계열로 별도 작업 대상이다.
- Verification: direct lodash rg no match, `pnpm why lodash` shows `4.18.1` only, `pnpm lint:check` exit 0, `pnpm test` OK, `pnpm build` OK.
- `pnpm lint:check`는 기존 spec 파일의 `no-explicit-any` warning 47개를 계속 출력했다.

---

# PR 리뷰 스윕 재시도 쿨다운·예산 구현 계획

**Goal:** 첫 스윕 리뷰 실패를 열린 PR 수명 안에 재시도하되, 반복 실패는 24시간 예산으로 제한한다.

**Architecture:** `judgeLatestReview`는 최신 run 한 건만으로 10분 쿨다운을 판정하는 pure function으로 유지한다. 쿨다운을 통과한 FAILED/IN_PROGRESS retry에 한해서만 AgentRun JSON path count를 조회하고, 조회 실패 또는 3회 이상이면 보수적으로 SKIP한다.

**Constraints:** cron `*/5`와 `NEW_REVIEW_LIMIT_PER_SWEEP = 3`은 변경하지 않는다. git add/commit/push를 실행하지 않는다. Node 22 + pnpm을 사용한다.

- [x] 기존 구현·최근 변경·mock 범위를 조사해 root cause와 수정 파일을 확정한다.
- [x] `sweep-pr-reviews.usecase.spec.ts`에 10분 경계, 24시간 3회 예산, 조회 실패, common path 미조회 회귀 테스트를 먼저 추가한다.
- [x] `agent-run.prisma.repository.spec.ts`에 unsuccessful sweep count query 계약 테스트를 먼저 추가한다.
- [x] `agent-run.service.spec.ts`에 count delegation 테스트를 먼저 추가한다.
- [x] 새 테스트를 실행해 capability/분기 미구현으로 의도대로 실패(RED)하는지 확인한다.
- [x] `AgentRunRepositoryPort` query interface·method, Prisma count 구현, service delegation을 최소 구현한다.
- [x] `SweepPrReviewsUsecase`의 쿨다운을 10분으로 변경하고 retry-only budget gate 및 conservative error handling을 구현한다.
- [x] 모든 `jest.Mocked<AgentRunRepositoryPort>` object literal과 narrowed service mock을 새 method로 보강한다.
- [x] 관련 단위 테스트를 실행해 GREEN을 확인하고 필요한 최소 정리만 한다.
- [x] 최종 diff를 요구사항·보안·성능 관점에서 검토한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`를 각각 실행해 exit 0을 확인한다.
- [x] `.ai/implementation-summary.md`에 변경·설계 이탈·세 명령의 정확한 최종 출력 줄을 기록한다.

## Review

- 6시간 쿨다운을 10분으로 줄이고, 24시간 내 실패/고착 시도 3회 예산을 retry 직전에만 조회하도록 분리했다.
- `judgeLatestReview`는 DB 의존성 없는 pure function으로 유지했고, fresh/SUCCEEDED/cooldown 미경과 common path에는 JSON path count 조회가 추가되지 않았다.
- 포트·Prisma repository·service 위임과 관련 테스트·full repository mock 3곳을 동기화했다.
- Verification: `pnpm lint:check` exit 0 (기존 warning 53건), `pnpm test` exit 0 (288+5 suites, 2112+40 tests), `pnpm build` exit 0.
- 설계 이탈 없음. cron `*/5`와 `NEW_REVIEW_LIMIT_PER_SWEEP = 3`은 변경하지 않았다.

---

# 이대리 콘솔 오피스 2단계 구현 계획

- [x] `.ai/design.md`와 지정 기존 파일을 전부 읽고 통합 지점·불변식을 확인한다.
- [x] `OfficeIdleTests.swift`에 설계 §5 전체 표와 §2 튜닝 상수 검증을 먼저 작성하고 `main.swift`에 등록한다.
- [x] 신규 테스트가 미구현 API 때문에 실패하는 RED 상태를 확인한다.
- [x] `OfficeIdle.swift`에 후보 판정, 선발, 평면도 기반 목적지, 결정론적 배정, 시간대 분위기 순수 로직을 구현한다.
- [x] `FurnitureKind.strollDwellSeconds`와 `affectedAgentTypes(of:)`를 정확한 계약대로 추가한다.
- [x] 순수 로직 테스트가 GREEN인지 확인하고 필요한 최소 리팩터링만 한다.
- [x] `OfficeScene`에 반복 감독관, 배회 실행·취소, 기존 `visitLounge` 편입, resize 정리, 분위기 색 막을 연결한다.
- [x] `.ai/implementation-summary.md`에 설계 일치 여부·이탈 사유·재검증 필요 여부를 기록한다.
- [x] 최종 diff를 범위·결정론·주석·이벤트 우선순위 관점에서 검토한다.
- [x] 원문 게이트의 toolchain 실패를 분리하고 호환 SDK·관리 sandbox 옵션으로 build/test exit 0, 354건 초과, 실패 0을 확인한다.

## Review

- Core 판정과 SpriteKit 실행 경계를 분리하고, 실제 이벤트가 배회를 먼저 취소하도록 연결했다.
- 운영 27종 표본을 포함한 `ConsoleCoreTests` 408건이 통과했다(기존 354건 대비 +54).
- Verification: 호환 SDK와 `--disable-sandbox`를 적용한 `swift build` 및 `swift run ConsoleCoreTests` 모두 exit 0.
- 로컬 활성 compiler 6.3.3과 SDK 6.3.2 불일치로 사용자 원문 명령은 코드 컴파일 전 exit 1이다. 상세는 `.ai/implementation-summary.md`에 기록했다.
- `zPosition = 500` 계약은 따랐지만 기존 `CharacterNode` 글자 계층과 충돌해 시각 재검증이 필요하다.

---

# 오피스 2단계 잔존 결함 2건 구현 계획

**Goal:** 승인 오픈 색을 이벤트 순서와 무관하게 확정하고, 재연결 snapshot을 정본으로 승인 줄을 정리한다.

**Architecture:** 이벤트 번역과 줄 판정은 `ConsoleCore` 순수 함수가 소유한다. `OfficeScene`은 승인 snapshot을 받아 순수 판정 결과를 이동으로 실행하고, `OfficeView`는 agents·approvals 어느 쪽이 바뀌어도 동기화한다.

**Constraints:** `stateChanged(.inProgress) -> .working`, `replayInitialChoreography()`, `OfficeIdle.swift`, `src/**`는 변경하지 않는다. `ConsoleApproval.agentType == nil`은 누구도 매칭하지 않는다. 줄 입력 순서를 보존한다. commit·push하지 않는다.

- [x] `OfficeChoreographyTests.swift`에 approval opened recolor·nil·미지 agentType 회귀 테스트를 추가한다.
- [x] `OfficeInteractionTests.swift`에 `reconciledQueueOrder` 계약 표 7건을 추가한다.
- [x] 신규 테스트를 실행해 누락 동작 때문에 실패하는 RED를 확인한다.
- [x] `OfficeChoreography.swift`의 `approvalOpened`에 이동-색-말풍선 순서로 recolor를 최소 추가한다.
- [x] `OfficeInteraction.swift`에 입력 순서를 보존하는 `reconciledQueueOrder` 순수 함수를 구현한다.
- [x] `OfficeScene.sync(agents:approvals:)`와 `lastSyncedApprovals`, `didChangeSize`, 줄 이탈 `goHome` 배선을 구현한다.
- [x] `OfficeView`의 sync 호출 2곳과 approvals 전용 `onChange`를 연결한다.
- [x] 관련 테스트 GREEN 뒤 전체 build/test 게이트를 실행하고 sandbox 제약을 분리 기록한다.
- [x] final diff에서 금지 경로·기존 미커밋 변경 보존·테스트 수 408 초과를 확인한다.
- [x] `.ai/implementation-summary-fixups.md`에 설계 이탈·이유·재검증 필요 여부와 게이트 결과를 기록한다.

## Review

- `approval.opened`가 이동 직후 승인 대기색을 직접 확정하도록 바꿨다. nil·미지 agentType은 기존처럼 연출이 없다.
- snapshot agents·approvals를 정본으로 줄을 맞추고, 승인 해소자를 같은 sync에서 자리로 복귀시킨다. 결과는 `current.filter`라 도착 순서를 보존한다.
- `ConsoleApproval: Equatable`은 SwiftUI approvals `onChange`의 compile 제약을 만족하기 위한 최소 보완이다.
- Verification: 호환 Swift 게이트 build/test exit 0, `ConsoleCoreTests` 417건, 실패 0, `git diff --check` exit 0.
- 원문 Swift 명령은 관리 sandbox의 `sandbox-exec` 제한으로 exit 1이며, pnpm 3중 게이트는 `node_modules` 미설치로 실행 불가했다. 상세는 `.ai/implementation-summary-fixups.md`에 기록했다.

---

# PR #222 승인 줄 신규 합류 보정 계획

**Goal:** 재연결 중 승인 이벤트를 놓쳐도 snapshot의 승인 대기자를 기존 줄 뒤에 결정론적으로 합류시키고 배회를 즉시 중단한다.

**Architecture:** `ConsoleCore.reconciledQueueOrder`가 줄 유지·제거·신규 추가 판정을 모두 소유한다. `OfficeScene`은 이전·새 줄의 차이에서 이탈자와 합류자를 구해 각각 `goHome`, `cancelStroll`로 실행한 뒤 기존 `layoutQueue`를 재사용한다.

**Constraints:** `OfficeIdle.swift`, `src/**`는 변경하지 않는다. `ConsoleApproval.agentType == nil`은 누구도 합류시키지 않는다. 결과 순서는 `current` 유지분 뒤에 `agents` 순서 신규분을 붙인다. commit·push하지 않는다.

- [x] 지정 코드·최근 변경·기존 테스트를 읽고 root cause와 변경 범위를 확정한다.
- [x] `OfficeInteractionTests.swift`에 신규 합류 계약 6건을 추가한다.
- [x] 기존 구현에서 신규 테스트가 누락 동작 때문에 실패하는 RED를 확인한다.
- [x] `OfficeInteraction.swift`가 기존 순서를 보존하며 snapshot 신규 대기자를 중복 없이 추가하게 한다.
- [x] `OfficeScene.reconcileQueue`가 신규 합류자의 배회를 취소한 뒤 `layoutQueue`로 줄 칸에 배치하게 한다.
- [x] 관련 테스트 GREEN과 독립 요구사항 검토를 확인한다.
- [ ] 사용자 지정 `swift build`, `swift run ConsoleCoreTests` 게이트가 각각 exit 0인지 확인한다.
- [x] 최종 diff에서 `OfficeIdle.swift`, `src/**`, commit·push가 없고 테스트 수가 417건보다 늘었는지 확인한다.

## Review

- `reconciledQueueOrder`가 기존 줄 유지분 뒤에 snapshot 신규 대기자를 `agents` 순서로 추가한다. `Set`은 membership에만 쓰며 결과 순회 순서는 배열이 정한다.
- 신규 합류자는 `cancelStroll` 후 최종 `layoutQueue`로 자기 순번 칸에 이동한다. 독립 리뷰 verdict는 APPROVE, P1/P2 없음이다.
- TDD RED는 신규 추가 누락 4건 실패를 확인했다. GREEN은 호환 `MacOSX15.4.sdk`와 `--disable-sandbox` 환경에서 build/test exit 0, 423건 통과, 실패 0이다.
- 사용자 원문 게이트는 코드 compile 전 환경 문제로 build/test 모두 exit 1이다. 활성 compiler Swift 6.3.3과 SDK Swift 6.3.2가 불일치하고, 호환 SDK 지정만으로는 관리 sandbox의 `sandbox-exec: sandbox_apply: Operation not permitted`가 발생한다.
- `git diff --check` exit 0. `OfficeIdle.swift`, `src/**` 변경 없음. commit·push 없음.

---

# PR #222 snapshot-only 배회 취소 보정 계획

**Goal:** 재연결 snapshot에서 배회 중인 직원의 상태가 대기 이외로 바뀌면 기존 배회를 끊고 자리로 걸어서 복귀시킨다.

**Architecture:** `ConsoleCore.strollersToStop`이 snapshot과 배회 집합을 받아 중단 대상을 순수·결정론적으로 판정한다. `OfficeScene.sync`는 승인 줄 정합화 직후 그 결과를 `cancelStroll`과 `goHome`으로 실행한다.

**Constraints:** `OfficeIdle.swift`, `src/**`, 직전 `reconciledQueueOrder`와 joining 배회 취소 로직은 변경하지 않는다. 없는 agentType도 중단 대상이다. 반환 순서는 `sorted()`다. commit·push하지 않는다.

- [x] 지정 코드·최근 변경·dirty 상태를 읽고 snapshot-only 경로의 root cause를 확인한다.
- [x] `OfficeInteractionTests.swift`에 waiting 유지, 비-waiting 전 상태 중단, snapshot 누락, 정렬, 빈 Set 회귀 테스트를 추가한다.
- [x] 신규 테스트가 `strollersToStop` 미구현 때문에 실패하는 RED를 확인한다.
- [x] `OfficeInteraction.swift`에 `strollersToStop(strolling:agents:)`를 최소 구현한다.
- [x] `OfficeScene.sync`가 `reconcileQueue` 직후 중단 대상을 취소하고 `goHome`으로 복귀시키게 연결한다.
- [ ] 관련 테스트 GREEN 뒤 사용자 지정 `swift build`, `swift run ConsoleCoreTests` 게이트를 각각 실행한다.
- [x] 최종 diff에서 금지 경로·직전 로직 보존·정렬·테스트 증가·HEAD 불변을 확인한다.

## Review

- `strollersToStop`이 waiting 배회자는 유지하고, 나머지 상태와 snapshot 누락 배회자는 중단 대상으로 정렬해 반환한다.
- `OfficeScene.sync`가 승인 줄 정합화 직후 중단 대상의 action을 취소하고 `goHome`으로 복귀시킨다. 완료 전이는 뒤의 `visitLounge`가 새 `walk`로 덮는다.
- TDD RED는 `strollersToStop` 부재 compile error를 확인했다. 호환 flag 환경에서 build/test exit 0, `ConsoleCoreTests` 432건, 실패 0이다(기존 423건 대비 +9).
- 사용자 원문 gate는 build/test 모두 exit 1이다. 설치된 compiler Swift 6.3.3과 SDK Swift 6.3.2가 불일치하며, matching toolchain이 설치돼 있지 않다.
- 독립 review는 Critical/Important/Minor 모두 없음, verdict `Ready: 예`다.
- `git diff --check` exit 0. `OfficeIdle.swift`, `src/**` 변경 없음. HEAD `0a69d35`, commit·push 없음.

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

# 백엔드 서버 프로세스 종료

## Plan

- [x] 이 레포와 연결된 `pnpm dev` 프로세스의 PID, 부모, TTY, cwd를 확인한다.
- [x] 확인된 백엔드 프로세스 트리만 정상 종료한다.
- [x] 프로세스와 애플리케이션 포트가 내려갔는지 검증한다.

## Review

- PID `10935` (`node --enable-source-maps dist/src/main`)가 TTY 없이 PPID `1`로 실행되며 `3099`를 listen 중인 백엔드임을 확인했다.
- `SIGTERM`으로 정상 종료했다. `SIGKILL`은 필요하지 않았다.
- 종료 직후 PID `10935`가 사라졌고 `3099` listener도 없어졌다. 콘솔 앱과 Postgres/Redis 컨테이너는 유지했다.

---

# `contractViolations` Prisma 타입 오류 수정

## Plan

- [x] Prisma schema, repository 코드, generated client 타입을 대조해 root cause를 확인한다.
- [x] Prisma client를 현재 schema 기준으로 재생성하고 focused build로 오류 해소를 확인한다.
- [x] 실제 DB의 `contract_violations` column 유무를 확인하고 필요하면 schema를 동기화한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`를 각각 실행해 회귀를 검증한다.

## Review

- Root cause: `prisma/schema.prisma`와 실제 DB에는 필드/column이 있었지만, 로컬 generated Prisma client가 이전 schema 상태였다.
- `pnpm prisma:generate`로 Prisma Client v6.19.3을 재생성했다. 코드와 DB schema 변경은 필요하지 않았다.
- Verification: generated client에 `contractViolations` 타입 존재, focused `pnpm build` exit 0.
- Full gates: `pnpm lint:check` exit 0 (기존 warning 53건), `pnpm test` exit 0 (294+5 suites, 2221+40 tests), `pnpm build` exit 0.

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

# 오피스 벽걸이·문·수납 스프라이트 시트

## Plan

- [x] 현재 slicer 정렬·배경 판정 계약과 동시 dirty 변경을 확인한다.
- [x] `raw/furniture-wall.png` 1600×1120, 10셀을 생성하고 배경·순서·명도를 검수한다.
- [x] `raw/furniture-door.png` 1280×1024, 5셀을 생성하고 배경·순서·크기를 검수한다.
- [x] `build-sprites.py` `SHEETS`에 두 시트 이름 매핑만 추가하고 개별 PNG를 생성한다.
- [x] 생성 경고 0, 알파 배경, 최종 스프라이트 육안 검수, Swift 무수정을 확인한다.

## Review

- `furniture-wall.png` 1600×1120에 4/4/2 배치로 10종, `furniture-door.png` 1280×1024에 2/3 배치로 5종을 생성했다. 각 행 top edge는 A `104/408/760`, B `80/620`으로 일치한다.
- 신규 raw에만 배경 연결 magenta fringe 제거와 암색 outline 중립화를 적용해 어두운 벽 미리보기에서 보라색 테두리 잔여가 없음을 확인했다.
- `build-sprites.py` 매핑 15개를 추가했고 전체 87개를 경고 없이 생성했다. 신규 15개는 binary alpha이며 문 두 종은 모두 40×45px로 정확히 1 tile 폭이다.
- `git diff --check` 통과. Swift 파일은 열거나 수정하지 않았다. 작업 중 다른 실행 주체의 Swift dirty 변경은 계속 보존했다.

---

# 오피스 남은 가구·소품·러그 시트

## Plan

- [x] `furniture-2`, `props-2`, `rugs` 셀 크기·순서·이름 계약을 확정한다.
- [x] `raw/furniture-2.png`를 생성하고 남은 자판기·냉장고·싱크대·유리 파티션 4종을 검수한다.
- [x] `raw/props-2.png`를 생성하고 교체 대상 서류더미·스탠드·작은 화분 3종을 검수한다.
- [x] `raw/rugs.png`를 생성하고 녹색·베이지·네이비 러그 3종을 검수한다.
- [x] `build-sprites.py` 매핑·개별 PNG를 생성하고 크기·알파·재현성·Swift 무수정을 검증한다.

## Review

- 이미 만든 문·캐비닛·벽걸이와 기존에 사용 가능한 머그는 중복 생성하지 않고, 남은 10종만 세 raw 시트로 추가했다.
- `furniture-2.png` 1280×960은 4셀, `props-2.png` 1024×512는 3셀, `rugs.png` 2304×960은 3셀로 검출됐다. 행별 top edge는 정확히 일치한다.
- 교체 소품은 기존 런타임 크기 `10×6`, `8×11`, `10×10`을 유지했다. `draw-props.py`에서 해당 3종을 제거해 재실행 시 AI 에셋을 되돌리지 않는다.
- 러그 3종은 모두 80×80px로 완전히 펼친 top-down 2×2 tile 크기다. 내부 무늬는 상태 표시보다 낮은 대비로 유지했다.
- 신규 10종은 binary alpha이고, `build-sprites.py` → `draw-props.py` 재실행 후에도 SHA-256가 유지됐다. `py_compile`, `git diff --check` 통과.
- Swift 파일은 수정하지 않았고 기존·동시 dirty 변경을 보존했다.
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
# Daily Study Brief 구현 계획 (2026-08-05)

**Goal:** 매일 09:30 KST에 Hermes 딥다이브와 CTO 판정을 거쳐 CONCEPT/TOOL 학습 브리핑을 DB에 기록하고 Slack 카드·스레드로 발송한다.

**Contract:** `.ai/design.md`를 source of truth로 사용한다. `.env`, DB push, git index/commit/push는 건드리지 않는다. 공용 목록·enum은 끝에만 추가한다.

- [x] `.ai/design.md`, 복사 본보기, CTO usecase/parser, JD gap parser, repo 규칙을 전부 읽는다.
- [x] parser·prompt·usecase·scheduler·consumer·collector·formatter 필수 spec을 먼저 작성한다.
- [x] 신규 spec이 미구현 동작 때문에 실패하는 RED를 확인한다.
- [x] domain 타입·포트·parser·prompt·CTO usecase를 최소 구현한다.
- [x] scheduler·consumer·repository·collector·formatter·module을 최소 구현한다.
- [x] 공용 enum/목록/schema/app/env/README를 계약대로 끝에 추가하고 Prisma client를 생성한다.
- [x] focused spec을 GREEN으로 만들고 최소 리팩터링한다.
- [x] `pnpm docs:sync`, `pnpm docs:check`, `pnpm lint:check`, `pnpm test`, `pnpm build`를 실제 실행한다.
- [x] 최종 diff와 계약을 대조하고 `.ai/implementation-summary.md` 및 Review를 작성한다.

## Review

- Hermes 자유 출력 parser의 계약상 모든 거부 사유를 오류 메시지까지 검증하는 spec으로 고정했다.
- 09:30 KST scheduler, CTO_STUDY routing/AgentRun, StudyBrief 원장, Slack 카드·스레드 발송을 연결했다.
- 완료 guard와 별도 in-flight guard로 완료 후·동시 중복의 LLM 호출과 저장을 막고, Slack 실패 시 guard를 해제해 재시도를 살렸다.
- `pnpm prisma:generate`, `pnpm docs:check`, `pnpm check:env`, `pnpm lint:check`, `pnpm test`, `pnpm build` 모두 exit 0. 전체 303 suites, 2303 tests 통과.
- 독립 재리뷰 결과 Blocker·Should Fix 0건. `.env`, DB push, git index/commit/push는 건드리지 않았다.

---

# Daily Study Brief 발송 결함 수정 계획 (2026-08-05)

**Goal:** Slack 발송 실패가 저장된 브리핑의 재조사·중복 저장을 유발하지 않게 하고, 상세 스레드 실패를 요약 발송 성공과 분리한다.

**Contract:** `.ai/design.md` §5·§6과 `ResumeCalibrationCronConsumer.deliverOnce`를 따른다. `.env`, DB push, git index/commit/push는 건드리지 않고 공용 파일은 append-only로 갱신한다.

- [x] 설계 계약, 현재 consumer/spec, 유사 consumer, dirty worktree를 대조해 root cause를 확정한다.
- [x] stateful idempotency fake로 요약 발송 실패 후 재시도 회귀 spec을 추가하고 RED를 확인한다.
- [x] 완료 guard를 유지하는 최소 수정 후 focused spec GREEN을 확인한다.
- [x] 상세 스레드만 실패하는 회귀 spec을 추가하고 RED를 확인한다.
- [x] 상세 스레드 실패를 `logger.warn`으로 격리하고 focused spec GREEN을 확인한다.
- [x] 최종 diff를 설계 계약과 대조한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`를 순서대로 실행해 exit 0을 확인한다.
- [x] `.ai/implementation-summary.md`에 "검증 후 수정" 절과 실제 검증 결과를 추가한다.

## Review

- 완료 guard 해제를 제거해 요약 발송 실패 뒤 BullMQ 재시도가 `isDone`에서 끝나게 했다. processing guard는 기존대로 `finally`에서 해제한다.
- 요약 발송 실패만 주제명 포함 `StudyBriefException`으로 올리고, 상세 스레드 실패는 DB의 `reportMd` 정본을 근거로 `logger.warn` 후 정상 종료한다.
- stateful `Set<string>` fake가 실제 `acquireOnce`/`isDone`/`release` 의미를 재현한다. 회귀 spec은 재시도 시 Hermes·CTO·save 각 1회와 스레드 실패 시 failure DM 0회를 고정한다.
- TDD RED에서 완료/processing guard release 2회와 재시도 재실행, 스레드 실패 throw를 각각 확인했다. 수정 후 focused spec 9건 통과.
- Verification: `pnpm lint:check` exit 0 (오류 0, 기존 warning 57), `pnpm test` exit 0 (일반 298 suites/2265 tests + code-graph 5 suites/40 tests), `pnpm build` exit 0.
- 설계 이탈 없음. `.env`, `pnpm db:push`, git add/commit/push는 건드리지 않았다.
- 독립 최종 리뷰: Critical·Important·Minor 0건, Ready.

---

# CTO Study macOS 오피스 편입 계획 (2026-08-05)

**Goal:** Swift 픽셀 오피스에 `CTO_STUDY` 성장 부서 좌석과 7자 이하 한글 직책을 추가한다.

**Contract:** 백엔드 `src/`는 무변경. `.env`, `pnpm db:push`, git index/commit/push는 건드리지 않는다. 기존 case 순서·서식을 유지한다.

- [x] `sampleAgents` 성장 부서에 `CTO_STUDY`를 추가하고 `ConsoleCoreTests`의 직책 미매핑 RED를 확인한다.
- [x] `AgentRole.swift` 성장 섹션에 `CTO_STUDY = "학습 코치"`를 추가해 GREEN을 확인한다.
- [x] Swift 콘솔의 현재 총원 숫자 주석·메시지를 28명/종으로 맞추되, 과거 결함을 설명하는 역사적 숫자는 보존한다.
- [x] `swift build && swift run ConsoleCoreTests`로 직책·좌석·카펫·벽·통행 불변식을 검증한다.
- [x] `pnpm lint:check && pnpm test && pnpm build`를 실행해 백엔드 3중 게이트를 확인한다.
- [x] 최종 diff를 요구와 대조하고 `.ai/implementation-summary.md`에 "오피스 편입" 절과 Review를 추가한다.

## Review

- fixture 선행 RED에서 `CTO_STUDY` 직책 누락 1건만 실패했고, case 추가 후 1014건 전부 통과했다.
- 성장 방 기존 5좌석이 5명을 수용했다. 28명 전원 배정과 카펫·벽·통행 불변식이 동적 fixture로 통과해 배치 로직 수정은 없었다.
- 현재 총원 표기만 28로 갱신했다. 과거 결함 기록과 generic 경계 테스트 숫자는 유지했다.
- Swift build와 executable tests exit 0. 로컬 Swift 6.3.3/기본 SDK 6.3.2 불일치 때문에 `MacOSX15.4.sdk`와 `--disable-sandbox`를 사용했다.
- 백엔드 lint/test/build exit 0. `.env`, `pnpm db:push`, git add/commit/push는 실행하지 않았다.
- 독립 최종 리뷰: Critical·Important·Minor 0건, Ready.

---

# Daily Study Brief Slack 카드 가독성 수정 계획 (2026-08-05)

**Goal:** CONCEPT 카드의 중복 서두를 없애고, CONCEPT/TOOL 필드를 Slack 비고정폭 렌더에 맞는 단일 공백 형식으로 통일한다.

**Contract:** formatter와 관련 spec만 최소 수정한다. `caution` 생략 동작을 보존한다. `.env`, `pnpm db:push`, git index/commit/push는 건드리지 않는다.

- [x] 현재 formatter/spec과 `.ai/design.md` §5의 잘못된 서두 계약을 대조한다.
- [x] 두 kind의 새 전체 출력 기대값과 필드 값 1회 출현 회귀 spec을 먼저 추가한다.
- [x] focused spec에서 기존 구현이 실패하는 RED를 확인한다.
- [x] 중복 서두와 라벨 정렬용 연속 공백을 제거하는 최소 수정을 한다.
- [x] focused spec GREEN을 확인한다.
- [x] formatter를 직접 호출해 stdout 실제 출력을 눈으로 확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build` exit 0을 확인한다.
- [x] 최종 diff·작업 트리·금지 작업을 확인하고 Review를 작성한다.

## Review

- CONCEPT 서두 문단을 제거하고 CONCEPT/TOOL의 모든 필드 라벨 뒤 공백을 1칸으로 통일했다.
- 두 kind의 summary 전체 문자열을 고정하고, `whyNow`와 `whereItLands`가 각각 정확히 1회만 나오는 회귀 spec을 추가했다. 기존 `caution` 미출력 단언은 유지했다.
- TDD RED에서 CONCEPT 2건과 TOOL 1건이 기존 중복·공백 때문에 실패했고, 수정 후 focused spec 5건이 통과했다.
- formatter 직접 호출은 임시 파일 없이 exit 0이었고 CONCEPT/TOOL stdout을 확인했다.
- Verification: `pnpm lint:check && pnpm test && pnpm build` exit 0. lint 오류 0(기존 warning 57), 일반 298 suites/2271 tests와 code-graph 5 suites/40 tests 통과.
- `git diff --check` exit 0. 임시 스크립트 없음. `.env`, `pnpm db:push`, git add/commit/push는 실행하지 않았다.

---

# PR #243 봇 리뷰 대응 계획 (2026-08-05)

**Goal:** CTO와 Study Brief Cron의 역방향 도메인 의존을 끊고, Hermes argv에서 프로필 서술문을 제거하며, 날짜 경계 뒤에도 consumer spec이 안정적으로 동작하게 한다.

**Constraints:** 기존 미커밋 formatter 수정은 보존한다. Hermes runner의 `-z` argv 계약은 바꾸지 않는다. CTO의 `profileSummary` 입력은 유지한다. `.env`, `pnpm db:push`, git index/commit/push는 건드리지 않는다.

- [x] 기존 diff와 설계 결함, 실제 import·prompt·guard key 경로를 확인한다.
- [x] Hermes prompt에서 프로필 서술문이 빠지는 회귀 spec을 먼저 추가하고 RED를 확인한다.
- [x] CTO 도메인에 자체 kind/research 입력 타입을 정의하고 consumer가 parser 결과를 매핑한다.
- [x] Hermes prompt 입력을 스킬 이름·숙련도만 받도록 축소하고 CTO `profileSummary` 경로는 보존한다.
- [x] 날짜 하드코딩을 제거하되 queue/date/`:processing` 구조를 계속 단언한다.
- [x] `grep -rn "study-brief-cron" src/agent/` 0건과 focused spec GREEN을 확인한다.
- [x] `pnpm lint:check && pnpm test && pnpm build`를 실행한다.
- [x] `pnpm docs:check && pnpm check:env && pnpm check:invariants`를 실행한다.
- [x] `.ai/implementation-summary.md`에 "봇 리뷰 대응" 절과 검증 결과를 기록한다.
- [x] 최종 diff, 기존 formatter 변경 보존, 금지 작업 미실행을 확인하고 Review를 작성한다.

## Review

- CTO 도메인의 `StudyTopicKind`/`StudyTopicResearch`로 parser 타입 의존 2건을 제거했다. consumer가 필요한 4개 필드만 명시 매핑하며 의존 grep은 0건이다.
- Hermes prompt 입력을 `profileSkills`로 축소했다. `profileJson.summary`는 제외되고 `TypeScript(EXPERT)` 형식만 들어간다. CTO `profileSummary` 전달은 유지했다.
- 날짜 하드코딩 1건을 queue/date/`:processing` 전체 구조 정규식으로 교체했다. 같은 파일의 guard 날짜 하드코딩은 더 없다.
- TDD RED 2건을 확인했고 focused 4 suites/27 tests가 통과했다.
- 전체 lint/test/build와 docs/env/invariants 게이트가 exit 0이다. lint 기존 warning 57건, 일반 298 suites/2,272 tests, code-graph 5 suites/40 tests가 통과했다.
- 기존 formatter 미커밋 변경은 보존했다. `.env`, `pnpm db:push`, git add/commit/push는 실행하지 않았다.
- 독립 최종 리뷰 결과 Blocker 0, Should Fix 0이다.
# 토스증권 시세 소스 전환 구현 계획 (2026-08-06)

**Source of truth:** `.ai/design.md`. 실측 응답 외 필드·봉투를 유추하지 않는다.

**Constraints:** Node 22 + pnpm. `stock-anomaly.ts` 판정 로직과 `STOCK_THRESHOLDS`, Yahoo 클라이언트·매퍼, `ResolvedInstrument`, `scripts/register-holding.ts`, `prisma/schema.prisma`는 변경하지 않는다. git commit/push 금지.

- [x] 현재 Toss/Yahoo client·mapper·module·감시 경로와 기존 테스트 패턴을 확인한다.
- [x] 실측 fixture 기반 `toss-market-data.mapper.spec.ts`를 먼저 작성하고 RED를 확인한다.
- [x] `TossApiClient`, candle mapper, `TossInvestClient` 공통 HTTP 위임을 최소 구현하고 관련 테스트를 GREEN으로 만든다.
- [x] `toss-market-data.client.spec.ts`를 먼저 작성하고 count clamp, 429 전파, mapper 오류, 220ms 간격, Yahoo 환율 위임의 RED를 확인한다.
- [x] `TossMarketDataClient`, port/module DI 변경을 최소 구현하고 관련 테스트를 GREEN으로 만든다.
- [x] 감시 경로의 `yahooSymbol`을 `symbol`로 제한 리네임하고 repository가 `tossSymbol`을 사용하게 바꾼다.
- [x] `grep -rn "yahooSymbol" src scripts` 결과가 허용된 제외 파일뿐인지 확인하고 금지 파일 diff가 없는지 확인한다.
- [x] 전체 diff를 design.md 계약·코드 규칙·보안·rate limit·날짜/정렬 불변식 관점에서 리뷰한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm docs:check`를 각각 실행해 실제 exit code를 확인한다.
- [x] 실호출로 6종목 일봉 적재와 감시 대상 0→6 전환을 확인한다.
- [x] `.ai/implementation-summary.md`에 파일 목록, 설계 이탈, 4중 게이트 결과, Claude 재검증 지점을 기록한다.

## Review

- `TossApiClient`로 token cache와 HTTP 처리를 공유하고, 일봉은 Toss `/candles`로 전환했다. 환율만 Yahoo 위임으로 남겼다.
- mapper는 `timestamp` 앞 10자를 UTC 자정 거래일로 만들고 오름차순 정렬한다. 전체 candle 검증, Decimal finite, 정수 volume을 강제한다.
- `findCurrentHoldings`는 `ticker.tossSymbol`을 사용한다. 감시 경로 필드는 `symbol`로 중립화했고 판정 상수·수식·기대값은 불변이다.
- rate limit은 설계대로 호출 시작 간 최소 220ms 고정 간격이다. 429 retry는 추가하지 않았으며 HTTP 오류를 그대로 전파한다.
- 최종 리뷰의 credential 에러 문구 회귀 1건은 regression RED 후 기존 문구로 복원했고 scoped re-review `ADDRESSED`다.
- Verification: lint/test/build/docs:check 모두 exit 0. commit/push, Prisma/Yahoo 제외 파일 변경 없음. 상세는 `.ai/implementation-summary.md`에 기록했다.

---

---

# 학습 브리핑 2차 개선 구현 계획

구현 계약: `.ai/design.md` A·B·C. `parseStudyResearch`, `.env`, 기존 Notion 메서드 시그니처는 변경하지 않는다. `pnpm db:push`와 git 쓰기 작업은 실행하지 않는다.

## 계획

- [x] `.ai/design.md`, `CODE_RULES.md`, `tasks/lessons.md`, `src/notion/`, `src/study-brief-cron/`, CTO 프롬프트·usecase·registry·config·schema를 읽고 재사용 경계를 확인한다.
- [x] A: `buildStudyResearchPrompt` spec에 1,200~1,800자와 세 고정 섹션을 먼저 단언해 RED를 확인하고 프롬프트만 수정한다.
- [x] B: `RepoContextPort`와 `RepoContextCollector` spec을 먼저 추가해 `src/` 디렉터리, `AGENT_REGISTRY` 설명 매칭, 누락 경로 fallback, 100개 상한을 검증한다.
- [x] B: CTO 내부에 구조적으로 같은 repo module 타입을 두고 `EvaluateStudyTopicInput`·`buildStudyTopicPrompt`에 모듈 목록을 주입한다. `src/agent/`에서 `study-brief-cron` import 0건을 유지한다.
- [x] C1: `NotionClientPort`에 `createDatabasePage`만 추가하고 `NotionApiClient`의 기존 block 변환·rich text·100개 chunk 패턴을 확장 재사용한다. 기존 메서드 시그니처는 보존한다.
- [x] C1: 외부 의존성 없는 `markdown-to-blocks` spec을 먼저 작성한다. heading, bullet, numbered, code fence/language fallback, quote, divider, paragraph, bold/code annotation, 유니코드 안전 2,000자 분할, 빈 입력을 검증한다.
- [x] C2: `StudyBriefPublisherPort`와 `StudyBriefNotionPublisher` spec을 먼저 작성한다. verdict callout, 속성 payload, KST 날짜, 100블록 단위 create/append, TOOL caution 생략, 링크 출처를 검증한다.
- [x] C2: Prisma `StudyBrief.notionUrl` 및 repository 갱신 메서드를 추가하고 spec으로 저장 후 URL 갱신을 검증한다. `db:push`는 실행하지 않는다.
- [x] C3: formatter를 링크/폴백 두 모드로 분리하고 `## 세 줄 요약` 추출 및 첫 문단 fallback을 spec으로 검증한다. 기존 전체 카드와 3,000자 절단은 폴백에 보존한다.
- [x] C3: consumer spec을 먼저 보강한다. repo context 전달, 본문 초과 warn, Notion 성공 시 URL 저장+Slack 1회/스레드 0회, 실패·비활성 시 기존 카드+스레드, 발행 실패 비전파를 검증한다.
- [x] C3: consumer 흐름을 `CTO 판정 → DB 저장 → Notion 발행/URL 갱신 → Slack`으로 변경한다. 기존 완료 guard와 상세 스레드 실패 경계를 유지한다.
- [x] DI/env/docs: `NotionModule` 재사용, cron module provider 연결, `.env.example`·`app.config.ts`·README에 `STUDY_BRIEF_NOTION_DATABASE_ID`를 동기화한다. `.env`는 건드리지 않는다.
- [x] 관련 focused spec마다 RED를 확인한 뒤 최소 구현, GREEN, refactor 순서로 진행한다.
- [x] 최종 diff에서 `parseStudyResearch` 무변경, `grep -rn "study-brief-cron" src/agent/` 0건, secrets/debug/우발 파일/금지 명령 미실행을 확인한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm docs:check`, `pnpm check:env`, `pnpm check:invariants`를 순서대로 새로 실행하고 exit code를 기록한다.
- [x] `.ai/implementation-summary.md`에 파일 역할, 게이트 실제 결과, 계약 이탈, Claude 재검증 지점을 작성한다.

## Review

- 구현 계약 A·B·C 완료. 6개 게이트 exit 0, 독립 리뷰 Blocker 0/Should Fix 0.
- 기존 멱등·Slack 상세 실패 회귀를 유지했다. `.env`, `pnpm db:push`, git add/commit/push는 실행하지 않았다.

# 학습 브리핑 Notion 1회성 적재 스크립트 (2026-08-06)

**Goal:** `study_brief` 최신 1건을 Notion DB 속성과 읽기 좋은 본문 블록으로 적재하는 1회성 스크립트를 작성한다.

**Constraints:** 스크립트는 실행하지 않는다. `AppModule`, `.env`, DB schema, git index/commit/push는 건드리지 않는다. 검증은 `pnpm exec tsc --noEmit`만 수행한다.

- [x] 기존 Notion 스크립트, Prisma `study_brief` 모델, TypeScript 관례를 확인한다.
- [x] 멱등 DB 속성 보강과 최신 `study_brief` 조회를 구현한다.
- [x] Markdown 블록/인라인 변환과 2,000자 `rich_text` 제한을 구현한다.
- [x] Notion page 속성/본문 조립과 100개 단위 append를 구현한다.
- [x] 민감정보 마스킹, 진행 로그, 최종 URL 출력을 구현한다.
- [x] `pnpm exec tsc --noEmit`와 최종 diff로 타입/범위를 확인한다.

## Review

- `scripts/tmp-study-brief-to-notion.ts` 하나에 Prisma/Notion 직접 client, JSON guard, Markdown 변환, API 제한 분할, 민감정보 마스킹을 구현했다.
- 스크립트를 실행하지 않았다. `AppModule`, `.env`, DB schema, git index/commit/push도 건드리지 않았다.
- Verification: `pnpm exec tsc --noEmit` exit 0.

---

# 토스 잔고 동기화 감시 편입 구현 계획 (2026-08-06)

**Source of truth:** `.ai/design.md`. 동기화는 기존 `StockMonitorAutopilotTask.monitor()` 판정 직전에 수행한다.

**Constraints:** 새 task·playbook entry·env 금지. `SyncHoldingsUsecase` 내부 및 `formatStockMonitorSummary` 시그니처 변경 금지. Node 22 사용. git commit 금지.

- [x] 관련 task/spec/module/usecase/repository와 현재 DI·audit·최신 보유 필터 경로를 확인한다.
- [x] `StockMonitorAutopilotTask` spec에 성공 mock을 연결하고 호출 순서, audit 성공값, 실패 계속·경고, 실패+0건 발송 회귀 테스트를 먼저 추가한다.
- [x] 신규 task spec을 실행해 기존 생성자 계약 및 누락 동작 때문에 RED가 발생하는지 확인한다.
- [x] repository spec에 최신 quantity=0 제외와 최신 quantity=10 포함 대조군을 먼저 추가하고 현재 구현에서 GREEN임을 확인한다.
- [x] `StockMonitorAutopilotTask`에 `SyncHoldingsUsecase`, 별도 sync 결과 interface, audit 3필드, 동기화 오류 경고 helper를 계약대로 최소 구현한다.
- [x] 보유 0건·휴장·정상 반환 모두 sync audit을 적재하고 비-skip 결과에만 warning helper를 적용한다.
- [x] `AutopilotModule`의 KR/US factory 마지막 인자와 inject 배열 끝에 `SyncHoldingsUsecase`를 연결한다.
- [x] focused spec을 GREEN으로 만들고 변경 diff를 설계 계약·코드 규칙 관점에서 리뷰한다.
- [x] 가드 1: `withSyncWarning` prefix를 임시 제거하고 경고 관련 테스트 실패 메시지를 기록한 뒤 원복·GREEN 확인한다.
- [x] 가드 2: `findCurrentHoldings`의 `quantity.isZero()` 조건을 임시 제거하고 전량 매도 테스트 실패 메시지를 기록한 뒤 원복·GREEN 확인한다.
- [x] `nvm use 22` 후 `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check`를 실행해 4개 exit 0을 확인한다.
- [x] `.ai/implementation-summary.md`를 변경 파일, 설계 이탈, 4중 검증, 가드 깨뜨리기 실제 결과로 덮어쓴다.
- [x] 최종 diff와 git status에서 금지 변경·우발 파일·commit 없음 및 계약 충족을 확인하고 Review를 작성한다.

## Review

- `StockMonitorAutopilotTask` enabled 경로 첫 단계에 잔고 동기화를 편입했다. 성공/실패 audit과 실패 경고를 세 반환 경로에 남긴다.
- KR/US factory 모두 기존 인자 뒤에 `SyncHoldingsUsecase`를 연결했다. 새 task·playbook entry·env는 없다.
- 신규 task regression 4건과 전량 매도/대조군 2건을 추가했다. focused 2 suites/30 tests 통과.
- mutation 2건은 각각 경고 관련 2 tests, 전량 매도 1 test를 실제 실패시켰고 모두 원복했다.
- stale Prisma Client를 `pnpm exec prisma generate`로 갱신한 뒤 4중 게이트 전체 exit 0. commit/push, DB/schema 변경 없음.
- 독립 최종 리뷰 결과 Blocker 0, Should Fix 0이다.
# 포트폴리오 노출 한 줄 (2026-08-06)

**Goal:** 저녁 주식 감시 Slack 요약에 전체 보유 기준 포트폴리오 노출을 안전하게 계산해 한 줄로 표시한다.

**Contract:** `.ai/design.md`를 source of truth로 따른다. 실제 보유 종목 정보는 어떤 tracked/untracked 산출물에도 기록하지 않고 가상 종목만 사용한다. `pnpm db:push`, commit/push는 실행하지 않는다.

- [x] 현재 worktree와 baseline 전체 테스트를 확인한다.
- [x] Prisma `Ticker` 노출 컬럼과 순수 노출 계산을 테스트 우선으로 구현하고 `pnpm prisma:generate`를 실행한다.
- [x] 전체 보유·최신 시세 조회 repository와 노출 formatter를 테스트 우선으로 구현한다.
- [x] 국내 감시 환율 조회와 휴장·정상 요약 양쪽의 best-effort 노출 줄 통합을 회귀 테스트로 구현한다.
- [x] 실제 종목 정보·종목별 매핑·원장 노출 수치가 추가되지 않았는지 검토한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm docs:check`, `pnpm check:invariants`를 모두 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 작성한다.

## Review

- `Ticker` 노출 컬럼, 순수 Decimal 계산, 전체 보유·최신 종가 repository, Slack formatter를 구현했다.
- 국내/미국 감시 모두 환율을 해석하며 정상·휴장 요약 끝에 best-effort 노출 줄을 붙인다. 실패는 warn 후 줄만 생략하고 audit은 바꾸지 않는다.
- 신규 fixture와 diff 추가 줄에서 실제 보유 종목 정보·종목별 mapping은 0건이다.
- TDD focused 결과는 Domain 5/5, repository·formatter 34/34, autopilot 30/30이다.
- 최종 검증은 lint exit 0(기존 warning 57), test 306 suites/2,416 + code-graph 5 suites/40, build/docs/invariants 모두 exit 0이다.
- 독립 최종 리뷰는 Critical/Important/Minor 0건이다. DB push와 실제 Slack/운영 데이터 검증은 사용자 지시대로 수행하지 않았다.

---
# 포트폴리오 노출 리뷰 결함 2건 수정 (2026-08-06)

**Goal:** 미분류 USD 포지션을 달러 환노출에 포함하고, 노출 줄을 잔고 변화 블록 앞에 배치한다.

**Root cause:** 환노출 누적 조건이 지역만 검사한다. 정상·휴장 분기 모두 노출 wrapper가 잔고 변화 wrapper 바깥에 있어 노출 줄이 마지막에 붙는다.

**Constraints:** `.ai/design.md` §0을 지킨다. 지정된 두 결함 외 리팩토링, `pnpm db:push`, commit을 하지 않는다.

- [x] `region: null, currency: 'USD'`와 `region: 'US', currency: 'USD'`가 반반인 회귀 spec을 추가하고 수정 전 50% 실패를 확인한다.
- [x] 잔고 변화가 있을 때 노출 줄 인덱스가 잔고 변화 블록 인덱스보다 앞서는 회귀 spec을 추가하고 수정 전 실패를 확인한다.
- [x] 환노출 판정을 지역 또는 USD 통화로 넓히고 두 조건의 서로 다른 이유를 주석으로 남긴다.
- [x] 정상·휴장 분기에서 포트폴리오 노출을 base 결과에 먼저 적용한 뒤 잔고 변화를 붙인다.
- [x] focused spec을 GREEN으로 만들고 최종 diff를 검토한다.
- [x] `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check && pnpm check:invariants`를 모두 exit 0으로 확인한다.
- [x] `.ai/implementation-summary.md`에 두 수정과 실제 게이트 결과를 기록한다.

## Review

- `region`이 `US`이거나 `currency`가 `USD`인 평가액을 달러 환노출에 포함한다. 원화 표시 해외 ETF와 미분류 USD 포지션의 서로 다른 판정 이유를 production 주석에 남겼다.
- 정상·휴장 분기 모두 노출을 base 요약에 먼저 붙이고, 그 결과 뒤에 잔고 변화 블록을 붙인다.
- TDD RED: 미분류 USD 회귀는 기대 100%/실제 50%, 배치 회귀는 노출 인덱스 83/잔고 변화 인덱스 39로 실패했다. 구현 후 focused 2 suites / 37 tests가 통과했다.
- 최종 gate: lint exit 0(기존 warning 57), test 306 suites/2,418 tests + code-graph 5 suites/40 tests, build/docs/invariants 모두 exit 0.
- `pnpm db:push`, commit은 실행하지 않았다.

---
# 포트폴리오 현재 포지션 소스 필터 수정 (2026-08-06)

**Goal:** 과거 등록 경로의 `Holding`이 현재 포지션과 시세 완전성 판정에 섞이지 않게 한다.

**Constraints:** `.ai/design.md` §0을 지킨다. 지정된 repository와 spec만 변경한다. `pnpm db:push`, commit은 실행하지 않는다.

- [x] 기존 쿼리 계약을 `TOSS` source로 제한하는 회귀 spec을 추가하고 RED를 확인한다.
- [x] mock 반환값을 필터 적용 후 형태로 둔 결과 회귀 spec을 추가한다.
- [x] `findPortfolioPositions()` 쿼리에 source 필터와 전환 이력 설명 주석을 최소 추가한다.
- [x] focused stock spec을 GREEN으로 확인하고 변경 범위를 검토한다.
- [x] `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check && pnpm check:invariants`를 모두 검증한다.
- [x] 아래 Review에 실제 RED/GREEN 및 최종 게이트 결과를 기록한다.

## Review

- `findPortfolioPositions()`의 Prisma 쿼리를 `Ticker.source = TOSS`로 제한해 과거 등록 경로 행을 시세 완전성 판정 전에 배제했다.
- TDD RED는 새·갱신 query 단언 2건이 누락된 `where`로 실패함을 확인했다. 구현 후 stock focused 7 suites/87 tests가 통과했다.
- mock 반환값은 Prisma 필터 이후 현재 경로 행만 포함하고, 쿼리 인자 단언으로 필터 삭제 시 실패하게 했다.
- 최종 gate는 lint exit 0(기존 warning 57), 일반 test 306 suites/2,419 tests, code-graph 5 suites/40 tests, build/docs/invariants 모두 exit 0이다.
- 실제 보유 종목·상품명은 추가하지 않았다. `pnpm db:push`, commit은 실행하지 않았다.

---
# Router 대화 맥락 BLOG 착지 및 fallback 제동 (2026-08-10)

**Goal:** `.ai/design.md`의 T1~T4를 그대로 구현해 기술 학습 요청을 BLOG로 연결하고, 대화 맥락·요약을 보존하며, conversational fallback 2연속 시 방향을 전환한다.

**Constraints:** `8001a2b`의 분류기 화자 라벨 수정은 건드리지 않는다. 각 작업은 focused spec RED를 먼저 확인한 뒤 최소 구현으로 GREEN을 만든다. 커밋하지 않는다.

- [x] T1 분류기 prompt 회귀 spec을 RED로 만들고 BLOG/UNKNOWN 경계와 합의된 주제 선택 규칙을 구현한다.
- [x] T2 BlogDispatcher의 동기·비동기 요청문 조립 spec을 RED로 만들고 단일 순수 조립 함수를 구현한다.
- [x] T3 BlogDraftResult summary 전달·Slack escape spec을 RED로 만들고 usecase/formatter를 구현한다.
- [x] T4 정확한 assistant/null 연속 판정과 streak prompt 분기 spec을 RED로 만들고 handler/usecase를 구현한다.
- [x] focused spec 전체와 mutation 관점의 결함 검출력을 확인한다.
- [x] final diff를 설계·선행 커밋 대비 검토한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`를 각각 실행해 exit 0을 확인한다.
- [x] `.ai/implementation-summary.md`와 아래 Review에 실제 변경·검증·설계 편차를 기록한다.

## Review

- T1~T4를 설계대로 구현했다. `8001a2b`의 화자 라벨 렌더링 production 코드는 건드리지 않았다.
- TDD RED는 T1 3건, T2 2건, T3 3건, T4 4건에서 요구 동작 부재를 확인했다. T4 `reply()` wiring은 전달선을 잠시 제거하는 mutation으로 실패를 재확인했다.
- focused 6 suites/83 tests 통과 후 wiring 회귀 1건을 추가했다. 독립 리뷰는 Blocker/Should Fix/Minor 0건이었다.
- 최종 gate 결과와 기존 warning 수는 `.ai/implementation-summary.md`에 기록한다.
- 설계 편차 없음. LLM 분류·문구 품질은 Slack 실환경 확인이 가능한 잔여 런타임 리스크다.

---
# WORK_REVIEWER 실제 머지 PR 근거 주입 (2026-08-11)

**Goal:** 자동 회고 입력을 PM 계획과 실제 머지 PR 실적으로 분리해 정량 근거 없는 완료 단정을 막는다.

**Contract:** `.ai/design.md` 준수. 기존 `IMPACT_REPORT_GITHUB_AUTHOR` / `IMPACT_REPORT_GITHUB_REPO`만 재사용. `/worklog` 수동 경로, DB/schema, env, commit/push/PR은 건드리지 않는다.

- [x] 설계와 기존 daily/weekly task, GitHub port, 날짜 helper, spec 패턴을 확인한다.
- [x] formatter 5케이스와 daily/weekly task 회귀 spec을 추가해 RED를 확인한다.
- [x] 순수 formatter, system prompt 치환, daily/weekly best-effort 조회를 최소 구현한다.
- [x] focused spec GREEN과 최종 diff·설계 준수 review를 완료한다.
- [x] `pnpm lint:check`, `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build`를 각각 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review에 변경 파일, 설계 이탈, 실제 게이트 결과를 기록한다.

## Review

- 자동 일일·주간 worklog 입력을 PM 계획과 실제 머지 PR 실적으로 분리했다. 0건·조회 실패·env 누락도 명시하며 회고는 계속한다.
- `firedAtKst` 기준 KST 조회 창, 주간 KST plan 날짜, 일일 30·주간 60 limit을 고정했다.
- port가 total count를 노출하지 않는 제약 때문에 formatter source에 limit을 추가하고, limit 도달 시 정확한 미상 건수를 단정하지 않는 경고로 설계를 보완했다. Claude 재검증 필요.
- TDD RED·역변이 확인 후 focused 3 suites/19 tests 통과. 독립 재리뷰 Critical/Important/Minor 0건.
- 최종 gate: lint/tsc/test/build 모두 exit 0. 일반 307 suites/2,523 tests + code-graph 5 suites/40 tests 통과.
- commit, push, PR 생성 없음.

---
# PR #272 리뷰 반영 — 조회 실패 재시도 보존 (2026-08-12)

**Goal:** 계획이 없는 기간의 재시도 가능한 GitHub 조회 실패를 실적 0건으로 확정하지 않고, task 실패를 통해 BullMQ 재시도를 보존한다.

**Contract:** `.ai/design-review-fix.md`가 source of truth다. `WorklogInputSource`, `buildWorklogInput()`, 프롬프트, orchestrator, scheduler와 계획이 있는 경로의 동작은 변경하지 않는다. `pnpm install`, commit, push, PR 생성은 금지한다.

- [x] Task 1: 일간 spec의 조회 실패 케이스를 throw 단언으로 교체하고 env 미설정 skip 케이스를 추가해 focused RED를 확인한다.
- [x] Task 1: `WorklogEvidenceQueryResult.retriable`과 일간 분기·명시 필드 전달을 최소 구현해 focused GREEN을 확인한다.
- [x] Task 2: 주간 spec의 조회 실패 케이스를 throw 단언으로 교체하고 env 미설정 skip 케이스를 추가해 focused RED를 확인한다.
- [x] Task 2: `WorklogEvidenceQueryResult.retriable`과 주간 분기·명시 필드 전달을 최소 구현해 focused GREEN을 확인한다.
- [x] `retriable` throw 분기를 일시 제거하는 역변이로 신규 throw 테스트 실패를 확인하고 즉시 원복한다.
- [x] final diff에서 금지 파일·시그니처·계획 있는 경로 보존과 설계 이탈 여부를 검토한다.
- [x] 5개 게이트를 파이프 없이 각각 실행하고 exit code·테스트 집계를 기록한다.
- [x] `.ai/implementation-summary.md`에 `## 리뷰 반영 (PR #272)` 절과 아래 Review를 실제 결과로 덧붙인다.

## Review

- daily/weekly 모두 GitHub 조회 실패만 `retriable: true`로 분류해 plan이 없을 때 throw하고, env 미설정·정상 조회는 `false`로 유지했다.
- Task 1 RED `1 failed / 254 passed` → GREEN `255/255`, Task 2 RED `1 failed / 255 passed` → GREEN `256/256`을 확인했다.
- 역변이는 exit 1, `2 failed / 254 passed`로 일간·주간 throw 회귀 모두를 검출했고 원복했다.
- fresh gate는 lint/tsc/focused/full/build 모두 exit 0. focused 26 suites/256 tests, 전체 307 suites/2,546 tests + code-graph 5 suites/40 tests다.
- 설계가 지정한 코드 변경에서 이탈하지 않았고 금지 파일 변경, `pnpm install`, commit/push/PR은 없다.
- 기존 orchestrator는 그룹 전멸에만 BullMQ job을 rethrow한다. 단독 `weekly-summary`는 재시도가 보존되지만, 일간 `work-reviewer`는 `evening` 다른 task가 성공하면 부분 성공으로 종료된다. 이 설계/기존 코드 경계는 `.ai/implementation-summary.md`에 재검증 필요 사항으로 기록했다.

---
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
# 모의투자 2단계 PR-A — 유니버스 마스터 + 공유 시세 계층 (2026-08-12)

**Goal:** `.ai/design.md` T2~T8 계약대로 KRX 보통주 유니버스와 공유 일봉 저장 계층, 수동 CLI, 일일 Autopilot 수집 경로를 구현한다.

**Architecture:** `market-data`가 장중 저장 가드·KRX 상장 목록·공유 Prisma 쓰기를 소유하고, 신규 `screener` application 계층이 유니버스 동기화와 토스 일봉 수집을 조합한다. CLI와 Autopilot은 같은 usecase만 호출하며 지표·추천은 추가하지 않는다.

**Constraints:** T1 `prisma/schema.prisma`, `.env`, DB, Prisma generate, git index/commit, 실제 KRX 네트워크 호출, 신규 dependency는 건드리지 않는다. 모든 behavior 변경은 focused RED→GREEN 후 전체 5종 gate를 실행한다.

- [x] T2 `intraday-guard.spec.ts` 4경계를 RED로 확인하고 순수 가드를 구현한다.
- [x] T3 `market-data.repository.spec.ts` 하한선 RED를 확인하고 최초 insert·증분 chunk upsert·저장 close 대조·유니버스 repository를 구현한다.
- [x] T3 `StockMonitorRepository.upsertDailyPrice`를 공유 repository 위임으로 바꾸고 기존 spec 생성자 mock을 갱신한다.
- [x] T4 KRX 10셀 HTML 파서·fallback·무효 행·빈 결과 spec을 RED로 확인하고 EUC-KR fetch client를 구현한다.
- [x] T5 `sync-universe.usecase.spec.ts`를 RED로 확인하고 순차 KRX 결과 upsert/상폐 안전장치를 구현한다.
- [x] T5 `collect-universe-prices.usecase.spec.ts`를 RED로 확인하고 기본 5/200봉·limit·부분 실패·batch 저장·200건 로그를 구현한다.
- [x] T5 `ScreenerModule`을 만들어 `MarketDataModule`/`PrismaModule`과 usecase를 배선한다.
- [x] T6 전용 Nest application context를 쓰는 `scripts/screener.ts`와 엄격한 CLI 옵션 파싱·한국어 결과 출력을 구현한다.
- [x] T7 `universe-sweep` task spec을 RED로 확인하고 매일 sync+collect, env gate, 18:30 standalone playbook/registry 배선을 구현한다. (실데이터 회귀에서 월요일 제한 제거)
- [x] T8 `.env.example`, `app.config.ts`, README에 env 3종을 동기화하고 docs catalog를 갱신한다.
- [x] focused Jest, `git diff --check`, 금지 범위 정적 검사를 수행한다.
- [x] `pnpm lint:check`, `pnpm build`, `pnpm exec tsc --noEmit -p tsconfig.json`, `pnpm test`, `pnpm docs:check`를 순서대로 실행한다.
- [x] 최종 diff를 설계와 대조하고 `.ai/implementation-summary.md` 및 아래 Review를 실제 결과로 작성한다.

## Review

- 1차 계약 대조에서 T3 조정가 갱신, T7 AgentRun 범위, T8 docs catalog 누락을 발견해 중단했다.
- 수정된 `.ai/design.md`에서 최초 insert/증분 upsert+재조정 감지, 기존 INVEST 원장 재사용, `pnpm docs:sync`로 모두 해소됐다. 구현 재개.
- T2~T8 구현 완료. focused 16 suites/157 tests, 전체 일반 324 suites/2,620 tests와 code-graph 5 suites/40 tests가 통과했다.
- 최종 gate 5종 모두 exit 0. lint warning 57건은 기존 파일에만 있으며 신규 error/warning은 없다.
- 설계 편차 없음. `.env`, DB/Prisma generate, KRX 실제 네트워크, git index/commit은 건드리지 않았다.

---

# PR-A 실데이터 회귀 4건 수정 (2026-08-12)

**Goal:** 실제 KRX 응답과 DB에서 드러난 ETF 유입, 중복 행, 최초 가동 공백, 실패 사유 유실을 수정한다.

**Root causes:** 유니버스 조회가 KRX 분류 여부를 검사하지 않았고, 파서가 공급자 중복을 보존했다. Autopilot sync를 요일에 묶어 빈 유니버스를 성공 처리했으며, failures는 audit에만 남고 사용자 출력 경로에 연결되지 않았다.

- [x] `findUniverseTickers`가 `krxMarket != null`을 요구하는 Prisma query 회귀 spec을 RED→GREEN으로 만든다.
- [x] 실 KRX fixture 7행을 읽어 5개 고유 코드만 반환하는 mapper spec을 RED→GREEN으로 만든다.
- [x] 평일과 무관하게 매번 sync→collect 순서를 고정하는 Autopilot spec을 RED→GREEN으로 만든다.
- [x] Autopilot `detailText`와 CLI가 실패 사유 및 20건 절단 문구를 노출하는 spec/순수 formatter를 RED→GREEN으로 만든다.
- [x] focused tests와 5종 전체 gate, final diff review를 완료한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- `krxMarket: { not: null }`로 KRX 목록이 분류한 보통주만 수집 대상으로 제한했다. 기존 TOSS ETF는 보유 감시 경로에 남고 유니버스에서는 빠진다.
- 실 KRX fixture 7행에서 코드별 첫 행만 보존해 5개 고유 종목을 반환한다.
- 요일 분기를 제거해 매일 KRX sync 후 collect하며 최초 가동의 빈 유니버스 성공을 막았다.
- 공용 실패 formatter를 Autopilot `detailText`와 CLI가 함께 사용한다. 20건 표본보다 전체 실패가 많으면 절단 사실과 전체 건수를 표시한다.
- RED는 query 조건 누락, fixture 7건 반환, 화요일 sync 미호출/detail 부재, formatter 모듈 부재로 확인했다. focused 6 suites/25 tests GREEN.
- 5종 gate 모두 exit 0: lint 기존 warning 57/error 0, build, tsc, 일반 325 suites/2,625 tests, code-graph 5/40, docs:check.

---
# PR #285 아키텍처 리뷰 — 시장지표 조회 포트 분리 (2026-08-12)

**Goal:** `CollectBenchmarkClosesUsecase`가 Toss infrastructure 구현 대신 시장지표 전용 domain port에 의존하게 한다.

**Contract:** `TossMarketIndicatorClient`만 포트로 추상화한다. `BenchmarkRepository`의 구체 주입과 다른 usecase/repository는 건드리지 않는다. 기존 `MARKET_DATA_PORT`는 종목 시세 mock 전체를 깨고 지수 응답 계약도 다르므로 확장하지 않는다. commit, staging, push는 금지한다.

- [x] 관련 코드·spec·DI 패턴과 worktree 상태를 확인한다.
- [x] usecase spec mock 타입을 `MarketIndicatorPort`로 바꾸고 신규 port 부재 RED를 확인한다.
- [x] `BenchmarkBar`, `MARKET_INDICATOR_PORT`, `MarketIndicatorPort`를 domain port로 옮긴다.
- [x] Toss adapter, mapper, module, usecase를 최소 수정한다.
- [x] focused test GREEN과 final diff 범위 검토를 수행한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm exec tsc --noEmit`를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- `CollectBenchmarkClosesUsecase`의 Toss concrete import를 제거하고 `MARKET_INDICATOR_PORT`를 주입했다. `BenchmarkRepository` concrete 주입은 유지했다.
- `BenchmarkBar`는 pure domain `DecimalValue`를 사용한다. 저장 repository는 Prisma 경계에서 `toString()`으로 정밀도를 보존해 domain의 `@prisma/client` 의존을 만들지 않았다.
- `MarketDataModule`은 token/useClass provider와 token export만 남겨 concrete export와 중복 instance를 제거했다.
- RED는 신규 port 부재 `TS2307`, domain 값의 repository 경계 미지원 `TS2740`으로 확인했다. focused 4 suites/29 tests GREEN.
- 최종 fresh gate는 lint exit 0(기존 warning 57), 전체 일반 342 suites/2,847 tests + code-graph 5 suites/40 tests, build, tsc 모두 exit 0이다.
- 다른 usecase/repository 주입 방식, env/schema/dependency/git index/commit/push는 변경하지 않았다.

---
# PR #288 리뷰 2건 반영 (2026-08-13)

**Goal:** 휴장일·시세 공급자 전면 장애에는 PENDING 주문을 보존하고, 후보 밖 보유 종목도 이미 계산된 지표를 추천 판단과 주문 근거에 사용한다.

**Contract:** `.ai/design.md`를 그대로 따른다. 거래소 캘린더, port/adapter, schema/env/dependency/new production file은 추가하지 않고 커밋하지 않는다.

- [x] 관련 구현과 spec의 현재 데이터 흐름을 확인한다.
- [x] 휴장일·부분 봉·전면 장애 및 보유 종목 지표 회귀 spec을 먼저 추가해 RED를 확인한다.
- [x] `FillPendingOrdersUsecase`가 당일 봉을 하나라도 본 AFTER_CLOSE에만 만료하도록 수정한다.
- [x] `ScreenUniverseUsecase`가 요청 ticker의 asOf 일치 지표를 `includedIndicators`로 반환하도록 수정한다.
- [x] 추천 usecase가 보유 종목을 먼저 조회하고 병합 지표 맵을 프롬프트와 주문 저장에 함께 사용하도록 수정한다.
- [x] focused GREEN 후 `pnpm lint:check`, `pnpm exec tsc --noEmit`, 전체 `pnpm test`, `pnpm build`를 실행한다.
- [x] 최종 diff와 금지 범위를 검토하고 `.ai/implementation-summary.md` 및 아래 Review를 갱신한다.

## Review

- `AFTER_CLOSE`도 due 주문별 당일 봉을 조회하고, 당일 봉을 하나라도 본 경우에만 남은 주문을 bulk 만료한다. 휴장일·전면 장애는 bulk 만료 mock 미호출로 고정했다.
- 스크리너는 공통 `asOf`를 통과한 요청 종목 지표를 필터 전 `includedIndicators`로 반환하며, 미지정·stale 경계를 회귀 spec으로 고정했다.
- 추천은 보유 종목 ID를 스크리너에 전달하고, `includedIndicators` + `screen.stocks` 병합 맵을 프롬프트와 주문 snapshot에 함께 사용한다. 중복은 `screen.stocks`가 우선한다.
- 독립 최종 리뷰는 Critical/Important/Minor 0건이었다. 설계 편차와 schema/env/dependency/new production file 변경은 없다.
- 최종 gate: lint exit 0(기존 warning 57), tsc exit 0, 전체 test exit 0(일반 350 suites/2,910 tests + code-graph 5 suites/40 tests), build exit 0, diff check exit 0.
- 커밋, staging, push는 실행하지 않았다.

---
# 적응형 도면 밴드·부서 문패 x 충돌 수정 (2026-08-13)

**Goal:** 2열·3열 모두에서 상단 밴드 문패와 부서 문패의 x 범위를 분리하고, 서로 다른 격자를 공유한다고 가정하지 않는다.

**Contract:** 기존 이름표 자산을 먼저 검토한다. `departmentDeskSpots`·`departmentFurnitureSpots`·`fallbackDeskSpots`는 수정하지 않는다. commit하지 않는다.

- [x] 기존 문패 렌더 계산, 이름표 간격 자산, `OfficeNameplateFitTests`를 확인한다.
- [x] RED: 실제 글꼴 기준 2열·3열 밴드/부서 문패 x 범위 비겹침을 고정한다.
- [x] GREEN: 점유 구간을 피해 밴드 문패를 배치하는 격자 독립 규칙을 최소 구현한다.
- [x] 가드를 기존 왼쪽 고정으로 깨뜨려 회귀 테스트 RED를 재확인하고 복원한다.
- [x] `swift build`, `swift run ConsoleCoreTests`, `git diff --check`, 금지 심볼 diff 검사를 fresh 실행한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- 밴드 문패의 왼쪽 고정 선호는 유지하되, 실제 부서 문패 판과 6px 간격을 확보할 수 있는 가장 가까운 위치로 이동한다. 2열 조건 분기나 두 격자의 stride 공유는 없다.
- 사람 이름표용 font/세로 계산은 문제 축이 달라 재사용하지 않았고, 공통 판 간격 상수만 재사용했다. 선택 근거를 생산 코드 주석에 남겼다.
- 최초 RED와 고의 mutation RED 모두 2열의 동일 충돌 3건을 잡았다. 복원 후 전체 2194건과 앱 build가 exit 0이다.

---

# 콘솔 할 일 제안 KST 성공일 주기 교정 (2026-08-13)

**Goal:** 같은 날 몰린 성공 run이 주기를 분 단위로 왜곡하지 않도록 KST 성공 날짜 단위로 주기를 추정하고, 상위 3개 밖의 due 후보 수를 사용자에게 알린다.

**Contract:** 사용자 최신 교정 지시가 `.ai/design.md`의 run 시각 간격 설계를 대체한다. 기존 KST 유틸을 재사용하고 서버 timezone에 의존하지 않는다. Swift, DB/schema/env/dependency, git commit/stage/push는 변경하지 않는다.

- [x] 기존 주기 계산·KST 유틸·결과 발행 경로와 실측 결함의 데이터 흐름을 확인한다.
- [x] 동일 KST 날짜 중복, 당일 연속 `PAPER_RECOMMEND`, KST 자정 경계, `alsoDueCount`, 발행 문구 spec을 추가해 RED를 확인한다.
- [x] KST 성공 날짜 dedupe, 날짜 차이 중위값, 경과일 계산, 조회 limit 40을 최소 구현한다.
- [x] `WorkSuggestionResult.alsoDueCount`와 조건부 발행 문구를 구현하고 focused GREEN을 확인한다.
- [x] Swift 무변경과 최종 diff를 검토한다.
- [x] `pnpm lint:check`, `pnpm test`, `pnpm build`, `pnpm docs:check`를 리다이렉트로 각각 실행하고 exit code를 확인한다.
- [x] `.ai/implementation-summary.md`와 아래 Review를 실제 결과로 갱신한다.

## Review

- `endedAt`을 기존 `formatKstDate`로 변환·중복 제거해 성공한 KST 날짜만 주기 표본으로 쓴다. 경과와 인접 간격 모두 캘린더 일수로 계산한다.
- 동일 날짜 성공만 있는 `PAPER_RECOMMEND`는 `skippedUnknownCycle`에 포함되고, KST 00:30/전날 23:30 경계는 서로 다른 날짜로 처리된다.
- 조회 limit은 40으로 늘렸다. 상위 3개 밖 due 후보는 `alsoDueCount`로 반환하고 목록 끝에 `그 외 N개도 때가 됐어요.`를 조건부 발행한다.
- RED는 `alsoDueCount` 타입 부재와 추가 문구 미발행으로 2 suites exit 1, focused GREEN은 2 suites/23 tests exit 0이었다.
- 최종 gate: lint exit 0(기존 warning 57), test exit 0(일반 353 suites/2,947 tests + code-graph 5 suites/40 tests), build exit 0, docs:check exit 0.
- Swift, DB/schema/env/dependency와 git index/commit/push는 변경하지 않았다.

---
