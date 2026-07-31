# 오피스 UI/UX 개선 Phase 2 (B, 정보 밀도) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 superpowers:executing-plans 로 태스크 단위 구현. Steps 는 checkbox(`- [ ]`).

**Goal:** Phase 1 토큰 위에 "뭘 하는지"를 얹는다 — 활성 에이전트 상시 말풍선, 진행 경과("N분째"), pending 배지, hover 시 비활성 에이전트 말풍선.

**Architecture:** 표시 판단(어떤 정보를 보일지·경과 포맷)은 ConsoleCore 순수함수로 TDD. 말풍선·경과·배지 노드 렌더와 hover 표시는 IdaeriConsole(OfficeScene/OfficeView), `swift build` + 앱 스모크로 검증. 대시보드(AgentCardView)와 같은 정보(bubble·pending phase)를 씬에서도 보여 두 뷰 정합.

**Tech Stack:** Swift 5.9, SpriteKit, ConsoleCore 실행형 러너(`swift run ConsoleCoreTests`).

## Global Constraints

- **패키지 경로**: 모든 `swift` 명령은 `clients/idaeri-console/` 에서.
- **검증 게이트**: `swift build`(exit 0) + `swift run ConsoleCoreTests`(exit 0, "✅ 모든 검증 통과"). 백엔드 파일 미변경 → pnpm 게이트 범위 밖.
- **베이스라인**: 시작 전 두 게이트 green(Phase 1 커밋 상태 = green 확인됨).
- **순수/표현 경계**: 표시 판단·경과 포맷은 ConsoleCore. SpriteKit 렌더는 IdaeriConsole.
- **새 백엔드 API 금지**: 오는 데이터(agents/runs/pendingCommands)만.
- **커밋 주체**: 메인 세션(codex sandbox 는 `.git` 접근 불가).
- **IdaeriConsole 테스트 불가**: `ConsoleCoreTests` 는 `ConsoleCore` 만 링크. SpriteKit 은 build + 앱 스모크(사람 체크포인트).
- **정보 노출 규칙**: 활성(inProgress/awaitingApproval)만 상시 말풍선(26개 상시는 난잡). 나머지는 hover.
- **모델 불변 활용**: `PendingCommand` 는 이미 Equatable(onChange 가능). `ConsoleRun` 은 Equatable 아님 → runs 변화는 eventStream 으로 잡고 `onChange(of:runs)` 는 쓰지 않는다(Models 미변경).

---

## 파일 구조

**신규:**
- `clients/idaeri-console/Sources/ConsoleCore/AgentTokenInfo.swift` — 토큰 정보 계산(순수).
- `clients/idaeri-console/Sources/ConsoleCoreTests/AgentTokenInfoTests.swift` — 테스트.

**수정:**
- `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift` — `runAgentTokenInfoTests` 등록.
- `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift` — 오버레이 렌더(`refreshOverlays`) + hover 말풍선 + `agentBubbles`.
- `clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift` — 오버레이 갱신 배선.

---

## Task 1: 토큰 정보 계산 (ConsoleCore, TDD)

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCore/AgentTokenInfo.swift`
- Test: `clients/idaeri-console/Sources/ConsoleCoreTests/AgentTokenInfoTests.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift`

**Interfaces:**
- Produces:
  - `struct AgentTokenInfo: Equatable, Sendable { let bubble: String?; let elapsed: String?; let badge: PendingPhase? }`
  - `func elapsedLabel(fromISO startedAt: String, now: Date) -> String?`
  - `func activeRun(for agentType: String, runs: [ConsoleRun]) -> ConsoleRun?`
  - `func pendingBadge(for agentType: String, pendingCommands: [PendingCommand]) -> PendingPhase?`
  - `func agentTokenInfo(agent: ConsoleAgent, runs: [ConsoleRun], pendingCommands: [PendingCommand], now: Date) -> AgentTokenInfo`

- [ ] **Step 1: 실패하는 테스트 작성**

`clients/idaeri-console/Sources/ConsoleCoreTests/AgentTokenInfoTests.swift` 생성:

```swift
import Foundation

