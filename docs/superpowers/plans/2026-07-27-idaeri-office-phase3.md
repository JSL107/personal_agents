# 이대리 macOS 콘솔 Phase 3 (몰입형 오피스 스파이크) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 콘솔 앱에 "오피스" 탭을 추가해 `agent-registry` 전원을 SpriteKit 씬에 격자로 배치하고 상태색으로 시각화한다(이동·연출 없음, 정적 배치 스파이크).

**Architecture:** `AppRootView`가 `ConsoleStore`와 연결(fetch+SSE+백오프)을 소유하고 대시보드↔오피스 탭을 전환한다. 두 탭이 같은 store를 관측한다. 오피스는 SwiftUI `SpriteView`로 `OfficeScene`(SKScene)을 호스팅하고, 배치·diff·색 계산은 순수 함수로 `ConsoleCore`에 두어 실행형 러너로 테스트한다.

**Tech Stack:** Swift 6 / SwiftPM · SwiftUI · SpriteKit(SKScene/SpriteView) · Combine(ObservableObject) · 실행형 테스트 러너(`swift run ConsoleCoreTests`).

## Global Constraints

- Swift 앱에 LLM 로직 없음. 콘솔은 읽기·알림 전용, 외부 부작용 0.
- 데이터는 기존 `ConsoleStore`(스냅샷+SSE) 재사용. 새 네트워크 경로 금지.
- 빌드·검증: `swift build`(clients/idaeri-console) + 실행형 러너 `swift run ConsoleCoreTests`. 이 환경은 CLT만, `xcodebuild`·XCTest 없음. SpriteKit·GameplayKit은 macOS SDK에 포함돼 SwiftPM 링크 가능.
- 순수 계산(배치·diff·색 팔레트)은 `ConsoleCore`에 두어 테스트. SpriteKit 의존 코드(`OfficeScene`·`skColor`·`OfficeView`)는 실행 타깃 `IdaeriConsole`에 둔다.
- Swift 네이밍: 축약 변수명 지양, 타입/함수 의미 있는 이름.
- 작업 경로: worktree `/Users/juneseok/worktrees/idaeri-office-phase3`, 브랜치 `feat/macos-console-phase3`. 모든 경로는 `clients/idaeri-console/` 기준.

## 태스크별 TDD 여부

| Task | 성격 | 검증 |
|---|---|---|
| T1 SpriteKit 렌더 스파이크 게이트 | GUI 리스크 선해소 | `swift build` + `swift run` 수동(원 렌더 확인) |
| T2 officeLayout 순수 함수 | 순수 계산 | **TDD** (실행형 러너) |
| T3 officeNodeDiff 순수 함수 | 순수 계산 | **TDD** (실행형 러너) |
| T4 색 팔레트 + Theme 배선 | 순수 데이터 + SwiftUI/SKColor 참조 | **TDD**(팔레트) + `swift build`(Theme) |
| T5 OfficeScene 본구현 | SpriteKit 노드 | `swift build` + 수동 |
| T6 AppRootView + DashboardView 리팩토링 | 뷰 구조 | `swift build` + 수동(탭 전환) |
| T7 OfficeView 배선 + main 교체 | 통합 | `swift build` + 전체 `swift run` 수동 |

---

## Task 1: SpriteKit 렌더 스파이크 게이트 (최대 리스크 선해소)

CLT 전용 환경에서 `SpriteView`가 실제로 창에 렌더링되는지 먼저 확인한다. 이후 태스크는 이 게이트 통과가 전제다.

**Files:**
- Create: `Sources/IdaeriConsole/OfficeScene.swift` (최소 — 원 1개)
- Create: `Sources/IdaeriConsole/OfficeView.swift` (최소 — SpriteView)
- Modify: `Sources/IdaeriConsole/main.swift` (임시로 OfficeView 를 rootView 로; T7 에서 AppRootView 로 교체)

**Interfaces:**
- Produces: `final class OfficeScene: SKScene`, `struct OfficeView: View`

