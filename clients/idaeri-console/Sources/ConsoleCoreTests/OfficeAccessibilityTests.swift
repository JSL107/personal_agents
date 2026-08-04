import Foundation

@testable import ConsoleCore

private func makeAgent(_ type: String, _ state: ConsoleAgentState) -> ConsoleAgent {
    ConsoleAgent(
        agentType: type, displayName: type, slashCommands: [],
        description: "", state: state, bubble: ""
    )
}

private func makeApproval(_ agentType: String?) -> ConsoleApproval {
    ConsoleApproval(
        id: "ap-\(agentType ?? "nil")", agentType: agentType,
        title: "승인 요청", createdAt: "2026-08-04T00:00:00.000Z"
    )
}

/// 오피스 접근성 요약(순수)의 검증.
func runOfficeAccessibilityTests(_ t: TestRunner) {
    t.suite("OfficeAccessibility")

    t.expectEqual(
        officeAccessibilitySummary(agents: [], approvals: []),
        "표시할 부서가 없습니다.",
        "부서가 없으면 그 사실을 말한다"
    )

    let allWaiting = ["PM", "BE", "CTO"].map { makeAgent($0, .waiting) }
    t.expectEqual(
        officeAccessibilitySummary(agents: allWaiting, approvals: []),
        "전원 3명 대기 중.",
        "전원 대기면 인원만 밝힌다"
    )

    // 손이 필요한 상태가 앞에 온다 — 소리는 훑어볼 수 없어 순서가 곧 우선순위다.
    let mixed = [
        makeAgent("BE", .inProgress),
        makeAgent("PM", .awaitingApproval),
        makeAgent("CTO", .waiting),
        makeAgent("BE_TEST", .failed),
    ]
    let summary = officeAccessibilitySummary(agents: mixed, approvals: [])
    let approvalIndex = summary.range(of: "승인 대기")?.lowerBound
    let failedIndex = summary.range(of: "실패")?.lowerBound
    let progressIndex = summary.range(of: "진행 중")?.lowerBound
    t.expect(approvalIndex != nil && failedIndex != nil && progressIndex != nil, "세 상태가 모두 담긴다")
    if let approvalIndex, let failedIndex, let progressIndex {
        t.expect(approvalIndex < failedIndex, "승인 대기가 실패보다 앞")
        t.expect(failedIndex < progressIndex, "실패가 진행 중보다 앞")
    }

    // 이름은 영문 식별명이 아니라 화면 이름표와 같은 직책으로 읽힌다.
    if let role = agentRoleLabel(for: "BE") {
        t.expect(summary.contains(role), "진행 중인 사람을 직책(\(role))으로 부른다")
    }
    t.expect(summary.contains("나머지 1명 대기"), "대기는 수만 밝힌다")
    t.expect(!summary.contains("CTO"), "대기 인원의 이름은 읽지 않는다")
    t.expect(summary.hasSuffix("."), "문장으로 끝난다")

    // 실패만 있어도 "나머지" 가 아니라 온전한 문장이 된다.
    let onlyFailed = [makeAgent("BE", .failed)]
    t.expect(
        officeAccessibilitySummary(agents: onlyFailed, approvals: []).hasPrefix("실패 1명"),
        "대기가 없으면 실패로 문장이 시작한다"
    )

    // 승인 건이 먼저 오고 상태가 늦게 따라오는 경로 — 줄 세우기(reconciledQueueOrder)와 같은
    // 규칙이라야 화면에 줄이 서 있는데 낭독만 "전원 대기" 라고 말하는 일이 없다.
    let approvalFirst = [makeAgent("PM", .waiting), makeAgent("BE", .waiting)]
    let lateState = officeAccessibilitySummary(
        agents: approvalFirst, approvals: [makeApproval("PM")]
    )
    t.expect(lateState.hasPrefix("승인 대기 1명"), "상태가 늦어도 승인 목록으로 읽는다")
    if let role = agentRoleLabel(for: "PM") {
        t.expect(lateState.contains(role), "승인 대기자를 직책으로 부른다")
    }
    t.expect(lateState.contains("나머지 1명 대기"), "승인 대기자를 대기에서 이중으로 세지 않는다")

    // 반대 방향 — 승인은 해소됐는데 상태가 아직 awaitingApproval 인 경우.
    // 두 신호 중 하나라도 승인을 가리키면 승인 대기로 읽는다(줄 세우기와 동일).
    let staleState = officeAccessibilitySummary(
        agents: [makeAgent("PM", .awaitingApproval)], approvals: []
    )
    t.expect(staleState.hasPrefix("승인 대기 1명"), "상태만 승인 대기여도 승인으로 읽는다")

    // agentType 이 없는 승인은 누구도 승인 대기로 만들지 않는다(줄 세우기와 동일한 계약).
    let nilApproval = officeAccessibilitySummary(
        agents: [makeAgent("PM", .waiting)], approvals: [makeApproval(nil)]
    )
    t.expectEqual(nilApproval, "전원 1명 대기 중.", "주인 없는 승인은 아무도 지목하지 않는다")
}
