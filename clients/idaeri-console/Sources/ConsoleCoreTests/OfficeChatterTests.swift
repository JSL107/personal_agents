import Foundation

@testable import ConsoleCore

func runOfficeChatterTests(_ t: TestRunner) {
    t.suite("OfficeChatter")

    // 목적지 대사가 비어 있으면 그 가구로 간 사람만 말없이 걷는다 — 대사를 안 쓴 것과
    // 가구를 새로 추가한 것이 화면에서 똑같이 보이므로 전수로 막는다.
    for kind in FurnitureKind.allCases where kind.interactionPose != nil {
        t.expect(
            officeDestinationChatter(kind: kind) != nil,
            "배회 목적지 가구 \(kind.rawValue) 에 대사가 없다"
        )
    }
    // 반대 방향도 잠근다. 목적지가 아닌 가구에 대사를 달아 두면, 그 가구가 나중에 목적지가
    // 될 때 아무도 다시 읽지 않은 문구가 화면에 나온다.
    for kind in FurnitureKind.allCases where kind.interactionPose == nil {
        t.expect(
            officeDestinationChatter(kind: kind) == nil,
            "목적지가 아닌 가구 \(kind.rawValue) 에 대사가 달렸다"
        )
    }

    // 12자를 넘기면 좌석 몫을 넘어 벽·옆자리로 나간다(그리는 쪽 접기와 함께 두 겹으로 막는다).
    for kind in FurnitureKind.allCases {
        guard let line = officeDestinationChatter(kind: kind) else {
            continue
        }
        t.expect(
            line.count <= officeChatterMaxLength,
            "목적지 대사 \"\(line)\"(\(kind.rawValue)) 가 \(officeChatterMaxLength)자를 넘는다"
        )
    }
    for department in Department.allCases {
        for variant in 0..<12 {
            let line = officeSmallTalk(department: department, variant: variant)
            t.expect(
                !line.isEmpty && line.count <= officeChatterMaxLength,
                "부서 잡담 \"\(line)\"(\(department.rawValue)) 가 상한을 벗어난다"
            )
        }
    }
    for round in 0..<12 {
        let exchange = officeChatterExchange(round: round, seed: round &* 13)
        t.expect(
            exchange.opener.count <= officeChatterMaxLength
                && exchange.reply.count <= officeChatterMaxLength,
            "대화 \"\(exchange.opener)\"/\"\(exchange.reply)\" 가 상한을 벗어난다"
        )
        t.expect(!exchange.opener.isEmpty && !exchange.reply.isEmpty, "대화 한쪽이 비었다")
    }

    // 같은 입력이 같은 문구를 내야 화면이 재현되고, 아래 섞임 검증도 뜻을 갖는다.
    t.expectEqual(
        officeChatter(kind: .coffeeMachine, department: .engineering, agentType: "BE", round: 3),
        officeChatter(kind: .coffeeMachine, department: .engineering, agentType: "BE", round: 3),
        "같은 입력에 다른 문구"
    )
    // 실행마다 시드가 바뀌는 `String.hashValue` 를 쓰면 이 값도 실행마다 달라진다.
    t.expectEqual(
        officeChatterSeed(agentType: "BE", round: 0),
        officeChatterSeed(agentType: "BE", round: 0),
        "씨앗이 실행 안에서 흔들린다"
    )
    t.expect(
        officeChatterSeed(agentType: "BE", round: 0)
            != officeChatterSeed(agentType: "PM", round: 0),
        "사람이 달라도 씨앗이 같다"
    )

    // 감기 구현이 실제로 도는 입력을 넣는다. 겨냥한 값이 테스트에 없으면 그 방어 코드는
    // 있으나 마나이고, 나중에 지워도 초록이 유지된다.
    t.expectEqual(officeChatterIndex(-1, count: 3), 2, "음수 씨앗이 범위를 벗어난다")
    t.expectEqual(officeChatterIndex(-7, count: 5), 3, "음수 씨앗 감기가 틀렸다")
    t.expectEqual(officeChatterIndex(12, count: 0), 0, "빈 배열에서 인덱스가 나온다")
    t.expect(
        !officeSmallTalk(department: .review, variant: Int.min + 1).isEmpty,
        "극단 씨앗에서 잡담이 비었다"
    )

    // 목적지 대사와 잡담이 둘 다 나와야 "섞기" 다. 한쪽으로 굳으면 확률 상수가 죽은 것이다.
    var destinationCount = 0
    var smallTalkCount = 0
    let coffeeLine = officeDestinationChatter(kind: .coffeeMachine)
    for round in 0..<40 {
        let line = officeChatter(
            kind: .coffeeMachine, department: .engineering, agentType: "BE", round: round
        )
        if line == coffeeLine {
            destinationCount += 1
        } else {
            smallTalkCount += 1
        }
    }
    t.expect(destinationCount > 0, "목적지 대사가 한 번도 안 나온다")
    t.expect(smallTalkCount > 0, "부서 잡담이 한 번도 안 나온다")
    t.expect(
        destinationCount > smallTalkCount,
        "목적지 대사가 다수여야 한다 (목적지 \(destinationCount) · 잡담 \(smallTalkCount))"
    )

    // 목적지 대사가 없는 가구에서도 말은 나와야 한다(빈 말풍선 금지).
    t.expect(
        !officeChatter(kind: .desk, department: .planning, agentType: "PM", round: 1).isEmpty,
        "목적지 대사 없는 가구에서 문구가 비었다"
    )

    t.suite("OfficeChatter/상대")

    let arrived = TilePoint(x: 10, y: 10)
    t.expectEqual(
        officeChatterPartner(arrivedAt: arrived, others: [("PM", TilePoint(x: 11, y: 10))]),
        "PM",
        "옆 칸 사람을 상대로 못 찾는다"
    )
    // 대각선도 어깨를 맞댄 것이다 — 체비쇼프 거리 1.
    t.expectEqual(
        officeChatterPartner(arrivedAt: arrived, others: [("PM", TilePoint(x: 11, y: 11))]),
        "PM",
        "대각선 이웃을 놓친다"
    )
    t.expectEqual(
        officeChatterPartner(arrivedAt: arrived, others: [("PM", TilePoint(x: 13, y: 10))]),
        nil,
        "3칸 떨어진 사람이 상대로 잡힌다"
    )
    t.expectEqual(officeChatterPartner(arrivedAt: arrived, others: []), nil, "빈 후보에서 상대가 나온다")
    // 가까운 쪽이 이기고, 거리가 같으면 이름 순 — 딕셔너리 순회 순서에 결과가 흔들리면
    // 같은 배치에서 대화가 붙었다 안 붙었다 한다.
    t.expectEqual(
        officeChatterPartner(
            arrivedAt: arrived,
            others: [("PM", TilePoint(x: 12, y: 10)), ("BE", TilePoint(x: 11, y: 10))]
        ),
        "BE",
        "먼 쪽을 상대로 고른다"
    )
    t.expectEqual(
        officeChatterPartner(
            arrivedAt: arrived,
            others: [("PM", TilePoint(x: 11, y: 10)), ("BE", TilePoint(x: 9, y: 10))]
        ),
        "BE",
        "같은 거리에서 이름 순이 아니다"
    )
}