- [ ] **Step 1: 최소 OfficeScene 작성**

```swift
import SpriteKit

/// SpriteKit 렌더 스파이크용 최소 씬. 배경 + 중앙 원 하나.
/// T5 에서 에이전트 노드 관리로 확장된다.
final class OfficeScene: SKScene {
    override func didMove(to view: SKView) {
        backgroundColor = SKColor(white: 0.12, alpha: 1)
        let circle = SKShapeNode(circleOfRadius: 40)
        circle.fillColor = SKColor(red: 0.36, green: 0.78, blue: 0.63, alpha: 1)
        circle.position = CGPoint(x: size.width / 2, y: size.height / 2)
        addChild(circle)
    }
}
```

- [ ] **Step 2: 최소 OfficeView 작성**

```swift
import SpriteKit
import SwiftUI

/// SpriteView 로 OfficeScene 을 호스팅. T7 에서 store 배선이 추가된다.
struct OfficeView: View {
    @State private var scene: OfficeScene = {
        let scene = OfficeScene(size: CGSize(width: 900, height: 600))
        scene.scaleMode = .resizeFill
        return scene
    }()

    var body: some View {
        SpriteView(scene: scene)
            .frame(minWidth: 640, minHeight: 480)
    }
}
```

- [ ] **Step 3: main.swift 를 임시로 OfficeView 로**

`Sources/IdaeriConsole/main.swift` 의 `window.contentView` 줄을 임시 교체(다른 줄은 그대로):

```swift
window.contentView = NSHostingView(rootView: OfficeView())
```

- [ ] **Step 4: 빌드**

Run: `cd clients/idaeri-console && swift build`
Expected: 성공(에러·경고 0). `no such module 'SpriteKit'` 이 나오면 CLT SDK 에 SpriteKit 링크 불가 → **여기서 멈추고 사용자에게 에스컬레이션.**

- [ ] **Step 5: 렌더 확인(수동 게이트)**

Run: `swift run IdaeriConsole`
Expected: 창 중앙에 민트색 원이 보인다. **보이면 통과. 창은 뜨는데 원이 안 보이면**(SpriteView 미지원) `OfficeView` 의 `SpriteView(scene:)` 를 `SKView` + `NSViewRepresentable` 폴백으로 교체:

```swift
import SpriteKit
import SwiftUI

struct OfficeView: NSViewRepresentable {
    func makeNSView(context: Context) -> SKView {
        let view = SKView()
        let scene = OfficeScene(size: CGSize(width: 900, height: 600))
        scene.scaleMode = .resizeFill
        view.presentScene(scene)
        return view
    }
    func updateNSView(_ nsView: SKView, context: Context) {}
}
```

폴백도 원이 안 보이면 **멈추고 사용자에게 "CLT 로는 SpriteKit 렌더 불가, Xcode 필요" 에스컬레이션.**

- [ ] **Step 6: Commit**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift clients/idaeri-console/Sources/IdaeriConsole/main.swift
git commit -m "feat(console-app): SpriteKit 렌더 스파이크 — 오피스 씬 원 하나"
```

---

## Task 2: officeLayout 격자 배치 순수 함수

**Files:**
- Create: `Sources/ConsoleCore/OfficeLayout.swift`
- Test: `Sources/ConsoleCoreTests/OfficeLayoutTests.swift`
- Modify: `Sources/ConsoleCoreTests/main.swift` (스위트 등록)

**Interfaces:**
- Produces:
  - `struct OfficePoint: Equatable { let x: Double; let y: Double }`
  - `func officeLayout(count: Int, width: Double, height: Double, columns: Int) -> [OfficePoint]`

- [ ] **Step 1: 실패 테스트 작성** — `Sources/ConsoleCoreTests/OfficeLayoutTests.swift`

```swift
import Foundation

@testable import ConsoleCore

