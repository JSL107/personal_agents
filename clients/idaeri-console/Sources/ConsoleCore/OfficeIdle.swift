import Foundation

/// 감독관 호출 주기(초). 프레임 루프가 아니라 "기다림 → 감독관 → 재생" 반복이다.
public let officeStrollTickSeconds: Double = 8
/// 동시 배회 인원 기본값. 서른 명이 한꺼번에 움직이면 사무실이 아니라 난장판이다.
///
/// 2 였다. 상한(3)에도 못 미치는 값이라 화면에서 움직이는 사람이 서른두 명 중 둘 — 6% 였고,
/// 그 둘이 가는 곳조차 하는 일과 무관했다(`officeWorkAffinity` 참조). 목적지가 일과 이어진
/// 뒤에는 걷는 사람이 늘어도 산만해지지 않는다 — 각자 자기 물건 쪽으로 가므로 동선이
/// 방 안에서 끝난다. 더 올리려면 렌더로 동선 겹침을 먼저 볼 것.
public let officeStrollDefaultConcurrency: Int = 3
/// 동시 배회 인원 상한. 이 값을 넘겨 요청해도 여기서 잘린다.
public let officeStrollMaxConcurrency: Int = 4
/// 같은 사람이 다시 배회하기까지 쉬는 시간(초).
public let officeStrollCooldownSeconds: Double = 90
/// 점심시간(시). 이 시간에는 탕비실·회의실로 배회 목적지를 기운다.
public let officeLunchHour: Int = 12

/// 가구 앞에서 취하는 자세. 서기·앉기 그림만 있는 한계를 소품과 몸짓으로 보완한다.
public enum OfficeInteractionPose: String, Sendable, CaseIterable {
    case sitting
    case drinking
    case carryingPapers
    case writing
    case reading
    case tending
    case stowing

    /// 손 소품 이름은 Core에 둬야 렌더러 밖에서도 에셋 계약의 누락을 전수 검증할 수 있다.
    public var handPropSprite: String? {
        switch self {
        case .drinking:
            return "prop-mug"
        case .carryingPapers, .writing:
            return "prop-papers"
        case .reading, .stowing:
            return "prop-book-stack"
        case .sitting, .tending:
            return nil
        }
    }
}

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
    /// 가구 방향을 목적지와 함께 보존해야 씬이 다시 좌표를 추측하다 잘못된 쪽을 보지 않는다.
    public let facing: Facing
    public let pose: OfficeInteractionPose

    public init(
        kind: FurnitureKind,
        tile: TilePoint,
        dwellSeconds: Double,
        facing: Facing,
        pose: OfficeInteractionPose
    ) {
        self.kind = kind
        self.tile = tile
        self.dwellSeconds = dwellSeconds
        self.facing = facing
        self.pose = pose
    }
}

/// 목적지에서 가구를 바라보는 방향. 대각선은 차이가 더 큰 축을 택해 작은 오차에 흔들리지 않는다.
public func officeFacing(from tile: TilePoint, to furniture: TilePoint) -> Facing {
    let differenceX = furniture.x - tile.x
    let differenceY = furniture.y - tile.y
    if abs(differenceX) > abs(differenceY) {
        return differenceX < 0 ? .left : .right
    }
    return differenceY < 0 ? .down : .up
}

/// 라운지 자세에서 캐릭터 전체를 가구 쪽으로 옮길 scene 좌표 오프셋.
/// SpriteKit 자식별로 같은 계산을 복제하지 않도록 Core의 한 순수 경계에서 방향을 정한다.
public func officeLoungeInteractionOffset(facing: Facing, tileSize: Double) -> OfficePoint {
    let shift = tileSize * officeLoungeSpriteShift
    switch facing {
    case .left:
        return OfficePoint(x: -shift, y: 0)
    case .right:
        return OfficePoint(x: shift, y: 0)
    case .up:
        return OfficePoint(x: 0, y: shift)
    case .down:
        return OfficePoint(x: 0, y: -shift)
    }
}

