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

/// 클릭 목록의 할 일 한 줄 — 내가 처리해야 하는 것.
public struct MascotTodoRow: Equatable, Sendable, Identifiable {
    public enum Action: Equatable, Sendable {
        /// 대시보드 상세로(승인 카드·재시도 불가 실패).
        case openDashboard
        /// 실패 실행을 다시 돌린다(대시보드 [재시도]와 같은 경로).
        case retry(runId: Int)
        /// PR 을 브라우저로 연다.
        case openURL(String)
    }

    public let id: String
    public let kind: ConsoleTodoKind
    public let title: String
    public let detail: String
    public let action: Action?
    /// 재시도를 이미 접수해 도는 중 — 버튼을 잠근다.
    public let busy: Bool
}

/// 할 일 목록: 승인 대기 → 실패한 작업 → PR 리뷰 회수.
///
/// 승인은 브리핑 집계가 아니라 지금 열린 카드(`approvals`)에서 만든다 — 브리핑은 30초마다 오고,
/// 카드는 누르는 순간 목록에서 빠지므로 그쪽이 화면과 맞는다. 실패·PR 은 브리핑의 대상(`targets`)
/// 한 건이 한 줄이다. 백엔드가 이미 급한 순서로 조립하므로 그 순서를 그대로 쓴다.
public func mascotTodoRows(
    todos: [ConsoleTodo], approvals: [ConsoleApproval], agents: [ConsoleAgent],
    retryingRunIds: Set<Int>, now: Date
) -> [MascotTodoRow] {
    var rows: [MascotTodoRow] = approvals.map { approval in
        MascotTodoRow(
            id: "approval:\(approval.id)", kind: .approval,
            title: mascotApprovalHeadline(approval: approval, agents: agents),
            detail: "\(approval.title) · \(mascotRelativeTime(officeParseIsoDate(approval.createdAt), now: now))",
            action: .openDashboard, busy: false
        )
    }
    for todo in todos where todo.kind == .failedRun {
        for target in todo.targets {
            let name = target.agentType.flatMap { type in agents.first(where: { $0.agentType == type })?.displayName }
            let runId = target.retryRunId
            rows.append(MascotTodoRow(
                id: "failed:\(target.runId.map(String.init) ?? target.label)", kind: .failedRun,
                title: name ?? target.label, detail: "실패 — \(target.label)",
                action: runId.map { .retry(runId: $0) } ?? .openDashboard,
                busy: target.retrying == true || runId.map(retryingRunIds.contains) == true
            ))
        }
    }
    for todo in todos where todo.kind == .prReview {
        for target in todo.targets {
            rows.append(MascotTodoRow(
                id: "pr:\(target.pullNumber.map(String.init) ?? target.label)", kind: .prReview,
                title: target.label, detail: todo.detail,
                action: target.url.map { .openURL($0) }, busy: false
            ))
        }
    }
    return rows
}
