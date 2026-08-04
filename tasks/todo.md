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
