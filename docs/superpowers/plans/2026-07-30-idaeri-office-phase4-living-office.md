# 이대리 macOS 콘솔 Phase 4 (살아있는 오피스) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정적 오피스 격자를 실 SSE 이벤트에 반응하는 "살아있는 오피스"로 확장한다 — 진행 펄스·승인 집결·체인 핸드오프 연출 + 원 클릭으로 지시/승인.

**Architecture:** Phase 3 경계 계승 — 순수 로직(좌표·연출 매핑·히트테스트·승인 매칭)은 `ConsoleCore`에서 실행형 러너로 TDD, SpriteKit 연출(`SKAction`)·클릭 바인딩은 실행 타깃 `IdaeriConsole`. 연출 트리거의 원천은 스냅샷이 아니라 SSE 이벤트이며, `ConsoleStore`가 Combine으로 이벤트를 방출하고 `OfficeView`가 순수 매핑으로 `VisualIntent`를 만들어 씬에 넘긴다. write는 Phase 2A의 기존 경로(`sendCommand`/`approve`/`reject`)만 재사용한다.

**Tech Stack:** Swift 6 / SwiftPM · SwiftUI · SpriteKit(SKScene/SpriteView/SKAction) · Combine(ObservableObject·PassthroughSubject) · 실행형 테스트 러너(`swift run ConsoleCoreTests`).

## Global Constraints

- Swift 앱에 LLM 로직 없음. 콘솔은 읽기·알림 + Phase 2A write 재사용 전용. **새 네트워크·API 경로 금지.**
- 데이터는 기존 `ConsoleStore`(스냅샷 + SSE) 재사용.
- 빌드·검증: `swift build`(clients/idaeri-console) + 실행형 러너 `swift run ConsoleCoreTests`. 이 환경은 CLT만, `xcodebuild`·XCTest 없음. SpriteKit은 macOS SDK에 포함돼 SwiftPM 링크 가능.
- 순수 계산(좌표·연출 매핑·히트테스트·승인 매칭)은 `ConsoleCore`에 두어 테스트. SpriteKit 의존 코드(`OfficeScene`의 `SKAction`·`mouseDown`)는 `IdaeriConsole`에 둔다.
- Swift 네이밍: 축약 변수명 지양, 타입/함수 의미 있는 이름.
- 좌표계는 SpriteKit 기본(원점 좌하단, y 위로 증가). 기존 `officeLayout` 규약 계승.
- 말풍선 문구는 백엔드 `bubble` 그대로 표시만. 이동은 직선 보간(`SKAction.move`)만 — A*·충돌 회피 없음.
- 작업 경로: worktree `/Users/juneseok/worktrees/idaeri-office-phase4`, 브랜치 `feat/macos-console-phase4`. 모든 경로는 `clients/idaeri-console/` 기준. (worktree 는 실행 시점에 superpowers:using-git-worktrees 로 생성. `docs/` 는 gitignore 라 커밋 시 `git add -f`.)

## 태스크별 TDD 여부

| Task | 성격 | 검증 |
|---|---|---|
| T1 officeLayout 밴드 확장 + presidentBandSlot | 순수 계산 | **TDD** (실행형 러너) |
| T2 VisualIntent + visualIntents 매핑 | 순수 계산 | **TDD** (실행형 러너) |
| T3 agentTypeAt 히트테스트 + approvalFor | 순수 계산 | **TDD** (실행형 러너) |
| T4 ConsoleStore 이벤트 방출 | Combine 방출 배선 | **TDD** (구독 검증) |
| T5 OfficeScene perform(연출) + 집자리 배치 | SpriteKit 노드 | `swift build` + 수동 |
| T6 OfficeScene mouseDown 히트테스트 콜백 | SpriteKit 입력 | `swift build` + 수동 |
| T7 OfficeView 배선 + 클릭 지시/승인 UI | 뷰 통합 | `swift build` + 수동 |
| T8 AppRootView write 주입 + 통합 스파이크 | 통합 | `swift build` + 전체 `swift run` 수동 |

## File Structure

- `Sources/ConsoleCore/OfficeLayout.swift` (수정): `officeLayout` 에 밴드 높이 반영 + `presidentBandSlot` 추가.
- `Sources/ConsoleCore/OfficeChoreography.swift` (신규): `VisualIntent`, `ChoreographyContext`, `visualIntents(for:context:)`.
- `Sources/ConsoleCore/OfficeInteraction.swift` (신규): `agentTypeAt(point:slots:radius:)`, `approvalFor(agentType:in:)`.
- `Sources/ConsoleCore/ConsoleStore.swift` (수정): `eventStream` (PassthroughSubject) 방출.
- `Sources/IdaeriConsole/OfficeScene.swift` (수정): 집자리 보관, `perform(_:)` 연출, `mouseDown` 클릭 콜백.
- `Sources/IdaeriConsole/OfficeView.swift` (수정): 이벤트→intent→perform 배선 + 클릭 지시/승인 UI.
- `Sources/IdaeriConsole/AppRootView.swift` (수정): `OfficeView` 에 write 액션 주입.
- 테스트: `OfficeLayoutTests.swift`(수정), `OfficeChoreographyTests.swift`(신규), `OfficeInteractionTests.swift`(신규), `ConsoleStoreTests.swift`(수정), `main.swift`(스위트 등록).

---

## Task 1: officeLayout 밴드 확장 + presidentBandSlot

격자를 하단으로 압축해 상단에 "대표실 밴드"(집결지) 공간을 비운다. `officeLayout` 에 `bandHeight` 파라미터를 **기본값 0** 으로 추가해 기존 호출부(Phase 3 `OfficeScene`·테스트)는 그대로 두고, 밴드 내 집결 좌표를 주는 `presidentBandSlot` 을 신설한다.

**Files:**
- Modify: `Sources/ConsoleCore/OfficeLayout.swift`
- Test: `Sources/ConsoleCoreTests/OfficeLayoutTests.swift`

**Interfaces:**
- Produces:
  - `func officeLayout(count: Int, width: Double, height: Double, columns: Int, bandHeight: Double = 0) -> [OfficePoint]`
  - `func presidentBandSlot(order: Int, count: Int, width: Double, height: Double, bandHeight: Double) -> OfficePoint`