/// 가구를 쓰러 설(앉을) 후보 칸. 앞쪽부터 우선순위 순서다.
///
/// **앉는 가구는 정면 칸 하나뿐이다.** 소파·테이블 그림은 정면도라, 옆 칸에서 앉히면 등받이가
/// 몸 옆으로 나와 "소파에 앉은 사람" 이 아니라 **소파 옆에 나란히 앉은 사람**이 된다(경영방
/// 소파는 정면 칸을 커피테이블이 막아 왼쪽 칸으로 밀렸고, 라운지 오프셋 0.30칸으로는 소파
/// 실루엣과 겹치지도 않았다). 정면이 막히면 그 가구는 목적지에서 빠진다 — 옆에 앉은 그림보다
/// 아무도 안 앉는 소파가 낫다.
///
/// 서서 쓰는 자세(커피머신·책장 등)는 어느 쪽에 서도 그림이 성립하므로 네 방향을 모두 쓴다.
///
/// 규칙을 `officeStrollSpots` 안에 두지 않고 꺼내는 이유는 **현재 평면도가 규칙을 가리기
/// 때문**이다. 지금 배치는 앉는 가구의 정면이 모두 열려 있어, 네 방향 탐색으로 되돌려도
/// 목적지 결과가 같다 — 평면도를 통해서만 검증하면 규칙이 사라진 것을 눈치채지 못한다.
public func officeInteractionNeighbors(
    furniture: TilePoint, pose: OfficeInteractionPose
) -> [TilePoint] {
    let front = TilePoint(x: furniture.x, y: furniture.y - 1)
    guard pose != .sitting else {
        return [front]
    }
    return [
        front,
        TilePoint(x: furniture.x - 1, y: furniture.y),
        TilePoint(x: furniture.x + 1, y: furniture.y),
        TilePoint(x: furniture.x, y: furniture.y + 1),
    ]
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
    // **걸어서 닿을 수 없는 칸은 목적지가 될 수 없다.** walkable 은 "막히지 않은 칸"이지
    // "갈 수 있는 칸"이 아니다 — 운영실에서 자판기·프린터·워터쿨러를 한 줄에 놓자 그 사이
    // 한 칸이 위(책상)·아래(벽)·좌우(가구)로 완전히 갇혔고, 그 칸이 프린터의 유일한
    // walkable 이웃이어서 목적지로 뽑혔다. 지시받은 사람은 경로가 빈 채로 남아 자기 책상에서
    // 프린터 앞 동작만 재생했고, 웹에서는 걸음이 실패한 사람이 매 틱 후보 선두를 차지해
    // 다른 사람의 배회까지 막았다.
    //
    // 기준점은 첫 좌석이다 — 좌석은 전부 도달 가능하다는 것을 도달성 테스트가 이미 지킨다.
    // 좌석이 없는 평면도(사람 0명)에서는 필터를 걸지 않는다.
    let reachable =
        plan.desks.first.map { officeReachableTiles(from: $0.seat, walkable: plan.walkable) }
    var usedTiles: Set<TilePoint> = []
    var spots: [OfficeStrollSpot] = []

    for placement in plan.furniture {
        guard let dwellSeconds = placement.kind.strollDwellSeconds,
              let pose = placement.kind.interactionPose
        else {
            continue
        }
        let neighbors = officeInteractionNeighbors(furniture: placement.tile, pose: pose)
        guard let tile = neighbors.first(where: {
            plan.walkable.contains($0) && !seatTiles.contains($0) && !doorTiles.contains($0)
                && (reachable?.contains($0) ?? true)
        }), usedTiles.insert(tile).inserted else {
            continue
        }
        spots.append(
            OfficeStrollSpot(
                kind: placement.kind,
                tile: tile,
                dwellSeconds: dwellSeconds,
                facing: officeFacing(from: tile, to: placement.tile),
                pose: pose
            )
        )
    }
    return spots
}

