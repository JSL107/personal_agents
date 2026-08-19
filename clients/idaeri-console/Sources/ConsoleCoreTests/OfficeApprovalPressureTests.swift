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

    // MARK: - officeApprovalPressureUpdates (씬의 diff·정리 로직)

    let iso: (String) -> String = { "2026-08-19T\($0)Z" }
    // 15분 경과. TTL 1시간 카드는 25% 소진(서류 — holdingPapers 임계값에 정확히 걸침),
    // TTL 24시간 카드는 1% 소진(1단계) — 같은 경과 시간이 서로 다른 단계를 내야 한다
    // (officeApprovalPressure 자체의 회귀 방지와 같은 취지를 diff 레이어에서도 확인한다).
    let shortTtlApproval = ConsoleApproval(
        id: "short", agentType: "CTO", title: "PR",
        createdAt: iso("00:00:00"), expiresAt: iso("01:00:00")
    )
    let longTtlApproval = ConsoleApproval(
        id: "long", agentType: "PM", title: "PR",
        createdAt: iso("00:00:00"), expiresAt: iso("00:00:00").replacingOccurrences(of: "08-19", with: "08-20")
    )
    let now15MinLater = ISO8601DateFormatter().date(from: iso("00:15:00"))!.timeIntervalSince1970

    let firstSweep = officeApprovalPressureUpdates(
        now: now15MinLater,
        approvals: [shortTtlApproval, longTtlApproval],
        nodesPresent: ["CTO", "PM"],
        previouslyApplied: [:]
    )
    t.expectEqual(
        firstSweep.changes.first(where: { $0.agentType == "CTO" })?.pressure,
        .holdingPapers,
        "TTL 1시간 카드는 15분(25% 소진)에서 서류를 든다"
    )
    t.expectEqual(
        firstSweep.changes.first(where: { $0.agentType == "PM" })?.pressure,
        .queued,
        "같은 15분이라도 TTL 24시간 카드는 아직 1단계"
    )
    t.expectEqual(
        firstSweep.nextApplied, ["CTO": .holdingPapers, "PM": .queued],
        "이번에 적용한 단계가 다음 비교 기준으로 남는다"
    )

    // 같은 시각·같은 승인 목록으로 다시 스윕 — 단계가 안 바뀌었으니 changes 는 비어야 한다.
    // 폴링마다 다시 걸면 자세가 매번 처음부터 재생돼 줄 전체가 깜빡인다(브리핑의 핵심 요구).
    let secondSweep = officeApprovalPressureUpdates(
        now: now15MinLater,
        approvals: [shortTtlApproval, longTtlApproval],
        nodesPresent: ["CTO", "PM"],
        previouslyApplied: firstSweep.nextApplied
    )
    t.expect(secondSweep.changes.isEmpty, "단계가 그대로면 변경 목록이 비어야 한다(깜빡임 방지)")
    t.expectEqual(secondSweep.nextApplied, firstSweep.nextApplied, "미변경 스윕은 기록도 그대로")

    // CTO 가 줄에서 빠짐(승인 처리 완료) — 기록도 함께 지워져야 한다. 남겨 두면 CTO 가
    // 나중에 새 승인으로 다시 줄에 섰을 때 단계가 이미 올라간 것으로 읽혀 1단계를 건너뛴다.
    let afterDeparture = officeApprovalPressureUpdates(
        now: now15MinLater,
        approvals: [longTtlApproval],
        nodesPresent: ["PM"],
        previouslyApplied: firstSweep.nextApplied
    )
    t.expectEqual(
        afterDeparture.nextApplied, ["PM": .queued],
        "줄에서 빠진 CTO 의 기록은 지워지고 PM 기록만 남는다"
    )

    // 시각 파싱 실패 — "안 급함" 으로 읽으면 안 되므로 최고 단계(.alarm)로 떨어뜨리고,
    // 원인 추적을 위해 parseFailed 플래그를 별도로 알린다.
    let brokenApproval = ConsoleApproval(
        id: "broken", agentType: "BE", title: "PR",
        createdAt: "t+1h", expiresAt: "later"
    )
    let brokenSweep = officeApprovalPressureUpdates(
        now: now15MinLater,
        approvals: [brokenApproval],
        nodesPresent: ["BE"],
        previouslyApplied: [:]
    )
    t.expectEqual(
        brokenSweep.changes.first?.pressure, .alarm,
        "시각 파싱 실패는 조용히 차분함이 아니라 최고 단계로 읽는다"
    )
    t.expectEqual(brokenSweep.changes.first?.parseFailed, true, "파싱 실패는 별도로 표시된다")

    // 노드가 아직 없는 agentType 은 건너뛴다 — 자세를 걸 대상 자체가 없다.
    let noNodeSweep = officeApprovalPressureUpdates(
        now: now15MinLater,
        approvals: [shortTtlApproval],
        nodesPresent: [],
        previouslyApplied: [:]
    )
    t.expect(noNodeSweep.changes.isEmpty, "화면에 노드가 없는 사람은 건너뛴다")
    t.expect(noNodeSweep.nextApplied.isEmpty, "건너뛴 사람은 기록도 남기지 않는다")

    // 승인은 여전히 대기 중이지만 노드가 사라진 경우 — 오래된 단계 기록은 지워져야 한다.
    // 노드가 제거된 상태에서 같은 사람이 다시 줄에 서면, 처음부터 1단계를 거쳐야 한다.
    // 남겨 두면 오래된 이상 높은 단계가 남아 새 노드가 1단계를 건너뛴다.
    let approvalWithoutNode = officeApprovalPressureUpdates(
        now: now15MinLater,
        approvals: [shortTtlApproval],
        nodesPresent: [],
        previouslyApplied: ["CTO": .holdingPapers]
    )
    t.expect(
        approvalWithoutNode.changes.isEmpty,
        "노드가 없으면 새 변경은 발생하지 않는다(자세를 걸 대상이 없음)"
    )
    t.expectEqual(
        approvalWithoutNode.nextApplied, [:],
        "노드가 없어졌으면 오래된 단계 기록은 지워진다"
    )

    // MARK: - 배열 순서 무관성(order independence)

    // 한 에이전트가 여러 카드를 들고 있을 때 — 배열 순서와 무관하게
    // 가장 높은 압력이 선택되어야 한다.
    // BE_SANDBOX_APPLY + BE_SANDBOX_PUSH_PR 는 모두 BE 로 매핑되는 실제 사례.
    let cardLowPressure = ConsoleApproval(
        id: "be-low", agentType: "BE", title: "Low Pressure Card",
        createdAt: iso("00:00:00"), expiresAt: iso("01:00:00")
    )
    // 15분 경과: TTL 1시간, 25% 소진 → holdingPapers

    let cardHighPressure2 = ConsoleApproval(
        id: "be-alarm", agentType: "BE", title: "Broken Card",
        createdAt: "invalid-time", expiresAt: "also-invalid"
    )

    // 시나리오: BE 가 두 카드를 들고 있다.
    // - cardLowPressure: 25% 소진 → holdingPapers
    // - cardHighPressure2: 파싱 실패 → alarm (더 높음)
    // 기대: alarm 을 선택
    let multiCardSweep = officeApprovalPressureUpdates(
        now: now15MinLater,
        approvals: [cardLowPressure, cardHighPressure2],
        nodesPresent: ["BE"],
        previouslyApplied: [:]
    )
    t.expectEqual(
        multiCardSweep.changes.first(where: { $0.agentType == "BE" })?.pressure,
        .alarm,
        "한 에이전트의 여러 카드 중 최고 압력 카드가 선택된다"
    )
    t.expectEqual(
        multiCardSweep.changes.first(where: { $0.agentType == "BE" })?.parseFailed,
        true,
        "선택된 카드의 parseFailed 플래그가 함께 전달된다"
    )

    // 역순 배열 — 같은 카드, 다른 순서
    let multiCardSweepReversed = officeApprovalPressureUpdates(
        now: now15MinLater,
        approvals: [cardHighPressure2, cardLowPressure],  // 순서 반대
        nodesPresent: ["BE"],
        previouslyApplied: [:]
    )
    t.expectEqual(
        multiCardSweepReversed.changes.first(where: { $0.agentType == "BE" })?.pressure,
        .alarm,
        "배열 순서를 반대로 해도 같은 최고 압력이 선택된다 (order-independence)"
    )
    t.expectEqual(
        multiCardSweepReversed.changes.first(where: { $0.agentType == "BE" })?.parseFailed,
        true,
        "역순 배열에서도 parseFailed 플래그는 일치한다"
    )

    // 파싱 실패 카드가 낮은 압력 카드 옆에 있을 때
    let mixedValidInvalid = officeApprovalPressureUpdates(
        now: now15MinLater,
        approvals: [
            cardLowPressure,        // valid, 25% 소진 → holdingPapers
            cardHighPressure2       // invalid → alarm
        ],
        nodesPresent: ["BE"],
        previouslyApplied: [:]
    )
    t.expectEqual(
        mixedValidInvalid.changes.first(where: { $0.agentType == "BE" })?.pressure,
        .alarm,
        "유효한 카드와 파싱 실패 카드가 섞여 있을 때, alarm(가장 높음)이 선택된다"
    )
}
