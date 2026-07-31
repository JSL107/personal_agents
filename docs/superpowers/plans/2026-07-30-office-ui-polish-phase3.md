# 오피스 UI/UX 개선 Phase 3 (C, 레이아웃·대표실) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 superpowers:executing-plans 로 태스크 단위 구현. Steps 는 checkbox(`- [ ]`).

**Goal:** 평평한 5열 격자를 부서별 "방"으로 그룹핑하고, 상단 대표실 밴드에 상시 "나(대표)" 노드 + 전사 요약(진행 N·승인 M·대기 K)을 둔다.

**Architecture:** 방 배치 좌표·전사 집계는 ConsoleCore 순수함수로 TDD. 방 배경·라벨·대표 노드·요약 HUD 렌더는 IdaeriConsole(OfficeScene), `swift build` + 앱 스모크로 검증. 기존 집결(summonToBand)·연출은 유지.

**Tech Stack:** Swift 5.9, SpriteKit, ConsoleCore 실행형 러너(`swift run ConsoleCoreTests`).

## Global Constraints

- **패키지 경로**: 모든 `swift` 명령은 `clients/idaeri-console/` 에서.
- **검증 게이트**: `swift build`(exit 0) + `swift run ConsoleCoreTests`(exit 0, "✅ 모든 검증 통과"). 백엔드 파일 미변경 → pnpm 게이트 범위 밖.
- **베이스라인**: 시작 전 두 게이트 green(Phase 2 커밋 상태 = 196건 green 확인됨).
- **순수/표현 경계**: 방 배치·집계는 ConsoleCore. SpriteKit 렌더는 IdaeriConsole.
- **새 백엔드 API 금지**: 오는 데이터(agents)만.
- **커밋 주체**: 메인 세션(codex sandbox 는 `.git` 접근 불가).
- **IdaeriConsole 테스트 불가**: `ConsoleCoreTests` 는 `ConsoleCore` 만 링크. SpriteKit 은 build + 앱 스모크(사람 체크포인트).
- **회귀 금지**: Phase 1·2 기능(토큰·모션·hover·선택·말풍선·경과·배지)과 기존 연출(집결·핸드오프·거절)은 유지. 특히 `homePositions` 는 계속 각 노드의 "집" 좌표를 담아야 집결·복귀가 동작한다.

---

## 파일 구조

**신규:**
- `clients/idaeri-console/Sources/ConsoleCore/OfficeRoomLayout.swift` — 부서 방 배치 + 전사 집계(순수).
- `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeRoomLayoutTests.swift` — 테스트.

**수정:**
- `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift` — `runOfficeRoomLayoutTests` 등록.
- `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift` — sync 를 방 배치로, 방 배경·라벨 렌더, 대표 노드·요약 HUD, 리사이즈 재배치.

---

## Task 1: 부서 방 배치 + 전사 집계 (ConsoleCore, TDD)

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCore/OfficeRoomLayout.swift`
- Test: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeRoomLayoutTests.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift`

**Interfaces:**
- Produces:
  - `struct OfficeRect: Equatable, Sendable { let x, y, width, height: Double }` (x,y = 좌하단, y-up)
  - `struct OfficeRoom: Equatable, Sendable { let department: Department; let rect: OfficeRect; let labelPoint: OfficePoint }`
  - `struct DepartmentLayout: Equatable, Sendable { let rooms: [OfficeRoom]; let positions: [String: OfficePoint] }`
  - `func departmentRoomLayout(agents: [ConsoleAgent], width: Double, height: Double, bandHeight: Double, roomColumns: Int = 3, agentColumns: Int = 3) -> DepartmentLayout`
  - `struct CompanySummary: Equatable, Sendable { let inProgress, awaitingApproval, waiting, completed, awaitingIntegration: Int }`
  - `func companySummary(agents: [ConsoleAgent]) -> CompanySummary`

- [ ] **Step 1: 실패하는 테스트 작성**

`clients/idaeri-console/Sources/ConsoleCoreTests/OfficeRoomLayoutTests.swift` 생성:

