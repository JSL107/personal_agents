import Foundation

@testable import ConsoleCore

/// 로봇청소기 상태 판정(순수)의 검증.
///
/// 이 판정이 중요한 이유는 청소기가 장식이 아니라 **신호**이기 때문이다. 멈춰 선 청소기가
/// 곧 "주간 청소 스케줄이 끊겼다" 를 뜻하므로, 정상 회차를 멈춤으로 읽거나 그 반대가 되면
/// 화면이 사실과 다른 말을 하게 된다.
func runOfficeHousekeepingTests(_ t: TestRunner) {
    t.suite("OfficeHousekeeping")

    let now = Date(timeIntervalSince1970: 1_800_000_000)

    t.expectEqual(
        officeVacuumMode(ranAt: nil, now: now), .docked,
        "한 번도 안 돌았으면 충전독 대기"
    )
    t.expectEqual(
        officeVacuumMode(ranAt: now.addingTimeInterval(-3 * 86_400), now: now), .sweeping,
        "주기 안이면 순회"
    )
    t.expectEqual(
        officeVacuumMode(ranAt: now.addingTimeInterval(-9 * 86_400), now: now), .stalled,
        "8일을 넘기면 멈춤(청소가 죽은 신호)"
    )
    // 경계에서 한 칸 어긋나면 정상 회차가 매주 멈춤으로 표시된다.
    t.expectEqual(
        officeVacuumMode(ranAt: now.addingTimeInterval(-8 * 86_400), now: now), .sweeping,
        "8일 정각은 아직 정상"
    )
    // 시계가 어긋나 미래 시각이 와도 거짓 경보를 내지 않는다.
    t.expectEqual(
        officeVacuumMode(ranAt: now.addingTimeInterval(3_600), now: now), .sweeping,
        "미래 시각은 방금 돈 것으로 본다"
    )

    t.expectEqual(officeTrashFillLevel(pendingProjects: 0), 0, "치울 것이 없으면 빈 통")
    t.expectEqual(officeTrashFillLevel(pendingProjects: 2), 2, "쌓인 만큼 차오른다")
    t.expectEqual(
        officeTrashFillLevel(pendingProjects: 9), officeTrashMaxLevel,
        "상한을 넘겨도 3단계까지만"
    )

    // 서버는 toISOString() 이라 밀리초가 붙는다. 기본 파서만 쓰면 조용히 nil 이 되어
    // 정상 동작 중인 청소기가 "한 번도 안 돌았음" 으로 표시된다.
    t.expect(
        officeParseIsoDate("2026-09-09T05:00:00.123Z") != nil,
        "분수초가 붙은 ISO8601 을 파싱한다"
    )
    t.expect(
        officeParseIsoDate("2026-09-09T05:00:00Z") != nil,
        "분수초 없는 ISO8601 도 파싱한다"
    )
    t.expect(officeParseIsoDate(nil) == nil, "nil 은 nil")
    t.expect(officeParseIsoDate("") == nil, "빈 문자열은 nil")
}
