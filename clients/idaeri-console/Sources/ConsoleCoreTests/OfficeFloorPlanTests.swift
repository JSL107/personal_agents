import Foundation

@testable import ConsoleCore

private func planAgent(_ type: String, _ department: Department) -> ConsoleAgent {
    ConsoleAgent(
        agentType: type, displayName: type, slashCommands: [],
        description: "", state: .waiting, bubble: "",
        department: department.rawValue
    )
}

private func planAgents(_ department: Department, _ types: [String]) -> [ConsoleAgent] {
    types.map { planAgent($0, department) }
}

// 운영 스냅샷(GET /v1/console/snapshot)의 실제 29종을 그대로 옮긴 표본.
//
// **부서는 백엔드 사규(`agent-registry/agent-contract.ts` 의 `AGENT_CONTRACTS`)가 정본이다.**
// 예전에는 agentType 만 적고 앱의 하드코딩 매핑이 부서를 유도했는데, 그 매핑이 사규와 어긋나
// `REVIEW_REPLY_JUDGE` 가 리뷰가 아니라 내부방에 앉아 있었다. 이제 표본이 사규 값을 그대로
// 들고 있으므로, 사규에서 부서를 옮기면 여기도 함께 갱신해야 한다.
//
// 인원을 임의로 줄이면 안 된다 — 26명짜리 표본을 쓰던 동안 "내부 부서 마지막 한 명이 자리를
// 못 받아 화면에서 사라지는" 결함이 통과했다. 구역 정원은 12석이고 지금 가장 큰 부서가 9명이다.
// agentType 은 displayName 과 다르다: EVENING_RETRO(타입) ↔ "Evening Retro Publish"(표시명).
//
// **배회 목적지 테스트(`OfficeIdleTests`)도 이 표본을 쓴다.** 거기서 따로 만들던 표본은
// 부서를 안 넘겨 27명이 전부 한 방에 몰렸고, 그래서 "방이 여섯일 때만 드러나는" 결함을
// 통째로 놓쳤다(문 칸이 배회 목적지가 되는 결함이 실제로 그렇게 빠져나갔다).
let sampleAgents: [ConsoleAgent] =
    planAgents(.planning, ["PM", "PO_SHADOW", "PO_EVAL"])
    + planAgents(.engineering, ["BE", "BE_SCHEMA", "BE_TEST", "BE_SRE", "BE_FIX"])
    + planAgents(
        .review, ["CODE_REVIEWER", "WORK_REVIEWER", "IMPACT_REPORTER", "REVIEW_REPLY_JUDGE"]
    )
    + planAgents(.executive, ["CTO", "CEO"])
    + planAgents(
        .growth,
        ["CAREER_MATE", "JOB_APPLICATION", "BLOG", "VACATION", "INVEST", "CTO_STUDY"]
    )
    + planAgents(
        .internalOps,
        [
            "ISSUE_LABELER", "SUBCONSCIOUS_GATE", "CONTRADICTION_JUDGE", "HUMANIZER",
            "DOCS_AUDIT_OPTIMIZER", "DOCS_AUDIT_EVALUATOR", "PREFERENCE_LEARNING",
            "EVENING_RETRO", "OPS_SUPERVISOR",
        ]
    )

/// 자리 배정에는 agentType 만 담기므로, 표본에서 부서를 되찾는다(표본 = 사규 값).
private let sampleDepartments: [String: Department] = Dictionary(
    uniqueKeysWithValues: sampleAgents.map { ($0.agentType, $0.resolvedDepartment) }
)

