import ConsoleCore

/// 배회 목적지가 **걸어서 닿을 수 있는 칸**인가.
///
/// walkable 은 "막히지 않은 칸"이지 "갈 수 있는 칸"이 아니다. 운영실에서 자판기·프린터·
/// 워터쿨러를 한 줄에 놓자 그 사이 한 칸이 사방으로 갇혔고, 그 칸이 프린터의 유일한 walkable
/// 이웃이어서 목적지로 뽑혔다 — 지시받은 사람은 경로가 빈 채로 남아 자기 책상에서 프린터 앞
/// 동작만 재생했다. 목적지가 무작위이던 동안에는 그 칸이 뽑힐 확률이 낮아 드러나지 않았고,
/// 일과 짝지어 프린터를 콕 집게 되자 다섯 명이 매번 그 칸으로 보내졌다.
func runOfficeStrollReachTests(_ t: TestRunner) {
    t.suite("StrollReach")
    // 2열·3열 모두 본다 — 창 비율에 따라 배치가 갈리므로 한쪽만 보면 다른 쪽 갇힌 칸을 놓친다.
    for columns in [2, 3] {
        let plan = officeFloorPlan(agents: sampleAgents, zoneColumns: columns)
        let spots = officeStrollSpots(plan: plan)
        guard let anchor = plan.desks.first?.seat else {
            t.expect(false, "\(columns)열: 좌석이 없다")
            continue
        }
        // 1) 카탈로그 자체에 갇힌 칸이 없다.
        let stranded = spots.filter {
            officePath(from: anchor, to: $0.tile, walkable: plan.walkable).isEmpty
                && anchor != $0.tile
        }
        t.expect(
            stranded.isEmpty,
            "\(columns)열: 갇힌 목적지 \(stranded.count)건"
                + " \(stranded.prefix(4).map { "\($0.kind.rawValue)@\($0.tile.x),\($0.tile.y)" })"
        )

        // 2) 일과 짝지어진 사람이 실제로 받는 목적지도 도달 가능하다. 카탈로그가 깨끗해도
        //    선택 단계에서 다른 칸을 집으면 같은 증상이 돌아온다.
        var unreachable: [String] = []
        for agent in sampleAgents where !officeWorkAffinity(agentType: agent.agentType).isEmpty {
            guard let home = plan.desks.first(where: { $0.agentType == agent.agentType })?.seat,
                  let spot = officeStrollSpot(
                      for: agent.agentType, round: 1, spots: spots, occupied: [], hour: 14,
                      home: home
                  )
            else {
                continue
            }
            if home != spot.tile,
               officePath(from: home, to: spot.tile, walkable: plan.walkable).isEmpty {
                unreachable.append("\(agent.agentType)→\(spot.kind.rawValue)")
            }
        }
        t.expect(
            unreachable.isEmpty,
            "\(columns)열: 걸어서 못 가는 목적지를 받은 사람 \(unreachable.count)명 \(unreachable.prefix(5))"
        )

        // 3) 완성형 방 그림을 쓸 때 목적지는 **화면에 그려지는 가구** 앞이어야 한다.
        //
        // 셸이 벽·수납·설비를 직접 그려 갖고 있어 씬은 그 가구를 투명으로 돌리는데, 목적지
        // 카탈로그가 그 사실을 몰라 74곳 중 63곳이 없는 물건 앞자리였다 — 빈 나무 바닥
        // 한가운데 서서 혼잣말하는 그림이고, 읽는 자세는 그림에 의자가 붙어 있어 아무것도
        // 없는 바닥에 의자까지 돋아났다.
        let drawnSpots = officeStrollSpots(
            plan: plan, drawnKinds: officeCozyDrawnFurnitureKinds
        )
        let notDrawn = drawnSpots.filter { !officeCozyDrawnFurnitureKinds.contains($0.kind) }
        t.expect(notDrawn.isEmpty, "\(columns)열: 안 그려지는 가구가 목적지에 남았다 \(notDrawn.map(\.kind.rawValue))")

        // **방마다 하나는 남아야 한다.** 0이 되면 그 방 사람 전원이 배회할 때마다 방을
        // 나간다 — 방에 성격에 맞는 집기를 두는 이유 자체가 사라진다. 총무 방이 실제로
        // 그랬다(설비만 모여 있어 그려지는 가구가 한 점도 없었다).
        for zone in plan.zones {
            let mine = drawnSpots.filter { $0.department == zone.department }
            t.expect(
                !mine.isEmpty,
                "\(columns)열: \(zone.department.rawValue) 방에 그려지는 목적지가 없다"
            )
        }

        // **복도 한복판에 서는 목적지가 없다.** 벽걸이는 방과 복도 사이 벽에 걸려서 앞자리가
        // 복도로 잡힌다(`officeInteractionNeighbors`). 그림에 걸린 물건이 없으니 화면에는
        // 통로 한가운데 멈춰 선 사람만 남는다 — 3열에서 열 곳, 2열에서 일곱 곳이었다.
        let corridorColumns = Set(officeCorridorColumns(zoneColumns: columns))
        let standingInCorridor = drawnSpots.filter { corridorColumns.contains($0.tile.x) }
        t.expect(
            standingInCorridor.isEmpty,
            "\(columns)열: 복도 한복판 목적지 \(standingInCorridor.count)건"
                + " \(standingInCorridor.prefix(4).map { "\($0.kind.rawValue)@\($0.tile.x),\($0.tile.y)" })"
        )

        // **좁아진 목록으로도 전원이 자기 방 안에서 해결한다.**
        //
        // 복합기·캐비닛·게시판·지표 모니터가 화면에서 빠지면서 그 물건을 찾던 사람들이
        // 짝짓기 없는 폴백으로 한꺼번에 내려왔다. 폴백이 방을 안 보던 동안 서른 명 표본에서
        // 3열 일곱 명·2열 열한 명이 매번 남의 방으로 걸어갔다 — 방마다 다른 집기를 두는
        // 이유가 사라지는 그림이다.
        var strandedWithFilter: [String] = []
        var leftOwnRoom: [String] = []
        for agent in sampleAgents {
            guard let seat = plan.desks.first(where: { $0.agentType == agent.agentType })?.seat,
                  let zone = plan.zones.first(where: { officeZoneContains($0, seat) })
            else {
                continue
            }
            guard let spot = officeStrollSpot(
                for: agent.agentType, round: 1, spots: drawnSpots, occupied: [], hour: 14,
                home: seat, homeDepartment: zone.department
            ) else {
                strandedWithFilter.append(agent.agentType)
                continue
            }
            // **회의 테이블은 뺀다.** 모여서 정하는 사람들(`officeWorkAffinity`)의 짝이라
            // 남의 방 것을 잡아도 잘못된 상태가 아니다 — 회의는 원래 모여서 하는 일이고,
            // 3열에서는 공용 회의실 것이, 2열에서는 기획 방 것이 가장 가깝다.
            if let department = spot.department, department != zone.department,
                spot.kind != .meetingTable
            {
                leftOwnRoom.append("\(agent.agentType)→\(department.rawValue)")
            }
        }
        t.expect(
            strandedWithFilter.isEmpty,
            "\(columns)열: 목적지를 못 받은 사람 \(strandedWithFilter.count)명 \(strandedWithFilter.prefix(5))"
        )
        t.expect(
            leftOwnRoom.isEmpty,
            "\(columns)열: 남의 방으로 간 사람 \(leftOwnRoom.count)명 \(leftOwnRoom.prefix(5))"
        )
    }

    // 4) 특화 콘솔 발밑에 **그려지는 다른 가구**가 없다.
    //
    // 콘솔은 방마다 하나 놓는 큰 소품인데, 자리를 씬이 혼자 알고 있던 동안 평면도가 그
    // 칸을 비워 두지 않았다 — 기획 방 책장이 기획 보드와 같은 줄·같은 열에 놓여 둘이 한
    // 덩어리로 뭉개졌다. **명단에 따라 어느 칸이 비는지가 달라지므로**(인원이 늘면 가구가
    // 다른 칸으로 밀린다) 자리 한 칸을 표에 적어 고정할 수 없고, 실제 평면도로 재야 한다.
    //
    // 인원이 적은 명단과 정원을 채운 명단을 함께 본다. 가구 배치는 좌석이 다 찬 뒤에야
    // 밀려나므로, 한쪽만 재면 다른 쪽 충돌을 놓친다.
    for (label, roster) in [("표본", sampleAgents), ("정원", strollReachFullRoster())] {
        for columns in [2, 3] {
            let plan = officeFloorPlan(agents: roster, zoneColumns: columns)
            for zone in plan.zones {
                let station = officeDepartmentFeatureTile(zone: zone, furniture: plan.furniture)
                let covered = officeDepartmentFeatureCoverage(
                    furniture: plan.furniture, tile: station
                )
                // 책상이 아닌 가구는 **한 점도** 겹치면 안 된다. 책장·보드처럼 키가 큰 물건은
                // 콘솔과 한 덩어리로 뭉개져 둘 다 무엇인지 읽히지 않는다.
                let tallCover = covered.filter { $0.kind != .desk }
                t.expect(
                    tallCover.isEmpty,
                    "\(label)/\(columns)열: \(zone.department.rawValue) 콘솔(\(station.x),\(station.y))"
                        + " 발밑에 \(tallCover.map { "\($0.kind.rawValue)@\($0.tile.x),\($0.tile.y)" })"
                )
                // 책상은 **거기 앉는 사람** 때문에 겹치면 안 된다(좌석은 책상 칸의 한 줄 앞).
                //
                // 실제 조직 규모(표본)에서는 0 이어야 한다 — 사용자가 신고한 콘텐츠 방 겹침이
                // 이 조건이 깨진 모습이었다.
                //
                // **정원(방마다 열 명)에서는 두 방이 한 칸씩 남는다**(evaluation·internalOps).
                // 콘솔이 노리는 두 칸을 자리 배정에서 뒤로 미뤄 두었지만(`officeDepartment
                // FeatureReservedDeskLocals`), 그 방들은 자리표와 예비 격자를 합쳐도 **쓸 수
                // 있는 칸이 정확히 열 개**라 미룰 여유가 없다. 열 명이 다 앉으려면 콘솔이
                // 노리던 칸까지 써야 하고, 그러면 콘솔은 그 위에 선다. content 는 여유가
                // 한 칸 있어 이 미루기로 해결됐다(세 방 → 두 방).
                //
                // **0 으로 적지 않는 이유**는 못 고친 것을 고쳐진 것처럼 남기면 다음 사람이
                // 이미 해결된 줄 알기 때문이다. 0 으로 내리려면 배치 자체를 손봐야 한다 —
                // 방 정원을 줄이거나, 책상이 쓰는 줄을 y = 1·4 두 줄에서 늘리거나(지금은
                // 이름표 간격 3칸 때문에 두 줄이 상한이다), 콘솔을 더 좁게 그리는 셋 중 하나다.
                let deskCoverLimit = label == "정원" ? 1 : 0
                t.expect(
                    covered.count <= deskCoverLimit,
                    "\(label)/\(columns)열: \(zone.department.rawValue) 콘솔(\(station.x),\(station.y))"
                        + " 가 좌석 \(covered.count)개를 덮는다(상한 \(deskCoverLimit)) "
                        + "\(covered.map { "\($0.kind.rawValue)@\($0.tile.x),\($0.tile.y)" })"
                )
                // 콘솔 두 칸이 방 안(좌우 벽 사이)에 들어간다 — 벽을 넘으면 옆방·복도까지 물든다.
                t.expect(
                    station.x > zone.origin.x && station.x + 1 < zone.origin.x + zone.width - 1,
                    "\(label)/\(columns)열: \(zone.department.rawValue) 콘솔이 벽을 넘었다 (\(station.x))"
                )
            }
        }
    }
}