/// 이 사람의 일과 어울리는 가구(우선순위 순). 배회 목적지를 여기서 먼저 고른다.
///
/// **여기가 없던 동안 목적지는 이름의 문자값 합으로 정해졌다** — 사람은 움직이는데 어디로
/// 가는지가 하는 일과 아무 관계가 없어서, 학습 담당이 자판기 앞에 서 있고 시세 점검 담당이
/// 화분에 물을 주는 그림이 나왔다. 자세와 손 소품은 이미 가구가 정하고 있었으므로
/// (`FurnitureKind.interactionPose`) 비어 있던 고리는 **"누가 어디로"** 하나였다.
///
/// 무엇을 짝지었나 — 각 워커가 실제로 하는 일(백엔드 스냅샷의 `job`)을 읽고 그 일에 필요한
/// 물건으로 보냈다. 자료를 찾는 사람은 책장, 문서를 내보내는 사람은 프린터, 남의 결과를
/// 판정하는 사람은 게시판, 설계를 그리는 사람은 화이트보드, 지표를 지켜보는 사람은 벽 모니터,
/// 기록을 넣고 꺼내는 사람은 캐비닛으로 간다.
///
/// **빈 배열이면 기존 방식(문자값 합)으로 돌아간다.** 새 워커가 늘었을 때 여기 안 적혀 있어도
/// 화면이 멈추지 않게 하려는 것이다 — 다만 그 사람만 계속 무관한 곳으로 다니므로, 워커를
/// 추가할 때 이 표도 함께 보는 것이 맞다.
public func officeWorkAffinity(agentType: String) -> [FurnitureKind] {
    switch agentType {
    // 자료를 찾아 읽는다.
    case "CTO_STUDY", "PREFERENCE_LEARNING", "DOCS_AUDIT_OPTIMIZER":
        return [.bookshelf, .wallShelf]
    // 글을 써서 내보낸다.
    case "BLOG", "BLOG_PUBLISH", "WORK_REVIEWER", "EVENING_RETRO", "HUMANIZER":
        return [.printer, .filingCabinet]
    // 남이 만든 것을 검토하고 판정한다 — 체크리스트를 붙여 둔 게시판 앞.
    case "CODE_REVIEWER", "REVIEW_REPLY_JUDGE", "PO_EVAL", "DOCS_AUDIT_EVALUATOR",
        "CONTRADICTION_JUDGE", "BE_FIX":
        return [.wallPinboard, .bookshelf]
    // 구조를 그린다. 장애 원인 추적도 여기 둔다 — 스택을 따라가는 일이라 판에 그리는 쪽이
    // 맞고, 지표 화면은 개발실에 없어서 넣으면 성장방까지 걸어간다(벽 자리가 이미 셋 다 찼다).
    case "BE", "BE_SCHEMA", "BE_TEST", "BE_SRE":
        return [.wallWhiteboard, .whiteboard, .bookshelf]
    // 상태를 지켜본다 — 벽에 걸린 지표 화면.
    case "OPS_SUPERVISOR", "SUBCONSCIOUS_GATE", "INVEST", "PAPER_TRADE", "PAPER_RECOMMEND",
        "DELAY_REPORT":
        return [.wallMonitor]
    // 기록을 넣고 꺼낸다.
    case "VACATION", "JOB_APPLICATION", "CAREER_MATE", "ISSUE_LABELER":
        return [.filingCabinet, .lockers2]
    // 모여서 정하고 나눈다.
    case "PM", "CTO", "CEO", "PO_SHADOW", "IMPACT_REPORTER":
        return [.meetingTable]
    default:
        return []
    }
}

/// 두 칸 사이의 걸음 수(맨해튼). 목적지가 여럿일 때 가까운 쪽을 고르는 데 쓴다.
private func officeWalkingDistance(_ from: TilePoint, _ to: TilePoint) -> Int {
    abs(from.x - to.x) + abs(from.y - to.y)
}

