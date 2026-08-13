import Foundation

/// 씬이 실행할 연출 의도. 어떤 이벤트가 어떤 연출인지는 이 값으로 확정되고,
/// SpriteKit(SKAction) 실행은 OfficeScene 이 맡는다(코어는 SpriteKit 비의존).
public enum VisualIntent: Equatable, Sendable {
    case recolor(agentType: String, state: ConsoleAgentState)
    case working(agentType: String)
    case handoff(from: String, to: String)
    /// 일이 여럿에 걸쳐 이어지면 회의실에 모인다.
    ///
    /// `thenWorking` 은 회의가 끝난 뒤 자기 자리로 가서 일을 시작할 사람이다. 회의와
    /// `working` 을 따로 보내면 뒤따르는 `working` 이 회의를 시작하자마자 취소한다 —
    /// 둘 다 같은 사람을 걷게 하는 지시라서 나중 것이 이긴다.
    case meeting(agentTypes: [String], thenWorking: String)
    case summonToBand(agentType: String)
    case returnHome(agentType: String)
    case reject(agentType: String)
    case bubble(agentType: String, text: String)
}

/// 실제 이벤트가 자율 배회를 즉시 끊을 대상을 연출 종류와 같은 순수 경계에서 확정한다.
public func affectedAgentTypes(of intent: VisualIntent) -> [String] {
    switch intent {
    case let .handoff(from, to):
        return [from, to]
    case let .meeting(agentTypes, thenWorking):
        return agentTypes.contains(thenWorking) ? agentTypes : agentTypes + [thenWorking]
    case let .recolor(agentType, _),
         let .working(agentType),
         let .summonToBand(agentType),
         let .returnHome(agentType),
         let .reject(agentType),
         let .bubble(agentType, _):
        return [agentType]
    }
}

// MARK: - 걸음 프레임

/// 걸음 프레임 장수. 에셋은 정지 그림에서 파생된 두 장(`-walk1` · `-walk2`)뿐이다.
public let officeWalkFrameCount = 2

/// 걷는 중 `step` 번째 걸음에 쓸 포즈 이름.
///
/// 두 프레임을 번갈아 쓰는 것이 "한 칸 = 한 걸음" 과 맞다. 사이에 정지 그림을 끼우는
/// 네 프레임 사이클(정지→1→정지→2)은 두 칸에 한 번만 다리가 교차해, 한 칸 0.16초인
/// 지금 속도에서는 걷는다기보다 미끄러지는 것으로 보인다.
public func officeWalkPose(_ pose: String, step: Int) -> String {
    // 음수 걸음 인덱스가 들어와도 프레임 번호가 0 이나 음수로 떨어지지 않게 한 번 더 감는다.
    let frame = ((step % officeWalkFrameCount) + officeWalkFrameCount) % officeWalkFrameCount
    return "\(pose)-walk\(frame + 1)"
}

/// 걸음 프레임 이름에서 정지 포즈를 되돌린다(`down-walk1` → `down`).
///
/// 에셋 파이프라인은 다리 영역을 못 찾으면 걸음 프레임 파생을 건너뛴다(측면처럼 두 다리가
/// 한 덩어리인 그림이 새로 들어오는 경우). 그때 로더가 정지 그림으로 내려가기 위한 것 —
/// 없는 파일을 그대로 요청하면 그 사람만 화면에서 사라진다.
public func officeStillPose(_ pose: String) -> String {
    guard let marker = pose.range(of: "-walk") else {
        return pose
    }
    return String(pose[pose.startIndex..<marker.lowerBound])
}

/// 캐릭터 텍스처 파일명 후보를 우선순위대로 만든다(순수). 로더는 이 중 실제로 있는 첫 파일을 쓴다.
///
/// **한 시트를 다 소진한 뒤에 기본 시트로 내려간다.** 순서를 뒤집어 기본 시트의 걸음 프레임을
/// 같은 시트의 정지 그림보다 먼저 고르면, 걸음 프레임이 없는 시트의 사람이 걷는 순간 얼굴·체형이
/// 기본 캐릭터로 바뀐다 — 사람마다 다른 시트를 배정한 이유가 사라진다. 순서가 곧 규약이라
/// 로더 안에 두지 않고 여기서 테스트가 닿게 한다.
public func characterSpriteCandidates(sheet: Int, pose: String) -> [String] {
    let index = min(max(sheet, 0), characterSheetPrefixes.count - 1)
    let still = officeStillPose(pose)
    // 배정된 시트 먼저, 그다음 기본 시트. 배정된 시트가 기본 시트면 중복되지만 호출자가
    // "있는 첫 파일" 을 고르므로 무해하다.
    return [characterSheetPrefixes[index], characterSheetPrefixes[0]].flatMap { prefix in
        still == pose ? ["\(prefix)-\(pose)"] : ["\(prefix)-\(pose)", "\(prefix)-\(still)"]
    }
}

