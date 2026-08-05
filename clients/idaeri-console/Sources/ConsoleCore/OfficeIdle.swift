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
    // 문 칸은 통행 가능하지만 **머물 수는 없다.**
    //
    // 문 자신을 목적지에서 뺀 것(`strollDwellSeconds == nil`)만으로는 부족하다. 목적지는
    // 가구가 놓인 칸이 아니라 그 **앞 칸**이라, 문 바로 위 벽에 걸린 물건이 자기 앞자리로
    // 문 칸을 고른다 — 첫 이웃 후보가 (x, y-1) 이고 문 칸은 통행 가능하기 때문이다.
    // 리뷰방 화이트보드(24,11)가 (24,10) 을, 성장방 화이트보드(12,4)가 (12,3) 을 그렇게
    // 잡았다. 방의 유일한 출입구라, 거기 서서 4초를 보내면 그동안 드나드는 사람이 전부
    // 그 사람을 통과해 지나가는 그림이 된다.
    let doorTiles = Set(plan.furniture.filter { $0.kind.isDoorway }.map(\.tile))
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
            plan.walkable.contains($0) && !seatTiles.contains($0) && !doorTiles.contains($0)
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

// MARK: - 내 작업 세션

/// 세션이 "돌고 있다" 로 취급되는 백엔드 상태 문자열.
public let officeSessionActiveState = "active"

/// 대표실 안쪽 줄의 **작업 책상** 자리(왼쪽부터).
///
/// 세션은 대표가 직접 띄운 편집기 창이다. 사규가 배정한 일이 아니라 **대표 본인의 작업**이므로
/// 사람으로 세우지 않는다 — 창 하나당 사람 하나를 세웠더니 없던 직원이 갑자기 생겼다 사라지는
/// 화면이 됐고, 다섯이 한 줄로 앉으면 사무실이 아니라 대기실로 보였다. 대신 대표 책상 위에서
/// 화면이 켜진다.
///
/// 평면도에 실제로 놓인 책상을 읽는다. 좌표를 여기서 다시 계산하면 평면도가 바뀌었을 때
/// 조용히 어긋나 — 화면에 없는 책상 위에 이름표만 뜬다.
public func officeSessionDesks(plan: OfficeFloorPlan) -> [TilePoint] {
    guard let room = plan.commonAreas.first(where: { $0.kind == .president }) else {
        return []
    }
    let row = plan.presidentTile.y
    return plan.furniture
        .filter { placement in
            placement.kind == .desk && placement.tile.y == row
                && placement.tile.x >= room.originX
                && placement.tile.x < room.originX + room.width
        }
        .map(\.tile)
        .sorted { $0.x < $1.x }
}

/// 이보다 오래 조용한 세션은 **일이 끝난 것으로 본다**(화면에서 내린다).
///
/// 백엔드의 `active` 판정은 60초짜리라 잠깐 생각하는 동안에도 꺼진다. 그 기준으로 화면에서
/// 지우면 답변 한 번 기다리는 사이에 사라졌다 나타나기를 반복한다 — 60초보다 훨씬 길게 잡아,
/// 잠시 멈춘 것과 끝난 것을 가른다.
public let officeSessionLeaveAfterSeconds: Double = 900

/// 퇴근 판정을 다시 따지는 간격.
///
/// 이 판정은 **시간이 흐르기만 해도 결과가 바뀐다** — 세션 목록이 그대로여도 조용한 시간이
/// 자라 15분을 넘긴다. 그런데 화면 갱신은 세션 이벤트에 걸려 있어서, 조용한 세션은 목록이
/// 바뀌지 않아 이벤트가 오지 않는다. 시간축으로도 한 번씩 훑지 않으면 퇴근할 사람이 다음
/// 무관한 이벤트가 올 때까지 자리에 남는다.
///
/// 15분 기준에 견줘 30초는 무시할 만한 지연이고, 훑는 일 자체는 세션 몇 개를 다시 배치하는
/// 정도라 프레임에 부담이 되지 않는다.
public let officeSessionSweepIntervalSeconds: Double = 30

/// 세션이 마지막으로 뭔가 한 뒤 흐른 시간. 활동 기록이 없으면 띄운 시각부터 잰다.
public func officeSessionQuietSeconds(_ session: ConsoleSession, now: Date) -> Double? {
    let stamp = session.lastActivityAt ?? session.startedAt
    guard let last = parseISODate(stamp) else {
        return nil
    }
    return max(0, now.timeIntervalSince(last))
}