- [ ] **Step 1: 실패 테스트 추가** — `OfficeLayoutTests.swift` 의 `runOfficeLayoutTests` 끝에 추가

```swift
    // 밴드 반영: 격자 좌표는 모두 밴드 아래(height - bandHeight) 영역 안
    let banded = officeLayout(count: 26, width: 900, height: 600, columns: 5, bandHeight: 120)
    t.expectEqual(banded.count, 26, "밴드 반영해도 좌표 개수 == count")
    t.expect(banded.allSatisfy { $0.y < 600 - 120 }, "모든 격자 좌표가 밴드 아래")

    // bandHeight 기본값 0 이면 기존 동작과 동일(회귀 방지)
    let plain = officeLayout(count: 26, width: 900, height: 600, columns: 5)
    let plainBand0 = officeLayout(count: 26, width: 900, height: 600, columns: 5, bandHeight: 0)
    t.expectEqual(plain, plainBand0, "bandHeight 0 == 무인자 호출")

    // 대표실 밴드 슬롯: N개가 밴드 안(y 동일, x 서로 다름)
    let slots = (0..<3).map { presidentBandSlot(order: $0, count: 3, width: 900, height: 600, bandHeight: 120) }
    t.expect(slots.allSatisfy { $0.y > 600 - 120 && $0.y < 600 }, "밴드 슬롯 y 는 밴드 영역 안")
    t.expectEqual(Set(slots.map { $0.x }).count, 3, "밴드 슬롯 x 는 서로 다름")
```

- [ ] **Step 2: 실패 확인**

Run: `cd clients/idaeri-console && swift build --target ConsoleCoreTests`
Expected: FAIL — `extra argument 'bandHeight'` 및 `cannot find 'presidentBandSlot' in scope`.

- [ ] **Step 3: 구현** — `OfficeLayout.swift` 의 `officeLayout` 을 교체하고 `presidentBandSlot` 을 추가

기존 `officeLayout` 시그니처·본문을 다음으로 교체(밴드 반영):

```swift
/// `count` 개를 `width`×`height` 씬의 **하단 격자 영역**(상단 `bandHeight` 는 대표실 밴드로 비움)에
/// 위→아래·왼→오 격자로 배치한 중심 좌표. 좌표계는 SpriteKit 기본(원점 좌하단, y 위로 증가).
/// `bandHeight` 기본값 0 이면 씬 전체를 격자로 쓴다(Phase 3 동작).
public func officeLayout(
    count: Int,
    width: Double,
    height: Double,
    columns: Int,
    bandHeight: Double = 0
) -> [OfficePoint] {
    guard count > 0, columns > 0, width > 0, height > 0 else {
        return []
    }
    let gridHeight = max(height - max(bandHeight, 0), 1)
    let effectiveColumns = min(columns, count)
    let rows = Int((Double(count) / Double(effectiveColumns)).rounded(.up))
    let cellWidth = width / Double(effectiveColumns)
    let cellHeight = gridHeight / Double(max(rows, 1))
    var points: [OfficePoint] = []
    for index in 0..<count {
        let column = index % effectiveColumns
        let row = index / effectiveColumns
        let x = cellWidth * (Double(column) + 0.5)
        let y = gridHeight - cellHeight * (Double(row) + 0.5)
        points.append(OfficePoint(x: x, y: y))
    }
    return points
}

/// 대표실 밴드(씬 상단 `bandHeight` 높이) 안에 `order` 순번을 가로 균등 배치한 좌표.
/// 승인 대기·소집된 원이 자기 자리에서 여기로 직선 이동해 집결한다.
public func presidentBandSlot(
    order: Int,
    count: Int,
    width: Double,
    height: Double,
    bandHeight: Double
) -> OfficePoint {
    guard count > 0, bandHeight > 0, width > 0 else {
        return OfficePoint(x: width / 2, y: height)
    }
    let y = height - bandHeight / 2
    let x = width * (Double(order) + 0.5) / Double(count)
    return OfficePoint(x: x, y: y)
}
```

- [ ] **Step 4: 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과` (기존 건 + 신규 4건).

- [ ] **Step 5: Commit**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/OfficeLayout.swift clients/idaeri-console/Sources/ConsoleCoreTests/OfficeLayoutTests.swift
git commit -m "feat(console-app): officeLayout 대표실 밴드 반영 + presidentBandSlot"
```

---

## Task 2: VisualIntent + visualIntents 연출 매핑

SSE 이벤트를 씬이 실행할 **연출 의도**(`VisualIntent`)로 번역하는 순수 함수. 이벤트 외 부수 정보(부모 run 의 agentType, pending 의 agentType)는 `ChoreographyContext` 로 함께 받는다.

**Files:**
- Create: `Sources/ConsoleCore/OfficeChoreography.swift`
- Test: `Sources/ConsoleCoreTests/OfficeChoreographyTests.swift`
- Modify: `Sources/ConsoleCoreTests/main.swift` (스위트 등록)

**Interfaces:**
- Consumes: `ConsoleEvent`, `ConsoleAgent`, `ConsoleRun`, `PendingCommand`, `ConsoleAgentState`
- Produces:
  - `enum VisualIntent: Equatable, Sendable` — cases: `recolor(agentType:state:)`, `working(agentType:)`, `handoff(from:to:)`, `summonToBand(agentType:)`, `returnHome(agentType:)`, `reject(agentType:)`, `bubble(agentType:text:)`
  - `struct ChoreographyContext` — `{ agents: [ConsoleAgent]; runs: [ConsoleRun]; pendingCommands: [PendingCommand] }`
  - `func visualIntents(for event: ConsoleEvent, context: ChoreographyContext) -> [VisualIntent]`

- [ ] **Step 1: 실패 테스트 작성** — `Sources/ConsoleCoreTests/OfficeChoreographyTests.swift`

