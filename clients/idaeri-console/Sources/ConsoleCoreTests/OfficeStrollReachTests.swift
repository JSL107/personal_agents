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
                let covered = plan.furniture.filter { placement in
                    placement.kind != .desk
                        && officeCozyDrawnFurnitureKinds.contains(placement.kind)
                        && (placement.tile.x == station.x || placement.tile.x == station.x + 1)
                        && placement.tile.y >= station.y && placement.tile.y <= station.y + 2
                }
                t.expect(
                    covered.isEmpty,
                    "\(label)/\(columns)열: \(zone.department.rawValue) 콘솔(\(station.x),\(station.y))"
                        + " 발밑에 \(covered.map { "\($0.kind.rawValue)@\($0.tile.x),\($0.tile.y)" })"
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