/// 이벤트 번역에 필요한 주변 상태(부모 run·pending 조회용). 스냅샷 파생, 부작용 없음.
public struct ChoreographyContext: Sendable {
    public let agents: [ConsoleAgent]
    public let runs: [ConsoleRun]
    public let pendingCommands: [PendingCommand]

    public init(agents: [ConsoleAgent], runs: [ConsoleRun], pendingCommands: [PendingCommand]) {
        self.agents = agents
        self.runs = runs
        self.pendingCommands = pendingCommands
    }
}

/// SSE 이벤트 하나를 연출 의도 배열로 번역한다(순수).
/// 미지의 agentType 이거나 오피스와 무관한 이벤트(session·command.info·approvalResolved 의 미상 등)는 빈 배열.
public func visualIntents(for event: ConsoleEvent, context: ChoreographyContext) -> [VisualIntent] {
    func knows(_ agentType: String) -> Bool {
        context.agents.contains { $0.agentType == agentType }
    }
    func agent(_ agentType: String) -> ConsoleAgent? {
        context.agents.first { $0.agentType == agentType }
    }

    switch event {
    case let .runStarted(run):
        guard knows(run.agentType) else {
            return []
        }
        // 체인에 여럿이 얽혔으면 회의실로 모은다. 화면에서 자리를 뜨는 사람이 여럿이라
        // "지금 이 일에 누가 관여하는지" 가 한눈에 보인다 — 1:1 전달로는 두 사람만 보인다.
        let participants = officeChainParticipants(run: run, runs: context.runs).filter(knows)
        if participants.count >= officeMeetingMinimumParticipants {
            return [.meeting(agentTypes: participants, thenWorking: run.agentType)]
        }
        if let parentId = run.parentId,
           let parent = context.runs.first(where: { $0.id == parentId }),
           knows(parent.agentType) {
            return [.handoff(from: parent.agentType, to: run.agentType), .working(agentType: run.agentType)]
        }
        return [.working(agentType: run.agentType)]

    case let .runFinished(run):
        guard let found = agent(run.agentType) else {
            return []
        }
        return [.recolor(agentType: found.agentType, state: found.state), .bubble(agentType: found.agentType, text: found.bubble)]

    case let .approvalOpened(approval):
        guard let agentType = approval.agentType, knows(agentType) else {
            return []
        }
        // 색을 여기서 함께 확정한다. 뒤따라올 state.changed(AWAITING_APPROVAL) 에 기대면
        // 그 이벤트가 누락된 경우 줄에 선 사람만 대기색으로 남는다.
        var intents: [VisualIntent] = [
            .summonToBand(agentType: agentType),
            .recolor(agentType: agentType, state: .awaitingApproval),
        ]
        if let found = agent(agentType) {
            intents.append(.bubble(agentType: agentType, text: found.bubble))
        }
        return intents

    case let .approvalResolved(approval):
        guard let agentType = approval.agentType, knows(agentType) else {
            return []
        }
        return [.returnHome(agentType: agentType)]

    case let .stateChanged(agentType, state):
        guard knows(agentType) else {
            return []
        }
        switch state {
        case .inProgress:
            return [.working(agentType: agentType)]
        case .awaitingApproval:
            return [.summonToBand(agentType: agentType), .recolor(agentType: agentType, state: state)]
        default:
            return [.recolor(agentType: agentType, state: state)]
        }

    case let .commandRejected(commandId, _):
        guard
            let id = UUID(uuidString: commandId),
            let pending = context.pendingCommands.first(where: { $0.id == id }),
            let agentType = pending.effectiveAgentType,
            knows(agentType)
        else {
            return []
        }
        return [.reject(agentType: agentType)]

    case .sessionOpened, .sessionUpdated, .sessionClosed, .commandInfo, .commandAnswered:
        return []
    }
}
