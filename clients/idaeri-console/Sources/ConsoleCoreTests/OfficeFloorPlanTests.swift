import Foundation

@testable import ConsoleCore

private func planAgent(_ type: String) -> ConsoleAgent {
    ConsoleAgent(
        agentType: type, displayName: type, slashCommands: [],
        description: "", state: .waiting, bubble: ""
    )
}

// 운영 스냅샷(GET /v1/console/snapshot)의 실제 27종을 그대로 옮긴 표본.
// 부서별 인원 편차(내부 10명)가 정원 경계를 밟으므로 임의로 줄이면 안 된다 —
// 26명짜리 표본을 쓰던 동안 "내부 10번째(SUBCONSCIOUS_GATE)가 자리를 못 받아 화면에서
// 사라지는" 결함이 테스트를 통과했다.
// agentType 은 displayName 과 다르다: EVENING_RETRO(타입) ↔ "Evening Retro Publish"(표시명).
private let sampleAgents: [ConsoleAgent] = [
    "PM", "PO_SHADOW", "PO_EVAL",
    "BE", "BE_SCHEMA", "BE_TEST", "BE_SRE", "BE_FIX",
    "CODE_REVIEWER", "WORK_REVIEWER", "IMPACT_REPORTER",
    "CTO", "CEO",
    "CAREER_MATE", "JOB_APPLICATION", "BLOG", "VACATION",
    "ISSUE_LABELER", "SUBCONSCIOUS_GATE", "CONTRADICTION_JUDGE",
    "REVIEW_REPLY_JUDGE", "HUMANIZER", "DOCS_AUDIT_OPTIMIZER",
    "DOCS_AUDIT_EVALUATOR", "PREFERENCE_LEARNING", "EVENING_RETRO",
    "OPS_SUPERVISOR",
].map(planAgent)

func runOfficeFloorPlanTests(_ t: TestRunner) {
    t.suite("OfficeFloorPlan")

    let plan = officeFloorPlan(agents: sampleAgents)

    // 모든 에이전트가 자기 책상을 가진다 — 한 명이라도 자리가 없으면 화면에서 사라진다.
    t.expectEqual(plan.desks.count, sampleAgents.count, "27명 전원 자리 배정")

    // 인원이 가장 많은 부서도 정원 안에 들어가야 한다. 부서별 인원은 언제든 늘 수 있으므로,
    // "가장 큰 부서 전원이 자리를 받았는가" 를 부서 단위로 못 박는다.
    for zoneDepartment in Department.allCases {
        let members = sampleAgents.filter { department(for: $0.agentType) == zoneDepartment }
        guard !members.isEmpty else {
            continue
        }
        let seated = plan.desks.filter { department(for: $0.agentType) == zoneDepartment }
        t.expectEqual(
            seated.count, members.count,
            "\(zoneDepartment.label) 부서 \(members.count)명 전원 배정(정원 초과 시 실패)"
        )
    }

    // 책상은 서로 겹치지 않는다.
    let deskTiles = Set(plan.desks.map(\.desk))
    t.expectEqual(deskTiles.count, plan.desks.count, "책상 좌표 중복 없음")

    // 좌석도 겹치지 않는다(두 사람이 한 칸에 앉으면 스프라이트가 포개진다).
    let seatTiles = Set(plan.desks.map(\.seat))
    t.expectEqual(seatTiles.count, plan.desks.count, "좌석 좌표 중복 없음")

    // 좌석은 책상 바로 위 — 탑다운에서 책상이 사람 앞을 가리는 배치.
    let seatAboveDesk = plan.desks.allSatisfy {
        $0.seat.x == $0.desk.x && $0.seat.y == $0.desk.y + 1
    }
    t.expect(seatAboveDesk, "좌석은 책상 바로 위 칸")

    // 모든 자리가 격자 안에 있다.
    let insideGrid = plan.desks.allSatisfy {
        $0.desk.x >= 0 && $0.desk.x < plan.columns
            && $0.seat.y >= 0 && $0.seat.y < plan.rows
    }
    t.expect(insideGrid, "모든 자리가 격자 범위 안")

    // 좌석은 걸어서 도달할 수 있어야 한다 — 못 가면 캐릭터가 자기 자리에 앉지 못한다.
    let seatsWalkable = plan.desks.allSatisfy { plan.walkable.contains($0.seat) }
    t.expect(seatsWalkable, "모든 좌석이 통행 가능")

    // 책상 자체는 막혀 있어야 한다(사람이 책상 위로 걸어다니면 안 된다).
    let desksBlocked = plan.desks.allSatisfy { !plan.walkable.contains($0.desk) }
    t.expect(desksBlocked, "책상 칸은 통행 불가")

    // 부서 구역은 등장 부서 수만큼.
    t.expectEqual(plan.zones.count, 6, "부서 구역 6개")

    // 대표 자리·줄서기·휴식 자리가 비어 있지 않다.
    t.expect(!plan.queueTiles.isEmpty, "승인 대기 줄 자리 존재")
    t.expect(!plan.loungeTiles.isEmpty, "휴식 자리 존재")

    // 바닥 배열 크기가 격자와 일치한다.
    t.expectEqual(plan.floor.count, plan.rows, "바닥 행 수 == rows")
    t.expectEqual(plan.floor.first?.count ?? 0, plan.columns, "바닥 열 수 == columns")

    // 최상단 줄은 벽 — 사무실 경계.
    let topRowIsWall = plan.floor[plan.rows - 1].allSatisfy { $0 == .wall }
    t.expect(topRowIsWall, "최상단 행은 벽")

    // 빈 입력에서도 크래시 없이 빈 배치를 낸다.
    let empty = officeFloorPlan(agents: [])
    t.expectEqual(empty.desks.count, 0, "에이전트 0명이면 책상 0개")
    t.expectEqual(empty.zones.count, 0, "에이전트 0명이면 구역 0개")

    // 같은 입력은 같은 배치 — 스냅샷마다 자리가 바뀌면 화면이 요동친다.
    let again = officeFloorPlan(agents: sampleAgents)
    let firstAssignment = plan.desks.map { "\($0.agentType)@\($0.desk.x),\($0.desk.y)" }.sorted()
    let secondAssignment = again.desks.map { "\($0.agentType)@\($0.desk.x),\($0.desk.y)" }.sorted()
    t.expectEqual(firstAssignment, secondAssignment, "동일 입력 → 동일 배치")

    // 입력 순서가 달라도 배치가 같다(스냅샷 순서에 흔들리지 않게 사전순으로 채운다).
    let shuffled = officeFloorPlan(agents: sampleAgents.reversed())
    let shuffledAssignment = shuffled.desks
        .map { "\($0.agentType)@\($0.desk.x),\($0.desk.y)" }
        .sorted()
    t.expectEqual(firstAssignment, shuffledAssignment, "입력 순서 무관 → 동일 배치")
}

