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
    @Published public private(set) var pendingCommands: [PendingCommand] = []

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
            bindPendingOnRunStarted(run)
        case let .runFinished(run):
            upsertRun(run)
            completePendingOnRunFinished(run)
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
        case let .commandRejected(commandId, reason):
            markCommand(commandId: commandId, phase: .failed, reason: reason)
        case let .commandInfo(commandId, message):
            annotateCommand(commandId: commandId, reason: message)
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

    /// 낙관적 지시 추가. 반환한 id 로 뷰가 client POST 후 실패 시 markCommandFailed 를 호출한다.
    @discardableResult
    public func enqueueCommand(
        text: String,
        agentTypeHint: String?,
        id: UUID = UUID(),
        sentAt: Date = Date()
    ) -> UUID {
        pendingCommands.append(
            PendingCommand(id: id, text: text, agentTypeHint: agentTypeHint, sentAt: sentAt, phase: .sent)
        )
        return id
    }

    /// 전송 실패(네트워크/4xx) 처리.
    public func markCommandFailed(id: UUID) {
        guard let index = pendingCommands.firstIndex(where: { $0.id == id }) else {
            return
        }
        pendingCommands[index].phase = .failed
    }

    /// 백엔드 command event 의 문자열 UUID와 정확히 일치하는 pending만 상태·이유를 바꾼다.
    private func markCommand(commandId: String, phase: PendingPhase, reason: String?) {
        guard
            let id = UUID(uuidString: commandId),
            let index = pendingCommands.firstIndex(where: { $0.id == id })
        else {
            return
        }
        pendingCommands[index].phase = phase
        pendingCommands[index].reason = reason
    }

    /// 안내 이벤트는 phase 전이 없이 이유만 기록한다.
    private func annotateCommand(commandId: String, reason: String) {
        guard
            let id = UUID(uuidString: commandId),
            let index = pendingCommands.firstIndex(where: { $0.id == id })
        else {
            return
        }
        pendingCommands[index].reason = reason
    }

    /// pending 제거(완료 후 뷰 타이머 또는 사용자 dismiss).
    public func removeCommand(id: UUID) {
        pendingCommands.removeAll { $0.id == id }
    }

    /// timeout 초 이상 .sent 로 남은 pending 을 .failed 로 강등(codex 무응답 감지). 뷰 타이머가 주기 호출.
    public func expireStalePendings(now: Date = Date(), timeout: TimeInterval = 60) {
        for index in pendingCommands.indices where pendingCommands[index].phase == .sent {
            if now.timeIntervalSince(pendingCommands[index].sentAt) >= timeout {
                pendingCommands[index].phase = .failed
            }
        }
    }

    /// run.started 를 미매칭 pending 에 바인딩. 힌트 일치 우선, 없으면 힌트 없는(전역) 가장 오래된 .sent.
    private func bindPendingOnRunStarted(_ run: ConsoleRun) {
        let unbound = pendingCommands.indices
            .filter { pendingCommands[$0].phase == .sent && pendingCommands[$0].boundRunId == nil }
            .sorted { pendingCommands[$0].sentAt < pendingCommands[$1].sentAt }
        let matched = unbound.first { pendingCommands[$0].agentTypeHint == run.agentType }
            ?? unbound.first { pendingCommands[$0].agentTypeHint == nil }
        guard let index = matched else {
            return
        }
        pendingCommands[index].boundRunId = run.id
        pendingCommands[index].resolvedAgentType = run.agentType
        pendingCommands[index].phase = .running
    }

    /// 바인딩된 run 이 끝나면 해당 pending 을 .done 으로. 제거는 뷰가 관장(완료 표시 후 removeCommand).
    private func completePendingOnRunFinished(_ run: ConsoleRun) {
        guard let index = pendingCommands.firstIndex(where: { $0.boundRunId == run.id }) else {
            return
        }
        pendingCommands[index].phase = .done
    }
}
