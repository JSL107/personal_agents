# 오피스 게이미피케이션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오피스 화면에 하루의 시간 흐름(출근·점심·퇴근)과 승인 방치 압력을 넣고, 상단 상태 줄·이름표·밤 조명의 시각 품질을 끌어올린다.

**Architecture:** 판정은 `ConsoleCore`의 순수 함수 두 개(`officeAttendance`, `officeApprovalPressure`)가 맡고, 연출 실행은 `OfficeScene`이 맡는다. 기존 `OfficeIdle`·`OfficeChoreography`가 이미 지키는 경계를 그대로 따른다. 백엔드는 원자료만 내려주고 시각 판정을 하지 않는다 — 그래야 `hourOverride`로 시각별 렌더 검증이 계속 가능하다.

**Tech Stack:** Swift 5.9 / SpriteKit (macOS 13+), NestJS 10 + Prisma 6 (백엔드 필드 노출 1건), 자체 테스트 러너(`ConsoleCoreTests`, XCTest 없음)

**Spec:** `docs/superpowers/specs/2026-08-19-office-gamification-design.md`

## Global Constraints

- **Swift 테스트 게이트는 `swift build && swift run ConsoleCoreTests`다.** 이 패키지에는 XCTest가 없다(`Package.swift` 주석: "CLT 전용 환경(XCTest 부재)"). `swift test`를 돌리면 타깃이 없어 실패한다. exit 0이 green이다.
- 새 테스트 파일은 `Sources/ConsoleCoreTests/`에 만들고 **`main.swift`에 러너 호출을 등록해야 실행된다.** 등록을 빠뜨리면 테스트가 조용히 안 돈다.
- 테스트 작성 형식: `func runXxxTests(_ t: TestRunner)` + `t.suite("이름")` + `t.expectEqual(actual, expected, "설명")`. 사용 가능한 API는 `t.expect` / `t.expectEqual` / `t.expectNil` / `t.expectThrows` / `t.fail`.
- **백엔드 게이트는 `pnpm lint:check && pnpm test && pnpm build` 3중 green이다.** 패키지 매니저는 `pnpm@9.15.9`, Node 22+. `npm`·`yarn` 금지.
- **`pnpm db:push`를 돌리지 않는다.** 이 계획에는 DB 스키마 변경이 없다(`PreviewAction.expires_at`은 이미 존재). db:push는 병렬 worktree의 다른 브랜치 테이블을 지운 이력이 있다.
- **시각은 예외 없이 `OfficeScene.currentHour()`를 경유한다.** `Date()` 직접 호출은 `hourOverride` 기반 렌더 검증을 무력화한다. `ConsoleCore`의 순수 함수는 `hour`를 인자로만 받고 스스로 시계를 읽지 않는다.
- 코드 스타일(`CODE_RULES.md`): 줄임말 금지(`err`→`error`, `repo`→`repository`, `existing`→`found`), `if` 단일 라인도 중괄호 필수, `try` 블록 안에서는 `return await`, 인라인 반환 타입 금지(별도 type으로 추출). 주석은 한국어.
- **커밋은 격리 브랜치 또는 worktree 안에서만 한다.** 이 레포는 사용자 명시 요청 없는 `main` 커밋을 금지한다. 착수 전 `git branch --show-current`로 현재 트리가 어느 브랜치인지 확인한다.
- 이름표의 **크기·위치·글꼴은 건드리지 않는다.** 겹침 문제로 두 번(#266·#268) 고친 이력이 있어, 이 계획에서 이름표는 투명도만 바꾼다.
- **렌더로 시각 검증할 때는 반드시 `--size 960x1050 --zone-columns 2` 를 준다.** 기본 크기(1400×820)는 타일이 27px 미만이 되는 구간이라, `nameplateIsVisible` 이 유휴 이름표를 **아예 숨긴다**(`OfficeInteraction.swift:281-298`). 그 조건에서 찍은 그림에는 이름표가 한 장도 없으므로, 이름표·좌석 관련 변화를 확인했다고 말할 수 없다. 실사용 창은 세로로 긴 2열 배치다.

---

## File Structure

**새로 만드는 파일**

| 파일 | 책임 |
|---|---|
| `clients/idaeri-console/Sources/ConsoleCore/OfficeAttendance.swift` | 출근 판정 순수 함수 + 시각 경계 상수 |
| `clients/idaeri-console/Sources/ConsoleCore/OfficeApprovalPressure.swift` | 승인 방치 압력 4단계 판정 순수 함수 |
| `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeAttendanceTests.swift` | 출근 판정 테스트 |
| `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeApprovalPressureTests.swift` | 압력 판정 테스트 |

**수정하는 파일**

| 파일 | 무엇을 |
|---|---|
| `src/console/domain/console.type.ts` | `ConsoleApproval.expiresAt` 추가 |
| `src/console/application/console-mappers.ts:30-37` | `toConsoleApproval`이 `expiresAt` 내려주게 |
| `clients/idaeri-console/Sources/ConsoleCore/Models.swift:148-160` | Swift `ConsoleApproval`에 `expiresAt` |
| `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift` | 새 테스트 러너 2개 등록 |
| `clients/idaeri-console/Sources/IdaeriConsole/OfficeLightTexture.swift` | 책상 빛 웅덩이 · 빨간 경고등 텍스처 |
| `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift` | HUD 카드, 출퇴근 연출, 압력 단계 표현, 조명 배치 |
| `clients/idaeri-console/Sources/IdaeriConsole/CharacterNode.swift` | 이름표 투명도 |
| `clients/idaeri-console/Sources/ConsoleCore/OfficeChoreography.swift` | `VisualIntent`에 입·퇴장 추가 |
| `clients/idaeri-console/Sources/ConsoleCore/OfficeIdle.swift` | 점심 시간대 목적지 가중치 |

---

## Task 1: 출근 판정 순수 함수

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCore/OfficeAttendance.swift`
- Create: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeAttendanceTests.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `OfficeAttendance` enum (`.away` / `.present`), `OfficeAttendanceInput` struct, `officeAttendance(hour:input:) -> OfficeAttendance`, 상수 `officeArrivalHour` = 9 · `officeDepartureHour` = 21 · `officeEarlyBirdStartHour` = 5

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`Sources/ConsoleCoreTests/OfficeAttendanceTests.swift`:

```swift
import Foundation

@testable import ConsoleCore

private func attendanceInput(
    hasActiveRun: Bool = false,
    doneToday: Int = 0,
    isQueued: Bool = false
) -> OfficeAttendanceInput {
    OfficeAttendanceInput(
        hasActiveRun: hasActiveRun,
        doneToday: doneToday,
        isQueued: isQueued
    )
}

func runOfficeAttendanceTests(_ t: TestRunner) {
    t.suite("OfficeAttendance")

    // 시각 경계를 씬이 아니라 Core 에 고정한다. 씬으로 새면 렌더 없이 회귀를 잡을 수 없다.
    t.expectEqual(officeEarlyBirdStartHour, 5, "조기 출근 인정 시작 시각")
    t.expectEqual(officeArrivalHour, 9, "정규 출근 시각")
    t.expectEqual(officeDepartureHour, 21, "이 시각부터 퇴근")

    // 규칙 3 — 정규 근무 시간의 양 끝. 20시는 아직 present, 21시부터 away.
    t.expectEqual(officeAttendance(hour: 9, input: attendanceInput()), .present, "9시 출근")
    t.expectEqual(officeAttendance(hour: 20, input: attendanceInput()), .present, "20시는 아직 근무")
    t.expectEqual(officeAttendance(hour: 21, input: attendanceInput()), .away, "21시부터 퇴근")
    t.expectEqual(officeAttendance(hour: 8, input: attendanceInput()), .away, "8시엔 일 없으면 집")

    // 규칙 4 — 조기 출근자. 새벽 5시 INVEST · 8시 PM 이 실측으로 존재한다.
    t.expectEqual(
        officeAttendance(hour: 5, input: attendanceInput(doneToday: 1)),
        .present,
        "새벽 5시에 이미 처리한 사람은 앉아 있다"
    )
    t.expectEqual(
        officeAttendance(hour: 4, input: attendanceInput(doneToday: 1)),
        .away,
        "4시는 조기 출근으로 인정하지 않는다"
    )

    // 규칙 2 — 진행 중 실행은 시각을 이긴다. 일하는 사람이 빈 자리에 있으면 안 된다.
    t.expectEqual(
        officeAttendance(hour: 3, input: attendanceInput(hasActiveRun: true)),
        .present,
        "새벽 3시에 돌고 있으면 앉아 있다"
    )

    // 규칙 1 — 줄이 최우선. 줄 선 사람을 퇴근시키면 대기열이 실제 상태와 어긋난다.
    t.expectEqual(
        officeAttendance(hour: 23, input: attendanceInput(isQueued: true)),
        .present,
        "대표실 줄에 선 사람은 퇴근 시각에도 남는다"
    )

    // 자정 리셋 회귀 — doneToday 는 KST 자정에 0 이 된다. 22시에 present 였던 사람이
    // 0시에 doneToday 0 으로 바뀌어도, 진행 중 실행이 없으면 away 여야 한다(뒤집힘이 아니라
    // 퇴근으로 읽혀야 한다). 반대로 진행 중이면 doneToday 0 이어도 남는다.
    t.expectEqual(
        officeAttendance(hour: 0, input: attendanceInput(doneToday: 0)),
        .away,
        "자정 이후 일 없으면 집"
    )
    t.expectEqual(
        officeAttendance(hour: 0, input: attendanceInput(hasActiveRun: true, doneToday: 0)),
        .present,
        "자정을 넘겨 야근 중이면 doneToday 가 0 이어도 남는다"
    )

    // 24시 밖 입력도 같은 시계로 접는다(기존 officeDaylight 와 같은 방어).
    t.expectEqual(officeAttendance(hour: 33, input: attendanceInput()), .present, "33시 = 9시")
    t.expectEqual(officeAttendance(hour: -1, input: attendanceInput()), .away, "-1시 = 23시")
}
```

`Sources/ConsoleCoreTests/main.swift`의 러너 호출 목록에 한 줄 추가한다 (`runOfficeIdleTests(runner)` 다음 줄):

```swift
runOfficeAttendanceTests(runner)
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
cd clients/idaeri-console && swift build 2>&1 | tail -5
```

기대: `cannot find 'officeAttendance' in scope` 등 컴파일 실패.

- [ ] **Step 3: 최소 구현을 쓴다**

`Sources/ConsoleCore/OfficeAttendance.swift`:

```swift
import Foundation

/// 조기 출근으로 인정하는 시작 시각. 이보다 이른 새벽은 "일이 돌고 있을 때만" 사람이 있다.
///
/// 5시로 잡은 근거는 원장 실측이다 — 14일간 새벽 5시에 INVEST 가 10건 돌았고 4시 이전은
/// 거의 비어 있다. 이 값을 4시로 내리면 아무도 없는 시간대에 빈 자리 판정만 늘어난다.
public let officeEarlyBirdStartHour = 5

/// 정규 출근 시각. 이 시각에 문이 열리고 나머지 인원이 들어온다.
public let officeArrivalHour = 9

/// 퇴근이 시작되는 시각. 이 시각 **부터** 일 없는 사람은 집으로 본다(20시는 아직 근무).
public let officeDepartureHour = 21

/// 지금 이 사람이 사무실에 있는가.
///
/// 걷는 중·들어오는 중 같은 과도 상태를 여기 두지 않는다. 그건 연출의 몫이고, 이 판정은
/// "있어야 하는가/없어야 하는가" 두 값만 답한다. 씬은 이 값이 바뀌는 순간을 보고 연출을 고른다.
public enum OfficeAttendance: String, Sendable, CaseIterable {
    case away
    case present
}

/// 출근 판정에 필요한 한 사람의 상태. 스냅샷에서 뽑아 넣는다.
public struct OfficeAttendanceInput: Equatable, Sendable {
    /// 진행 중인 실행이 있는가. 시각을 이기는 조건이다.
    public let hasActiveRun: Bool
    /// 오늘(KST 자정 이후) 성공으로 끝낸 건수. **밤 시간대 판정에는 쓰지 않는다** —
    /// 자정에 0 으로 리셋되므로 야근하다 자정을 넘긴 사람의 판정을 뒤집는다.
    public let doneToday: Int
    /// 대표실 앞 줄에 서 있는가. 다른 어떤 조건보다 앞선다.
    public let isQueued: Bool

    public init(hasActiveRun: Bool, doneToday: Int, isQueued: Bool) {
        self.hasActiveRun = hasActiveRun
        self.doneToday = doneToday
        self.isQueued = isQueued
    }
}

/// 이 사람이 지금 사무실에 있어야 하는가. 우선순위 순으로 판정하고 먼저 걸리면 멈춘다.
///
/// 음수와 24시 밖 입력도 같은 24시간 시계로 접는다(`officeDaylight(hour:)` 와 같은 방어).
public func officeAttendance(hour: Int, input: OfficeAttendanceInput) -> OfficeAttendance {
    // 1. 줄이 최우선. 줄 선 사람을 움직이면 대기열이 실제 상태와 어긋난다.
    if input.isQueued {
        return .present
    }
    // 2. 일하는 사람은 시각과 무관하게 자리에 있다.
    if input.hasActiveRun {
        return .present
    }
    let normalizedHour = ((hour % 24) + 24) % 24
    // 3. 정규 근무.
    if normalizedHour >= officeArrivalHour, normalizedHour < officeDepartureHour {
        return .present
    }
    // 4. 조기 출근자. 밤 시간대에는 이 규칙을 적용하지 않으므로 doneToday 의 자정 리셋이
    //    판정을 뒤집지 못한다.
    if normalizedHour >= officeEarlyBirdStartHour,
        normalizedHour < officeArrivalHour,
        input.doneToday > 0
    {
        return .present
    }
    return .away
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -15
```

기대: `OfficeAttendance` suite 전부 통과, exit 0.

- [ ] **Step 5: 커밋**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/OfficeAttendance.swift \
        clients/idaeri-console/Sources/ConsoleCoreTests/OfficeAttendanceTests.swift \
        clients/idaeri-console/Sources/ConsoleCoreTests/main.swift
git commit -m "feat(office): 시각과 실행 상태로 출근 여부를 판정하는 순수 함수"
```

---

## Task 2: 승인 방치 압력 판정

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCore/OfficeApprovalPressure.swift`
- Create: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeApprovalPressureTests.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift`

**Interfaces:**
- Consumes: 없음
- Produces: `OfficeApprovalPressure` enum (`.queued` / `.holdingPapers` / `.tapping` / `.alarm`), `officeApprovalPressure(now:createdAt:expiresAt:) -> OfficeApprovalPressure` (세 인자 모두 `TimeInterval`), 경계 상수 `officeApprovalPressureThresholds`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`Sources/ConsoleCoreTests/OfficeApprovalPressureTests.swift`:

```swift
import Foundation

@testable import ConsoleCore

func runOfficeApprovalPressureTests(_ t: TestRunner) {
    t.suite("OfficeApprovalPressure")

    let hour: TimeInterval = 3600

    // TTL 1시간 카드. 30분 경과 = 50% 소진.
    let shortLived: (TimeInterval) -> OfficeApprovalPressure = { elapsed in
        officeApprovalPressure(now: elapsed, createdAt: 0, expiresAt: hour)
    }
    t.expectEqual(shortLived(0), .queued, "방금 뜬 카드는 줄만 선다")
    t.expectEqual(shortLived(hour * 0.20), .queued, "20% 소진은 아직 1단계")
    t.expectEqual(shortLived(hour * 0.30), .holdingPapers, "30% 소진에서 서류를 든다")
    t.expectEqual(shortLived(hour * 0.60), .tapping, "60% 소진에서 발을 구른다")
    t.expectEqual(shortLived(hour * 0.90), .alarm, "90% 소진에서 경고등")

    // 같은 경과 시간이라도 TTL 이 길면 단계가 낮아야 한다. 절대 시간으로 판정하면
    // TTL 1시간 카드가 이미 만료된 뒤에 경고등이 켜진다 — 이 테스트가 그 회귀를 잡는다.
    let longLived: (TimeInterval) -> OfficeApprovalPressure = { elapsed in
        officeApprovalPressure(now: elapsed, createdAt: 0, expiresAt: hour * 24)
    }
    t.expectEqual(longLived(hour * 0.90), .queued, "TTL 24시간 카드의 54분은 아직 1단계")
    t.expectEqual(longLived(hour * 20), .alarm, "TTL 24시간 카드도 83% 소진이면 경고등")

    // 만료를 이미 지난 카드. 스냅샷과 만료 스윕 사이에 틈이 있어 실제로 들어올 수 있다.
    t.expectEqual(shortLived(hour * 2), .alarm, "만료를 지난 카드는 최고 단계")

    // 0 또는 음수 구간 방어. expiresAt <= createdAt 이면 비율을 계산할 수 없다.
    t.expectEqual(
        officeApprovalPressure(now: 10, createdAt: 100, expiresAt: 100),
        .alarm,
        "유효 구간이 0 이면 경고등으로 떨어진다"
    )
    t.expectEqual(
        officeApprovalPressure(now: 0, createdAt: 100, expiresAt: 50),
        .alarm,
        "만료가 생성보다 이르면 경고등"
    )

    // 생성 시각보다 이른 now(시계 어긋남). 음수 비율을 1단계로 접는다.
    t.expectEqual(
        officeApprovalPressure(now: 0, createdAt: 100, expiresAt: 200),
        .queued,
        "생성 전 시각은 1단계로 접는다"
    )
}
```

`main.swift`에 등록:

```swift
runOfficeApprovalPressureTests(runner)
```

- [ ] **Step 2: 실패 확인**

```bash
cd clients/idaeri-console && swift build 2>&1 | tail -5
```

기대: `cannot find 'officeApprovalPressure' in scope`.

- [ ] **Step 3: 구현**

`Sources/ConsoleCore/OfficeApprovalPressure.swift`:

```swift
import Foundation

/// 승인 카드가 얼마나 방치됐는지의 4단계. 화면 표현이 여기 대응한다.
public enum OfficeApprovalPressure: Int, Sendable, CaseIterable, Comparable {
    /// 줄에 선다(기존 동작).
    case queued = 1
    /// 손에 서류를 든다.
    case holdingPapers = 2
    /// 발을 구른다.
    case tapping = 3
    /// 대표 책상에 경고등이 켜진다.
    case alarm = 4

    public static func < (lhs: OfficeApprovalPressure, rhs: OfficeApprovalPressure) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// 단계가 올라가는 TTL 소진 비율.
///
/// **절대 경과 시간이 아니라 비율인 이유**: 카드 TTL 이 건마다 다르다(`ttlMs`, 권고 기본값
/// 1시간). "2시간 지나면 경고등" 으로 못 박으면 TTL 1시간 카드는 이미 만료된 뒤에 경고등이
/// 켜져, 가장 급한 카드에서 신호가 가장 늦게 나온다.
public let officeApprovalPressureThresholds = (
    holdingPapers: 0.25,
    tapping: 0.50,
    alarm: 0.80
)

/// 카드 하나의 방치 압력. 세 시각은 모두 기준점이 같은 초 단위 값이어야 한다.
///
/// 유효 구간(`expiresAt - createdAt`)이 0 이하면 비율을 계산할 수 없다. 그 경우 최고 단계로
/// 떨어뜨린다 — 계산 불가를 "급하지 않음" 으로 읽으면, 값이 깨진 카드가 조용히 만료된다.
public func officeApprovalPressure(
    now: TimeInterval,
    createdAt: TimeInterval,
    expiresAt: TimeInterval
) -> OfficeApprovalPressure {
    let lifespan = expiresAt - createdAt
    guard lifespan > 0 else {
        return .alarm
    }
    // 시계가 어긋나 now 가 생성보다 이를 수 있다. 음수 비율은 1단계로 접는다.
    let consumed = max(0, (now - createdAt) / lifespan)
    if consumed >= officeApprovalPressureThresholds.alarm {
        return .alarm
    }
    if consumed >= officeApprovalPressureThresholds.tapping {
        return .tapping
    }
    if consumed >= officeApprovalPressureThresholds.holdingPapers {
        return .holdingPapers
    }
    return .queued
}
```

- [ ] **Step 4: 통과 확인**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -15
```

- [ ] **Step 5: 커밋**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/OfficeApprovalPressure.swift \
        clients/idaeri-console/Sources/ConsoleCoreTests/OfficeApprovalPressureTests.swift \
        clients/idaeri-console/Sources/ConsoleCoreTests/main.swift
git commit -m "feat(office): 승인 방치를 TTL 소진 비율로 4단계 판정"
```

---

## Task 3: 승인 만료 시각을 화면까지 내려보낸다

DB 컬럼(`preview_action.expires_at`)은 이미 있다. 매퍼가 그것을 빼고 있을 뿐이다. **`pnpm db:push`를 돌리지 않는다.**

**Files:**
- Modify: `src/console/domain/console.type.ts` (`ConsoleApproval`)
- Modify: `src/console/application/console-mappers.ts:30-37`
- Modify: `clients/idaeri-console/Sources/ConsoleCore/Models.swift:148-160`
- Test: `src/console/application/console-mappers.spec.ts` (없으면 생성)

**Interfaces:**
- Consumes: Task 2의 `officeApprovalPressure`가 이 필드를 소비한다
- Produces: `ConsoleApproval.expiresAt: string` (ISO 8601), Swift `ConsoleApproval.expiresAt: String`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/console/application/console-mappers.spec.ts`에 추가 (파일이 없으면 새로 만들고 기존 spec 파일의 import 스타일을 따른다):

```ts
import { toConsoleApproval } from './console-mappers';

describe('toConsoleApproval', () => {
  it('만료 시각을 ISO 문자열로 내려준다', () => {
    const approval = toConsoleApproval({
      id: 'preview-1',
      slackUserId: 'U1',
      kind: 'NOTION_BLOG_DRAFT',
      payload: {},
      status: 'PENDING',
      responseUrl: null,
      previewText: '초안 발행',
      expiresAt: new Date('2026-08-19T12:00:00.000Z'),
      createdAt: new Date('2026-08-19T11:00:00.000Z'),
      appliedAt: null,
      cancelledAt: null,
      slackChannelId: null,
      slackMessageTs: null,
    });

    // 화면은 이 두 값의 간격으로 방치 압력을 계산한다. 하나라도 빠지면 TTL 을 알 수 없어
    // 가장 급한 카드(TTL 1시간)에서 신호가 가장 늦게 나온다.
    expect(approval.createdAt).toBe('2026-08-19T11:00:00.000Z');
    expect(approval.expiresAt).toBe('2026-08-19T12:00:00.000Z');
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm exec jest src/console/application/console-mappers.spec.ts 2>&1 | tail -12
```

기대: `expiresAt` 이 `undefined`라 실패. (`pnpm test -- <경로>`는 이 레포에서 안 먹는다 — 스크립트가 jest를 두 번 실행한다. `pnpm exec jest`를 쓴다.)

- [ ] **Step 3: 구현**

`src/console/domain/console.type.ts`의 `ConsoleApproval`에 필드를 추가한다:

```ts
/** PreviewGate 승인 대기 한 건. */
export interface ConsoleApproval {
  readonly id: string;
  readonly agentType: string | null;
  readonly title: string;
  readonly createdAt: string;
  /**
   * 이 카드가 만료되는 시각(ISO 8601).
   *
   * 화면이 방치 압력을 **경과 시간이 아니라 TTL 소진 비율**로 계산하기 때문에 필요하다.
   * TTL 은 카드 종류마다 다르므로(`ttlMs`), 만료 시각 없이는 "2시간 지났다" 가 급한 것인지
   * 여유가 있는 것인지 화면이 구분할 수 없다.
   *
   * DB 컬럼(`preview_action.expires_at`)은 원래부터 있었고 만료 스윕이 그것으로 조회한다.
   * 이 필드는 그 값을 화면까지 통과시키는 것뿐이라 스키마 변경이 없다.
   */
  readonly expiresAt: string;
}
```

`src/console/application/console-mappers.ts`:

```ts
export function toConsoleApproval(preview: PreviewAction): ConsoleApproval {
  return {
    id: preview.id,
    agentType: PREVIEW_KIND_TO_AGENT[preview.kind],
    title: preview.previewText,
    createdAt: preview.createdAt.toISOString(),
    expiresAt: preview.expiresAt.toISOString(),
  };
}
```

`clients/idaeri-console/Sources/ConsoleCore/Models.swift`:

```swift
public struct ConsoleApproval: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let agentType: String?
    public let title: String
    public let createdAt: String
    /// 만료 시각(ISO 8601). 방치 압력을 TTL 소진 비율로 재기 위해 받는다.
    public let expiresAt: String

    public init(id: String, agentType: String?, title: String, createdAt: String, expiresAt: String) {
        self.id = id
        self.agentType = agentType
        self.title = title
        self.createdAt = createdAt
        self.expiresAt = expiresAt
    }
}
```

- [ ] **Step 4: 양쪽 게이트를 통과시킨다**

```bash
pnpm exec jest src/console 2>&1 | tail -8
pnpm lint:check && pnpm build 2>&1 | tail -5
pnpm test 2>&1 | grep -E "^Tests:|^Test Suites:|FAIL" | tail -6
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -8
```

기대: 전부 green. **`ConsoleApproval` 생성자를 부르는 다른 Swift 테스트가 인자 추가로 깨질 수 있다** — 포트 확장이 mock을 깨뜨린 이력이 있으니, 컴파일 오류가 나는 호출부를 모두 고친다.

- [ ] **Step 5: 커밋**

```bash
git add src/console clients/idaeri-console/Sources/ConsoleCore/Models.swift
git commit -m "feat(console): 승인 카드 만료 시각을 화면 계약에 노출"
```

---

## Task 4: 상단 상태 줄을 카드 판 위로 올린다

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift:2065-2090` (`updateCompanySummary`)

**Interfaces:**
- Consumes: 없음 (렌더 단독 변경)
- Produces: 없음

- [ ] **Step 1: 변경 전 화면을 남긴다**

```bash
cd clients/idaeri-console && swift build && \
  IDAERI_CONSOLE_URL=http://127.0.0.1:3099 .build/arm64-apple-macosx/debug/IdaeriConsole \
  --render /tmp/hud-before.png --hour 13
```

렌더 옵션 이름이 다르면 `Sources/IdaeriConsole/OfficeSceneRender.swift`와 `main.swift`에서 실제 플래그를 확인한다. **기준선을 만들 때 현재 브랜치가 main인지 확인한다** — 자기 수정본을 기준선으로 삼은 이력이 있다.

- [ ] **Step 2: 구현**

`updateCompanySummary`를 고친다. 라벨을 그대로 두고 뒤에 판을 깐 뒤 둘을 한 holder에 담는다:

```swift
    /// 전사 요약을 화면 좌상단에 띄운다.
    func updateCompanySummary(_ agents: [ConsoleAgent]) {
        overlayLayer.childNode(withName: "summaryHUD")?.removeFromParent()
        let summary = companySummary(agents: agents)
        // "대기" 는 밀린 일감처럼 읽힌다 — 이대리에 대기 큐는 없고, 이 숫자는 **지금 맡은 일이
        // 없는 사람 수**(29명 중 27명이 예사)다. 적체로 오해하면 화면이 늘 비상처럼 보인다.
        var text =
            "진행 \(summary.inProgress)  ·  승인 \(summary.awaitingApproval)  ·  쉬는 중 \(summary.waiting)"
        if !lastSyncedSessions.isEmpty {
            // 대표 앞줄에 설 수 있는 세션은 여덟 남짓이라, 그 수가 곧 전체라고 오해하지 않게
            // 총계를 여기 적는다.
            let active = lastSyncedSessions.filter { $0.state == officeSessionActiveState }.count
            text += "  ·  내 세션 \(lastSyncedSessions.count)(도는 중 \(active))"
        }

        // 판 없이 글자만 얹으면 벽·창처럼 밝은 타일 위에서 글자가 묻힌다. 실제 화면에서
        // "내 세션 9(도는 중 5)" 가 배경에 잠겨 잘린 것처럼 보였다.
        let holder = SKNode()
        holder.name = "summaryHUD"
        holder.zPosition = officeHudZPosition

        let label = SKLabelNode(text: text)
        // 창이 작아지면 타일이 작아지는데 이 글자만 고정 크기로 남아, 사무실 대비 혼자 커 보였다.
        // 씬의 다른 글자와 같은 방식(타일 비례 + 한글 하한)으로 맞춘다.
        label.fontName = officeLabelFontName
        label.fontSize = max(officeHudMinFontSize, tileSize * 0.30)
        label.fontColor = SKColor(white: 0.96, alpha: 1)
        label.horizontalAlignmentMode = .left
        label.verticalAlignmentMode = .top
        label.position = .zero

        let textFrame = label.calculateAccumulatedFrame()
        let padding = label.fontSize * 0.55
        let plate = SKShapeNode(
            rect: CGRect(
                x: textFrame.minX - padding,
                y: textFrame.minY - padding * 0.7,
                width: textFrame.width + padding * 2,
                height: textFrame.height + padding * 1.4
            ),
            cornerRadius: label.fontSize * 0.45
        )
        plate.fillColor = SKColor(white: 0.05, alpha: 0.82)
        plate.strokeColor = SKColor(white: 1.0, alpha: 0.10)
        plate.lineWidth = 1

        holder.addChild(plate)
        holder.addChild(label)
        holder.position = CGPoint(x: 12 + padding, y: size.height - 10 - padding * 0.7)
        overlayLayer.addChild(holder)
    }
```

`officeHudZPosition`이 없으면 같은 파일의 다른 overlay zPosition 상수를 따라 정의한다 — 툴팁보다 낮고 타일보다 높게 둔다.

- [ ] **Step 3: 최소 창 폭에서도 안 잘리는지 본다**

```bash
cd clients/idaeri-console && swift build && \
  .build/arm64-apple-macosx/debug/IdaeriConsole --render /tmp/hud-after.png --hour 13 && \
  .build/arm64-apple-macosx/debug/IdaeriConsole --render /tmp/hud-narrow.png --hour 13 --size 660x820
```

창 크기 플래그는 **`--size` 하나**이고 값은 **`WIDTHxHEIGHT` 형식**이다(`main.swift:23` → `officeParseRenderSize`). 숫자 하나만 주면 파싱이 `nil` 을 돌려주고 **기본값 1400×820 으로 조용히 폴백한다** — 좁은 창을 확인했다고 착각하기 쉽다. 두 렌더의 해시나 파일 크기가 실제로 다른지 함께 확인한다. 더 좁은 배치가 필요하면 `--zone-columns 2` 를 같이 준다.

작은 창일수록 글자에 한글 하한(`officeHudMinFontSize`)이 걸려 **글자는 안 줄고 자리만 좁아진다.** 판이 화면 밖으로 나가거나 오른쪽이 잘리지 않는지 이 렌더에서 확인한다.

- [ ] **Step 4: 게이트**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -6
```

- [ ] **Step 5: 커밋**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git commit -m "fix(office): 배경에 묻히던 상단 요약 — 카드 판 위로 올린다"
```

---

## Task 5: 유휴 이름표를 흐리게 해 활성만 눈에 들어오게 한다

32명 중 29명이 `WAITING`이다. 전부 같은 회색 이름표라 어디를 봐야 할지 화면이 말해주지 않는다.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/CharacterNode.swift:176-188` (`apply(state:)`), `224-260` (`refreshNameplate`)

**Interfaces:**
- Consumes: `ConsoleAgentState` (기존)
- Produces: 없음

- [ ] **Step 1: 구현**

`CharacterNode`에 상태별 이름표 불투명도를 계산하는 private 함수를 두고 `apply(state:)`에서 적용한다. **크기·위치·글꼴은 건드리지 않는다.**

```swift
    /// 이름표 불투명도. 유휴가 스물아홉이라 전부 선명하면 활성 세 명이 묻힌다.
    ///
    /// 이름표를 **지우지는 않는다** — 누가 어디 앉아 있는지는 유휴일 때도 읽혀야 한다.
    /// 대비만 낮춰 눈이 활성 쪽으로 가게 한다.
    private func nameplateOpacity(for state: ConsoleAgentState) -> CGFloat {
        switch state {
        case .waiting:
            return 0.45
        case .completed, .inProgress, .awaitingApproval, .awaitingIntegration, .failed:
            return 1.0
        }
    }
```

`apply(state:)` 안에서 링 색을 바꾸는 기존 코드 다음에 한 줄 추가한다:

```swift
        let opacity = nameplateOpacity(for: state)
        namePlate.alpha = opacity
        nameLabel.alpha = opacity
```

`switch`를 `default` 없이 전 케이스 열거로 쓴다 — 상태가 추가될 때 컴파일러가 여기를 지적해야 한다.

- [ ] **Step 2: 렌더로 확인한다**

```bash
cd clients/idaeri-console && swift build && \
  .build/arm64-apple-macosx/debug/IdaeriConsole --render /tmp/nameplate-after.png --hour 13
```

활성(오늘 일한 사람)의 이름표만 선명한지 본다. **파라미터끼리 비교하는 테스트로는 이걸 검증할 수 없다** — 화면을 봐야 한다.

- [ ] **Step 3: 게이트**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -6
```

이름표 겹침 테스트(`OfficeNameplateFitTests`, `OfficeLabelOverlapTests`)가 계속 통과해야 한다. 투명도만 바꿨으므로 통과해야 정상이고, 깨지면 크기·위치를 건드린 것이다.

- [ ] **Step 4: 커밋**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/CharacterNode.swift
git commit -m "feat(office): 유휴 이름표를 흐리게 — 활성 인원이 먼저 눈에 들어오게"
```

---

## Task 6: 밤·저녁에 앉아 있는 사람 책상에 빛 웅덩이

`prop-desk-lamp`는 이미 개인 소품 7종 중 하나로 사람마다 고정 배치돼 있다. **소품을 바꾸지 않고 빛을 따로 그린다.**

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeLightTexture.swift` (빛 웅덩이 텍스처 추가)
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift` (`updateDaylight`, 좌석 갱신 경로)

**Interfaces:**
- Consumes: `officeDaylight(hour:)` (기존), Task 1의 `officeAttendance`는 Task 7에서 배선되므로 이 태스크는 **"앉아 있는 노드"** 를 기준으로 한다 (`characters` 중 좌석 타일에 있는 노드)
- Produces: `OfficeLightTexture.deskGlow(...)`, `OfficeScene.updateDeskLamps()`

- [ ] **Step 1: 텍스처를 추가한다**

`OfficeLightTexture`에 정적 함수를 하나 더 둔다. 이 파일은 "색이 상태를 나타내는 것은 코드로 그린다"는 원칙을 이미 명시하고 있어 PNG 자산이 필요 없다:

```swift
    /// 책상 위 빛 웅덩이. 스탠드 소품이 있든 없든 같은 그림이 나와야 하므로 소품과 무관하게
    /// 그린다 — `prop-desk-lamp` 는 개인 소품 일곱 종 중 하나라, 그것에 묶으면 일곱 중 여섯은
    /// 켤 램프가 없다.
    ///
    /// 도트 격자를 맞추는 이유는 창문과 같다. 매끈한 원을 그리면 같은 화면에서 이것만
    /// 벡터처럼 튄다.
    static func deskGlow(radius: Int, color: OfficeColor, strength: Double) -> SKTexture? {
        // 구현: side = radius * 2, dotScale 은 창문과 같은 값을 쓰고, 중심에서 바깥으로
        // strength → 0 으로 떨어지는 원형 그라디언트를 도트 단위로 채운다.
        // 기존 window(_:daylight:) 의 그리기 방식(CGContext + 도트 루프)을 그대로 따른다.
    }
```

기존 `window(_:daylight:)`의 그리기 방식을 열어 보고 같은 패턴으로 채운다. `nil` 반환 경로도 기존과 같게 둔다.

- [ ] **Step 2: 씬에 배선한다**

`OfficeScene`에 좌석 조명을 갱신하는 함수를 추가하고, `updateDaylight()` 끝에서 호출한다:

```swift
    /// 앉아 있는 사람 책상에 스탠드 빛을 켠다.
    ///
    /// 낮에는 켜지 않는다 — 창 채광이 이미 광원이라, 빛이 두 겹이 되면 어느 쪽이 광원인지
    /// 읽히지 않는다(`officeWindowLight` 의 `lampLit` 판단과 같은 이유).
    private func updateDeskLamps() {
        let daylight = officeDaylight(hour: currentHour())
        let shouldLight = daylight == .dawn || daylight == .evening || daylight == .night
        for entry in plan.desks {
            let deskNode = deskNodes[entry.desk]
            deskNode?.childNode(withName: "deskGlow")?.removeFromParent()
            guard shouldLight,
                let node = characters[entry.agentType],
                node.tile == entry.seat,
                let texture = OfficeLightTexture.deskGlow(
                    radius: officeDeskGlowRadius,
                    color: officeDeskGlowColor,
                    strength: officeDeskGlowStrength
                )
            else {
                continue
            }
            let glow = SKSpriteNode(texture: texture)
            glow.name = "deskGlow"
            glow.blendMode = .add
            glow.zPosition = officeDeskGlowZPosition
            deskNode?.addChild(glow)
        }
    }
```

**좌석 매핑은 `plan.desks`가 단일 소스다.** 각 원소가 `agentType` · `seat`(사람이 앉는 칸) · `desk`(책상 칸)를 들고 있고, 씬이 이미 이 배열로 딕셔너리를 만든다(`OfficeScene.swift:284`, `834`). `plan.seatTile(of:)` 같은 함수는 없으니 만들지 말고 이 배열을 쓴다.

책상 노드를 타일로 찾는 딕셔너리 이름은 서류 더미 코드에서 확인한다 — `desk.childNode(withName: "papers")`를 다루는 부분(`OfficeScene.swift:888` 부근)이 같은 경로를 지난다. 서류 더미가 책상 자식으로 붙는 방식을 그대로 따르면 정렬·앞뒤 순서를 다시 계산할 필요가 없다.

`updateDaylight()` 마지막에 `updateDeskLamps()` 호출을 넣고, **좌석 배치가 바뀌는 경로(sync·창 크기 변경)에서도** 같이 부른다. 창 크기 변경 시 갱신을 빠뜨려 요소가 누락된 이력이 있다.

- [ ] **Step 3: 시각별 렌더로 확인한다**

```bash
cd clients/idaeri-console && swift build && for h in 5 13 19 22; do
  .build/arm64-apple-macosx/debug/IdaeriConsole --render /tmp/lamp-$h.png --hour $h
done
```

기대: 13시에는 빛이 없고, 5·19·22시에는 앉아 있는 사람 책상에만 빛이 있다. **낮에 빛이 보이면 조건이 뒤집힌 것이다.**

- [ ] **Step 4: 게이트**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -6
```

- [ ] **Step 5: 커밋**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeLightTexture.swift \
        clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git commit -m "feat(office): 밤·저녁에 앉은 사람 책상에 스탠드 빛"
```

---

## Task 7: 출근 상태를 화면에 적용한다 (연출 없이 배치만)

이 태스크는 **걷기 연출을 넣지 않는다.** 판정 결과대로 사람이 있거나 없게만 만든다. 연출은 Task 8이다. 나누는 이유는 이 단계만으로도 "앱을 켠 순간이 맞는가"를 독립 검증할 수 있기 때문이다.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift` (sync 경로, 1분 주기 점검)

**Interfaces:**
- Consumes: Task 1의 `officeAttendance(hour:input:)`, `OfficeAttendanceInput`
- Produces: `OfficeScene.attendance(of:) -> OfficeAttendance`, `OfficeScene.applyAttendance(animated:)`

- [ ] **Step 1: 판정 입력을 모으는 경로를 만든다**

**씬은 `runs`를 보관하지 않는다** (`lastSyncedAgents` · `lastSyncedApprovals` · `lastSyncedSessions`만 있다). 진행 중 여부는 새 필드를 만들지 말고 **에이전트 상태로 판정한다** — `ConsoleAgentState.inProgress`가 그것이고, 백엔드가 이미 `runs`를 보고 그 상태를 계산해 내려준다.

스냅샷 동기화 지점(`sync(agents:approvals:rebuildPlan:)`, `OfficeScene.swift:261` 부근)에서 사람별 입력을 만든다:

```swift
    /// 스냅샷에서 이 사람의 출근 판정 입력을 뽑는다.
    ///
    /// 진행 중 여부를 `runs` 로 세지 않는다 — 씬은 runs 를 들고 있지 않고, 백엔드가 이미
    /// 그것을 보고 `state` 를 계산해 준다. 같은 것을 두 곳에서 세면 갈린다.
    private func attendanceInput(of agent: ConsoleAgent) -> OfficeAttendanceInput {
        OfficeAttendanceInput(
            hasActiveRun: agent.state == .inProgress,
            doneToday: agent.doneToday,
            isQueued: queueOrder.contains(agent.agentType)
        )
    }

    /// 이 사람이 지금 사무실에 있어야 하는가.
    private func attendance(of agent: ConsoleAgent) -> OfficeAttendance {
        officeAttendance(hour: currentHour(), input: attendanceInput(of: agent))
    }
```

- [ ] **Step 2: 판정 결과를 배치에 반영한다**

```swift
    /// 출근 판정대로 사람을 놓거나 치운다.
    ///
    /// `animated: false` 는 **앱을 켠 순간**과 창 크기 변경처럼 "지금 값을 그대로 확정" 해야
    /// 하는 경로다. 10시에 앱을 켰다고 출근 애니메이션을 소급 재생하면, 이미 일어난 일을
    /// 처음부터 다시 보여 주는 셈이 된다. 통지 구독만 걸어 두고 초기 상태를 안 맞추면
    /// 반대 방향의 같은 결함이 생긴다 — 이미 그 상태로 시작한 경우를 놓친다.
    private func applyAttendance(animated: Bool) {
        for agent in lastSyncedAgents {
            let agentType = agent.agentType
            switch attendance(of: agentType) {
            case .present where characters[agentType] == nil:
                // Task 8 이 animated == true 일 때 문에서 걸어오는 연출로 대체한다.
                spawnCharacterAtSeat(agentType)
            case .away where characters[agentType] != nil:
                // Task 8 이 animated == true 일 때 문까지 걸어가는 연출로 대체한다.
                despawnCharacter(agentType)
            default:
                continue
            }
        }
    }
```

`spawnCharacterAtSeat` / `despawnCharacter`는 기존 캐릭터 생성·제거 코드(`OfficeScene.swift:299` 부근의 `node.removeFromParent()` 경로)를 함수로 뽑아 쓴다. **제거할 때 접근성 요소도 갱신한다** — 사라진 사람이 접근성 목록에 남으면 안 된다.

- [ ] **Step 3: 시각 경계를 감지한다**

```swift
    /// 시각이 바뀌었는지 1분마다 확인한다.
    ///
    /// 씬이 멈춘 동안(창이 가려짐)에는 돌지 않는다 — 유휴 CPU 를 0.7% 까지 내려둔 상태를
    /// 이 타이머가 깨면 안 된다. 다시 보이는 순간 `applyAttendance(animated: false)` 가
    /// 상태를 맞추므로 놓친 경계는 그때 따라잡힌다.
    private func startAttendanceClock() {
        let tick = SKAction.sequence([
            SKAction.wait(forDuration: 60),
            SKAction.run { [weak self] in
                guard let self, !self.isPaused else {
                    return
                }
                let hour = self.currentHour()
                guard hour != self.lastAttendanceHour else {
                    return
                }
                self.lastAttendanceHour = hour
                self.applyAttendance(animated: true)
                self.updateDaylight()
            },
        ])
        run(SKAction.repeatForever(tick), withKey: "attendanceClock")
    }
```

씬이 처음 붙는 지점에서 `lastAttendanceHour = currentHour()`를 채우고 `applyAttendance(animated: false)`를 먼저 호출한 뒤 `startAttendanceClock()`을 시작한다.

- [ ] **Step 4: 시각별 렌더로 확인한다**

```bash
cd clients/idaeri-console && swift build && for h in 3 5 9 13 22; do
  .build/arm64-apple-macosx/debug/IdaeriConsole --render /tmp/attend-$h.png --hour $h
done
```

기대:
- 3시: 진행 중 실행이 있는 사람만 (백엔드가 조용하면 아무도 없다)
- 5시: 조기 출근자만 (`doneToday > 0`인 사람)
- 9·13시: 전원
- 22시: 진행 중 실행자만

- [ ] **Step 5: 게이트 후 커밋**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -6
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git commit -m "feat(office): 시각과 실행 상태대로 사람을 놓고 치운다"
```

---

## Task 8: 출근·퇴근 걷기 연출

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/OfficeChoreography.swift` (`VisualIntent`, `affectedAgentTypes`)
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift` (`applyAttendance`의 animated 경로)
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeChoreographyTests.swift`

**Interfaces:**
- Consumes: Task 7의 `applyAttendance(animated:)`
- Produces: `VisualIntent.arrive(agentType:)`, `VisualIntent.leave(agentType:)`

- [ ] **Step 1: 연출 의도와 우선순위 테스트를 쓴다**

`OfficeChoreographyTests.swift`에 추가:

```swift
    // 출근·퇴근은 자율 배회를 끊어야 한다. 배회 중에 퇴근 시각이 되면 사람이 사무실
    // 한가운데서 사라지거나, 문으로 가다 배회에 끌려 되돌아간다.
    t.expectEqual(
        affectedAgentTypes(of: .arrive(agentType: "PM")),
        ["PM"],
        "출근은 그 사람의 배회를 끊는다"
    )
    t.expectEqual(
        affectedAgentTypes(of: .leave(agentType: "PM")),
        ["PM"],
        "퇴근은 그 사람의 배회를 끊는다"
    )
```

- [ ] **Step 2: 실패 확인**

```bash
cd clients/idaeri-console && swift build 2>&1 | tail -5
```

기대: `.arrive` / `.leave` 가 `VisualIntent`에 없어 컴파일 실패.

- [ ] **Step 3: 연출 의도를 추가한다**

`OfficeChoreography.swift`의 `VisualIntent`에 두 케이스를 넣고 `affectedAgentTypes(of:)`에 등록한다:

```swift
    /// 출근 — 복도 끝에서 자기 좌석까지 걸어온다.
    case arrive(agentType: String)
    /// 퇴근 — 좌석에서 문까지 걸어간 뒤 화면에서 빠진다.
    case leave(agentType: String)
```

```swift
    case let .arrive(agentType), let .leave(agentType):
        return [agentType]
```

기존 `case let .recolor(agentType, _), ...` 묶음에 합쳐도 되지만, 케이스가 늘어날 때 컴파일러가 지적하도록 `default` 없이 전 케이스를 열거한 상태를 유지한다.

- [ ] **Step 4: 씬에서 연출을 실행한다**

`applyAttendance(animated: true)` 경로를 걷기로 바꾼다:

```swift
    /// 복도 끝에서 등장해 자기 좌석까지 걸어온다.
    ///
    /// 도면 밖 타일이 없으므로 "화면 밖에서 걸어온다" 는 성립하지 않는다. 복도 끝 칸에
    /// 노드를 만들고 거기서부터 걷는다.
    private func playArrival(_ entry: OfficeDeskEntry, delay: TimeInterval) {
        guard characters[entry.agentType] == nil, let entrance = plan.entranceTile else {
            return
        }
        let node = spawnCharacter(entry.agentType, at: entrance)
        node.alpha = 0
        node.run(SKAction.sequence([
            SKAction.wait(forDuration: delay),
            SKAction.fadeIn(withDuration: 0.2),
            SKAction.run { [weak self, weak node] in
                guard let self, let node else {
                    return
                }
                self.openDoorsOnPath(from: entrance, to: entry.seat)
                self.walk(node, to: entry.seat) { [weak node] in
                    node?.sit()
                }
            },
        ]))
    }
```

좌석은 `plan.desks`의 원소를 그대로 넘겨 받는다(Task 6과 같은 이유 — `plan.seatTile(of:)`는 존재하지 않는다). `OfficeDeskEntry`는 `plan.desks`의 실제 원소 타입명으로 바꾼다.

퇴근은 대칭으로 만든다 — 좌석에서 문 앞 타일까지 `walk`, 도착 콜백에서 `fadeOut` 후 `removeFromParent`.

**접근성은 이 태스크에서 건드리지 않는다.** 화면 낭독은 씬 노드가 아니라 스냅샷에서 만들어진다 — `OfficeView.swift:43`이 `officeAccessibilitySummary(...)`를 SwiftUI 접근성 라벨로 붙인다. 캐릭터 노드를 지우거나 만들어도 이 요약은 영향을 받지 않으므로 갱신 호출이 필요 없고, `refreshAccessibilityElements()` 같은 함수도 존재하지 않는다. 낭독 문구에 출근·퇴근을 반영할지는 별도 판단이며 이번 범위 밖이다.

`plan.entranceTile`이 없으면 `OfficeFloorPlan`에 복도 끝 칸을 노출하는 프로퍼티를 추가한다 (`officeCorridorColumns` / `officeCorridorRow`로 이미 계산되는 값에서 유도한다).

문 스왑은 경로가 지나는 문 타일의 스프라이트를 `doorClosed` ↔ `doorOpen`으로 바꾼다. 두 자산이 이미 있다.

- [ ] **Step 5: 계단식 등장으로 CPU 스파이크를 막는다**

9시에 26명이 동시에 길찾기를 돌면 CPU가 튄다. 자율 배회의 동시 상한(`officeStrollDefaultConcurrency` = 2, `officeStrollMaxConcurrency` = 3)은 **출근에 쓰기엔 너무 좁다** — 26명이면 아홉 배치 이상이 걸려 출근이 한없이 늘어진다.

`playArrival`의 `delay`를 사람 순서에 비례해 준다:

```swift
    /// 출근 등장 간격(초). 좁히면 CPU 가 튀고, 넓히면 출근이 끝나지 않는다.
    /// 값은 구현 중 실측으로 정한다 — 26명 입장 완료 시간과 CPU 스파이크를 함께 본다.
    private static let arrivalStagger: TimeInterval = 0.12
```

순서는 결정론적으로 정한다(부서·좌석 순). 무작위면 회차마다 화면이 달라져 렌더 비교가 성립하지 않는다.

- [ ] **Step 6: 실기에서 경계를 넘겨 본다**

`--hour`는 정적 렌더라 걷기를 볼 수 없다. 앱을 띄운 상태에서 경계를 넘겨 확인한다.

```bash
cd clients/idaeri-console && swift build && \
  IDAERI_CONSOLE_URL=http://127.0.0.1:3099 .build/arm64-apple-macosx/debug/IdaeriConsole
```

`hourOverride`를 8 → 9로 바꾸는 디버그 경로가 없으면, 임시로 `startAttendanceClock`의 대기 시간을 짧게 줄이고 시스템 시각을 옮겨 확인한 뒤 **원복한다.**

확인 항목: 문이 열리는가, 26명이 뭉치지 않고 순차로 들어오는가, 앉을 때 자세가 맞는가, 퇴근 시 좌석이 비고 의자만 남는가.

- [ ] **Step 7: 게이트 후 커밋**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -6
git add clients/idaeri-console/Sources/ConsoleCore/OfficeChoreography.swift \
        clients/idaeri-console/Sources/ConsoleCoreTests/OfficeChoreographyTests.swift \
        clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git commit -m "feat(office): 9시에 문으로 들어오고 21시에 나간다"
```

---

## Task 9: 점심시간에 자리를 비운다

실측에서 12시 실행이 9건으로 최저다(13시 72건과 대비). 배회 목적지를 탕비실·회의실로 기울인다.

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/OfficeIdle.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeIdleTests.swift`

**Interfaces:**
- Consumes: 기존 `officeStrollSpots(plan:)`
- Produces: `officeLunchHour` = 12, 목적지 선택 함수에 `hour` 인자 추가

- [ ] **Step 1: 테스트를 쓴다**

```swift
    // 점심에는 탕비실·회의실 쪽 목적지가 앞에 와야 한다. 12시 실행이 하루 최저(9건)라
    // 화면에서도 자리가 비는 시간대다.
    t.expectEqual(officeLunchHour, 12, "점심 시간대")
```

그리고 같은 후보 목록에 `hour: 12`와 `hour: 15`를 각각 넣어, 12시일 때 라운지·회의실 계열 목적지가 먼저 선택되는지 대조하는 단언을 추가한다. **목적지 이름을 하드코딩하지 말고** 해당 가구 종류로 판정한다.

- [ ] **Step 2: 실패 확인 → 구현 → 통과 확인**

```bash
cd clients/idaeri-console && swift build 2>&1 | tail -5   # 실패
# 구현 후
swift build && swift run ConsoleCoreTests 2>&1 | tail -8   # 통과
```

구현은 목적지 정렬 비교자에 점심 가중치를 더하는 것으로 한다. **결정론을 깨지 않는다** — 기존 코드가 "입력 순서가 달라도 같은 회차가 같은 결과를 낸다"를 지키고 있다.

- [ ] **Step 3: 커밋**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/OfficeIdle.swift \
        clients/idaeri-console/Sources/ConsoleCoreTests/OfficeIdleTests.swift
git commit -m "feat(office): 점심시간엔 탕비실·회의실로 기운다"
```

---

## Task 10: 승인 방치 압력을 줄에 표현한다

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift` (`layoutQueue` 부근, 1215-1242)

**Interfaces:**
- Consumes: Task 2의 `officeApprovalPressure(now:createdAt:expiresAt:)`, Task 3의 `ConsoleApproval.expiresAt`
- Produces: `OfficeScene.applyApprovalPressure()`

- [ ] **Step 1: 구현**

```swift
    /// 줄 선 사람의 자세를 방치 단계에 맞춘다.
    ///
    /// **단계가 오를 때만 갱신한다.** 폴링마다 다시 걸면 자세와 소품이 5초 주기로 깜빡인다
    /// (책상 소품이 결정론적 선택을 쓰는 것과 같은 이유).
    private func applyApprovalPressure() {
        let now = Date().timeIntervalSince1970
        for approval in lastSyncedApprovals {
            guard let agentType = approval.agentType,
                let node = characters[agentType],
                let createdAt = officeParseIsoDate(approval.createdAt),
                let expiresAt = officeParseIsoDate(approval.expiresAt)
            else {
                continue
            }
            let pressure = officeApprovalPressure(
                now: now,
                createdAt: createdAt,
                expiresAt: expiresAt
            )
            guard lastAppliedPressure[agentType] != pressure else {
                continue
            }
            lastAppliedPressure[agentType] = pressure
            switch pressure {
            case .queued:
                node.endInteraction()
            case .holdingPapers:
                node.beginInteraction(pose: .carryingPapers, facing: .up)
            case .tapping:
                node.beginInteraction(pose: .carryingPapers, facing: .up)
                node.startWaitTap()
            case .alarm:
                node.beginInteraction(pose: .carryingPapers, facing: .up)
                node.startWaitTap()
            }
        }
        // 줄에서 빠진 사람의 단계 기록을 지운다. 남겨 두면 다음에 같은 사람이 줄에 섰을 때
        // 단계가 이미 올라간 것으로 보여 1단계 표현을 건너뛴다.
        let queued = Set(lastSyncedApprovals.compactMap(\.agentType))
        lastAppliedPressure = lastAppliedPressure.filter { queued.contains($0.key) }
    }
```

`officeParseIsoDate`가 없으면 기존 ISO 문자열 파싱 경로를 찾아 쓴다 (`ConsoleStore`가 이미 날짜 문자열을 다룬다). 없으면 `ConsoleCore`에 순수 함수로 하나 두고 테스트를 붙인다.

`applyApprovalPressure()`를 `reconcileQueue` 뒤와 스냅샷 동기화 뒤에 호출한다. **`Date()`를 여기서 직접 쓰는 것은 허용된다** — 이 값은 시각대 판정이 아니라 경과 시간이고, `--hour` 렌더는 승인 0건 상태라 압력 표현을 검증 대상으로 삼지 않는다.

- [ ] **Step 2: 실제 카드로 확인한다**

승인 카드를 하나 띄우고 줄이 서는지, 시간이 지나며 단계가 오르는지 본다. 실카드를 기다릴 수 없으면 `expiresAt`이 짧은 테스트 카드를 만들어 몇 분 안에 네 단계를 통과시킨다.

기대: 1단계 → 서류 → 발 구르기. **단계가 오를 때만 자세가 바뀌고, 폴링마다 깜빡이지 않아야 한다.**

- [ ] **Step 3: 게이트 후 커밋**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -6
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git commit -m "feat(office): 방치된 승인일수록 줄의 신호가 세진다"
```

---

## Task 11: 대표 책상 경고등

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeLightTexture.swift`
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift`

**Interfaces:**
- Consumes: Task 2의 `OfficeApprovalPressure`, Task 6의 `OfficeLightTexture.deskGlow`
- Produces: `OfficeScene.updatePresidentAlarm(_:)`

- [ ] **Step 1: 구현**

Task 6의 `deskGlow`를 빨간 색으로 재사용한다. **PNG 자산을 만들지 않는다.**

**등을 붙이는 대상은 대표 캐릭터 노드다** — 씬이 들고 있는 것은 `private var president: SKSpriteNode?`(`OfficeScene.swift:105`)이고, 대표 전용 책상 노드를 따로 참조하는 필드는 없다. 대표는 `plan.desks`에 들어가지 않으므로(사규가 배정한 좌석이 아니다) Task 6의 책상 경로를 쓸 수 없다. 등은 대표 스프라이트의 자식으로 붙이고 위쪽으로 조금 띄운다.

```swift
    /// 승인이 만료 임박까지 방치되면 대표 책상에 경고등을 켠다.
    ///
    /// 배치 코드를 반드시 함께 넣는다 — 등록만 하고 배치를 빠뜨리면 조용히 화면에 안 나온다
    /// (`prop-*.png` 일곱 장이 그렇게 방치돼 있었다).
    private func updatePresidentAlarm(_ highest: OfficeApprovalPressure?) {
        president?.childNode(withName: "approvalAlarm")?.removeFromParent()
        guard highest == .alarm,
            let desk = president,
            let texture = OfficeLightTexture.deskGlow(
                radius: officeAlarmGlowRadius,
                color: officeAlarmGlowColor,
                strength: officeAlarmGlowStrength
            )
        else {
            return
        }
        let alarm = SKSpriteNode(texture: texture)
        alarm.name = "approvalAlarm"
        alarm.blendMode = .add
        alarm.zPosition = officeDeskGlowZPosition
        // 깜빡임은 느리게 — 빠른 점멸은 관제 화면에서 눈을 피로하게 하고, 접근성상
        // 초당 3회를 넘기면 안 된다.
        alarm.run(SKAction.repeatForever(SKAction.sequence([
            SKAction.fadeAlpha(to: 0.35, duration: 1.1),
            SKAction.fadeAlpha(to: 1.0, duration: 1.1),
        ])))
        desk.addChild(alarm)
    }
```

`applyApprovalPressure()` 끝에서 가장 높은 단계를 구해 넘긴다. 승인이 0건이면 `nil`을 넘겨 등을 끈다.

- [ ] **Step 2: 확인**

승인 카드 하나를 `expiresAt`이 임박한 상태로 만들어 등이 켜지는지, 승인·거절·만료 뒤에 꺼지는지 본다. **꺼지는 것까지 확인한다** — 켜지는 것만 보면 만료 후에도 남는 결함을 놓친다.

- [ ] **Step 3: 게이트 후 커밋**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -6
git add clients/idaeri-console/Sources/IdaeriConsole/OfficeLightTexture.swift \
        clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift
git commit -m "feat(office): 만료 임박 승인은 대표 책상 경고등으로 조른다"
```

---

## Task 12: 회귀 방지 — 착석 인원을 숫자로 단언한다

렌더 비교만으로는 **안 그린 것을 정상으로 본다.** 인원 수를 직접 세는 단언을 남긴다.

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeAttendanceScenarioTests.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift`

**Interfaces:**
- Consumes: Task 1의 `officeAttendance`, Task 3의 `ConsoleApproval`
- Produces: 없음

- [ ] **Step 1: 시나리오 테스트를 쓴다**

운영 표본(32명)을 만들어 시각별 착석 인원을 센다. 표본은 기존 테스트가 쓰는 공용 표본을 재사용한다 — `OfficeIdleTests`가 "표본을 하나로 합쳐 두 검증이 같은 배치를 본다"는 이유로 공용 표본을 쓰고 있다.

```swift
func runOfficeAttendanceScenarioTests(_ t: TestRunner) {
    t.suite("OfficeAttendance 시나리오")

    // 실측 표본: 32명 중 6명만 오늘 처리 기록이 있다(2026-08-19 스냅샷).
    let doneToday: [String: Int] = [
        "PM": 1, "CODE_REVIEWER": 4, "SUBCONSCIOUS_GATE": 3,
        "HUMANIZER": 2, "INVEST": 1, "CTO_STUDY": 1,
    ]
    let allAgentTypes = officeScenarioAgentTypes  // 공용 표본에서 가져온다

    func seatedCount(hour: Int, activeRuns: Set<String> = []) -> Int {
        allAgentTypes.filter { agentType in
            officeAttendance(
                hour: hour,
                input: OfficeAttendanceInput(
                    hasActiveRun: activeRuns.contains(agentType),
                    doneToday: doneToday[agentType] ?? 0,
                    isQueued: false
                )
            ) == .present
        }.count
    }

    // 이 단언들이 잡는 회귀: 출근 규칙이 통째로 빠져 "아무도 안 그려지는" 상태.
    // 렌더 이미지 비교로는 빈 사무실이 밤 화면과 구분되지 않아 통과해 버린다.
    t.expectEqual(seatedCount(hour: 3), 0, "새벽 3시, 도는 일이 없으면 아무도 없다")
    t.expectEqual(seatedCount(hour: 3, activeRuns: ["INVEST"]), 1, "새벽 3시 야근자 한 명")
    t.expectEqual(seatedCount(hour: 6), doneToday.count, "새벽 6시엔 조기 출근자만")
    t.expectEqual(seatedCount(hour: 13), allAgentTypes.count, "오후 1시엔 전원")
    t.expectEqual(seatedCount(hour: 20), allAgentTypes.count, "저녁 8시까지 전원")
    t.expectEqual(seatedCount(hour: 22), 0, "밤 10시엔 도는 일이 없으면 아무도 없다")
}
```

`officeScenarioAgentTypes`가 없으면 기존 테스트가 쓰는 표본 생성 함수를 찾아 그 이름을 쓴다. **새 표본을 따로 만들지 않는다** — 표본이 갈리면 두 검증이 다른 배치를 보게 되고, 방이 하나뿐인 평면도로 결함을 통과시킨 이력이 있다.

`main.swift`에 등록:

```swift
runOfficeAttendanceScenarioTests(runner)
```

- [ ] **Step 2: 가드가 실제로 잡는지 확인한다**

일부러 깨뜨려 본다. `officeAttendance`의 규칙 3(`normalizedHour >= officeArrivalHour`)을 주석 처리하고 테스트를 돌린다.

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -10
```

기대: "오후 1시엔 전원" 단언이 실패한다. **실패를 확인한 뒤 원복한다.** 깨뜨려 보지 않은 가드는 가드인지 알 수 없다.

- [ ] **Step 3: 전체 게이트**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests 2>&1 | tail -8
cd ../.. && pnpm lint:check && pnpm test 2>&1 | grep -E "^Tests:|^Test Suites:|FAIL" | tail -4 && pnpm build 2>&1 | tail -3
```

- [ ] **Step 4: 시각별 렌더를 최종 대조한다**

```bash
cd clients/idaeri-console && for h in 3 5 9 12 13 19 22; do
  .build/arm64-apple-macosx/debug/IdaeriConsole --render /tmp/final-$h.png --hour $h
done
```

일곱 장을 순서대로 열어, 하루가 흐르는 것으로 읽히는지 본다.

- [ ] **Step 5: 커밋**

```bash
git add clients/idaeri-console/Sources/ConsoleCoreTests/
git commit -m "test(office): 시각별 착석 인원을 숫자로 단언"
```

---

## Self-Review 결과

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| §5.1 출근 판정 다섯 규칙 | Task 1 |
| §5.2 `currentHour()` 경유 | Task 7 (Global Constraints에도 명시) |
| §5.3 판정은 화면, 백엔드는 원자료 | Task 3 (필드만 노출, 판정 없음) |
| §5.4 TTL 소진 비율 4단계 | Task 2, 10 |
| §5.5 조명은 소품과 분리 | Task 6 |
| §5.6 연출 우선순위 | Task 8 (`affectedAgentTypes` 등록) |
| §5.7 시작 시 연출 없이 확정 | Task 7 (`applyAttendance(animated: false)`) |
| §6.2 입·퇴장, 문 스왑, 계단식, 접근성 | Task 8 |
| §6.3 절전 정책 | Task 7 (`isPaused` 확인) |
| §7 압력 계단, 램프 | Task 10, 11 |
| §8 HUD·이름표·조명 | Task 4, 5, 6 |
| §10 렌더 검증 + 인원 단언 | Task 12 |
| 점심 가중치 | Task 9 |

**의도적으로 남긴 미확정 두 곳** — 코드를 열어야 정해지는 값이라 계획에 못 박지 않았다.

1. `OfficeLightTexture.deskGlow`의 그리기 본문 (Task 6 Step 1). 기존 `window(_:daylight:)`의 도트 루프 방식을 따라야 하는데 그 함수 본문을 읽지 않았다. 구현자가 같은 파일에서 확인한다.
2. 출근 등장 간격 `arrivalStagger` (Task 8 Step 5). 26명 입장 완료 시간과 CPU 스파이크를 함께 봐야 정해지는 값이라 실측으로 남겼다.

**코드로 확인해 계획에 반영한 것** — 처음 가정과 달랐던 항목이다.

| 처음 가정 | 실제 | 반영 위치 |
|---|---|---|
| `--width` / `--height` | **`--size` 하나뿐** (`main.swift:23`) | Task 4 |
| `plan.seatTile(of:)` | 없음. **`plan.desks`의 `agentType` · `seat` · `desk`** 가 단일 소스 | Task 6, 8 |
| `presidentDeskNode` | 없음. **`president: SKSpriteNode?`** (대표 캐릭터 노드, 책상 아님) | Task 11 |
| `refreshAccessibilityElements()` | 없음. 낭독은 **스냅샷 기반** `officeAccessibilitySummary`(`OfficeView.swift:43`) — 노드 생성·삭제와 무관 | Task 8 (해당 단계 삭제) |
| `lastSyncedRuns` | 없음. 진행 중 여부는 **`agent.state == .inProgress`** 로 판정 | Task 7 |
| `PreviewAction.expiresAt` 스키마 추가 필요 | **이미 있는 컬럼**. 매퍼가 안 내려줄 뿐 → `db:push` 불필요 | Task 3 |
| `swift test` | **XCTest 없음.** `swift run ConsoleCoreTests` 가 게이트 | Global Constraints |
| 동시 배회 4명 | **기본 2명 · 상한 3명** — 출근에 그대로 쓰면 26명이 아홉 배치 | Task 8 |

**아직 이름을 못 박지 못한 것** — 구현자가 해당 파일에서 확인한다: 책상 타일 → 노드 딕셔너리 이름(서류 더미 코드 `OfficeScene.swift:888` 부근), `plan.desks`의 원소 타입명, `plan.entranceTile`(없으면 신설), `officeParseIsoDate`(없으면 Core에 신설), `officeScenarioAgentTypes`(기존 공용 표본의 실제 이름).
