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