/// 아직 사무실에 남아 있는 세션인가. 조용한 지 오래면 퇴근한 것으로 본다.
///
/// 시각을 못 읽는 경우는 **남긴다.** 읽기 실패로 사람을 지우면 화면에서 조용히 사라지는데,
/// 그건 정확히 이 기능이 없애려는 현상이다.
public func officeSessionIsPresent(_ session: ConsoleSession, now: Date) -> Bool {
    guard let quiet = officeSessionQuietSeconds(session, now: now) else {
        return true
    }
    return quiet < officeSessionLeaveAfterSeconds
}

/// 책상 이름표에 쓸 짧은 이름.
///
/// 세션 이름은 실행 디렉터리에서 오므로 `personal_agents-office-window-light` 처럼 길다.
/// 자리 간격이 한 칸이라 그대로 쓰면 옆 세션 이름표와 겹쳐 **둘 다** 못 읽는다.
///
/// 뒤쪽을 남기는 이유는 앞이 대개 같은 저장소 이름이기 때문이다 — 여러 세션을 가르는 정보는
/// 뒤(워크트리·브랜치 이름)에 있다.
public func officeSessionShortName(_ name: String, limit: Int = 12) -> String {
    let trimmed = name.trimmingCharacters(in: .whitespaces)
    guard trimmed.count > limit, limit > 1 else {
        return trimmed
    }
    return "…" + String(trimmed.suffix(limit - 1))
}

/// 아직 사무실에 남아 있는 세션만 자리에 앉힌다.
///
/// 예전에는 잡히는 세션을 전부 세웠다. 며칠 전 열어 둔 편집기 창이 그대로 세션으로 남기 때문에
/// 실제로 열세 개가 잡혔고, 그중 도는 것은 셋뿐인데 나머지 열이 옅은 몸으로 대표실 앞줄을
/// 가득 메웠다 — 이름표까지 서로 겹쳐 **유령 무리**처럼 보였다.
///
/// 그렇다고 "지금 도는 것" 만 남기면 반대쪽 문제가 생긴다. 도는 판정이 60초짜리라 잠깐
/// 생각하는 사이 사람이 소리 없이 사라진다. 그래서 기준을 **오래 조용했는가**로 잡는다 —
/// 잠깐 쉬는 사람은 자리를 지키고, 일을 마친 사람은 퇴근한다.
///
/// 자리보다 많으면 넘치는 몫은 좌상단 요약의 숫자가 맡는다("내 세션 13(도는 중 3)").
public func officeVisibleSessions(
    _ sessions: [ConsoleSession], limit: Int, now: Date
) -> [ConsoleSession] {
    guard limit > 0 else {
        return []
    }
    return sessions
        .filter { officeSessionIsPresent($0, now: now) }
        // 도는 것이 먼저 자리를 잡는다. 자리가 모자랄 때 조는 사람이 앞자리를 차지하면,
        // 정작 지금 무엇이 돌고 있는지가 화면에서 밀려난다.
        .sorted { left, right in
            let leftActive = left.state == officeSessionActiveState
            let rightActive = right.state == officeSessionActiveState
            if leftActive != rightActive {
                return leftActive
            }
            return left.sessionId < right.sessionId
        }
        .prefix(limit)
        .map { $0 }
}

/// 세션을 자리에 배정한다(순수).
///
/// **이미 앉아 있던 사람은 그 자리를 지킨다.** 자리를 매번 순서대로 다시 나눠 주면, 누가 하나
/// 퇴근할 때마다 남은 사람 전원이 한 칸씩 옮겨 앉는다 — 아무 일도 없었는데 사무실이 통째로
/// 움직이는 것처럼 보인다.
///
/// 앉을 자리가 없는 세션은 배정에서 빠진다. 그 몫은 좌상단 요약의 총계가 맡는다.
public func officeAssignSessionSeats(
    sessions: [ConsoleSession],
    tiles: [TilePoint],
    previous: [String: TilePoint]
) -> [String: TilePoint] {
    let available = Set(tiles)
    var taken: Set<TilePoint> = []
    var assigned: [String: TilePoint] = [:]
    for session in sessions {
        guard let seat = previous[session.sessionId], available.contains(seat),
              !taken.contains(seat)
        else {
            continue
        }
        assigned[session.sessionId] = seat
        taken.insert(seat)
    }
    for session in sessions where assigned[session.sessionId] == nil {
        guard let free = tiles.first(where: { !taken.contains($0) }) else {
            break
        }
        assigned[session.sessionId] = free
        taken.insert(free)
    }
    return assigned
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