```swift
import Foundation

@testable import ConsoleCore

private func makeAgent(_ type: String, _ state: ConsoleAgentState, bubble: String = "말풍선") -> ConsoleAgent {
    ConsoleAgent(agentType: type, displayName: type, slashCommands: [], description: "", state: state, bubble: bubble)
}

private func makeRun(_ id: String, _ type: String, parentId: String? = nil) -> ConsoleRun {
    ConsoleRun(id: id, agentType: type, status: "RUNNING", parentId: parentId, startedAt: "t", finishedAt: nil)
}

func runOfficeChoreographyTests(_ t: TestRunner) {
    t.suite("OfficeChoreography")

    let agents = [makeAgent("PM", .inProgress), makeAgent("CTO", .awaitingApproval, bubble: "확인해주세요")]

    // run.started (부모 없음) → working
    let ctx = ChoreographyContext(agents: agents, runs: [], pendingCommands: [])
    t.expectEqual(
        visualIntents(for: .runStarted(makeRun("r1", "PM")), context: ctx),
        [.working(agentType: "PM")],
        "부모 없는 run.started → working")

    // run.started (부모 있음) → handoff(부모→자식) + working
    let ctxChain = ChoreographyContext(agents: agents, runs: [makeRun("r0", "PM")], pendingCommands: [])
    t.expectEqual(
        visualIntents(for: .runStarted(makeRun("r1", "CTO", parentId: "r0")), context: ctxChain),
        [.handoff(from: "PM", to: "CTO"), .working(agentType: "CTO")],
        "부모 있는 run.started → handoff + working")

    // run.finished → 현재 상태로 recolor + bubble
    t.expectEqual(
        visualIntents(for: .runFinished(makeRun("r1", "CTO")), context: ctx),
        [.recolor(agentType: "CTO", state: .awaitingApproval), .bubble(agentType: "CTO", text: "확인해주세요")],
        "run.finished → recolor + bubble")

    // approval.opened → summonToBand + bubble
    let approval = ConsoleApproval(id: "a1", agentType: "CTO", title: "PR", createdAt: "t")
    t.expectEqual(
        visualIntents(for: .approvalOpened(approval), context: ctx),
        [.summonToBand(agentType: "CTO"), .bubble(agentType: "CTO", text: "확인해주세요")],
        "approval.opened → summon + bubble")

    // approval.resolved → returnHome
    t.expectEqual(
        visualIntents(for: .approvalResolved(approval), context: ctx),
        [.returnHome(agentType: "CTO")],
        "approval.resolved → returnHome")

    // state.changed → recolor
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "PM", state: .completed), context: ctx),
        [.recolor(agentType: "PM", state: .completed)],
        "state.changed → recolor")

    // command.rejected → pending 의 agentType 으로 reject
    let pending = PendingCommand(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                                 text: "t", agentTypeHint: "PM", sentAt: Date(), phase: .sent)
    let ctxPending = ChoreographyContext(agents: agents, runs: [], pendingCommands: [pending])
    t.expectEqual(
        visualIntents(for: .commandRejected(commandId: "00000000-0000-0000-0000-000000000001", reason: "x"), context: ctxPending),
        [.reject(agentType: "PM")],
        "command.rejected → pending agentType 으로 reject")

    // 미지 agentType → 빈 결과
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "UNKNOWN", state: .completed), context: ctx),
        [],
        "미지 agentType → 빈 결과")

    // 오피스 무관 이벤트(session/command.info) → 빈 결과
    let session = ConsoleSession(sessionId: "s", pid: 1, source: "cli", name: "n", cwd: "/", state: "active", startedAt: "t", lastActivityAt: nil)
    t.expectEqual(visualIntents(for: .sessionOpened(session), context: ctx), [], "session.opened → 빈 결과")
    t.expectEqual(visualIntents(for: .commandInfo(commandId: "x", message: "m"), context: ctx), [], "command.info → 빈 결과")
}
```

- [ ] **Step 2: main.swift 에 스위트 등록** — `Sources/ConsoleCoreTests/main.swift` 의 `runOfficeLayoutTests(runner)` 다음 줄에 추가

```swift
runOfficeChoreographyTests(runner)
```

- [ ] **Step 3: 실패 확인**

Run: `cd clients/idaeri-console && swift build --target ConsoleCoreTests`
Expected: FAIL — `cannot find 'visualIntents' / 'ChoreographyContext' / 'VisualIntent' in scope`.

- [ ] **Step 4: 구현** — `Sources/ConsoleCore/OfficeChoreography.swift`

```swift
import Foundation

/// 씬이 실행할 연출 의도. 어떤 이벤트가 어떤 연출인지는 이 값으로 확정되고,
/// SpriteKit(SKAction) 실행은 OfficeScene 이 맡는다(코어는 SpriteKit 비의존).
public enum VisualIntent: Equatable, Sendable {
    case recolor(agentType: String, state: ConsoleAgentState)
    case working(agentType: String)
    case handoff(from: String, to: String)
    case summonToBand(agentType: String)
    case returnHome(agentType: String)
    case reject(agentType: String)
    case bubble(agentType: String, text: String)
}

/// 이벤트 번역에 필요한 주변 상태(부모 run·pending 조회용). 스냅샷 파생, 부작용 없음.
public struct ChoreographyContext: Sendable {
    public let agents: [ConsoleAgent]
    public let runs: [ConsoleRun]
    public let pendingCommands: [PendingCommand]

    public init(agents: [ConsoleAgent], runs: [ConsoleRun], pendingCommands: [PendingCommand]) {
        self.agents = agents
        self.runs = runs
        self.pendingCommands = pendingCommands
    }
}

/// SSE 이벤트 하나를 연출 의도 배열로 번역한다(순수).
/// 미지의 agentType 이거나 오피스와 무관한 이벤트(session·command.info·approvalResolved 의 미상 등)는 빈 배열.
public func visualIntents(for event: ConsoleEvent, context: ChoreographyContext) -> [VisualIntent] {
    func knows(_ agentType: String) -> Bool {
        context.agents.contains { $0.agentType == agentType }
    }
    func agent(_ agentType: String) -> ConsoleAgent? {
        context.agents.first { $0.agentType == agentType }
    }

    switch event {
    case let .runStarted(run):
        guard knows(run.agentType) else {
            return []
        }
        if let parentId = run.parentId,
           let parent = context.runs.first(where: { $0.id == parentId }),
           knows(parent.agentType) {
            return [.handoff(from: parent.agentType, to: run.agentType), .working(agentType: run.agentType)]
        }
        return [.working(agentType: run.agentType)]

    case let .runFinished(run):
        guard let found = agent(run.agentType) else {
            return []
        }
        return [.recolor(agentType: found.agentType, state: found.state), .bubble(agentType: found.agentType, text: found.bubble)]

    case let .approvalOpened(approval):
        guard let agentType = approval.agentType, knows(agentType) else {
            return []
        }
        var intents: [VisualIntent] = [.summonToBand(agentType: agentType)]
        if let found = agent(agentType) {
            intents.append(.bubble(agentType: agentType, text: found.bubble))
        }
        return intents

    case let .approvalResolved(approval):
        guard let agentType = approval.agentType, knows(agentType) else {
            return []
        }
        return [.returnHome(agentType: agentType)]

    case let .stateChanged(agentType, state):
        guard knows(agentType) else {
            return []
        }
        return [.recolor(agentType: agentType, state: state)]

    case let .commandRejected(commandId, _):
        guard
            let id = UUID(uuidString: commandId),
            let pending = context.pendingCommands.first(where: { $0.id == id }),
            let agentType = pending.effectiveAgentType,
            knows(agentType)
        else {
            return []
        }
        return [.reject(agentType: agentType)]

    case .sessionOpened, .sessionUpdated, .sessionClosed, .commandInfo:
        return []
    }
}
```

