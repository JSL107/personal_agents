import Foundation

/// `GET /v1/console/ledger` 의 담당자 한 명 이력. 정지 판정(`stalled`)은 백엔드가 한다
/// (`src/console/domain/stall.ts`) — 주기 추정에 원장 전량이 필요해 앱이 다시 계산할 수 없다.
///
/// 회사 합계(`company`)는 받지 않는다. 그것을 쓰던 「회사 성적 한 줄」은 폐기됐고
/// (`2026-10-08-office-gamification-disposition.md` §2), 모르는 키는 디코더가 버린다.
public struct ConsoleAgentLedger: Codable, Equatable, Sendable {
    public let agentType: String
    /// 첫 실행 KST 날짜(YYYY-MM-DD). 실행 기록이 없으면 nil.
    public let firstRunDate: String?
    public let totalRuns: Int
    public let failedRuns: Int
    public let lastRunAt: String?
    /// `AUTONOMOUS` · `ON_DEMAND` · `EVENT_DRIVEN` · `NEVER_RUN`. 서버가 값을 늘려도 해석이
    /// 깨지지 않게 문자열로 받는다 — 해석이 실패하면 이력 전체가 사라진다.
    public let autonomy: String
    public let stalled: Bool
    public let idleDays: Int?
    public let autonomyIdleDays: Int?

    public init(
        agentType: String, firstRunDate: String?, totalRuns: Int, failedRuns: Int,
        lastRunAt: String?, autonomy: String, stalled: Bool, idleDays: Int?, autonomyIdleDays: Int?
    ) {
        self.agentType = agentType
        self.firstRunDate = firstRunDate
        self.totalRuns = totalRuns
        self.failedRuns = failedRuns
        self.lastRunAt = lastRunAt
        self.autonomy = autonomy
        self.stalled = stalled
        self.idleDays = idleDays
        self.autonomyIdleDays = autonomyIdleDays
    }
}

public struct ConsoleLedger: Codable, Equatable, Sendable {
    public let agents: [ConsoleAgentLedger]
    public let serverTime: String

    public init(agents: [ConsoleAgentLedger], serverTime: String) {
        self.agents = agents
        self.serverTime = serverTime
    }

    public func entry(for agentType: String) -> ConsoleAgentLedger? {
        agents.first { $0.agentType == agentType }
    }
}

private struct LedgerEnvelope: Decodable {
    let data: ConsoleLedger
}

/// REST 봉투(`{code,message,data}`)에서 원장을 꺼낸다. 네트워크 없이 실제 응답으로 검증하려고
/// 클라이언트 밖에 둔다.
public func decodeLedgerResponse(_ data: Data) throws -> ConsoleLedger {
    try JSONDecoder().decode(LedgerEnvelope.self, from: data).data
}

/// 화면에 정지로 표시할 담당자.
///
/// **지금 명단(snapshot)에 있는 사람만 남긴다.** 원장은 레지스트리 밖의 agentType 도 실행 기록이
/// 있으면 내보낸다. 2026-10-08 실측에서 09-04 폐지된 `CTO` 가 옛 크론 기록 때문에 `stalled=true`
/// (32일)로 왔다 — 그대로 올리면 대시보드의 유일한 정지 담당자가 없는 사람이 된다.
///
/// 지금 일하는 중인 사람도 뺀다. 원장은 10분 간격으로 받으므로 멈췄던 워커가 다시 돌기
/// 시작한 직후에는 원장이 낡아 있다 — 눈앞의 실행이 더 정확한 사실이다.
///
/// "일하는 중" 을 상태값(`inProgress`)만으로 보지 않는다. 열린 승인이 있으면 상태는
/// `awaitingApproval` 로 묶여 새 런의 `inProgress` 전이가 숨는다(`ConsoleStore.changeAgentState`,
/// 백엔드 `deriveAgentState` 도 승인을 우선). 그래서 미종료 런(`finishedAt == nil`)도 함께 본다 —
/// 스토어의 `hasActiveRun` 과 같은 기준이다.
public func officeStalledAgentTypes(
    ledger: ConsoleLedger?, roster: [ConsoleAgent], runs: [ConsoleRun]
) -> Set<String> {
    guard let ledger else {
        return []
    }
    let running = Set(runs.filter { $0.finishedAt == nil }.map(\.agentType))
    let candidates = Set(
        roster.filter { $0.state != .inProgress && !running.contains($0.agentType) }.map(\.agentType)
    )
    return Set(ledger.agents.filter { $0.stalled && candidates.contains($0.agentType) }.map(\.agentType))
}

