import Foundation

/// 씬이 실행할 연출 의도. 어떤 이벤트가 어떤 연출인지는 이 값으로 확정되고,
/// SpriteKit(SKAction) 실행은 OfficeScene 이 맡는다(코어는 SpriteKit 비의존).
public enum VisualIntent: Equatable, Sendable {
    case recolor(agentType: String, state: ConsoleAgentState)
    case working(agentType: String)
    case handoff(from: String, to: String)
    case summonToBand(agentType: String)
    case returnHome(agentType: String)
    case reject(agentType: String)
    case bubble(agentType: String, text: String)
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
        var intents: [VisualIntent] = [.summonToBand(agentType: agentType)]
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

    case .sessionOpened, .sessionUpdated, .sessionClosed, .commandInfo:
        return []
    }
}
