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
                    onReject: reject,
                    onInject: inject
                )
            case .office:
                OfficeView(
                    store: store,
                    onSend: sendCommand,
                    onApprove: approve,
                    onReject: reject
                )
            }
        }
        .frame(minWidth: 720, minHeight: 560)
        .task {
            startPendingJanitor()
            startSnapshotResync()
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
        resolveApproval(id: id, action: "승인") { try await client.applyApproval(id: id) }
    }

    func reject(id: String) {
        resolveApproval(id: id, action: "거절") { try await client.cancelApproval(id: id) }
    }

    /// 승인/거절 공통 경로. 성공하면 SSE 를 기다리지 않고 카드를 즉시 걷어내고,
    /// 실패하면 사유를 화면에 남긴 뒤 스냅샷으로 재동기화한다.
    /// 실패의 상당수는 화면이 낡아 생긴 것(TTL 만료된 카드를 누름)이라 재동기화가 곧 정정이다.
    private func resolveApproval(
        id: String,
        action: String,
        perform: @escaping () async throws -> Void
    ) {
        Task {
            do {
                try await perform()
                await MainActor.run {
                    store.resolveApprovalLocally(id: id)
                    store.setApprovalNotice(nil)
                }
            } catch {
                let reason = approvalFailureReason(error)
                await MainActor.run { store.setApprovalNotice("\(action) 실패 — \(reason)") }
                await resyncSnapshot()
            }
        }
    }

    /// write 실패를 사용자가 다음에 뭘 해야 할지 아는 문장으로 옮긴다.
    private func approvalFailureReason(_ error: Error) -> String {
        guard case let ConsoleClientError.badStatus(status) = error else {
            return "백엔드에 연결하지 못했습니다. 주소(\(baseURLLabel))와 실행 여부를 확인하세요."
        }
        switch status {
        case 404, 409, 412:
            return "이미 처리됐거나 만료된 요청입니다. 목록을 새로 고쳤습니다."
        case 401, 403:
            return "콘솔 write 권한이 거부됐습니다(토큰/loopback 확인)."
        case 503:
            return "백엔드에 CONSOLE_OWNER_SLACK_USER_ID 가 설정되지 않았습니다."
        default:
            return "백엔드 오류 (HTTP \(status))."
        }
    }

    func inject(sessionId: String, text: String) async throws -> InjectOutcome {
        try await client.postInject(sessionId: sessionId, text: text)
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

    /// 스냅샷 재동기화 루프.
    /// 승인 카드는 TTL(30분)이 지나면 서버 목록에서 즉시 빠지지만 `approval.resolved` 는
    /// preview-sweeper cron 이 돌 때만 발행된다. 그 공백 동안 SSE 만 보는 화면은 이미 죽은
    /// 카드를 계속 들고 있게 되므로, 주기적으로 서버 상태를 정본으로 다시 싣는다.
    private func startSnapshotResync() {
        Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if Task.isCancelled {
                    return
                }
                await resyncSnapshot()
            }
        }
    }

    /// 서버 스냅샷을 정본으로 화면 상태를 교체한다. 실패하면 다음 주기에 다시 시도한다.
    private func resyncSnapshot() async {
        guard let snapshot = try? await client.fetchSnapshot() else {
            return
        }
        await MainActor.run { store.apply(snapshot: snapshot) }
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
