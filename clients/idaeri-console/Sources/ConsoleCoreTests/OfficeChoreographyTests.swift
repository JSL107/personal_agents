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

    // CTO 는 **승인 대기 전용** 표본이다. 이동 연출 단언에 CTO 를 쓰면 승인 억제와 섞여
    // 무엇을 재는 테스트인지 흐려진다 — 실제로 그렇게 얽혀 있었다. 평범한 상태 표본으로 BE 를 둔다.
    let agents = [
        makeAgent("PM", .inProgress),
        makeAgent("CTO", .awaitingApproval, bubble: "확인해주세요"),
        makeAgent("BE", .waiting, bubble: "업무 대기중"),
    ]

    // run.started (부모 없음) → working
    let ctx = ChoreographyContext(agents: agents, runs: [], pendingCommands: [])
    t.expectEqual(
        visualIntents(for: .runStarted(makeRun("r1", "PM")), context: ctx),
        [.working(agentType: "PM")],
        "부모 없는 run.started → working")

    // run.started (부모 있음) → handoff(부모→자식) + working
    let ctxChain = ChoreographyContext(agents: agents, runs: [makeRun("r0", "PM")], pendingCommands: [])
    t.expectEqual(
        visualIntents(for: .runStarted(makeRun("r1", "BE", parentId: "r0")), context: ctxChain),
        [.handoff(from: "PM", to: "BE"), .working(agentType: "BE")],
        "부모 있는 run.started → handoff + working")

    // run.finished → 현재 상태로 recolor + bubble
    t.expectEqual(
        visualIntents(for: .runFinished(makeRun("r1", "CTO")), context: ctx),
        [.recolor(agentType: "CTO", state: .awaitingApproval), .bubble(agentType: "CTO", text: "확인해주세요")],
        "run.finished → recolor + bubble")

    // approval.opened → 이동 + 승인 대기색 + bubble. 색을 빼면 이벤트 순서에 따라 흰 링이 남는다.
    // createdAt/expiresAt 은 실제 백엔드가 보내는 형태(ISO 8601)를 그대로 쓴다 — "t" 같은
    // 자리표시자는 방치 압력이 그 값을 읽기 시작한 뒤로는 파싱 실패로 잡혀 뜻이 달라진다.
    let approval = ConsoleApproval(
        id: "a1", agentType: "CTO", title: "PR",
        createdAt: "2026-08-19T00:00:00Z", expiresAt: "2026-08-19T01:00:00Z"
    )
    t.expectEqual(
        visualIntents(for: .approvalOpened(approval), context: ctx),
        [
            .summonToBand(agentType: "CTO"),
            .recolor(agentType: "CTO", state: .awaitingApproval),
            .bubble(agentType: "CTO", text: "확인해주세요"),
        ],
        "approval.opened → summon + 승인 대기색 + bubble")

    // 운영의 세션 유휴 승인은 agentType 이 nil 이다. 관계없는 사람을 줄 세우면 안 된다.
    let nilAgentApproval = ConsoleApproval(
        id: "a2", agentType: nil, title: "세션 유휴",
        createdAt: "2026-08-19T00:00:00Z", expiresAt: "2026-08-19T01:00:00Z"
    )
    t.expectEqual(
        visualIntents(for: .approvalOpened(nilAgentApproval), context: ctx),
        [],
        "approval.opened agentType nil → 빈 결과")

    let unknownAgentApproval = ConsoleApproval(
        id: "a3", agentType: "UNKNOWN", title: "PR",
        createdAt: "2026-08-19T00:00:00Z", expiresAt: "2026-08-19T01:00:00Z"
    )
    t.expectEqual(
        visualIntents(for: .approvalOpened(unknownAgentApproval), context: ctx),
        [],
        "approval.opened 미지 agentType → 빈 결과")

    // approval.resolved → returnHome
    t.expectEqual(
        visualIntents(for: .approvalResolved(approval), context: ctx),
        [.returnHome(agentType: "CTO")],
        "approval.resolved → returnHome")

    // state.changed → recolor
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "PM", state: .completed, bubble: nil), context: ctx),
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
        visualIntents(for: .stateChanged(agentType: "UNKNOWN", state: .completed, bubble: nil), context: ctx),
        [],
        "미지 agentType → 빈 결과")

    // 오피스 무관 이벤트(session/command.info) → 빈 결과
    let session = ConsoleSession(sessionId: "s", pid: 1, source: "cli", name: "n", cwd: "/", state: "active", startedAt: "t", lastActivityAt: nil)
    t.expectEqual(visualIntents(for: .sessionOpened(session), context: ctx), [], "session.opened → 빈 결과")
    t.expectEqual(visualIntents(for: .commandInfo(commandId: "x", message: "m"), context: ctx), [], "command.info → 빈 결과")

    // state.changed(IN_PROGRESS) → working (펄스 유지, recolor 아님)
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "PM", state: .inProgress, bubble: nil), context: ctx),
        [.working(agentType: "PM")],
        "state.changed(IN_PROGRESS) → working")

    // 줄에 선 사람에게 온 진행 이벤트는 자리로 보내지 않는다.
    //
    // 스토어가 열린 승인 때문에 그 이벤트를 억제하면 상태가 `AWAITING_APPROVAL` 로 남는데
    // (`ConsoleStore.hasOpenApproval`), 연출이 이벤트만 보고 `working` 을 내면 사람이 줄에서
    // 책상으로 걸어가고 다음 스냅샷이 다시 줄로 부른다. `ctx` 의 CTO 가 그 상태다.
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "CTO", state: .inProgress, bubble: nil), context: ctx),
        [],
        "승인 대기 상태인 사람에게 온 진행 이벤트 → 연출 없음")

    // `run.started` 도 막아야 한다 — 백엔드는 그것을 `state.changed` 보다 **먼저** 발행하므로
    // (`AgentRunService.execute`), 상태 변경만 막으면 이 이벤트가 이미 사람을 걷게 한다.
    t.expectEqual(
        visualIntents(for: .runStarted(makeRun("r9", "CTO")), context: ctx),
        [],
        "승인 대기 상태인 사람의 run.started → 연출 없음")

    // 체인(부모 있는 run.started)도 같다. handoff 는 두 사람을 걷게 하므로 더 크게 어긋난다.
    let ctxQueuedChain = ChoreographyContext(
        agents: agents, runs: [makeRun("r8", "PM")], pendingCommands: []
    )
    t.expectEqual(
        visualIntents(
            for: .runStarted(makeRun("r9", "CTO", parentId: "r8")), context: ctxQueuedChain),
        [],
        "승인 대기 상태인 사람의 체인 run.started → handoff 도 없음")

    // state.changed(AWAITING_APPROVAL) → 집결 + 핑크 recolor
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "CTO", state: .awaitingApproval, bubble: nil), context: ctx),
        [.summonToBand(agentType: "CTO"), .recolor(agentType: "CTO", state: .awaitingApproval)],
        "state.changed(AWAITING_APPROVAL) → 집결 + 핑크")

    // state.changed(COMPLETED) → recolor (기존 유지)
    t.expectEqual(
        visualIntents(for: .stateChanged(agentType: "PM", state: .completed, bubble: nil), context: ctx),
        [.recolor(agentType: "PM", state: .completed)],
        "state.changed(COMPLETED) → recolor")

    // 출근·퇴근은 자율 배회를 끊어야 한다. 배회 중에 퇴근 시각이 되면 사람이 사무실
    // 한가운데서 사라지거나, 문으로 가다 배회에 끌려 되돌아간다.
    t.expectEqual(
        affectedAgentTypes(of: .arrive(agentType: "PM")),
        ["PM"],
        "출근은 그 사람의 배회를 끊는다"
    )
    t.expectEqual(
        affectedAgentTypes(of: .leave(agentType: "PM")),
        ["PM"],
        "퇴근은 그 사람의 배회를 끊는다"
    )

    runCozyPoseContractTests(t)
    runOfficeMeetingTests(t)
}

