# 오피스 UI/UX 개선 Phase 1 (A+D) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오피스 씬의 회색 원 26개를 "정체성(부서)과 상태(진행)를 분리한 살아있는 직원 토큰"으로 바꾸고, 대기 숨쉬기·진행 호·상태 전이·hover·선택 피드백을 넣는다.

**Architecture:** 순수 로직(부서 매핑·부서 팔레트)은 ConsoleCore에 두고 실행형 러너로 TDD. SpriteKit 표현(토큰 합성·SF Symbol 텍스처·모션·hover)은 IdaeriConsole에 두고 `swift build` + 앱 실행 스모크로 검증한다. 상태색은 씬의 원 채움에서 **링(stroke)** 으로 옮겨 대시보드의 색 언어(accent=테두리)와 정렬한다.

**Tech Stack:** Swift 5.9, SwiftPM, SpriteKit, AppKit(SF Symbol → SKTexture), macOS 13+. 순수 테스트는 실행형 러너(`swift run ConsoleCoreTests`).

## Global Constraints

- **패키지 경로**: 모든 `swift` 명령은 `clients/idaeri-console/`(worktree 루트 기준)에서 실행한다.
- **검증 게이트(이 플랜 한정)**: Phase 1은 `clients/idaeri-console/` 아래 Swift 파일만 건드린다(백엔드 0). 게이트는 `swift build`(exit 0) + `swift run ConsoleCoreTests`(exit 0, "✅ 모든 검증 통과"). 백엔드 `pnpm lint:check/test/build`는 이 플랜 범위 밖(백엔드 파일 미변경).
- **베이스라인**: 시작 전 `swift build` + `swift run ConsoleCoreTests` 둘 다 green이어야 한다(확인됨: build exit 0, 테스트 140건 통과).
- **순수/표현 경계(불변)**: 좌표·집계·색·부서 매핑 등 순수 로직은 ConsoleCore. SpriteKit 의존(SKAction·노드·텍스처)은 IdaeriConsole. 팔레트는 ConsoleCore가 단일 소스(대시보드 Color·씬 SKColor 공통 참조).
- **새 백엔드 API 금지**: 오는 데이터(agents/runs/approvals/sessions/pendingCommands)만 사용.
- **커밋 주체**: 커밋은 메인 세션이 수행한다. codex를 worktree 구현에 위임하면 sandbox가 `.git`(메인 레포 안 위치)에 접근 못 해 커밋 불가 — 구현만 위임하고 커밋은 메인이 대행한다.
- **코드 스타일(CODE_RULES)**: `catch (error)`(줄임말 금지), if 단일 라인도 중괄호, 진행형/줄임 변수명 금지. Swift는 SwiftPM 기본 포매팅 유지.
- **IdaeriConsole 테스트 불가**: `ConsoleCoreTests` 타깃은 `ConsoleCore`만 링크한다 — SpriteKit 코드는 유닛테스트 대상이 아니다. IdaeriConsole 태스크의 검증은 `swift build` + `swift run ConsoleCoreTests`(회귀) + **앱 실행 시각 스모크**(사람 체크포인트)다. 이 체크포인트는 태스크 간 리뷰 지점과 겹친다.

---

## 파일 구조

**신규:**
- `clients/idaeri-console/Sources/ConsoleCore/Department.swift` — 부서 enum + `department(for:)` 매핑 + `agentDepartmentPaletteRGBA` (순수).
- `clients/idaeri-console/Sources/ConsoleCoreTests/DepartmentTests.swift` — 위 순수 로직 테스트.
- `clients/idaeri-console/Sources/IdaeriConsole/SymbolTexture.swift` — SF Symbol → SKTexture 헬퍼.

**수정:**
- `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift` — `runDepartmentTests` 등록.
- `clients/idaeri-console/Sources/IdaeriConsole/Theme.swift` — `Department` 표현 확장(색·아이콘 심볼명).
- `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift` — 토큰 합성, 상태색 링 이전, 숨쉬기·진행 호·전이 lerp, hover·선택.
- `clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift` — 선택 상태를 씬에 전달.

---

