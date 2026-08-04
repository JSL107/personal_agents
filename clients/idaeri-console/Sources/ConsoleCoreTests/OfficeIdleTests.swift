import Foundation

@testable import ConsoleCore

private func idleCandidate(
    _ agentType: String = "PM",
    state: ConsoleAgentState = .waiting,
    isQueued: Bool = false,
    isWalking: Bool = false,
    hasPendingWork: Bool = false,
    lastStrollAt: Double? = nil
) -> OfficeIdleCandidate {
    OfficeIdleCandidate(
        agentType: agentType,
        state: state,
        isQueued: isQueued,
        isWalking: isWalking,
        hasPendingWork: hasPendingWork,
        lastStrollAt: lastStrollAt
    )
}

private func idlePlanAgent(_ agentType: String) -> ConsoleAgent {
    ConsoleAgent(
        agentType: agentType,
        displayName: agentType,
        slashCommands: [],
        description: "",
        state: .waiting,
        bubble: ""
    )
}

// 운영 표본의 부서별 정원 경계를 그대로 밟아야 목적지 검증이 실제 배치와 어긋나지 않는다.
private let idleSampleAgents: [ConsoleAgent] = [
    "PM", "PO_SHADOW", "PO_EVAL",
    "BE", "BE_SCHEMA", "BE_TEST", "BE_SRE", "BE_FIX",
    "CODE_REVIEWER", "WORK_REVIEWER", "IMPACT_REPORTER",
    "CTO", "CEO",
    "CAREER_MATE", "JOB_APPLICATION", "BLOG", "VACATION",
    "ISSUE_LABELER", "SUBCONSCIOUS_GATE", "CONTRADICTION_JUDGE",
    "REVIEW_REPLY_JUDGE", "HUMANIZER", "DOCS_AUDIT_OPTIMIZER",
    "DOCS_AUDIT_EVALUATOR", "PREFERENCE_LEARNING", "EVENING_RETRO",
    "OPS_SUPERVISOR",
].map(idlePlanAgent)

