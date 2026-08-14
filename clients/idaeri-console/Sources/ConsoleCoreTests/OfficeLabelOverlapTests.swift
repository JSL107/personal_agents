import Foundation

@testable import ConsoleCore

private func labelBox(
    _ owner: String, _ kind: String, x: Double, y: Double, width: Double = 40, height: Double = 12
) -> OfficeLabelBox {
    OfficeLabelBox(
        owner: owner, kind: kind, text: owner,
        rect: OfficeRect(x: x, y: y, width: width, height: height)
    )
}

func runOfficeLabelOverlapTests(_ t: TestRunner) {
    t.suite("OfficeLabelOverlap")

    // 변이 맞닿기만 한 경우는 겹침이 아니다. 이름표는 나란히 붙어 서는 것이 정상이라,
    // 접촉을 겹침으로 세면 정상 배치가 전부 빨갛게 나와 판정이 무의미해진다.
    t.expect(
        !officeLabelBoxesOverlap(
            OfficeRect(x: 0, y: 0, width: 10, height: 10),
            OfficeRect(x: 10, y: 0, width: 10, height: 10)
        ),
        "변이 맞닿은 두 상자는 겹침이 아니다"
    )
    t.expect(
        officeLabelBoxesOverlap(
            OfficeRect(x: 0, y: 0, width: 10, height: 10),
            OfficeRect(x: 9, y: 0, width: 10, height: 10)
        ),
        "1pt 라도 파고들면 겹침이다"
    )

    // 이웃한 두 사람의 이름표가 가로로 겹치는 경우 — 좌석이 좁을 때 실제로 나던 회귀.
    let neighbours = [
        labelBox("PM", "name", x: 0, y: 0),
        labelBox("CTO", "name", x: 30, y: 0),
    ]
    let neighbourPairs = officeOverlappingLabelPairs(neighbours)
    t.expectEqual(neighbourPairs.count, 1, "겹치는 이웃 이름표 한 쌍을 찾는다")
    t.expectEqual(
        officeOverlappingLabelKeys(neighbours), ["PM/name", "CTO/name"],
        "겹친 상자는 주인/종류 키로 지목된다"
    )

    // 같은 사람의 문패와 말풍선이 겹치는 경우. 주인이 같다고 건너뛰면 이 회귀를 놓친다.
    let selfStack = [
        labelBox("BE", "name", x: 0, y: 0, height: 12),
        labelBox("BE", "infoBubble", x: 0, y: 8, height: 12),
    ]
    t.expectEqual(
        officeOverlappingLabelPairs(selfStack).count, 1,
        "같은 주인의 문패와 말풍선이 겹쳐도 잡는다"
    )

    // 떨어져 있으면 아무것도 나오지 않아야 한다 — 정상 배치에서 빨간 상자가 뜨면
    // 사람이 판정을 신뢰하지 않게 되어 이 기능 자체가 쓸모없어진다.
    let apart = [
        labelBox("PM", "name", x: 0, y: 0),
        labelBox("CTO", "name", x: 100, y: 0),
        labelBox("BE", "name", x: 200, y: 0),
    ]
    t.expect(officeOverlappingLabelPairs(apart).isEmpty, "떨어진 이름표는 겹침 0건")
    t.expect(officeOverlappingLabelKeys(apart).isEmpty, "겹침이 없으면 지목되는 키도 없다")

    // 상자가 0~1개면 비교 대상이 없다(빈 배열에서 인덱스가 도는 실수를 막는다).
    t.expect(officeOverlappingLabelPairs([]).isEmpty, "상자 0개면 겹침 0건")
    t.expect(
        officeOverlappingLabelPairs([labelBox("PM", "name", x: 0, y: 0)]).isEmpty,
        "상자 1개면 겹침 0건"
    )

    // 세 상자가 한 자리에 몰리면 쌍은 3개(3C2) — 한 쌍만 세고 멈추지 않는지 확인.
    let pile = [
        labelBox("PM", "name", x: 0, y: 0),
        labelBox("CTO", "name", x: 2, y: 0),
        labelBox("BE", "name", x: 4, y: 0),
    ]
    t.expectEqual(officeOverlappingLabelPairs(pile).count, 3, "세 상자가 몰리면 쌍은 3개")
}