- [ ] **Step 5: 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과`.

- [ ] **Step 6: Commit**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/OfficeChoreography.swift clients/idaeri-console/Sources/ConsoleCoreTests/OfficeChoreographyTests.swift clients/idaeri-console/Sources/ConsoleCoreTests/main.swift
git commit -m "feat(console-app): VisualIntent + 이벤트→연출 순수 매핑"
```

---

## Task 3: agentTypeAt 히트테스트 + approvalFor

클릭 좌표를 해당 에이전트로 환원하는 히트테스트와, 에이전트의 승인 대기 건을 찾는 매칭. 둘 다 순수.

**Files:**
- Create: `Sources/ConsoleCore/OfficeInteraction.swift`
- Test: `Sources/ConsoleCoreTests/OfficeInteractionTests.swift`
- Modify: `Sources/ConsoleCoreTests/main.swift` (스위트 등록)

**Interfaces:**
- Consumes: `OfficePoint`, `ConsoleApproval`
- Produces:
  - `func agentTypeAt(point: OfficePoint, slots: [(agentType: String, point: OfficePoint)], radius: Double) -> String?`
  - `func approvalFor(agentType: String, in approvals: [ConsoleApproval]) -> ConsoleApproval?`

- [ ] **Step 1: 실패 테스트 작성** — `Sources/ConsoleCoreTests/OfficeInteractionTests.swift`

```swift
import Foundation

@testable import ConsoleCore

func runOfficeInteractionTests(_ t: TestRunner) {
    t.suite("OfficeInteraction")

    let slots: [(agentType: String, point: OfficePoint)] = [
        ("PM", OfficePoint(x: 100, y: 100)),
        ("CTO", OfficePoint(x: 300, y: 100)),
    ]

    // 원 중심 근처 클릭 → 그 agentType
    t.expectEqual(agentTypeAt(point: OfficePoint(x: 108, y: 104), slots: slots, radius: 26), "PM", "중심 근처 → PM")

    // 어떤 원과도 먼 클릭 → nil
    t.expectNil(agentTypeAt(point: OfficePoint(x: 200, y: 400), slots: slots, radius: 26), "빈 공간 클릭 → nil")

    // 겹치는 반경이면 더 가까운 쪽
    t.expectEqual(agentTypeAt(point: OfficePoint(x: 295, y: 100), slots: slots, radius: 300), "CTO", "가장 가까운 원 선택")

    // approvalFor: 해당 agentType 의 승인 건
    let approvals = [
        ConsoleApproval(id: "a1", agentType: "CTO", title: "PR1", createdAt: "t1"),
        ConsoleApproval(id: "a2", agentType: "PM", title: "PR2", createdAt: "t2"),
    ]
    t.expectEqual(approvalFor(agentType: "PM", in: approvals)?.id, "a2", "PM 승인 건 매칭")
    t.expectNil(approvalFor(agentType: "BE", in: approvals), "승인 없는 에이전트 → nil")
}
```

- [ ] **Step 2: main.swift 에 스위트 등록** — `runOfficeChoreographyTests(runner)` 다음 줄에 추가

```swift
runOfficeInteractionTests(runner)
```

- [ ] **Step 3: 실패 확인**

Run: `swift build --target ConsoleCoreTests`
Expected: FAIL — `cannot find 'agentTypeAt' / 'approvalFor' in scope`.

- [ ] **Step 4: 구현** — `Sources/ConsoleCore/OfficeInteraction.swift`

```swift
import Foundation

/// 클릭 좌표가 어느 에이전트 원 안인지 판정한다(순수). 반경 안의 후보 중 가장 가까운 것을 고른다.
/// 어떤 원과도 반경 밖이면 nil.
public func agentTypeAt(
    point: OfficePoint,
    slots: [(agentType: String, point: OfficePoint)],
    radius: Double
) -> String? {
    var best: (agentType: String, distanceSquared: Double)?
    let radiusSquared = radius * radius
    for slot in slots {
        let dx = slot.point.x - point.x
        let dy = slot.point.y - point.y
        let distanceSquared = dx * dx + dy * dy
        guard distanceSquared <= radiusSquared else {
            continue
        }
        if best == nil || distanceSquared < best!.distanceSquared {
            best = (slot.agentType, distanceSquared)
        }
    }
    return best?.agentType
}

/// 해당 에이전트의 승인 대기 건을 찾는다. 여러 건이면 첫 번째(스냅샷 순서 = 결정론적).
public func approvalFor(agentType: String, in approvals: [ConsoleApproval]) -> ConsoleApproval? {
    approvals.first { $0.agentType == agentType }
}
```

- [ ] **Step 5: 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과`.

- [ ] **Step 6: Commit**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/OfficeInteraction.swift clients/idaeri-console/Sources/ConsoleCoreTests/OfficeInteractionTests.swift clients/idaeri-console/Sources/ConsoleCoreTests/main.swift
git commit -m "feat(console-app): 오피스 히트테스트 + 승인 매칭 순수 함수"
```

