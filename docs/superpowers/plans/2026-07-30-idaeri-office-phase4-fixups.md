# 이대리 콘솔 Phase 4 보완(승인 매핑 + 연출 버그) Delta Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 superpowers:executing-plans. 이미 구현된 Phase 4(`2026-07-30-idaeri-office-phase4-living-office.md` T1~T8) 위에 얹는 **델타**다. 기존 코드를 전제로 수정한다.

**Goal:** 실데이터에서 죽는 승인 연출을 살린다 — 백엔드 kind→agentType 매핑(`approval.agentType` 채움) + 클라이언트 연출 버그 4개(펄스 즉사·핑크 전이·유령 밴드·replay) 수정.

**Architecture:** 결함 근원은 백엔드 v1이 `approval.agentType`을 항상 null로 내보내는 것. `toConsoleApproval` 단일 매퍼에 kind→agentType 매핑을 넣어 스냅샷·이벤트 발행 5곳과 `deriveAgentState` 파생을 동시에 복구한다. 클라이언트는 `visualIntents`·`OfficeScene`·`OfficeView`의 연출 버그를 국소 수정한다. 배경·결함 상세는 `docs/superpowers/specs/2026-07-30-idaeri-office-phase4-living-office-design.md`의 "보완" 섹션.

**Tech Stack:** 백엔드 NestJS/TypeScript(jest) · 클라이언트 Swift/SwiftPM(실행형 러너·SpriteKit).

## Global Constraints

- 백엔드 변경은 **콘솔 read 표현 계층에 국한**. preview-gate 로직·부작용 불변(read-only 계약).
- 백엔드 검증: `pnpm lint:check` + `pnpm exec jest src/console src/preview-gate` + `pnpm build`. (전체 `pnpm test`는 공유 DB 의존·2단계 필터 이슈가 있어 관련 경로만 `pnpm exec jest`로 직접 — 전체 회귀는 CI가 담당.)
- 클라이언트 검증: `swift build` + `swift run ConsoleCoreTests`(clients/idaeri-console). CLT 전용, Xcode·XCTest 없음.
- git 커밋·스테이징 금지(worktree `.git`이 메인 안이라 sandbox가 index.lock 못 씀). 구현만 — 커밋은 사람이 메인에서 대행. 계획의 commit 스텝은 건너뛴다.
- 작업 경로: 기존 worktree `/Users/juneseok/worktrees/idaeri-office-phase4`, 브랜치 `feat/macos-console-phase4`. 백엔드 pnpm 환경(`node_modules`·`prisma generate`)은 메인 셸에서 선처리됨(sandbox는 network 불가).

---

## Fix 0: 백엔드 kind→agentType 매핑

`toConsoleApproval` 한 곳을 고쳐 5개 공유 지점(스냅샷 + create/cancel/expire/apply-preview 이벤트 발행)과 `deriveAgentState`의 `AWAITING_APPROVAL` 파생을 동시에 복구한다.

**Files:**
- Modify: `src/console/application/console-mappers.ts`
- Create: `src/console/application/console-mappers.spec.ts` (없으면 신규)
- Modify: `src/console/application/console-read.service.spec.ts` (agentType=null 기대 갱신)
- Modify: `src/console/application/console-read.service.ts` (낡은 "항상 null" 주석 갱신 — 기능 변경 아님)

**Interfaces:**
- Produces: `PREVIEW_KIND_TO_AGENT: Record<PreviewKind, AgentType>`, 갱신된 `toConsoleApproval(preview): ConsoleApproval`(agentType 채움)

- [ ] **Step 1: 실패 테스트 작성** — `console-mappers.spec.ts`