```swift
import Foundation

@testable import ConsoleCore

private func roomAgent(_ type: String, _ state: ConsoleAgentState = .waiting) -> ConsoleAgent {
    ConsoleAgent(
        agentType: type, displayName: type, slashCommands: [],
        description: "", state: state, bubble: ""
    )
}

func runOfficeRoomLayoutTests(_ t: TestRunner) {
    t.suite("OfficeRoomLayout")

    // 6부서 대표 집합
    let agents = [
        roomAgent("PM"), roomAgent("PO_SHADOW"),          // 기획
        roomAgent("BE"), roomAgent("BE_TEST"),            // 개발
        roomAgent("CODE_REVIEWER"),                       // 리뷰
        roomAgent("CTO"), roomAgent("CEO"),               // 경영
        roomAgent("BLOG"),                                // 성장
        roomAgent("HUMANIZER"), roomAgent("OPS_SUPERVISOR"), // 내부
    ]
    let width = 900.0
    let height = 600.0
    let band = 120.0
    let layout = departmentRoomLayout(agents: agents, width: width, height: height, bandHeight: band)

    // 방 개수 = 등장 부서 수(6)
    t.expectEqual(layout.rooms.count, 6, "방 개수 == 등장 부서 수")

    // 모든 에이전트가 좌표를 가진다
    t.expectEqual(layout.positions.count, agents.count, "모든 에이전트 배치")

    // 각 에이전트는 자기 부서 방 rect 안
    for agent in agents {
        let dept = department(for: agent.agentType)
        guard
            let room = layout.rooms.first(where: { $0.department == dept }),
            let point = layout.positions[agent.agentType]
        else {
            t.fail("\(agent.agentType) 방/좌표 누락")
            continue
        }
        let inside = point.x >= room.rect.x && point.x <= room.rect.x + room.rect.width
            && point.y >= room.rect.y && point.y <= room.rect.y + room.rect.height
        t.expect(inside, "\(agent.agentType) 좌표가 자기 방 안")
    }

    // 모든 좌표가 밴드 아래(격자 영역) — y < height - band
    t.expect(layout.positions.values.allSatisfy { $0.y < height - band }, "모든 좌표가 밴드 아래")
    t.expect(layout.positions.values.allSatisfy { $0.y > 0 }, "모든 좌표 y > 0")

    // 방끼리 겹치지 않음(모든 rect 쌍이 분리)
    var overlap = false
    for i in 0..<layout.rooms.count {
        for j in (i + 1)..<layout.rooms.count {
            let a = layout.rooms[i].rect
            let b = layout.rooms[j].rect
            let separated = a.x + a.width <= b.x || b.x + b.width <= a.x
                || a.y + a.height <= b.y || b.y + b.height <= a.y
            if !separated {
                overlap = true
            }
        }
    }
    t.expect(!overlap, "방 rect 끼리 겹치지 않음")

    // 방은 canonical 순서(기획→개발→리뷰→경영→성장→내부)
    t.expectEqual(
        layout.rooms.map { $0.department },
        [.planning, .engineering, .review, .executive, .growth, .internalOps],
        "방 순서 canonical"
    )

    // 빈 입력·비정상 크기 방어
    t.expectEqual(departmentRoomLayout(agents: [], width: width, height: height, bandHeight: band).rooms.count, 0, "빈 입력 → 방 0")
    t.expectEqual(departmentRoomLayout(agents: agents, width: 0, height: height, bandHeight: band).positions.count, 0, "width 0 → 좌표 0")

    // 전사 집계
    let mixed = [
        roomAgent("PM", .inProgress), roomAgent("BE", .inProgress),
        roomAgent("CTO", .awaitingApproval),
        roomAgent("CEO", .waiting), roomAgent("BLOG", .waiting), roomAgent("HUMANIZER", .waiting),
        roomAgent("BE_TEST", .completed),
    ]
    let summary = companySummary(agents: mixed)
    t.expectEqual(summary.inProgress, 2, "진행 2")
    t.expectEqual(summary.awaitingApproval, 1, "승인 1")
    t.expectEqual(summary.waiting, 3, "대기 3")
    t.expectEqual(summary.completed, 1, "완료 1")
    t.expectEqual(companySummary(agents: []).waiting, 0, "빈 입력 집계 0")
}
```

`main.swift` 에 등록 추가(`runAgentTokenInfoTests(runner)` 아래):

```swift
runAgentTokenInfoTests(runner)
runOfficeRoomLayoutTests(runner)
runConsoleClientTests(runner)
```

- [ ] **Step 2: 빌드 실패 확인**