func runAgentRoleTests(_ t: TestRunner) {
    t.suite("AgentRole")

    // 운영 27종 전부에 한글 직책이 있어야 한다. 하나라도 빠지면 그 사람만 영문 displayName 으로
    // 폴백해 이름표가 뒤섞인다(agentType 과 displayName 을 혼동하면 조용히 빠진다).
    let missing = sampleAgents
        .map(\.agentType)
        .filter { agentRoleLabel(for: $0) == nil }
    t.expectEqual(missing.count, 0, "직책 미매핑: \(missing.sorted())")

    // 이름표가 겹치지 않도록 짧게 유지한다.
    let tooLong = sampleAgents
        .compactMap { agentRoleLabel(for: $0.agentType) }
        .filter { $0.count > 7 }
    t.expectEqual(tooLong.count, 0, "직책이 너무 김(7자 초과): \(tooLong)")

    // 미등록 타입은 nil — 호출자가 displayName 으로 폴백한다.
    t.expect(agentRoleLabel(for: "NOT_A_REAL_AGENT") == nil, "미등록 타입은 nil")

    // 외형 배정은 결정론적이어야 한다 — 실행마다 머리색이 바뀌면 사람을 외울 수 없다.
    let first = characterLook(for: "OPS_SUPERVISOR")
    let second = characterLook(for: "OPS_SUPERVISOR")
    t.expectEqual(first, second, "같은 agentType → 같은 외형")
    t.expect(
        (0..<characterSheetCount).contains(first.sheetIndex),
        "시트 인덱스가 준비된 범위 안"
    )
    t.expect(hairPalette.indices.contains(first.hairIndex), "머리색 인덱스가 팔레트 범위 안")

    // 27명이 한 시트에 몰리지 않는지 — 몰리면 다양화가 무의미해진다.
    let sheets = Set(sampleAgents.map { characterLook(for: $0.agentType).sheetIndex })
    t.expect(sheets.count >= 3, "캐릭터 시트가 최소 3종으로 분산 (실제 \(sheets.count)종)")
}

