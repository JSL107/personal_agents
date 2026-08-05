import Foundation

/// 토큰에 얹을 정보(순수 계산). 어떤 걸 보일지는 여기서 결정, 렌더는 씬이 맡는다.
public struct AgentTokenInfo: Equatable, Sendable {
    /// 상시 노출 말풍선(활성 상태만, 아니면 nil).
    public let bubble: String?
    /// 진행 경과("N분째", 진행 중만).
    public let elapsed: String?
    /// pending 배지 phase(없으면 nil).
    public let badge: PendingPhase?

    public init(bubble: String?, elapsed: String?, badge: PendingPhase?) {
        self.bubble = bubble
        self.elapsed = elapsed
        self.badge = badge
    }
}

/// 백엔드가 주는 ISO8601 시각 문자열을 읽는다. 소수점 초가 붙는 경우와 안 붙는 경우가
/// 섞여 오므로 두 형식을 모두 시도한다.
public func parseISODate(_ text: String) -> Date? {
    let withFractional = ISO8601DateFormatter()
    withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return withFractional.date(from: text) ?? plain.date(from: text)
}

/// ISO8601 startedAt 과 now 로 경과 라벨을 만든다. 미래·파싱 불가는 nil.
public func elapsedLabel(fromISO startedAt: String, now: Date) -> String? {
    guard let started = parseISODate(startedAt) else {
        return nil
    }
    let seconds = now.timeIntervalSince(started)
    if seconds < 0 {
        return nil
    }
    if seconds < 60 {
        return "방금"
    }
    let minutes = Int(seconds / 60)
    if minutes < 60 {
        return "\(minutes)분째"
    }
    return "\(minutes / 60)시간째"
}

/// 해당 agent 의 미완료 run 중 가장 최근(startedAt 최대). 없으면 nil.
public func activeRun(for agentType: String, runs: [ConsoleRun]) -> ConsoleRun? {
    runs
        .filter { $0.agentType == agentType && $0.finishedAt == nil }
        .max { $0.startedAt < $1.startedAt }
}

/// 해당 agent 에 매칭되는 pending 중 최신(sentAt 최대)의 phase. 없으면 nil.
public func pendingBadge(for agentType: String, pendingCommands: [PendingCommand]) -> PendingPhase? {
    pendingCommands
        .filter { $0.effectiveAgentType == agentType }
        .max { $0.sentAt < $1.sentAt }?
        .phase
}

/// 토큰 정보 합성. 활성 상태에서만 상시 말풍선, 진행 중에서만 경과.
public func agentTokenInfo(
    agent: ConsoleAgent,
    runs: [ConsoleRun],
    pendingCommands: [PendingCommand],
    now: Date
) -> AgentTokenInfo {
    let isActive = agent.state == .inProgress || agent.state == .awaitingApproval
    let bubble = isActive ? agent.bubble : nil
    var elapsed: String?
    if agent.state == .inProgress, let run = activeRun(for: agent.agentType, runs: runs) {
        elapsed = elapsedLabel(fromISO: run.startedAt, now: now)
    }
    let badge = pendingBadge(for: agent.agentType, pendingCommands: pendingCommands)
    return AgentTokenInfo(bubble: bubble, elapsed: elapsed, badge: badge)
}