---

## Task 4: ConsoleStore 이벤트 방출

연출은 "방금 무슨 일이 일어났는가"에 반응해야 하므로, `ConsoleStore` 가 처리한 SSE 이벤트를 Combine 으로 방출한다. 스냅샷 적용(`apply(snapshot:)`)은 방출하지 않아 재연결 시 연출이 중복 트리거되지 않는다.

**Files:**
- Modify: `Sources/ConsoleCore/ConsoleStore.swift`
- Test: `Sources/ConsoleCoreTests/ConsoleStoreTests.swift`

**Interfaces:**
- Produces: `ConsoleStore.eventStream: PassthroughSubject<ConsoleEvent, Never>` (public let). `apply(event:)` 가 상태 갱신 후 `eventStream.send(event)` 한다.

- [ ] **Step 1: 실패 테스트 추가** — `ConsoleStoreTests.swift` 의 `runConsoleStoreTests` 끝에 추가

```swift
    // apply(event:) 는 처리한 이벤트를 eventStream 으로 방출한다
    let emitStore = ConsoleStore()
    emitStore.apply(snapshot: ConsoleSnapshot(
        agents: [ConsoleAgent(agentType: "PM", displayName: "PM", slashCommands: [], description: "", state: .waiting, bubble: "")],
        runs: [], approvals: [], sessions: [], serverTime: "t"))
    var receivedStateChange = false
    let cancellable = emitStore.eventStream.sink { event in
        if case .stateChanged(let agentType, _) = event, agentType == "PM" {
            receivedStateChange = true
        }
    }
    emitStore.apply(event: .stateChanged(agentType: "PM", state: .inProgress))
    t.expect(receivedStateChange, "apply(event:) 가 eventStream 으로 방출")
    cancellable.cancel()
```

`ConsoleStoreTests.swift` 상단 import 에 `import Combine` 이 없으면 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `swift build --target ConsoleCoreTests`
Expected: FAIL — `value of type 'ConsoleStore' has no member 'eventStream'`.

- [ ] **Step 3: 구현** — `ConsoleStore.swift`

프로퍼티 선언부(`@Published ... pendingCommands` 다음)에 추가:

```swift
    /// 처리한 SSE 이벤트를 방출한다(연출 트리거용). 스냅샷 적용은 방출하지 않는다.
    public let eventStream = PassthroughSubject<ConsoleEvent, Never>()
```

`apply(event:)` 의 `switch event { ... }` **닫는 중괄호 다음**(메서드 끝)에 방출 한 줄 추가:

```swift
    public func apply(event: ConsoleEvent) {
        switch event {
        // ... 기존 case 전부 그대로 ...
        }
        eventStream.send(event)
    }
```

(`import Combine` 은 파일 상단에 이미 있다.)

- [ ] **Step 4: 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과`.

- [ ] **Step 5: Commit**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/ConsoleStore.swift clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleStoreTests.swift
git commit -m "feat(console-app): ConsoleStore 이벤트 방출(eventStream)"
```

---

## Task 5: OfficeScene perform(연출) + 집자리 배치

씬이 집(home) 자리를 밴드 반영 격자로 잡아 보관하고, `VisualIntent` 배열을 받아 `SKAction` 으로 연출한다. 밴드 집결 순번은 씬이 관리한다.

**Files:**
- Modify: `Sources/IdaeriConsole/OfficeScene.swift`

**Interfaces:**
- Consumes: `officeLayout(...,bandHeight:)`, `presidentBandSlot(...)`, `VisualIntent`, `ConsoleAgentState.skColor`
- Produces: `OfficeScene.perform(_ intents: [VisualIntent])`, `OfficeScene.bandHeight`(상수), 집자리 보관 `homePositions`

- [ ] **Step 1: OfficeScene 교체 구현** — `Sources/IdaeriConsole/OfficeScene.swift` 전체를 다음으로 교체

