import Combine
import Foundation

/// 확인 처리로 대기로 내릴 때 쓰는 말풍선. 말풍선 문구는 백엔드가 소유하지만
/// (`derive-agent-state.ts` 의 `BUBBLES`), 이 전이는 앱 안에서만 일어나 서버에 물어볼 수 없다.
/// 백엔드의 WAITING 문구가 바뀌면 여기도 함께 바꿔야 한다.
private let waitingBubble = "업무 대기중"

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
    /// 승인/거절 write 결과 안내. 실패 사유를 담고, 성공하면 nil 로 지워진다.
    /// 대시보드·오피스 어느 탭에서 눌러도 같은 store 를 보므로 안내가 공유된다.
    @Published public private(set) var approvalNotice: String?
    /// 처리한 SSE 이벤트를 방출한다(연출 트리거용). 스냅샷 적용은 방출하지 않는다.
    public let eventStream = PassthroughSubject<ConsoleEvent, Never>()

    /// 사람이 눈으로 확인한 완료. agentType → 확인 당시의 `lastFinishedRunId`.
    ///
    /// 서버는 최근 종료 창 안이면 계속 완료로 보내주므로, 확인한 뒤에도 스냅샷마다 초록이
    /// 되살아난다. 확인한 런 id 를 기억해 같은 런이면 대기로 내려두고, 새 런이 끝나
    /// 값이 바뀌면 다시 완료로 보이게 한다.
    ///
    /// 종료 시각이 아니라 런 id 를 키로 쓴다 — 시각은 DB 기록과 SSE 발행이 각각 생성해 같은
    /// 런에서도 어긋나므로, 라이브로 확인한 완료가 다음 스냅샷에서 되살아난다.
    private var acknowledgedFinishes: [String: String] = [:]

    public init() {}

    /// 부팅 시(또는 재연결 후 재동기화) 전체 상태를 교체한다.
    public func apply(snapshot: ConsoleSnapshot) {
        agents = snapshot.agents.map(demoteIfAcknowledged)
        runs = snapshot.runs
        approvals = snapshot.approvals
        sessions = snapshot.sessions
        serverTime = snapshot.serverTime
    }

    /// 이 에이전트의 현재 완료를 "확인했다" 로 표시해 대기로 내린다.
    /// 완료 상태가 아니거나 어떤 런의 완료인지 모르면 아무것도 하지 않는다(확인할 대상이 없다).
    public func acknowledgeCompletion(agentType: String) {
        guard
            let index = agents.firstIndex(where: { $0.agentType == agentType }),
            agents[index].state == .completed,
            let runId = agents[index].lastFinishedRunId
        else {
            return
        }
        acknowledgedFinishes[agentType] = runId
        agents[index] = demoteIfAcknowledged(agents[index])
    }

    /// 확인한 런과 같은 완료면 대기로 내린다. 그 밖에는 서버 상태를 그대로 쓴다.
    private func demoteIfAcknowledged(_ agent: ConsoleAgent) -> ConsoleAgent {
        guard
            agent.state == .completed,
            let runId = agent.lastFinishedRunId,
            acknowledgedFinishes[agent.agentType] == runId
        else {
            return agent
        }
        return ConsoleAgent(
            agentType: agent.agentType,
            displayName: agent.displayName,
            slashCommands: agent.slashCommands,
            description: agent.description,
            state: .waiting,
            bubble: waitingBubble,
            lastFinishedRunId: agent.lastFinishedRunId
        )
    }

    /// SSE 증분 이벤트를 현재 상태 위에 적용한다.
    public func apply(event: ConsoleEvent) {
        switch event {
        case let .runStarted(run):
            upsertRun(run)
            bindPendingOnRunStarted(run)
        case let .runFinished(run):
            upsertRun(run)
            recordFinishedRun(run)
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
        eventStream.send(event)
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
    ///
    /// 이미 확인한 완료로 되돌아가는 것은 막는다. 백엔드는 `run.finished` 를 항상 `state.changed`
    /// 바로 앞에 발행하므로, 이 시점의 `lastFinishedRunId` 는 방금 끝난 런의 것이다 — 새 완료는
    /// 확인 기록과 런 id 가 달라 그대로 통과한다.
    private func changeAgentState(agentType: String, state: ConsoleAgentState) {
        guard let index = agents.firstIndex(where: { $0.agentType == agentType }) else {
            return
        }
        let current = agents[index]
        agents[index] = demoteIfAcknowledged(
            ConsoleAgent(
                agentType: current.agentType,
                displayName: current.displayName,
                slashCommands: current.slashCommands,
                description: current.description,
                state: state,
                bubble: current.bubble,
                lastFinishedRunId: current.lastFinishedRunId
            )
        )
    }

    /// `run.finished` 가 알려준 런 id 를 카드에 반영한다. 스냅샷(최대 30초 지연)을 기다리지 않고
    /// 확인 판정의 키를 최신으로 만들어, 새 완료가 이전 확인 때문에 가려지는 것을 막는다.
    ///
    /// 이 id 는 스냅샷이 주는 `lastFinishedRunId` 와 같은 값이라(둘 다 AgentRun 레코드 id)
    /// 라이브로 확인한 완료가 다음 스냅샷에서 "다른 완료" 로 오인되지 않는다.
    private func recordFinishedRun(_ run: ConsoleRun) {
        guard
            run.finishedAt != nil,
            let index = agents.firstIndex(where: { $0.agentType == run.agentType })
        else {
            return
        }
        let current = agents[index]
        agents[index] = ConsoleAgent(
            agentType: current.agentType,
            displayName: current.displayName,
            slashCommands: current.slashCommands,
            description: current.description,
            state: current.state,
            bubble: current.bubble,
            lastFinishedRunId: run.id
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

    /// 승인/거절 성공을 SSE 도착 전에 낙관적으로 반영한다.
    /// 뒤이어 오는 `approval.resolved` 는 같은 건을 다시 지우려 하므로 멱등하다.
    public func resolveApprovalLocally(id: String) {
        approvals.removeAll { $0.id == id }
    }

    /// 승인/거절 안내 갱신. 성공 시 nil 을 넣어 이전 실패 문구를 지운다.
    public func setApprovalNotice(_ message: String?) {
        approvalNotice = message
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
