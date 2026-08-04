import Foundation

/// 감독관 호출 주기(초). 프레임 루프가 아니라 "기다림 → 감독관 → 재생" 반복이다.
public let officeStrollTickSeconds: Double = 8
/// 동시 배회 인원 기본값. 27명이 한꺼번에 움직이면 사무실이 아니라 난장판이다.
public let officeStrollDefaultConcurrency: Int = 2
/// 동시 배회 인원 상한. 이 값을 넘겨 요청해도 여기서 잘린다.
public let officeStrollMaxConcurrency: Int = 3
/// 같은 사람이 다시 배회하기까지 쉬는 시간(초).
public let officeStrollCooldownSeconds: Double = 90

/// 자율 배회 후보 한 명의 상태 요약. SpriteKit 상태를 순수 판정 경계 밖으로 밀어낸다.
public struct OfficeIdleCandidate: Equatable, Sendable {
    public let agentType: String
    public let state: ConsoleAgentState
    /// 대표실 앞에 줄 선 사람을 움직이면 대기열이 실제 상태와 달라진다.
    public let isQueued: Bool
    /// 이벤트 연출이나 앞선 배회와 경합하지 않게 현재 걸음을 제외한다.
    public let isWalking: Bool
    /// 스냅샷이 아직 waiting이어도 방금 접수된 지시가 있으면 관제 신호가 우선한다.
    public let hasPendingWork: Bool
    /// 같은 사람의 잦은 왕복을 막기 위한 마지막 배회 시작 시각이다.
    public let lastStrollAt: Double?

    public init(
        agentType: String,
        state: ConsoleAgentState,
        isQueued: Bool,
        isWalking: Bool,
        hasPendingWork: Bool,
        lastStrollAt: Double?
    ) {
        self.agentType = agentType
        self.state = state
        self.isQueued = isQueued
        self.isWalking = isWalking
        self.hasPendingWork = hasPendingWork
        self.lastStrollAt = lastStrollAt
    }
}

/// 관제 정확성을 해치지 않는 좁은 조건을 전부 만족할 때만 한가한 사람으로 본다.
public func officeIsIdle(
    _ candidate: OfficeIdleCandidate,
    now: Double,
    cooldown: Double
) -> Bool {
    guard candidate.state == .waiting,
          !candidate.isQueued,
          !candidate.isWalking,
          !candidate.hasPendingWork
    else {
        return false
    }
    guard let lastStrollAt = candidate.lastStrollAt else {
        return true
    }
    return now - lastStrollAt >= cooldown
}

/// 오래 움직이지 않은 사람부터 고르면 입력 순서가 달라도 같은 회차가 같은 결과를 낸다.
public func officeStrollPicks(
    candidates: [OfficeIdleCandidate],
    activeStrollCount: Int,
    now: Double,
    cooldown: Double = officeStrollCooldownSeconds,
    maxConcurrent: Int = officeStrollDefaultConcurrency
) -> [String] {
    let clampedMaximum = min(max(maxConcurrent, 1), officeStrollMaxConcurrency)
    let remaining = clampedMaximum - activeStrollCount
    guard remaining > 0 else {
        return []
    }

    return candidates
        .filter { officeIsIdle($0, now: now, cooldown: cooldown) }
        .sorted { left, right in
            let leftStrollAt = left.lastStrollAt ?? -Double.greatestFiniteMagnitude
            let rightStrollAt = right.lastStrollAt ?? -Double.greatestFiniteMagnitude
            if leftStrollAt != rightStrollAt {
                return leftStrollAt < rightStrollAt
            }
            return left.agentType < right.agentType
        }
        .prefix(remaining)
        .map(\.agentType)
}

/// 가구 앞 통로만 목적지로 써야 캐릭터가 가구 위에 서서 겹쳐 보이지 않는다.
public struct OfficeStrollSpot: Equatable, Sendable {
    public let kind: FurnitureKind
    public let tile: TilePoint
    public let dwellSeconds: Double

    public init(kind: FurnitureKind, tile: TilePoint, dwellSeconds: Double) {
        self.kind = kind
        self.tile = tile
        self.dwellSeconds = dwellSeconds
    }
}