```ts
import { PREVIEW_KIND, PreviewAction } from '../../preview-gate/domain/preview-action.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import { PREVIEW_KIND_TO_AGENT, toConsoleApproval } from './console-mappers';

describe('PREVIEW_KIND_TO_AGENT', () => {
  it('모든 PreviewKind 가 매핑을 가진다(누락 없음)', () => {
    for (const kind of Object.values(PREVIEW_KIND)) {
      expect(PREVIEW_KIND_TO_AGENT[kind]).toBeDefined();
    }
  });

  it('대표 매핑이 담당 에이전트를 가리킨다', () => {
    expect(PREVIEW_KIND_TO_AGENT[PREVIEW_KIND.PM_WRITE_BACK]).toBe(AgentType.PM);
    expect(PREVIEW_KIND_TO_AGENT[PREVIEW_KIND.DOCS_AUDIT_PR]).toBe(AgentType.DOCS_AUDIT_OPTIMIZER);
    expect(PREVIEW_KIND_TO_AGENT[PREVIEW_KIND.EVENING_BLOG_PUBLISH]).toBe(AgentType.EVENING_RETRO);
  });

  it('toConsoleApproval 이 kind 로 agentType 을 채운다(더 이상 null 아님)', () => {
    const preview = {
      id: 'p1',
      kind: PREVIEW_KIND.PM_WRITE_BACK,
      previewText: 'PR write-back',
      createdAt: new Date('2026-07-30T00:00:00Z'),
    } as unknown as PreviewAction;
    const approval = toConsoleApproval(preview);
    expect(approval.agentType).toBe(AgentType.PM);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec jest src/console/application/console-mappers.spec.ts`
Expected: FAIL — `PREVIEW_KIND_TO_AGENT` 미정의 / `toConsoleApproval` 이 null 반환.

- [ ] **Step 3: 구현** — `console-mappers.ts` 상단 import 추가 및 매핑·매퍼 교체

파일 상단 import 에 추가:

```ts
import { AgentType } from '../../model-router/domain/model-router.type';
import { PreviewKind } from '../../preview-gate/domain/preview-action.type';
```

(`PreviewAction` import 는 이미 있음.) `toConsoleApproval` 위에 매핑을 추가하고 매퍼를 교체:

```ts
// PreviewKind → 담당 에이전트. 승인 카드가 어느 에이전트 소산인지(오피스 집결·핑크·클릭 대상).
// Record 타입이라 새 kind 추가 시 컴파일 에러로 매핑 누락을 막는다.
export const PREVIEW_KIND_TO_AGENT: Record<PreviewKind, AgentType> = {
  PM_WRITE_BACK: AgentType.PM,
  PO_EVAL_CAREERLOG: AgentType.PO_EVAL,
  BE_SANDBOX_APPLY: AgentType.BE,
  BE_SANDBOX_PUSH_PR: AgentType.BE,
  CAREER_JD_GAP_BLOG: AgentType.CAREER_MATE,
  DOCS_AUDIT_PR: AgentType.DOCS_AUDIT_OPTIMIZER,
  PREFERENCE_PROFILE: AgentType.PREFERENCE_LEARNING,
  EVENING_BLOG_PUBLISH: AgentType.EVENING_RETRO,
  EVENING_CAREER_REFLECT: AgentType.EVENING_RETRO,
};

// PreviewAction → 콘솔 승인 뷰. 스냅샷 조립(ConsoleReadService)과 승인 이벤트 emit(preview-gate)이 공유.
export function toConsoleApproval(preview: PreviewAction): ConsoleApproval {
  return {
    id: preview.id,
    agentType: PREVIEW_KIND_TO_AGENT[preview.kind],
    title: preview.previewText,
    createdAt: preview.createdAt.toISOString(),
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm exec jest src/console/application/console-mappers.spec.ts`
Expected: PASS.

- [ ] **Step 5: 기존 테스트 갱신** — `console-read.service.spec.ts`

`agentType=null` 을 기대하던 케이스(스냅샷 approvals 매핑)를, mock preview 의 `kind` 에 대응하는 실제 `agentType` 기대로 바꾼다. 그 테스트가 쓰는 preview mock 의 `kind` 를 확인해 `PREVIEW_KIND_TO_AGENT[kind]` 값으로 교체하고, 해당 에이전트가 `AWAITING_APPROVAL` 로 파생되는지도(있다면) 함께 검증한다. 낡은 주석·기대문구도 갱신.

`console-read.service.ts` 의 `// v1: ... 항상 null` / `// approval.agentType 이 채워지는 미래를 대비한 구조 — v1 은 항상 null` 주석을 "kind→agentType 매핑으로 채워짐(Phase 4 보완)"으로 갱신한다(로직 변경 아님 — `openApprovalAgentTypes` 는 이제 실제로 채워져 파생이 동작).

