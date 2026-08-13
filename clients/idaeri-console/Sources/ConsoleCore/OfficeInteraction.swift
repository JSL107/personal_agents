import Foundation

/// 히트 판정에서 대표(나) 를 가리키는 키.
///
/// 대표는 에이전트가 아니라 자리도 상태도 없지만, 클릭 판정만은 사람들과 한 번에 재야 한다 —
/// 따로 재면 대표 앞줄처럼 사람이 붙어 선 자리에서 둘 다 반응한다. `AgentType` 에 없는 값이라
/// 실제 에이전트와 겹치지 않는다.
public let officeHitTargetPresident = "__president__"

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
/// 뒤에 반영할 수 있기 때문이다. 기존 줄은 filter 해서 도착 순서를 보존하고, 새 대기자는
/// 스냅샷 순서대로 뒤에 붙인다.
///
/// 제거만 하면 재연결 중 `approval.opened`를 놓친 대기자가 자리에 남는다. 상태 반영까지 늦으면
/// `officeIsIdle`이 waiting으로 보고 배회 후보로도 뽑아, 스냅샷과 다른 관제 신호가 된다.
public func reconciledQueueOrder(
    current: [String],
    agents: [ConsoleAgent],
    approvals: [ConsoleApproval]
) -> [String] {
    let approvalAgentTypes = Set(approvals.compactMap(\.agentType))
    var reconciled = current.filter { agentType in
        guard let agent = agents.first(where: { $0.agentType == agentType }) else {
            return false
        }
        return agent.state == .awaitingApproval || approvalAgentTypes.contains(agentType)
    }
    var queuedAgentTypes = Set(reconciled)
    for agent in agents {
        guard agent.state == .awaitingApproval
            || approvalAgentTypes.contains(agent.agentType)
        else {
            continue
        }
        guard queuedAgentTypes.insert(agent.agentType).inserted else {
            continue
        }
        reconciled.append(agent.agentType)
    }
    return reconciled
}

/// 스냅샷 상태가 배회와 모순되는 사람을 찾는다(순수).
///
/// 배회는 대기 상태에서만 시작하지만, 이벤트 없이 스냅샷만 갱신되는 경로(재연결)에서는 배회 중에
/// 상태가 진행·승인 대기·실패로 바뀔 수 있다. 그 경로에는 이벤트 훅이 없어 색만 바뀌고 배회가
/// 계속되므로, 커피머신 앞에 서서 타이핑하는 "진행 중" 직원이 생긴다 — 관제 신호가 거짓이 된다.
///
/// 대기 외에 **완료**도 유지 대상이다. 완료 직후의 탕비실 이동(`visitLounge`)이 자율 배회와 같은
/// 집합에 사람을 넣으므로, 완료까지 중단 대상으로 잡으면 다른 에이전트의 상태 변경으로 스냅샷이
/// 갱신될 때마다 완료 연출이 3.5초를 못 채우고 끊긴다. 완료는 손이 필요 없는 상태라 자리를 비워도
/// 관제 신호가 거짓이 되지 않는다. 반대로 완료 후 새 작업이 붙으면 상태가 진행으로 바뀌어 여기서
/// 잡힌다 — 자리로 돌아가야 하는 경우는 그대로 남는다.
///
/// 결과를 정렬해 돌려주는 이유는 입력이 Set 이라 순회 순서가 실행마다 달라지기 때문이다.
public func strollersToStop(
    strolling: Set<String>,
    agents: [ConsoleAgent]
) -> [String] {
    let states = Dictionary(uniqueKeysWithValues: agents.map { ($0.agentType, $0.state) })
    return strolling.filter { states[$0] != .waiting && states[$0] != .completed }.sorted()
}

/// 마우스를 올렸을 때 뜨는 쪽지 문구(순수).
///
/// 세 가지가 함께 있어야 사람이 읽힌다 — **누구인가**(이름), **무슨 일을 하는 사람인가**
/// (사규의 직무 한 줄), **지금 무엇을 하는가**(활동·상태). 이름표는 여섯 자 안팎이라
/// (`답변 판정`) 직책만 보이고, 그 직책이 무슨 일인지는 화면 어디에도 없었다.
///
/// 이름이 첫 줄인 이유는 쪽지가 **커서 옆**에 뜨기 때문이다. 머리 위에 붙어 있던 동안에는
/// 누구 얘기인지 위치가 말해 줬지만, 사람에게서 떨어져 나온 판은 이름이 없으면 주인을 잃는다.
///
/// 직무가 활동보다 위다. 활동은 상태가 바뀔 때마다 달라지므로, 고정된 정체가 먼저 오고 그
/// 아래에 지금 벌어지는 일이 붙는 순서가 읽기 흐름에 맞는다.
public func officeHoverNote(name: String?, job: String?, activity: String?) -> String? {
    let lines = [name, job, activity].compactMap { line -> String? in
        guard let line, !line.trimmingCharacters(in: .whitespaces).isEmpty else {
            return nil
        }
        return line
    }
    guard !lines.isEmpty else {
        return nil
    }
    return lines.joined(separator: "\n")
}