Run: `swift build`
Expected: FAIL — `cannot find 'departmentRoomLayout'/'companySummary'/'OfficeRoom'/'OfficeRect'/'DepartmentLayout'/'CompanySummary' in scope`.

- [ ] **Step 3: 최소 구현 작성**

`clients/idaeri-console/Sources/ConsoleCore/OfficeRoomLayout.swift` 생성:

```swift
import Foundation

/// 방 사각형(순수 값). (x, y) = 좌하단, y 는 위로 증가(SpriteKit 좌표계).
public struct OfficeRect: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

/// 한 부서의 방(사각형 + 라벨 위치).
public struct OfficeRoom: Equatable, Sendable {
    public let department: Department
    public let rect: OfficeRect
    public let labelPoint: OfficePoint
    public init(department: Department, rect: OfficeRect, labelPoint: OfficePoint) {
        self.department = department
        self.rect = rect
        self.labelPoint = labelPoint
    }
}

/// 부서 방 배치 결과 — 방 목록 + agentType → 중심 좌표.
public struct DepartmentLayout: Equatable, Sendable {
    public let rooms: [OfficeRoom]
    public let positions: [String: OfficePoint]
    public init(rooms: [OfficeRoom], positions: [String: OfficePoint]) {
        self.rooms = rooms
        self.positions = positions
    }
}

/// 부서 canonical 순서(방 배치·범례 공통).
private let departmentOrder: [Department] = [
    .planning, .engineering, .review, .executive, .growth, .internalOps,
]

/// 에이전트를 부서 방으로 그룹핑해 배치한다(순수). 상단 `bandHeight` 는 대표실로 비운다.
/// 방은 `roomColumns` 열 격자, 방 안 에이전트는 `agentColumns` 열 서브격자. 좌표는 방 라벨 아래에 배치.
public func departmentRoomLayout(
    agents: [ConsoleAgent],
    width: Double,
    height: Double,
    bandHeight: Double,
    roomColumns: Int = 3,
    agentColumns: Int = 3
) -> DepartmentLayout {
    guard width > 0, height > 0, !agents.isEmpty, roomColumns > 0, agentColumns > 0 else {
        return DepartmentLayout(rooms: [], positions: [:])
    }

    let present = departmentOrder.filter { dept in
        agents.contains { department(for: $0.agentType) == dept }
    }
    let gridHeight = max(height - max(bandHeight, 0), 1)
    let roomRows = Int((Double(present.count) / Double(roomColumns)).rounded(.up))
    let roomWidth = width / Double(roomColumns)
    let roomHeight = gridHeight / Double(max(roomRows, 1))
    let pad = 12.0
    let labelHeight = 22.0

    var rooms: [OfficeRoom] = []
    var positions: [String: OfficePoint] = [:]

    for (deptIndex, dept) in present.enumerated() {
        let roomColumn = deptIndex % roomColumns
        let roomRow = deptIndex / roomColumns
        let originX = Double(roomColumn) * roomWidth
        let topY = gridHeight - Double(roomRow) * roomHeight  // 방 상단 모서리(y-up)

        let rectX = originX + pad
        let rectY = topY - roomHeight + pad                    // 좌하단 y
        let rectWidth = roomWidth - 2 * pad
        let rectHeight = roomHeight - 2 * pad
        let rect = OfficeRect(x: rectX, y: rectY, width: rectWidth, height: rectHeight)
        let labelPoint = OfficePoint(x: rectX + 8, y: topY - pad - 8)
        rooms.append(OfficeRoom(department: dept, rect: rect, labelPoint: labelPoint))

        let deptAgents = agents.filter { department(for: $0.agentType) == dept }
        let rowCount = Int((Double(deptAgents.count) / Double(agentColumns)).rounded(.up))
        let cellWidth = rectWidth / Double(agentColumns)
        let usableHeight = rectHeight - labelHeight
        let cellHeight = usableHeight / Double(max(rowCount, 1))
        let areaTopY = rectY + rectHeight - labelHeight        // 라벨 아래 배치 시작 y

        for (agentIndex, agent) in deptAgents.enumerated() {
            let column = agentIndex % agentColumns
            let row = agentIndex / agentColumns
            let x = rectX + cellWidth * (Double(column) + 0.5)
            let y = areaTopY - cellHeight * (Double(row) + 0.5)
            positions[agent.agentType] = OfficePoint(x: x, y: y)
        }
    }

    return DepartmentLayout(rooms: rooms, positions: positions)
}

/// 상태별 전사 집계(순수).
public struct CompanySummary: Equatable, Sendable {
    public let inProgress: Int
    public let awaitingApproval: Int
    public let waiting: Int
    public let completed: Int
    public let awaitingIntegration: Int
    public init(
        inProgress: Int, awaitingApproval: Int, waiting: Int,
        completed: Int, awaitingIntegration: Int
    ) {
        self.inProgress = inProgress
        self.awaitingApproval = awaitingApproval
        self.waiting = waiting
        self.completed = completed
        self.awaitingIntegration = awaitingIntegration
    }
}

public func companySummary(agents: [ConsoleAgent]) -> CompanySummary {
    func count(_ state: ConsoleAgentState) -> Int {
        agents.filter { $0.state == state }.count
    }
    return CompanySummary(
        inProgress: count(.inProgress),
        awaitingApproval: count(.awaitingApproval),
        waiting: count(.waiting),
        completed: count(.completed),
        awaitingIntegration: count(.awaitingIntegration)
    )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: PASS — "✅ 모든 검증 통과 (N건)"(196 + OfficeRoomLayout 신규).

- [ ] **Step 5: 커밋** (메인 세션)

```bash
git -C <worktree> add "$CI/ConsoleCore/OfficeRoomLayout.swift" "$CI/ConsoleCoreTests/OfficeRoomLayoutTests.swift" "$CI/ConsoleCoreTests/main.swift"
git -C <worktree> commit -m "feat(console): 부서 방 배치 + 전사 집계 (ConsoleCore)"
```
(`$CI` = `clients/idaeri-console/Sources`)

---

## Task 2: 부서 방 배치·배경 적용 + 리사이즈 재배치 (IdaeriConsole)

`sync` 를 평평한 격자(officeLayout)에서 부서 방 배치(departmentRoomLayout)로 바꾸고, 방 배경·라벨을 그린다. 리사이즈 시 재배치.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift`

