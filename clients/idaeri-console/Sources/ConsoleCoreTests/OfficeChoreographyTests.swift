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

    runOfficeWalkFrameTests(t)
}

/// 걸음 프레임 — 이름 조립과 에셋 실물이 서로 맞는지.
func runOfficeWalkFrameTests(_ t: TestRunner) {
    t.suite("OfficeWalkFrame")

    // 한 칸마다 프레임이 번갈아야 한 걸음에 다리가 한 번 교차한다. 같은 프레임이 두 칸
    // 연속으로 나오면 걷는 게 아니라 한쪽 발만 든 채 미끄러진다.
    t.expectEqual(officeWalkPose("down", step: 0), "down-walk1", "0번째 걸음 → walk1")
    t.expectEqual(officeWalkPose("down", step: 1), "down-walk2", "1번째 걸음 → walk2")
    t.expectEqual(officeWalkPose("down", step: 2), "down-walk1", "2번째 걸음 → 다시 walk1")

    // 걸음 인덱스가 음수로 들어와도 프레임 번호는 1·2 안에 있어야 한다 — 0 이나 음수가 나오면
    // 존재하지 않는 파일명이 조립돼 그 사람만 화면에서 사라진다.
    t.expectEqual(officeWalkPose("side", step: -1), "side-walk2", "음수 걸음도 유효 프레임")
    t.expectEqual(officeWalkPose("side", step: -2), "side-walk1", "음수 걸음도 유효 프레임")

    // 정지 포즈 복원 — 로더가 걸음 프레임이 없을 때 내려갈 곳.
    t.expectEqual(officeStillPose("down-walk1"), "down", "걸음 프레임 → 정지 포즈")
    t.expectEqual(officeStillPose("up-walk2"), "up", "걸음 프레임 → 정지 포즈")
    t.expectEqual(officeStillPose("sit"), "sit", "정지 포즈는 그대로")
    t.expectEqual(officeStillPose("side"), "side", "정지 포즈는 그대로")

    // 에셋이 실제로 있어야 이름 조립이 의미를 갖는다. 이름만 맞고 파일이 없으면 로더가
    // 정지 그림으로 조용히 폴백해서, "걷는데 다리가 안 움직인다" 를 아무도 못 잡는다.
    // 소스 파일 위치에서 경로를 잡으므로 실행 디렉터리와 무관하다.
    let sprites = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // ConsoleCoreTests
        .deletingLastPathComponent()  // Sources
        .deletingLastPathComponent()  // 패키지 루트
        .appendingPathComponent("Sources/IdaeriConsole/Resources/sprites")
    // 앉은 자세는 걷지 않으므로 걸음 프레임이 없다.
    let walkPoses = ["down", "up", "side"]
    let expectedFrames = characterSheetPrefixes.flatMap { prefix in
        walkPoses.flatMap { pose in
            (0..<officeWalkFrameCount).map { step in
                "\(prefix)-\(officeWalkPose(pose, step: step)).png"
            }
        }
    }
    let missing = expectedFrames.filter {
        !FileManager.default.fileExists(atPath: sprites.appendingPathComponent($0).path)
    }
    t.expectEqual(missing.count, 0, "빠진 걸음 프레임: \(missing)")
    // 시트 4종 × 3포즈 × 2프레임. 시트를 늘리고 에셋을 안 만들면 위 검사가 잡는다.
    t.expectEqual(expectedFrames.count, 24, "걸음 프레임 24장 (실제 \(expectedFrames.count))")
}
