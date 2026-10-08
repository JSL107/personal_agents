import Foundation

@testable import ConsoleCore

/// 2026-10-08 실제 `GET /v1/console/ledger` 응답에서 뽑은 행. CTO 는 09-04 폐지돼 레지스트리에
/// 없지만 옛 크론 기록 때문에 정지로 온다. `company` 는 앱이 쓰지 않으므로 무시돼야 한다.
private let realLedgerResponse = """
{"code":"SUCCESS","message":"요청이 성공적으로 처리되었습니다.","data":{"agents":[
{"agentType":"WORK_REVIEWER","firstRunDate":"2026-06-23","totalRuns":174,"failedRuns":14,"lastRunAt":"2026-10-08T00:17:13.703Z","autonomy":"AUTONOMOUS","stalled":false,"idleDays":0,"autonomyIdleDays":1},
{"agentType":"CTO","firstRunDate":"2026-07-01","totalRuns":26,"failedRuns":0,"lastRunAt":"2026-09-06T04:00:00.108Z","autonomy":"AUTONOMOUS","stalled":true,"idleDays":32,"autonomyIdleDays":32},
{"agentType":"BLOG","firstRunDate":"2026-06-25","totalRuns":7,"failedRuns":0,"lastRunAt":"2026-06-25T05:21:27.356Z","autonomy":"ON_DEMAND","stalled":false,"idleDays":105,"autonomyIdleDays":null},
{"agentType":"DOCS_AUDIT_EVALUATOR","firstRunDate":null,"totalRuns":0,"failedRuns":0,"lastRunAt":null,"autonomy":"NEVER_RUN","stalled":false,"idleDays":null,"autonomyIdleDays":null}
],"company":{"foundedDate":"2026-06-23","ageDays":108,"totalRuns":7595,"failedRuns":270,"thisWeekRuns":460,"lastWeekRunsToSameWeekday":1792},"serverTime":"2026-10-08T01:44:27.357Z"}}
"""

private func makeLedgerAgent(_ type: String, _ state: ConsoleAgentState) -> ConsoleAgent {
    ConsoleAgent(agentType: type, displayName: type, slashCommands: [], description: "", state: state, bubble: "")
}

private func makeEntry(
    _ type: String, stalled: Bool = false, total: Int = 10, failed: Int = 0,
    idle: Int? = 0, autonomyIdle: Int? = nil, first: String? = "2026-10-01"
) -> ConsoleAgentLedger {
    ConsoleAgentLedger(
        agentType: type, firstRunDate: first, totalRuns: total, failedRuns: failed,
        lastRunAt: nil, autonomy: stalled ? "AUTONOMOUS" : "ON_DEMAND", stalled: stalled,
        idleDays: idle, autonomyIdleDays: autonomyIdle
    )
}