/// 프로세스마다 달라지는 Swift Hasher 대신 유니코드 스칼라 합과 회차만 섞는다.
///
/// 고르는 순서는 셋이다. 점심시간(hour == 12)이면 탕비실·회의실만 본다. 그 밖에는 이 사람의
/// 일과 어울리는 가구(`officeWorkAffinity`)를 먼저 찾고, 그것도 없으면 전체에서 고른다.
/// 어느 단계에서도 후보가 비면 다음 단계로 내려가므로 목적지를 못 찾는 경우는 없다.
///
/// 카탈로그 순서를 보존해 입력 순서가 달라도 같은 회차가 같은 결과를 낸다.
public func officeStrollSpot(
    for agentType: String,
    round: Int,
    spots: [OfficeStrollSpot],
    occupied: Set<TilePoint>,
    hour: Int,
    home: TilePoint? = nil
) -> OfficeStrollSpot? {
    let candidates = spots.filter { !occupied.contains($0.tile) }
    guard !candidates.isEmpty else {
        return nil
    }

    // 점심시간이면 탕비실·회의실 목적지만 골라본다. 없으면 전체에서 고른다.
    let isLunchHour = hour == officeLunchHour
    let breakroomKinds: Set<FurnitureKind> = [
        .sofa2, .sofa3, .coffeeTable, .coffeeMachine, .waterCooler,
        .vendingMachine, .refrigerator, .sinkCounter,
    ]
    let meetingKinds: Set<FurnitureKind> = [.meetingTable]
    let lunchKinds = breakroomKinds.union(meetingKinds)

    if isLunchHour {
        // 점심 목적지가 있으면 그것만 고른다. 없으면 전체에서 고른다.
        let lunch = candidates.filter { lunchKinds.contains($0.kind) }
        return officeRotatingPick(
            from: lunch.isEmpty ? candidates : lunch, agentType: agentType, round: round
        )
    }
    // 점심이 아니면 자기 일에 필요한 물건이 먼저다. 짝지어진 가구가 없는 사람만 아래로 내려간다.
    if let affinity = officeAffinitySpot(
        agentType: agentType, candidates: candidates, home: home
    ) {
        return affinity
    }
    return officeRotatingPick(from: candidates, agentType: agentType, round: round)
}

/// 일과 어울리는 목적지 하나. 없으면 nil.
///
/// **가장 가까운 것을 고른다.** 같은 종류 가구가 여섯 방에 흩어져 있어서, 거리를 안 보면
/// 개발실 사람이 성장실 벽 모니터까지 20칸을 걸어간다 — 왕복 30초가 넘으면 화면에서는
/// "일하러 간 사람" 이 아니라 "자리를 비운 사람" 으로 읽힌다. 거리를 보면 자기 방 안의
/// 가구가 자연히 먼저 뽑히므로 방 정보를 따로 넘길 필요가 없다.
///
/// 우선순위가 높은 종류부터 보고, 그 종류가 하나도 안 남아 있으면(다른 사람이 이미 서 있으면)
/// 다음 종류로 내려간다. 거리가 같으면 카탈로그 순서 — `sorted` 가 안정 정렬이 아니라서
/// 원래 자리(offset)를 tie-break 에 넣어야 실행마다 같은 결과가 나온다.
private func officeAffinitySpot(
    agentType: String, candidates: [OfficeStrollSpot], home: TilePoint?
) -> OfficeStrollSpot? {
    for kind in officeWorkAffinity(agentType: agentType) {
        let matched = candidates.enumerated().filter { $0.element.kind == kind }
        guard !matched.isEmpty else {
            continue
        }
        guard let home else {
            return matched[0].element
        }
        return matched.min { left, right in
            let leftDistance = officeWalkingDistance(home, left.element.tile)
            let rightDistance = officeWalkingDistance(home, right.element.tile)
            if leftDistance != rightDistance {
                return leftDistance < rightDistance
            }
            return left.offset < right.offset
        }?.element
    }
    return nil
}

