import ConsoleCore
import SwiftUI

// 백엔드의 보관된 작업 제안과 앱의 제안 카드를 같은 30분에 만료시킨다.
private let answeredCommandTTL: TimeInterval = 30 * 60

/// 콘솔 루트. ConsoleStore 와 연결(스냅샷+SSE+백오프)을 소유하고,
/// 대시보드↔오피스 탭을 전환한다. 두 탭이 같은 store 를 관측한다.
struct AppRootView: View {
    let client: ConsoleClient
    let baseURLLabel: String

    @StateObject private var store = ConsoleStore()
    @State private var status: ConnectionStatus = .connecting
    /// 마지막으로 스냅샷을 다시 받은 시각. 상태 변경이 몰릴 때 요청 폭주를 막는 최소 간격 기준.
    @State private var lastResyncAt: Date?
    @State private var tab: Tab = .dashboard
    /// 담당자 미지정 지시 바가 열렸는지. 오피스 탭의 상태지만 여기서 소유한다 — 메뉴에서 열 때는
    /// 탭 전환과 함께 세팅돼야 하고, 그 시점의 `OfficeView` 는 아직 만들어지지 않아 통지를 직접
    /// 받을 수 없다.
    @State private var isPresidentBarOpen = false

    private enum Tab: Hashable {
        case dashboard
        case office
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Spacing.lg) {
                HStack(spacing: Spacing.sm) {
                    Circle().fill(Color(red: 0.96, green: 0.33, blue: 0.27)).frame(width: 12, height: 12)
                    Circle().fill(Color(red: 1.00, green: 0.68, blue: 0.24)).frame(width: 12, height: 12)
                    Circle().fill(Color(red: 0.27, green: 0.72, blue: 0.43)).frame(width: 12, height: 12)
                }
                HStack(spacing: Spacing.sm) {
                    ZStack {
                        Circle().fill(CozyPalette.butter.opacity(0.30))
                        Image(systemName: "sun.max.fill")
                            .foregroundStyle(CozyPalette.butter)
                    }
                    .frame(width: 32, height: 32)
                    Text("이대리 오피스")
                        .font(.title3.bold())
                        .foregroundStyle(CozyPalette.ink)
                }
                Picker("보기", selection: $tab) {
                    Label("대시보드", systemImage: "rectangle.grid.2x2.fill").tag(Tab.dashboard)
                    Label("오피스", systemImage: "person.3.fill").tag(Tab.office)
                }
                .pickerStyle(.segmented)
                .frame(width: Layout.sidebarWidth)
                Spacer()
                HStack(spacing: Spacing.sm) {
                    Circle().fill(status.color).frame(width: Stroke.dot, height: Stroke.dot)
                    Text(status.label).font(Typography.captionEmphasis).foregroundStyle(.secondary)
                }
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
                .background(CozyPalette.canvas, in: Capsule())
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .background(CozyPalette.surface)
            .overlay(alignment: .bottom) {
                Rectangle().fill(CozyPalette.outline.opacity(0.12)).frame(height: 1)
            }

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
                    onReject: reject,
                    isPresidentBarOpen: $isPresidentBarOpen
                )
            }
        }
        .background(CozyPalette.canvas)
        .frame(minWidth: Layout.windowMinWidth, minHeight: Layout.windowMinHeight)
        .onReceive(
            NotificationCenter.default.publisher(for: .idaeriOpenPresidentCommand)
        ) { _ in
            // 지시 바는 오피스 탭에만 있다. 대시보드를 보고 있을 때 눌렸다면 탭까지 옮겨 준다 —
            // 안 그러면 메뉴를 눌러도 아무 일도 일어나지 않는다.
            tab = .office
            isPresidentBarOpen = true
        }
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
                for command in store.pendingCommands
                    where command.phase == .answered
                    && Date().timeIntervalSince(command.sentAt) >= answeredCommandTTL
                {
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
        lastResyncAt = Date()
        await resyncBriefing()
    }

    /// 대표 브리핑을 받아 화면에 얹는다. 실패하면 조용히 넘긴다 — 집계가 없다고 관제가
    /// 멈추면 장식이 본체를 죽이는 셈이다.
    private func resyncBriefing() async {
        guard let briefing = try? await client.fetchBriefing() else {
            return
        }
        await MainActor.run { store.apply(briefing: briefing) }
    }

    /// 상태가 바뀐 직후 스냅샷을 한 번 더 받는다.
    ///
    /// **말풍선 문구 때문은 더 이상 아니다** — `state.changed` 가 문구를 함께 싣고 오므로
    /// 그 값은 이벤트만으로 즉시 맞는다. 그래도 이 조회를 남기는 이유는 이벤트가 원리상
    /// 못 담는 값들이 있어서다.
    ///
    /// - **집계 상태**: 이벤트는 **런 한 건**의 상태를 싣지만 화면의 상태는 **그 사람 전체**의
    ///   집계다(`deriveAgentState` — 열린 승인 > 활성 런 > 마지막 종료). 같은 사람의 두 런 중
    ///   하나만 끝나거나 승인이 열린 채 새 런이 시작되면 이벤트와 집계가 갈리고, 이 조회가
    ///   그것을 정정한다.
    /// - **오늘 성공 건수**(`doneToday`, 책상 위 서류 더미) 와 **대표 브리핑**(실패 건수·할 일):
    ///   둘 다 스냅샷·브리핑 응답에만 있다.
    ///
    /// 체인 실행처럼 상태 변경이 몰릴 때 요청이 폭주하지 않도록 최소 간격을 둔다. 그 간격에
    /// 걸려 조회를 건너뛰어도 문구만은 이벤트가 실어 온 값으로 이미 맞다.
    private func resyncAfterStateChange(_ event: ConsoleEvent) async {
        // 승인이 열리거나 닫히면 할 일 보드의 첫 줄이 바로 바뀌어야 한다. 30초 주기를
        // 기다리면 방금 누른 결재가 보드에 그대로 남아 "안 눌린 것" 처럼 보인다.
        if case .approvalOpened = event {
            await resyncBriefing()
        }
        if case .approvalResolved = event {
            // 브리핑만으로는 부족하다 — 승인이 열린 동안 억제한 `IN_PROGRESS` 는 재발행되지
            // 않으므로(`ConsoleStore.hasOpenApproval`), 카드가 닫힐 때 정본을 다시 받아야
            // 그 사람의 상태가 돌아온다. `resyncSnapshot` 은 끝에서 브리핑도 함께 갱신한다.
            await resyncSnapshot()
            return
        }
        guard case .stateChanged = event else {
            return
        }
        if let lastResyncAt, Date().timeIntervalSince(lastResyncAt) < 2 {
            return
        }
        await resyncSnapshot()
    }

    private func connect() async {
        var backoffSeconds: UInt64 = 1
        while !Task.isCancelled {
            do {
                let snapshot = try await client.fetchSnapshot()
                store.apply(snapshot: snapshot)
                status = .live
                await resyncBriefing()
                backoffSeconds = 1
                for await event in await client.events() {
                    store.apply(event: event)
                    await resyncAfterStateChange(event)
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