func runAgentLedgerTests(_ t: TestRunner) {
    t.suite("AgentLedger")

    // MARK: 디코딩 — 실제 응답

    let decoded = try? decodeLedgerResponse(Data(realLedgerResponse.utf8))
    t.expectEqual(decoded?.agents.count, 4, "실제 응답의 담당자 행을 모두 읽어야 한다")
    t.expectEqual(decoded?.serverTime, "2026-10-08T01:44:27.357Z", "서버 시각")
    t.expectEqual(decoded?.entry(for: "CTO")?.stalled, true, "CTO 정지 값을 그대로 읽는다")
    let neverRun = decoded?.entry(for: "DOCS_AUDIT_EVALUATOR")
    t.expectEqual(neverRun?.autonomy, "NEVER_RUN", "NEVER_RUN 분류")
    t.expectNil(neverRun?.firstRunDate, "기록 없는 행의 null 필드")
    t.expectThrows("필수 필드가 빠지면 던져야 한다 — 호출부가 nil 로 접고 화면은 그대로 산다") {
        _ = try decodeLedgerResponse(Data("{\"data\":{}}".utf8))
    }

    // MARK: 정지 집합 — 명단 교차

    let roster = [
        makeLedgerAgent("WORK_REVIEWER", .waiting),
        makeLedgerAgent("PM", .inProgress),
        makeLedgerAgent("OPS_SUPERVISOR", .completed),
    ]
    let ledger = ConsoleLedger(
        agents: [
            makeEntry("CTO", stalled: true, autonomyIdle: 32),
            makeEntry("PM", stalled: true, autonomyIdle: 9),
            makeEntry("OPS_SUPERVISOR", stalled: true, autonomyIdle: 19),
            makeEntry("WORK_REVIEWER"),
        ],
        serverTime: "2026-10-08T01:44:27.357Z"
    )
    let stalled = officeStalledAgentTypes(ledger: ledger, roster: roster)
    t.expectEqual(stalled, ["OPS_SUPERVISOR"], "명단 밖(CTO)과 일하는 중(PM)은 빼야 한다 (실제: \(stalled))")
    t.expectEqual(officeStalledAgentTypes(ledger: nil, roster: roster), [], "원장이 없으면 정지 표시도 없다")
    if let decoded {
        t.expectEqual(
            officeStalledAgentTypes(ledger: decoded, roster: roster), [],
            "실제 응답에서 정지는 폐지된 CTO 하나뿐이라 화면에는 아무도 정지로 뜨지 않아야 한다"
        )
    }

    // MARK: 인스펙터 이력 두 줄

    if let decoded {
        let lines = agentLedgerLines(decoded.entry(for: "WORK_REVIEWER"), serverTime: decoded.serverTime)
        t.expectEqual(
            lines, ["근속 108일 · 누적 174건 · 실패 14", "최근 실행 오늘"],
            "실제 응답의 근속은 회사 ageDays(108)와 같은 셈법이어야 한다 (실제: \(lines))"
        )
        t.expectEqual(
            agentLedgerLines(decoded.entry(for: "DOCS_AUDIT_EVALUATOR"), serverTime: decoded.serverTime),
            ["원장에 실행 기록 없음"],
            "기록 없는 사람에게 '한 번도 안 했다' 고 쓰지 않는다"
        )
        t.expectEqual(
            agentLedgerLines(decoded.entry(for: "CTO"), serverTime: decoded.serverTime).last,
            "자율 실행 32일째 멈춤", "정지면 둘째 줄이 멈춘 날수"
        )
    }
    t.expectEqual(agentLedgerLines(nil, serverTime: "2026-10-08T01:44:27.357Z"), [], "원장에 없으면 줄이 없다")
    t.expectEqual(
        agentLedgerLines(makeEntry("A", idle: 1), serverTime: "2026-10-08T01:44:27.357Z").last,
        "최근 실행 어제", "하루 전은 어제"
    )
    t.expectEqual(
        agentLedgerLines(makeEntry("A", idle: 5), serverTime: "2026-10-08T01:44:27.357Z").last,
        "최근 실행 5일 전", "이틀 이상은 N일 전"
    )
    // KST 자정 직후(UTC 로는 전날 15:30)에도 오늘은 KST 날짜다. UTC 로 세면 하루 모자란다.
    t.expectEqual(
        agentLedgerLines(makeEntry("A", first: "2026-10-08"), serverTime: "2026-10-07T15:30:00.000Z").first,
        "근속 1일 · 누적 10건", "첫날은 1일차 — KST 기준"
    )
    t.expectEqual(
        agentLedgerLines(makeEntry("A", first: "bad"), serverTime: "2026-10-08T01:44:27.357Z").first,
        "누적 10건", "날짜를 못 읽으면 근속만 뺀다"
    )

    // MARK: 대시보드 주의 순서

    let agents = [
        makeLedgerAgent("WAIT", .waiting),
        makeLedgerAgent("DONE", .completed),
        makeLedgerAgent("STALL", .waiting),
        makeLedgerAgent("LINK", .awaitingIntegration),
        makeLedgerAgent("FAIL", .failed),
        makeLedgerAgent("RUN", .inProgress),
    ]
    let order = dashboardAttentionOrder(agents: agents, stalledAgentTypes: ["STALL"]).map(\.agentType)
    t.expectEqual(
        order, ["RUN", "FAIL", "STALL", "LINK", "DONE", "WAIT"],
        "정지는 실패 다음, 연동 대기 앞 (실제: \(order))"
    )
    t.expectEqual(
        dashboardAttentionOrder(agents: agents, stalledAgentTypes: []).map(\.agentType),
        ["RUN", "FAIL", "LINK", "DONE", "WAIT", "STALL"],
        "정지가 없으면 기존 순서 그대로(같은 순위는 입력 순서)"
    )

    t.expectEqual(agentStallFootnote(makeEntry("A", stalled: true, autonomyIdle: 7)), "자율 실행 7일째 멈춤", "각주")
    t.expectNil(agentStallFootnote(makeEntry("A")), "정지가 아니면 각주 없음")
}