/// 평면도 가구 순서를 보존해 목적지 카탈로그도 실행마다 같은 순서를 유지한다.
public func officeStrollSpots(plan: OfficeFloorPlan) -> [OfficeStrollSpot] {
    let seatTiles = Set(plan.desks.map(\.seat))
    var usedTiles: Set<TilePoint> = []
    var spots: [OfficeStrollSpot] = []

    for placement in plan.furniture {
        guard let dwellSeconds = placement.kind.strollDwellSeconds else {
            continue
        }
        let neighbors = [
            TilePoint(x: placement.tile.x, y: placement.tile.y - 1),
            TilePoint(x: placement.tile.x - 1, y: placement.tile.y),
            TilePoint(x: placement.tile.x + 1, y: placement.tile.y),
            TilePoint(x: placement.tile.x, y: placement.tile.y + 1),
        ]
        guard let tile = neighbors.first(where: {
            plan.walkable.contains($0) && !seatTiles.contains($0)
        }), usedTiles.insert(tile).inserted else {
            continue
        }
        spots.append(
            OfficeStrollSpot(kind: placement.kind, tile: tile, dwellSeconds: dwellSeconds)
        )
    }
    return spots
}

/// 프로세스마다 달라지는 Swift Hasher 대신 유니코드 스칼라 합과 회차만 섞는다.
public func officeStrollSpot(
    for agentType: String,
    round: Int,
    spots: [OfficeStrollSpot],
    occupied: Set<TilePoint>
) -> OfficeStrollSpot? {
    let candidates = spots.filter { !occupied.contains($0.tile) }
    guard !candidates.isEmpty else {
        return nil
    }
    let scalarSum = agentType.unicodeScalars.reduce(0) { $0 + Int($1.value) }
    let remainder = (scalarSum + round) % candidates.count
    let index = remainder >= 0 ? remainder : remainder + candidates.count
    return candidates[index]
}

// MARK: - 회의

/// 회의실에 모였을 때 머무는 시간(초). 배회 머무름(3~8초)보다 길다 — 여럿이 모이는 데
/// 걸리는 시간(먼 부서에서 20칸 넘게 걸어온다)을 감안하지 않으면, 늦게 온 사람이 도착하는
/// 순간 이미 회의가 끝나 있다.
public let officeMeetingDwellSeconds: Double = 9

/// 회의를 열 최소 참여 인원. 둘뿐이면 기존 1:1 전달 연출이 더 읽기 쉽다 —
/// 두 사람이 각자 자리에서 회의실까지 왕복하는 동안 화면에는 아무 일도 일어나지 않는다.
public let officeMeetingMinimumParticipants = 3

/// 회의실 테이블 둘레의 설 자리(순수). 테이블 칸 자체는 막혀 있으므로 인접한 통행 칸을 쓴다.
///
/// 좌표 순서를 고정해(y 내림차순 → x 오름차순) 같은 참여자 목록이면 늘 같은 자리에 선다.
/// 실행마다 자리가 바뀌면 회의가 열릴 때마다 사람들이 다른 모양으로 흩어져, 같은 사건인지
/// 알아보기 어렵다.
public func officeMeetingSeats(plan: OfficeFloorPlan) -> [TilePoint] {
    guard let room = plan.commonAreas.first(where: { $0.kind == .meeting }) else {
        return []
    }
    let tables = plan.furniture.filter { placement in
        placement.kind == .meetingTable
            && placement.tile.x >= room.originX
            && placement.tile.x < room.originX + room.width
            && placement.tile.y >= room.labelY
    }
    guard !tables.isEmpty else {
        return []
    }
    var seats: Set<TilePoint> = []
    for table in tables {
        let size = table.kind.footprint
        for offsetY in 0..<size.height {
            let row = table.tile.y + offsetY
            seats.insert(TilePoint(x: table.tile.x - 1, y: row))
            seats.insert(TilePoint(x: table.tile.x + 1, y: row))
        }
        seats.insert(TilePoint(x: table.tile.x, y: table.tile.y - 1))
        seats.insert(TilePoint(x: table.tile.x, y: table.tile.y + size.height))
    }
    let tableTiles = Set(
        tables.flatMap { table in
            (0..<table.kind.footprint.height).map {
                TilePoint(x: table.tile.x, y: table.tile.y + $0)
            }
        }
    )
    return seats
        .filter { plan.walkable.contains($0) && !tableTiles.contains($0) }
        .sorted { left, right in
            left.y == right.y ? left.x < right.x : left.y > right.y
        }
}