@testable import ConsoleCore

private func makeAgent(_ type: String, _ state: ConsoleAgentState, bubble: String = "작업 중…") -> ConsoleAgent {
    ConsoleAgent(
        agentType: type, displayName: type, slashCommands: [],
        description: "", state: state, bubble: bubble
    )
}

private func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

func runAgentTokenInfoTests(_ t: TestRunner) {
    t.suite("AgentTokenInfo")

    let now = Date(timeIntervalSince1970: 1_800_000_000)

    // elapsedLabel: 경계값
    t.expectEqual(elapsedLabel(fromISO: iso(now.addingTimeInterval(-30)), now: now), "방금", "30초 → 방금")
    t.expectEqual(elapsedLabel(fromISO: iso(now.addingTimeInterval(-300)), now: now), "5분째", "5분 → 5분째")
    t.expectEqual(elapsedLabel(fromISO: iso(now.addingTimeInterval(-5400)), now: now), "1시간째", "90분 → 1시간째")
    t.expectNil(elapsedLabel(fromISO: iso(now.addingTimeInterval(300)), now: now), "미래 시각 → nil")
    t.expectNil(elapsedLabel(fromISO: "not-a-date", now: now), "파싱 불가 → nil")

    // 프랙셔널 초 없는 ISO 도 파싱
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    t.expectEqual(
        elapsedLabel(fromISO: plain.string(from: now.addingTimeInterval(-120)), now: now),
        "2분째",
        "프랙셔널 없는 ISO 도 파싱"
    )

    // activeRun: 미완료 중 최신
    let runs = [
        ConsoleRun(id: "r1", agentType: "BE", status: "running", parentId: nil, startedAt: iso(now.addingTimeInterval(-600)), finishedAt: nil),
        ConsoleRun(id: "r2", agentType: "BE", status: "done", parentId: nil, startedAt: iso(now.addingTimeInterval(-1200)), finishedAt: iso(now.addingTimeInterval(-100))),
        ConsoleRun(id: "r3", agentType: "BE", status: "running", parentId: nil, startedAt: iso(now.addingTimeInterval(-120)), finishedAt: nil),
    ]
    t.expectEqual(activeRun(for: "BE", runs: runs)?.id, "r3", "미완료 중 가장 최근 startedAt")
    t.expectNil(activeRun(for: "PM", runs: runs), "해당 없음 → nil")

    // pendingBadge: 해당 agent 의 최신 pending phase
    let pendings = [
        PendingCommand(id: UUID(), text: "a", agentTypeHint: "PM", sentAt: now.addingTimeInterval(-60), phase: .sent),
        PendingCommand(id: UUID(), text: "b", agentTypeHint: "PM", sentAt: now.addingTimeInterval(-10), phase: .running),
    ]
    t.expectEqual(pendingBadge(for: "PM", pendingCommands: pendings), .running, "최신 pending phase")
    t.expectNil(pendingBadge(for: "CTO", pendingCommands: pendings), "pending 없음 → nil")

    // agentTokenInfo: 진행 중이면 bubble+elapsed, 대기면 둘 다 nil
    let working = agentTokenInfo(agent: makeAgent("BE", .inProgress, bubble: "구현 중"), runs: runs, pendingCommands: [], now: now)
    t.expectEqual(working.bubble, "구현 중", "진행 중 → 상시 말풍선")
    t.expectEqual(working.elapsed, "2분째", "진행 중 → 경과(r3 기준)")

    let waiting = agentTokenInfo(agent: makeAgent("PM", .waiting), runs: [], pendingCommands: [], now: now)
    t.expectNil(waiting.bubble, "대기 → 상시 말풍선 없음")
    t.expectNil(waiting.elapsed, "대기 → 경과 없음")

    let approving = agentTokenInfo(agent: makeAgent("CTO", .awaitingApproval, bubble: "승인 대기"), runs: [], pendingCommands: [], now: now)
    t.expectEqual(approving.bubble, "승인 대기", "승인 대기 → 상시 말풍선")
    t.expectNil(approving.elapsed, "승인 대기 → 경과 없음(진행 아님)")

    let badged = agentTokenInfo(agent: makeAgent("PM", .waiting), runs: [], pendingCommands: pendings, now: now)
    t.expectEqual(badged.badge, .running, "pending 있으면 badge")
}
```

`main.swift` 에 등록 추가(`runDepartmentTests(runner)` 아래):

```swift
runDepartmentTests(runner)
runAgentTokenInfoTests(runner)
runConsoleClientTests(runner)
```

- [ ] **Step 2: 빌드 실패 확인**

Run: `swift build`
Expected: FAIL — `cannot find 'elapsedLabel'/'agentTokenInfo'/'activeRun'/'pendingBadge'/'AgentTokenInfo' in scope`.

- [ ] **Step 3: 최소 구현 작성**

`clients/idaeri-console/Sources/ConsoleCore/AgentTokenInfo.swift` 생성:

```swift
import Foundation