/// 커서 옆 쪽지 판 노드 이름. 만드는 쪽과 걷는 쪽이 같은 문자열을 봐야 한다.
public let officeHoverTooltipNodeName = "hoverTooltip"

/// 쪽지 판이 글자 상자 밖으로 넓어지는 여백(px).
public let officeTooltipPlatePaddingX: Double = 8
public let officeTooltipPlatePaddingY: Double = 6

/// 커서와 판 사이 간격(px). 붙여 두면 커서 그림이 첫 글자를 덮는다.
public let officeTooltipCursorGap: Double = 14

/// 커서 옆 쪽지 판의 왼쪽 아래 꼭짓점(순수).
///
/// 쪽지를 사람 머리 위에 붙이던 동안에는 **글자가 글자를 덮었다.** 직무 문장은 24자까지
/// 오는데(`기간 성과를 정성 평가하고 커리어 로그를 남긴다`) 좌석 몫은 두 칸이라, 쪽지가
/// 좌우로 여덟 칸을 뻗어 이웃 이름표·부서 문패·상단 밴드 라벨과 뒤섞였다. 게다가 문패는
/// 오버레이(z=1000)라 겹치면 쪽지가 지는 쪽이어서, 정작 읽으려고 마우스를 올린 글이 잘렸다.
///
/// 커서 옆 판은 그 겹침을 배치로 푼다 — 판이 화면 최상단에 불투명하게 뜨므로 무엇과도
/// 자리를 다투지 않는다. 대신 **화면 밖으로 나가지 않아야** 한다. 기본은 커서 오른쪽 위이고,
/// 그쪽이 좁으면 반대편으로 넘긴 뒤 마지막으로 화면 안에 가둔다.
public func officeTooltipOrigin(
    cursor: OfficePoint,
    boxWidth: Double,
    boxHeight: Double,
    sceneWidth: Double,
    sceneHeight: Double,
    gap: Double
) -> OfficePoint {
    var x = cursor.x + gap
    if x + boxWidth > sceneWidth {
        x = cursor.x - gap - boxWidth
    }
    var y = cursor.y + gap
    if y + boxHeight > sceneHeight {
        y = cursor.y - gap - boxHeight
    }
    // 뒤집어도 안 들어가는 크기(작은 창 + 긴 직무 문장)에서는 화면 안쪽이 우선이다 —
    // 커서에서 조금 멀어지는 편이 글자가 잘리는 것보다 낫다.
    return OfficePoint(
        x: min(max(0, x), max(0, sceneWidth - boxWidth)),
        y: min(max(0, y), max(0, sceneHeight - boxHeight))
    )
}

/// 이름표를 진하게 보일지 판정한다(순수).
///
/// 29명 전원의 이름표가 늘 같은 세기로 켜져 있으면 방 하나에 검은 딱지가 4~8개씩 붙어,
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

/// 이름표가 이웃과 겹치지 않는 최소 타일 크기(px).
///
/// 이름표 폭은 실측 최대 1.38칸인데, 한글 글자 크기에 하한(11px)이 있어 타일이 작아지면
/// **타일 대비** 폭이 커진다 — 최소 창(타일 20.6)에서는 2.45칸이 되어 자리 간격 2칸을
/// 넘어선다. 자리를 더 벌려서는 못 푼다(내부 부서 10명이 간격 3칸에 안 들어간다).
///
/// 경계값은 "이름표 폭이 자리 간격 2칸을 넘지 않는 타일 크기" 다:
/// `11 × 1.38 / 0.30 ≈ 25.3` → 여유를 두어 27.
public let officeNameplateCrowdedTileSize: Double = 27

/// 이름표를 아예 보여줄지 판정한다(순수).
///
/// 창이 작아 이름표가 서로 겹치는 구간에서는, 겹친 글자 27개보다 **읽히는 몇 개**가 낫다.
/// 강조 대상(손이 필요한 사람·지금 보고 있는 사람)과 일이 도는 사람만 남기고 나머지는 숨긴다
/// — 창을 키우면 전부 돌아온다.
public func nameplateIsVisible(
    tileSize: Double,
    state: ConsoleAgentState,
    isHovered: Bool,
    isSelected: Bool
) -> Bool {
    guard tileSize < officeNameplateCrowdedTileSize else {
        return true
    }
    if nameplateIsEmphasized(state: state, isHovered: isHovered, isSelected: isSelected) {
        return true
    }
    return state == .inProgress
}