- [ ] **Step 6: 백엔드 게이트**

Run: `pnpm lint:check && pnpm exec jest src/console src/preview-gate && pnpm build`
Expected: 3개 모두 통과.

(커밋 스텝 건너뜀.)

---

## Fix 1: visualIntents 상태 전이 매핑 교정

`state.changed(IN_PROGRESS)`가 펄스를 죽이지 않게 `.working`으로, `AWAITING_APPROVAL`은 집결+핑크로 매핑한다.

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/OfficeChoreography.swift`
- Test: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeChoreographyTests.swift`

**Interfaces:**
- Consumes/Produces: `visualIntents(for:context:)` (기존 시그니처 유지, `stateChanged` 분기만 교체)

- [ ] **Step 1: 실패 테스트 추가** — `OfficeChoreographyTests.swift` 의 `runOfficeChoreographyTests` 끝에 추가

```swift
    // state.changed(IN_PROGRESS) → working (펄스 유지, recolor 아님)
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "PM", state: .inProgress), context: ctx),
        [.working(agentType: "PM")],
        "state.changed(IN_PROGRESS) → working")

    // state.changed(AWAITING_APPROVAL) → 집결 + 핑크 recolor
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "CTO", state: .awaitingApproval), context: ctx),
        [.summonToBand(agentType: "CTO"), .recolor(agentType: "CTO", state: .awaitingApproval)],
        "state.changed(AWAITING_APPROVAL) → 집결 + 핑크")

    // state.changed(COMPLETED) → recolor (기존 유지)
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "PM", state: .completed), context: ctx),
        [.recolor(agentType: "PM", state: .completed)],
        "state.changed(COMPLETED) → recolor")
```

기존의 `state.changed → recolor` 를 단정하던 테스트 라인(있다면 `.stateChanged(agentType: "PM", state: .completed)` 는 위와 동일해 유지되지만, `IN_PROGRESS` 를 recolor 로 기대하던 라인이 있으면 삭제/교체)한다.

- [ ] **Step 2: 실패 확인**

Run: `cd clients/idaeri-console && swift build --target ConsoleCoreTests`
Expected: 컴파일은 되나 실행 시 FAIL(기대 불일치) — `swift run ConsoleCoreTests` 로 확인.

- [ ] **Step 3: 구현** — `OfficeChoreography.swift` 의 `case let .stateChanged` 블록을 교체

```swift
    case let .stateChanged(agentType, state):
        guard knows(agentType) else {
            return []
        }
        switch state {
        case .inProgress:
            return [.working(agentType: agentType)]
        case .awaitingApproval:
            return [.summonToBand(agentType: agentType), .recolor(agentType: agentType, state: state)]
        default:
            return [.recolor(agentType: agentType, state: state)]
        }
```

- [ ] **Step 4: 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과`.

(커밋 스텝 건너뜀.)

---

## Fix 2: OfficeScene 핑크 색 + 유령 밴드 정리

`summonToBand`가 색을 핑크로 직접 세팅하고(순서 무관 보장), `sync`가 제거된 에이전트를 `bandOrder`에서 정리한다.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift`

- [ ] **Step 1: summonToBand 색 세팅** — `summonToBand(_:)` 에서 `blink` 실행 전에 핑크색을 세팅

```swift
    private func summonToBand(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        if !bandOrder.contains(agentType) {
            bandOrder.append(agentType)
        }
        node.fillColor = ConsoleAgentState.awaitingApproval.skColor
        layoutBand()
        let blink = SKAction.sequence([.fadeAlpha(to: 0.4, duration: 0.4), .fadeAlpha(to: 1.0, duration: 0.4)])
        node.run(.repeatForever(blink), withKey: "summon")
    }
```

- [ ] **Step 2: sync 에서 유령 밴드 정리** — `sync(agents:)` 의 `diff.removed` 루프에 `bandOrder` 정리 추가

```swift
        for agentType in diff.removed {
            agentNodes[agentType]?.removeFromParent()
            agentNodes[agentType] = nil
            homePositions[agentType] = nil
            bandOrder.removeAll { $0 == agentType }
        }
```

