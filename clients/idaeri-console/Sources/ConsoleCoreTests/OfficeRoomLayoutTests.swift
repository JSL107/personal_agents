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
        roomAgent("BE", .quality), roomAgent("BE_TEST", .quality),
        roomAgent("CODE_REVIEWER", .evaluation),
        roomAgent("CTO", .treasury), roomAgent("CEO", .treasury),
        roomAgent("BLOG", .content),
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
        [.planning, .quality, .evaluation, .treasury, .content, .internalOps],
        "방 순서 canonical"
    )

    // 빈 입력·비정상 크기 방어
    t.expectEqual(departmentRoomLayout(agents: [], width: width, height: height, bandHeight: band).rooms.count, 0, "빈 입력 → 방 0")
    t.expectEqual(departmentRoomLayout(agents: agents, width: 0, height: height, bandHeight: band).positions.count, 0, "width 0 → 좌표 0")

    // 전사 집계
    let mixed = [
        roomAgent("PM", .planning, .inProgress), roomAgent("BE", .quality, .inProgress),
        roomAgent("CTO", .treasury, .awaitingApproval),
        roomAgent("CEO", .treasury, .waiting), roomAgent("BLOG", .content, .waiting),
        roomAgent("HUMANIZER", .internalOps, .waiting),
        roomAgent("BE_TEST", .quality, .completed),
    ]
    let summary = companySummary(agents: mixed)
    t.expectEqual(summary.inProgress, 2, "진행 2")
    t.expectEqual(summary.awaitingApproval, 1, "승인 1")
    t.expectEqual(summary.waiting, 3, "대기 3")
    t.expectEqual(summary.completed, 1, "완료 1")
    t.expectEqual(companySummary(agents: []).waiting, 0, "빈 입력 집계 0")

    // 좌상단 요약 판의 줄 나눔.
    //
    // 한 줄로 이으면 세션 구간이 판을 거의 두 배로 늘려, 최소 창(720×560)에서 판 오른쪽 끝이
    // 상단 밴드 대표 이름표에 닿는다(실측 여백 세션 19개에 9pt). 줄을 나누면 판 폭이 첫 줄
    // 길이로 묶인다 — 그래서 **둘째 줄이 첫 줄보다 짧아야** 이 수정이 실제로 효과가 있다.
    let hudSummary = companySummary(agents: mixed)
    t.expectEqual(
        officeCompanySummaryLines(summary: hudSummary, sessionCount: 0, activeSessionCount: 0),
        ["진행 2  ·  승인 1  ·  쉬는 중 3"],
        "세션 0 이면 한 줄"
    )
    t.expectEqual(
        officeCompanySummaryLines(summary: hudSummary, sessionCount: 19, activeSessionCount: 5),
        ["진행 2  ·  승인 1  ·  쉬는 중 3", "내 세션 19(도는 중 5)"],
        "세션이 있으면 둘째 줄로 내려간다"
    )
    // 세션이 아무리 늘어도 첫 줄 길이는 안 변하고, 둘째 줄이 첫 줄을 넘지 않는다.
    // 넘으면 판 폭이 다시 둘째 줄에 끌려가 이 수정이 무력해진다.
    for sessions in [1, 9, 19, 99, 999] {
        let lines = officeCompanySummaryLines(
            summary: hudSummary, sessionCount: sessions, activeSessionCount: sessions
        )
        t.expectEqual(lines.count, 2, "세션 \(sessions) → 두 줄")
        // 인덱스로 바로 집으면 한 줄로 되돌아간 경우 assertion 실패가 아니라 크래시가 나서
        // 무엇이 틀렸는지 안 보인다. 없으면 없다고 말하게 둔다.
        guard lines.count == 2 else {
            t.fail("세션 \(sessions) 인데 줄이 \(lines.count)개 — 둘째 줄 길이를 볼 수 없다")
            continue
        }
        t.expectEqual(
            lines[1].count <= lines[0].count, true,
            "세션 \(sessions) 둘째 줄(\(lines[1].count)자)이 첫 줄(\(lines[0].count)자)을 넘지 않는다"
        )
    }
}