func runOfficePathfindingTests(_ t: TestRunner) {
    t.suite("OfficePathfinding")

    // 3x3 전부 통행 가능한 격자
    var open: Set<TilePoint> = []
    for y in 0..<3 {
        for x in 0..<3 {
            open.insert(TilePoint(x: x, y: y))
        }
    }

    let straight = officePath(
        from: TilePoint(x: 0, y: 0), to: TilePoint(x: 2, y: 0), walkable: open
    )
    t.expectEqual(straight.count, 2, "직선 2칸 이동")
    t.expectEqual(straight.last, TilePoint(x: 2, y: 0), "경로 끝은 목적지")

    // 시작 == 목적지면 이동 없음
    let none = officePath(
        from: TilePoint(x: 1, y: 1), to: TilePoint(x: 1, y: 1), walkable: open
    )
    t.expect(none.isEmpty, "제자리면 빈 경로")

    // 도달 불가 — 목적지가 통행 불가
    let blocked = officePath(
        from: TilePoint(x: 0, y: 0), to: TilePoint(x: 9, y: 9), walkable: open
    )
    t.expect(blocked.isEmpty, "통행 불가 목적지 → 빈 경로")

    // 벽을 돌아간다: 가운데 열을 막으면 위/아래로 우회
    var walled = open
    walled.remove(TilePoint(x: 1, y: 0))
    walled.remove(TilePoint(x: 1, y: 1))
    let detour = officePath(
        from: TilePoint(x: 0, y: 0), to: TilePoint(x: 2, y: 0), walkable: walled
    )
    t.expect(detour.count > 2, "막힌 직선 → 우회 경로가 더 길다")
    t.expect(
        !detour.contains(TilePoint(x: 1, y: 0)) && !detour.contains(TilePoint(x: 1, y: 1)),
        "우회 경로는 막힌 칸을 지나지 않는다"
    )

    // 완전히 갇힌 경우
    var isolated: Set<TilePoint> = [TilePoint(x: 0, y: 0), TilePoint(x: 5, y: 5)]
    let unreachable = officePath(
        from: TilePoint(x: 0, y: 0), to: TilePoint(x: 5, y: 5), walkable: isolated
    )
    t.expect(unreachable.isEmpty, "연결 안 된 목적지 → 빈 경로")
    isolated.removeAll()

    // 방향 판정
    t.expectEqual(facing(from: TilePoint(x: 0, y: 0), to: TilePoint(x: 1, y: 0)), .right, "오른쪽")
    t.expectEqual(facing(from: TilePoint(x: 1, y: 0), to: TilePoint(x: 0, y: 0)), .left, "왼쪽")
    t.expectEqual(facing(from: TilePoint(x: 0, y: 0), to: TilePoint(x: 0, y: 1)), .up, "위")
    t.expectEqual(facing(from: TilePoint(x: 0, y: 1), to: TilePoint(x: 0, y: 0)), .down, "아래")
    t.expect(facing(from: TilePoint(x: 0, y: 0), to: TilePoint(x: 0, y: 0)) == nil, "제자리는 nil")

    // 실제 평면도 위에서 자리 간 이동이 가능한가 — 통로가 실제로 이어져 있는지 확인.
    let plan = officeFloorPlan(agents: sampleAgents)
    if let first = plan.desks.first, let last = plan.desks.last, let queue = plan.queueTiles.first {
        let deskToDesk = officePath(from: first.seat, to: last.seat, walkable: plan.walkable)
        t.expect(!deskToDesk.isEmpty, "책상에서 다른 책상까지 경로가 있다")
        let deskToQueue = officePath(from: first.seat, to: queue, walkable: plan.walkable)
        t.expect(!deskToQueue.isEmpty, "책상에서 대표실 줄까지 경로가 있다")
    } else {
        t.expect(false, "표본 평면도에 책상·줄 자리가 있어야 한다")
    }

    // 모든 좌석이 대표실 줄과 연결돼 있어야 한다 — 하나라도 고립되면 그 캐릭터는 승인 줄에 못 선다.
    if let queue = plan.queueTiles.first {
        let isolatedSeats = plan.desks.filter {
            officePath(from: $0.seat, to: queue, walkable: plan.walkable).isEmpty
        }
        t.expectEqual(isolatedSeats.count, 0, "고립된 좌석 없음")
    }
}