```swift
import ConsoleCore
import SpriteKit

/// 에이전트를 상태색 원 + 이름 라벨로 격자 배치하고, 이벤트 연출(VisualIntent)을 SKAction 으로 실행하는 씬.
/// - sync(agents:)   : store 상태를 반영(신규 추가·제거·색 갱신). 집 자리를 계산·보관한다.
/// - perform(_:)     : 이벤트 연출(펄스·집결·핸드오프·복귀·거절·말풍선)을 실행한다.
final class OfficeScene: SKScene {
    private var agentNodes: [String: SKShapeNode] = [:]
    private var homePositions: [String: CGPoint] = [:]
    private var bandOrder: [String] = []  // 대표실 밴드에 집결한 순서
    private let columns = 5
    private let bandHeight: Double = 120
    private let nodeRadius: Double = 26

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(white: 0.12, alpha: 1)
    }

    func sync(agents: [ConsoleAgent]) {
        let incoming = agents.map { $0.agentType }
        let diff = officeNodeDiff(existing: Set(agentNodes.keys), incoming: incoming)

        for agentType in diff.removed {
            agentNodes[agentType]?.removeFromParent()
            agentNodes[agentType] = nil
            homePositions[agentType] = nil
        }

        let positions = officeLayout(
            count: agents.count,
            width: Double(size.width),
            height: Double(size.height),
            columns: columns,
            bandHeight: bandHeight
        )

        for (index, agent) in agents.enumerated() {
            let node = agentNodes[agent.agentType] ?? makeNode(for: agent)
            if agentNodes[agent.agentType] == nil {
                agentNodes[agent.agentType] = node
                addChild(node)
            }
            if index < positions.count {
                let home = CGPoint(x: positions[index].x, y: positions[index].y)
                homePositions[agent.agentType] = home
                // 집결 중이 아닌 노드만 자리 갱신(집결 노드는 밴드에 둔다).
                if !bandOrder.contains(agent.agentType) {
                    node.position = home
                }
            }
            // 색은 sync 가 진실원. 단, working 펄스 중이면 색만 바꾸고 펄스는 유지.
            node.fillColor = agent.state.skColor
        }
    }

    /// 연출 실행. 각 intent 를 SKAction 으로.
    func perform(_ intents: [VisualIntent]) {
        for intent in intents {
            switch intent {
            case let .recolor(agentType, state):
                recolor(agentType, to: state.skColor)
            case let .working(agentType):
                startWorking(agentType)
            case let .handoff(from, to):
                handoff(from: from, to: to)
            case let .summonToBand(agentType):
                summonToBand(agentType)
            case let .returnHome(agentType):
                returnHome(agentType)
            case let .reject(agentType):
                reject(agentType)
            case let .bubble(agentType, text):
                showBubble(agentType, text: text)
            }
        }
    }

    // MARK: - 연출 구현

    private func recolor(_ agentType: String, to color: SKColor) {
        guard let node = agentNodes[agentType] else {
            return
        }
        node.removeAction(forKey: "working")
        node.fillColor = color
        node.run(.sequence([.scale(to: 1.15, duration: 0.12), .scale(to: 1.0, duration: 0.12)]))
    }

    private func startWorking(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        let pulse = SKAction.sequence([
            .scaleY(to: 1.12, duration: 0.35),
            .scaleY(to: 1.0, duration: 0.35),
        ])
        node.run(.repeatForever(pulse), withKey: "working")
    }

    private func handoff(from: String, to: String) {
        guard let start = homePositions[from], let end = homePositions[to] else {
            return
        }
        let packet = SKShapeNode(circleOfRadius: 6)
        packet.fillColor = SKColor(white: 1, alpha: 0.9)
        packet.position = start
        packet.zPosition = 10
        addChild(packet)
        packet.run(.sequence([
            .move(to: end, duration: 0.6),
            .removeFromParent(),
        ]))
        if let target = agentNodes[to] {
            target.run(.sequence([.scale(to: 1.2, duration: 0.15), .scale(to: 1.0, duration: 0.15)]))
        }
    }

    private func summonToBand(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        if !bandOrder.contains(agentType) {
            bandOrder.append(agentType)
        }
        layoutBand()
        let blink = SKAction.sequence([.fadeAlpha(to: 0.4, duration: 0.4), .fadeAlpha(to: 1.0, duration: 0.4)])
        node.run(.repeatForever(blink), withKey: "summon")
    }

    private func returnHome(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        node.removeAction(forKey: "summon")
        node.alpha = 1
        bandOrder.removeAll { $0 == agentType }
        if let home = homePositions[agentType] {
            node.run(.move(to: home, duration: 0.5), withKey: "place")
        }
        layoutBand()
    }

    private func reject(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        let shake = SKAction.sequence([
            .moveBy(x: 8, y: 0, duration: 0.05),
            .moveBy(x: -16, y: 0, duration: 0.1),
            .moveBy(x: 8, y: 0, duration: 0.05),
        ])
        let original = node.fillColor
        node.run(.sequence([.repeat(shake, count: 2)]))
        node.fillColor = SKColor(red: 0.9, green: 0.2, blue: 0.2, alpha: 1)
        node.run(.sequence([.wait(forDuration: 0.4), .run { node.fillColor = original }]))
    }

    private func showBubble(_ agentType: String, text: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        node.childNode(withName: "bubble")?.removeFromParent()
        let label = SKLabelNode(text: text)
        label.name = "bubble"
        label.fontSize = 11
        label.fontColor = SKColor(white: 1, alpha: 1)
        label.verticalAlignmentMode = .center
        label.position = CGPoint(x: 0, y: 44)
        label.zPosition = 5
        node.addChild(label)
        label.run(.sequence([.wait(forDuration: 2.5), .fadeOut(withDuration: 0.5), .removeFromParent()]))
    }

    /// 대표실 밴드에 집결한 노드들을 순번대로 재배치한다.
    private func layoutBand() {
        for (order, agentType) in bandOrder.enumerated() {
            guard let node = agentNodes[agentType] else {
                continue
            }
            let slot = presidentBandSlot(
                order: order,
                count: max(bandOrder.count, 1),
                width: Double(size.width),
                height: Double(size.height),
                bandHeight: bandHeight
            )
            node.run(.move(to: CGPoint(x: slot.x, y: slot.y), duration: 0.5), withKey: "place")
        }
    }

    private func makeNode(for agent: ConsoleAgent) -> SKShapeNode {
        let node = SKShapeNode(circleOfRadius: nodeRadius)
        node.strokeColor = SKColor(white: 1, alpha: 0.25)
        node.lineWidth = 1
        node.fillColor = agent.state.skColor

        let label = SKLabelNode(text: agent.displayName)
        label.fontSize = 11
        label.fontColor = SKColor(white: 0.95, alpha: 1)
        label.verticalAlignmentMode = .center
        label.position = CGPoint(x: 0, y: -40)
        label.preferredMaxLayoutWidth = 90
        node.addChild(label)

        return node
    }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd clients/idaeri-console && swift build`
Expected: 성공(에러·경고 0). (씬은 T7 배선 전이라 `perform` 은 아직 호출되지 않음 — 컴파일만 확인.)

- [ ] **Step 3: 렌더 확인(수동)** — 배선 전이므로 격자 렌더만 확인(연출은 T7·T8 후).

Run: `swift run IdaeriConsole` (백엔드 없이도 창은 뜸)
Expected: 어두운 배경에 원 격자가 **하단 영역**에 모여 뜬다(상단은 밴드로 비어 있음). 크래시 없이 뜨면 통과.

- [ ] **Step 4: Commit**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git commit -m "feat(console-app): OfficeScene 연출(perform) + 대표실 밴드 집결"
```

---

## Task 6: OfficeScene mouseDown 히트테스트 콜백

씬이 클릭을 받아 `agentTypeAt` 로 대상 에이전트를 환원하고 콜백으로 올린다. 히트테스트는 현재 노드의 실제 위치(집결 노드 포함)를 slots 로 쓴다.

**Files:**
- Modify: `Sources/IdaeriConsole/OfficeScene.swift`

**Interfaces:**
- Consumes: `agentTypeAt(point:slots:radius:)`, `OfficePoint`
- Produces: `OfficeScene.onAgentClick: ((String) -> Void)?` (뷰가 주입), `override func mouseDown(with:)`

- [ ] **Step 1: 콜백 프로퍼티 추가** — `OfficeScene` 의 저장 프로퍼티부(`private let nodeRadius` 다음)에 추가

```swift
    /// 원 클릭 시 해당 agentType 을 뷰로 올린다(뷰가 지시/승인 UI 를 띄운다).
    var onAgentClick: ((String) -> Void)?