**Interfaces:**
- Consumes: `departmentRoomLayout(...)`, `OfficeRoom`, `Department.skColor/label`(Theme·ConsoleCore).
- Produces: `renderRooms(_:)`, `lastSyncedAgents` 보관, `didChangeSize` 재배치.

- [ ] **Step 1: sync 를 방 배치로 교체**

`OfficeScene.swift` 의 `sync(agents:)` 에서 `officeLayout(...)` 로 positions 를 구하고 `index < positions.count` 로 배치하던 부분을, 방 배치 dict 로 바꾼다. 클래스에 보관 프로퍼티 추가(기존 `agentBubbles` 근처):

```swift
private var lastSyncedAgents: [ConsoleAgent] = []
```

`sync(agents:)` 안에서 `let positions = officeLayout(...)` 블록을 다음으로 교체:

```swift
lastSyncedAgents = agents
let layout = departmentRoomLayout(
    agents: agents,
    width: Double(size.width),
    height: Double(size.height),
    bandHeight: bandHeight
)
renderRooms(layout.rooms)
```

그리고 각 에이전트 배치 루프에서 `if index < positions.count { ... positions[index] ... }` 를 다음으로 교체(인덱스 → agentType dict):

```swift
if let home = layout.positions[agent.agentType] {
    let homePoint = CGPoint(x: home.x, y: home.y)
    homePositions[agent.agentType] = homePoint
    // 집결 중이 아닌 노드만 자리 갱신(집결 노드는 밴드에 둔다).
    if !bandOrder.contains(agent.agentType) {
        node.position = homePoint
    }
}
```

주의: 배치 루프가 `for (index, agent) in agents.enumerated()` 였다면 `index` 미사용 경고를 피하려 `for agent in agents` 로 바꾼다(노드 생성·추가·색·숨쉬기 로직은 그대로 유지).

- [ ] **Step 2: 방 배경·라벨 렌더 추가**

