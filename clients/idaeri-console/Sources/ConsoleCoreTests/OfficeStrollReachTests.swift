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
    }
}
