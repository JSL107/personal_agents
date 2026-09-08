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

/// 좌상단 요약 판이 쓰는 전사 집계와 줄 나눔.
///
/// 원래는 `departmentRoomLayout`(부서를 방 격자에 배치하던 초기 구현)의 테스트가 앞에
/// 붙어 있었는데, 그 함수가 타일 평면도로 대체된 뒤 **여기서만 불리고 있어** 함께 지웠다.
/// 스위트 이름은 그대로 두었다 — 파일·등록 이름을 함께 바꾸면 diff 가 내용 변경을 덮는다.
func runOfficeRoomLayoutTests(_ t: TestRunner) {
    t.suite("OfficeRoomLayout")

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