private let kstTimeZone = TimeZone(identifier: "Asia/Seoul")!

private func kstCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = kstTimeZone
    return calendar
}

private func parseISO8601(_ text: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: text) {
        return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: text)
}

/// 첫 실행일을 1일차로 센 근속 일수. 오늘은 서버 시각의 KST 날짜다 — 앱 시계를 쓰면
/// 백엔드가 계산한 `idleDays` 와 기준일이 어긋날 수 있다.
func ledgerTenureDays(firstRunDate: String, serverTime: String) -> Int? {
    let calendar = kstCalendar()
    let parts = firstRunDate.split(separator: "-").compactMap { Int($0) }
    guard
        parts.count == 3,
        let first = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])),
        let now = parseISO8601(serverTime),
        let days = calendar.dateComponents([.day], from: first, to: calendar.startOfDay(for: now)).day,
        days >= 0
    else {
        return nil
    }
    return days + 1
}

private func relativeDayLabel(_ days: Int) -> String {
    switch days {
    case 0: return "오늘"
    case 1: return "어제"
    default: return "\(days)일 전"
    }
}

/// 인스펙터의 이력 두 줄(근속·누적 / 최근 실행). 원장을 못 받았거나 그 사람이 원장에 없으면
/// 빈 배열 — 화면은 그 자리를 통째로 비운다.
///
/// 실행 기록이 없는 사람에게 "한 번도 일하지 않았다" 고 쓰지 않는다. `CONTRADICTION_JUDGE`·
/// `DOCS_AUDIT_*` 는 주간 크론에서 실제로 호출되지만 `agent_run` 을 남기지 않아 원장에 없다.
public func agentLedgerLines(_ entry: ConsoleAgentLedger?, serverTime: String) -> [String] {
    guard let entry else {
        return []
    }
    guard entry.totalRuns > 0 else {
        return ["원장에 실행 기록 없음"]
    }
    var first = "누적 \(entry.totalRuns)건"
    if entry.failedRuns > 0 {
        first += " · 실패 \(entry.failedRuns)"
    }
    if let firstRunDate = entry.firstRunDate,
        let tenure = ledgerTenureDays(firstRunDate: firstRunDate, serverTime: serverTime)
    {
        first = "근속 \(tenure)일 · " + first
    }
    let second: String
    if entry.stalled, let idle = entry.autonomyIdleDays {
        second = "자율 실행 \(idle)일째 멈춤"
    } else if let idle = entry.idleDays {
        second = "최근 실행 \(relativeDayLabel(idle))"
    } else {
        return [first]
    }
    return [first, second]
}

/// 대시보드 각주용 정지 문구. 정지가 아니면 nil.
public func agentStallFootnote(_ entry: ConsoleAgentLedger?) -> String? {
    guard let entry, entry.stalled, let idle = entry.autonomyIdleDays else {
        return nil
    }
    return "자율 실행 \(idle)일째 멈춤"
}

/// 대시보드 「지금 담당자」 순서 — 사람 손이 필요한 순서.
///
/// 정지한 자율 워커는 대개 상태가 `waiting` 이라 원래 순서로는 맨 뒤(줄 밖)로 밀린다. 실패
/// 다음에 세운다 — 실패는 방금 터진 일이고, 정지는 며칠째 아무 일도 안 일어난 일이다.
public func dashboardAttentionOrder(
    agents: [ConsoleAgent], stalledAgentTypes: Set<String>
) -> [ConsoleAgent] {
    func rank(_ agent: ConsoleAgent) -> Int {
        let stalled = stalledAgentTypes.contains(agent.agentType)
        switch agent.state {
        case .inProgress: return 0
        case .awaitingApproval: return 1
        case .failed: return 2
        case .awaitingIntegration: return stalled ? 3 : 4
        case .completed: return stalled ? 3 : 5
        case .waiting: return stalled ? 3 : 6
        }
    }
    return agents.enumerated()
        .sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }
        .map(\.element)
}
