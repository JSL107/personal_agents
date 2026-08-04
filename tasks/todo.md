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
