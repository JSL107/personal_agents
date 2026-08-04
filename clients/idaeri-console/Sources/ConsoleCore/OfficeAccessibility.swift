import Foundation

/// 오피스 화면에서 벌어지는 일을 보조기술이 읽을 수 있는 한 문장으로 요약한다(순수).
///
/// 오피스 씬은 SpriteKit 그림이라 보조기술 트리에 이름 없는 이미지 덩어리로만 노출된다
/// (실측: 접근성 트리에 `image 1 … image 10` 만 잡히고, 진행·승인·실패는 하나도 읽히지 않는다).
/// 몸짓과 자리로 전달하던 정보를 소리로 듣는 경로가 이 문장뿐이라 상태별 인원과 이름을 함께 담는다.
///
/// 손이 필요한 상태를 앞에 둔다 — 소리는 눈과 달리 훑어볼 수 없어서 먼저 읽히는 것이 곧
/// 우선순위가 된다. 대기 인원은 수만 밝히고 이름은 읽지 않는다(24명 이름을 다 읽으면 정작
/// 손이 필요한 항목이 묻힌다).
///
/// 승인 대기 판정은 줄 세우기(`reconciledQueueOrder`)와 **같은 규칙**을 쓴다. 백엔드가 승인 건을
/// 먼저 만들고 에이전트 상태를 한 박자 뒤에 반영하는 경로가 있어서, 상태만 보면 대표실 앞에
/// 줄이 서 있는데 낭독은 "전원 대기" 라고 말하게 된다 — 화면과 소리가 어긋나면 이 문장의 목적
/// 자체가 무너진다.
public func officeAccessibilitySummary(
    agents: [ConsoleAgent],
    approvals: [ConsoleApproval]
) -> String {
    guard !agents.isEmpty else {
        return "표시할 부서가 없습니다."
    }
    let approvalAgentTypes = Set(approvals.compactMap(\.agentType))
    func awaitsApproval(_ agent: ConsoleAgent) -> Bool {
        agent.state == .awaitingApproval || approvalAgentTypes.contains(agent.agentType)
    }
    // 백엔드 표시명은 영문 식별명이라, 화면 이름표와 같은 직책으로 부른다.
    func names(_ matched: [ConsoleAgent]) -> String {
        matched
            .map { agentRoleLabel(for: $0.agentType) ?? $0.displayName }
            .joined(separator: ", ")
    }

    var parts: [String] = []
    let awaiting = agents.filter(awaitsApproval)
    if !awaiting.isEmpty {
        parts.append("승인 대기 \(awaiting.count)명: \(names(awaiting))")
    }
    // 승인 대기로 이미 센 사람은 다른 상태에서 다시 세지 않는다 — 상태가 아직 안 따라온
    // 사람이 "승인 대기" 와 "대기" 양쪽에 잡히면 인원 합이 실제보다 부풀어 오른다.
    let remaining = agents.filter { !awaitsApproval($0) }
    let ordered: [(state: ConsoleAgentState, label: String)] = [
        (.failed, "실패"),
        (.awaitingIntegration, "연동 대기"),
        (.inProgress, "진행 중"),
        (.completed, "완료"),
    ]
    for entry in ordered {
        let matched = remaining.filter { $0.state == entry.state }
        if matched.isEmpty {
            continue
        }
        parts.append("\(entry.label) \(matched.count)명: \(names(matched))")
    }
    let waiting = remaining.filter { $0.state == .waiting }.count
    if waiting > 0 {
        parts.append(parts.isEmpty ? "전원 \(waiting)명 대기 중" : "나머지 \(waiting)명 대기")
    }
    return parts.joined(separator: ". ") + "."
}
