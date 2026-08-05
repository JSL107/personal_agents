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
