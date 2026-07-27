import Foundation

/// 백엔드 콘솔 계약(`src/console/domain/console.type.ts`)을 그대로 미러링한 Codable 모델.
/// 콘솔 API 는 읽기·알림 전용이므로 이 타입들에는 부작용을 유발하는 필드가 없다.
/// 계약이 바뀌면 이 파일과 백엔드 SoT 를 함께 갱신해야 한다.

/// 화면에 표시되는 에이전트 상태 5종. rawValue 는 백엔드 enum 문자열과 1:1.
public enum ConsoleAgentState: String, Codable, Sendable {
    /// 완료 — 민트
    case completed = "COMPLETED"
    /// 진행 중 — 노랑
    case inProgress = "IN_PROGRESS"
    /// 승인 대기 — 진한 핑크
    case awaitingApproval = "AWAITING_APPROVAL"
    /// 연동 대기 — 라벤더
    case awaitingIntegration = "AWAITING_INTEGRATION"
    /// 대기 — 흰색
    case waiting = "WAITING"
}

/// 부서 그리드의 카드 하나. agent-registry 엔트리 + 파생 상태.
public struct ConsoleAgent: Codable, Identifiable, Sendable {
    public let agentType: String
    public let displayName: String
    public let slashCommands: [String]
    public let description: String
    public let state: ConsoleAgentState
    /// 상태별 말풍선 문구(백엔드가 소유, 앱은 표시만).
    public let bubble: String

    /// SwiftUI 리스트/그리드 식별자. agentType 이 레지스트리 내에서 유일.
    public var id: String { agentType }

    public init(
        agentType: String,
        displayName: String,
        slashCommands: [String],
        description: String,
        state: ConsoleAgentState,
        bubble: String
    ) {
        self.agentType = agentType
        self.displayName = displayName
        self.slashCommands = slashCommands
        self.description = description
        self.state = state
        self.bubble = bubble
    }
}

/// 진행/최근 에이전트 실행 한 건. `parentId` 로 체인 계보 추적.
public struct ConsoleRun: Codable, Identifiable, Sendable {
    public let id: String
    public let agentType: String
    public let status: String
    public let parentId: String?
    public let startedAt: String
    public let finishedAt: String?

    public init(
        id: String,
        agentType: String,
        status: String,
        parentId: String?,
        startedAt: String,
        finishedAt: String?
    ) {
        self.id = id
        self.agentType = agentType
        self.status = status
        self.parentId = parentId
        self.startedAt = startedAt
        self.finishedAt = finishedAt
    }
}

/// PreviewGate 승인 대기 한 건.
public struct ConsoleApproval: Codable, Identifiable, Sendable {
    public let id: String
    public let agentType: String?
    public let title: String
    public let createdAt: String

    public init(id: String, agentType: String?, title: String, createdAt: String) {
        self.id = id
        self.agentType = agentType
        self.title = title
        self.createdAt = createdAt
    }
}

/// 앱 부팅 시 1콜로 받는 전체 상태 스냅샷.
public struct ConsoleSnapshot: Codable, Sendable {
    public let agents: [ConsoleAgent]
    public let runs: [ConsoleRun]
    public let approvals: [ConsoleApproval]
    public let serverTime: String

    public init(
        agents: [ConsoleAgent],
        runs: [ConsoleRun],
        approvals: [ConsoleApproval],
        serverTime: String
    ) {
        self.agents = agents
        self.runs = runs
        self.approvals = approvals
        self.serverTime = serverTime
    }
}

/// SSE 로 흘려보내는 증분 이벤트. 앱은 이걸 스냅샷 위에 적용한다.
/// 백엔드는 `{ type, ... }` 형태의 discriminated union 이므로, `type` 필드로 분기해 커스텀 디코딩한다.
public enum ConsoleEvent: Decodable, Sendable {
    case runStarted(ConsoleRun)
    case runFinished(ConsoleRun)
    case approvalOpened(ConsoleApproval)
    case approvalResolved(ConsoleApproval)
    case stateChanged(agentType: String, state: ConsoleAgentState)

    private enum CodingKeys: String, CodingKey {
        case type
        case run
        case approval
        case agentType
        case state
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "run.started":
            self = .runStarted(try container.decode(ConsoleRun.self, forKey: .run))
        case "run.finished":
            self = .runFinished(try container.decode(ConsoleRun.self, forKey: .run))
        case "approval.opened":
            self = .approvalOpened(try container.decode(ConsoleApproval.self, forKey: .approval))
        case "approval.resolved":
            self = .approvalResolved(try container.decode(ConsoleApproval.self, forKey: .approval))
        case "state.changed":
            self = .stateChanged(
                agentType: try container.decode(String.self, forKey: .agentType),
                state: try container.decode(ConsoleAgentState.self, forKey: .state)
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "알 수 없는 콘솔 이벤트 타입: \(type)"
            )
        }
    }
}