/// 후보를 회차마다 돌려 고른다. 짝지어진 가구가 없는 사람과 점심시간이 쓰는 경로다.
private func officeRotatingPick(
    from candidates: [OfficeStrollSpot], agentType: String, round: Int
) -> OfficeStrollSpot? {
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

/// 대표실 세션 책상의 가로 간격(칸). 이름표가 쓸 수 있는 폭이 곧 이 값이다.
/// 자리를 놓는 쪽(`OfficeFloorPlan` 의 `stride(from: 2, to: zoneWidth, by: 2)`)과 같은 수.
public let officeSessionDeskStrideTiles: Double = 2

/// 대표실 문패를 접어야 하는가.
///
/// 세션 이름표가 밴드를 사실상 덮으므로(`officeSessionDeskStrideTiles` 간격으로 놓인 책상마다
/// 두 칸 몫), 세션이 하나라도 화면에 있으면 문패가 설 자리가 없다. 세로로도 비켜설 곳이 없다 —
/// 아래로는 아래 방 말풍선을 피해 이미 올라와 있고 위로는 책상과 대표 이름표가 차 있다.
public func officeHidesPresidentPlate(sessionCount: Int) -> Bool {
    sessionCount > 0
}

/// 세션 수가 바뀐 회차에 부서·공용 문패를 다시 그려야 하는가.
///
/// 문패는 평면도·창 크기가 바뀔 때만 그려지는데 세션은 이벤트와 30초 스윕으로 바뀐다. 이
/// 판정이 없으면 첫 세션이 뜬 뒤에도 문패가 남아 겹치고, **마지막 세션이 떠난 뒤에는 문패가
/// 돌아오지 않는다**(후자가 이대리 리뷰 지적 방향이다).
///
/// 접힘 판정을 그대로 다시 쓴다 — 두 자리가 각자 조건을 들면 한쪽만 바뀔 때 조용히 갈린다.
public func officeNeedsPlateRedraw(previousSessionCount: Int, currentSessionCount: Int) -> Bool {
    officeHidesPresidentPlate(sessionCount: previousSessionCount)
        != officeHidesPresidentPlate(sessionCount: currentSessionCount)
}

/// 라틴 글자 한 자의 **평균** 폭 ÷ 글자 크기. `AppleSDGothicNeo-Bold` 의 영문·숫자 실측 근사
/// (렌더에서 9자 라벨이 53.5px, 글자 크기 11px).
///
/// **평균이지 상한이 아니다.** 세션 이름은 실행 디렉터리에서 오므로 대개 소문자·숫자·하이픈이지만
/// (`personal-agents-74`), 넓은 글자가 이어지는 이름(`WWWW…`)은 같은 글자 수로도 이 값을 크게
/// 넘는다. 그래서 이 비율은 **몇 글자를 남길지 정하는 1차 추정**으로만 쓰고, 실제로 자리를
/// 넘었는지는 그려 본 폭으로 판정한다(`officeLabelSqueeze`).
public let officeLatinGlyphWidthRatio: Double = 0.55

/// 이름표에 남기는 최소 글자 수. 이 밑으로는 "…" 만 남아 자리 표시조차 안 된다.
public let officeSessionLabelMinLimit: Int = 3

/// 그려 본 라벨이 자리를 넘을 때 눌러 넣을 가로 배율.
///
/// 글자 수나 자리 폭을 미리 계산해 두는 방식은 **평균**에서 나오므로 넘치는 이름이 늘 있다
/// (세션 이름표는 평균 글자 폭에서, 좌석 이름표는 기준 타일에서). 예산을 실제 글자가
/// 초과하면 옆자리를 다시 덮는데, 그건 이 계산들이 없애려는 현상 그 자체다. 마지막에 실제
/// 폭으로 한 번 더 눌러 어떤 이름이 와도 자리를 넘지 않게 한다 — 눌린 글자는 좁아 보이지만,
/// 겹쳐서 둘 다 못 읽는 것보다는 낫다.
///
/// 넘치지 않으면 1(원래 크기)이다. 눌림은 예외적인 이름에서만 일어난다.
public func officeLabelSqueeze(renderedWidth: Double, availableWidth: Double) -> Double {
    guard renderedWidth > availableWidth, renderedWidth > 0, availableWidth > 0 else {
        return 1
    }
    return availableWidth / renderedWidth
}

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

/// 세션 이름표에 넣을 수 있는 글자 수.
///
/// 글자 수를 상수로 두면 **창이 작을수록 이름표만 겹친다.** 한글 하한(11px) 때문에 글자는
/// 어느 크기 아래로 줄지 않는데 자리 간격은 창을 따라 계속 좁아지기 때문이다. 실제로 최소
/// 창에서는 네 세션의 이름표가 공백 없이 이어붙어 한 덩어리로 보였다.
///
/// 그래서 상한을 "자리 간격 ÷ 글자 폭" 으로 낸다 — 자리가 좁아지는 만큼 이름이 짧아진다.
public func officeSessionLabelLimit(tileSize: Double, fontSize: Double) -> Int {
    let available = tileSize * officeSessionDeskStrideTiles
    let perGlyph = max(1, fontSize * officeLatinGlyphWidthRatio)
    return max(officeSessionLabelMinLimit, Int(available / perGlyph))
}

/// 책상 이름표에 쓸 짧은 이름.
///
/// 세션 이름은 실행 디렉터리에서 오므로 `personal_agents-office-window-light` 처럼 길다.
/// 자리 간격이 두 칸이라 그대로 쓰면 옆 세션 이름표와 겹쳐 **둘 다** 못 읽는다.
///
/// 뒤쪽을 남기는 이유는 앞이 대개 같은 저장소 이름이기 때문이다 — 여러 세션을 가르는 정보는
/// 뒤(워크트리·브랜치 이름)에 있다.
///
/// 다만 글자 수로만 자르면 **단어 중간에서 끊긴다.** `personal-agents-74/-86/-ce` 셋이
/// `…l-agents-74`·`…l-agents-86`·`…l-agents-ce` 가 되어, 앞 아홉 글자가 같은 채 뒤 두 자로만
/// 갈리는 이름표 셋이 나란히 선다(실데이터). 그래서 `-`·`_` 경계 중 **예산에 들어오는 가장 긴
/// 꼬리**를 고른다 — 같은 길이를 써도 남는 조각이 뜻을 유지한다.
/// 예산은 글자 수가 아니라 **폭 단위**로 센다(`officeLabelWidthUnits`). 세션 이름은 대개
/// 라틴이지만 실행 디렉터리 이름이 그대로 오므로 한글·이모지가 섞일 수 있다 — 한글은 라틴의
/// 두 배 가까이 넓어, 글자 수로 세면 여섯 자가 자리 두 칸이 아니라 세 칸을 차지한다.
public func officeSessionShortName(_ name: String, limit: Int = 12) -> String {
    let trimmed = name.trimmingCharacters(in: .whitespaces)
    guard officeLabelWidthUnits(trimmed) > limit, limit > 1 else {
        return trimmed
    }
    // 잘렸음을 알리는 "…" 도 자리를 먹는다. 라틴 한 자로 치면 한글 이름에서 예산을 넘긴다.
    let budget = limit - officeLabelWidthUnits("…")
    guard budget > 0 else {
        return "…"
    }
    // 앞에서부터 훑으므로 처음 들어맞는 꼬리가 곧 가장 긴 꼬리다.
    for index in trimmed.indices where trimmed[index] == "-" || trimmed[index] == "_" {
        let tail = trimmed[trimmed.index(after: index)...]
        if !tail.isEmpty, officeLabelWidthUnits(String(tail)) <= budget {
            return "…" + tail
        }
    }
    // 구분자가 없거나 마지막 조각조차 예산을 넘으면 뒤에서부터 예산만큼 담는다.
    var tail = ""
    for character in trimmed.reversed() {
        let candidate = String(character) + tail
        guard officeLabelWidthUnits(candidate) <= budget else {
            break
        }
        tail = candidate
    }
    return "…" + tail
}

/// 라벨이 차지하는 폭을 세는 단위. ASCII 는 1, 그 밖(한글·이모지 등)은 2로 센다.
///
/// 글자 수만 세면 문자 종류에 따라 실제 폭이 두 배까지 벌어진다. 세션 이름은 실행 디렉터리에서
/// 오고 그 경로에 한글이 섞일 수 있어(이 저장소 경로에도 한글 디렉터리가 있다), 여섯 자로 자른
/// 한글 이름이 자리 두 칸이 아니라 세 칸을 차지한다.
///
/// 이모지처럼 여러 스칼라로 이뤄진 글자는 실제보다 넓게 세어진다. **과대 계산은 안전한
/// 방향이다** — 이름이 조금 더 짧아질 뿐, 옆자리를 침범하지 않는다.
public func officeLabelWidthUnits(_ text: String) -> Int {
    text.unicodeScalars.reduce(0) { total, scalar in
        total + (scalar.isASCII ? 1 : 2)
    }
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
/// 29명이 같은 순간에 같은 주기로 오르내리면 사람이 아니라 군무로 보인다 — 스프라이트가
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
