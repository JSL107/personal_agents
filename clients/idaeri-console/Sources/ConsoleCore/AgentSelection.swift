/// 해당 에이전트의 승인 대기 건을 찾는다. 여러 건이면 스냅샷의 첫 번째를 고른다.
public func approvalFor(agentType: String, in approvals: [ConsoleApproval]) -> ConsoleApproval? {
    approvals.first { $0.agentType == agentType }
}