/// 이 실행이 속한 체인의 참여자(조상부터 자신까지, 중복 제거).
///
/// `parentId` 를 거슬러 올라간다. 순환하거나 비정상적으로 긴 체인에서 멈추도록 상한을 둔다 —
/// 화면 연출 하나 때문에 스냅샷 적용이 멈추면 관제 화면 전체가 얼어붙는다.
public func officeChainParticipants(run: ConsoleRun, runs: [ConsoleRun]) -> [String] {
    let runsById = Dictionary(runs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    var ancestors: [String] = []
    var visitedRunIds: Set<String> = [run.id]
    var cursor: ConsoleRun? = run
    while let current = cursor, ancestors.count < 16 {
        ancestors.append(current.agentType)
        guard let parentId = current.parentId, visitedRunIds.insert(parentId).inserted else {
            break
        }
        cursor = runsById[parentId]
    }
    // 조상 → 자신 순으로 뒤집고, 같은 사람이 체인에 두 번 나오면 처음 자리만 남긴다.
    var seenAgents: Set<String> = []
    return ancestors.reversed().filter { seenAgents.insert($0).inserted }
}

/// 대기 중 숨쉬기의 한 주기(초). 위상 계산과 씬의 동작 길이가 같은 값을 봐야 한다.
public let officeBreathCycleSeconds: Double = 3.4

/// 사람마다 다른 숨쉬기 시작 위상(초).
///
/// 27명이 같은 순간에 같은 주기로 오르내리면 사람이 아니라 군무로 보인다 — 스프라이트가
/// 한 장뿐이라 "다 똑같아 보인다" 는 인상을 숨쉬기가 한 번 더 강화한다. 위상만 어긋내도
/// 같은 그림이 서로 다른 순간에 움직여 개체로 읽힌다.
///
/// 프로세스마다 달라지는 Swift `Hasher` 대신 유니코드 스칼라 합을 쓴다(배회 목적지 선택과
/// 같은 이유) — 실행마다 같은 사람이 같은 위상을 갖는다.
public func officeBreathPhaseSeconds(agentType: String) -> Double {
    let scalarSum = agentType.unicodeScalars.reduce(0) { $0 + Int($1.value) }
    let steps = 17
    return Double(scalarSum % steps) / Double(steps) * officeBreathCycleSeconds
}

/// 시각 경계를 네 구간으로만 유지해 씬이 달력 판정을 중복하지 않게 한다.
public enum OfficeAmbience: String, Equatable, Sendable {
    case morning
    case day
    case evening
    case night
}

/// SpriteKit 색 타입을 Core로 끌어들이지 않으면서 색 막 계약을 전달한다.
public struct OfficeAmbienceTint: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double
    public let alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }
}

/// 음수와 24시 밖 입력도 같은 24시간 시계로 접어 경계 판정이 흔들리지 않게 한다.
public func officeAmbience(hour: Int) -> OfficeAmbience {
    let normalizedHour = ((hour % 24) + 24) % 24
    switch normalizedHour {
    case 6...8:
        return .morning
    case 9...17:
        return .day
    case 18...21:
        return .evening
    default:
        return .night
    }
}

/// 활동 인원이 없으면 구간색을 바꾸지 않고 알파만 올려 빈 사무실 신호를 보존한다.
public func officeAmbienceTint(hour: Int, activeCount: Int) -> OfficeAmbienceTint {
    let base: OfficeAmbienceTint
    switch officeAmbience(hour: hour) {
    case .morning:
        base = OfficeAmbienceTint(red: 1.00, green: 0.86, blue: 0.55, alpha: 0.10)
    case .day:
        base = OfficeAmbienceTint(red: 0.20, green: 0.22, blue: 0.30, alpha: 0.00)
    case .evening:
        base = OfficeAmbienceTint(red: 1.00, green: 0.55, blue: 0.25, alpha: 0.14)
    case .night:
        base = OfficeAmbienceTint(red: 0.20, green: 0.28, blue: 0.62, alpha: 0.26)
    }
    guard activeCount == 0 else {
        return base
    }
    return OfficeAmbienceTint(
        red: base.red,
        green: base.green,
        blue: base.blue,
        alpha: base.alpha + 0.08
    )
}