## Task 1: 부서 모델 — enum + 매핑 + 팔레트 (ConsoleCore, TDD)

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCore/Department.swift`
- Test: `clients/idaeri-console/Sources/ConsoleCoreTests/DepartmentTests.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift`

**Interfaces:**
- Produces:
  - `enum Department: String, CaseIterable, Sendable` — cases `planning`, `engineering`, `review`, `executive`, `growth`, `internalOps`; `var label: String`(한글).
  - `func department(for agentType: String) -> Department` — 26개 매핑 + 미지 타입 `.internalOps` 폴백.
  - `func agentDepartmentPaletteRGBA(_ department: Department) -> (red: Double, green: Double, blue: Double)` — 6색, 0~1, 서로 다름.

- [ ] **Step 1: 실패하는 테스트 작성**

`clients/idaeri-console/Sources/ConsoleCoreTests/DepartmentTests.swift` 생성:

```swift
import Foundation

@testable import ConsoleCore

/// 부서 매핑·부서 팔레트(순수)의 검증.
func runDepartmentTests(_ t: TestRunner) {
    t.suite("Department")

    // 26개 실제 agentType 이 기대 부서로 매핑됨
    let planning = ["PM", "PO_SHADOW", "PO_EVAL"]
    let engineering = ["BE", "BE_SCHEMA", "BE_TEST", "BE_SRE", "BE_FIX"]
    let review = ["CODE_REVIEWER", "WORK_REVIEWER", "IMPACT_REPORTER"]
    let executive = ["CTO", "CEO"]
    let growth = ["CAREER_MATE", "JOB_APPLICATION", "BLOG", "VACATION"]
    let internalOps = [
        "ISSUE_LABELER", "SUBCONSCIOUS_GATE", "CONTRADICTION_JUDGE", "HUMANIZER",
        "DOCS_AUDIT_OPTIMIZER", "DOCS_AUDIT_EVALUATOR", "PREFERENCE_LEARNING",
        "EVENING_RETRO", "OPS_SUPERVISOR",
    ]
    for agentType in planning { t.expectEqual(department(for: agentType), .planning, "\(agentType) → 기획") }
    for agentType in engineering { t.expectEqual(department(for: agentType), .engineering, "\(agentType) → 개발") }
    for agentType in review { t.expectEqual(department(for: agentType), .review, "\(agentType) → 리뷰") }
    for agentType in executive { t.expectEqual(department(for: agentType), .executive, "\(agentType) → 경영") }
    for agentType in growth { t.expectEqual(department(for: agentType), .growth, "\(agentType) → 성장") }
    for agentType in internalOps { t.expectEqual(department(for: agentType), .internalOps, "\(agentType) → 내부") }

    let total = planning.count + engineering.count + review.count
        + executive.count + growth.count + internalOps.count
    t.expectEqual(total, 26, "매핑 커버 26개")

    // 미지 타입 → 내부 폴백(크래시 없이 흡수)
    t.expectEqual(department(for: "UNKNOWN_FUTURE"), .internalOps, "미지 타입 → 내부 폴백")
    t.expectEqual(department(for: ""), .internalOps, "빈 문자열 → 내부 폴백")

    // 팔레트: 6종 모두 0~1 범위, 서로 다른 색
    var seen = Set<String>()
    for dept in Department.allCases {
        let rgb = agentDepartmentPaletteRGBA(dept)
        let inRange = (0...1).contains(rgb.red) && (0...1).contains(rgb.green) && (0...1).contains(rgb.blue)
        t.expect(inRange, "\(dept) RGB 는 0~1 범위")
        seen.insert("\(rgb.red),\(rgb.green),\(rgb.blue)")
    }
    t.expectEqual(seen.count, 6, "부서 6색이 서로 다름")
    t.expectEqual(Department.allCases.count, 6, "부서 6종")

    // label 은 6종 모두 비어있지 않고 서로 다름
    let labels = Set(Department.allCases.map { $0.label })
    t.expectEqual(labels.count, 6, "부서 라벨 6종 서로 다름")
    t.expect(Department.allCases.allSatisfy { !$0.label.isEmpty }, "모든 부서 라벨 비어있지 않음")
}
```

`clients/idaeri-console/Sources/ConsoleCoreTests/main.swift` 의 `runConsoleClientTests(runner)` 바로 위(또는 임의 위치)에 등록 추가:

```swift
runOfficeInteractionTests(runner)
runDepartmentTests(runner)
runConsoleClientTests(runner)
```

- [ ] **Step 2: 빌드 실패 확인 (심볼 미정의)**

Run: `swift build`
Expected: FAIL — `cannot find 'department' in scope` / `cannot find type 'Department' in scope` / `cannot find 'agentDepartmentPaletteRGBA' in scope`. (이 하네스에서 "실패하는 테스트"는 미정의 심볼로 인한 컴파일 실패다.)

- [ ] **Step 3: 최소 구현 작성**

`clients/idaeri-console/Sources/ConsoleCore/Department.swift` 생성:

```swift
import Foundation