/// 포즈 계약 — 요청 이름이 실재하는 에셋으로만 내려가는지, 걸음 몸짓이 걸음을 나르는지.
func runCozyPoseContractTests(_ t: TestRunner) {
    t.suite("CozyPoseContract")

    // 방향·걸음 이름은 전부 기본 그림으로 접혀야 한다. 원화는 정면 한 벌뿐이라 `down`·`side`·
    // `-walk1` 을 파일명으로 조립하면 매번 없는 파일을 찾는다 — 정상 실행에서 폴백 로그가
    // 수십 줄씩 쏟아지던 원인이고, 화면에는 어차피 같은 그림이 나왔다.
    for name in ["down", "up", "side", "left", "right", "down-walk1", "side-walk2", "default"] {
        t.expectEqual(normalizedCozyPose(name), cozyIdlePose, "\(name) → 기본 그림")
    }
    t.expectEqual(normalizedCozyPose("sitting"), "sit", "sitting → sit")
    t.expectEqual(normalizedCozyPose("carryingPapers"), "carryingpapers", "대문자 요청도 같은 이름")

    // 앉은 요청은 **앉은 그림**으로만 내려간다. 서 있는 그림으로 내려가면 그 사람만 책상 위에
    // 올라선 것처럼 보인다. 10번은 `typing` 이 없는 캐릭터다.
    t.expectEqual(
        resolveCozyPose(requested: "typing", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)),
        ResolvedCozyPose(pose: "sit", posture: .seated),
        "타이핑 그림이 없으면 기본 그림이 아니라 앉은 그림")
    // 타이핑 요청은 **앉은 그림을 먼저 본다.** `sit` 원화가 허리 아래 없이 팔을 앞으로
    // 뻗은 그림으로 다시 그려져, 책상 뒤에서 다리가 샐 자리가 없다. 옛 `typing` 원화는
    // 의자에 앉아 다리를 뻗은 그림이라 3/4 시점 책상과 원근이 어긋난다.
    t.expectEqual(
        resolveCozyPose(requested: "typing", assetIndex: 0, hasAsset: cozyPoseAssetExists(0)),
        ResolvedCozyPose(pose: "sit", posture: .seated),
        "타이핑 요청은 앉은 그림으로 해결한다")
    // 18번 `typing` 은 태블릿을 들고 **서 있는** 그림이다. 책상 좌석에 쓰면 혼자 선 채로 일한다.
    t.expectEqual(
        resolveCozyPose(requested: "typing", assetIndex: 18, hasAsset: cozyPoseAssetExists(18)),
        ResolvedCozyPose(pose: "sit", posture: .seated),
        "서 있는 타이핑 그림은 좌석에서 쓰지 않는다")

    // 한때 가구가 함께 그려져 배제됐던 셋. 가구 없는 그림으로 교체된 뒤에는 **제 포즈가
    // 그대로 뽑혀야** 한다 — 배제 규칙이 남아 있으면 새로 그린 그림이 조용히 안 쓰인다.
    t.expectEqual(
        resolveCozyPose(requested: "writing", assetIndex: 6, hasAsset: cozyPoseAssetExists(6)),
        ResolvedCozyPose(pose: "writing", posture: .standing),
        "가구를 걷어낸 6번 writing 은 그대로 쓰인다")
    t.expectEqual(
        resolveCozyPose(requested: "reading", assetIndex: 7, hasAsset: cozyPoseAssetExists(7)),
        ResolvedCozyPose(pose: "reading", posture: .standing),
        "가구를 걷어낸 7번 reading 은 그대로 쓰인다")
    t.expectEqual(
        resolveCozyPose(requested: "drinking", assetIndex: 8, hasAsset: cozyPoseAssetExists(8)),
        ResolvedCozyPose(pose: "drinking", posture: .standing),
        "가구를 걷어낸 8번 drinking 은 그대로 쓰인다")

    // 호출자가 자세를 요구하면 그 자세의 그림만 뽑힌다. 대시보드 카드처럼 앉을 자리가
    // 없는 화면이 쓰는 경로다 — 여기서 앉은 그림이 새면 사람이 허공에 주저앉는다.
    //
    // 1번은 `typing` 을 가지고 있지만 **앉은 그림**이라 선 자세 요구에서 제외되고, 18번은
    // 태블릿을 들고 **서 있는** `typing` 이라 그대로 뽑힌다. 같은 요청·같은 파일 유무인데
    // 자세 판정 때문에 답이 갈리는 짝이라, 둘을 함께 봐야 분기가 실제로 도는지 알 수 있다.
    t.expectEqual(
        resolveCozyPose(
            requested: "typing", assetIndex: 1, hasAsset: cozyPoseAssetExists(1),
            posture: .standing
        ),
        ResolvedCozyPose(pose: cozyIdlePose, posture: .standing),
        "선 자세를 요구하면 앉은 타이핑 그림은 쓰지 않는다")
    t.expectEqual(
        resolveCozyPose(
            requested: "typing", assetIndex: 18, hasAsset: cozyPoseAssetExists(18),
            posture: .standing
        ),
        ResolvedCozyPose(pose: "typing", posture: .standing),
        "서 있는 타이핑 그림은 선 자세 요구에도 그대로 쓰인다")
    // 인자를 생략하면 예전대로 요청 이름이 자세를 정한다(오피스 좌석 경로가 이 기본값을 쓴다).
    t.expectEqual(
        resolveCozyPose(requested: "typing", assetIndex: 1, hasAsset: cozyPoseAssetExists(1)),
        ResolvedCozyPose(pose: "sit", posture: .seated),
        "자세를 요구하지 않으면 typing 은 여전히 앉은 자세로 해결된다")

    // 걸음 그림은 **보는 방향으로 갈린다.** 앞모습은 1·2·3·16~19 일곱 명, 뒷모습은
    // 0·4~15 열세 명이 가지고 있다. 반대 방향 그림으로 대신하면 뒷걸음질이 되므로
    // 한쪽만 가진 사람은 그 반대 방향에서 정지 그림으로 접힌다.
    t.expectEqual(
        resolveCozyPose(requested: "walk", assetIndex: 1, hasAsset: cozyPoseAssetExists(1)),
        ResolvedCozyPose(pose: "walk", posture: .standing),
        "앞모습 걸음 그림이 있으면 그대로")
    t.expectEqual(
        resolveCozyPose(requested: "walk-up", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)),
        ResolvedCozyPose(pose: "walk-up", posture: .standing),
        "뒷모습 걸음 그림이 있으면 그대로")
    // **반대 방향으로는 새지 않는다.** 10번은 뒷모습만 있으므로 앞모습 요청은 정지 그림으로
    // 내려가야 한다 — 여기서 `walk-up` 이 뽑히면 이쪽으로 걸어오는 사람이 뒤통수를 보인다.
    t.expectEqual(
        resolveCozyPose(requested: "walk", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)).pose,
        cozyIdlePose, "앞모습이 없으면 뒷모습을 대신 쓰지 않는다")
    t.expectEqual(
        resolveCozyPose(requested: "walk-up", assetIndex: 1, hasAsset: cozyPoseAssetExists(1)).pose,
        cozyIdlePose, "뒷모습이 없으면 앞모습을 대신 쓰지 않는다")
    t.expectEqual(
        resolveCozyPose(requested: "walk", assetIndex: 10, hasAsset: { _ in false }).pose,
        cozyIdlePose, "걸음 그림 파일이 없으면 정지 그림")

    // 손에 든 물건이 뜻을 나르므로 가까운 자세로 옮긴다. 0번은 writing 이 있고, 2번은 writing
    // 없이 reading 만 있으며, 10번은 둘 다 없다.
    t.expectEqual(
        resolveCozyPose(requested: "carryingPapers", assetIndex: 0, hasAsset: cozyPoseAssetExists(0)).pose,
        "writing", "서류 나르기 → 쓰는 그림")
    t.expectEqual(
        resolveCozyPose(requested: "carryingPapers", assetIndex: 2, hasAsset: cozyPoseAssetExists(2)).pose,
        "reading", "쓰는 그림이 없으면 읽는 그림")
    t.expectEqual(
        resolveCozyPose(requested: "carryingPapers", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)).pose,
        cozyIdlePose, "둘 다 없으면 기본 그림")
    t.expectEqual(
        resolveCozyPose(requested: "stowing", assetIndex: 19, hasAsset: cozyPoseAssetExists(19)).pose,
        "reading", "물건 넣기 → 책을 든 그림")
    // 화분 손질은 닮은 그림이 없다. 엉뚱한 소품을 들리면 무엇을 하는지가 오히려 틀리게 읽힌다.
    t.expectEqual(
        resolveCozyPose(requested: "tending", assetIndex: 0, hasAsset: cozyPoseAssetExists(0)).pose,
        cozyIdlePose, "화분 손질은 대체 없이 기본 그림")

    // **해결 결과는 반드시 실재해야 한다.** 계약이 없는 파일을 가리키면 그 사람만 화면에서
    // 사라지거나 로더가 조용히 다른 그림을 끼운다. 에셋 목록을 손으로 베끼지 않고 실제 파일을
    // 세므로, 에셋을 갈아끼우면 여기서 걸린다.
    let requests = OfficeInteractionPose.allCases.map(\.rawValue)
        + ["idle", "default", "down", "side", "down-walk1", "sit", "typing"]
    var unresolved: [String] = []
    var furnitureLeaks: [String] = []
    for assetIndex in 0..<cozyCharacterAssetCount {
        for request in requests {
            let resolved = resolveCozyPose(
                requested: request, assetIndex: assetIndex, hasAsset: cozyPoseAssetExists(assetIndex)
            )
            if resolved.pose != cozyIdlePose, !cozyPoseAssetExists(assetIndex)(resolved.pose) {
                unresolved.append("agent-\(assetIndex)-\(resolved.pose) (요청 \(request))")
            }
            if cozyPoseDrawsOwnFurniture(assetIndex: assetIndex, pose: resolved.pose) {
                furnitureLeaks.append("agent-\(assetIndex)-\(resolved.pose) (요청 \(request))")
            }
            if resolved.posture != cozyPosePosture(assetIndex: assetIndex, pose: resolved.pose) {
                unresolved.append("자세 불일치 agent-\(assetIndex)-\(resolved.pose)")
            }
        }
    }
    t.expectEqual(unresolved.count, 0, "없는 에셋으로 내려간 조합: \(unresolved)")
    t.expectEqual(furnitureLeaks.count, 0, "가구가 그려진 에셋이 새어 나온 조합: \(furnitureLeaks)")

    // 기본 그림은 스무 명 전원이 가져야 한다 — 최후의 보루가 비면 대체가 성립하지 않는다.
    let missingIdle = (0..<cozyCharacterAssetCount).filter { !cozyCharacterAssetFileExists("agent-\($0)") }
    t.expectEqual(missingIdle.count, 0, "기본 그림이 없는 캐릭터: \(missingIdle)")

    runOfficeWalkLeanTests(t)
}