```swift
/// 부서 방 배경(rounded-rect, 부서 tint)과 라벨을 그린다. 매 호출 시 기존 방 노드 제거 후 재생성.
private func renderRooms(_ rooms: [OfficeRoom]) {
    for child in children where child.name?.hasPrefix("room:") == true {
        child.removeFromParent()
    }
    for room in rooms {
        let rect = CGRect(
            x: room.rect.x, y: room.rect.y,
            width: room.rect.width, height: room.rect.height
        )
        let background = SKShapeNode(rect: rect, cornerRadius: 14)
        background.name = "room:\(room.department.rawValue)"
        background.fillColor = room.department.skColor.withAlphaComponent(0.08)
        background.strokeColor = room.department.skColor.withAlphaComponent(0.30)
        background.lineWidth = 1
        background.zPosition = -2
        addChild(background)

        let label = SKLabelNode(text: room.department.label)
        label.name = "room:\(room.department.rawValue):label"
        label.fontSize = 12
        label.fontColor = room.department.skColor
        label.horizontalAlignmentMode = .left
        label.verticalAlignmentMode = .top
        label.position = CGPoint(x: room.labelPoint.x, y: room.labelPoint.y)
        label.zPosition = -1
        addChild(label)
    }
}
```

- [ ] **Step 3: 리사이즈 재배치**

씬 크기가 바뀌면(resizeFill) 방·토큰이 어긋나므로 다시 배치한다:

```swift
override func didChangeSize(_ oldSize: CGSize) {
    super.didChangeSize(oldSize)
    guard !lastSyncedAgents.isEmpty else {
        return
    }
    sync(agents: lastSyncedAgents)
}
```

- [ ] **Step 4: 빌드 + 회귀 확인**

Run: `swift build` → exit 0.
Run: `swift run ConsoleCoreTests` → exit 0.

- [ ] **Step 5: 앱 실행 시각 스모크 (사람 체크포인트)**

Run: `swift run IdaeriConsole` (26개 다 보려면 백엔드 3002).
확인 항목:
- 토큰이 **부서별 방(6구획)** 으로 묶이고, 방마다 옅은 부서색 배경 + 부서명 라벨.
- 내부부서 9개도 자기 방 안에 3×3 로 들어간다(다른 방 침범·화면 밖 이탈 없음).
- 창 크기를 바꿔도 방·토큰이 다시 정렬된다.
- Phase 1·2 회귀 없음(아이콘·링·말풍선·경과·배지·hover·선택). 집결(승인)·핸드오프도 동작.

- [ ] **Step 6: 커밋** (메인 세션)

```bash
git -C <worktree> add "$CI/IdaeriConsole/OfficeScene.swift"
git -C <worktree> commit -m "feat(console): 부서 방 그룹핑 — 방 배경·라벨 + 리사이즈 재배치"
```

---

## Task 3: 대표실 밴드 — 대표 노드 + 전사 요약 HUD (IdaeriConsole)

상단 밴드에 상시 "나(대표)" 노드와 전사 요약(진행 N·승인 M·대기 K)을 둔다.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift`

**Interfaces:**
- Consumes: `companySummary(...)`, `symbolTexture(...)`(Phase 1), `Department.executive.skColor`.
- Produces: `setupPresidentBand()`, `positionPresidentBand()`, `updateCompanySummary(_:)`.

- [ ] **Step 1: 대표 노드 + 위치 헬퍼**

```swift
/// 상단 밴드의 상시 "나(대표)" 노드를 1회 생성한다. 밴드 좌측에 배치(집결 슬롯과 최대한 분리).
private func setupPresidentBand() {
    guard childNode(withName: "president") == nil else {
        return
    }
    let president = SKShapeNode(circleOfRadius: 22)
    president.name = "president"
    president.fillColor = Department.executive.skColor.withAlphaComponent(0.25)
    president.strokeColor = SKColor(white: 1, alpha: 0.5)
    president.lineWidth = 2
    president.zPosition = 8

    if let texture = symbolTexture(systemName: "crown.fill", pointSize: 20, color: Department.executive.skColor) {
        let icon = SKSpriteNode(texture: texture)
        icon.size = CGSize(width: 20, height: 20)
        icon.zPosition = 9
        president.addChild(icon)
    }
    let label = SKLabelNode(text: "나 (대표)")
    label.fontSize = 11
    label.fontColor = SKColor(white: 0.95, alpha: 1)
    label.verticalAlignmentMode = .center
    label.position = CGPoint(x: 0, y: -34)
    label.zPosition = 9
    president.addChild(label)

    addChild(president)
    positionPresidentBand()
}