/// 토큰에 얹을 정보(순수 계산). 어떤 걸 보일지는 여기서 결정, 렌더는 씬이 맡는다.
public struct AgentTokenInfo: Equatable, Sendable {
    /// 상시 노출 말풍선(활성 상태만, 아니면 nil).
    public let bubble: String?
    /// 진행 경과("N분째", 진행 중만).
    public let elapsed: String?
    /// pending 배지 phase(없으면 nil).
    public let badge: PendingPhase?

    public init(bubble: String?, elapsed: String?, badge: PendingPhase?) {
        self.bubble = bubble
        self.elapsed = elapsed
        self.badge = badge
    }
}

/// ISO8601 startedAt 과 now 로 경과 라벨을 만든다. 미래·파싱 불가는 nil.
public func elapsedLabel(fromISO startedAt: String, now: Date) -> String? {
    let withFractional = ISO8601DateFormatter()
    withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]

    guard let started = withFractional.date(from: startedAt) ?? plain.date(from: startedAt) else {
        return nil
    }
    let seconds = now.timeIntervalSince(started)
    if seconds < 0 {
        return nil
    }
    if seconds < 60 {
        return "방금"
    }
    let minutes = Int(seconds / 60)
    if minutes < 60 {
        return "\(minutes)분째"
    }
    return "\(minutes / 60)시간째"
}

/// 해당 agent 의 미완료 run 중 가장 최근(startedAt 최대). 없으면 nil.
public func activeRun(for agentType: String, runs: [ConsoleRun]) -> ConsoleRun? {
    runs
        .filter { $0.agentType == agentType && $0.finishedAt == nil }
        .max { $0.startedAt < $1.startedAt }
}

/// 해당 agent 에 매칭되는 pending 중 최신(sentAt 최대)의 phase. 없으면 nil.
public func pendingBadge(for agentType: String, pendingCommands: [PendingCommand]) -> PendingPhase? {
    pendingCommands
        .filter { $0.effectiveAgentType == agentType }
        .max { $0.sentAt < $1.sentAt }?
        .phase
}