func runOfficeFloorPlanTests(_ t: TestRunner) {
    t.suite("OfficeFloorPlan")


    let plan = officeFloorPlan(agents: sampleAgents)

    // 모든 에이전트가 자기 책상을 가진다 — 한 명이라도 자리가 없으면 화면에서 사라진다.
    t.expectEqual(plan.desks.count, sampleAgents.count, "29명 전원 자리 배정")

    // 인원이 가장 많은 부서도 정원 안에 들어가야 한다. 부서별 인원은 언제든 늘 수 있으므로,
    // "가장 큰 부서 전원이 자리를 받았는가" 를 부서 단위로 못 박는다.
    for zoneDepartment in Department.allCases {
        let members = sampleAgents.filter { $0.resolvedDepartment == zoneDepartment }
        guard !members.isEmpty else {
            continue
        }
        let seated = plan.desks.filter { sampleDepartments[$0.agentType] == zoneDepartment }
        t.expectEqual(
            seated.count, members.count,
            "\(zoneDepartment.label) 부서 \(members.count)명 전원 배정(정원 초과 시 실패)"
        )
    }

    // 책상은 서로 겹치지 않는다.
    let deskTiles = Set(plan.desks.map(\.desk))
    t.expectEqual(deskTiles.count, plan.desks.count, "책상 좌표 중복 없음")

    // 좌석도 겹치지 않는다(두 사람이 한 칸에 앉으면 스프라이트가 포개진다).
    let seatTiles = Set(plan.desks.map(\.seat))
    t.expectEqual(seatTiles.count, plan.desks.count, "좌석 좌표 중복 없음")

    // 좌석은 책상 바로 위 — 탑다운에서 책상이 사람 앞을 가리는 배치.
    let seatAboveDesk = plan.desks.allSatisfy {
        $0.seat.x == $0.desk.x && $0.seat.y == $0.desk.y + 1
    }
    t.expect(seatAboveDesk, "좌석은 책상 바로 위 칸")

    // 모든 자리가 격자 안에 있다.
    let insideGrid = plan.desks.allSatisfy {
        $0.desk.x >= 0 && $0.desk.x < plan.columns
            && $0.seat.y >= 0 && $0.seat.y < plan.rows
    }
    t.expect(insideGrid, "모든 자리가 격자 범위 안")

    // 좌석은 걸어서 도달할 수 있어야 한다 — 못 가면 캐릭터가 자기 자리에 앉지 못한다.
    let seatsWalkable = plan.desks.allSatisfy { plan.walkable.contains($0.seat) }
    t.expect(seatsWalkable, "모든 좌석이 통행 가능")

    // 책상 자체는 막혀 있어야 한다(사람이 책상 위로 걸어다니면 안 된다).
    let desksBlocked = plan.desks.allSatisfy { !plan.walkable.contains($0.desk) }
    t.expect(desksBlocked, "책상 칸은 통행 불가")

    // 부서 구역은 등장 부서 수만큼.
    t.expectEqual(plan.zones.count, 6, "부서 구역 6개")

    // 책상·좌석은 **자기 부서 바닥재 위**에 있어야 한다. "통행 가능한가" 만 보면 통로나 옆
    // 부서 바닥에 놓인 자리를 놓친다 — 실제로 맨 윗줄 좌석이 카펫 밖 나무 바닥에 놓여
    // 사람이 사무실 밖에 걸터앉은 것처럼 보이던 결함이 6주간 통과했다.
    // 부서마다 바닥재가 달라진 뒤로는 "무엇 위에 있는가" 를 부서 바닥재와 직접 대조한다.
    let offZoneFloor = plan.desks.filter { assignment in
        let expected = departmentFloor(sampleDepartments[assignment.agentType] ?? .internalOps)
        return plan.floor[assignment.desk.y][assignment.desk.x] != expected
            || plan.floor[assignment.seat.y][assignment.seat.x] != expected
    }
    t.expectEqual(
        offZoneFloor.count, 0,
        "자기 부서 바닥재 밖 자리: "
            + "\(offZoneFloor.map { "\($0.agentType)@\($0.seat.x),\($0.seat.y)" }.sorted())"
    )

    // 세로 칸막이는 어느 행에서도 1칸이어야 한다. 예전에는 구역마다 좌우 여백을 따로 세워
    // 경계가 2칸(80px) 두께 회색 띠가 됐다 — 그때는 벽 한 칸을 두 방이 **공유**해 해결했고,
    // 지금은 두 벽 사이를 복도로 벌려 해결한다. 벽 사이에 복도가 끼므로 여전히 연속 2칸이 아니다.
    // (구역 천장은 가로로 이어지는 벽이라 이 검사에서 뺀다.)
    let zoneAreaRows = plan.zones.map { $0.origin.y + $0.height }.max() ?? 0
    let zoneHeight = plan.zones.first?.height ?? 0
    // 위·아래 구역 각각의 천장 줄. 위 구역 천장도 벽이 된 뒤로 둘 다 빼야 한다 —
    // 한쪽만 빼면 그 줄의 가로 벽이 "겹친 벽" 으로 잡혀 통째로 거짓 실패한다.
    // 격자 맨 아래 벽 줄도 가로로 이어지는 벽이라 같이 뺀다.
    let ceilingRows = Set(plan.zones.map { $0.origin.y + $0.height - 1 })
        .union(0..<officeFloorWallRows)
    var thickWallRuns: [String] = []
    for y in 0..<zoneAreaRows where !ceilingRows.contains(y) {
        var run = 0
        for x in 0..<plan.columns {
            run = plan.floor[y][x] == .wall ? run + 1 : 0
            if run > 1 {
                thickWallRuns.append("(\(x),\(y))")
            }
        }
    }
    t.expectEqual(thickWallRuns.count, 0, "가로로 겹친 벽 칸: \(thickWallRuns)")

    // 부서마다 다른 가구 세트가 실제로 놓여 있어야 한다. 인원이 가장 많은 부서(내부 9명)에서도
    // 빠지면 안 된다 — 예전 배치는 아래쪽 줄만 후보로 써서, 정원이 찬 부서는 집기가
    // 통째로 사라졌다(빈 방으로 보이는 원인).
    for zone in plan.zones {
        let inZone = plan.furniture
            .filter { placement in
                guard placement.kind != .desk,
                    placement.tile.y >= zone.origin.y,
                    placement.tile.y < zone.origin.y + zone.height
                else {
                    return false
                }
                // 벽걸이는 방 안이 아니라 **칸막이 벽 열**에 걸린다. 방 안만 훑으면
                // 제자리에 걸린 시계·화이트보드를 "빠졌다" 고 잡는다. 어느 쪽 벽인지는
                // 배치와 같은 함수로 물어본다 — 여기에 x 를 하드코딩하면 규칙이 둘이 된다.
                if placement.kind.isWallMounted {
                    return placement.tile.x == officeWallMountColumn(zoneOriginX: zone.origin.x)
                }
                return placement.tile.x > zone.origin.x
                    && placement.tile.x < zone.origin.x + zone.width - 1
            }
            .map(\.kind)
        for kind in departmentFurniture(zone.department) {
            t.expect(
                inZone.contains(kind),
                "\(zone.department.label) 방에 \(kind.rawValue) 가 놓였다 (실제: \(inZone))"
            )
        }
    }

    // 여섯 부서의 가구 세트가 서로 달라야 방이 구별된다.
    let furnitureSets = Department.allCases.map { candidate in
        departmentFurniture(candidate).map(\.rawValue).joined(separator: "+")
    }
    t.expectEqual(Set(furnitureSets).count, Department.allCases.count, "부서별 가구 세트가 전부 다름")

    // 통로 타일은 **의도한 복도 자리에만** 나와야 한다. 이 검사가 칠하기 누락을 잡는다.
    //
    // 기본값은 예전에 `woodA` 였다. 그것은 리뷰 부서의 바닥재이기도 해서, 칠하기가 빠진 칸이
    // 생기면 "리뷰방 바닥" 으로 위장한 채 아무도 눈치채지 못했다. 기본값을 전용 종류로 바꿔
    // 이 검사가 성립하게 만든 것이 그 변경의 요점이었고, 한동안 "통로 타일 0개" 로 확인했다.
    //
    // 이제는 복도가 실제로 있으므로 0 을 셀 수 없다. 대신 **복도 칸 집합과 정확히 일치**하는지
    // 본다 — 더 강한 검사다. 안 칠한 칸이 생기면 복도 집합 밖에서 통로 타일로 나타나 잡히고,
    // 반대로 복도를 칠하는 것을 빠뜨리면 집합 안에 통로가 아닌 칸이 생겨 잡힌다.
    let expectedCorridor = Set(
        (0..<plan.rows).flatMap { y -> [TilePoint] in
            (0..<plan.columns).compactMap { x -> TilePoint? in
                // 격자 좌우 최외곽·최상단·최하단은 바깥벽이 덮으므로 복도가 아니다.
                guard x > 0, x < plan.columns - 1,
                    y >= officeFloorWallRows, y < plan.rows - officeOuterWallRows
                else {
                    return nil
                }
                let onCorridorColumn = officeCorridorColumns.contains(x)
                let onCorridorRow = y == officeCorridorRow
                return (onCorridorColumn || onCorridorRow) ? TilePoint(x: x, y: y) : nil
            }
        }
    )
    var strayCorridor: [String] = []
    var missingCorridor: [String] = []
    for y in 0..<plan.rows {
        for x in 0..<plan.columns {
            let tile = TilePoint(x: x, y: y)
            let isCorridor = plan.floor[y][x] == .corridor
            if isCorridor, !expectedCorridor.contains(tile) {
                strayCorridor.append("(\(x),\(y))")
            }
            if !isCorridor, expectedCorridor.contains(tile) {
                missingCorridor.append("(\(x),\(y))")
            }
        }
    }
    t.expectEqual(strayCorridor.count, 0, "칠하기가 빠진 칸(통로로 남음): \(strayCorridor)")
    t.expectEqual(missingCorridor.count, 0, "복도인데 통로 타일이 아닌 칸: \(missingCorridor)")
    t.expect(!expectedCorridor.isEmpty, "복도가 실제로 존재")

    for department in Department.allCases {
        t.expect(
            departmentFloor(department) != .corridor,
            "\(department.label) 부서 바닥재가 통로와 같다 — 방 경계가 사라진다"
        )
        t.expect(
            departmentFloor(department).isRoomFloor,
            "\(department.label) 부서 바닥재는 방 바닥으로 쓸 수 있는 종류다"
        )
    }
    t.expect(!FloorTile.corridor.isRoomFloor, "통로는 방 바닥이 아니다")
    t.expect(!FloorTile.wall.isRoomFloor, "벽은 방 바닥이 아니다")
    // 통로 밝기는 **타일끼리 비교해서 판정할 수 없다.** 원본 텍스처 밝기가 종류마다 달라
    // (우드 계열이 카펫보다 훨씬 어둡다) 누르는 양의 순서가 결과 밝기의 순서와 다르기 때문이다
    // — 어두운 카펫은 이 값이 통로보다 작은데 화면 밝기는 66 대 160 이다.
    //
    // 예전에는 "통로가 모든 방 바닥재보다 크다" 를 요구했다. 그 단언을 만족시키다 값이 0.78 까지
    // 올라가 복도가 벽보다도 어두워졌고(렌더 실측 26.9 vs 벽 87.0), 그래도 테스트는 초록이었다.
    // 화면을 검증하지 못하는 단언이 잘못된 값을 지켜 주고 있었던 셈이다.
    //
    // 그래서 여기서는 **값이 임의로 되돌아가는 것만** 막는다. 실제 밝기 판정은 오프스크린
    // 렌더(`swift run IdaeriConsole --render`) 픽셀 실측으로 한다 — 현재 실측 기준은
    // 복도 160 · 가장 밝은 방(세라믹) 115 · 셔츠 186 · 벽 87 이고, 복도는 방과 사람 사이에 있다.
    // 벽과도 비교하지 않는다 — 벽은 이 값 위에 `wallBaseColor` 물들임을 따로 받으므로
    // (실측 벽 87 vs 복도 160) 같은 축의 값이 아니다. 실제로 두 값은 0.43 대 0.40 으로
    // 거의 같은데 화면에서는 두 배 차이가 난다.
    t.expect(
        FloorTile.corridor.muteStrength > 0.35 && FloorTile.corridor.muteStrength < 0.55,
        "통로 밝기가 방(아래)과 사람(위) 사이 대역 (실제 \(FloorTile.corridor.muteStrength))"
    )

    // 맞닿은 구역끼리는 바닥재가 달라야 한다(가로 이웃 = index 차 1, 세로 이웃 = 같은 열 위아래).
    for zone in plan.zones {
        for other in plan.zones where other.department != zone.department {
            let horizontallyAdjacent =
                zone.origin.y == other.origin.y
                && abs(zone.origin.x - other.origin.x) == zone.width - 1
            let verticallyAdjacent =
                zone.origin.x == other.origin.x && zone.origin.y != other.origin.y
            guard horizontallyAdjacent || verticallyAdjacent else {
                continue
            }
            t.expect(
                departmentFloor(zone.department) != departmentFloor(other.department),
                "\(zone.department.label)–\(other.department.label) 이웃 구역 바닥재가 같다"
            )
        }
    }

    // 벽 색조 판정 — 구역 안쪽 벽은 그 부서 색을, 밴드 위 바깥 벽은 색 없음(nil).
    if let firstZone = plan.zones.first {
        t.expectEqual(
            wallDepartment(x: firstZone.origin.x, y: firstZone.origin.y, zones: plan.zones),
            firstZone.department,
            "구역 왼쪽 벽은 그 부서 색"
        )
    }
    t.expectNil(
        wallDepartment(x: 0, y: plan.rows - 1, zones: plan.zones),
        "밴드 위 바깥 벽은 부서 색 없음"
    )

    // 밴드 맨 오른쪽 방(탕비실)의 바닥이 끝 벽 앞까지 칠해져야 한다 — 마지막 구간만 폭이
    // 한 칸 넓은데 그 몫을 빠뜨리면 벽 바로 앞 한 열이 통로색으로 남아 방이 잘려 보인다.
    // 격자 맨 끝 열은 바깥벽이므로 그 **안쪽** 칸을 본다.
    t.expectEqual(
        plan.floor[officeCorridorRow + 1][plan.columns - 2], .ceramic, "탕비실 오른쪽 끝 열도 바닥"
    )
    t.expectEqual(
        plan.floor[officeCorridorRow + 1][plan.columns - 1], .wall, "격자 맨 끝 열은 바깥벽"
    )

    // 부서별 바닥재 매핑이 6개 부서를 전부 덮는다 — 누락되면 조용히 기본 나무 바닥으로 떨어져
    // 그 방만 통로처럼 보인다.
    let floorKinds = Department.allCases.map { departmentFloor($0) }
    t.expectEqual(floorKinds.count, 6, "부서 6개 전부 바닥재 매핑")
    t.expect(!floorKinds.contains(.wall), "부서 바닥재로 벽 타일을 쓰지 않는다")

    // 앉은 캐릭터를 책상 쪽으로 내리는 양. 0 이면 사람이 책상 위 허공에 뜨고, 너무 크면
    // 상반신까지 책상에 잠긴다(책상 상단이 0.8칸, 좌석이 1칸 위라 그 사이가 유효 범위).
    t.expect(
        officeSeatedSpriteDrop > 0.1 && officeSeatedSpriteDrop < 0.5,
        "앉은 자세 오프셋이 유효 범위 (실제 \(officeSeatedSpriteDrop))"
    )
    // 캐릭터는 원본 크기를 쓴다. 탑다운 픽셀아트에서 사람이 타일보다 높은 것은 표준이라
    // (Gather 0.94~1.13칸 · RPG Maker XP 1.5칸 · 스타듀밸리 2.0칸) 1칸까지 줄이면 계보를
    // 벗어난다. 하한 0.85 는 조정 여지로 남긴 값이고, 그 아래는 29명 구별도 어려워진다.
    t.expect(
        officeCharacterScaleFactor >= 0.85 && officeCharacterScaleFactor <= 1.0,
        "캐릭터 배율이 0.85~1.0 (실제 \(officeCharacterScaleFactor))"
    )
    let characterHeight = 54.0 * officeCharacterScaleFactor
    t.expect(
        characterHeight / 40.0 >= 1.1 && characterHeight / 40.0 <= 1.4,
        "서 있는 키가 장르 범위 1.1~1.4칸 (실제 \(characterHeight / 40.0))"
    )

    // 축척 환산 데이터가 빠지지 않았는지 — 새 가구를 넣고 실측값을 안 채우면 배율이
    // 조용히 1.0 으로 떨어져 그 가구만 다시 작아진다.
    for kind in FurnitureKind.allCases {
        t.expect(kind.nativeSize.width > 0, "\(kind.rawValue) 원본 폭 실측값 존재")
        t.expect(kind.nativeHeight > 0, "\(kind.rawValue) 원본 높이 실측값 존재")
    }

    // **보정 후 폭이 허용 상한을 넘지 않는다.** 렌더가 배율을 가로·세로에 같이 곱하므로
    // 높이만 보고 키우면 폭이 옆 칸을 침범한다. 책장은 개발·리뷰 부서와 상단 밴드에서
    // 두 개가 인접 배치되므로 넘친 폭이 곧 겹침이고, 옆 칸 사람과 상태 링을 가린다.
    // (실제로 겪었다 — 높이 환산만 적용한 첫 구현에서 책장이 50.4px 로 10px 겹쳤다.)
    //
    // 상한은 딱 1칸이었다가 `officeFurnitureWidthCapTiles`(1.15) 로 완화됐다 — 1칸이면
    // 폭 넓은 에셋의 **높이까지** 눌러 책상 97%·소파 85%·책장 79% 만 반영됐다. 상한 자체를
    // 없애지는 않는다. 여기서 상수를 곱해 읽는 이유는 정책이 바뀌면 이 검사도 따라오게 하되
    // 상한이 사라지는 것은 막기 위해서다.
    t.expect(
        officeFurnitureWidthCapTiles >= 1.0 && officeFurnitureWidthCapTiles <= 1.25,
        "가구 폭 상한이 1.0~1.25칸 (실제 \(officeFurnitureWidthCapTiles))"
    )
    for kind in FurnitureKind.allCases {
        let renderedWidth = kind.nativeSize.width * kind.sizeBoost
        let allowed =
            Double(kind.footprint.width) * officeFurnitureWidthCapTiles * officeReferenceTileSize
        t.expect(
            renderedWidth <= allowed,
            "\(kind.rawValue) 보정 후 폭이 상한 이하 (실제 \(renderedWidth) vs \(allowed))"
        )
    }

    // 같은 계열 가구는 같은 배율을 받는다 — 탕비실에 2인·3인 소파가 3칸 간격으로 함께 놓이는데
    // 폭 상한을 각자 계산하면 2인 소파가 3인 소파보다 높아 보인다.
    t.expectEqual(
        FurnitureKind.sofa2.sizeBoost,
        FurnitureKind.sofa3.sizeBoost,
        "2인·3인 소파가 같은 배율"
    )

    // **환산 예외는 "세로가 높이가 아닌 것" 뿐이다** — 위에서 내려다본 회의 테이블(세로가
    // 깊이)과 바닥 깔개(애초에 높이가 없다). 벽에 걸린 정면도는 세로가 곧 높이라 성립한다.
    //
    // 한때 벽걸이 10종과 시계·화이트보드·문까지 13종이 예외였다. 그 결과 그것들만 원본
    // 픽셀로 남아 **시계가 실물 축척의 2배, 화이트보드는 40% 크기**로 그려졌다. 예외를
    // 늘리면 같은 일이 반복되므로 목록으로 못박는다 — 새 가구에 실측값을 안 채우면 여기서 걸린다.
    let heightExempt: Set<FurnitureKind> = [.meetingTable, .rugGreen, .rugBeige, .rugNavy]
    for kind in FurnitureKind.allCases where !heightExempt.contains(kind) {
        t.expect(
            kind.targetHeightCm != nil,
            "\(kind.rawValue) 실물 높이 실측값 존재 (예외는 회의 테이블·깔개뿐)"
        )
    }
    for kind in heightExempt {
        t.expectNil(kind.targetHeightCm, "\(kind.rawValue) 은 높이 환산 제외")
    }
    // 깔개는 바닥 장식이라 밟고 지나갈 수 있어야 한다 — 막으면 소파 앞이 통째로 고립된다.
    for kind in FurnitureKind.allCases where kind.isFloorDecor {
        t.expect(kind.isWalkThrough, "\(kind.rawValue) 은 밟고 지나갈 수 있다")
    }
    // 시계는 환산에 들어오면서 **작아진다**. 되돌아가면(예외로 빼면) 1.0 이 되어 걸린다.
    t.expect(
        FurnitureKind.clock.sizeBoost < 1.0,
        "벽시계가 원본보다 작아짐 (실제 \(FurnitureKind.clock.sizeBoost))"
    )

    // 3단 책장은 이전 일괄 보정(책상·회의테이블·소파만)에서 빠져 원본 크기로 방치돼 있었다.
    // 지금은 보정을 받지만 **폭 상한에 걸려 목표 높이를 다 채우지 못한다** — 환산 목표는
    // 사람 키의 88% 인데 실제로는 70% 다. 에셋이 37×35 로 거의 정사각형인데 실물 3단 책장은
    // 세로로 길어서, 높이를 맞추면 폭이 1칸을 넘어 인접 책장·옆 칸 사람과 겹친다.
    // 배율로는 여기까지가 한계이고 해소는 에셋 재제작(3단계) 몫이다.
    //
    // 기준을 78% 로 둔 것은 회귀 방지용이다. 배율을 1.0 으로 되돌리면 65%, 폭 상한을 1칸으로
    // 되돌리면 70% 로 떨어져 둘 다 걸린다.
    let bookshelf = FurnitureKind.bookshelf
    let bookshelfHeight = bookshelf.nativeHeight * bookshelf.sizeBoost
    t.expect(
        bookshelfHeight >= characterHeight * 0.78,
        "책장이 사람 키의 78% 이상 (실제 \(Int(bookshelfHeight / characterHeight * 100))%)"
    )
    // 폭 상한이 결정한 배율을 그대로 쓴다 — 상한 안에서 최대한 키운 상태여야 한다.
    // 누가 배율을 임의값으로 되돌리면 여기서 걸린다.
    t.expectEqual(
        bookshelf.sizeBoost,
        officeFurnitureWidthCapTiles * officeReferenceTileSize / bookshelf.nativeSize.width,
        "책장 배율이 폭 상한값과 일치"
    )

    // 가구가 사람보다 크게 솟지 않는다 — 키 큰 화분·책장이 1.4~1.5배 보정을 받으므로 상한을
    // 본다. 관제 화면에서 가구가 옆 칸 사람과 상태 링을 덮으면 정보가 사라진다.
    //
    // 제외 대상은 두 부류다. 세로가 높이가 아닌 것(회의 테이블·깔개)은 비교 자체가 성립하지
    // 않는다. 자판기(180cm)는 **실물이 사람보다 높은 물건**이라 사람 키로 자르면 실측 환산을
    // 되돌리는 셈이 되므로, 대신 1.2배까지만 허용해 무제한으로 커지는 것을 막는다.
    let tallerThanPeople: Set<FurnitureKind> = [.vendingMachine]
    for kind in FurnitureKind.allCases where !heightExempt.contains(kind) {
        let height = kind.nativeHeight * kind.sizeBoost
        let allowed = characterHeight * (tallerThanPeople.contains(kind) ? 1.2 : 1.0)
        t.expect(
            height <= allowed,
            "\(kind.rawValue) 높이가 상한 이하 (실제 \(height) vs \(allowed))"
        )
    }

    // 책상은 여전히 확대 보정 대상이다(원본이 환산값의 90%).
    t.expect(FurnitureKind.desk.sizeBoost > 1, "책상은 확대 보정")

    // 구역 사이에 칸막이 벽이 실제로 서 있어야 한다 — 벽이 없으면 방이 나뉘어 보이지 않는다.
    // 세로 경계를 한 열만 보면 벽 세우는 루프의 범위가 어긋나도 통과하므로 전 경계를 본다.
    //
    // 복도에 면한 벽에는 방마다 문 한 칸이 뚫려 있으므로, 그 몫을 뺀 나머지가 전부 벽이어야
    // 한다. 문 개수까지 함께 고정하지 않으면 벽이 뭉텅이로 빠져도 "문이 좀 많네" 로 통과한다.
    let wallColumns = Set(plan.zones.flatMap { [$0.origin.x, $0.origin.x + $0.width - 1] })
    for column in wallColumns.sorted() {
        let walls = (0..<zoneAreaRows).filter { plan.floor[$0][column] == .wall }
        let facesCorridor =
            officeCorridorColumns.contains(column - 1) || officeCorridorColumns.contains(column + 1)
        // 복도에 면한 벽이면 위·아래 구역이 문 하나씩(= 구역 수 ÷ 3 열 만큼)을 낸다.
        let doorCount = facesCorridor ? 2 : 0
        t.expectEqual(
            walls.count, zoneAreaRows - doorCount,
            "x=\(column) 세로 칸막이가 문(\(doorCount)칸)을 뺀 전 구간 벽"
        )
    }

    // 구역 천장은 문 한 칸만 열려 있어야 한다. 문이 아예 없으면 구역이 고립되고(도달성
    // 테스트가 잡는다), 여러 칸이면 벽이 무의미해지는데 그건 여기서만 잡힌다.
    //
    // **위 구역도 함께 본다.** 한때 위 구역 천장은 통째로 열려 있었다 — 그 줄이 밴드로 나가는
    // 유일한 출구였기 때문인데, 복도가 생겨 막을 수 있게 됐다. 위·아래를 갈라 검사하면
    // 한쪽 천장이 조용히 사라져도 통과한다.
    for zone in plan.zones {
        let ceilingY = zone.origin.y + zone.height - 1
        let doors = (zone.origin.x..<(zone.origin.x + zone.width))
            .filter { plan.floor[ceilingY][$0] != .wall }
        t.expectEqual(doors.count, 1, "\(zone.department.label) 구역 천장에 문 한 칸")
    }

    // === 복도 ===
    // 복도가 실제로 이어져 있어야 한다. 한 칸이라도 벽·가구에 막히면 그 위·아래 방들이
    // 통째로 고립되고, 그때 화면에는 "사람이 자기 자리에 못 앉는" 증상으로만 나타난다.
    // 아래 끝은 하단 바깥벽이라 복도가 거기서 끊기는 것이 정상이다 — 격자 맨 아래 줄부터 센다.
    for column in officeCorridorColumns {
        let blockedTiles = (officeFloorWallRows..<(plan.rows - officeOuterWallRows))
            .filter { !plan.walkable.contains(TilePoint(x: column, y: $0)) }
        t.expectEqual(blockedTiles.count, 0, "세로 복도 x=\(column) 막힌 줄: \(blockedTiles)")
    }
    let blockedCorridorRow = (1..<(plan.columns - 1))
        .filter { !plan.walkable.contains(TilePoint(x: $0, y: officeCorridorRow)) }
    t.expectEqual(blockedCorridorRow.count, 0, "가로 복도 막힌 열: \(blockedCorridorRow)")

    // 세로 복도와 가로 복도가 실제로 만나는가 — 만나지 않으면 두 복도가 각각 막다른 길이 된다.
    for column in officeCorridorColumns {
        t.expect(
            plan.floor[officeCorridorRow][column] == .corridor,
            "세로 복도 x=\(column) 가 가로 복도와 교차"
        )
    }

    // 방마다 복도로 나가는 문이 있어야 한다. 천장 문만으로도 도달은 되므로(아래 방 → 위 방 →
    // 밴드) 도달성 테스트는 이 문이 통째로 빠져도 통과한다 — 그러면 복도를 새로 낸 의미가
    // 사라지고 예전처럼 방을 관통해 다니게 되는데, 그걸 잡는 단언은 여기뿐이다.
    for zone in plan.zones {
        let sideWalls = [zone.origin.x, zone.origin.x + zone.width - 1]
        let corridorDoors = sideWalls.flatMap { wallX in
            (zone.origin.y..<(zone.origin.y + zone.height))
                .filter { y in
                    plan.floor[y][wallX] != .wall && plan.walkable.contains(TilePoint(x: wallX, y: y))
                }
                .map { "(\(wallX),\($0))" }
        }
        t.expect(
            !corridorDoors.isEmpty,
            "\(zone.department.label) 방에서 복도로 나가는 문이 없다"
        )
    }

    // 벽에 난 구멍마다 문이 서 있어야 한다.
    //
    // 구멍을 내는 자리(`raiseWall` 을 건너뛰는 분기)와 문을 세우는 자리가 어긋나면 두 가지로
    // 깨진다 — 출입구가 문 없는 맨바닥으로 남거나, 문이 구멍 아닌 벽 한가운데 선다. 둘 다
    // **화면에서만** 드러난다: 통행은 `isWalkThrough` 가 따로 열어 두므로 도달성 테스트는
    // 그대로 통과한다.
    let doorTiles = Set(
        plan.furniture
            .filter { $0.kind == .doorOpen || $0.kind == .doorClosed }
            .map(\.tile)
    )
    let blockedDoors = doorTiles.filter { !plan.walkable.contains($0) }
    t.expectEqual(
        blockedDoors.count, 0,
        "문이 통행을 막는다: \(blockedDoors.map { "(\($0.x),\($0.y))" }.sorted())"
    )
    for zone in plan.zones {
        let ceilingY = zone.origin.y + zone.height - 1
        var openings = (zone.origin.x..<(zone.origin.x + zone.width))
            .filter { plan.floor[ceilingY][$0] != .wall }
            .map { TilePoint(x: $0, y: ceilingY) }
        for wallX in [zone.origin.x, zone.origin.x + zone.width - 1] {
            openings += (zone.origin.y..<(zone.origin.y + zone.height))
                .filter { plan.floor[$0][wallX] != .wall }
                .map { TilePoint(x: wallX, y: $0) }
        }
        let bare = openings.filter { !doorTiles.contains($0) }
        t.expectEqual(
            bare.count, 0,
            "\(zone.department.label) 방의 문 없는 구멍: "
                + "\(bare.map { "(\($0.x),\($0.y))" }.sorted())"
        )
    }

    // === 문 여닫이 ===
    // 평면도는 **닫힌 문만** 놓는다. 여는 판정은 렌더가 사람 위치를 보고 매 걸음 내린다
    // (`officeDoorIsOpen`). 여기서 열린 문이 하나라도 놓이면 그 짝은 사람이 없어도 영영
    // 열린 채로 남는다 — 열두 짝이 전부 그랬던 것이 이 변경의 출발점이다.
    let alwaysOpen = plan.furniture.filter { $0.kind == .doorOpen }
    t.expectEqual(
        alwaysOpen.count, 0,
        "평면도에 열린 문이 고정 배치됨: \(alwaysOpen.map { "(\($0.tile.x),\($0.tile.y))" })"
    )
    t.expect(!doorTiles.isEmpty, "문이 하나 이상 배치됐다")
    // 판정 자체 — 근처 판정이 무력해지면(늘 참/늘 거짓) 문이 계속 열려 있거나 아예 안 열린다.
    if let door = doorTiles.sorted(by: { ($0.y, $0.x) < ($1.y, $1.x) }).first {
        let front = TilePoint(x: door.x, y: door.y + 1)
        let far = TilePoint(x: door.x, y: door.y + 2)
        t.expect(!officeDoorIsOpen(door: door, occupied: []), "아무도 없으면 닫힌다")
        t.expect(officeDoorIsOpen(door: door, occupied: [door]), "문 칸에 서면 열린다")
        t.expect(officeDoorIsOpen(door: door, occupied: [front]), "문 바로 앞에 서면 열린다")
        t.expect(!officeDoorIsOpen(door: door, occupied: [far]), "두 칸 떨어지면 닫힌다")
    }

    // 밴드 세 방도 벽으로 갈려야 한다 — 바닥재만으로 나누면 화면 위쪽이 "가구 놓인 띠 하나"
    // 로 읽힌다. 방 바닥 줄(가로 복도 위)에서 좌우 경계가 벽인지 본다.
    for area in plan.commonAreas {
        let leftWall = plan.floor[officeCorridorRow + 1][area.originX]
        let rightWall = plan.floor[officeCorridorRow + 1][area.originX + area.width - 1]
        t.expectEqual(leftWall, .wall, "\(area.label) 왼쪽 칸막이")
        t.expectEqual(rightWall, .wall, "\(area.label) 오른쪽 칸막이")
    }
    // 그리고 그 벽이 방 높이 전체를 덮어야 한다(한 줄만 서 있으면 위가 뚫려 보인다).
    for area in plan.commonAreas {
        for y in (officeCorridorRow + 1)..<(plan.rows - officeOuterWallRows) {
            t.expectEqual(plan.floor[y][area.originX], .wall, "\(area.label) 왼쪽 벽 y=\(y)")
        }
    }

    // 부서 문패가 첫 좌석 행의 이름표를 덮지 않는다.
    //
    // 문패는 오버레이(z=1000)라 겹치면 가리는 쪽이 늘 문패다. 게다가 문패는 구역 정중앙
    // (칸 5.5)에 놓이고 좌석은 1·3·5·7 이라, 세로가 겹치는 순간 **매번 같은 사람**
    // (세 번째 좌석)의 이름이 통째로 사라진다. 무작위가 아니라 구조적이어서, 화면에서는
    // "저 사람만 이름이 없네" 로 보이지 고장으로 보이지 않았다.
    // 창 크기 전 구간을 훑는다. 한글 글자에 하한(11px)이 있어 **작은 창일수록 타일 대비
    // 이름표가 커지므로**(최소 창 0.68칸 vs 기준 0.375칸), 큰 창만 확인하면 이 구간을 놓친다.
    // 20.6 은 최소 창(640×560)에서의 타일 크기다.
    for tileSize in [20.6, 32.0, 40.0, 61.0, 90.0] {
        for zone in plan.zones {
            guard let topSeatY = officeTopSeatY(zone: zone, desks: plan.desks) else {
                continue
            }
            let nameplateTop = officeSeatedNameplateTopTiles(
                seatY: topSeatY, tileSize: tileSize
            )
            let labelBottom = officeZoneLabelBottomTiles(
                zone: zone, topSeatY: topSeatY, tileSize: tileSize
            )
            t.expect(
                labelBottom >= nameplateTop + officeZoneLabelGapTiles - 0.0001,
                "타일 \(tileSize) · \(zone.department.label) 문패 아래끝(\(labelBottom))이 이름표 위끝(\(nameplateTop)) 위"
            )
        }
    }

    // 문패 높이가 실제로 창 크기를 따라 움직이는가. 위 단언만으로는 계산식이 다시 고정
    // 배수로 굳어도(그리고 큰 창에서만 맞아도) 통과할 수 있다. 작은 창에서는 이름표가
    // 커진 만큼 문패가 구역 경계 줄보다 확실히 더 올라가야 한다.
    for zone in plan.zones {
        guard let topSeatY = officeTopSeatY(zone: zone, desks: plan.desks) else {
            continue
        }
        let boundary = Double(zone.origin.y + zone.height - 1)
        let small = officeZoneLabelBottomTiles(zone: zone, topSeatY: topSeatY, tileSize: 20.6)
        let large = officeZoneLabelBottomTiles(zone: zone, topSeatY: topSeatY, tileSize: 90.0)
        t.expect(
            small > boundary + 0.3,
            "\(zone.department.label) 작은 창에서 문패가 경계 줄보다 올라감(\(small) vs \(boundary))"
        )
        t.expect(small > large, "\(zone.department.label) 작은 창 문패가 큰 창보다 더 높이 뜬다")
    }

    // 부서마다 자리 모양이 실제로 다르다.
    //
    // 여섯 방이 전부 같은 4열 격자였던 것이 "복사 붙여넣기 같다" 의 실체다. 배치표가 다시
    // 하나로 수렴하면(또는 새 부서가 남의 배치를 그대로 복사하면) 여기서 잡힌다.
    let layouts = Department.allCases.map { departmentDeskSpots($0) }
    for (index, layout) in layouts.enumerated() {
        for other in layouts[(index + 1)...] where layout == other {
            t.expect(false, "부서 자리 배치가 서로 같다(복사 붙여넣기 회귀)")
        }
        t.expect(!layout.isEmpty, "\(Department.allCases[index].label) 자리 배치 비어 있지 않음")
    }

    // 문 열(x = 8)에는 자리를 놓지 않는다 — 아래 구역과 이어지는 세로 동선이다.
    // 도달성 테스트가 결과적으로 잡기는 하지만, 원인을 바로 가리키는 단언을 따로 둔다.
    for department in Department.allCases {
        let onDoorColumn = departmentDeskSpots(department).filter { $0.x == officeZoneDoorColumn }
        t.expectEqual(onDoorColumn.count, 0, "\(department.label) 자리가 문 열을 막지 않음")
    }

    // 아래 행 사람의 이름표가 위 행 책상을 침범하지 않는다.
    //
    // 예전 3행 배치는 행 간격이 2 칸이라, 아래 행 이름표가 위 행 책상 상판에 얹혀 글자가
    // 나뭇결에 묻혔다(사진에서 내부 부서의 "윤문"·"이슈 분류"). 간격 3 칸이면 닿지 않는데,
    // 여유가 0.1칸뿐이라 배치를 손볼 때 쉽게 되돌아간다 — 최소 창 기준으로 고정해 둔다.
    let smallestTile = 20.6
    for zone in plan.zones {
        let zoneDesks = plan.desks.filter { desk in
            desk.desk.x >= zone.origin.x && desk.desk.x < zone.origin.x + zone.width
                && desk.desk.y >= zone.origin.y && desk.desk.y < zone.origin.y + zone.height
        }
        for desk in zoneDesks {
            let nameplateTop = officeSeatedNameplateTopTiles(
                seatY: desk.seat.y, tileSize: smallestTile
            )
            // 같은 열에서 이 사람보다 위에 있는 가장 가까운 책상.
            guard let above = zoneDesks
                .filter({ $0.desk.x == desk.desk.x && $0.desk.y > desk.desk.y })
                .map(\.desk.y)
                .min()
            else {
                continue
            }
            t.expect(
                nameplateTop <= Double(above),
                "\(zone.department.label) x=\(desk.desk.x) 아래 행 이름표(\(nameplateTop))가 위 행 책상(\(above))을 침범"
            )
        }
    }

    // 같은 줄에 앉은 이웃끼리 이름표가 겹치지 않는다.
    //
    // 개발 부서를 "책상 둘을 가로로 붙인 섬" 으로 만들었다가 이름표가 서로를 덮었다
    // ("백엔드규약 점검"). 이름표 폭은 기준 타일(40px)에서 최대 1.38칸이므로 가로 간격
    // 2칸이 하한이다 — 세로 겹침만 보던 앞의 단언은 이걸 놓친다.
    //
    // 최소 창(타일 20.6)에서는 글자 하한 때문에 이름표가 2.45칸까지 커져 간격 2칸으로도
    // 겹친다. 그건 배치로는 못 풀고(내부 10명이 간격 3칸에 안 들어간다) 이름표를 상황에 따라
    // 줄이는 쪽이 답이라, 여기서는 기준 타일을 기준으로 고정한다.
    for zone in plan.zones {
        let seatsByRow = Dictionary(grouping: plan.desks.map(\.seat).filter { seat in
            seat.x >= zone.origin.x && seat.x < zone.origin.x + zone.width
                && seat.y >= zone.origin.y && seat.y < zone.origin.y + zone.height
        }, by: \.y)
        for (row, seats) in seatsByRow {
            let columns = seats.map(\.x).sorted()
            for (index, column) in columns.enumerated().dropFirst() {
                t.expect(
                    column - columns[index - 1] >= 2,
                    "\(zone.department.label) y=\(row) 이웃 자리 간격이 2칸 미만(\(columns))"
                )
            }
        }
    }

    // 대표 자리·줄서기·휴식 자리가 비어 있지 않다.
    t.expect(!plan.queueTiles.isEmpty, "승인 대기 줄 자리 존재")
    t.expect(!plan.loungeTiles.isEmpty, "휴식 자리 존재")

    // 바닥 배열 크기가 격자와 일치한다.
    t.expectEqual(plan.floor.count, plan.rows, "바닥 행 수 == rows")
    t.expectEqual(plan.floor.first?.count ?? 0, plan.columns, "바닥 열 수 == columns")

    // 최상단 줄은 벽 — 사무실 경계.
    let topRowIsWall = plan.floor[plan.rows - 1].allSatisfy { $0 == .wall }
    t.expect(topRowIsWall, "최상단 행은 벽")

    // 빈 입력에서도 크래시 없이 빈 배치를 낸다.
    let empty = officeFloorPlan(agents: [])
    t.expectEqual(empty.desks.count, 0, "에이전트 0명이면 책상 0개")
    t.expectEqual(empty.zones.count, 0, "에이전트 0명이면 구역 0개")

    // 같은 입력은 같은 배치 — 스냅샷마다 자리가 바뀌면 화면이 요동친다.
    let again = officeFloorPlan(agents: sampleAgents)
    let firstAssignment = plan.desks.map { "\($0.agentType)@\($0.desk.x),\($0.desk.y)" }.sorted()
    let secondAssignment = again.desks.map { "\($0.agentType)@\($0.desk.x),\($0.desk.y)" }.sorted()
    t.expectEqual(firstAssignment, secondAssignment, "동일 입력 → 동일 배치")

    // 입력 순서가 달라도 배치가 같다(스냅샷 순서에 흔들리지 않게 사전순으로 채운다).
    let shuffled = officeFloorPlan(agents: sampleAgents.reversed())
    let shuffledAssignment = shuffled.desks
        .map { "\($0.agentType)@\($0.desk.x),\($0.desk.y)" }
        .sorted()
    t.expectEqual(firstAssignment, shuffledAssignment, "입력 순서 무관 → 동일 배치")
}