/// 오피스 부서 구획. 26개 에이전트를 6개 부서로 묶는다(정체성 표현용, 순수).
/// 상태(ConsoleAgentState)와 직교한다 — 상태는 토큰의 링/색, 부서는 아이콘·채움 tint·(Phase 3)방 배치.
public enum Department: String, CaseIterable, Sendable {
    case planning
    case engineering
    case review
    case executive
    case growth
    case internalOps

    /// 방 라벨·범례용 한글 부서명.
    public var label: String {
        switch self {
        case .planning:
            return "기획"
        case .engineering:
            return "개발"
        case .review:
            return "리뷰"
        case .executive:
            return "경영"
        case .growth:
            return "성장"
        case .internalOps:
            return "내부"
        }
    }
}

/// agentType(백엔드 AgentType enum 문자열) → 부서 매핑.
/// 미지 타입(향후 추가될 에이전트 포함)은 .internalOps 로 폴백해 크래시 없이 흡수한다.
public func department(for agentType: String) -> Department {
    switch agentType {
    case "PM", "PO_SHADOW", "PO_EVAL":
        return .planning
    case "BE", "BE_SCHEMA", "BE_TEST", "BE_SRE", "BE_FIX":
        return .engineering
    case "CODE_REVIEWER", "WORK_REVIEWER", "IMPACT_REPORTER":
        return .review
    case "CTO", "CEO":
        return .executive
    case "CAREER_MATE", "JOB_APPLICATION", "BLOG", "VACATION":
        return .growth
    default:
        return .internalOps
    }
}

/// 부서 6종의 표시 색(0~1 RGB). 부서색은 토큰의 아이콘·채움 tint 로 쓰인다(상태색과 역할 분리).
/// 제약: 6색 서로 구분 + 5개 상태색과 색상 충돌 회피. 채움 불투명도는 표현 계층(Theme)에서 낮춘다.
/// 색 값은 구현 중 frontend-design 관점으로 미세조정 가능(6색 구분·상태색 비충돌 제약만 유지).
public func agentDepartmentPaletteRGBA(
    _ department: Department
) -> (red: Double, green: Double, blue: Double) {
    switch department {
    case .planning:
        return (0.28, 0.52, 0.90)  // 파랑
    case .engineering:
        return (0.15, 0.62, 0.70)  // 청록
    case .review:
        return (0.52, 0.40, 0.86)  // 인디고
    case .executive:
        return (0.82, 0.60, 0.20)  // 골드
    case .growth:
        return (0.94, 0.48, 0.36)  // 코랄
    case .internalOps:
        return (0.46, 0.52, 0.60)  // 슬레이트
    }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `swift run ConsoleCoreTests`
Expected: PASS — "✅ 모든 검증 통과 (N건)", exit 0. (기존 140건 + 신규 Department 검증이 합산된다.)

- [ ] **Step 5: 커밋** (메인 세션이 수행)

```bash
git -C <worktree> add -A clients/idaeri-console/Sources/ConsoleCore/Department.swift \
  clients/idaeri-console/Sources/ConsoleCoreTests/DepartmentTests.swift \
  clients/idaeri-console/Sources/ConsoleCoreTests/main.swift
git -C <worktree> commit -m "feat(console): 부서 모델·매핑·팔레트 (ConsoleCore)"
```

---

## Task 2: SF Symbol 텍스처 헬퍼 + 부서 Theme 확장 (IdaeriConsole)

이 태스크는 **A축 리스크(SF Symbol → SKTexture가 CLT 실행 앱에서 되는가)의 코드 기반**을 만든다. 컴파일로 API 사용 정확성을 증명하고, 실제 렌더 시각 확인은 Task 3 앱 실행에서 retire한다.

**Files:**
- Create: `clients/idaeri-console/Sources/IdaeriConsole/SymbolTexture.swift`
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/Theme.swift`

**Interfaces:**
- Consumes: `Department`, `agentDepartmentPaletteRGBA` (Task 1).
- Produces:
  - `func symbolTexture(systemName: String, pointSize: CGFloat, color: NSColor) -> SKTexture?` — 실패 시 nil.
  - `extension Department`: `var accentColor: Color`, `var skColor: SKColor`, `var fillTintColor: SKColor`, `var iconSymbolName: String`.

- [ ] **Step 1: 헬퍼 작성**

`clients/idaeri-console/Sources/IdaeriConsole/SymbolTexture.swift` 생성:

```swift
import AppKit
import SpriteKit

/// SF Symbol(시스템 제공)을 지정 색·크기로 렌더해 SKTexture 로 변환한다. 리소스 번들 불필요.
/// 유효하지 않은 심볼명이거나 렌더 실패 시 nil(호출자가 이니셜 등으로 폴백).
func symbolTexture(systemName: String, pointSize: CGFloat, color: NSColor) -> SKTexture? {
    guard let base = NSImage(systemSymbolName: systemName, accessibilityDescription: nil) else {
        return nil
    }
    let configuration = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .semibold)
        .applying(NSImage.SymbolConfiguration(paletteColors: [color]))
    guard let rendered = base.withSymbolConfiguration(configuration) else {
        return nil
    }
    return SKTexture(image: rendered)
}
```

- [ ] **Step 2: 부서 Theme 확장 추가**

`clients/idaeri-console/Sources/IdaeriConsole/Theme.swift` 끝에 추가(기존 `extension ConsoleAgentState` 패턴 미러링):

```swift
/// 부서의 표시 속성(색·아이콘). 색 값은 ConsoleCore 의 부서 팔레트를 단일 소스로 참조한다.
extension Department {
    /// 부서 강조색(범례·아이콘 SwiftUI 표시용).
    var accentColor: Color {
        let rgb = agentDepartmentPaletteRGBA(self)
        return Color(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }

    /// SpriteKit 아이콘 tint 색(accentColor 와 같은 팔레트).
    var skColor: SKColor {
        let rgb = agentDepartmentPaletteRGBA(self)
        return SKColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
    }

    /// 토큰 채움 tint(낮은 불투명도 — 상태 링 가독성 보존).
    var fillTintColor: SKColor {
        let rgb = agentDepartmentPaletteRGBA(self)
        return SKColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 0.20)
    }

