import Foundation

/// 백엔드 콘솔 계약(`src/console/domain/console.type.ts`)을 그대로 미러링한 Codable 모델.
/// 콘솔 API 는 읽기·알림 전용이므로 이 타입들에는 부작용을 유발하는 필드가 없다.
/// 계약이 바뀌면 이 파일과 백엔드 SoT 를 함께 갱신해야 한다.

/// 화면에 표시되는 에이전트 상태 6종. rawValue 는 백엔드 enum 문자열과 1:1.
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
    /// 실패 — 빨강/코랄
    case failed = "FAILED"
}

/// 부서 그리드의 카드 하나. agent-registry 엔트리 + 파생 상태.
public struct ConsoleAgent: Codable, Identifiable, Equatable, Sendable {
    public let agentType: String
    public let displayName: String
    public let slashCommands: [String]
    public let description: String
    public let state: ConsoleAgentState
    /// 상태별 말풍선 문구(백엔드가 소유, 앱은 표시만).
    public let bubble: String
    /// 최근 종료 창 안에 끝난 런의 id. 창 밖이거나 기록이 없으면 nil.
    /// "이 완료는 이미 확인했다" 를 기억하는 키로 쓴다(`ConsoleStore.acknowledgeCompletion`).
    /// 종료 시각이 아니라 런 id 인 이유 — 시각은 DB 기록과 SSE 발행이 각각 만들어 어긋난다.
    public let lastFinishedRunId: String?
    /// 소속 부서. 백엔드 사규(`agent-registry/agent-contract.ts` 의 `Department`)가 소유하는
    /// rawValue 문자열이고, 앱은 그 값을 옮겨 담을 뿐 스스로 분류하지 않는다.
    ///
    /// 앱에도 같은 매핑이 하드코딩돼 있었는데, 두 곳이 어긋나면 사람이 조용히 다른 방에 앉는다
    /// — 실제로 백엔드가 리뷰로 배정한 `REVIEW_REPLY_JUDGE` 가 앱에서는 매핑에 없어 내부방에
    /// 앉아 있었다. 응답에 값이 없으면 `.internalOps` 로 떨어지는데, 그때는 전원이 한 방에
    /// 몰려 화면에서 바로 드러난다(조용한 실패가 아니다).
    public let department: String?
    /// 오늘(서버 로컬 자정 이후) 성공으로 끝낸 실행 건수. 책상 위 서류 더미 높이가 된다.
    ///
    /// **옵셔널인 이유는 버전 스큐다.** 앱은 한 번 빌드해 두고 쓰는데 서버는 따로 재시작하므로,
    /// 이 필드를 모르는 서버가 응답을 내려도 스냅샷 디코딩 전체가 실패해서는 안 된다. 필수로
    /// 두면 화면이 통째로 안 뜬다 — 서류 더미 하나 때문에 관제 화면을 잃는 것은 균형이 안 맞는다.
    /// 값이 없으면 서류를 안 놓는다(0장).
    public let doneToday: Int?

    /// SwiftUI 리스트/그리드 식별자. agentType 이 레지스트리 내에서 유일.
    public var id: String { agentType }

    /// 화면에서 사람으로 부를 이름 — 한글 직책이 있으면 그것, 없으면 백엔드 표시명.
    /// 오피스 이름표와 대시보드 카드가 같은 사람을 같은 이름으로 부르게 하는 단일 출처다.
    public var roleName: String { agentRoleLabel(for: agentType) ?? displayName }

    /// 화면이 쓰는 부서. 백엔드 문자열을 앱 enum 으로 옮긴 것뿐이다(판정 아님).
    public var resolvedDepartment: Department { departmentFromRaw(department) }

    /// 일부 값만 바꾼 사본. 지정하지 않은 필드는 그대로 이어진다.
    ///
    /// 이 메서드가 있는 이유는 편의가 아니라 **누락 방지**다. `ConsoleStore` 가 상태를 바꿀 때
    /// 필드를 손으로 다시 나열하고 있었는데, 그러면 새 필드가 늘어날 때 컴파일러가 침묵한 채
    /// 조용히 빠진다(기본값이 있으므로). 부서를 추가할 때 세 곳에서 빠질 수 있었고, 그 경우
    /// 상태가 바뀐 사람이 자기 방에서 내부방으로 순간이동한다.
    public func replacing(
        state: ConsoleAgentState? = nil,
        bubble: String? = nil,
        lastFinishedRunId: String? = nil
    ) -> ConsoleAgent {
        ConsoleAgent(
            agentType: agentType,
            displayName: displayName,
            slashCommands: slashCommands,
            description: description,
            state: state ?? self.state,
            bubble: bubble ?? self.bubble,
            lastFinishedRunId: lastFinishedRunId ?? self.lastFinishedRunId,
            department: department,
            doneToday: doneToday
        )
    }

    public init(
        agentType: String,
        displayName: String,
        slashCommands: [String],
        description: String,
        state: ConsoleAgentState,
        bubble: String,
        lastFinishedRunId: String? = nil,
        department: String? = nil,
        doneToday: Int? = nil
    ) {
        self.agentType = agentType
        self.displayName = displayName
        self.slashCommands = slashCommands
        self.description = description
        self.state = state
        self.bubble = bubble
        self.lastFinishedRunId = lastFinishedRunId
        self.department = department
        self.doneToday = doneToday
    }
}