func runAgentRoleTests(_ t: TestRunner) {
    t.suite("AgentRole")

    // 운영 29종 전부에 한글 직책이 있어야 한다. 하나라도 빠지면 그 사람만 영문 displayName 으로
    // 폴백해 이름표가 뒤섞인다(agentType 과 displayName 을 혼동하면 조용히 빠진다).
    let missing = sampleAgents
        .map(\.agentType)
        .filter { agentRoleLabel(for: $0) == nil }
    t.expectEqual(missing.count, 0, "직책 미매핑: \(missing.sorted())")

    // 이름표가 겹치지 않도록 짧게 유지한다.
    let tooLong = sampleAgents
        .compactMap { agentRoleLabel(for: $0.agentType) }
        .filter { $0.count > 7 }
    t.expectEqual(tooLong.count, 0, "직책이 너무 김(7자 초과): \(tooLong)")

    // 미등록 타입은 nil — 호출자가 displayName 으로 폴백한다.
    t.expect(agentRoleLabel(for: "NOT_A_REAL_AGENT") == nil, "미등록 타입은 nil")

    // 외형 배정은 결정론적이어야 한다 — 실행마다 머리색이 바뀌면 사람을 외울 수 없다.
    let first = characterLook(for: "OPS_SUPERVISOR")
    let second = characterLook(for: "OPS_SUPERVISOR")
    t.expectEqual(first, second, "같은 agentType → 같은 외형")
    t.expect(
        (0..<characterSheetCount).contains(first.sheetIndex),
        "시트 인덱스가 준비된 범위 안"
    )
    t.expect(hairPalette.indices.contains(first.hairIndex), "머리색 인덱스가 팔레트 범위 안")
    t.expect(pantsPalette.indices.contains(first.pantsIndex), "바지색 인덱스가 팔레트 범위 안")

    // 29명이 한 시트에 몰리지 않는지 — 몰리면 다양화가 무의미해진다.
    let sheets = Set(sampleAgents.map { characterLook(for: $0.agentType).sheetIndex })
    t.expect(sheets.count >= 3, "캐릭터 시트가 최소 3종으로 분산 (실제 \(sheets.count)종)")

    // 바지색도 한 색에 몰리지 않아야 한다. 이름표를 약하게 만든 만큼 사람을 구별하는 몫이
    // 모습으로 옮겨왔으므로, 축을 늘려 놓고 실제로는 갈리지 않으면 의미가 없다.
    let pants = Set(sampleAgents.map { characterLook(for: $0.agentType).pantsIndex })
    t.expect(pants.count >= 3, "바지색이 최소 3종으로 분산 (실제 \(pants.count)종)")

    // 바지 팔레트는 어두운 계열이어야 한다 — 면적이 넓어서 밝거나 채도 높은 색을 쓰면
    // 발밑 상태 링보다 옷이 먼저 눈에 들어온다(관제 정확성이 연출보다 우선).
    for (index, color) in pantsPalette.enumerated() {
        let brightness = (color.red + color.green + color.blue) / 3
        let saturation = max(color.red, color.green, color.blue)
            - min(color.red, color.green, color.blue)
        t.expect(brightness <= 0.35, "바지색 \(index) 이 어둡다 (밝기 \(brightness))")
        t.expect(saturation <= 0.2, "바지색 \(index) 이 저채도 (채도 \(saturation))")
    }

    // 머리색과 바지색이 같이 움직이지 않는지 — 같은 나눗셈으로 뽑으면 조합이 고정돼
    // 축을 늘린 효과가 사라진다(시트·머리색에서 이미 겪은 함정).
    let pairs = Set(
        sampleAgents.map { agent -> String in
            let look = characterLook(for: agent.agentType)
            return "\(look.hairIndex)-\(look.pantsIndex)"
        }
    )
    t.expect(
        pairs.count > max(sheets.count, pants.count),
        "머리색·바지색 조합이 각 축보다 다양 (실제 \(pairs.count)종)"
    )
}