/// 걸음 몸짓 — 걸음 그림이 없는 자리를 기울기가 대신한다.
func runOfficeWalkLeanTests(_ t: TestRunner) {
    t.suite("OfficeWalkLean")

    // 걸음마다 좌우가 번갈아야 "한 걸음"이 보인다. 같은 값이 이어지면 기울어진 채 미끄러진다.
    t.expect(
        officeWalkLean(facing: .down, step: 0) > 0 && officeWalkLean(facing: .down, step: 1) < 0,
        "위아래로 걸을 때는 좌우 번갈이만 남는다")
    t.expectEqual(
        officeWalkLean(facing: .down, step: 0), -officeWalkLean(facing: .down, step: 1),
        "번갈이는 대칭")

    // 화면 왼쪽으로 갈 때는 몸이 왼쪽(반시계, 양수)으로, 오른쪽으로 갈 때는 그 반대로 기운다.
    t.expect(
        officeWalkLean(facing: .left, step: 0) > officeWalkLean(facing: .down, step: 0),
        "왼쪽으로 걸으면 진행 방향으로 더 기운다")
    t.expect(
        officeWalkLean(facing: .right, step: 0) < officeWalkLean(facing: .down, step: 0),
        "오른쪽으로 걸으면 반대로 기운다")

    // 기울기가 커지면 걷는 게 아니라 넘어지는 그림이 된다. 상한을 못박아 둔다.
    for facing in [Facing.up, .down, .left, .right] {
        for step in 0..<4 {
            t.expect(
                abs(officeWalkLean(facing: facing, step: step)) < 0.12,
                "기울기 상한 (\(facing) \(step) = \(officeWalkLean(facing: facing, step: step)))")
        }
    }
}