func runOfficeLayoutTests(_ t: TestRunner) {
    t.suite("OfficeLayout")

    // count 개수만큼 좌표 반환
    let points = officeLayout(count: 26, width: 900, height: 600, columns: 5)
    t.expectEqual(points.count, 26, "좌표 개수 == count")

    // 모든 좌표가 씬 경계 안(0 < x < width, 0 < y < height)
    let allInside = points.allSatisfy { $0.x > 0 && $0.x < 900 && $0.y > 0 && $0.y < 600 }
    t.expect(allInside, "모든 좌표가 경계 안")

    // 첫 행 좌표는 서로 x 가 다름(격자 열 분리)
    let firstRowX = Set(points.prefix(5).map { $0.x })
    t.expectEqual(firstRowX.count, 5, "첫 행 5개 열이 서로 다른 x")

    // count 0 이면 빈 배열
    t.expectEqual(officeLayout(count: 0, width: 900, height: 600, columns: 5).count, 0, "count 0 → 빈 배열")

    // columns 가 count 보다 크면 한 행에 count 개
    let few = officeLayout(count: 3, width: 900, height: 600, columns: 5)
    let sameRowY = Set(few.map { $0.y })
    t.expectEqual(sameRowY.count, 1, "count < columns 이면 한 행")
}
```

- [ ] **Step 2: main.swift 에 스위트 등록** — `Sources/ConsoleCoreTests/main.swift`

```swift
runModelsTests(runner)
runConsoleStoreTests(runner)
runSSEParserTests(runner)
runOfficeLayoutTests(runner)

runner.finish()
```

- [ ] **Step 3: 실패 확인**

Run: `cd clients/idaeri-console && swift build --target ConsoleCoreTests`
Expected: FAIL — `cannot find 'officeLayout' in scope`.

- [ ] **Step 4: 구현 작성** — `Sources/ConsoleCore/OfficeLayout.swift`

```swift
import Foundation

/// 오피스 씬 내 배치 좌표(SpriteKit 비의존, 순수 값).
public struct OfficePoint: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// `count` 개를 `width`×`height` 씬에 위→아래·왼→오 격자로 배치한 중심 좌표.
/// 좌표계는 SpriteKit 기본(원점 좌하단, y 위로 증가)에 맞춘다.
public func officeLayout(
    count: Int,
    width: Double,
    height: Double,
    columns: Int
) -> [OfficePoint] {
    guard count > 0, columns > 0, width > 0, height > 0 else {
        return []
    }
    let effectiveColumns = min(columns, count)
    let rows = Int((Double(count) / Double(effectiveColumns)).rounded(.up))
    let cellWidth = width / Double(effectiveColumns)
    let cellHeight = height / Double(max(rows, 1))
    var points: [OfficePoint] = []
    for index in 0..<count {
        let column = index % effectiveColumns
        let row = index / effectiveColumns
        let x = cellWidth * (Double(column) + 0.5)
        let y = height - cellHeight * (Double(row) + 0.5)
        points.append(OfficePoint(x: x, y: y))
    }
    return points
}
```

- [ ] **Step 5: 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과` (기존 49건 + 신규 5건).

- [ ] **Step 6: Commit**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/OfficeLayout.swift clients/idaeri-console/Sources/ConsoleCoreTests/OfficeLayoutTests.swift clients/idaeri-console/Sources/ConsoleCoreTests/main.swift
git commit -m "feat(console-app): officeLayout 격자 배치 순수 함수"
```

---

## Task 3: officeNodeDiff 노드 동기화 diff 순수 함수

**Files:**
- Modify: `Sources/ConsoleCore/OfficeLayout.swift` (추가)
- Modify: `Sources/ConsoleCoreTests/OfficeLayoutTests.swift` (추가)

**Interfaces:**
- Produces:
  - `struct OfficeNodeDiff: Equatable { let added: [String]; let removed: [String] }`
  - `func officeNodeDiff(existing: Set<String>, incoming: [String]) -> OfficeNodeDiff`

- [ ] **Step 1: 실패 테스트 추가** — `OfficeLayoutTests.swift` 의 `runOfficeLayoutTests` 끝에 추가

```swift
    // diff: 신규 추가, 사라진 것 제거, 공통 유지
    let diff = officeNodeDiff(existing: ["PM", "BE"], incoming: ["BE", "CTO"])
    t.expectEqual(diff.added, ["CTO"], "신규는 added")
    t.expectEqual(diff.removed, ["PM"], "사라진 건 removed")

    // 변화 없으면 빈 diff
    let noChange = officeNodeDiff(existing: ["PM"], incoming: ["PM"])
    t.expect(noChange.added.isEmpty && noChange.removed.isEmpty, "변화 없으면 빈 diff")
