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

    // 대표실 문패 접힘 — 세션 이름표가 밴드를 덮는 동안만 접는다.
    t.expect(
        !officeHidesPresidentPlate(sessionCount: 0),
        "세션이 없으면 대표실 문패를 그린다"
    )
    t.expect(
        officeHidesPresidentPlate(sessionCount: 1),
        "세션이 하나라도 있으면 대표실 문패를 접는다"
    )

    // 다시 그릴 회차 판정. **양방향**이어야 한다 — 켜지는 쪽만 맞으면 마지막 세션이 떠난
    // 뒤에 문패가 영영 돌아오지 않는다. `> 0` 을 `> 1` 로 깨뜨리면 아래 첫 두 줄이 잡힌다.
    t.expect(
        officeNeedsPlateRedraw(previousSessionCount: 0, currentSessionCount: 3),
        "세션이 생긴 회차에는 문패를 다시 그린다"
    )
    t.expect(
        officeNeedsPlateRedraw(previousSessionCount: 3, currentSessionCount: 0),
        "마지막 세션이 떠난 회차에는 문패를 다시 그린다"
    )
    t.expect(
        !officeNeedsPlateRedraw(previousSessionCount: 0, currentSessionCount: 0),
        "세션이 계속 없으면 다시 그리지 않는다"
    )
    t.expect(
        !officeNeedsPlateRedraw(previousSessionCount: 3, currentSessionCount: 5),
        "세션 수만 달라지면(둘 다 있음) 다시 그리지 않는다"
    )

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
        officeOverlappingLabelIndexes(neighbours), [0, 1],
        "겹친 상자는 자리 번호로 지목된다"
    )

    // 이름이 같은 상자가 여럿 있어도, 겹치지 않은 것은 칠해지지 않아야 한다.
    // 세션 이름표는 주인·종류가 전부 `scene/sessionName` 로 같아서, 이름으로 고르면
    // 하나가 겹칠 때 나머지까지 번져 정상 배치를 결함으로 보이게 만든다.
    let sameName = [
        labelBox("scene", "sessionName", x: 0, y: 0),
        labelBox("scene", "sessionName", x: 20, y: 0),
        labelBox("scene", "sessionName", x: 500, y: 0),
    ]
    t.expectEqual(
        officeOverlappingLabelIndexes(sameName), [0, 1],
        "이름이 같아도 떨어져 있는 셋째는 지목되지 않는다"
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
    t.expect(officeOverlappingLabelIndexes(apart).isEmpty, "겹침이 없으면 지목되는 상자도 없다")

    // 상자가 0~1개면 비교 대상이 없다(빈 배열에서 인덱스가 도는 실수를 막는다).
    t.expect(officeOverlappingLabelPairs([]).isEmpty, "상자 0개면 겹침 0건")
    t.expect(
        officeOverlappingLabelPairs([labelBox("PM", "name", x: 0, y: 0)]).isEmpty,
        "상자 1개면 겹침 0건"
    )

    // 글자 고르기 — 사람 이름표는 속성 문자열로만 그려진다. 이 경로가 빠져서 확인 대상
    // 20개가 통째로 누락됐고, 남은 11개로 "겹침 없음" 이 나와 고장이 정상으로 보고됐다.
    t.expectEqual(
        officeLabelText(plain: nil, attributed: "PM"), "PM",
        "일반 텍스트가 없으면 속성 문자열을 쓴다"
    )
    t.expectEqual(
        officeLabelText(plain: "", attributed: "PM"), "PM",
        "일반 텍스트가 빈 문자열이어도 속성 문자열을 쓴다"
    )
    t.expectEqual(
        officeLabelText(plain: "PM", attributed: nil), "PM",
        "일반 텍스트가 있으면 그것을 쓴다"
    )
    t.expectEqual(
        officeLabelText(plain: "보임", attributed: "숨김"), "보임",
        "둘 다 있으면 일반 텍스트가 이긴다"
    )
    t.expectNil(officeLabelText(plain: nil, attributed: nil), "둘 다 없으면 글자가 없다")
    t.expectNil(officeLabelText(plain: "", attributed: ""), "둘 다 비면 글자가 없다")

    // 세 상자가 한 자리에 몰리면 쌍은 3개(3C2) — 한 쌍만 세고 멈추지 않는지 확인.
    let pile = [
        labelBox("PM", "name", x: 0, y: 0),
        labelBox("CTO", "name", x: 2, y: 0),
        labelBox("BE", "name", x: 4, y: 0),
    ]
    t.expectEqual(officeOverlappingLabelPairs(pile).count, 3, "세 상자가 몰리면 쌍은 3개")
}
