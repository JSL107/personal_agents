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