```

- [ ] **Step 2: 실패 확인**

Run: `swift build --target ConsoleCoreTests`
Expected: FAIL — `cannot find 'officeNodeDiff' in scope`.

- [ ] **Step 3: 구현 추가** — `OfficeLayout.swift` 끝에 추가

```swift
/// 오피스 노드 동기화 diff. 현재 노드 집합과 새 목록을 비교한다.
public struct OfficeNodeDiff: Equatable, Sendable {
    public let added: [String]
    public let removed: [String]
    public init(added: [String], removed: [String]) {
        self.added = added
        self.removed = removed
    }
}

/// `existing` 에 없는 `incoming` 은 추가, `incoming` 에 없는 `existing` 은 제거 대상.
/// `added` 는 incoming 순서 보존, `removed` 는 결정론적 정렬.
public func officeNodeDiff(existing: Set<String>, incoming: [String]) -> OfficeNodeDiff {
    let incomingSet = Set(incoming)
    let added = incoming.filter { !existing.contains($0) }
    let removed = existing.subtracting(incomingSet).sorted()
    return OfficeNodeDiff(added: added, removed: removed)
}
```

- [ ] **Step 4: 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과`.

- [ ] **Step 5: Commit**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/OfficeLayout.swift clients/idaeri-console/Sources/ConsoleCoreTests/OfficeLayoutTests.swift
git commit -m "feat(console-app): officeNodeDiff 노드 동기화 순수 함수"
```

---

## Task 4: 상태 색 팔레트(코어) + Theme 배선

색 정의를 `ConsoleCore` 의 RGBA 순수 함수로 단일화하고, `Theme.swift` 의 `accentColor`(SwiftUI)와 신규 `skColor`(SKColor)가 이를 참조한다. Phase 1 색 값과 동일하게 유지한다.

**Files:**
- Modify: `Sources/ConsoleCore/OfficeLayout.swift` (팔레트 함수 추가)
- Modify: `Sources/ConsoleCoreTests/OfficeLayoutTests.swift` (팔레트 테스트)
- Modify: `Sources/IdaeriConsole/Theme.swift` (accentColor 를 팔레트 참조로, skColor 추가)

**Interfaces:**
- Consumes: `ConsoleAgentState`
- Produces:
  - `func agentStatePaletteRGBA(_ state: ConsoleAgentState) -> (red: Double, green: Double, blue: Double)`
  - `ConsoleAgentState.skColor: SKColor` (IdaeriConsole)

- [ ] **Step 1: 실패 테스트 추가** — `OfficeLayoutTests.swift` 끝에 추가

```swift
    // 팔레트: 상태 5종 모두 0~1 범위 RGB, 서로 다른 색
    var seenColors = Set<String>()
    for state in [ConsoleAgentState.completed, .inProgress, .awaitingApproval, .awaitingIntegration, .waiting] {
        let rgb = agentStatePaletteRGBA(state)
        let inRange = (0...1).contains(rgb.red) && (0...1).contains(rgb.green) && (0...1).contains(rgb.blue)
        t.expect(inRange, "\(state) RGB 는 0~1 범위")
        seenColors.insert("\(rgb.red),\(rgb.green),\(rgb.blue)")
    }
    t.expectEqual(seenColors.count, 5, "5종 색이 서로 다름")
