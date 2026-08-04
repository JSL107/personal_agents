import Foundation

@testable import ConsoleCore

private func roomAgent(
    _ type: String, _ department: Department, _ state: ConsoleAgentState = .waiting
) -> ConsoleAgent {
    ConsoleAgent(
        agentType: type, displayName: type, slashCommands: [],
        description: "", state: state, bubble: "", department: department.rawValue
    )
}

func runOfficeRoomLayoutTests(_ t: TestRunner) {
    t.suite("OfficeRoomLayout")

    // 6부서 대표 집합. 부서는 백엔드 사규 값을 그대로 적는다(앱이 유도하지 않는다).
    let agents = [
        roomAgent("PM", .planning), roomAgent("PO_SHADOW", .planning),
        roomAgent("BE", .engineering), roomAgent("BE_TEST", .engineering),
        roomAgent("CODE_REVIEWER", .review),
        roomAgent("CTO", .executive), roomAgent("CEO", .executive),
        roomAgent("BLOG", .growth),
        roomAgent("HUMANIZER", .internalOps), roomAgent("OPS_SUPERVISOR", .internalOps),
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
        let dept = agent.resolvedDepartment
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
        roomAgent("PM", .planning, .inProgress), roomAgent("BE", .engineering, .inProgress),
        roomAgent("CTO", .executive, .awaitingApproval),
        roomAgent("CEO", .executive, .waiting), roomAgent("BLOG", .growth, .waiting),
        roomAgent("HUMANIZER", .internalOps, .waiting),
        roomAgent("BE_TEST", .engineering, .completed),
    ]
    let summary = companySummary(agents: mixed)
    t.expectEqual(summary.inProgress, 2, "진행 2")
    t.expectEqual(summary.awaitingApproval, 1, "승인 1")
    t.expectEqual(summary.waiting, 3, "대기 3")
    t.expectEqual(summary.completed, 1, "완료 1")
    t.expectEqual(companySummary(agents: []).waiting, 0, "빈 입력 집계 0")
}