/// 진행/최근 에이전트 실행 한 건. `parentId` 로 체인 계보 추적.
public struct ConsoleRun: Codable, Identifiable, Sendable, Equatable {
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
public struct ConsoleApproval: Codable, Identifiable, Equatable, Sendable {
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

/// 로컬에서 실행 중인 CLI 세션 한 건. source/state 는 백엔드 문자열과 1:1.
///
/// `Equatable` 인 이유는 화면 갱신 조건이다 — 오피스 씬이 세션 목록이 **바뀌었을 때만**
/// 다시 그리려면 같은지 비교할 수 있어야 한다. 없으면 폴링이 돌 때마다 값이 같아도 다시 그린다.
public struct ConsoleSession: Codable, Identifiable, Equatable, Sendable {
    public let sessionId: String
    public let pid: Int
    public let source: String
    public let name: String
    public let cwd: String
    public let state: String
    public let startedAt: String
    public let lastActivityAt: String?

    public var id: String { sessionId }

    public init(
        sessionId: String, pid: Int, source: String, name: String,
        cwd: String, state: String, startedAt: String, lastActivityAt: String?
    ) {
        self.sessionId = sessionId
        self.pid = pid
        self.source = source
        self.name = name
        self.cwd = cwd
        self.state = state
        self.startedAt = startedAt
        self.lastActivityAt = lastActivityAt
    }
}

/// 앱 부팅 시 1콜로 받는 전체 상태 스냅샷.
public struct ConsoleSnapshot: Codable, Sendable {
    public let agents: [ConsoleAgent]
    public let runs: [ConsoleRun]
    public let approvals: [ConsoleApproval]
    public let sessions: [ConsoleSession]
    public let serverTime: String

    public init(
        agents: [ConsoleAgent],
        runs: [ConsoleRun],
        approvals: [ConsoleApproval],
        sessions: [ConsoleSession],
        serverTime: String
    ) {
        self.agents = agents
        self.runs = runs
        self.approvals = approvals
        self.sessions = sessions
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
    case sessionOpened(ConsoleSession)
    case sessionUpdated(ConsoleSession)
    case sessionClosed(sessionId: String)
    case commandRejected(commandId: String, reason: String)
    case commandInfo(commandId: String, message: String)

    private enum CodingKeys: String, CodingKey {
        case type
        case run
        case approval
        case agentType
        case state
        case session
        case sessionId
        case commandId
        case reason
        case message
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
        case "session.opened":
            self = .sessionOpened(try container.decode(ConsoleSession.self, forKey: .session))
        case "session.updated":
            self = .sessionUpdated(try container.decode(ConsoleSession.self, forKey: .session))
        case "session.closed":
            self = .sessionClosed(sessionId: try container.decode(String.self, forKey: .sessionId))
        case "command.rejected":
            self = .commandRejected(
                commandId: try container.decode(String.self, forKey: .commandId),
                reason: try container.decode(String.self, forKey: .reason)
            )
        case "command.info":
            self = .commandInfo(
                commandId: try container.decode(String.self, forKey: .commandId),
                message: try container.decode(String.self, forKey: .message)
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

/// 리모컨 지시 요청 body. 백엔드 `POST /v1/console/command` 계약(text + 선택 힌트 + commandId).
public struct CommandRequest: Encodable, Sendable {
    public let text: String
    public let agentTypeHint: String?
    public let commandId: String

    public init(text: String, agentTypeHint: String?, commandId: String) {
        self.text = text
        self.agentTypeHint = agentTypeHint
        self.commandId = commandId
    }
}

/// `POST /v1/console/sessions/:id/inject` 요청 바디.
public struct InjectRequestBody: Codable {
    public let text: String

    public init(text: String) {
        self.text = text
    }
}

/// 리모컨 명령의 낙관적 진행 단계.
public enum PendingPhase: String, Sendable, Equatable {
    case sent      // 전송·접수(202) — codex 준비 대기
    case running   // run.started 매칭됨
    case done      // run.finished 매칭됨(곧 제거)
    case failed    // 전송 실패 또는 타임아웃
}

/// 전송한 지시의 로컬 추적 항목. SSE run 이벤트로 phase 를 전이한다.
public struct PendingCommand: Identifiable, Sendable, Equatable {
    public let id: UUID
    public let text: String
    public let agentTypeHint: String?
    public var resolvedAgentType: String?
    public var boundRunId: String?
    public let sentAt: Date
    public var phase: PendingPhase
    public var reason: String?

    public init(
        id: UUID,
        text: String,
        agentTypeHint: String?,
        resolvedAgentType: String? = nil,
        boundRunId: String? = nil,
        sentAt: Date,
        phase: PendingPhase,
        reason: String? = nil
    ) {
        self.id = id
        self.text = text
        self.agentTypeHint = agentTypeHint
        self.resolvedAgentType = resolvedAgentType
        self.boundRunId = boundRunId
        self.sentAt = sentAt
        self.phase = phase
        self.reason = reason
    }

    /// 카드 매칭용 — 확정된 agentType 우선, 없으면 최초 힌트.
    public var effectiveAgentType: String? { resolvedAgentType ?? agentTypeHint }
}
