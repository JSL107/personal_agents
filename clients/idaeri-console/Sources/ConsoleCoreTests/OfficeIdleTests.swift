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

// 목적지 검증은 `OfficeFloorPlanTests` 의 `sampleAgents` 를 그대로 쓴다.
//
// 예전에는 같은 27명을 여기서 따로 만들면서 **부서를 안 넘겼다.** 그래서 전원이 기본 부서로
// 떨어져 방이 하나뿐인 평면도가 나왔고, "운영 27명 평면도" 라는 이름과 달리 방이 여섯일 때만
// 드러나는 결함을 전부 통과시켰다 — 문 칸이 배회 목적지가 되는 결함이 그렇게 빠져나갔다.
// 표본을 하나로 합쳐 두 검증이 같은 배치를 본다.

func runOfficeIdleTests(_ t: TestRunner) {
    t.suite("OfficeIdle")

    // 값이 씬으로 새면 순수 테스트로 회귀를 잡을 수 없으므로 튜닝 계약도 Core에서 고정한다.
    t.expectEqual(officeStrollTickSeconds, 8, "감독관 호출 주기")
    t.expectEqual(officeStrollDefaultConcurrency, 2, "기본 동시 배회 인원")
    t.expectEqual(officeStrollMaxConcurrency, 3, "동시 배회 상한")
    t.expectEqual(officeStrollCooldownSeconds, 90, "재배회 쿨다운")

    // 이 검증이 잡는 회귀: 가구 방향과 다른 축/부호로 전체 캐릭터 노드를 밀어 몸과 가구가
    // 멀어지는 버그. 기대값은 10px 타일 × 0.30칸을 손으로 계산한 literal이다.
    let expectedLoungeOffsets: [(Facing, OfficePoint)] = [
        (.left, OfficePoint(x: -3, y: 0)),
        (.right, OfficePoint(x: 3, y: 0)),
        (.up, OfficePoint(x: 0, y: 3)),
        (.down, OfficePoint(x: 0, y: -3)),
    ]
    for (facing, expected) in expectedLoungeOffsets {
        t.expectEqual(
            officeLoungeInteractionOffset(facing: facing, tileSize: 10),
            expected,
            "\(facing.rawValue) lounge 전체 노드 오프셋"
        )
    }

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

    let plan = officeFloorPlan(agents: sampleAgents)
    let spots = officeStrollSpots(plan: plan)
    t.expect(!spots.isEmpty, "운영 29명 평면도에 배회 목적지가 있다")

    // 머무름과 자세를 따로 관리하면 새 가구를 한쪽 switch 에만 넣어도 컴파일은 통과한다.
    // 기본 자세로 조용히 넘어가는 대신 전 종류를 훑어 누락된 쪽을 바로 드러낸다.
    for kind in FurnitureKind.allCases {
        t.expectEqual(
            kind.strollDwellSeconds != nil,
            kind.interactionPose != nil,
            "\(kind.rawValue) 머무름과 상호작용 자세가 함께 존재"
        )
    }
    let expectedFurniturePoses: [FurnitureKind: OfficeInteractionPose] = [
        .sofa2: .sitting,
        .sofa3: .sitting,
        .coffeeTable: .sitting,
        .meetingTable: .sitting,
        .coffeeMachine: .drinking,
        .waterCooler: .drinking,
        .vendingMachine: .drinking,
        .refrigerator: .drinking,
        .sinkCounter: .drinking,
        .printer: .carryingPapers,
        .filingCabinet: .carryingPapers,
        .whiteboard: .writing,
        .wallWhiteboard: .writing,
        .bookshelf: .reading,
        .wallShelf: .reading,
        .wallMonitor: .reading,
        .wallPinboard: .reading,
        .plantTall: .tending,
        .plantSmall: .tending,
        .lockers2: .stowing,
    ]
    for (kind, pose) in expectedFurniturePoses {
        t.expectEqual(kind.interactionPose, pose, "\(kind.rawValue) 자세 매핑")
    }
    t.expectEqual(expectedFurniturePoses.count, 20, "상호작용 가구 20종을 빠짐없이 고정")

    let expectedFacings: [(from: TilePoint, to: TilePoint, facing: Facing)] = [
        (TilePoint(x: 4, y: 4), TilePoint(x: 4, y: 5), .up),
        (TilePoint(x: 4, y: 4), TilePoint(x: 4, y: 3), .down),
        (TilePoint(x: 4, y: 4), TilePoint(x: 3, y: 4), .left),
        (TilePoint(x: 4, y: 4), TilePoint(x: 5, y: 4), .right),
        (TilePoint(x: 4, y: 4), TilePoint(x: 7, y: 5), .right),
        (TilePoint(x: 4, y: 4), TilePoint(x: 5, y: 7), .up),
    ]
    for sample in expectedFacings {
        t.expectEqual(
            officeFacing(from: sample.from, to: sample.to),
            sample.facing,
            "가구 방향 \(sample.from) → \(sample.to)"
        )
    }

    // 같은 kind 가 여러 방에 놓이므로 kind 하나만 대조하면 다른 배치의 방향 오류를 놓친다.
    // 실제 목적지 칸과 이웃한 배치 중 하나가 같은 방향을 가리키는지 각 spot 별로 확인한다.
    for spot in spots {
        let matchingPlacement = plan.furniture.first { placement in
            guard placement.kind == spot.kind else {
                return false
            }
            let distance = abs(placement.tile.x - spot.tile.x) + abs(placement.tile.y - spot.tile.y)
            return distance == 1
        }
        t.expect(matchingPlacement != nil, "\(spot.kind.rawValue) 목적지에 인접 가구 존재")
        if let matchingPlacement {
            t.expectEqual(
                spot.facing,
                officeFacing(from: spot.tile, to: matchingPlacement.tile),
                "\(spot.kind.rawValue) 목적지가 가구를 바라봄"
            )
            t.expectEqual(
                spot.pose,
                matchingPlacement.kind.interactionPose,
                "\(spot.kind.rawValue) 목적지가 가구 자세를 보존"
            )
        }
    }

    // 후보 규칙은 **평면도를 거치지 않고 직접** 고정한다. 지금 배치는 앉는 가구의 정면이
    // 모두 열려 있어, 네 방향 탐색으로 되돌려도 목적지 결과가 같다 — 아래 평면도 단언들만
    // 두면 규칙이 통째로 사라져도 전부 통과한다(실측 확인).
    let sittingNeighbors = officeInteractionNeighbors(
        furniture: TilePoint(x: 5, y: 5), pose: .sitting
    )
    t.expectEqual(sittingNeighbors, [TilePoint(x: 5, y: 4)], "앉는 자리 후보는 정면 한 칸뿐")
    for pose in OfficeInteractionPose.allCases where pose != .sitting {
        t.expectEqual(
            officeInteractionNeighbors(furniture: TilePoint(x: 5, y: 5), pose: pose),
            [
                TilePoint(x: 5, y: 4), TilePoint(x: 4, y: 5),
                TilePoint(x: 6, y: 5), TilePoint(x: 5, y: 6),
            ],
            "\(pose.rawValue) 는 네 방향 후보를 유지"
        )
    }

    // 앉는 자리는 **가구 정면뿐**이다. 소파 그림이 정면도라, 옆 칸에서 앉히면 소파에 앉은
    // 사람이 아니라 소파 옆에 나란히 앉은 사람이 된다(경영방 소파가 그랬다).
    for spot in spots where spot.pose == .sitting {
        t.expectEqual(
            spot.facing, .up, "\(spot.kind.rawValue) 앉는 자리 \(spot.tile) 는 가구 정면"
        )
    }

    // 정면만 허용하는 규칙은 **가구를 목적지에서 조용히 탈락시킬 수 있다** — 정면 칸을 다른
    // 가구가 물면 그 소파는 아무도 앉지 않는 장식이 된다. 배치를 바꿀 때 그 손실이 눈에
    // 띄도록 소파는 전부 앉을 자리를 갖는지 여기서 고정한다.
    let sofaKinds: Set<FurnitureKind> = [.sofa2, .sofa3]
    let placedSofas = plan.furniture.filter { sofaKinds.contains($0.kind) }.count
    let seatedSofas = spots.filter { sofaKinds.contains($0.kind) }.count
    t.expectEqual(seatedSofas, placedSofas, "놓인 소파 \(placedSofas)개 모두 앉을 자리 보유")

    let spotsByTile = Dictionary(uniqueKeysWithValues: spots.map { ($0.tile, $0) })
    for loungeTile in plan.loungeTiles {
        t.expect(
            spotsByTile[loungeTile]?.pose != nil,
            "휴식 자리 \(loungeTile)는 상호작용 자세가 있는 목적지"
        )
    }

    let expectedHandProps: [OfficeInteractionPose: String?] = [
        .sitting: nil,
        .drinking: "prop-mug",
        .carryingPapers: "prop-papers",
        .writing: "prop-papers",
        .reading: "prop-book-stack",
        .tending: nil,
        .stowing: "prop-book-stack",
    ]
    for pose in OfficeInteractionPose.allCases {
        t.expectEqual(
            pose.handPropSprite,
            expectedHandProps[pose] ?? nil,
            "\(pose.rawValue) 손 소품 매핑"
        )
        if let sprite = pose.handPropSprite {
            t.expect(officeDeskPropSprites.contains(sprite), "\(sprite)는 기존 번들 소품 이름")
        }
    }

    t.expect(spots.allSatisfy { plan.walkable.contains($0.tile) }, "모든 목적지는 통행 가능")
    let seatTiles = Set(plan.desks.map(\.seat))
    t.expect(spots.allSatisfy { !seatTiles.contains($0.tile) }, "좌석 칸은 목적지에서 제외")

    let excludedKinds: Set<FurnitureKind> = [.desk, .chairDown, .chairUp, .clock, .trash]
    t.expect(
        spots.allSatisfy { !excludedKinds.contains($0.kind) },
        "책상·의자·시계·쓰레기통은 목적지에서 제외"
    )
    t.expectEqual(Set(spots.map(\.tile)).count, spots.count, "목적지 칸 중복 없음")

    // 문 칸은 목적지가 될 수 없다. 방의 유일한 출입구라, 누가 몇 초 서 있으면 그동안 드나드는
    // 사람이 전부 그 사람을 통과해 지나가는 그림이 된다.
    //
    // **문 자신의 `strollDwellSeconds` 를 nil 로 둔 것만으로는 못 막는다.** 목적지는 가구 앞
    // **이웃 칸**이라, 문 바로 위 벽에 걸린 물건(리뷰방·성장방 화이트보드)이 자기 목적지로
    // 아래 문 칸을 고른다 — 첫 이웃 후보가 (x, y-1) 이고 문 칸은 통행 가능하기 때문이다.
    let doorTiles = Set(plan.furniture.filter { $0.kind.isDoorway }.map(\.tile))
    let onDoor = spots.filter { doorTiles.contains($0.tile) }
    t.expectEqual(
        onDoor.count, 0,
        "문 칸에 놓인 목적지: \(onDoor.map { "\($0.kind.rawValue)@(\($0.tile.x),\($0.tile.y))" }.sorted())"
    )

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

    let daylightCases: [(hour: Int, expected: OfficeDaylight)] = [
        (4, .night), (5, .dawn), (7, .dawn), (8, .morning), (10, .morning),
        (11, .day), (16, .day), (17, .evening), (19, .evening), (20, .night), (0, .night),
    ]
    for sample in daylightCases {
        t.expectEqual(
            officeDaylight(hour: sample.hour),
            sample.expected,
            "\(sample.hour)시 시간대 경계"
        )
    }
    t.expectEqual(officeDaylight(hour: 24), officeDaylight(hour: 0), "24시는 0시로 정규화")
    t.expectEqual(officeDaylight(hour: -1), officeDaylight(hour: 23), "-1시는 23시로 정규화")

    // 바닥 빛 세기가 낮 > 아침 > 저녁 > 새벽 > 밤 순으로 단조로워야 시간이 읽힌다.
    // 순서가 뒤집히면 화면만 보고 아침인지 밤인지 가릴 근거가 사라진다.
    let strengthOrder = [11, 8, 17, 5, 22].map { officeWindowLight(hour: $0).glowStrength }
    for index in 1..<strengthOrder.count {
        t.expect(
            strengthOrder[index] < strengthOrder[index - 1],
            "빛 세기 \(index)번째 구간이 앞 구간보다 약함"
        )
    }

    // 벽등은 해가 낮은 시간에만 켠다 — 낮에 켜면 광원이 둘이 되어 어느 쪽이 빛인지 안 읽힌다.
    for hour in [5, 17, 22] {
        t.expect(officeWindowLight(hour: hour).lampLit, "\(hour)시 벽등 켜짐")
    }
    for hour in [8, 13] {
        t.expect(!officeWindowLight(hour: hour).lampLit, "\(hour)시 벽등 꺼짐")
    }

    // 새벽과 저녁은 아래쪽 하늘이 둘 다 붉다. 위쪽 색까지 같으면 유리만 보고는 구별할 수 없다.
    t.expect(
        officeWindowLight(hour: 5).skyHigh != officeWindowLight(hour: 18).skyHigh,
        "새벽과 저녁의 하늘 위쪽 색이 다름"
    )
    // 유리는 위아래가 갈려야 노을이 노을로 보인다 — 한 색으로 채우면 그냥 색유리다.
    for hour in [5, 13, 18, 22] {
        let light = officeWindowLight(hour: hour)
        t.expect(light.skyHigh != light.skyLow, "\(hour)시 유리 위아래 색이 다름")
    }

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