func runOfficeIdleTests(_ t: TestRunner) {
    t.suite("OfficeIdle")

    // 값이 씬으로 새면 순수 테스트로 회귀를 잡을 수 없으므로 튜닝 계약도 Core에서 고정한다.
    t.expectEqual(officeStrollTickSeconds, 8, "감독관 호출 주기")
    t.expectEqual(officeStrollDefaultConcurrency, 2, "기본 동시 배회 인원")
    t.expectEqual(officeStrollMaxConcurrency, 3, "동시 배회 상한")
    t.expectEqual(officeStrollCooldownSeconds, 90, "재배회 쿨다운")

    let now = 1_000.0
    let cooldown = 90.0
    t.expect(
        officeIsIdle(idleCandidate(), now: now, cooldown: cooldown),
        "다섯 조건을 충족한 waiting 직원은 한가함"
    )

    let busyStates: [ConsoleAgentState] = [
        .inProgress, .awaitingApproval, .failed, .completed, .awaitingIntegration,
    ]
    for state in busyStates {
        t.expect(
            !officeIsIdle(idleCandidate(state: state), now: now, cooldown: cooldown),
            "\(state.rawValue) 상태는 배회 제외"
        )
    }
    t.expect(
        !officeIsIdle(idleCandidate(isQueued: true), now: now, cooldown: cooldown),
        "승인 줄 직원은 배회 제외"
    )
    t.expect(
        !officeIsIdle(idleCandidate(isWalking: true), now: now, cooldown: cooldown),
        "걷는 직원은 배회 제외"
    )
    t.expect(
        !officeIsIdle(idleCandidate(hasPendingWork: true), now: now, cooldown: cooldown),
        "접수·진행 중 지시가 있는 직원은 배회 제외"
    )
    t.expect(
        !officeIsIdle(
            idleCandidate(lastStrollAt: now - cooldown + 0.01),
            now: now,
            cooldown: cooldown
        ),
        "쿨다운 미경과는 배회 제외"
    )
    t.expect(
        officeIsIdle(
            idleCandidate(lastStrollAt: now - cooldown),
            now: now,
            cooldown: cooldown
        ),
        "쿨다운 정확한 경계는 배회 허용"
    )

    let selectionCandidates = ["C", "B", "A", "D"].map { idleCandidate($0) }
    t.expectEqual(
        officeStrollPicks(candidates: selectionCandidates, activeStrollCount: 0, now: now),
        ["A", "B"],
        "기본 상한은 두 명"
    )
    t.expectEqual(
        officeStrollPicks(candidates: selectionCandidates, activeStrollCount: 1, now: now),
        ["A"],
        "한 명 배회 중이면 한 자리"
    )
    t.expect(
        officeStrollPicks(
            candidates: selectionCandidates,
            activeStrollCount: 2,
            now: now
        ).isEmpty,
        "기본 상한을 채우면 추가 선발 없음"
    )
    t.expectEqual(
        officeStrollPicks(
            candidates: selectionCandidates,
            activeStrollCount: 0,
            now: now,
            maxConcurrent: 9
        ).count,
        3,
        "요청 상한 9는 3으로 clamp"
    )
    t.expectEqual(
        officeStrollPicks(
            candidates: selectionCandidates,
            activeStrollCount: 0,
            now: now,
            maxConcurrent: 0
        ).count,
        1,
        "요청 상한 0은 1로 clamp"
    )

    let priorityCandidates = [
        idleCandidate("B"),
        idleCandidate("C", lastStrollAt: 10),
        idleCandidate("A"),
    ]
    t.expectEqual(
        officeStrollPicks(
            candidates: priorityCandidates,
            activeStrollCount: 0,
            now: now,
            cooldown: 0,
            maxConcurrent: 3
        ),
        ["A", "B", "C"],
        "미배회 우선, 동률은 agentType 사전순"
    )
    let firstPicks = officeStrollPicks(
        candidates: priorityCandidates,
        activeStrollCount: 0,
        now: now,
        cooldown: 0,
        maxConcurrent: 3
    )
    let secondPicks = officeStrollPicks(
        candidates: priorityCandidates,
        activeStrollCount: 0,
        now: now,
        cooldown: 0,
        maxConcurrent: 3
    )
    t.expectEqual(firstPicks, secondPicks, "동일 선발 입력은 동일 결과")

    let plan = officeFloorPlan(agents: idleSampleAgents)
    let spots = officeStrollSpots(plan: plan)
    t.expect(!spots.isEmpty, "운영 27명 평면도에 배회 목적지가 있다")
    t.expect(spots.allSatisfy { plan.walkable.contains($0.tile) }, "모든 목적지는 통행 가능")
    let seatTiles = Set(plan.desks.map(\.seat))
    t.expect(spots.allSatisfy { !seatTiles.contains($0.tile) }, "좌석 칸은 목적지에서 제외")

    let excludedKinds: Set<FurnitureKind> = [.desk, .chairDown, .chairUp, .clock, .trash]
    t.expect(
        spots.allSatisfy { !excludedKinds.contains($0.kind) },
        "책상·의자·시계·쓰레기통은 목적지에서 제외"
    )
    t.expectEqual(Set(spots.map(\.tile)).count, spots.count, "목적지 칸 중복 없음")

    let firstSpot = officeStrollSpot(
        for: "PM", round: 7, spots: spots, occupied: []
    )
    let secondSpot = officeStrollSpot(
        for: "PM", round: 7, spots: spots, occupied: []
    )
    t.expectEqual(firstSpot, secondSpot, "동일 사람·회차는 동일 목적지")
    t.expectNil(
        officeStrollSpot(
            for: "PM",
            round: 7,
            spots: spots,
            occupied: Set(spots.map(\.tile))
        ),
        "모든 목적지가 점유되면 배정하지 않음"
    )
    if spots.count >= 2 {
        t.expect(
            officeStrollSpot(for: "PM", round: 0, spots: spots, occupied: [])
                != officeStrollSpot(for: "PM", round: 1, spots: spots, occupied: []),
            "회차가 바뀌면 목적지가 달라짐"
        )
    } else {
        t.fail("round 변화 검증에는 목적지가 두 곳 이상 필요")
    }

    let ambienceCases: [(hour: Int, expected: OfficeAmbience)] = [
        (5, .night), (6, .morning), (8, .morning), (9, .day), (17, .day),
        (18, .evening), (21, .evening), (22, .night), (0, .night),
    ]
    for sample in ambienceCases {
        t.expectEqual(
            officeAmbience(hour: sample.hour),
            sample.expected,
            "\(sample.hour)시 분위기 경계"
        )
    }
    t.expectEqual(officeAmbience(hour: 24), officeAmbience(hour: 0), "24시는 0시로 정규화")
    t.expectEqual(officeAmbience(hour: -1), officeAmbience(hour: 23), "-1시는 23시로 정규화")

    for hour in [6, 9, 18, 22] {
        let emptyTint = officeAmbienceTint(hour: hour, activeCount: 0)
        let activeTint = officeAmbienceTint(hour: hour, activeCount: 1)
        t.expect(emptyTint.alpha > activeTint.alpha, "\(hour)시 활동 0이면 더 어두움")
    }
    t.expectEqual(officeAmbienceTint(hour: 9, activeCount: 1).alpha, 0, "낮 활동 중은 막 없음")
    t.expectEqual(officeAmbienceTint(hour: 9, activeCount: 0).alpha, 0.08, "낮 활동 0은 0.08")

    let visualCases: [(intent: VisualIntent, expected: [String])] = [
        (.recolor(agentType: "A", state: .waiting), ["A"]),
        (.working(agentType: "B"), ["B"]),
        (.handoff(from: "C", to: "D"), ["C", "D"]),
        (.summonToBand(agentType: "E"), ["E"]),
        (.returnHome(agentType: "F"), ["F"]),
        (.reject(agentType: "G"), ["G"]),
        (.bubble(agentType: "H", text: "완료"), ["H"]),
    ]
    for sample in visualCases {
        t.expectEqual(
            affectedAgentTypes(of: sample.intent),
            sample.expected,
            "연출 영향 대상"
        )
    }
}
