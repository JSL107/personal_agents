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

    // approvalFor: 해당 agentType 의 승인 건
    let approvals = [
        ConsoleApproval(id: "a1", agentType: "CTO", title: "PR1", createdAt: "t1"),
        ConsoleApproval(id: "a2", agentType: "PM", title: "PR2", createdAt: "t2"),
    ]
    t.expectEqual(approvalFor(agentType: "PM", in: approvals)?.id, "a2", "PM 승인 건 매칭")
    t.expectNil(approvalFor(agentType: "BE", in: approvals), "승인 없는 에이전트 → nil")

    // 이름표 세기 — 기본은 옅게, 손이 필요한 상태와 지금 보고 있는 대상만 진하게.
    // 27명 전원이 늘 진한 딱지를 달면 상태 링이 라벨에 덮인다.
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
    // 전원이 같은 위상이면(=이 단언이 깨지면) 27명이 한 몸처럼 오르내린다.
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

    func makeSession(_ id: String, _ state: String) -> ConsoleSession {
        ConsoleSession(
            sessionId: id, pid: 1, source: "claude", name: id, cwd: "/tmp",
            state: state, startedAt: "t", lastActivityAt: nil
        )
    }

    let sessionPlan = officeFloorPlan(
        agents: [
            makeInteractionAgent("PM", .waiting), makeInteractionAgent("CTO", .waiting),
        ]
    )
    let sessionTiles = officeSessionTiles(plan: sessionPlan)
    t.expect(!sessionTiles.isEmpty, "세션 자리 존재")
    // 승인 대기 줄과 다른 줄을 써야 한다 — 같은 줄이면 세션이 늘어난 순간 줄 선 사람과
    // 겹쳐 승인이 몇 건인지 세지 못한다.
    let queued = Set(sessionPlan.queueTiles)
    for tile in sessionTiles {
        t.expect(sessionPlan.walkable.contains(tile), "세션 자리 통행 가능")
        t.expect(!queued.contains(tile), "세션 자리가 승인 대기 줄과 겹치지 않음")
    }

    // 돌고 있는 세션이 먼저 선다. 자리가 모자랄 때 쉬는 세션이 앞자리를 차지하면,
    // 정작 지금 무엇이 도는지 화면에서 사라진다.
    let mixedSessions = [
        makeSession("z-idle", "idle"), makeSession("a-idle", "idle"),
        makeSession("m-active", officeSessionActiveState),
    ]
    t.expectEqual(
        officeVisibleSessions(mixedSessions, limit: 2).map(\.sessionId),
        ["m-active", "a-idle"],
        "도는 세션 먼저, 그다음 id 순"
    )
    t.expectEqual(
        officeVisibleSessions(mixedSessions, limit: 0).count, 0, "자리가 없으면 아무도 안 세운다"
    )
    t.expectEqual(
        officeVisibleSessions(mixedSessions, limit: 99).count, 3, "자리가 남으면 전부 세운다"
    )
    t.expectEqual(
        officeVisibleSessions(mixedSessions, limit: 2).map(\.sessionId),
        officeVisibleSessions(mixedSessions.reversed(), limit: 2).map(\.sessionId),
        "입력 순서가 달라도 같은 결과"
    )

    // === 세션 구분 ===
    // 여럿이 서면 서로 다른 사람으로 보여야 한다. 예전에는 스프라이트 한 장에 같은 색이라
    // 여덟이 늘어서면 한 사람을 복제해 붙인 것처럼 보였다.
    let sessionIds = ["s-alpha", "s-beta", "s-gamma", "s-delta", "s-epsilon"]
    let looks = sessionIds.map { characterLook(for: $0) }
    t.expect(
        Set(looks.map { "\($0.sheetIndex)-\($0.hairIndex)-\($0.pantsIndex)" }).count > 1,
        "세션마다 외형이 갈린다"
    )
    t.expectEqual(
        characterLook(for: "s-alpha").sheetIndex,
        characterLook(for: "s-alpha").sheetIndex,
        "같은 세션은 늘 같은 모습"
    )
    // 셔츠는 청록 계열에 묶여 있어야 한다 — 색상까지 흩으면 부서 사람과 구별되지 않는다.
    for look in looks {
        let shirt = officeSessionShirtRGB(shift: look.shirtShift)
        t.expect(shirt.green > shirt.red && shirt.blue > shirt.red, "세션 셔츠는 청록 계열")
    }

    // 이름표는 옆 세션과 겹치지 않게 자른다. 자르되 뒤쪽(구분되는 정보)을 남긴다 —
    // 워크트리 이름은 앞이 대개 같은 저장소 이름이라 앞을 남기면 전부 같은 글자가 된다.
    t.expectEqual(officeSessionShortName("idaeri"), "idaeri", "상한 안이면 그대로")
    let fullName = "personal_agents-office-window-light"
    let shortened = officeSessionShortName(fullName)
    t.expectEqual(shortened.count, 12, "긴 이름은 상한까지 자른다")
    t.expect(shortened.hasPrefix("…"), "잘렸음을 표시한다")
    t.expect(fullName.hasSuffix(shortened.dropFirst()), "남긴 부분은 원래 이름의 꼬리")
    // 같은 저장소의 다른 워크트리 둘이 서로 다른 이름표를 받아야 한다 — 앞을 남겼다면
    // 둘 다 "personal_ag…" 가 되어 이름표가 있어도 구분이 안 된다.
    t.expect(
        officeSessionShortName("personal_agents-window-light")
            != officeSessionShortName("personal_agents-selection-ring"),
        "같은 저장소의 다른 워크트리가 서로 다른 이름표"
    )
}
