import Foundation

@testable import ConsoleCore

private func makeInteractionAgent(_ type: String, _ state: ConsoleAgentState) -> ConsoleAgent {
    ConsoleAgent(
        agentType: type,
        displayName: type,
        slashCommands: [],
        description: "",
        state: state,
        bubble: ""
    )
}

func runOfficeInteractionTests(_ t: TestRunner) {
    t.suite("OfficeInteraction")

    // 호버 쪽지 — 이름(누구)이 맨 위, 직무(정체)가 가운데, 활동(지금)이 아래.
    // 하나만 와도 쪽지는 떠야 한다.
    t.expect(
        officeHoverNote(name: "답변 판정", job: "리뷰 답변을 판정한다", activity: "#271 리뷰 중")
            == "답변 판정\n리뷰 답변을 판정한다\n#271 리뷰 중",
        "이름이 첫 줄, 직무가 둘째 줄, 활동이 셋째 줄"
    )
    // 쪽지가 커서 옆으로 나오면 위치가 주인을 말해 주지 않는다 — 이름이 빠지면 누구 얘기인지
    // 알 방법이 사라진다.
    t.expect(
        officeHoverNote(name: "답변 판정", job: nil, activity: nil)?
            .hasPrefix("답변 판정") == true,
        "직무·활동이 없어도 이름은 뜬다"
    )
    t.expect(
        officeHoverNote(name: nil, job: nil, activity: "업무 대기중") == "업무 대기중",
        "직무를 모르는 서버(버전 스큐)에서도 활동은 뜬다"
    )
    t.expect(
        officeHoverNote(name: nil, job: "오늘 할 일을 정한다", activity: nil) == "오늘 할 일을 정한다",
        "활동이 없어도 직무는 뜬다"
    )
    // 공백만 든 문구가 줄로 남으면 쪽지에 빈 줄이 생겨 판이 위로 들뜬다.
    t.expect(
        officeHoverNote(name: " ", job: "  ", activity: "  ") == nil,
        "빈 문구뿐이면 쪽지를 띄우지 않는다"
    )

    // 말풍선 접기 — 좌석 몫 안에 들어가야 옆자리 문구와 포개지지 않는다.
    //
    // 폭은 글자 하나당 10px 로 잰다(공백 포함). 실제 글꼴 대신 고정 폭을 쓰는 이유는 판정이
    // 기계마다 달라지지 않게 하기 위해서다 — 규칙(어디서 끊는가)만 확인한다.
    let measure: (String) -> Double = { Double($0.count) * 10 }

    t.expectEqual(
        officeWrapBubble("#2999 리뷰 중", maxWidth: 200, maxLines: 2, measure: measure),
        "#2999 리뷰 중",
        "몫 안에 들어가면 그대로 한 줄"
    )
    // `#2999 리뷰 중` = 11자 = 110px. 몫이 70px 이면 공백에서 끊어 두 줄.
    t.expectEqual(
        officeWrapBubble("#2999 리뷰 중", maxWidth: 70, maxLines: 2, measure: measure),
        "#2999\n리뷰 중",
        "몫을 넘으면 공백에서 접는다"
    )
    // 공백이 없는 문구는 낱말 단위로 못 줄인다 — 글자로 끊어야 한다.
    t.expectEqual(
        officeWrapBubble("스키마짜는중입니다", maxWidth: 50, maxLines: 2, measure: measure),
        "스키마짜는\n중입니다",
        "공백이 없으면 글자 단위로 끊는다"
    )
    // 두 줄로도 안 들어가면 잘렸다는 표시가 남아야 한다 — 조용히 사라지면 문구가 원래 그런
    // 줄 알고 읽는다.
    let truncated = officeWrapBubble(
        "아주 긴 문구가 계속 이어진다", maxWidth: 50, maxLines: 2, measure: measure
    )
    t.expect(truncated.components(separatedBy: "\n").count <= 2, "줄 수 상한을 지킨다")
    t.expect(truncated.hasSuffix("…"), "잘린 문구에는 말줄임표가 남는다(\(truncated))")
    for line in truncated.components(separatedBy: "\n") {
        t.expect(measure(line) <= 50, "접은 줄이 몫 안에 있다: \(line) \(measure(line))px")
    }

    // 커서 옆 쪽지 판 — 기본은 커서 오른쪽 위, 그쪽이 좁으면 반대편, 그래도 안 되면 화면 안.
    //
    // 화면 밖으로 나간 판은 잘려서 **읽히지 않는다.** 머리 위 쪽지를 커서 옆으로 옮긴 이유가
    // 가림 해소인데, 판이 창 경계에서 잘리면 같은 증상이 자리만 바꿔 돌아온다.
    let rightUp = officeTooltipOrigin(
        cursor: OfficePoint(x: 100, y: 100), boxWidth: 180, boxHeight: 60,
        sceneWidth: 960, sceneHeight: 560, gap: 14
    )
    t.expectEqual(rightUp.x, 114, "여유가 있으면 커서 오른쪽")
    t.expectEqual(rightUp.y, 114, "여유가 있으면 커서 위")

    let flipped = officeTooltipOrigin(
        cursor: OfficePoint(x: 900, y: 540), boxWidth: 180, boxHeight: 60,
        sceneWidth: 960, sceneHeight: 560, gap: 14
    )
    t.expectEqual(flipped.x, 706, "오른쪽이 좁으면 커서 왼쪽으로 넘긴다")
    t.expectEqual(flipped.y, 466, "위가 좁으면 커서 아래로 넘긴다")

    // 최소 창에 24자 직무 문장이 온 경우 — 뒤집어도 안 들어간다. 커서에서 멀어지더라도
    // 판 전체가 화면 안에 있어야 한다.
    let clamped = officeTooltipOrigin(
        cursor: OfficePoint(x: 30, y: 20), boxWidth: 300, boxHeight: 70,
        sceneWidth: 320, sceneHeight: 80, gap: 14
    )
    t.expect(
        clamped.x >= 0 && clamped.x + 300 <= 320,
        "뒤집어도 안 들어가면 화면 안에 가둔다(x \(clamped.x))"
    )
    t.expect(
        clamped.y >= 0 && clamped.y + 70 <= 80,
        "뒤집어도 안 들어가면 화면 안에 가둔다(y \(clamped.y))"
    )

    let slots: [(agentType: String, point: OfficePoint)] = [
        ("PM", OfficePoint(x: 100, y: 100)),
        ("CTO", OfficePoint(x: 300, y: 100)),
    ]

    // 원 중심 근처 클릭 → 그 agentType
    t.expectEqual(agentTypeAt(point: OfficePoint(x: 108, y: 104), slots: slots, radius: 26), "PM", "중심 근처 → PM")

    // 어떤 원과도 먼 클릭 → nil
    t.expectNil(agentTypeAt(point: OfficePoint(x: 200, y: 400), slots: slots, radius: 26), "빈 공간 클릭 → nil")

    // 겹치는 반경이면 더 가까운 쪽
    t.expectEqual(agentTypeAt(point: OfficePoint(x: 295, y: 100), slots: slots, radius: 300), "CTO", "가장 가까운 원 선택")

    // 대표 앞줄 — 대표와 승인 대기자는 한 칸 차이로 붙어 선다. 대표를 같은 판정에 넣어야
    // 가까운 쪽 하나만 잡힌다(따로 재면 한 번의 클릭에 둘 다 반응한다).
    let queueSlots: [(agentType: String, point: OfficePoint)] = [
        ("CTO", OfficePoint(x: 100, y: 70)),
        (officeHitTargetPresident, OfficePoint(x: 100, y: 100)),
    ]
    t.expectEqual(
        agentTypeAt(point: OfficePoint(x: 100, y: 96), slots: queueSlots, radius: 26),
        officeHitTargetPresident, "대표 쪽 클릭 → 대표")
    t.expectEqual(
        agentTypeAt(point: OfficePoint(x: 100, y: 74), slots: queueSlots, radius: 26),
        "CTO", "줄 선 사람 쪽 클릭 → 그 사람")

    // approvalFor: 해당 agentType 의 승인 건
    let approvals = [
        ConsoleApproval(id: "a1", agentType: "CTO", title: "PR1", createdAt: "t1"),
        ConsoleApproval(id: "a2", agentType: "PM", title: "PR2", createdAt: "t2"),
    ]
    t.expectEqual(approvalFor(agentType: "PM", in: approvals)?.id, "a2", "PM 승인 건 매칭")
    t.expectNil(approvalFor(agentType: "BE", in: approvals), "승인 없는 에이전트 → nil")

    // 이름표 세기 — 기본은 옅게, 손이 필요한 상태와 지금 보고 있는 대상만 진하게.
    // 29명 전원이 늘 진한 딱지를 달면 상태 링이 라벨에 덮인다.
    t.expect(
        nameplateIsEmphasized(state: .awaitingApproval, isHovered: false, isSelected: false),
        "승인 대기는 강조"
    )
    t.expect(
        nameplateIsEmphasized(state: .failed, isHovered: false, isSelected: false),
        "실패는 강조"
    )
    t.expect(
        nameplateIsEmphasized(state: .waiting, isHovered: true, isSelected: false),
        "마우스 올린 대상은 상태와 무관하게 강조"
    )
    t.expect(
        nameplateIsEmphasized(state: .completed, isHovered: false, isSelected: true),
        "선택된 대상은 강조"
    )
    for quiet in [ConsoleAgentState.waiting, .inProgress, .completed, .awaitingIntegration] {
        t.expect(
            !nameplateIsEmphasized(state: quiet, isHovered: false, isSelected: false),
            "\(quiet.rawValue) 는 기본 세기"
        )
    }

    let waitingPM = makeInteractionAgent("PM", .waiting)
    let awaitingCTO = makeInteractionAgent("CTO", .awaitingApproval)
    let waitingBE = makeInteractionAgent("BE", .waiting)
    let ctoApproval = ConsoleApproval(id: "queue-a1", agentType: "CTO", title: "PR", createdAt: "t")
    let pmApproval = ConsoleApproval(id: "queue-a2", agentType: "PM", title: "PR", createdAt: "t")
    let beApproval = ConsoleApproval(id: "queue-a4", agentType: "BE", title: "PR", createdAt: "t")

    t.expectEqual(
        reconciledQueueOrder(current: ["CTO"], agents: [awaitingCTO], approvals: []),
        ["CTO"],
        "승인 대기 상태면 줄 유지"
    )
    t.expectEqual(
        reconciledQueueOrder(current: ["PM"], agents: [waitingPM], approvals: [pmApproval]),
        ["PM"],
        "상태 반영 전이라도 승인 건이 있으면 줄 유지"
    )
    t.expectEqual(
        reconciledQueueOrder(current: ["PM"], agents: [waitingPM], approvals: []),
        [],
        "대기 상태이고 승인 건도 없으면 줄 제거"
    )
    t.expectEqual(
        reconciledQueueOrder(current: ["PM"], agents: [], approvals: [pmApproval]),
        [],
        "스냅샷에서 사라진 사람은 승인 건이 있어도 줄 제거"
    )
    t.expectEqual(
        reconciledQueueOrder(
            current: ["BE", "CTO", "PM"],
            agents: [waitingPM, awaitingCTO, waitingBE],
            approvals: [pmApproval]
        ),
        ["CTO", "PM"],
        "섞인 줄에서 남는 사람의 도착 순서 보존"
    )
    t.expectEqual(
        reconciledQueueOrder(
            current: ["PM", "CTO"],
            agents: [waitingPM, awaitingCTO],
            approvals: [pmApproval, ctoApproval]
        ),
        ["PM", "CTO"],
        "전원 유효하면 기존 줄 배열 그대로 유지"
    )

    let nilAgentApproval = ConsoleApproval(
        id: "queue-a3",
        agentType: nil,
        title: "세션 유휴",
        createdAt: "t"
    )
    t.expectEqual(
        reconciledQueueOrder(
            current: ["BE"],
            agents: [waitingBE],
            approvals: [nilAgentApproval]
        ),
        [],
        "agentType nil 승인은 누구도 줄에 유지하지 않음"
    )

    t.expectEqual(
        reconciledQueueOrder(current: [], agents: [awaitingCTO], approvals: []),
        ["CTO"],
        "빈 줄에도 승인 대기 상태인 사람 추가"
    )
    t.expectEqual(
        reconciledQueueOrder(current: [], agents: [waitingPM], approvals: [pmApproval]),
        ["PM"],
        "상태 반영 전이라도 승인 건이 있으면 빈 줄에 추가"
    )
    t.expectEqual(
        reconciledQueueOrder(
            current: ["PM"],
            agents: [waitingBE, waitingPM, awaitingCTO],
            approvals: [beApproval, pmApproval]
        ),
        ["PM", "BE", "CTO"],
        "기존 줄 순서 뒤에 신규 대기자를 스냅샷 순서로 추가"
    )
    t.expectEqual(
        reconciledQueueOrder(current: ["CTO"], agents: [awaitingCTO], approvals: []),
        ["CTO"],
        "이미 줄에 있는 사람은 중복 추가하지 않음"
    )
    t.expectEqual(
        reconciledQueueOrder(current: [], agents: [waitingBE], approvals: [nilAgentApproval]),
        [],
        "agentType nil 승인만으로는 빈 줄에 누구도 추가하지 않음"
    )

    let deterministicAgents = [awaitingCTO, waitingPM, waitingBE]
    let deterministicApprovals = [pmApproval, beApproval]
    let firstReconciliation = reconciledQueueOrder(
        current: ["PM"],
        agents: deterministicAgents,
        approvals: deterministicApprovals
    )
    let secondReconciliation = reconciledQueueOrder(
        current: ["PM"],
        agents: deterministicAgents,
        approvals: deterministicApprovals
    )
    t.expect(
        firstReconciliation == ["PM", "CTO", "BE"]
            && secondReconciliation == firstReconciliation,
        "같은 입력은 같은 줄 순서를 반환"
    )

    t.expectEqual(
        strollersToStop(strolling: ["PM"], agents: [waitingPM]),
        [],
        "배회 중이어도 대기 상태면 유지"
    )

    // 완료는 탕비실 이동(visitLounge)이 같은 배회 집합을 쓰므로 중단 대상이 아니다.
    // 여기서 잡으면 다른 에이전트의 상태 변경으로 스냅샷이 갱신될 때마다 완료 연출이 끊긴다.
    t.expectEqual(
        strollersToStop(
            strolling: ["COMPLETED"],
            agents: [makeInteractionAgent("COMPLETED", .completed)]
        ),
        [],
        "배회 중이어도 완료 상태면 유지(탕비실 연출 보호)"
    )

    let stopStates: [(String, ConsoleAgentState)] = [
        ("IN_PROGRESS", .inProgress),
        ("AWAITING_APPROVAL", .awaitingApproval),
        ("FAILED", .failed),
        ("AWAITING_INTEGRATION", .awaitingIntegration),
    ]
    for (agentType, state) in stopStates {
        t.expectEqual(
            strollersToStop(
                strolling: [agentType],
                agents: [makeInteractionAgent(agentType, state)]
            ),
            [agentType],
            "배회 중인 \(state.rawValue) 상태는 중단"
        )
    }

    t.expectEqual(
        strollersToStop(strolling: ["MISSING"], agents: []),
        ["MISSING"],
        "스냅샷에서 사라진 배회자는 중단"
    )

    t.expectEqual(
        strollersToStop(
            strolling: ["ZETA", "WAITING", "ALPHA", "MISSING"],
            agents: [
                makeInteractionAgent("WAITING", .waiting),
                makeInteractionAgent("ZETA", .failed),
                makeInteractionAgent("ALPHA", .inProgress),
            ]
        ),
        ["ALPHA", "MISSING", "ZETA"],
        "여러 배회 중단 대상은 agentType 사전순"
    )

    t.expectEqual(
        strollersToStop(
            strolling: [],
            agents: stopStates.map { makeInteractionAgent($0.0, $0.1) }
        ),
        [],
        "배회자가 없으면 중단 대상도 없음"
    )

    // 창이 좁아 이름표가 겹치는 구간에서만 숨긴다.
    //
    // 경계 위(넉넉한 창)에서는 상태와 무관하게 전부 보여야 한다 — 여기서 숨기기 시작하면
    // 평소 화면에서 사람 이름이 사라진다.
    let roomy = officeNameplateCrowdedTileSize + 1
    for state in [
        ConsoleAgentState.waiting, .completed, .inProgress, .awaitingApproval, .failed,
        .awaitingIntegration,
    ] {
        t.expect(
            nameplateIsVisible(tileSize: roomy, state: state, isHovered: false, isSelected: false),
            "넓은 창에서는 \(state.rawValue) 이름표도 보인다"
        )
    }

    // 좁은 창에서는 손이 필요한 사람·일이 도는 사람·보고 있는 사람만 남는다.
    let cramped = officeNameplateCrowdedTileSize - 1
    let keptWhenCramped: [(ConsoleAgentState, Bool, Bool, Bool)] = [
        (.awaitingApproval, false, false, true),
        (.failed, false, false, true),
        (.inProgress, false, false, true),
        (.waiting, true, false, true),
        (.waiting, false, true, true),
        (.waiting, false, false, false),
        (.completed, false, false, false),
        (.awaitingIntegration, false, false, false),
    ]
    for (state, hovered, selected, expected) in keptWhenCramped {
        t.expectEqual(
            nameplateIsVisible(
                tileSize: cramped, state: state, isHovered: hovered, isSelected: selected
            ),
            expected,
            "좁은 창 \(state.rawValue)(hover=\(hovered), select=\(selected)) 표시=\(expected)"
        )
    }

    // 숨쉬기 위상은 사람마다 다르고 한 주기 안에 들어간다.
    // 전원이 같은 위상이면(=이 단언이 깨지면) 29명이 한 몸처럼 오르내린다.
    let phases = ["PM", "BACKEND", "CODE_REVIEWER", "CEO", "CTO", "PO_EVAL"]
        .map { officeBreathPhaseSeconds(agentType: $0) }
    for phase in phases {
        t.expect(
            phase >= 0 && phase < officeBreathCycleSeconds,
            "숨쉬기 위상이 한 주기 안(\(phase))"
        )
    }
    t.expect(Set(phases).count > 1, "숨쉬기 위상이 사람마다 다르다")
    t.expectEqual(
        officeBreathPhaseSeconds(agentType: "PM"),
        officeBreathPhaseSeconds(agentType: "PM"),
        "같은 사람은 실행마다 같은 위상"
    )

    // MARK: - 내 작업 세션

    let sessionNow = Date(timeIntervalSince1970: 1_800_000_000)
    func sessionStamp(minutesAgo: Double) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: sessionNow.addingTimeInterval(-minutesAgo * 60))
    }
    func makeSession(
        _ id: String, _ state: String, quietMinutes: Double = 0
    ) -> ConsoleSession {
        ConsoleSession(
            sessionId: id, pid: 1, source: "claude", name: id, cwd: "/tmp",
            state: state, startedAt: sessionStamp(minutesAgo: quietMinutes),
            lastActivityAt: sessionStamp(minutesAgo: quietMinutes)
        )
    }

    let sessionPlan = officeFloorPlan(
        agents: [
            makeInteractionAgent("PM", .waiting), makeInteractionAgent("CTO", .waiting),
        ]
    )
    let sessionTiles = officeSessionDesks(plan: sessionPlan)
    t.expect(!sessionTiles.isEmpty, "세션 작업 책상 존재")
    // 승인 대기 줄과 다른 줄을 써야 한다 — 같은 줄이면 줄 선 사람과 겹쳐 승인이 몇 건인지
    // 세지 못한다.
    let queued = Set(sessionPlan.queueTiles)
    for tile in sessionTiles {
        t.expect(!queued.contains(tile), "세션 책상이 승인 대기 줄과 겹치지 않음")
        t.expect(tile.x != sessionPlan.presidentTile.x, "대표가 선 칸은 비운다")
        t.expectEqual(tile.y, sessionPlan.presidentTile.y, "세션 책상은 대표실 안쪽 줄")
        // 좌표를 따로 계산하지 않고 평면도에 실제로 놓인 책상만 쓴다. 아니면 화면에 없는
        // 책상 위에 이름표만 뜬다.
        t.expect(
            sessionPlan.furniture.contains { $0.kind == .desk && $0.tile == tile },
            "평면도에 실제로 놓인 책상"
        )
    }
    // 이름표가 설 폭을 확보한다. 붙여 놓으면 이름표가 이어 붙어 한 줄짜리 글자 뭉치가 되고,
    // 그 줄은 어느 것도 읽을 수 없다(실제로 그랬다).
    let sessionXs = sessionTiles.map(\.x).sorted()
    for (left, right) in zip(sessionXs, sessionXs.dropFirst()) {
        t.expect(right - left >= 2, "책상끼리 최소 두 칸 간격")
    }
    // 응접 가구가 짝수 칸을 물면 책상이 조용히 줄어든다. 개수를 고정해 그걸 잡는다.
    //
    // 기준이 다섯에서 넷으로 내려온 것은 복도를 내면서 방 왼쪽 한 칸이 칸막이 벽이 됐기
    // 때문이다. 책상은 그 벽을 피해 한 칸 안쪽부터 두 칸 간격으로 놓이므로 넷이 된다 —
    // 가구를 빼도 늘지 않는다(비는 것은 홀수 칸이다).
    // 넘치는 세션은 원래 설계대로 좌상단 요약의 총계가 맡는다.
    t.expect(
        sessionTiles.count >= 4, "대표실에 작업 책상 최소 4개 (지금 \(sessionTiles.count))"
    )
    // 책상 앞줄은 통로로 남아야 한다 — 여기까지 막으면 탕비실 가는 사람이 밴드를 못 건넌다.
    for tile in sessionTiles {
        t.expect(
            sessionPlan.walkable.contains(TilePoint(x: tile.x, y: tile.y - 1)),
            "책상 \(tile.x) 앞줄은 통행 가능"
        )
    }

    // 잠깐 쉬는 사람은 자리를 지키고, 오래 조용한 사람만 퇴근한다.
    //
    // 백엔드의 `idle` 은 60초짜리라 그것으로 사람을 지우면 답변을 기다리는 사이 사라졌다
    // 나타나기를 반복한다 — 지적받은 "귀신" 이 정확히 그 현상이었다.
    let mixedSessions = [
        makeSession("z-quiet", "idle", quietMinutes: 60),
        makeSession("a-resting", "idle", quietMinutes: 3),
        makeSession("m-active", officeSessionActiveState),
    ]
    t.expectEqual(
        officeVisibleSessions(mixedSessions, limit: 99, now: sessionNow).map(\.sessionId),
        ["m-active", "a-resting"],
        "오래 조용한 사람만 퇴근하고, 잠깐 쉬는 사람은 남는다"
    )
    t.expectEqual(
        officeVisibleSessions(mixedSessions, limit: 0, now: sessionNow).count, 0,
        "자리가 없으면 아무도 안 앉힌다"
    )
    t.expectEqual(
        officeVisibleSessions(mixedSessions, limit: 1, now: sessionNow).map(\.sessionId),
        ["m-active"],
        "자리가 모자라면 도는 사람이 먼저 앉는다"
    )
    t.expectEqual(
        officeVisibleSessions(mixedSessions, limit: 2, now: sessionNow).map(\.sessionId),
        officeVisibleSessions(mixedSessions.reversed(), limit: 2, now: sessionNow)
            .map(\.sessionId),
        "입력 순서가 달라도 같은 결과"
    )
    // 시각을 못 읽으면 남긴다 — 읽기 실패로 사람을 지우면 그게 바로 없애려던 현상이다.
    let unreadable = ConsoleSession(
        sessionId: "broken", pid: 1, source: "claude", name: "broken", cwd: "/tmp",
        state: "idle", startedAt: "언제인지 모름", lastActivityAt: nil
    )
    t.expect(
        officeSessionIsPresent(unreadable, now: sessionNow),
        "시각을 못 읽는 세션은 지우지 않는다"
    )

    // === 자리 배정 — 한 번 앉으면 지킨다 ===
    // 매번 순서대로 다시 나눠 주면, 하나 퇴근할 때마다 남은 전원이 옆으로 옮겨 앉아
    // 아무 일도 없었는데 사무실이 통째로 움직인다.
    let seatA = sessionTiles[0]
    let seatB = sessionTiles[1]
    let staying = [makeSession("keeps", officeSessionActiveState)]
    t.expectEqual(
        officeAssignSessionSeats(
            sessions: staying, tiles: sessionTiles, previous: ["keeps": seatB]
        )["keeps"],
        seatB,
        "앉아 있던 사람은 앞자리가 비어도 자기 자리를 지킨다"
    )
    let joined = officeAssignSessionSeats(
        sessions: [
            makeSession("keeps", officeSessionActiveState),
            makeSession("newcomer", officeSessionActiveState),
        ],
        tiles: sessionTiles,
        previous: ["keeps": seatB]
    )
    t.expectEqual(joined["keeps"], seatB, "새 사람이 와도 기존 자리는 그대로")
    t.expectEqual(joined["newcomer"], seatA, "새 사람은 남은 자리 중 앞에서부터")
    // 자리보다 사람이 많으면 남는 사람은 배정에서 빠진다(총계는 요약이 맡는다).
    let crowd = (0..<(sessionTiles.count + 3)).map {
        makeSession("s\($0)", officeSessionActiveState)
    }
    t.expectEqual(
        officeAssignSessionSeats(sessions: crowd, tiles: sessionTiles, previous: [:]).count,
        sessionTiles.count,
        "자리 수를 넘겨 앉히지 않는다"
    )
    t.expectEqual(
        Set(
            officeAssignSessionSeats(sessions: crowd, tiles: sessionTiles, previous: [:]).values
        ).count,
        sessionTiles.count,
        "두 사람이 한 자리에 겹쳐 앉지 않는다"
    )

    // 이름표는 옆 책상과 겹치지 않게 자른다. 자르되 뒤쪽(구분되는 정보)을 남긴다 —
    // 워크트리 이름은 앞이 대개 같은 저장소 이름이라 앞을 남기면 전부 같은 글자가 된다.
    t.expectEqual(officeSessionShortName("idaeri"), "idaeri", "상한 안이면 그대로")
    let fullName = "personal_agents-office-window-light"
    let shortened = officeSessionShortName(fullName)
    t.expect(shortened.count <= 12, "긴 이름은 상한 안으로 자른다(실제 \(shortened))")
    t.expect(shortened.hasPrefix("…"), "잘렸음을 표시한다")
    t.expect(fullName.hasSuffix(shortened.dropFirst()), "남긴 부분은 원래 이름의 꼬리")
    // 같은 저장소의 다른 워크트리 둘이 서로 다른 이름표를 받아야 한다 — 앞을 남겼다면
    // 둘 다 "personal_ag…" 가 되어 이름표가 있어도 구분이 안 된다.
    t.expect(
        officeSessionShortName("personal_agents-window-light")
            != officeSessionShortName("personal_agents-selection-ring"),
        "같은 저장소의 다른 워크트리가 서로 다른 이름표"
    )

    // 단어 중간에서 끊지 않는다.
    //
    // 글자 수로만 자르면 실제 세션 이름(`personal-agents-74`·`-86`·`-ce`)이 각각
    // `…l-agents-74`·`…l-agents-86`·`…l-agents-ce` 가 된다 — 앞 아홉 글자가 같고 뒤 두 자로만
    // 갈리는 이름표 셋이 나란히 서서, 이름표가 있어도 어느 창인지 알 수 없다. 위의 구분성
    // 단언이 이 구간을 통과시킨 이유는 표본(`-window-light` / `-selection-ring`)이 꼬리부터
    // 달라서다 — **실제 이름의 구조(공통 접두 + 짧은 꼬리)를 재현하지 못했다.**
    for name in ["personal-agents-74", "personal-agents-86", "personal-agents-ce"] {
        let label = officeSessionShortName(name)
        t.expect(
            label == "…agents-74" || label == "…agents-86" || label == "…agents-ce",
            "\(name) 은 구분자 경계에서 잘린다(실제 \(label))"
        )
    }

    // 자리 폭이 좁아지면 이름도 짧아진다.
    //
    // 상한이 상수(12)면 **창이 작을수록 이름표만 겹친다** — 한글 하한(11px) 때문에 글자는 어느
    // 크기 밑으로 안 줄어드는데 자리 간격은 창을 따라 계속 좁아지기 때문이다. 실제로 최소 창에서
    // 네 세션의 이름표가 공백 없이 이어붙어 한 덩어리로 보였다.
    let wideLimit = officeSessionLabelLimit(tileSize: 61.0, fontSize: 61.0 * 0.24)
    let narrowLimit = officeSessionLabelLimit(tileSize: 20.6, fontSize: 11.0)
    t.expect(narrowLimit < wideLimit, "좁은 창의 상한(\(narrowLimit))이 넓은 창(\(wideLimit))보다 작다")
    t.expect(narrowLimit >= officeSessionLabelMinLimit, "자리 표시가 남을 만큼은 남긴다")

    // 잘린 이름표가 자리 간격을 넘지 않는다 — 넘으면 옆 세션 이름을 덮는다.
    //
    // 다만 이 검사가 보는 것은 **1차 추정이 자기 예산 안에 있는가** 까지다. 폭을 상한 계산과
    // 같은 평균 비율로 되계산하므로, 실제 폰트가 그보다 넓은 경우(대문자가 이어지는 이름)는
    // 여기서 잡히지 않는다 — 그 몫은 그려 본 폭으로 누르는 `officeLabelSqueeze` 가 맡는다.
    // 한글이 섞인 이름도 함께 본다. 세션 이름은 실행 디렉터리에서 오므로 경로에 한글이 있으면
    // 그대로 들어온다 — 글자 수로만 세면 여섯 자가 자리 두 칸이 아니라 세 칸을 차지한다.
    for tileSize in [20.6, 27.4, 40.0, 61.0, 90.0] {
        let fontSize = max(11.0, tileSize * 0.24)
        let limit = officeSessionLabelLimit(tileSize: tileSize, fontSize: fontSize)
        for name in ["personal-agents-office-window-light", "기타-백엔드-작업방-가나다라마"] {
            let label = officeSessionShortName(name, limit: limit)
            let width = Double(officeLabelWidthUnits(label)) * fontSize * officeLatinGlyphWidthRatio
            t.expect(
                width <= tileSize * officeSessionDeskStrideTiles,
                "타일 \(tileSize) · \(label) 폭 \(Int(width))px 이 자리 폭 \(Int(tileSize * 2))px 안"
            )
        }
    }

    // 폭 단위: ASCII 는 한 자에 1, 그 밖은 2.
    t.expectEqual(officeLabelWidthUnits("abc-12"), 6, "ASCII 는 글자 수 그대로")
    t.expectEqual(officeLabelWidthUnits("가나"), 4, "한글은 두 배")
    t.expectEqual(officeLabelWidthUnits("…"), 2, "말줄임표도 자리를 먹는다")
    // 구분자가 없는 한글 이름도 예산 안에 들어온다(뒤에서부터 폭만큼 담는 폴백).
    let koreanLabel = officeSessionShortName("가나다라마바사", limit: 6)
    t.expect(
        officeLabelWidthUnits(koreanLabel) <= 6,
        "한글 이름표 \(koreanLabel) 폭 \(officeLabelWidthUnits(koreanLabel)) ≤ 6"
    )
    t.expect(koreanLabel.hasPrefix("…"), "한글 이름도 잘렸음을 표시한다")

    // 평균 폭 예산을 넘긴 이름은 그려 본 폭으로 눌러 자리 안에 넣는다.
    //
    // 평균은 상한이 아니다. 같은 아홉 글자라도 `WWWWWWWWW` 는 소문자보다 훨씬 넓어, 글자 수만
    // 맞춘 상한으로는 옆 세션 이름표를 다시 덮는다.
    let seatWidth = 54.8  // 최소 창(타일 27.4)의 자리 폭
    t.expect(
        officeLabelSqueeze(renderedWidth: 40, availableWidth: seatWidth) == 1,
        "자리 안에 들어오면 누르지 않는다"
    )
    let overflow = 89.0  // 대문자 아홉 자 실측 근사
    let squeeze = officeLabelSqueeze(renderedWidth: overflow, availableWidth: seatWidth)
    t.expect(squeeze < 1, "넘치면 눌린다(배율 \(squeeze))")
    t.expect(overflow * squeeze <= seatWidth + 0.0001, "누른 뒤 폭이 자리 안")
    // 폭을 못 잰 경우(0)에 0 배율을 돌려주면 이름표가 화면에서 사라진다 — 눌리는 것보다 나쁘다.
    t.expect(
        officeLabelSqueeze(renderedWidth: 0, availableWidth: seatWidth) == 1,
        "그려진 폭이 0 이면 원래 크기"
    )
    t.expect(
        officeLabelSqueeze(renderedWidth: 40, availableWidth: 0) == 1,
        "자리 폭이 0 이면 원래 크기"
    )
}