```

- [ ] **Step 2: mouseDown 오버라이드 추가** — `OfficeScene` 안(예: `makeNode` 위)에 추가

```swift
    override func mouseDown(with event: NSEvent) {
        let location = event.location(in: self)
        let slots: [(agentType: String, point: OfficePoint)] = agentNodes.map {
            ($0.key, OfficePoint(x: Double($0.value.position.x), y: Double($0.value.position.y)))
        }
        let hit = agentTypeAt(
            point: OfficePoint(x: Double(location.x), y: Double(location.y)),
            slots: slots,
            radius: nodeRadius
        )
        if let hit {
            onAgentClick?(hit)
        }
    }
```

- [ ] **Step 3: 빌드 확인**

Run: `swift build`
Expected: 성공(에러·경고 0).

- [ ] **Step 4: 클릭 수신 확인(수동)** — 임시로 `didMove` 끝에 `onAgentClick = { print("클릭:", $0) }` 를 넣어 `swift run IdaeriConsole` 후 원을 클릭하면 콘솔에 `클릭: <agentType>` 이 찍히는지 본다. 확인 후 임시 줄 제거. (정직히: SKScene `mouseDown` 이 CLT 실행 앱에서 이벤트를 받는지의 첫 실증 — 안 받으면 여기서 멈추고 사용자에게 에스컬레이션.)

- [ ] **Step 5: Commit**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git commit -m "feat(console-app): OfficeScene mouseDown 히트테스트 클릭 콜백"
```

---

## Task 7: OfficeView 배선 + 클릭 지시/승인 UI

`OfficeView` 가 이벤트를 연출로 잇고, 씬 클릭을 지시 입력 바 / 승인·거절 팝오버로 연결한다. write 액션은 상위(T8)에서 주입받는다.

**Files:**
- Modify: `Sources/IdaeriConsole/OfficeView.swift`

**Interfaces:**
- Consumes: `ConsoleStore.eventStream`, `visualIntents(for:context:)`, `ChoreographyContext`, `OfficeScene.perform`, `OfficeScene.onAgentClick`, `approvalFor(agentType:in:)`
- Produces: `OfficeView(store:onSend:onApprove:onReject:)` — `onSend: (String, String?) -> Void`, `onApprove: (String) -> Void`, `onReject: (String) -> Void`

- [ ] **Step 1: OfficeView 교체 구현** — `Sources/IdaeriConsole/OfficeView.swift` 전체를 다음으로 교체

```swift
import ConsoleCore
import SpriteKit
import SwiftUI

/// 오피스 탭. store.agents 를 씬에 반영하고, SSE 이벤트를 연출(VisualIntent)로 잇는다.
/// 원 클릭 시 지시 입력 바(일반) 또는 승인/거절 팝오버(승인 대기)를 띄운다.
struct OfficeView: View {
    @ObservedObject var store: ConsoleStore
    let onSend: (String, String?) -> Void
    let onApprove: (String) -> Void
    let onReject: (String) -> Void

    @State private var scene: OfficeScene = {
        let scene = OfficeScene(size: CGSize(width: 900, height: 600))
        scene.scaleMode = .resizeFill
        return scene
    }()
    @State private var selectedAgent: String?
    @State private var commandText: String = ""

    var body: some View {
        ZStack(alignment: .bottom) {
            SpriteView(scene: scene)
                .frame(minWidth: 640, minHeight: 480)
                .onAppear {
                    scene.sync(agents: store.agents)
                    scene.onAgentClick = { agentType in
                        selectedAgent = agentType
                        commandText = ""
                    }
                }
                .onChange(of: store.agents) { newAgents in
                    scene.sync(agents: newAgents)
                }
                .onReceive(store.eventStream) { event in
                    let context = ChoreographyContext(
                        agents: store.agents,
                        runs: store.runs,
                        pendingCommands: store.pendingCommands
                    )
                    scene.perform(visualIntents(for: event, context: context))
                }

            if let agentType = selectedAgent {
                interactionBar(for: agentType)
            }
        }
    }

    @ViewBuilder
    private func interactionBar(for agentType: String) -> some View {
        let approval = approvalFor(agentType: agentType, in: store.approvals)
        VStack(spacing: 8) {
            HStack {
                Text(agentType).font(.headline)
                Spacer()
                Button("닫기") { selectedAgent = nil }
            }
            if let approval {
                HStack {
                    Text("승인 대기: \(approval.title)").lineLimit(1)
                    Spacer()
                    Button("승인") { onApprove(approval.id); selectedAgent = nil }
                        .keyboardShortcut(.defaultAction)
                    Button("거절") { onReject(approval.id); selectedAgent = nil }
                }
            } else {
                HStack {
                    TextField("\(agentType)에게 지시…", text: $commandText)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { send(to: agentType) }
                    Button("전송") { send(to: agentType) }
                        .disabled(commandText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .padding(12)
        .background(.thinMaterial)
        .cornerRadius(10)
        .padding(12)
    }

    private func send(to agentType: String) {
        let trimmed = commandText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }
        onSend(trimmed, agentType)
        commandText = ""
        selectedAgent = nil
    }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `swift build`
Expected: FAIL — `AppRootView` 가 아직 `OfficeView(store:)` 로 호출(인자 불일치). T8 에서 해소. **이 태스크의 빌드 확인은 `OfficeView.swift` 자체의 문법·타입만 본다**(다음 태스크와 함께 전체 빌드).

- [ ] **Step 3: Commit**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift
git commit -m "feat(console-app): OfficeView 연출 배선 + 클릭 지시/승인 UI"
```

---

## Task 8: AppRootView write 주입 + 통합 스파이크

`OfficeView` 에 기존 write 액션(`sendCommand`/`approve`/`reject`)을 주입해 전체를 연결하고, 통합 동작을 눈으로 확인한다.

**Files:**
- Modify: `Sources/IdaeriConsole/AppRootView.swift`

**Interfaces:**
- Consumes: `OfficeView(store:onSend:onApprove:onReject:)`, 기존 `sendCommand`/`approve`/`reject`

