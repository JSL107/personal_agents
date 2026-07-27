import ConsoleCore
import SwiftUI

/// 콘솔 루트. ConsoleStore 와 연결(스냅샷+SSE+백오프)을 소유하고,
/// 대시보드↔오피스 탭을 전환한다. 두 탭이 같은 store 를 관측한다.
struct AppRootView: View {
    let client: ConsoleClient
    let baseURLLabel: String

    @StateObject private var store = ConsoleStore()
    @State private var status: ConnectionStatus = .connecting
    @State private var tab: Tab = .dashboard

    private enum Tab: Hashable {
        case dashboard
        case office
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("보기", selection: $tab) {
                    Text("대시보드").tag(Tab.dashboard)
                    Text("오피스").tag(Tab.office)
                }
                .pickerStyle(.segmented)
                .frame(width: 240)
                Spacer()
            }
            .padding(10)

            Divider()

            switch tab {
            case .dashboard:
                DashboardView(
                    store: store,
                    status: status,
                    baseURLLabel: baseURLLabel,
                    onSend: sendCommand,
                    onApprove: approve,
                    onReject: reject
                )
            case .office:
                OfficeView(store: store)
            }
        }
        .frame(minWidth: 720, minHeight: 560)
        .task {
            startPendingJanitor()
            await connect()
        }
    }

    // MARK: - 리모컨 write

    /// 지시 전송 — 낙관적 pending 후 POST, 실패 시 롤백 표시.
    func sendCommand(text: String, agentTypeHint: String?) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }
        let id = store.enqueueCommand(text: trimmed, agentTypeHint: agentTypeHint)
        Task {
            do {
                try await client.postCommand(
                    text: trimmed,
                    agentTypeHint: agentTypeHint,
                    commandId: id.uuidString
                )
            } catch {
                await MainActor.run { store.markCommandFailed(id: id) }
            }
        }
    }

    func approve(id: String) {
        Task { try? await client.applyApproval(id: id) }
    }

    func reject(id: String) {
        Task { try? await client.cancelApproval(id: id) }
    }

    /// pending 유지보수 루프 — 타임아웃 강등 + 완료건 정리. 뷰 lifetime 동안 5초 주기.
    private func startPendingJanitor() {
        Task { @MainActor in
            while !Task.isCancelled {
                store.expireStalePendings()
                for command in store.pendingCommands where command.phase == .done {
                    store.removeCommand(id: command.id)
                }
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

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
                // 아래 백오프 후 재시도
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
