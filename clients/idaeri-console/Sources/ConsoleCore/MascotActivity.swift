import Foundation

/// 지금 돌고 있는 일. 사용자에게 보여 줄 만큼(유예를 넘긴) 이대리 실행만 센다.
private func mascotVisibleRuns(_ runs: [ConsoleRun], now: Date) -> [ConsoleRun] {
    runs.filter { run in
        guard run.status == "IN_PROGRESS", run.finishedAt == nil else {
            return false
        }
        guard let startedAt = officeParseIsoDate(run.startedAt) else {
            return true
        }
        return now.timeIntervalSince(startedAt) >= mascotWorkGraceSeconds
    }
}

/// 부서별 작업 그림. 무슨 일을 하는지 소품으로 보인다.
public func mascotActivityPose(_ department: Department) -> MascotPose {
    switch department {
    case .planning:
        return .planning
    case .quality:
        return .reviewing
    case .evaluation:
        return .evaluating
    case .treasury:
        return .counting
    case .content:
        return .writing
    case .internalOps:
        return .fixing
    }
}

/// 지금 보일 작업 그림. 가장 최근에 시작한 이대리 실행의 부서를 따르고, 이대리 실행이 없고
/// 내 Claude Code·Codex 세션만 돌고 있으면 노트북 타이핑. 아무것도 없으면 nil.
public func mascotActivity(
    runs: [ConsoleRun], agents: [ConsoleAgent], sessions: [ConsoleSession], now: Date
) -> MascotPose? {
    let latest = mascotVisibleRuns(runs, now: now).max { left, right in
        (officeParseIsoDate(left.startedAt) ?? .distantPast) < (officeParseIsoDate(right.startedAt) ?? .distantPast)
    }
    if let latest {
        let department = agents.first(where: { $0.agentType == latest.agentType })?.department
        return mascotActivityPose(departmentFromRaw(department))
    }
    return sessions.contains(where: \.isActive) ? .typing : nil
}

/// 머리 위 배지 숫자 — 돌고 있는 이대리 실행 + 일하고 있는 내 세션.
public func mascotBusyCount(runs: [ConsoleRun], sessions: [ConsoleSession], now: Date) -> Int {
    mascotVisibleRuns(runs, now: now).count + sessions.filter(\.isActive).count
}

/// 진행 목록 한 줄.
public struct MascotStatusItem: Equatable, Sendable, Identifiable {
    public enum Kind: Equatable, Sendable {
        case run
        case session
        case approval
    }

    public let id: String
    public let kind: Kind
    public let title: String
    public let detail: String
    /// `작업 중`·`쉬는 중`·`승인 대기` 같은 짧은 상태 표시.
    public let badge: String
    /// `방금`·`3분 전` 같은 시각 표시.
    public let when: String
}

/// `방금`·`N분 전`·`N시간 전`·`N일 전`.
public func mascotRelativeTime(_ date: Date?, now: Date) -> String {
    guard let date else {
        return ""
    }
    let seconds = max(0, now.timeIntervalSince(date))
    if seconds < 60 {
        return "방금"
    }
    if seconds < 3600 {
        return "\(Int(seconds / 60))분 전"
    }
    if seconds < 86_400 {
        return "\(Int(seconds / 3600))시간 전"
    }
    return "\(Int(seconds / 86_400))일 전"
}

/// 진행 목록: 승인 대기(처리할 일) → 이대리 실행(최근 시작 순) → 내 세션(일하는 것 먼저, 최근 활동 순).
///
/// 실행의 설명은 그 직원의 말풍선 문장(`bubble`)을 쓴다 — 오피스가 머리 위에 띄우는 "지금 하는 일"
/// 과 같은 문장이라 두 화면이 다른 말을 하지 않는다.
public func mascotStatusItems(
    approvals: [ConsoleApproval], runs: [ConsoleRun], agents: [ConsoleAgent],
    sessions: [ConsoleSession], now: Date
) -> [MascotStatusItem] {
    var items: [MascotStatusItem] = []
    for approval in approvals {
        items.append(MascotStatusItem(
            id: "approval:\(approval.id)", kind: .approval,
            title: mascotApprovalHeadline(approval: approval, agents: agents),
            detail: approval.title, badge: "승인 대기",
            when: mascotRelativeTime(officeParseIsoDate(approval.createdAt), now: now)
        ))
    }
    let runsByRecent = mascotVisibleRuns(runs, now: now).sorted {
        (officeParseIsoDate($0.startedAt) ?? .distantPast) > (officeParseIsoDate($1.startedAt) ?? .distantPast)
    }
    for run in runsByRecent {
        let agent = agents.first(where: { $0.agentType == run.agentType })
        items.append(MascotStatusItem(
            id: "run:\(run.id)", kind: .run,
            title: agent?.displayName ?? run.agentType,
            detail: agent?.bubble ?? "",
            badge: "작업 중",
            when: mascotRelativeTime(officeParseIsoDate(run.startedAt), now: now)
        ))
    }
    let sessionsSorted = sessions.sorted { left, right in
        if left.isActive != right.isActive {
            return left.isActive
        }
        let leftAt = officeParseIsoDate(left.lastActivityAt ?? left.startedAt) ?? .distantPast
        let rightAt = officeParseIsoDate(right.lastActivityAt ?? right.startedAt) ?? .distantPast
        return leftAt > rightAt
    }
    for session in sessionsSorted {
        items.append(MascotStatusItem(
            id: "session:\(session.sessionId)", kind: .session,
            title: session.name,
            detail: (session.cwd as NSString).lastPathComponent,
            badge: session.isActive ? "작업 중" : "쉬는 중",
            when: mascotRelativeTime(officeParseIsoDate(session.lastActivityAt ?? session.startedAt), now: now)
        ))
    }
    return items
}