```

- [ ] **Step 2: 실패 확인**

Run: `swift build --target ConsoleCoreTests`
Expected: FAIL — `cannot find 'agentStatePaletteRGBA' in scope`.

- [ ] **Step 3: 팔레트 구현** — `OfficeLayout.swift` 끝에 추가

```swift
/// 상태 5종의 표시 색(0~1 RGB). Notion 심화편 팔레트. SwiftUI Color·SKColor 가 공통으로 참조한다.
public func agentStatePaletteRGBA(
    _ state: ConsoleAgentState
) -> (red: Double, green: Double, blue: Double) {
    switch state {
    case .completed:
        return (0.36, 0.78, 0.63)  // 민트
    case .inProgress:
        return (0.96, 0.78, 0.25)  // 노랑
    case .awaitingApproval:
        return (0.91, 0.36, 0.60)  // 진한 핑크
    case .awaitingIntegration:
        return (0.62, 0.55, 0.90)  // 라벤더
    case .waiting:
        return (0.72, 0.72, 0.72)  // 흰색 계열
    }
}
```

- [ ] **Step 4: 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과`.

- [ ] **Step 5: Theme.swift 배선** — `accentColor` 를 팔레트 참조로 교체하고 `skColor` 추가. 파일 상단에 `import SpriteKit` 추가. `accentColor` 본문 교체:

```swift
    var accentColor: Color {
        let rgb = agentStatePaletteRGBA(self)
        return Color(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }

    /// SpriteKit 노드용 색(accentColor 와 같은 팔레트).
    var skColor: SKColor {
        let rgb = agentStatePaletteRGBA(self)
        return SKColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
    }
```

`tintColor`·`label` 은 그대로 둔다.

- [ ] **Step 6: 빌드 확인**

Run: `swift build`
Expected: 성공(에러·경고 0). 대시보드 카드 색은 팔레트 참조로 바뀌었지만 값이 같아 시각 변화 없음.

- [ ] **Step 7: Commit**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/OfficeLayout.swift clients/idaeri-console/Sources/ConsoleCoreTests/OfficeLayoutTests.swift clients/idaeri-console/Sources/IdaeriConsole/Theme.swift
git commit -m "feat(console-app): 상태 색 팔레트 코어 단일화 + skColor"
```

---

## Task 5: OfficeScene 본구현 (노드 생성·sync)

T1 의 최소 씬을 에이전트 노드 관리로 확장한다. `officeLayout`·`officeNodeDiff`·`skColor` 를 사용한다.

**Files:**
- Modify: `Sources/IdaeriConsole/OfficeScene.swift` (전면 교체)

**Interfaces:**
- Consumes: `ConsoleAgent`(ConsoleCore), `officeLayout`, `officeNodeDiff`, `ConsoleAgentState.skColor`
- Produces: `OfficeScene.sync(agents: [ConsoleAgent])`

- [ ] **Step 1: OfficeScene 교체 구현**

```swift
import ConsoleCore
import SpriteKit

