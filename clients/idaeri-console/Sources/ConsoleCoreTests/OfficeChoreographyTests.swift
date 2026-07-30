import Foundation

@testable import ConsoleCore

private func makeAgent(_ type: String, _ state: ConsoleAgentState, bubble: String = "말풍선") -> ConsoleAgent {
    ConsoleAgent(agentType: type, displayName: type, slashCommands: [], description: "", state: state, bubble: bubble)
}

private func makeRun(_ id: String, _ type: String, parentId: String? = nil) -> ConsoleRun {
    ConsoleRun(id: id, agentType: type, status: "RUNNING", parentId: parentId, startedAt: "t", finishedAt: nil)
}

func runOfficeChoreographyTests(_ t: TestRunner) {
    t.suite("OfficeChoreography")

    let agents = [makeAgent("PM", .inProgress), makeAgent("CTO", .awaitingApproval, bubble: "확인해주세요")]

    // run.started (부모 없음) → working
    let ctx = ChoreographyContext(agents: agents, runs: [], pendingCommands: [])
    t.expectEqual(
        visualIntents(for: .runStarted(makeRun("r1", "PM")), context: ctx),
        [.working(agentType: "PM")],
        "부모 없는 run.started → working")

    // run.started (부모 있음) → handoff(부모→자식) + working
    let ctxChain = ChoreographyContext(agents: agents, runs: [makeRun("r0", "PM")], pendingCommands: [])
    t.expectEqual(
        visualIntents(for: .runStarted(makeRun("r1", "CTO", parentId: "r0")), context: ctxChain),
        [.handoff(from: "PM", to: "CTO"), .working(agentType: "CTO")],
        "부모 있는 run.started → handoff + working")

    // run.finished → 현재 상태로 recolor + bubble
    t.expectEqual(
        visualIntents(for: .runFinished(makeRun("r1", "CTO")), context: ctx),
        [.recolor(agentType: "CTO", state: .awaitingApproval), .bubble(agentType: "CTO", text: "확인해주세요")],
        "run.finished → recolor + bubble")

    // approval.opened → summonToBand + bubble
    let approval = ConsoleApproval(id: "a1", agentType: "CTO", title: "PR", createdAt: "t")
    t.expectEqual(
        visualIntents(for: .approvalOpened(approval), context: ctx),
        [.summonToBand(agentType: "CTO"), .bubble(agentType: "CTO", text: "확인해주세요")],
        "approval.opened → summon + bubble")

    // approval.resolved → returnHome
    t.expectEqual(
        visualIntents(for: .approvalResolved(approval), context: ctx),
        [.returnHome(agentType: "CTO")],
        "approval.resolved → returnHome")

    // state.changed → recolor
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "PM", state: .completed), context: ctx),
        [.recolor(agentType: "PM", state: .completed)],
        "state.changed → recolor")

    // command.rejected → pending 의 agentType 으로 reject
    let pending = PendingCommand(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                                 text: "t", agentTypeHint: "PM", sentAt: Date(), phase: .sent)
    let ctxPending = ChoreographyContext(agents: agents, runs: [], pendingCommands: [pending])
    t.expectEqual(
        visualIntents(for: .commandRejected(commandId: "00000000-0000-0000-0000-000000000001", reason: "x"), context: ctxPending),
        [.reject(agentType: "PM")],
        "command.rejected → pending agentType 으로 reject")

    // 미지 agentType → 빈 결과
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "UNKNOWN", state: .completed), context: ctx),
        [],
        "미지 agentType → 빈 결과")

    // 오피스 무관 이벤트(session/command.info) → 빈 결과
    let session = ConsoleSession(sessionId: "s", pid: 1, source: "cli", name: "n", cwd: "/", state: "active", startedAt: "t", lastActivityAt: nil)
    t.expectEqual(visualIntents(for: .sessionOpened(session), context: ctx), [], "session.opened → 빈 결과")
    t.expectEqual(visualIntents(for: .commandInfo(commandId: "x", message: "m"), context: ctx), [], "command.info → 빈 결과")

    // state.changed(IN_PROGRESS) → working (펄스 유지, recolor 아님)
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "PM", state: .inProgress), context: ctx),
        [.working(agentType: "PM")],
        "state.changed(IN_PROGRESS) → working")

    // state.changed(AWAITING_APPROVAL) → 집결 + 핑크 recolor
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "CTO", state: .awaitingApproval), context: ctx),
        [.summonToBand(agentType: "CTO"), .recolor(agentType: "CTO", state: .awaitingApproval)],
        "state.changed(AWAITING_APPROVAL) → 집결 + 핑크")

    // state.changed(COMPLETED) → recolor (기존 유지)
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "PM", state: .completed), context: ctx),
        [.recolor(agentType: "PM", state: .completed)],
        "state.changed(COMPLETED) → recolor")
}
