import ConsoleCore
import SwiftUI

/// 관제 대시보드 루트. 부팅 시 스냅샷 1콜로 상태를 싣고, 이후 SSE 로 실시간 갱신한다.
/// 스트림이 끊기면 지수 백오프로 재연결하고 스냅샷을 재동기화한다.
/// 읽기·표시 전용 — 여기서 에이전트를 호출하거나 승인을 처리하지 않는다.
struct DashboardView: View {
    let client: ConsoleClient
    /// 연결 대상 표시용(빈 상태 안내에 노출). 동작에는 영향 없음.
    let baseURLLabel: String

    @StateObject private var store = ConsoleStore()
    @State private var status: ConnectionStatus = .connecting

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: 14)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                if !bottleneckAgents.isEmpty {
                    bottleneckBanner
                }

                if store.agents.isEmpty {
                    emptyState
                } else {
                    LazyVGrid(columns: columns, spacing: 14) {
                        ForEach(store.agents) { agent in
                            AgentCardView(agent: agent)
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
        .task {
            await connect()
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
            ForEach(store.sessions) { session in
                SessionRowView(session: session)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04))
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

    // MARK: - 연결 배선

    private func connect() async {
        var backoffSeconds: UInt64 = 1
        while !Task.isCancelled {
            do {
                let snapshot = try await client.fetchSnapshot()
                store.apply(snapshot: snapshot)
                status = .live
                backoffSeconds = 1
                for await event in await client.events() {
                    store.apply(event: event)
                }
            } catch {
                // fetch/stream 실패 → 아래 백오프 후 재시도
            }
            if Task.isCancelled {
                return
            }
            status = .reconnecting
            try? await Task.sleep(nanoseconds: backoffSeconds * 1_000_000_000)
            backoffSeconds = min(backoffSeconds * 2, 30)
        }
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