/// 에이전트를 상태색 원 + 이름 라벨로 격자 배치하는 씬.
/// sync(agents:) 로 store 상태를 반영한다 — 신규 추가·사라진 것 제거·남은 것 색 갱신.
final class OfficeScene: SKScene {
    private var agentNodes: [String: SKShapeNode] = [:]
    private let columns = 5

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(white: 0.12, alpha: 1)
    }

    func sync(agents: [ConsoleAgent]) {
        let incoming = agents.map { $0.agentType }
        let diff = officeNodeDiff(existing: Set(agentNodes.keys), incoming: incoming)

        for agentType in diff.removed {
            agentNodes[agentType]?.removeFromParent()
            agentNodes[agentType] = nil
        }

        let positions = officeLayout(
            count: agents.count,
            width: Double(size.width),
            height: Double(size.height),
            columns: columns
        )

        for (index, agent) in agents.enumerated() {
            let node = agentNodes[agent.agentType] ?? makeNode(for: agent)
            if agentNodes[agent.agentType] == nil {
                agentNodes[agent.agentType] = node
                addChild(node)
            }
            if index < positions.count {
                let point = positions[index]
                node.position = CGPoint(x: point.x, y: point.y)
            }
            node.fillColor = agent.state.skColor
        }
    }

    private func makeNode(for agent: ConsoleAgent) -> SKShapeNode {
        let node = SKShapeNode(circleOfRadius: 26)
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

Run: `swift build`
Expected: 성공(에러·경고 0).

- [ ] **Step 3: 렌더 확인(수동)** — T1 에서 main 이 임시로 `OfficeView()` 를 띄우므로, 지금은 store 배선 전이라 빈 씬(어두운 배경)만 확인.

Run: `swift run IdaeriConsole`
Expected: 어두운 배경 창(노드는 T7 배선 후 표시). 크래시 없이 뜨면 통과.

- [ ] **Step 4: Commit**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git commit -m "feat(console-app): OfficeScene 노드 생성·sync 구현"
```

---

## Task 6: AppRootView + DashboardView 리팩토링 (탭 전환)

연결 로직을 `AppRootView` 로 끌어올리고 `DashboardView` 는 store·status 를 주입받도록 바꾼다. `ConsoleAgent` 에 `Equatable` 을 추가해 `onChange` 관측을 가능케 한다(T7 에서 사용).

**Files:**
- Modify: `Sources/ConsoleCore/Models.swift` (`ConsoleAgent: Equatable`)
- Create: `Sources/IdaeriConsole/AppRootView.swift`
- Modify: `Sources/IdaeriConsole/DashboardView.swift` (store·status 주입, connect 제거)

**Interfaces:**
- Consumes: `ConsoleStore`, `ConsoleClient`, `ConnectionStatus`(DashboardView.swift 에 기존 정의), `OfficeView`(T1)
- Produces: `struct AppRootView: View`, 변경된 `DashboardView(store:status:baseURLLabel:)`

- [ ] **Step 1: ConsoleAgent 에 Equatable 추가** — `Sources/ConsoleCore/Models.swift` 의 선언 변경

```swift
public struct ConsoleAgent: Codable, Identifiable, Equatable, Sendable {
```

(나머지 본문 동일. `ConsoleAgentState`·`String`·`[String]` 모두 Equatable 이라 자동 합성됨.)

- [ ] **Step 2: 빌드로 합성 확인**

Run: `swift build`
Expected: 성공.

- [ ] **Step 3: DashboardView 를 주입형으로 변경** — 프로퍼티·`.task`·`connect()` 제거. 상단 선언부를 교체:

```swift
struct DashboardView: View {
    @ObservedObject var store: ConsoleStore
    let status: ConnectionStatus
    let baseURLLabel: String

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: 14)]

    var body: some View {
        ScrollView {
            // ... 기존 본문 그대로 ...
        }
        .frame(minWidth: 720, minHeight: 520)
    }
```

즉 기존 `@StateObject private var store`, `@State private var status`, `.task { await connect() }`, `private func connect()` 를 **삭제**한다. 본문(header·grid·approvalPanel·emptyState·파생 계산)은 그대로 둔다. `connectionIndicator` 는 주입된 `status` 를 그대로 참조하므로 수정 불필요.

- [ ] **Step 4: AppRootView 작성** — `Sources/IdaeriConsole/AppRootView.swift`

```swift
import ConsoleCore
import SwiftUI

/// 콘솔 루트. ConsoleStore 와 연결(스냅샷+SSE+백오프)을 소유하고,
/// 대시보드↔오피스 탭을 전환한다. 두 탭이 같은 store 를 관측한다.
struct AppRootView: View {
    let client: ConsoleClient
    let baseURLLabel: String

    @StateObject private var store = ConsoleStore()
    @State private var status: ConnectionStatus = .connecting
    @State private var tab: Tab = .dashboard

    private enum Tab: Hashable {
        case dashboard
        case office
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("보기", selection: $tab) {
                    Text("대시보드").tag(Tab.dashboard)
                    Text("오피스").tag(Tab.office)
                }
                .pickerStyle(.segmented)
                .frame(width: 240)
                Spacer()
            }
            .padding(10)

            Divider()

            switch tab {
            case .dashboard:
                DashboardView(store: store, status: status, baseURLLabel: baseURLLabel)
            case .office:
                OfficeView(store: store)
            }
        }
        .frame(minWidth: 720, minHeight: 560)
        .task {
            await connect()
        }
    }

    private func connect() async {
        var backoffSeconds: UInt64 = 1
        while !Task.isCancelled {
            do {
                let snapshot = try await client.fetchSnapshot()
                store.apply(snapshot: snapshot)
                status = .live
                backoffSeconds = 1
                for await event in await client.events() {
                    store.apply(event: event)
                }
            } catch {
                // 아래 백오프 후 재시도
            }
            if Task.isCancelled {
                return
            }
            status = .reconnecting
            try? await Task.sleep(nanoseconds: backoffSeconds * 1_000_000_000)
            backoffSeconds = min(backoffSeconds * 2, 30)
        }
    }
}
```

(참고: `OfficeView(store:)` 는 T7 에서 store 를 받도록 바뀐다. 이 태스크 빌드 시점엔 T1 의 인자 없는 `OfficeView()` 라 컴파일 에러가 난다 → T7 에서 해소. 따라서 이 태스크는 Step 5 에서 `OfficeView(store: store)` 를 임시로 `OfficeView()` 로 두거나, T7 과 함께 빌드한다. 아래 Step 5 참조.)

- [ ] **Step 5: 임시 컴파일 통과 처리** — T7 전까지 빌드가 깨지지 않도록, 이 태스크에서는 `AppRootView` 의 office 케이스를 임시로 다음과 같이 둔다:

```swift
            case .office:
                OfficeView()