- [ ] **Step 3: 빌드 확인**

Run: `swift build`
Expected: 성공(에러·경고 0).

(커밋 스텝 건너뜀. SKAction 연출은 수동 확인 대상.)

---

## Fix 3: OfficeView 초기 연출 replay

오피스 탭이 처음 나타날 때 현재 store 상태(활성 run·열린 approval)로 연출을 재구성해, 탭이 닫혀 있던 동안 놓친 이벤트를 보완한다.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift`

- [ ] **Step 1: onAppear 에 replay 추가** — `SpriteView(...).onAppear` 블록을 교체

```swift
                .onAppear {
                    scene.sync(agents: store.agents)
                    replayInitialChoreography()
                    scene.onAgentClick = { agentType in
                        selectedAgent = agentType
                        commandText = ""
                    }
                }
```

- [ ] **Step 2: replay 헬퍼 추가** — `OfficeView` 안(예: `send(to:)` 아래)에 추가

```swift
    /// 탭이 처음 나타날 때 현재 상태로 연출을 재구성한다(닫혀 있던 동안 놓친 이벤트 보완).
    private func replayInitialChoreography() {
        for run in store.runs where run.finishedAt == nil {
            scene.perform([.working(agentType: run.agentType)])
        }
        for approval in store.approvals {
            if let agentType = approval.agentType {
                scene.perform([.summonToBand(agentType: agentType)])
            }
        }
    }
```

- [ ] **Step 3: 빌드 + 테스트 확인**

Run: `swift build && swift run ConsoleCoreTests`
Expected: build 성공, `✅ 모든 검증 통과`.

(커밋 스텝 건너뜀. 탭 전환 replay 동작은 수동 확인 대상.)

---

## Self-Review

**결함 커버리지:**
- approval.agentType=null → Fix 0(`toConsoleApproval` 매핑, 5곳·파생 자동 복구) ✅
- 진행 펄스 즉사(#1) → Fix 1(`IN_PROGRESS`→`.working`) ✅
- 승인 핑크 전이(#2) → Fix 1(`AWAITING_APPROVAL`→집결+recolor) + Fix 2(summonToBand 색 직접) ✅
- 유령 밴드 슬롯(#3) → Fix 2(sync `bandOrder` 정리) ✅
- 이벤트 replay 부재(#4) → Fix 3(onAppear replay) ✅

**타입 일관성:**
- `PREVIEW_KIND_TO_AGENT: Record<PreviewKind, AgentType>` — Fix 0. `PreviewKind`·`AgentType`·`PREVIEW_KIND`·`PreviewAction` 은 각 domain 파일에서 import. Record 완전성이 컴파일타임에 누락 방지.
- `toConsoleApproval` 시그니처 불변(`(PreviewAction) → ConsoleApproval`), 반환 `agentType` 만 null→매핑값.
- `visualIntents(for:context:)` 시그니처 불변, `stateChanged` 분기만 교체. `.working`/`.summonToBand`/`.recolor` 는 기존 `VisualIntent` 케이스(신규 없음).
- `summonToBand`/`sync` 는 기존 `OfficeScene` 메서드 국소 수정. `ConsoleAgentState.awaitingApproval.skColor` 는 기존 `Theme.swift` 정의.
- `replayInitialChoreography` 는 기존 `store.runs`(`finishedAt: String?`)·`store.approvals`(`agentType: String?`)·`scene.perform` 사용.

**Placeholder scan:** 모든 스텝에 실제 코드. Fix 0 Step 5 는 기존 mock 확인 후 값 교체(구체 값은 mock kind 의존이라 구현자가 파일 보고 확정 — 지시 명확). SKAction·GUI 는 수동 확인 명시.

## 사람이 눈으로 확인할 항목(재구현 후)
- 승인이 열리면 담당 에이전트 원이 핑크로 깜빡이며 대표실 밴드로 집결하는지.
- 진행 중 에이전트의 타이핑 펄스가 `state.changed(IN_PROGRESS)` 후에도 유지되는지.
- 승인 원 클릭 시 승인/거절 UI 가 뜨고 실제 승인/거절이 되는지.
- 탭을 껐다 켜도 현재 진행·승인 상태가 연출로 복구되는지.
