import Foundation

@testable import ConsoleCore

/// 오피스 배치·노드 diff·상태 색 팔레트(순수 계산)의 검증.
func runOfficeLayoutTests(_ t: TestRunner) {
    t.suite("OfficeLayout")

    // count 개수만큼 좌표 반환
    let points = officeLayout(count: 26, width: 900, height: 600, columns: 5)
    t.expectEqual(points.count, 26, "좌표 개수 == count")

    // 모든 좌표가 씬 경계 안(0 < x < width, 0 < y < height)
    let allInside = points.allSatisfy { $0.x > 0 && $0.x < 900 && $0.y > 0 && $0.y < 600 }
    t.expect(allInside, "모든 좌표가 경계 안")

    // 첫 행 좌표는 서로 x 가 다름(격자 열 분리)
    let firstRowX = Set(points.prefix(5).map { $0.x })
    t.expectEqual(firstRowX.count, 5, "첫 행 5개 열이 서로 다른 x")

    // count 0 이면 빈 배열
    t.expectEqual(officeLayout(count: 0, width: 900, height: 600, columns: 5).count, 0, "count 0 → 빈 배열")

    // columns 가 count 보다 크면 한 행에 count 개(같은 y)
    let few = officeLayout(count: 3, width: 900, height: 600, columns: 5)
    let sameRowY = Set(few.map { $0.y })
    t.expectEqual(sameRowY.count, 1, "count < columns 이면 한 행")

    // diff: 신규 추가, 사라진 것 제거, 공통 유지
    let diff = officeNodeDiff(existing: ["PM", "BE"], incoming: ["BE", "CTO"])
    t.expectEqual(diff.added, ["CTO"], "신규는 added")
    t.expectEqual(diff.removed, ["PM"], "사라진 건 removed")

    // 변화 없으면 빈 diff
    let noChange = officeNodeDiff(existing: ["PM"], incoming: ["PM"])
    t.expect(noChange.added.isEmpty && noChange.removed.isEmpty, "변화 없으면 빈 diff")

    // 팔레트: 상태 5종 모두 0~1 범위 RGB, 서로 다른 색
    var seenColors = Set<String>()
    for state in [ConsoleAgentState.completed, .inProgress, .awaitingApproval, .awaitingIntegration, .waiting] {
        let rgb = agentStatePaletteRGBA(state)
        let inRange = (0...1).contains(rgb.red) && (0...1).contains(rgb.green) && (0...1).contains(rgb.blue)
        t.expect(inRange, "\(state) RGB 는 0~1 범위")
        seenColors.insert("\(rgb.red),\(rgb.green),\(rgb.blue)")
    }
    t.expectEqual(seenColors.count, 5, "5종 색이 서로 다름")

    // 밴드 반영: 격자 좌표는 모두 밴드 아래(height - bandHeight) 영역 안
    let banded = officeLayout(count: 26, width: 900, height: 600, columns: 5, bandHeight: 120)
    t.expectEqual(banded.count, 26, "밴드 반영해도 좌표 개수 == count")
    t.expect(banded.allSatisfy { $0.y < 600 - 120 }, "모든 격자 좌표가 밴드 아래")

    // bandHeight 기본값 0 이면 기존 동작과 동일(회귀 방지)
    let plain = officeLayout(count: 26, width: 900, height: 600, columns: 5)
    let plainBand0 = officeLayout(count: 26, width: 900, height: 600, columns: 5, bandHeight: 0)
    t.expectEqual(plain, plainBand0, "bandHeight 0 == 무인자 호출")

    // 대표실 밴드 슬롯: N개가 밴드 안(y 동일, x 서로 다름)
    let slots = (0..<3).map { presidentBandSlot(order: $0, count: 3, width: 900, height: 600, bandHeight: 120) }
    t.expect(slots.allSatisfy { $0.y > 600 - 120 && $0.y < 600 }, "밴드 슬롯 y 는 밴드 영역 안")
    t.expectEqual(Set(slots.map { $0.x }).count, 3, "밴드 슬롯 x 는 서로 다름")
}
