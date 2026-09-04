import ConsoleCore
import SwiftUI

/// 관제 대시보드 루트. 부팅 시 스냅샷 1콜로 상태를 싣고, 이후 SSE 로 실시간 갱신한다.
/// 스트림이 끊기면 지수 백오프로 재연결하고 스냅샷을 재동기화한다.
/// 지시는 대상이 정해진 것만 여기서 보낸다(부서 카드). 담당자를 정하지 않는 지시는
/// 오피스 탭의 대표(나) 자리 하나로 모았다 — 같은 입구가 두 탭에 있으면 어느 쪽이 정본인지
/// 알 수 없고, 그 지시의 진행 배지도 두 곳에서 갈린다.
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

    @State private var injectTarget: ConsoleSession?
    @State private var injectText = ""
    @State private var injectNotice: String?
    @State private var injectNoticeIsFailure = false
    @State private var isInjecting = false
    @State private var selectedApproval: ConsoleApproval?

    private let columns = [GridItem(.adaptive(minimum: Layout.cardMinWidth), spacing: Spacing.md)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                header

                if !bottleneckAgents.isEmpty {
                    bottleneckBanner
                }

                if store.agents.isEmpty {
                    emptyState
                } else {
                    LazyVGrid(columns: columns, spacing: Spacing.md) {
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
            .padding(Spacing.xl)
        }
        .frame(minWidth: Layout.windowMinWidth, minHeight: Layout.contentMinHeight)
        .sheet(item: $injectTarget) { target in
            injectSheet(target: target)
        }
    }

    // MARK: - 헤더

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text("이대리 주식회사")
                    .font(Typography.screenTitle)
                Spacer()
                connectionIndicator
            }

            HStack(spacing: Spacing.lg) {
                summaryChip(count: countOf(.inProgress), label: "진행 중", color: ConsoleAgentState.inProgress.accentColor)
                summaryChip(count: store.approvals.count, label: "승인 대기", color: ConsoleAgentState.awaitingApproval.accentColor)
                summaryChip(count: countOf(.awaitingIntegration), label: "연동 대기", color: ConsoleAgentState.awaitingIntegration.accentColor)
                summaryChip(count: countOf(.completed), label: "완료", color: ConsoleAgentState.completed.accentColor)
                summaryChip(count: store.sessions.count, label: "내 세션", color: Color(red: 0.36, green: 0.78, blue: 0.63))
                Spacer()
                if !store.serverTime.isEmpty {
                    Text(formatTime(store.serverTime))
                        .font(Typography.metricMono)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var connectionIndicator: some View {
        HStack(spacing: Spacing.sm) {
            Circle()
                .fill(status.color)
                .frame(width: Stroke.dot, height: Stroke.dot)
            Text(status.label)
                .font(Typography.captionEmphasis)
                .foregroundStyle(.secondary)
        }
    }

    private func summaryChip(count: Int, label: String, color: Color) -> some View {
        HStack(spacing: Spacing.sm) {
            Text("\(count)")
                .font(Typography.metric)
                .foregroundStyle(color)
            Text(label)
                .font(Typography.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - 병목 배너

    private var bottleneckBanner: some View {
        let names = bottleneckAgents.map(\.roleName).joined(separator: ", ")
        return HStack(spacing: Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(ConsoleAgentState.awaitingIntegration.accentColor)
            Text("연동 대기로 멈춘 부서: \(names)")
                .font(Typography.bodyEmphasis)
            Spacer(minLength: 0)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .fill(ConsoleAgentState.awaitingIntegration.tintColor)
        )
    }

    // MARK: - 승인 대기 패널

    private var approvalPanel: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("승인 대기 \(store.approvals.count)건")
                .font(Typography.sectionTitle)
            if let notice = store.approvalNotice {
                Text(notice)
                    .font(Typography.caption)
                    .foregroundStyle(Color.red)
            }
            ForEach(store.approvals) { approval in
                HStack(spacing: Spacing.sm) {
                    Circle()
                        .fill(ConsoleAgentState.awaitingApproval.accentColor)
                        .frame(width: Stroke.dot, height: Stroke.dot)
                    Text(approval.title)
                        .font(Typography.body)
                        .lineLimit(2)
                        .onTapGesture { selectedApproval = approval }
                    Spacer(minLength: 0)
                    Text(formatTime(approval.createdAt))
                        .font(Typography.metricMonoSmall)
                        .foregroundStyle(.secondary)
                    HStack(spacing: Spacing.sm) {
                        Button("승인") { onApprove(approval.id) }
                        Button("거절") { onReject(approval.id) }
                            .tint(.red)
                    }
                }
                .padding(.vertical, Spacing.tight)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .fill(ConsoleAgentState.awaitingApproval.tintColor)
        )
        .sheet(item: $selectedApproval) { approval in
            ApprovalDetailSheet(
                approval: approval,
                onApprove: { onApprove($0); selectedApproval = nil },
                onReject: { onReject($0); selectedApproval = nil }
            )
        }
    }

    // MARK: - 내 작업 세션 패널

    private var sessionPanel: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("내 작업 세션 \(store.sessions.count)개 (로컬 CLI)")
                .font(Typography.sectionTitle)
            if let injectNotice {
                Text(injectNotice)
                    .font(Typography.caption)
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
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .fill(Color.primary.opacity(0.04))
        )
    }

    private func injectSheet(target: ConsoleSession) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("\(target.name)에 작업 주입")
                .font(Typography.sectionTitle)
            Text(
                target.state == "active"
                    ? "현재 작업이 끝나면 다음 턴에 전달됩니다."
                    : "다음에 이 세션을 이어 쓸 때 전달됩니다"
            )
            .font(Typography.caption)
            .foregroundStyle(.secondary)

            TextEditor(text: $injectText)
                .font(Typography.editorBody)
                .frame(minHeight: Layout.editorMinHeight)
                .padding(Spacing.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
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
        .padding(Spacing.xl)
        .frame(minWidth: Layout.sheetMinWidth)
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
        VStack(spacing: Spacing.md) {
            Image(systemName: status == .live ? "tray" : "bolt.horizontal.circle")
                .font(Typography.emptyStateIcon)
                .foregroundStyle(.secondary)
            Text(emptyStateTitle)
                .font(Typography.emptyStateTitle)
            Text(emptyStateMessage)
                .font(Typography.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xxl * 2)
        .padding(.horizontal, Spacing.xxl)
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