```

`main.swift` 는 아직 교체하지 않는다(T7). 이 태스크의 빌드 확인은 `AppRootView`·`DashboardView` 컴파일만 본다.

- [ ] **Step 6: 빌드 확인**

Run: `swift build`
Expected: 성공. (`main.swift` 는 여전히 T1 의 임시 `OfficeView()` 를 띄우는 상태 — 무방.)

- [ ] **Step 7: Commit**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/Models.swift clients/idaeri-console/Sources/IdaeriConsole/AppRootView.swift clients/idaeri-console/Sources/IdaeriConsole/DashboardView.swift
git commit -m "feat(console-app): AppRootView 탭 전환 + DashboardView 주입형 리팩토링"
```

---

## Task 7: OfficeView 배선 + main 교체 (통합·전체 스파이크)

`OfficeView` 가 store 를 관측해 `OfficeScene.sync` 를 호출하도록 완성하고, `main.swift` 를 `AppRootView` 로 교체한다.

**Files:**
- Modify: `Sources/IdaeriConsole/OfficeView.swift` (store 배선)
- Modify: `Sources/IdaeriConsole/AppRootView.swift` (office 케이스를 `OfficeView(store: store)` 로 되돌림)
- Modify: `Sources/IdaeriConsole/main.swift` (AppRootView 로 교체)

**Interfaces:**
- Consumes: `ConsoleStore`, `OfficeScene.sync`
- Produces: `struct OfficeView: View`(store 주입형)

- [ ] **Step 1: OfficeView 완성 교체**

```swift
import ConsoleCore
import SpriteKit
import SwiftUI

/// 오피스 탭. store.agents 변화를 OfficeScene 에 반영한다.
struct OfficeView: View {
    @ObservedObject var store: ConsoleStore

    @State private var scene: OfficeScene = {
        let scene = OfficeScene(size: CGSize(width: 900, height: 600))
        scene.scaleMode = .resizeFill
        return scene
    }()

    var body: some View {
        SpriteView(scene: scene)
            .frame(minWidth: 640, minHeight: 480)
            .onAppear {
                scene.sync(agents: store.agents)
            }
            .onChange(of: store.agents) { newAgents in
                scene.sync(agents: newAgents)
            }
    }
}
```

