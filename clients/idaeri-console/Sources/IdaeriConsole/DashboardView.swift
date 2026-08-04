import ConsoleCore
import SwiftUI

/// 관제 대시보드 루트. 부팅 시 스냅샷 1콜로 상태를 싣고, 이후 SSE 로 실시간 갱신한다.
/// 스트림이 끊기면 지수 백오프로 재연결하고 스냅샷을 재동기화한다.
/// 읽기·표시 전용 — 여기서 에이전트를 호출하거나 승인을 처리하지 않는다.
struct DashboardView: View {
    /// store·연결은 AppRootView 가 소유하고 주입한다(오피스 탭과 공유).
    @ObservedObject var store: ConsoleStore
    let status: ConnectionStatus
    /// 연결 대상 표시용(빈 상태 안내에 노출). 동작에는 영향 없음.
    let baseURLLabel: String
    /// 리모컨 write — AppRootView 가 client POST 로 배선한 액션.
    let onSend: (String, String?) -> Void
    let onApprove: (String) -> Void
    let onReject: (String) -> Void
    let onInject: (String, String) async throws -> InjectOutcome

    @State private var commandText = ""
    @State private var injectTarget: ConsoleSession?
    @State private var injectText = ""
    @State private var injectNotice: String?
    @State private var injectNoticeIsFailure = false
    @State private var isInjecting = false

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: 14)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                commandBar

                if !bottleneckAgents.isEmpty {
                    bottleneckBanner
                }

                if store.agents.isEmpty {
                    emptyState
                } else {
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(store.agents) { agent in
                            AgentCardView(
                                agent: agent,
                                pendingCommands: store.pendingCommands,
                                onSend: onSend,
                                onAcknowledge: {
                                    store.acknowledgeCompletion(agentType: agent.agentType)
                                }
                            )
                        }
                    }
                }

                if !store.approvals.isEmpty {
                    approvalPanel
                }

                if !store.sessions.isEmpty {
                    sessionPanel
                }
            }
            .padding(24)
        }
        .frame(minWidth: 720, minHeight: 520)
        .sheet(item: $injectTarget) { target in
            injectSheet(target: target)
        }
    }

    // MARK: - 커맨드바

    private var commandBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                TextField("에이전트에게 지시…", text: $commandText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(sendGlobalCommand)
                Button("전송", action: sendGlobalCommand)
                    .disabled(commandText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            if !globalPendingCommands.isEmpty {
                pendingBadgeRow
            }
        }
    }

    private func sendGlobalCommand() {
        onSend(commandText, nil)
        commandText = ""
    }

    private var pendingBadgeRow: some View {
        HStack(spacing: 6) {
            ForEach(globalPendingCommands) { command in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(command.phase.badgeIcon)
                        Text(command.text)
                            .font(.caption)
                            .lineLimit(1)
                    }
                    if let reason = command.reason {
                        Text(reason)
                            .font(.caption2)
                            .foregroundStyle(command.phase == .failed ? Color.red : Color.secondary)
                            .lineLimit(2)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.primary.opacity(0.06))
                )
            }
        }
    }

    // MARK: - 헤더

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("이대리 주식회사")
                    .font(.title.bold())
                Spacer()
                connectionIndicator
            }

            HStack(spacing: 16) {
                summaryChip(count: countOf(.inProgress), label: "진행 중", color: ConsoleAgentState.inProgress.accentColor)
                summaryChip(count: store.approvals.count, label: "승인 대기", color: ConsoleAgentState.awaitingApproval.accentColor)
                summaryChip(count: countOf(.awaitingIntegration), label: "연동 대기", color: ConsoleAgentState.awaitingIntegration.accentColor)
                summaryChip(count: countOf(.completed), label: "완료", color: ConsoleAgentState.completed.accentColor)
                summaryChip(count: store.sessions.count, label: "내 세션", color: Color(red: 0.36, green: 0.78, blue: 0.63))
                Spacer()
                if !store.serverTime.isEmpty {
                    Text(formatTime(store.serverTime))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var connectionIndicator: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(status.color)
                .frame(width: 9, height: 9)
            Text(status.label)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }

    private func summaryChip(count: Int, label: String, color: Color) -> some View {
        HStack(spacing: 6) {
            Text("\(count)")
                .font(.title3.bold())
                .foregroundStyle(color)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - 병목 배너

    private var bottleneckBanner: some View {
        let names = bottleneckAgents.map(\.roleName).joined(separator: ", ")
        return HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(ConsoleAgentState.awaitingIntegration.accentColor)
            Text("연동 대기로 멈춘 부서: \(names)")
                .font(.callout.weight(.medium))
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(ConsoleAgentState.awaitingIntegration.tintColor)
        )
    }

    // MARK: - 승인 대기 패널

    private var approvalPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("승인 대기 \(store.approvals.count)건")
                .font(.headline)
            if let notice = store.approvalNotice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(Color.red)
            }
            ForEach(store.approvals) { approval in
                HStack(spacing: 10) {
                    Circle()
                        .fill(ConsoleAgentState.awaitingApproval.accentColor)
                        .frame(width: 7, height: 7)
                    Text(approval.title)
                        .font(.callout)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    Text(formatTime(approval.createdAt))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 6) {
                        Button("승인") { onApprove(approval.id) }
                        Button("거절") { onReject(approval.id) }
                            .tint(.red)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(ConsoleAgentState.awaitingApproval.tintColor)
        )
    }

    // MARK: - 내 작업 세션 패널

    private var sessionPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("내 작업 세션 \(store.sessions.count)개 (로컬 CLI)")
                .font(.headline)
            if let injectNotice {
                Text(injectNotice)
                    .font(.caption)
                    .foregroundStyle(injectNoticeIsFailure ? Color.red : Color.secondary)
            }
            ForEach(store.sessions) { session in
                SessionRowView(
                    session: session,
                    onInject: {
                        injectTarget = session
                        injectText = ""
                    }
                )
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04))
        )
    }

    private func injectSheet(target: ConsoleSession) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("\(target.name)에 작업 주입")
                .font(.headline)
            Text(
                target.state == "active"
                    ? "현재 작업이 끝나면 다음 턴에 전달됩니다."
                    : "다음에 이 세션을 이어 쓸 때 전달됩니다"
            )
            .font(.caption)
            .foregroundStyle(.secondary)

            TextEditor(text: $injectText)
                .font(.body)
                .frame(minHeight: 120)
                .padding(6)
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(Color.secondary.opacity(0.3))
                )

            HStack {
                Spacer()
                Button("취소") {
                    injectText = ""
                    injectTarget = nil
                }
                .disabled(isInjecting)
                Button {
                    submitInject(target: target)
                } label: {
                    if isInjecting {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text("주입")
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(
                    injectText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || isInjecting
                )
            }
        }
        .padding(20)
        .frame(minWidth: 380)
        .interactiveDismissDisabled(isInjecting)
    }

    private func submitInject(target: ConsoleSession) {
        let text = injectText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return
        }
        isInjecting = true
        Task {
            do {
                let outcome = try await onInject(target.sessionId, text)
                switch outcome {
                case .queued:
                    injectNotice = "큐잉됨 · 다음 턴 전달"
                    injectNoticeIsFailure = false
                case .failed(let reason):
                    injectNotice = reason
                    injectNoticeIsFailure = true
                }
            } catch {
                injectNotice = "주입 요청 실패"
                injectNoticeIsFailure = true
            }
            isInjecting = false
            injectText = ""
            injectTarget = nil
        }
    }

    // MARK: - 빈 상태 안내

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: status == .live ? "tray" : "bolt.horizontal.circle")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(.secondary)
            Text(emptyStateTitle)
                .font(.title3.weight(.semibold))
            Text(emptyStateMessage)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 80)
        .padding(.horizontal, 40)
    }

    private var emptyStateTitle: String {
        switch status {
        case .live:
            return "표시할 부서가 없습니다"
        case .connecting:
            return "백엔드에 연결하는 중…"
        case .reconnecting:
            return "백엔드에 연결하지 못했습니다"
        }
    }

    private var emptyStateMessage: String {
        switch status {
        case .live:
            return "콘솔 API 는 연결됐지만 등록된 부서가 없습니다."
        case .connecting:
            return "\(baseURLLabel) 의 콘솔 API 응답을 기다리는 중입니다."
        case .reconnecting:
            return "\(baseURLLabel) 에서 콘솔 API(/v1/console)를 찾지 못했습니다.\n콘솔 모듈이 포함된 이대리 백엔드가 이 주소에서 실행 중인지 확인하세요."
        }
    }

    // MARK: - 파생값

    private var bottleneckAgents: [ConsoleAgent] {
        store.agents.filter { $0.state == .awaitingIntegration }
    }

    /// 아직 카드로 라우팅되지 않은(힌트 없음 + run.started 로 확정되지 않음) pending 만
    /// 헤더 커맨드바에 남긴다. `run.started` 로 `resolvedAgentType` 이 채워지면 해당
    /// AgentCardView 배지로 넘어가므로 여기서는 제외 — 커맨드바·카드 중복 표시 방지.
    /// 타임아웃 실패(`.failed`, resolvedAgentType 여전히 nil)는 계속 커맨드바에 남아 ⚠️ 로 보인다.
    private var globalPendingCommands: [PendingCommand] {
        store.pendingCommands.filter { $0.agentTypeHint == nil && $0.resolvedAgentType == nil }
    }

    private func countOf(_ state: ConsoleAgentState) -> Int {
        store.agents.filter { $0.state == state }.count
    }

    private func formatTime(_ iso: String) -> String {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        guard let date = withFraction.date(from: iso) ?? plain.date(from: iso) else {
            return iso
        }
        let output = DateFormatter()
        output.dateFormat = "MM-dd HH:mm:ss"
        return output.string(from: date)
    }
}

/// 상단 우측에 표시되는 SSE 연결 상태.
enum ConnectionStatus {
    case connecting
    case live
    case reconnecting

    var label: String {
        switch self {
        case .connecting:
            return "연결 중"
        case .live:
            return "실시간"
        case .reconnecting:
            return "재연결 중"
        }
    }

    var color: Color {
        switch self {
        case .connecting:
            return Color(white: 0.6)
        case .live:
            return Color(red: 0.36, green: 0.78, blue: 0.63)
        case .reconnecting:
            return Color(red: 0.96, green: 0.78, blue: 0.25)
        }
    }
}