/// 캐릭터 포즈 에셋이 실제로 있는지. 코어는 파일을 못 읽으므로 계약 검사에서는 테스트가
/// 렌더러 대신 대답한다.
///
/// 목록을 손으로 베끼지 않고 **파일을 직접 센다.** 예전 걸음 프레임 검사는 이미 폐기된 도트
/// 시트를 상대로 통과하고 있었다 — 검사는 초록인데 화면에서는 아무도 걷지 않았다.
func cozyPoseAssetExists(_ assetIndex: Int) -> (String) -> Bool {
    { pose in cozyCharacterAssetFileExists("agent-\(assetIndex)-\(pose)") }
}

func cozyCharacterAssetFileExists(_ name: String) -> Bool {
    let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // ConsoleCoreTests
        .deletingLastPathComponent()  // Sources
        .deletingLastPathComponent()  // 패키지 루트
        .appendingPathComponent("Sources/IdaeriConsole/Resources/cozy/characters")
    return FileManager.default.fileExists(
        atPath: directory.appendingPathComponent("\(name).png").path
    )
}

func runOfficeMeetingTests(_ t: TestRunner) {
    t.suite("OfficeChoreography")

    // MARK: - 회의 소집

    // 체인 참여자가 셋이면 1:1 전달 대신 회의를 연다.
    let chainAgents = [
        makeAgent("PM", .completed), makeAgent("CTO", .completed),
        makeAgent("BACKEND", .inProgress),
    ]
    let threeStepRuns = [makeRun("r0", "PM"), makeRun("r1", "CTO", parentId: "r0")]
    let threeStepContext = ChoreographyContext(
        agents: chainAgents, runs: threeStepRuns, pendingCommands: []
    )
    t.expectEqual(
        visualIntents(
            for: .runStarted(makeRun("r2", "BACKEND", parentId: "r1")), context: threeStepContext
        ),
        [.meeting(agentTypes: ["PM", "CTO", "BACKEND"], thenWorking: "BACKEND")],
        "3단 체인 → 회의 소집(조상부터 순서 보존)"
    )

    // 회의 intent 는 참석자 전원의 배회를 끊어야 한다 — 한 명이라도 빠지면 그 사람의
    // 머무름 콜백이 나중에 깨어나 회의 도중 자리로 끌고 간다.
    t.expectEqual(
        affectedAgentTypes(
            of: .meeting(agentTypes: ["PM", "CTO", "BACKEND"], thenWorking: "BACKEND")
        ),
        ["PM", "CTO", "BACKEND"],
        "회의 참석자 전원이 배회 취소 대상"
    )
    t.expectEqual(
        affectedAgentTypes(of: .meeting(agentTypes: ["PM", "CTO"], thenWorking: "BACKEND")),
        ["PM", "CTO", "BACKEND"],
        "참석자 목록에 없는 후속 작업자도 취소 대상"
    )

    // 모르는 에이전트가 낀 체인은 그 사람을 빼고 센다 — 화면에 없는 사람은 회의에 못 온다.
    let unknownChainRuns = [makeRun("r0", "GHOST"), makeRun("r1", "PM", parentId: "r0")]
    let unknownChainContext = ChoreographyContext(
        agents: chainAgents, runs: unknownChainRuns, pendingCommands: []
    )
    t.expectEqual(
        visualIntents(
            for: .runStarted(makeRun("r2", "CTO", parentId: "r1")), context: unknownChainContext
        ),
        [.handoff(from: "PM", to: "CTO"), .working(agentType: "CTO")],
        "미지의 조상을 뺀 참여자가 둘이면 회의 대신 1:1 전달"
    )

    // 체인 추적: 조상 → 자신 순, 같은 사람이 두 번 나오면 처음 자리만.
    let repeatRuns = [makeRun("c0", "PM"), makeRun("c1", "CTO", parentId: "c0")]
    t.expectEqual(
        officeChainParticipants(run: makeRun("c2", "PM", parentId: "c1"), runs: repeatRuns),
        ["PM", "CTO"],
        "같은 사람이 체인에 두 번 나와도 한 번만"
    )

    // 순환 parentId 에서 멈춘다. 여기서 무한 루프에 빠지면 스냅샷 적용이 멈춰
    // 관제 화면 전체가 얼어붙는다.
    let cyclic = [
        ConsoleRun(
            id: "x0", agentType: "PM", status: "RUNNING", parentId: "x1",
            startedAt: "t", finishedAt: nil
        ),
        ConsoleRun(
            id: "x1", agentType: "CTO", status: "RUNNING", parentId: "x0",
            startedAt: "t", finishedAt: nil
        ),
    ]
    t.expect(
        officeChainParticipants(run: cyclic[0], runs: cyclic).count <= 16,
        "순환 체인에서도 상한 안에서 멈춘다"
    )

    // 회의 자리는 테이블 둘레의 통행 칸이어야 한다.
    let meetingPlan = officeFloorPlan(agents: chainAgents)
    let meetingSeats = officeMeetingSeats(plan: meetingPlan)
    t.expect(!meetingSeats.isEmpty, "회의 자리 존재")
    t.expect(
        meetingSeats.count >= officeMeetingMinimumParticipants,
        "회의 자리가 최소 참여 인원(\(officeMeetingMinimumParticipants))만큼 있다"
    )
    let tableTiles = Set(
        meetingPlan.furniture
            .filter { $0.kind == .meetingTable }
            .flatMap { table in
                (0..<table.kind.footprint.height).map {
                    TilePoint(x: table.tile.x, y: table.tile.y + $0)
                }
            }
    )
    for seat in meetingSeats {
        t.expect(meetingPlan.walkable.contains(seat), "회의 자리 \(seat.x),\(seat.y) 통행 가능")
        t.expect(!tableTiles.contains(seat), "회의 자리가 테이블 칸 위가 아님")
    }
    // 전 좌석에서 회의실까지 갈 수 있어야 한다 — 못 가면 그 사람만 조용히 제자리에 남는다.
    for seat in meetingSeats {
        let stranded = meetingPlan.desks.filter {
            officePath(from: $0.seat, to: seat, walkable: meetingPlan.walkable).isEmpty
        }
        t.expectEqual(stranded.count, 0, "회의 자리 \(seat.x),\(seat.y) 에 못 가는 좌석 없음")
    }
}