func runOfficePathfindingTests(_ t: TestRunner) {
    t.suite("OfficePathfinding")

    // 3x3 전부 통행 가능한 격자
    var open: Set<TilePoint> = []
    for y in 0..<3 {
        for x in 0..<3 {
            open.insert(TilePoint(x: x, y: y))
        }
    }

    let straight = officePath(
        from: TilePoint(x: 0, y: 0), to: TilePoint(x: 2, y: 0), walkable: open
    )
    t.expectEqual(straight.count, 2, "직선 2칸 이동")
    t.expectEqual(straight.last, TilePoint(x: 2, y: 0), "경로 끝은 목적지")

    // 시작 == 목적지면 이동 없음
    let none = officePath(
        from: TilePoint(x: 1, y: 1), to: TilePoint(x: 1, y: 1), walkable: open
    )
    t.expect(none.isEmpty, "제자리면 빈 경로")

    // 도달 불가 — 목적지가 통행 불가
    let blocked = officePath(
        from: TilePoint(x: 0, y: 0), to: TilePoint(x: 9, y: 9), walkable: open
    )
    t.expect(blocked.isEmpty, "통행 불가 목적지 → 빈 경로")

    // 벽을 돌아간다: 가운데 열을 막으면 위/아래로 우회
    var walled = open
    walled.remove(TilePoint(x: 1, y: 0))
    walled.remove(TilePoint(x: 1, y: 1))
    let detour = officePath(
        from: TilePoint(x: 0, y: 0), to: TilePoint(x: 2, y: 0), walkable: walled
    )
    t.expect(detour.count > 2, "막힌 직선 → 우회 경로가 더 길다")
    t.expect(
        !detour.contains(TilePoint(x: 1, y: 0)) && !detour.contains(TilePoint(x: 1, y: 1)),
        "우회 경로는 막힌 칸을 지나지 않는다"
    )

    // 완전히 갇힌 경우
    var isolated: Set<TilePoint> = [TilePoint(x: 0, y: 0), TilePoint(x: 5, y: 5)]
    let unreachable = officePath(
        from: TilePoint(x: 0, y: 0), to: TilePoint(x: 5, y: 5), walkable: isolated
    )
    t.expect(unreachable.isEmpty, "연결 안 된 목적지 → 빈 경로")
    isolated.removeAll()

    // 방향 판정
    t.expectEqual(facing(from: TilePoint(x: 0, y: 0), to: TilePoint(x: 1, y: 0)), .right, "오른쪽")
    t.expectEqual(facing(from: TilePoint(x: 1, y: 0), to: TilePoint(x: 0, y: 0)), .left, "왼쪽")
    t.expectEqual(facing(from: TilePoint(x: 0, y: 0), to: TilePoint(x: 0, y: 1)), .up, "위")
    t.expectEqual(facing(from: TilePoint(x: 0, y: 1), to: TilePoint(x: 0, y: 0)), .down, "아래")
    t.expect(facing(from: TilePoint(x: 0, y: 0), to: TilePoint(x: 0, y: 0)) == nil, "제자리는 nil")

    // 실제 평면도 위에서 자리 간 이동이 가능한가 — 통로가 실제로 이어져 있는지 확인.
    let plan = officeFloorPlan(agents: sampleAgents)
    if let first = plan.desks.first, let last = plan.desks.last, let queue = plan.queueTiles.first {
        let deskToDesk = officePath(from: first.seat, to: last.seat, walkable: plan.walkable)
        t.expect(!deskToDesk.isEmpty, "책상에서 다른 책상까지 경로가 있다")
        let deskToQueue = officePath(from: first.seat, to: queue, walkable: plan.walkable)
        t.expect(!deskToQueue.isEmpty, "책상에서 대표실 줄까지 경로가 있다")
    } else {
        t.expect(false, "표본 평면도에 책상·줄 자리가 있어야 한다")
    }

    // 모든 좌석이 대표실 줄과 연결돼 있어야 한다 — 하나라도 고립되면 그 캐릭터는 승인 줄에 못 선다.
    if let queue = plan.queueTiles.first {
        let isolatedSeats = plan.desks.filter {
            officePath(from: $0.seat, to: queue, walkable: plan.walkable).isEmpty
        }
        t.expectEqual(isolatedSeats.count, 0, "고립된 좌석 없음")
    }

    // === 창문·벽등 ===
    // 창은 바깥과 접한 벽에만 낼 수 있다. 바닥 칸에 얹히면 허공에 뜬 액자가 된다.
    let fixtureTiles = plan.windowTiles + plan.wallLampTiles
    t.expect(!plan.windowTiles.isEmpty, "대표실 창이 하나 이상 있다")
    t.expect(!plan.wallLampTiles.isEmpty, "벽등이 하나 이상 있다")
    for tile in fixtureTiles {
        t.expectEqual(
            plan.floor[tile.y][tile.x],
            .wall,
            "벽 설치물 \(tile.x),\(tile.y) 는 벽 칸 위"
        )
    }
    // 바깥벽은 두 줄이어야 한다. 한 줄이면 벽면 높이가 없어 벽에 건 물건이 바닥에 놓인
    // 것처럼 보인다(실제로 그렇게 보였다). 설치물은 전부 아래 줄 — 위 줄은 벽 윗면이다.
    for row in (plan.rows - officeOuterWallRows)..<plan.rows {
        let nonWall = (0..<plan.columns).filter { plan.floor[row][$0] != .wall }
        t.expectEqual(nonWall.count, 0, "\(row)행은 전부 바깥벽")
    }
    for tile in fixtureTiles {
        t.expectEqual(tile.y, plan.rows - officeOuterWallRows, "벽 설치물은 벽 아래 줄에 건다")
    }

    // 같은 칸을 두 설치물이 나눠 쓰면 나중에 그린 쪽만 보인다.
    t.expectEqual(Set(fixtureTiles).count, fixtureTiles.count, "창·벽등이 서로 겹치지 않음")
    // 벽에 걸린 가구(시계·화이트보드)와도 겹치면 안 된다 — 가구는 objectLayer 라 창을 덮는다.
    let furnitureTiles = Set(plan.furniture.map(\.tile))
    let collidedFixtures = fixtureTiles.filter { furnitureTiles.contains($0) }
    t.expectEqual(collidedFixtures.count, 0, "창·벽등이 벽 가구와 겹치지 않음")

    // 벽에 거는 물건은 **벽 칸 위에만** 있어야 한다.
    //
    // 상단 밴드는 벽 줄에 명시적으로 걸었지만 부서 방은 일반 바닥 후보를 그대로 써서, 개발실
    // 시계가 카펫 한가운데 떠 있고 리뷰실 화이트보드가 바닥에 누워 있었다. "관통 가능한가"
    // 만 검사하면 이 결함이 통과한다 — 벽걸이는 어디에 놓든 바닥을 막지 않기 때문이다.
    // 무엇 위에 놓였는지를 바닥 타일과 직접 대조한다.
    let offWallMounts = plan.furniture.filter { placement in
        placement.kind.isWallMounted
            && plan.floor[placement.tile.y][placement.tile.x] != .wall
    }
    t.expectEqual(
        offWallMounts.count, 0,
        "벽 밖에 놓인 벽걸이: "
            + "\(offWallMounts.map { "\($0.kind.rawValue)@\($0.tile.x),\($0.tile.y)" }.sorted())"
    )

    // 여섯 방 모두 벽에 걸린 물건을 하나 이상 가진다. 위 세 방만 들고 있으면 창·등·시계가
    // 전부 몰린 상단과 벽이 텅 빈 아래로 화면이 갈린다.
    //
    // 벽 한 칸을 이웃 방과 공유하므로 `wallDepartment`(먼저 나온 구역을 반환) 로 세면 개발실
    // 벽걸이가 기획실 것으로 잡힌다. 각 방이 자기 벽 한 열만 쓰는 규칙을 그대로 검사한다.
    for zone in plan.zones {
        let mountColumn = officeWallMountColumn(zoneOriginX: zone.origin.x)
        let mounted = plan.furniture.filter { placement in
            placement.kind.isWallMounted
                && placement.tile.x == mountColumn
                && placement.tile.y >= zone.origin.y
                && placement.tile.y < zone.origin.y + zone.height
        }
        t.expect(!mounted.isEmpty, "\(zone.department.label) 방 벽에 걸린 물건 1개 이상")
        // 걸린 자리가 건물 바깥벽(격자 좌우 최외곽)이면 화면 가장자리에 반쯤 걸린 그림이 된다.
        t.expect(
            mountColumn > 0 && mountColumn < plan.columns - 1,
            "\(zone.department.label) 벽걸이가 바깥벽이 아닌 칸막이에 걸림 (열 \(mountColumn))"
        )
    }

    // 벽걸이끼리 같은 칸을 나눠 쓰면 나중에 그린 쪽만 보인다.
    let mountTiles = plan.furniture.filter(\.kind.isWallMounted).map(\.tile)
    t.expectEqual(Set(mountTiles).count, mountTiles.count, "벽걸이끼리 겹치지 않음")

    // 휴식 자리도 전 좌석에서 닿아야 한다 — 밴드에 가구를 놓다 가로 통로를 막으면
    // 완료 후 탕비실에 가지 못하고 제자리에 머문다(walk 가 빈 경로를 받아 조용히 반환).
    //
    // 첫 자리만 보면 안 된다: visitLounge 는 비어 있는 자리를 순서대로 고르므로 둘째·셋째
    // 자리도 실제로 쓰이고, 그 자리만 끊겨도 그 사람은 조용히 제자리에 남는다.
    for lounge in plan.loungeTiles {
        t.expect(plan.walkable.contains(lounge), "휴식 자리 \(lounge.x),\(lounge.y) 통행 가능")
        let unreachableSeats = plan.desks.filter {
            officePath(from: $0.seat, to: lounge, walkable: plan.walkable).isEmpty
        }
        t.expectEqual(
            unreachableSeats.count, 0,
            "휴식 자리 \(lounge.x),\(lounge.y) 에 못 가는 좌석 없음"
        )
    }

    runDeskPaperTests(t)
}

