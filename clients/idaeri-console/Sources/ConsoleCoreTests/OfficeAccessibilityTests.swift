import Foundation

@testable import ConsoleCore

private func makeAgent(_ type: String, _ state: ConsoleAgentState) -> ConsoleAgent {
    ConsoleAgent(
        agentType: type, displayName: type, slashCommands: [],
        description: "", state: state, bubble: ""
    )
}

/// 오피스 접근성 요약(순수)의 검증.
func runOfficeAccessibilityTests(_ t: TestRunner) {
    t.suite("OfficeAccessibility")

    t.expectEqual(
        officeAccessibilitySummary(agents: []),
        "표시할 부서가 없습니다.",
        "부서가 없으면 그 사실을 말한다"
    )

    let allWaiting = ["PM", "BE", "CTO"].map { makeAgent($0, .waiting) }
    t.expectEqual(
        officeAccessibilitySummary(agents: allWaiting),
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
    let summary = officeAccessibilitySummary(agents: mixed)
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
        officeAccessibilitySummary(agents: onlyFailed).hasPrefix("실패 1명"),
        "대기가 없으면 실패로 문장이 시작한다"
    )
}