    /// 부서 대표 SF Symbol 이름(시스템 제공, macOS 13 존재 확인된 것만).
    var iconSymbolName: String {
        switch self {
        case .planning:
            return "chart.bar.fill"
        case .engineering:
            return "gearshape.fill"
        case .review:
            return "magnifyingglass"
        case .executive:
            return "building.2.fill"
        case .growth:
            return "leaf.fill"
        case .internalOps:
            return "cpu"
        }
    }
}
```

`Theme.swift` 상단 import 에 `ConsoleCore` 가 이미 있는지 확인(있음 — `ConsoleAgentState` 확장이 이미 사용). 없으면 추가.

- [ ] **Step 3: 빌드 확인**

Run: `swift build`
Expected: PASS(exit 0). AppKit→SpriteKit 브리지와 확장이 타입체크된다. (시각 확인은 Task 3.)

- [ ] **Step 4: 회귀 확인**

Run: `swift run ConsoleCoreTests`
Expected: PASS(exit 0) — 순수 로직 회귀 없음.

- [ ] **Step 5: 커밋** (메인 세션)

```bash
git -C <worktree> add -A clients/idaeri-console/Sources/IdaeriConsole/SymbolTexture.swift \
  clients/idaeri-console/Sources/IdaeriConsole/Theme.swift
git -C <worktree> commit -m "feat(console): SF Symbol 텍스처 헬퍼 + 부서 Theme 확장"
```

---

## Task 3: 직원 토큰 노드 + 상태색 링 이전 (IdaeriConsole)

토큰을 "부서 채움 + 상태 링 + 부서 아이콘 + 이름 라벨"로 합성하고, 상태색을 원 **채움(fillColor)** 에서 **링(strokeColor)** 으로 옮긴다. `agentNodes[agentType]` 는 계속 base `SKShapeNode`(원)로 유지해 기존 이동·스케일·알파·bubble·히트테스트를 그대로 재사용한다.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift`

**Interfaces:**
- Consumes: `department(for:)`, `Department.skColor/fillTintColor/iconSymbolName` (Task 1·2), `symbolTexture(...)` (Task 2), `ConsoleAgentState.skColor` (기존 Theme).
- Produces: 토큰 노드 구조 — base `SKShapeNode`(fill=부서 tint, stroke=상태색, lineWidth 4), 자식 `icon`·`nameLabel`. 상태색은 이제 `strokeColor`.

