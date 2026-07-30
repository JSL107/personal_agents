import Foundation

@testable import ConsoleCore

private func makeAgent(_ type: String, _ state: ConsoleAgentState, bubble: String = "작업 중…") -> ConsoleAgent {
    ConsoleAgent(
        agentType: type, displayName: type, slashCommands: [],
        description: "", state: state, bubble: bubble
    )
}

private func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

func runAgentTokenInfoTests(_ t: TestRunner) {
    t.suite("AgentTokenInfo")

    let now = Date(timeIntervalSince1970: 1_800_000_000)

    // elapsedLabel: 경계값
    t.expectEqual(elapsedLabel(fromISO: iso(now.addingTimeInterval(-30)), now: now), "방금", "30초 → 방금")
    t.expectEqual(elapsedLabel(fromISO: iso(now.addingTimeInterval(-300)), now: now), "5분째", "5분 → 5분째")
    t.expectEqual(elapsedLabel(fromISO: iso(now.addingTimeInterval(-5400)), now: now), "1시간째", "90분 → 1시간째")
    t.expectNil(elapsedLabel(fromISO: iso(now.addingTimeInterval(300)), now: now), "미래 시각 → nil")
    t.expectNil(elapsedLabel(fromISO: "not-a-date", now: now), "파싱 불가 → nil")

    // 프랙셔널 초 없는 ISO 도 파싱
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    t.expectEqual(
        elapsedLabel(fromISO: plain.string(from: now.addingTimeInterval(-120)), now: now),
        "2분째",
        "프랙셔널 없는 ISO 도 파싱"
    )

    // activeRun: 미완료 중 최신
    let runs = [
        ConsoleRun(id: "r1", agentType: "BE", status: "running", parentId: nil, startedAt: iso(now.addingTimeInterval(-600)), finishedAt: nil),
        ConsoleRun(id: "r2", agentType: "BE", status: "done", parentId: nil, startedAt: iso(now.addingTimeInterval(-1200)), finishedAt: iso(now.addingTimeInterval(-100))),
        ConsoleRun(id: "r3", agentType: "BE", status: "running", parentId: nil, startedAt: iso(now.addingTimeInterval(-120)), finishedAt: nil),
    ]
    t.expectEqual(activeRun(for: "BE", runs: runs)?.id, "r3", "미완료 중 가장 최근 startedAt")
    t.expectNil(activeRun(for: "PM", runs: runs), "해당 없음 → nil")

    // pendingBadge: 해당 agent 의 최신 pending phase
    let pendings = [
        PendingCommand(id: UUID(), text: "a", agentTypeHint: "PM", sentAt: now.addingTimeInterval(-60), phase: .sent),
        PendingCommand(id: UUID(), text: "b", agentTypeHint: "PM", sentAt: now.addingTimeInterval(-10), phase: .running),
    ]
    t.expectEqual(pendingBadge(for: "PM", pendingCommands: pendings), .running, "최신 pending phase")
    t.expectNil(pendingBadge(for: "CTO", pendingCommands: pendings), "pending 없음 → nil")

    // agentTokenInfo: 진행 중이면 bubble+elapsed, 대기면 둘 다 nil
    let working = agentTokenInfo(agent: makeAgent("BE", .inProgress, bubble: "구현 중"), runs: runs, pendingCommands: [], now: now)
    t.expectEqual(working.bubble, "구현 중", "진행 중 → 상시 말풍선")
    t.expectEqual(working.elapsed, "2분째", "진행 중 → 경과(r3 기준)")

    let waiting = agentTokenInfo(agent: makeAgent("PM", .waiting), runs: [], pendingCommands: [], now: now)
    t.expectNil(waiting.bubble, "대기 → 상시 말풍선 없음")
    t.expectNil(waiting.elapsed, "대기 → 경과 없음")

    let approving = agentTokenInfo(agent: makeAgent("CTO", .awaitingApproval, bubble: "승인 대기"), runs: [], pendingCommands: [], now: now)
    t.expectEqual(approving.bubble, "승인 대기", "승인 대기 → 상시 말풍선")
    t.expectNil(approving.elapsed, "승인 대기 → 경과 없음(진행 아님)")

    let badged = agentTokenInfo(agent: makeAgent("PM", .waiting), runs: [], pendingCommands: pendings, now: now)
    t.expectEqual(badged.badge, .running, "pending 있으면 badge")
}