- [ ] **Step 1: office 케이스 교체** — `AppRootView.swift` 의 `case .office:` 를 다음으로 교체

```swift
            case .office:
                OfficeView(
                    store: store,
                    onSend: sendCommand,
                    onApprove: approve,
                    onReject: reject
                )
```

(`sendCommand(text:agentTypeHint:)`·`approve(id:)`·`reject(id:)` 는 이미 `AppRootView` 에 있다. `onSend` 는 `(String, String?) -> Void` 로 `sendCommand` 시그니처와 일치, `onApprove`/`onReject` 는 `(String) -> Void` 로 `approve`/`reject` 와 일치.)

- [ ] **Step 2: 빌드**

Run: `cd clients/idaeri-console && swift build`
Expected: 성공(에러·경고 0).

- [ ] **Step 3: 전체 테스트**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과` (기존 + 신규 전부).

- [ ] **Step 4: 통합 렌더·연출 확인(수동)** — 콘솔 백엔드가 3002 에 떠 있는 상태(`pnpm dev` 또는 별도 기동)에서:

Run: `swift run IdaeriConsole` (기본 URL `http://127.0.0.1:3002`)
Expected:
- 오피스 탭에 원 격자가 하단에 뜨고, 진행 중 에이전트는 노랑 + 타이핑 펄스로 움직인다.
- 승인 대기가 열리면 해당 원이 핑크로 깜빡이며 대표실 밴드로 올라가고, 승인/거절 후 자기 자리로 복귀한다.
- 체인 실행 시 부모 자리→자식 자리로 패킷 이동선이 보인다.
- 일반 원 클릭 → 하단 지시 입력 바 → 전송 시 실제 지시가 나간다(대시보드 pending 과 동일 경로).
- 승인 대기 원 클릭 → 승인/거절 버튼 → 실제 승인/거절.
정직히: 자동 검증 아님, 사용자 눈 확인. 연출 타이밍·좌표는 실행 후 미세 조정 가능.

- [ ] **Step 5: Commit**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/AppRootView.swift
git commit -m "feat(console-app): 오피스 write 주입 + 살아있는 오피스 통합"
```

---

## Self-Review

**Spec coverage:**
- 진행 펄스(성공 기준 1) → T2 `.working` 매핑 + T5 `startWorking` ✅
- 승인 집결·복귀(성공 기준 2) → T1 `presidentBandSlot` + T2 `.summonToBand`/`.returnHome` + T5 `summonToBand`/`returnHome`/`layoutBand` ✅
- 체인 핸드오프(성공 기준 3) → T2 `.handoff`(부모 run 조회) + T5 `handoff` ✅
- 클릭→지시/승인(성공 기준 4) → T3 `agentTypeAt`/`approvalFor` + T6 `mouseDown` + T7 `interactionBar` + T8 주입 ✅
- 순수 계산 검증(성공 기준 5) → T1~T4 실행형 러너 TDD ✅
- 연출 트리거=이벤트, 스냅샷은 색만 → T4 `eventStream`(스냅샷 미방출) + T7 `onReceive` ✅
- 대표실 밴드 레이아웃 → T1 + T5 `bandHeight`/`layoutBand` ✅
- 말풍선=bubble 표시만 → T2 `.bubble(text: agent.bubble)` + T5 `showBubble` ✅
- session·command.info 빈 결과 → T2 매핑 + 테스트 ✅
- 범위 밖(A*·타일맵·스프라이트·32명·자연어질의) → 태스크 없음(의도적) ✅

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. T5~T8 의 수동 확인은 GUI·SpriteKit·클릭 입력 특성상 자동 불가 지점으로 명시(placeholder 아님). T6 Step4 의 임시 print 는 확인 후 제거를 명시.

**Type consistency:**
- `officeLayout(count:width:height:columns:bandHeight:)` — T1 정의, T5 `sync` 에서 `bandHeight:` 인자로 호출. 기본값 0 이라 Phase 3 무인자 호출부·기존 테스트 무회귀.
- `presidentBandSlot(order:count:width:height:bandHeight:)` — T1 정의, T5 `layoutBand` 사용. 시그니처 일치.
- `VisualIntent` 케이스(`recolor`/`working`/`handoff`/`summonToBand`/`returnHome`/`reject`/`bubble`) — T2 정의, T5 `perform` switch 에서 전 케이스 소비. 누락 없음(switch exhaustive).
- `ChoreographyContext(agents:runs:pendingCommands:)` — T2 정의, T7 `onReceive` 에서 동일 인자로 생성.
- `visualIntents(for:context:)` — T2 정의, T7 사용. 시그니처 일치.
- `agentTypeAt(point:slots:radius:)` — T3 정의, T6 `mouseDown` 사용. `slots` 는 `[(agentType:String, point:OfficePoint)]` 로 양쪽 일치.
- `approvalFor(agentType:in:)` — T3 정의, T7 `interactionBar` 사용.
- `eventStream: PassthroughSubject<ConsoleEvent, Never>` — T4 정의, T7 `onReceive(store.eventStream)` 구독.
- `OfficeView(store:onSend:onApprove:onReject:)` — T7 정의(`onSend:(String,String?)->Void`, `onApprove`/`onReject`:`(String)->Void`), T8 에서 `sendCommand`/`approve`/`reject` 주입. `AppRootView.sendCommand(text:agentTypeHint:)` = `(String,String?)`, `approve(id:)`/`reject(id:)` = `(String)` 로 일치.
- `onAgentClick: ((String) -> Void)?` — T6 정의, T7 `onAppear` 에서 설정.

## 알려진 미결 (구현 중 확정)
- T6 Step4: SKScene `mouseDown` 이 CLT SwiftPM 실행 앱에서 클릭 이벤트를 받는지는 실행 시점 판정. 안 받으면 멈추고 에스컬레이션(Xcode 필요 여부).
- T5/T8: 연출 타이밍(펄스 주기·이동 duration)·밴드 높이는 눈 확인 후 미세 조정 여지. 값은 동작하는 기본값으로 시작.
- `showBubble`/`reject` 가 `working` 펄스 중인 노드에 겹칠 때의 시각 간섭은 실행 확인 후 필요 시 조정(기능 문제 아님).