/// 토큰 정보 합성. 활성 상태에서만 상시 말풍선, 진행 중에서만 경과.
public func agentTokenInfo(
    agent: ConsoleAgent,
    runs: [ConsoleRun],
    pendingCommands: [PendingCommand],
    now: Date
) -> AgentTokenInfo {
    let isActive = agent.state == .inProgress || agent.state == .awaitingApproval
    let bubble = isActive ? agent.bubble : nil
    var elapsed: String?
    if agent.state == .inProgress, let run = activeRun(for: agent.agentType, runs: runs) {
        elapsed = elapsedLabel(fromISO: run.startedAt, now: now)
    }
    let badge = pendingBadge(for: agent.agentType, pendingCommands: pendingCommands)
    return AgentTokenInfo(bubble: bubble, elapsed: elapsed, badge: badge)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: PASS — "✅ 모든 검증 통과 (N건)"(179 + AgentTokenInfo 신규).

- [ ] **Step 5: 커밋** (메인 세션)

```bash
git -C <worktree> add "$CI/ConsoleCore/AgentTokenInfo.swift" "$CI/ConsoleCoreTests/AgentTokenInfoTests.swift" "$CI/ConsoleCoreTests/main.swift"
git -C <worktree> commit -m "feat(console): 토큰 정보 계산(말풍선·경과·배지) (ConsoleCore)"
```
(`$CI` = `clients/idaeri-console/Sources`)

---

## Task 2: 오버레이 렌더 + hover 말풍선 (IdaeriConsole)

토큰에 상시 말풍선·경과·pending 배지를 얹고, hover 시 비활성 에이전트 말풍선을 띄운다.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift`
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift`

**Interfaces:**
- Consumes: `agentTokenInfo(...)`, `AgentTokenInfo`, `PendingPhase.badgeIcon`(기존 Theme), `agentNodes`.
- Produces: `func refreshOverlays(agents:runs:pendingCommands:now:)`, 내부 `agentBubbles: [String: String]`, 헬퍼 `setChildLabel(...)`.

- [ ] **Step 1: 오버레이 상태·헬퍼 추가**

`OfficeScene.swift` 클래스에 프로퍼티 추가(기존 `hoveredAgentType` 근처):

```swift
private var agentBubbles: [String: String] = [:]
```

라벨 자식 add/update/remove 헬퍼 추가:

```swift
/// 이름붙은 라벨 자식을 text 유무에 따라 add/update/remove 한다(매 갱신 remove 후 재생성).
private func setChildLabel(
    _ parent: SKShapeNode,
    name: String,
    text: String?,
    position: CGPoint,
    fontSize: CGFloat,
    color: SKColor
) {
    parent.childNode(withName: name)?.removeFromParent()
    guard let text, !text.isEmpty else {
        return
    }
    let label = SKLabelNode(text: text)
    label.name = name
    label.fontSize = fontSize
    label.fontColor = color
    label.verticalAlignmentMode = .center
    label.horizontalAlignmentMode = .center
    label.position = position
    label.zPosition = 6
    parent.addChild(label)
}
```

- [ ] **Step 2: `refreshOverlays` 추가**

```swift
/// 토큰 위 정보(상시 말풍선·경과·pending 배지)를 현재 상태로 다시 그린다.
func refreshOverlays(
    agents: [ConsoleAgent],
    runs: [ConsoleRun],
    pendingCommands: [PendingCommand],
    now: Date
) {
    for agent in agents {
        guard let node = agentNodes[agent.agentType] else {
            continue
        }
        agentBubbles[agent.agentType] = agent.bubble
        let info = agentTokenInfo(agent: agent, runs: runs, pendingCommands: pendingCommands, now: now)
        setChildLabel(
            node, name: "infoBubble", text: info.bubble,
            position: CGPoint(x: 0, y: 46), fontSize: 11, color: SKColor(white: 1, alpha: 0.95)
        )
        setChildLabel(
            node, name: "elapsed", text: info.elapsed,
            position: CGPoint(x: 0, y: -54), fontSize: 10, color: SKColor(white: 0.7, alpha: 1)
        )
        setChildLabel(
            node, name: "pendingBadge", text: info.badge?.badgeIcon,
            position: CGPoint(x: 22, y: 22), fontSize: 15, color: SKColor(white: 1, alpha: 1)
        )
    }
}
```

- [ ] **Step 3: hover 시 비활성 말풍선 (mouseMoved 확장)**

`mouseMoved(with:)` 의 hover 진입/이탈 처리에 말풍선 표시를 더한다. 이탈 시 hover 말풍선 제거, 진입 시 상시 말풍선(infoBubble)이 없을 때만 hover 말풍선 표시:

```swift
if let previous = hoveredAgentType, let node = agentNodes[previous] {
    node.removeAction(forKey: "hover")
    node.run(.scale(to: 1.0, duration: 0.12), withKey: "hover")
    node.childNode(withName: "hoverBubble")?.removeFromParent()
}
hoveredAgentType = hit
if let hit, let node = agentNodes[hit] {
    node.removeAction(forKey: "breathing")
    node.run(.scale(to: 1.12, duration: 0.12), withKey: "hover")
    if node.childNode(withName: "infoBubble") == nil, let text = agentBubbles[hit] {
        setChildLabel(
            node, name: "hoverBubble", text: text,
            position: CGPoint(x: 0, y: 46), fontSize: 11, color: SKColor(white: 1, alpha: 0.95)
        )
    }
}
```

- [ ] **Step 4: `OfficeView` 배선**

`OfficeView.swift` 에서 오버레이 갱신을 잇는다. `onAppear` 의 `scene.sync(...)` 뒤, `onChange(of: store.agents)` 의 sync 뒤, `onReceive(store.eventStream)` 의 choreography 뒤에 각각 갱신 호출을 넣고, pending 변화에도 갱신한다.

`onAppear` 블록에 추가(sync 직후):

```swift
scene.refreshOverlays(
    agents: store.agents, runs: store.runs,
    pendingCommands: store.pendingCommands, now: Date()
)
```

`onChange(of: store.agents)` 블록에 추가(sync 직후):

```swift
scene.refreshOverlays(
    agents: newAgents, runs: store.runs,
    pendingCommands: store.pendingCommands, now: Date()
)
```

`onReceive(store.eventStream)` 블록 끝(choreography 실행 뒤)에 추가:

```swift
scene.refreshOverlays(
    agents: store.agents, runs: store.runs,
    pendingCommands: store.pendingCommands, now: Date()
)
```

pending 변화 갱신을 위해 modifier 를 추가(PendingCommand 는 Equatable):

```swift
.onChange(of: store.pendingCommands) { _ in
    scene.refreshOverlays(
        agents: store.agents, runs: store.runs,
        pendingCommands: store.pendingCommands, now: Date()
    )
}
```

- [ ] **Step 5: 빌드 + 회귀 확인**

Run: `swift build` → exit 0.
Run: `swift run ConsoleCoreTests` → exit 0.

- [ ] **Step 6: 앱 실행 시각 스모크 (사람 체크포인트)**

Run: `swift run IdaeriConsole` (활성 상태·pending 을 보려면 백엔드 3002 + 실제 run 필요).
확인 항목:
- 진행 중 에이전트 위에 **상시 말풍선** + "N분째" 경과가 뜬다.
- pending 지시가 있는 토큰에 **배지 이모지**(⏳🔄✅⚠️)가 우상단에 붙는다.
- 대기 에이전트는 상시 말풍선 없음 → **hover 하면** 말풍선이 뜬다(이탈 시 사라짐).
- Phase 1 회귀 없음(아이콘·링·숨쉬기·선택·클릭).

- [ ] **Step 7: 커밋** (메인 세션)

```bash
git -C <worktree> add "$CI/IdaeriConsole/OfficeScene.swift" "$CI/IdaeriConsole/OfficeView.swift"
git -C <worktree> commit -m "feat(console): 오피스 정보 밀도 — 상시 말풍선·경과·pending 배지·hover"
```

---

## 완료 기준 (Phase 2)
- `swift build` exit 0, `swift run ConsoleCoreTests` exit 0(AgentTokenInfo 검증 포함).
- 앱: 활성 상시 말풍선 + 경과, pending 배지, hover 말풍선. Phase 1 회귀 없음.
- 백엔드 파일 0 변경.

## 후속 (Phase 2 밖)
- 경과는 이벤트/agents/pending 변화 시 갱신 — 이벤트 사이엔 약간 stale(수용). 필요 시 Phase 3 이후 주기 타이머 검토.
- Phase 3(C): 부서 방 그룹핑 + 대표실(대표 노드·전사 요약).