- [ ] **Step 1: `makeNode(for:)` 재작성 (토큰 합성)**

`OfficeScene.swift` 의 `makeNode(for:)` 를 교체:

```swift
private func makeNode(for agent: ConsoleAgent) -> SKShapeNode {
    let dept = department(for: agent.agentType)
    let node = SKShapeNode(circleOfRadius: nodeRadius)
    node.fillColor = dept.fillTintColor        // 부서 정체성(은은한 채움)
    node.strokeColor = agent.state.skColor     // 상태(링) — 이전엔 fillColor 였음
    node.lineWidth = 4

    // 부서 아이콘(SF Symbol → SKTexture). 실패 시 이니셜 폴백.
    if let texture = symbolTexture(systemName: dept.iconSymbolName, pointSize: 22, color: dept.skColor) {
        let icon = SKSpriteNode(texture: texture)
        icon.name = "icon"
        icon.size = CGSize(width: 22, height: 22)
        icon.position = .zero
        icon.zPosition = 2
        node.addChild(icon)
    } else {
        let initials = SKLabelNode(text: String(agent.displayName.prefix(2)))
        initials.name = "icon"
        initials.fontSize = 14
        initials.fontColor = dept.skColor
        initials.verticalAlignmentMode = .center
        initials.zPosition = 2
        node.addChild(initials)
    }

    let label = SKLabelNode(text: agent.displayName)
    label.name = "nameLabel"
    label.fontSize = 11
    label.fontColor = SKColor(white: 0.95, alpha: 1)
    label.verticalAlignmentMode = .center
    label.position = CGPoint(x: 0, y: -40)
    label.preferredMaxLayoutWidth = 90
    node.addChild(label)

    return node
}
```

- [ ] **Step 2: `sync(agents:)` 상태색을 링으로**

`sync(agents:)` 안의 `node.fillColor = agent.state.skColor` 한 줄을 교체:

```swift
// 색은 sync 가 진실원. 상태색은 링(stroke) — 채움은 부서 tint 로 고정.
node.strokeColor = agent.state.skColor
```

- [ ] **Step 3: 연출의 상태색 조작을 링으로 이전**

`recolor` / `reject` / `summonToBand` 세 곳의 상태색 조작을 `fillColor` → `strokeColor` 로 바꾼다.

`recolor(_:to:)`:

```swift
private func recolor(_ agentType: String, to color: SKColor) {
    guard let node = agentNodes[agentType] else {
        return
    }
    node.removeAction(forKey: "working")
    node.strokeColor = color
    node.run(.sequence([.scale(to: 1.15, duration: 0.12), .scale(to: 1.0, duration: 0.12)]))
}
```

`reject(_:)` (원복 대상도 strokeColor):

```swift
private func reject(_ agentType: String) {
    guard let node = agentNodes[agentType] else {
        return
    }
    let shake = SKAction.sequence([
        .moveBy(x: 8, y: 0, duration: 0.05),
        .moveBy(x: -16, y: 0, duration: 0.1),
        .moveBy(x: 8, y: 0, duration: 0.05),
    ])
    let original = node.strokeColor
    node.run(.sequence([.repeat(shake, count: 2)]))
    node.strokeColor = SKColor(red: 0.9, green: 0.2, blue: 0.2, alpha: 1)
    node.run(.sequence([.wait(forDuration: 0.4), .run { node.strokeColor = original }]))
}
```

`summonToBand(_:)` 의 색 지정 한 줄:

```swift
node.strokeColor = ConsoleAgentState.awaitingApproval.skColor
```

- [ ] **Step 4: 빌드 + 회귀 확인**

Run: `swift build` → exit 0.
Run: `swift run ConsoleCoreTests` → exit 0.

- [ ] **Step 5: 앱 실행 시각 스모크 (리스크 retire — 사람 체크포인트)**

