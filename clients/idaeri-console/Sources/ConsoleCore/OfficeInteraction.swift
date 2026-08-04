import Foundation

/// 클릭 좌표가 어느 에이전트 원 안인지 판정한다(순수). 반경 안의 후보 중 가장 가까운 것을 고른다.
/// 어떤 원과도 반경 밖이면 nil.
public func agentTypeAt(
    point: OfficePoint,
    slots: [(agentType: String, point: OfficePoint)],
    radius: Double
) -> String? {
    var best: (agentType: String, distanceSquared: Double)?
    let radiusSquared = radius * radius
    for slot in slots {
        let dx = slot.point.x - point.x
        let dy = slot.point.y - point.y
        let distanceSquared = dx * dx + dy * dy
        guard distanceSquared <= radiusSquared else {
            continue
        }
        if best == nil || distanceSquared < best!.distanceSquared {
            best = (slot.agentType, distanceSquared)
        }
    }
    return best?.agentType
}

/// 해당 에이전트의 승인 대기 건을 찾는다. 여러 건이면 첫 번째(스냅샷 순서 = 결정론적).
public func approvalFor(agentType: String, in approvals: [ConsoleApproval]) -> ConsoleApproval? {
    approvals.first { $0.agentType == agentType }
}

/// 스냅샷을 정본으로 삼아 승인 줄을 맞춘다(순수).
///
/// 줄은 이벤트로만 줄어드는데 재연결 경로에는 그 이벤트가 없다. 스냅샷이 "이 사람은 더 이상
/// 승인 대기가 아니다" 라고 말하면 줄에서 빼야 한다 — 그러지 않으면 대표실 앞에 영원히
/// 서 있고, 자리로 돌아가지도 배회하지도 못한다.
///
/// 상태와 승인 목록을 함께 보는 이유는 백엔드가 승인 건을 먼저 만들고 에이전트 상태를 한 박자
/// 뒤에 반영할 수 있기 때문이다. 결과는 현재 줄을 filter 해서 도착 순서를 그대로 보존한다.
public func reconciledQueueOrder(
    current: [String],
    agents: [ConsoleAgent],
    approvals: [ConsoleApproval]
) -> [String] {
    let approvalAgentTypes = Set(approvals.compactMap(\.agentType))
    return current.filter { agentType in
        guard let agent = agents.first(where: { $0.agentType == agentType }) else {
            return false
        }
        return agent.state == .awaitingApproval || approvalAgentTypes.contains(agentType)
    }
}

/// 이름표를 진하게 보일지 판정한다(순수).
///
/// 27명 전원의 이름표가 늘 같은 세기로 켜져 있으면 방 하나에 검은 딱지가 4~8개씩 붙어,
/// 먼저 읽혀야 할 상태 링을 덮는다. 기본은 옅게 두고 두 경우만 올린다 —
/// **손이 필요한 대상**(승인 대기·실패)과 **지금 보고 있는 대상**(마우스·선택).
public func nameplateIsEmphasized(
    state: ConsoleAgentState,
    isHovered: Bool,
    isSelected: Bool
) -> Bool {
    if isHovered || isSelected {
        return true
    }
    switch state {
    case .awaitingApproval, .failed:
        return true
    case .completed, .inProgress, .waiting, .awaitingIntegration:
        return false
    }
}