/// 책상 위 서류 더미 — 오늘 끝낸 일 건수를 장수로 바꾸는 눈금.
private func runDeskPaperTests(_ t: TestRunner) {
    t.suite("DeskPaperStack")

    // 눈금을 값으로 못 박는다. 두 배마다 한 장이라는 규칙은 화면에서 눈으로 검산할 수 없고
    // (사람이 22와 16을 구별하지 못한다), 경계에서 한 장 어긋나도 그럴듯해 보인다.
    let expected: [(done: Int, papers: Int)] = [
        (0, 0), (1, 1), (2, 2), (3, 2), (4, 3), (7, 3),
        (8, 4), (15, 4), (16, 5), (100, 5),
    ]
    for (done, papers) in expected {
        t.expectEqual(
            officeDeskPaperCount(doneToday: done), papers, "\(done)건 → \(papers)장"
        )
    }

    // 이 필드를 모르는 구버전 서버 응답. 아무것도 그리지 않는다 — "모른다" 와 "0건" 을 화면에서
    // 구별할 수 없으므로 없는 정보를 그리지 않는 쪽을 고른다.
    t.expectEqual(officeDeskPaperCount(doneToday: nil), 0, "값 없음 → 0장")

    // 음수는 나올 수 없는 값이지만, 들어오면 루프가 끝나지 않을 자리다(remaining /= 2 가
    // -1 에서 0 으로 떨어지긴 하나 상한 판정에 의존하게 된다). 0장으로 끊는 것을 못 박는다.
    t.expectEqual(officeDeskPaperCount(doneToday: -3), 0, "음수 → 0장")

    // 상한을 넘지 않는다. 상한이 뚫리면 서류가 책상을 넘어 위 칸 사람의 이름표를 덮는다.
    for done in [1, 2, 5, 17, 1_000, Int.max] {
        t.expect(
            officeDeskPaperCount(doneToday: done) <= officeDeskPaperMaxCount,
            "\(done)건에서도 상한 \(officeDeskPaperMaxCount)장 이내"
        )
    }

    // 단조 증가 — 일을 더 했는데 서류가 줄어들면 화면이 거짓말을 한다.
    var previous = 0
    for done in 0...64 {
        let papers = officeDeskPaperCount(doneToday: done)
        t.expect(papers >= previous, "\(done)건에서 장수가 줄지 않음")
        previous = papers
    }

    // 최대치로 쌓은 더미가 책상 상판 안에 머무는지. 책상보다 높이 쌓이면 위 칸(좌석) 사람의
    // 발밑·이름표 영역으로 올라간다 — 관제 신호를 장식이 덮는 것은 정보 손실이다.
    let deskHeightTiles =
        FurnitureKind.desk.nativeSize.height * FurnitureKind.desk.sizeBoost
        / officeReferenceTileSize
    let stackTopTiles =
        officeDeskPaperOriginTiles.y
        + Double(officeDeskPaperMaxCount - 1) * officeDeskPaperStepTiles
    t.expect(
        stackTopTiles < deskHeightTiles,
        "5장 더미 위끝 \(stackTopTiles) 이 책상 높이 \(deskHeightTiles) 안"
    )

    // 가로도 같이 봐야 한다. 더미는 위로 갈수록 좌우로 벌어지므로(officeDeskPaperSpreadGrowth)
    // 장수가 늘면 세로보다 **가로**가 먼저 책상을 넘는다 — 넘으면 서류가 상판을 벗어나 옆 칸
    // 허공에 뜬 물체로 보인다. 눈으로는 "책상 끝에 놓인 것" 과 구별이 어려워 테스트가 필요하다.
    let deskHalfWidthTiles =
        FurnitureKind.desk.nativeSize.width * FurnitureKind.desk.sizeBoost
        / officeReferenceTileSize / 2
    for count in 1...officeDeskPaperMaxCount {
        let reach = officeDeskPaperMaxReachTiles(count: count)
        t.expect(
            reach < deskHalfWidthTiles,
            "\(count)장 더미 오른쪽 끝 \(reach) 이 책상 반폭 \(deskHalfWidthTiles) 안"
        )
    }
    t.expectEqual(officeDeskPaperMaxReachTiles(count: 0), 0, "0장은 자리를 차지하지 않음")

    // 장수가 늘면 더미가 반드시 넓어져야 한다 — 이게 화면에서 양을 읽는 신호다.
    // 넓어지지 않으면(성장률 0) 1장과 5장이 같은 그림이 되어 기능이 조용히 사라진다.
    for count in 2...officeDeskPaperMaxCount {
        t.expect(
            officeDeskPaperMaxReachTiles(count: count)
                > officeDeskPaperMaxReachTiles(count: count - 1),
            "\(count)장이 \(count - 1)장보다 넓다"
        )
    }
}