Run: `swift run IdaeriConsole` (백엔드가 PORT 3002 로 떠 있어야 26개가 채워진다. 안 떠 있으면 최소한 앱이 크래시 없이 뜨고 연결 상태를 보여주는지 확인).
확인 항목:
- 각 토큰에 **부서 아이콘**이 보인다(SF Symbol 렌더 성공 = A축 리스크 retire). 아이콘이 없고 이니셜이 보이면 `iconSymbolName` 값 점검.
- 토큰이 **부서 tint 채움 + 상태색 링**으로 보인다(꽉 찬 상태색 원이 아님).
- 토큰 클릭 시 기존 지시/승인 바가 그대로 뜬다(히트테스트 회귀 없음).
- (데이터 있으면) 상태 변화 시 **링 색**이 바뀐다.

- [ ] **Step 6: 커밋** (메인 세션)

```bash
git -C <worktree> add -A clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git -C <worktree> commit -m "feat(console): 직원 토큰(부서 채움+상태 링+아이콘) + 상태색 링 이전"
```

---

## Task 4: 모션 — 대기 숨쉬기 + 진행 호 + 상태 전이 lerp (IdaeriConsole)

대기(waiting)는 미세 숨쉬기, 진행 중은 회전 호(현재 scaleY 펄스 대체), 상태 전이는 링 색 lerp.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift`

**Interfaces:**
- Consumes: 토큰 base 노드(Task 3), `ConsoleAgentState.skColor`.
- Produces: `startBreathing`/`stopBreathing`, 진행 호 자식(`progressArc`), `animateStroke`/`lerpColor` 헬퍼. `sync` 가 상태에 따라 숨쉬기를 켜고 끈다.

- [ ] **Step 1: 색 lerp 헬퍼 추가**

`OfficeScene.swift` 에 추가:

```swift
/// 두 색을 sRGB 성분으로 선형 보간한다(SKColor == NSColor, macOS).
private func lerpColor(_ from: SKColor, _ to: SKColor, _ ratio: CGFloat) -> SKColor {
    let clamped = max(0, min(1, ratio))
    guard
        let start = from.usingColorSpace(.sRGB),
        let end = to.usingColorSpace(.sRGB)
    else {
        return to
    }
    let red = start.redComponent + (end.redComponent - start.redComponent) * clamped
    let green = start.greenComponent + (end.greenComponent - start.greenComponent) * clamped
    let blue = start.blueComponent + (end.blueComponent - start.blueComponent) * clamped
    return SKColor(red: red, green: green, blue: blue, alpha: 1)
}

/// 링(stroke) 색을 duration 동안 부드럽게 전이한다.
private func animateStroke(_ node: SKShapeNode, to color: SKColor, duration: TimeInterval) {
    let from = node.strokeColor
    let action = SKAction.customAction(withDuration: duration) { runningNode, elapsed in
        guard let shape = runningNode as? SKShapeNode else {
            return
        }
        let ratio = duration > 0 ? CGFloat(elapsed) / CGFloat(duration) : 1
        shape.strokeColor = lerpColor(from, color, ratio)
    }
    node.run(action)
}
```

- [ ] **Step 2: 숨쉬기 헬퍼 추가**

```swift
/// 대기 노드의 은은한 숨쉬기(미세 scale 반복). 이미 돌고 있으면 중복 시작 안 함.
private func startBreathing(_ node: SKShapeNode) {
    guard node.action(forKey: "breathing") == nil else {
        return
    }
    let breathe = SKAction.sequence([
        .scale(to: 1.03, duration: 1.6),
        .scale(to: 1.0, duration: 1.6),
    ])
    breathe.timingMode = .easeInEaseOut
    node.run(.repeatForever(breathe), withKey: "breathing")
}

private func stopBreathing(_ node: SKShapeNode) {
    node.removeAction(forKey: "breathing")
    node.setScale(1.0)
}
```

- [ ] **Step 3: `startWorking` 를 회전 진행 호로 교체**

```swift
private func startWorking(_ agentType: String) {
    guard let node = agentNodes[agentType] else {
        return
    }
    stopBreathing(node)
    node.childNode(withName: "progressArc")?.removeFromParent()

    let arc = SKShapeNode()
    arc.name = "progressArc"
    let path = CGMutablePath()
    path.addArc(
        center: .zero,
        radius: nodeRadius + 6,
        startAngle: 0,
        endAngle: .pi * 0.6,
        clockwise: false
    )
    arc.path = path
    arc.strokeColor = ConsoleAgentState.inProgress.skColor
    arc.lineWidth = 3
    arc.fillColor = .clear
    arc.zPosition = 3
    node.addChild(arc)
    arc.run(.repeatForever(.rotate(byAngle: -.pi * 2, duration: 1.4)), withKey: "spin")
}

