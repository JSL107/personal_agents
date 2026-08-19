import Foundation

@testable import ConsoleCore

func runOfficeApprovalPressureTests(_ t: TestRunner) {
    t.suite("OfficeApprovalPressure")

    let hour: TimeInterval = 3600

    // TTL 1시간 카드. 30분 경과 = 50% 소진.
    let shortLived: (TimeInterval) -> OfficeApprovalPressure = { elapsed in
        officeApprovalPressure(now: elapsed, createdAt: 0, expiresAt: hour)
    }
    t.expectEqual(shortLived(0), .queued, "방금 뜬 카드는 줄만 선다")
    t.expectEqual(shortLived(hour * 0.20), .queued, "20% 소진은 아직 1단계")
    t.expectEqual(shortLived(hour * 0.30), .holdingPapers, "30% 소진에서 서류를 든다")
    t.expectEqual(shortLived(hour * 0.60), .tapping, "60% 소진에서 발을 구른다")
    t.expectEqual(shortLived(hour * 0.90), .alarm, "90% 소진에서 경고등")

    // 같은 경과 시간이라도 TTL 이 길면 단계가 낮아야 한다. 절대 시간으로 판정하면
    // TTL 1시간 카드가 이미 만료된 뒤에 경고등이 켜진다 — 이 테스트가 그 회귀를 잡는다.
    let longLived: (TimeInterval) -> OfficeApprovalPressure = { elapsed in
        officeApprovalPressure(now: elapsed, createdAt: 0, expiresAt: hour * 24)
    }
    t.expectEqual(longLived(hour * 0.90), .queued, "TTL 24시간 카드의 54분은 아직 1단계")
    t.expectEqual(longLived(hour * 20), .alarm, "TTL 24시간 카드도 83% 소진이면 경고등")

    // 만료를 이미 지난 카드. 스냅샷과 만료 스윕 사이에 틈이 있어 실제로 들어올 수 있다.
    t.expectEqual(shortLived(hour * 2), .alarm, "만료를 지난 카드는 최고 단계")

    // 0 또는 음수 구간 방어. expiresAt <= createdAt 이면 비율을 계산할 수 없다.
    t.expectEqual(
        officeApprovalPressure(now: 10, createdAt: 100, expiresAt: 100),
        .alarm,
        "유효 구간이 0 이면 경고등으로 떨어진다"
    )
    t.expectEqual(
        officeApprovalPressure(now: 0, createdAt: 100, expiresAt: 50),
        .alarm,
        "만료가 생성보다 이르면 경고등"
    )

    // 생성 시각보다 이른 now(시계 어긋남). 음수 비율을 1단계로 접는다.
    t.expectEqual(
        officeApprovalPressure(now: 0, createdAt: 100, expiresAt: 200),
        .queued,
        "생성 전 시각은 1단계로 접는다"
    )
}