/// 대표 노드·요약 HUD 를 밴드 좌측에 배치(크기 변화 시 재호출).
private func positionPresidentBand() {
    let centerY = size.height - bandHeight / 2
    childNode(withName: "president")?.position = CGPoint(x: 44, y: centerY)
    if let summary = childNode(withName: "summaryHUD") as? SKLabelNode {
        summary.position = CGPoint(x: 84, y: centerY)
    }
}
```

- [ ] **Step 2: 전사 요약 HUD 갱신**

```swift
/// 전사 요약(진행·승인·대기)을 밴드에 갱신한다.
func updateCompanySummary(_ agents: [ConsoleAgent]) {
    let summary = companySummary(agents: agents)
    childNode(withName: "summaryHUD")?.removeFromParent()
    let label = SKLabelNode(text: "진행 \(summary.inProgress)  ·  승인 \(summary.awaitingApproval)  ·  대기 \(summary.waiting)")
    label.name = "summaryHUD"
    label.fontSize = 13
    label.fontColor = SKColor(white: 0.85, alpha: 1)
    label.horizontalAlignmentMode = .left
    label.verticalAlignmentMode = .center
    label.zPosition = 8
    addChild(label)
    positionPresidentBand()
}
```

- [ ] **Step 3: didMove·sync 배선**

`didMove(to:)` 끝(tracking area 설정 뒤)에 대표 노드 생성 추가:

```swift
setupPresidentBand()
```

`sync(agents:)` 끝(에이전트 배치 루프 뒤)에 요약 갱신 추가:

```swift
updateCompanySummary(agents)
```

`didChangeSize(_:)` 는 Task 2 에서 `sync(lastSyncedAgents)` 를 부르므로 요약 위치도 갱신된다. 대표 노드 위치는 sync 경로에 없으니, `didChangeSize` 에 `positionPresidentBand()` 를 한 줄 더한다(guard 위, 항상 실행):

```swift
override func didChangeSize(_ oldSize: CGSize) {
    super.didChangeSize(oldSize)
    positionPresidentBand()
    guard !lastSyncedAgents.isEmpty else {
        return
    }
    sync(agents: lastSyncedAgents)
}
```

- [ ] **Step 4: 빌드 + 회귀 확인**

Run: `swift build` → exit 0.
Run: `swift run ConsoleCoreTests` → exit 0.

- [ ] **Step 5: 앱 실행 시각 스모크 (사람 체크포인트)**

Run: `swift run IdaeriConsole`
확인 항목:
- 상단 밴드 좌측에 **왕관 + "나 (대표)"** 노드가 상시 보인다.
- 그 옆에 **전사 요약**("진행 N · 승인 M · 대기 K")이 실데이터로 갱신된다.
- 승인 집결(summonToBand) 시 해당 토큰이 밴드로 올라오는 동작 유지(대표 노드와 최소 겹침).
- 창 크기 변경 시 대표 노드·요약이 밴드에 재배치된다.

- [ ] **Step 6: 커밋** (메인 세션)

```bash
git -C <worktree> add "$CI/IdaeriConsole/OfficeScene.swift"
git -C <worktree> commit -m "feat(console): 대표실 밴드 — 대표 노드 + 전사 요약 HUD"
```

---

## 완료 기준 (Phase 3)
- `swift build` exit 0, `swift run ConsoleCoreTests` exit 0(OfficeRoomLayout 검증 포함).
- 앱: 부서 방 그룹핑 + 방 배경·라벨, 상단 대표 노드 + 전사 요약, 리사이즈 재배치. Phase 1·2 회귀 없음.
- 백엔드 파일 0 변경.

## 후속 / 알려진 한계 (Phase 3 밖)
- 집결(승인) 토큰의 밴드 슬롯이 대표 노드(좌측)와 드물게 겹칠 수 있음 — 승인 소수·transient 라 수용. 필요 시 슬롯 시작 x 를 대표 노드 우측으로 오프셋.
- 방이 매우 작은 창에서는 9개 방(내부)이 빽빽 — 창 확대로 해소. 추후 방별 스크롤/토큰 축소 검토.
- 4축(A/B/C/D) 완료 후: 연출 미세조정(색 덮임·stale·replay pulse 등 핸드오프 잔여)은 별도.
