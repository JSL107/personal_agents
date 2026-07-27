import Combine
import Foundation

/// 부팅 스냅샷을 초기 상태로 싣고, SSE 증분 이벤트를 그 위에 적용하는 관측 가능한 상태 스토어.
/// SwiftUI 뷰가 `@Published` 프로퍼티를 바인딩한다. 이벤트 적용은 UI 갱신을 유발하므로
/// 호출자(B5 배선)가 메인 스레드에서 `apply(...)` 를 호출해야 한다.
public final class ConsoleStore: ObservableObject {
    @Published public private(set) var agents: [ConsoleAgent] = []
    @Published public private(set) var runs: [ConsoleRun] = []
    @Published public private(set) var approvals: [ConsoleApproval] = []
    @Published public private(set) var sessions: [ConsoleSession] = []
    @Published public private(set) var serverTime: String = ""

    public init() {}

    /// 부팅 시(또는 재연결 후 재동기화) 전체 상태를 교체한다.
    public func apply(snapshot: ConsoleSnapshot) {
        agents = snapshot.agents
        runs = snapshot.runs
        approvals = snapshot.approvals
        sessions = snapshot.sessions
        serverTime = snapshot.serverTime
    }

    /// SSE 증분 이벤트를 현재 상태 위에 적용한다.
    public func apply(event: ConsoleEvent) {
        switch event {
        case let .runStarted(run):
            upsertRun(run)
        case let .runFinished(run):
            upsertRun(run)
        case let .approvalOpened(approval):
            upsertApproval(approval)
        case let .approvalResolved(approval):
            approvals.removeAll { $0.id == approval.id }
        case let .stateChanged(agentType, state):
            changeAgentState(agentType: agentType, state: state)
        case let .sessionOpened(session):
            upsertSession(session)
        case let .sessionUpdated(session):
            upsertSession(session)
        case let .sessionClosed(sessionId):
            sessions.removeAll { $0.sessionId == sessionId }
        }
    }

    private func upsertRun(_ run: ConsoleRun) {
        if let index = runs.firstIndex(where: { $0.id == run.id }) {
            runs[index] = run
            return
        }
        runs.append(run)
    }

    private func upsertApproval(_ approval: ConsoleApproval) {
        if let index = approvals.firstIndex(where: { $0.id == approval.id }) {
            approvals[index] = approval
            return
        }
        approvals.append(approval)
    }

    private func upsertSession(_ session: ConsoleSession) {
        if let index = sessions.firstIndex(where: { $0.sessionId == session.sessionId }) {
            sessions[index] = session
            return
        }
        sessions.append(session)
    }

    /// 해당 에이전트의 상태만 교체한다. bubble 은 백엔드 소유라 건드리지 않고 다음 스냅샷에서 정정된다.
    /// 미지의 agentType 이면 아무것도 하지 않는다.
    private func changeAgentState(agentType: String, state: ConsoleAgentState) {
        guard let index = agents.firstIndex(where: { $0.agentType == agentType }) else {
            return
        }
        let current = agents[index]
        agents[index] = ConsoleAgent(
            agentType: current.agentType,
            displayName: current.displayName,
            slashCommands: current.slashCommands,
            description: current.description,
            state: state,
            bubble: current.bubble
        )
    }
}