/// 진행 호 제거(진행 상태를 벗어날 때).
private func stopWorking(_ node: SKShapeNode) {
    node.childNode(withName: "progressArc")?.removeFromParent()
}
```

- [ ] **Step 4: `recolor` 를 lerp + 호 정리로 갱신**

Task 3 의 `recolor` 를 교체(즉시 대입 → lerp, 진행 호 제거):

```swift
private func recolor(_ agentType: String, to color: SKColor) {
    guard let node = agentNodes[agentType] else {
        return
    }
    node.removeAction(forKey: "working")
    stopWorking(node)
    animateStroke(node, to: color, duration: 0.35)
    node.run(.sequence([.scale(to: 1.15, duration: 0.12), .scale(to: 1.0, duration: 0.12)]))
}
```

- [ ] **Step 5: `sync` 에서 상태에 따라 숨쉬기 토글**

`sync(agents:)` 의 상태색 지정부(Task 3 Step 2에서 바꾼 줄) 아래에 숨쉬기 토글을 추가한다. 진행 호가 있거나 집결(band) 중이면 숨쉬기 금지:

```swift
node.strokeColor = agent.state.skColor
let isWorking = node.childNode(withName: "progressArc") != nil
if agent.state == .waiting, !bandOrder.contains(agent.agentType), !isWorking {
    startBreathing(node)
} else {
    stopBreathing(node)
}
```

주의: `summonToBand` 는 집결 blink 를 켜므로, 그 진입에서도 `stopBreathing(node)` 를 호출해 스케일 충돌을 막는다(`summonToBand` 첫 줄 guard 직후에 `stopBreathing(node)` 추가).

- [ ] **Step 6: 빌드 + 회귀 확인**

Run: `swift build` → exit 0.
Run: `swift run ConsoleCoreTests` → exit 0.

- [ ] **Step 7: 앱 실행 시각 스모크 (사람 체크포인트)**

Run: `swift run IdaeriConsole`
확인 항목:
- 대기(회색 링) 토큰이 아주 미세하게 숨쉰다(정지 아님).
- 진행 중 토큰에 회전하는 호가 돈다(scaleY 펄스 아님).
- 상태 전이 시 링 색이 뚝 바뀌지 않고 부드럽게 전이된다.
- 숨쉬기와 hover/집결 스케일이 충돌해 튀지 않는다.

- [ ] **Step 8: 커밋** (메인 세션)

```bash
git -C <worktree> add -A clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git -C <worktree> commit -m "feat(console): 대기 숨쉬기 + 진행 호 + 상태 전이 lerp"
```

---

## Task 5: hover + 선택 강조 (IdaeriConsole)

hover 반응(`mouseMoved`)과 선택 지속 강조. 선택 상태는 뷰의 `selectedAgent` 를 씬으로 전달한다.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift`
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift`

**Interfaces:**
- Consumes: `agentNodes`, `agentTypeAt(...)` (기존 히트테스트), `nodeRadius`.
- Produces: `func setSelected(_ agentType: String?)`(씬 공개 API), `mouseMoved(with:)` override, 내부 상태 `hoveredAgentType`·`selectedAgentType`.

- [ ] **Step 1: 선택 API + 상태 추가**

`OfficeScene.swift` 클래스에 상태 프로퍼티 추가:

```swift
private var hoveredAgentType: String?
private var selectedAgentType: String?
```

선택 강조 API 추가(선택 노드에 지속 하이라이트 링 자식 부여, 해제 시 제거):

```swift
/// 뷰의 선택 상태를 반영한다. 선택 노드에 지속 하이라이트 링을 얹고, 이전 선택은 해제한다.
func setSelected(_ agentType: String?) {
    if selectedAgentType == agentType {
        return
    }
    if let previous = selectedAgentType, let node = agentNodes[previous] {
        node.childNode(withName: "selectionRing")?.removeFromParent()
    }
    selectedAgentType = agentType
    guard let agentType, let node = agentNodes[agentType] else {
        return
    }
    let ring = SKShapeNode(circleOfRadius: nodeRadius + 5)
    ring.name = "selectionRing"
    ring.strokeColor = SKColor(white: 1, alpha: 0.9)
    ring.lineWidth = 2
    ring.fillColor = .clear
    ring.zPosition = 4
    node.addChild(ring)
}
```

- [ ] **Step 2: hover 배선 (`mouseMoved`)**

`didMove(to:)` 에 마우스 무브 수신 설정 추가:

```swift
override func didMove(to view: SKView) {
    backgroundColor = SKColor(white: 0.12, alpha: 1)
    view.window?.acceptsMouseMovedEvents = true
    let tracking = NSTrackingArea(
        rect: view.bounds,
        options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect],
        owner: view,
        userInfo: nil
    )
    view.addTrackingArea(tracking)
}
```

`mouseMoved(with:)` override 추가(히트된 토큰만 살짝 확대·밝게, 벗어나면 원복):

```swift
override func mouseMoved(with event: NSEvent) {
    let location = event.location(in: self)
    let slots: [(agentType: String, point: OfficePoint)] = agentNodes.map {
        ($0.key, OfficePoint(x: Double($0.value.position.x), y: Double($0.value.position.y)))
    }
    let hit = agentTypeAt(
        point: OfficePoint(x: Double(location.x), y: Double(location.y)),
        slots: slots,
        radius: nodeRadius
    )
    if hit == hoveredAgentType {
        return
    }
    if let previous = hoveredAgentType, let node = agentNodes[previous] {
        node.removeAction(forKey: "hover")
        node.run(.scale(to: 1.0, duration: 0.12), withKey: "hover")
    }
    hoveredAgentType = hit
    if let hit, let node = agentNodes[hit] {
        node.removeAction(forKey: "breathing")
        node.run(.scale(to: 1.12, duration: 0.12), withKey: "hover")
    }
}
```

주의: hover 확대와 숨쉬기(Task 4)가 같은 scale 을 다투므로, hover 진입 시 숨쉬기를 멈추고 이탈 시 scale 을 1.0 으로 원복한다(다음 `sync` 가 대기 상태면 숨쉬기를 다시 켠다).

- [ ] **Step 3: `OfficeView` 에서 선택을 씬에 전달**

`OfficeView.swift` 의 `SpriteView(...)` modifier 체인에 선택 변화 반영을 추가한다(기존 `.onChange(of: store.agents)` 아래):

```swift
.onChange(of: selectedAgent) { newSelection in
    scene.setSelected(newSelection)
}
```

- [ ] **Step 4: 빌드 + 회귀 확인**

Run: `swift build` → exit 0.
Run: `swift run ConsoleCoreTests` → exit 0.

- [ ] **Step 5: 앱 실행 시각 스모크 (사람 체크포인트)**

Run: `swift run IdaeriConsole`
확인 항목:
- 토큰 위에 마우스를 올리면 살짝 커지고 밝아진다(벗어나면 원복). **hover 가 안 먹으면** 리스크 §9-2 폴백 — hover는 Phase 1 최저 우선순위라, 안 되면 그대로 두고 클릭·상시정보로 대체(스펙 리스크에 명시). build·클릭·선택은 유지돼야 함.
- 토큰 클릭 시 지속 하이라이트 링이 생기고, 바 "닫기" 시 사라진다.
- hover 확대와 숨쉬기가 겹쳐 튀지 않는다.

- [ ] **Step 6: 커밋** (메인 세션)

```bash
git -C <worktree> add -A clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift \
  clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift
git -C <worktree> commit -m "feat(console): hover 반응 + 선택 지속 강조"
```

---

## 완료 기준 (Phase 1)

- `swift build` exit 0, `swift run ConsoleCoreTests` exit 0(신규 Department 검증 포함).
- 앱 실행 시: 부서 아이콘 + 상태 링 + 부서 채움 토큰, 대기 숨쉬기, 진행 회전 호, 상태 전이 lerp, 선택 강조가 보인다(hover는 되면 좋고, 안 되면 폴백 명시).
- 기존 기능 회귀 없음: 클릭 지시/승인, 집결·핸드오프·거절 연출, 히트테스트.
- 백엔드 파일 0 변경.

## 후속 (Phase 1 밖)

- Phase 2(B, 정보 밀도): 상시/hover 말풍선, 경과 시간(runs.startedAt), pending 배지. 별도 스펙 섹션 + 플랜.
- Phase 3(C, 레이아웃·대표실): 부서 방 그룹핑, 대표 노드 + 전사 요약. 별도 플랜.
- hover(`mouseMoved`)가 이 Phase 에서 불안정하면 Phase 2 상시정보가 그 공백을 메운다.