/// 콘솔 자리를 고르는 규칙 자체를 **인공 배치로 직접** 건다.
///
/// 평면도로만 재면 "지금 이 명단에서 겹치지 않더라" 까지만 알 수 있다. 더 나은 칸을 두고
/// 나쁜 칸을 고르는 회귀는 겹침 상한을 그대로 통과하므로(이대리 리뷰 지적), 규칙이 실제로
/// 도는지는 가구를 손으로 놓아 물어야 한다.
func runOfficeFeatureTilePolicyTests(_ t: TestRunner) {
    // 폭 11(내부 10칸) · 높이 7 — 실제 부서 구역과 같은 크기.
    let zone = DepartmentZone(
        department: .quality, origin: TilePoint(x: 0, y: 0), width: 11, height: 7
    )
    let row = zone.origin.y + 1
    let preferred = officeDepartmentFeaturePreferredOffset(
        zone.department, zoneInnerWidth: zone.width - 1
    )
    func desks(_ offsets: [Int]) -> [FurniturePlacement] {
        offsets.map { FurniturePlacement(kind: .desk, tile: TilePoint(x: $0, y: row)) }
    }
    func coverage(_ tile: TilePoint, _ furniture: [FurniturePlacement]) -> Int {
        officeDepartmentFeatureCoverage(furniture: furniture, tile: tile).count
    }

    // 1) 비어 있으면 선호 칸을 그대로 쓴다.
    t.expectEqual(
        officeDepartmentFeatureTile(zone: zone, furniture: []).x,
        zone.origin.x + preferred,
        "가구가 없으면 콘솔은 선호 칸에 선다")

    // 2) **겹치지 않는 칸이 하나라도 있으면 반드시 그 칸이다.** 선호 칸에서 멀더라도
    //    겹침 0 이 우선한다 — 이 순서가 뒤집히면 콘솔이 남의 좌석 위에 선다.
    //    선호 칸 둘레를 모두 막고 왼쪽 끝 두 칸만 비운다.
    let crowded = desks(Array(3...9))
    let chosen = officeDepartmentFeatureTile(zone: zone, furniture: crowded)
    t.expectEqual(
        coverage(chosen, crowded), 0,
        "빈 칸이 있으면 겹치지 않는 자리를 고른다 (고른 칸 \(chosen.x))")

    // 3) **어느 칸도 비지 않으면 겹침이 가장 적은 칸.** 홀수 칸을 전부 채우면 어느 두 칸을
    //    잡아도 최소 하나는 물리는데, 오른쪽 끝(9)만 비워 그쪽이 유일한 최소가 되게 한다.
    let packed = desks([1, 2, 3, 4, 5, 6, 7, 8])
    let leastTile = officeDepartmentFeatureTile(zone: zone, furniture: packed)
    let leastCover = coverage(leastTile, packed)
    let bestPossible = (1...(zone.width - 3))
        .map { coverage(TilePoint(x: zone.origin.x + $0, y: row), packed) }
        .min() ?? 0
    t.expectEqual(
        leastCover, bestPossible,
        "다 막히면 겹침이 가장 적은 칸을 고른다 (고른 칸 \(leastTile.x), 겹침 \(leastCover))")

    // 4) **겹침 수가 같으면 선호 칸에 가까운 쪽.** 모든 칸을 똑같이 막아 전부 동률로 만든다 —
    //    이때 자리가 흔들리면 같은 명단인데도 실행마다 콘솔이 옮겨 다닌다.
    let uniform = desks(Array(1...9))
    let tie = officeDepartmentFeatureTile(zone: zone, furniture: uniform)
    let tieCovers = Set(
        (1...(zone.width - 3)).map { coverage(TilePoint(x: zone.origin.x + $0, y: row), uniform) }
    )
    t.expect(tieCovers.count == 1, "동률 검사의 전제: 모든 후보가 같은 겹침 수 \(tieCovers)")
    t.expectEqual(
        tie.x, zone.origin.x + preferred,
        "동률이면 선호 칸이 그대로 뽑힌다")

    // 5) 자리를 비워 주는 쪽과 고르는 쪽이 **같은 칸**을 본다. 따로 세면 한쪽만 바뀐다.
    let reserved = officeDepartmentFeatureReservedDeskLocals(
        zone.department, zoneInnerWidth: zone.width - 1
    )
    t.expectEqual(
        reserved.map(\.x).sorted(), [preferred, preferred + 1],
        "예약 칸은 콘솔이 덮는 두 칸과 같다")
    t.expect(
        reserved.allSatisfy { $0.y == 1 },
        "예약은 책상이 쓰는 아래 줄(y=1) 하나다 — 위 줄 좌석은 콘솔 범위 밖이다")
}

/// 방마다 정원(10명)을 채운 명단. 좌석이 다 차야 가구가 뒤쪽 후보로 밀려, 인원이 적을 때는
/// 안 보이던 충돌이 드러난다.
private func strollReachFullRoster() -> [ConsoleAgent] {
    let departments = Department.allCases
    return (0..<(departments.count * 10)).map { index in
        ConsoleAgent(
            agentType: String(format: "FULL_%02d", index),
            displayName: "정원\(index)",
            slashCommands: [],
            description: "",
            state: .waiting,
            bubble: "",
            department: departments[index % departments.count].rawValue
        )
    }
}
