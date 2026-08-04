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

// 운영 스냅샷(GET /v1/console/snapshot)의 실제 27종을 그대로 옮긴 표본.
//
// **부서는 백엔드 사규(`agent-registry/agent-contract.ts` 의 `AGENT_CONTRACTS`)가 정본이다.**
// 예전에는 agentType 만 적고 앱의 하드코딩 매핑이 부서를 유도했는데, 그 매핑이 사규와 어긋나
// `REVIEW_REPLY_JUDGE` 가 리뷰가 아니라 내부방에 앉아 있었다. 이제 표본이 사규 값을 그대로
// 들고 있으므로, 사규에서 부서를 옮기면 여기도 함께 갱신해야 한다.
//
// 인원을 임의로 줄이면 안 된다 — 26명짜리 표본을 쓰던 동안 "내부 부서 마지막 한 명이 자리를
// 못 받아 화면에서 사라지는" 결함이 통과했다. 구역 정원은 12석이고 지금 가장 큰 부서가 9명이다.
// agentType 은 displayName 과 다르다: EVENING_RETRO(타입) ↔ "Evening Retro Publish"(표시명).
private let sampleAgents: [ConsoleAgent] =
    planAgents(.planning, ["PM", "PO_SHADOW", "PO_EVAL"])
    + planAgents(.engineering, ["BE", "BE_SCHEMA", "BE_TEST", "BE_SRE", "BE_FIX"])
    + planAgents(
        .review, ["CODE_REVIEWER", "WORK_REVIEWER", "IMPACT_REPORTER", "REVIEW_REPLY_JUDGE"]
    )
    + planAgents(.executive, ["CTO", "CEO"])
    + planAgents(.growth, ["CAREER_MATE", "JOB_APPLICATION", "BLOG", "VACATION"])
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
    t.expectEqual(plan.desks.count, sampleAgents.count, "27명 전원 자리 배정")

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

    // 맞닿은 두 구역은 벽 한 칸을 공유한다. 예전에는 구역마다 좌우 여백을 따로 세워
    // 경계가 2칸(80px) 두께 회색 띠가 됐다. 세로 칸막이는 어느 행에서도 1칸이어야 한다
    // (아래 구역 천장은 가로로 이어지는 벽이라 이 검사에서 뺀다).
    let zoneAreaRows = plan.zones.map { $0.origin.y + $0.height }.max() ?? 0
    let bottomZoneY = plan.zones.map { $0.origin.y }.min() ?? 0
    let ceilingRow = bottomZoneY + (plan.zones.first?.height ?? 0) - 1
    var thickWallRuns: [String] = []
    for y in 0..<zoneAreaRows where y != ceilingRow {
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
                placement.kind != .desk
                    && placement.tile.x > zone.origin.x
                    && placement.tile.x < zone.origin.x + zone.width - 1
                    && placement.tile.y >= zone.origin.y
                    && placement.tile.y < zone.origin.y + zone.height
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

    // 격자 기본값이 화면에 남지 않아야 한다.
    //
    // 기본값은 예전에 `woodA` 였다. 그것은 리뷰 부서의 바닥재이기도 해서, 칠하기가 빠진 칸이
    // 생기면 "리뷰방 바닥" 으로 위장한 채 아무도 눈치채지 못했다. 기본값을 전용 종류로 바꿔
    // 이 검사가 성립하게 만든 것이 이 변경의 요점이다 — 지금 평면도는 방·밴드·벽이 모든 칸을
    // 덮으므로 남는 칸이 0이고, 0이 아니게 되는 순간이 곧 칠하기 누락이다.
    var unpaintedTiles: [String] = []
    for y in 0..<plan.rows {
        for x in 0..<plan.columns where plan.floor[y][x] == .corridor {
            unpaintedTiles.append("(\(x),\(y))")
        }
    }
    t.expectEqual(unpaintedTiles.count, 0, "칠하기가 빠진 칸: \(unpaintedTiles)")

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
    // 통로는 방보다 어둡게 눌러 배경으로 물러난다 — 사람·가구가 앞서야 한다.
    for tile in FloorTile.allCases where tile.isRoomFloor {
        t.expect(
            FloorTile.corridor.muteStrength > tile.muteStrength,
            "통로가 \(tile.rawValue) 보다 어둡다"
        )
    }

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

    // 벽 공유로 열이 한 칸 늘었으므로 밴드 오른쪽 끝까지 바닥이 칠해져야 한다
    // (안 칠하면 격자 끝 한 열만 기본 나무 바닥으로 남아 복도가 잘려 보인다).
    t.expectEqual(plan.floor[zoneAreaRows][plan.columns - 1], .ceramic, "밴드 오른쪽 끝 열도 바닥")

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
    // 벗어난다. 하한 0.85 는 조정 여지로 남긴 값이고, 그 아래는 27명 구별도 어려워진다.
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

    // **보정 후 폭이 점유 칸을 넘지 않는다.** 렌더가 배율을 가로·세로에 같이 곱하므로
    // 높이만 보고 키우면 폭이 옆 칸을 침범한다. 책장은 개발·리뷰 부서와 상단 밴드에서
    // 두 개가 인접 배치되므로 넘친 폭이 곧 겹침이고, 옆 칸 사람과 상태 링을 가린다.
    // (실제로 겪었다 — 높이 환산만 적용한 첫 구현에서 책장이 50.4px 로 10px 겹쳤다.)
    for kind in FurnitureKind.allCases {
        let renderedWidth = kind.nativeSize.width * kind.sizeBoost
        let allowed = Double(kind.footprint.width) * officeReferenceTileSize
        t.expect(
            renderedWidth <= allowed,
            "\(kind.rawValue) 보정 후 폭이 점유 칸 이하 (실제 \(renderedWidth) vs \(allowed))"
        )
    }

    // 같은 계열 가구는 같은 배율을 받는다 — 탕비실에 2인·3인 소파가 3칸 간격으로 함께 놓이는데
    // 폭 상한을 각자 계산하면 2인 소파가 3인 소파보다 높아 보인다.
    t.expectEqual(
        FurnitureKind.sofa2.sizeBoost,
        FurnitureKind.sofa3.sizeBoost,
        "2인·3인 소파가 같은 배율"
    )

    // 세로 픽셀이 높이가 아닌 세 종은 환산에서 빠져야 한다 — 벽시계를 지름 30cm 로 환산하면
    // 절반으로 줄어 보이지 않게 되고, 회의 테이블의 세로는 깊이(원근)다.
    t.expectNil(FurnitureKind.clock.targetHeightCm, "벽시계는 높이 환산 제외")
    t.expectNil(FurnitureKind.whiteboard.targetHeightCm, "화이트보드는 높이 환산 제외")
    t.expectNil(FurnitureKind.meetingTable.targetHeightCm, "회의 테이블은 높이 환산 제외")
    t.expectEqual(FurnitureKind.clock.sizeBoost, 1.0, "벽시계는 원본 크기")
    t.expectEqual(FurnitureKind.whiteboard.sizeBoost, 1.0, "화이트보드는 원본 크기")

    // 3단 책장은 이전 일괄 보정(책상·회의테이블·소파만)에서 빠져 원본 크기로 방치돼 있었다.
    // 지금은 보정을 받지만 **폭 상한에 걸려 목표 높이를 다 채우지 못한다** — 환산 목표는
    // 사람 키의 88% 인데 실제로는 70% 다. 에셋이 37×35 로 거의 정사각형인데 실물 3단 책장은
    // 세로로 길어서, 높이를 맞추면 폭이 1칸을 넘어 인접 책장·옆 칸 사람과 겹친다.
    // 배율로는 여기까지가 한계이고 해소는 에셋 재제작(3단계) 몫이다.
    //
    // 기준을 68% 로 둔 것은 회귀 방지용이다. 배율을 1.0 으로 되돌리면 65% 로 떨어져 걸린다.
    let bookshelf = FurnitureKind.bookshelf
    let bookshelfHeight = bookshelf.nativeHeight * bookshelf.sizeBoost
    t.expect(
        bookshelfHeight >= characterHeight * 0.68,
        "책장이 사람 키의 68% 이상 (실제 \(Int(bookshelfHeight / characterHeight * 100))%)"
    )
    // 폭 상한이 결정한 배율을 그대로 쓴다 — 상한 안에서 최대한 키운 상태여야 한다.
    // 누가 배율을 임의값으로 되돌리면 여기서 걸린다.
    t.expectEqual(
        bookshelf.sizeBoost,
        officeReferenceTileSize / bookshelf.nativeSize.width,
        "책장 배율이 폭 상한값과 일치"
    )

    // 어떤 가구도 사람보다 높지 않다 — 키 큰 화분·책장이 1.4~1.5배 보정을 받으므로 상한을 본다.
    // 회의 테이블은 세로가 깊이라 이 비교가 성립하지 않아 제외한다.
    for kind in FurnitureKind.allCases where kind != .meetingTable {
        let height = kind.nativeHeight * kind.sizeBoost
        t.expect(
            height <= characterHeight,
            "\(kind.rawValue) 높이가 사람 키 이하 (실제 \(height) vs \(characterHeight))"
        )
    }

    // 책상은 여전히 확대 보정 대상이다(원본이 환산값의 90%).
    t.expect(FurnitureKind.desk.sizeBoost > 1, "책상은 확대 보정")

    // 구역 사이에 칸막이 벽이 실제로 서 있어야 한다 — 벽이 없으면 방이 나뉘어 보이지 않는다.
    // 세로 경계를 한 열만 보면 벽 세우는 루프의 범위가 어긋나도 통과하므로 전 경계를 본다.
    let wallColumns = Set(plan.zones.flatMap { [$0.origin.x, $0.origin.x + $0.width - 1] })
    for column in wallColumns.sorted() {
        let walls = (0..<zoneAreaRows).filter { plan.floor[$0][column] == .wall }
        t.expectEqual(walls.count, zoneAreaRows, "x=\(column) 세로 칸막이가 전 구간 벽")
    }

    // 아래 구역 천장은 문 한 칸만 열려 있어야 한다. 문이 아예 없으면 구역이 고립되고(도달성
    // 테스트가 잡는다), 여러 칸이면 벽이 무의미해지는데 그건 여기서만 잡힌다.
    let bottomOriginY = plan.zones.map { $0.origin.y }.min() ?? 0
    for zone in plan.zones where zone.origin.y == bottomOriginY {
        let ceilingY = zone.origin.y + zone.height - 1
        let doors = (zone.origin.x..<(zone.origin.x + zone.width))
            .filter { plan.floor[ceilingY][$0] != .wall }
        t.expectEqual(doors.count, 1, "\(zone.department.label) 구역 천장에 문 한 칸")
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

    // 운영 27종 전부에 한글 직책이 있어야 한다. 하나라도 빠지면 그 사람만 영문 displayName 으로
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

    // 27명이 한 시트에 몰리지 않는지 — 몰리면 다양화가 무의미해진다.
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
}
