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

    @State private var commandText = ""

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
                            AgentCardView(agent: agent, pendingCommands: store.pendingCommands, onSend: onSend)
                        }
                    }
                }

                if !store.approvals.isEmpty {
                    approvalPanel
                }
            }
            .padding(24)
        }
        .frame(minWidth: 720, minHeight: 520)
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
                HStack(spacing: 4) {
                    Text(command.phase.badgeIcon)
                    Text(command.text)
                        .font(.caption)
                        .lineLimit(1)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(
                    Capsule().fill(Color.primary.opacity(0.06))
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
        let names = bottleneckAgents.map(\.displayName).joined(separator: ", ")
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

    /// 특정 에이전트로 확정되지 않은(힌트 없는) pending — 헤더 커맨드바에 전역 진행 표시로 노출.
    /// 힌트가 있는 pending 은 해당 AgentCardView 가 자체적으로 배지로 보여준다.
    private var globalPendingCommands: [PendingCommand] {
        store.pendingCommands.filter { $0.agentTypeHint == nil }
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