(T1 Step 5 에서 SKView 폴백을 썼다면, `SpriteView(scene:)` 대신 그 `NSViewRepresentable` 이 scene 을 보유하도록 맞추고 `onChange` 를 Coordinator 로 전달한다. 폴백을 안 썼으면 위 그대로.)

- [ ] **Step 2: AppRootView office 케이스 복원** — `AppRootView.swift` 의 `case .office:` 를 되돌린다:

```swift
            case .office:
                OfficeView(store: store)
```

- [ ] **Step 3: main.swift 를 AppRootView 로 교체** — `window.contentView` 줄:

```swift
window.contentView = NSHostingView(
    rootView: AppRootView(client: client, baseURLLabel: baseURLString)
)
```

- [ ] **Step 4: 빌드**

Run: `swift build`
Expected: 성공(에러·경고 0).

- [ ] **Step 5: 전체 테스트**

Run: `swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과`.

- [ ] **Step 6: 통합 렌더 확인(수동)** — 콘솔 백엔드가 3099 에 떠 있는 상태(`pnpm dev` 또는 별도 기동)에서:

Run: `IDAERI_CONSOLE_URL=http://127.0.0.1:3099 swift run IdaeriConsole`
Expected:
- 상단 "대시보드 / 오피스" 세그먼트 전환 동작
- 오피스 탭에 에이전트 원 26개가 격자로, 상태색(대기=회색)으로 배치
- 백엔드 상태 변화 시 원 색이 실시간 갱신
정직히: 자동 검증 아님, 사용자 눈 확인.

- [ ] **Step 7: Commit**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift clients/idaeri-console/Sources/IdaeriConsole/AppRootView.swift clients/idaeri-console/Sources/IdaeriConsole/main.swift
git commit -m "feat(console-app): 오피스 탭 배선 완성 + AppRootView 루트 교체"
```

---

## Self-Review

**Spec coverage:**
- 오피스 탭 추가 + 대시보드 공유 store → T6(AppRootView)·T7(배선) ✅
- SpriteKit SpriteView 임베드 + 폴백 → T1(게이트, SKView 폴백 명시) ✅
- 에이전트 = 상태색 원 + 이름 라벨, 격자 배치 → T5(OfficeScene) + T2(layout) ✅
- 상태색 실시간 갱신(SSE) → T7(onChange→sync) + T4(skColor) ✅
- officeLayout·nodeDiff·색 매핑 테스트 → T2·T3·T4 (실행형 러너) ✅
- CLT SpriteKit 렌더 리스크 게이트 → T1 Step5 ✅
- 범위 밖(이동/연출/지시창/스프라이트) → 계획에 태스크 없음(의도적) ✅

**Placeholder scan:** 코드 스텝은 실제 코드 포함. T1/T5/T6/T7 의 수동 확인은 GUI·SpriteKit 특성상 자동 불가 지점으로 명시(placeholder 아님).

**Type consistency:** `officeLayout(count:width:height:columns:)`·`officeNodeDiff(existing:incoming:)`·`agentStatePaletteRGBA(_:)`·`OfficeScene.sync(agents:)`·`DashboardView(store:status:baseURLLabel:)`·`OfficeView(store:)`·`AppRootView(client:baseURLLabel:)` — T2~T7 에서 동일 시그니처 사용. `ConsoleAgent: Equatable`(T6) 이 T7 `onChange(of: store.agents)` 의 전제. `ConnectionStatus` 는 DashboardView.swift 기존 정의 재사용(신규 정의 안 함).

## 알려진 미결 (구현 중 확정)
- T1 Step5: SpriteView vs SKView 폴백 — 실행 시점 판정. 둘 다 실패 시 Xcode 필요 에스컬레이션.
- T7 Step1: 폴백을 쓴 경우 onChange→scene 전달을 Coordinator 로 조정(구현 시점 분기 명시).
