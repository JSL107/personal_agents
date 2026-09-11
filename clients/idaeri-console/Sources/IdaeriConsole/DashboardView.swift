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

    // 열 수를 3으로 고정하면 카드 폭(minimum 300)이 못 들어가는 창에서 카드끼리 겹친다
    // (300*3 + spacing 16*2 + padding 24*2 = 980, 창 최소폭은 720이라 항상 재현됨).
    // 실측 폭에서 들어가는 열 수(1~3)를 계산해 카드 폭은 항상 300 이상을 유지한다.
    // "3열이 카드 폭·캐릭터 배율을 고르게 유지한다"는 원래 의도를 지키기 위해 상한은 3.
    //
    // 폭은 GeometryReader 를 body 최상단(ScrollView 바깥)에 둬서 잰다. 처음엔 ScrollView
    // 안쪽에 `.background(GeometryReader{...}) + onPreferenceChange` 로 재려 했는데, 그건
    // "실측 → State 갱신 → 재렌더" 두 단계짜리라 화면에서는 결국 맞아도, 시각 회귀 렌더
    // (`DashboardPreviewRender`처럼 `layoutSubtreeIfNeeded()` 한 번만 부르고 캡처하는 경로)
    // 에서는 두 번째 재렌더가 일어나기 전에 캡처돼 버려 폭이 좁을 때의 값(최악만 1열)으로
    // 굳어버렸다 — 1280 너비로 구워도 1열만 나온 것으로 실측 확인. 부모가 이미 폭을 알고
    // 아래로 내려주는 `GeometryReader` 는 한 번의 레이아웃 패스로 끝나 이 문제가 없다.
    private func gridColumns(availableWidth: CGFloat) -> [GridItem] {
        let usableWidth = max(availableWidth - Spacing.xl * 2, Layout.cardMinWidth)
        // 열 수는 **목표 폭에 가장 가까운 쪽**으로 반올림해 고른다. 하한(`cardMinWidth`)만
        // 보고 최대한 많이 넣으면 넓은 창에서 카드가 전부 최소폭으로 쪼그라들고, 반대로
        // 상한을 3으로 묶으면 카드가 800pt 넘게 벌어져 초상화가 바닥만 남는다(`cardTargetWidth`
        // 주석 참조). 반올림하면 720pt 창은 2열(카드 328), 2560pt 창은 7열(카드 345)이 되어
        // 양 끝 모두 목표 근처에 선다.
        let preferredCount = Int(
            (usableWidth / (Layout.cardTargetWidth + Spacing.lg)).rounded()
        )
        var columnCount = max(1, preferredCount)
        // 반올림이 한 열을 더 밀어 넣어 하한을 깨는 구간이 있다. 그때는 한 열을 뺀다 —
        // 카드가 하한 아래로 내려가면 두 줄 직무와 버튼이 겹친다.
        while columnCount > 1,
            (usableWidth - Spacing.lg * CGFloat(columnCount - 1)) / CGFloat(columnCount)
                < Layout.cardMinWidth
        {
            columnCount -= 1
        }
        return Array(
            repeating: GridItem(
                .flexible(minimum: Layout.cardMinWidth),
                spacing: Spacing.lg,
                alignment: .top
            ),
            count: columnCount
        )
    }

    var body: some View {
        GeometryReader { proxy in
            let gridColumns = gridColumns(availableWidth: proxy.size.width)
            let embedsOperationalPanelsInGrid = embedsOperationalPanelsInGrid(columnCount: gridColumns.count)

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    header

                    if !bottleneckAgents.isEmpty {
                        bottleneckBanner
                    }

                    if store.agents.isEmpty {
                        emptyState
                    } else {
                        LazyVGrid(columns: gridColumns, spacing: Spacing.lg) {
                            ForEach(store.agents) { agent in
                                if embedsOperationalPanelsInGrid && agent.id == store.agents.last?.id {
                                    approvalPanel
                                }
                                AgentCardView(
                                    agent: agent,
                                    pendingCommands: store.pendingCommands,
                                    onSend: onSend,
                                    onAcknowledge: {
                                        store.acknowledgeCompletion(agentType: agent.agentType)
                                    }
                                )
                                if embedsOperationalPanelsInGrid && agent.id == store.agents.last?.id {
                                    sessionPanel
                                }
                            }
                        }
                    }

                    if !store.approvals.isEmpty && !embedsOperationalPanelsInGrid {
                        approvalPanel
                    }

                    if !store.sessions.isEmpty && !embedsOperationalPanelsInGrid {
                        sessionPanel
                    }
                }
                .padding(Spacing.xl)
            }
        }
        .background(CozyPalette.canvas)
        .frame(minWidth: Layout.windowMinWidth, minHeight: Layout.contentMinHeight)
        .sheet(item: $injectTarget) { target in
            injectSheet(target: target)
        }
    }

    private func embedsOperationalPanelsInGrid(columnCount: Int) -> Bool {
        store.agents.count % columnCount == 1
            && !store.approvals.isEmpty
            && !store.sessions.isEmpty
    }

    // MARK: - 헤더

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("이대리 주식회사")
                .font(Typography.screenTitle)

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

    // 실시간 연결 배지는 AppRootView 헤더(두 탭 공통)에만 둔다. 예전엔 여기도 같은 배지를
    // 그려서 화면에 "실시간"이 위아래로 두 번 떴다 — 정본은 하나로 줄인다.
    // (status 는 지워도 되는 값이 아니라 아래 emptyState 문구가 여전히 참조한다.)

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
            Text("연동 대기로 멈춘 담당자: \(names)")
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
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Label("승인 대기", systemImage: "checkmark.seal.fill")
                    .font(Typography.sectionTitle)
                Spacer(minLength: 0)
                Text("\(store.approvals.count)건")
                    .font(Typography.metric)
                    .foregroundStyle(ConsoleAgentState.awaitingApproval.accentColor)
            }
            Text("확인이 필요한 요청을 여기서 처리합니다")
                .font(Typography.caption)
                .foregroundStyle(.secondary)
            if let notice = store.approvalNotice {
                Text(notice)
                    .font(Typography.caption)
                    .foregroundStyle(Color.red)
            }
            ForEach(store.approvals) { approval in
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Button {
                        selectedApproval = approval
                    } label: {
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Circle()
                                .fill(ConsoleAgentState.awaitingApproval.accentColor)
                                .frame(width: Stroke.dot, height: Stroke.dot)
                                .padding(.top, 4)
                            Text(approval.title)
                                .font(Typography.body)
                                .lineLimit(3)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("승인 상세 \(approval.title)")
                    .accessibilityHint("승인 상세 화면 열기")

                    HStack {
                        Label(formatTime(approval.createdAt), systemImage: "clock")
                            .font(Typography.metricMonoSmall)
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        Button("승인") { onApprove(approval.id) }
                        Button("거절") { onReject(approval.id) }
                            .tint(.red)
                    }
                }
                .padding(Spacing.sm)
                .background(CozyPalette.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
            }
            HStack(spacing: Spacing.sm) {
                summaryTile(
                    icon: "checkmark.seal.fill",
                    title: "대기",
                    value: "\(store.approvals.count)건",
                    detail: "승인 처리 전",
                    color: ConsoleAgentState.awaitingApproval.accentColor
                )
                summaryTile(
                    icon: "clock.fill",
                    title: "최근 요청",
                    value: recentApprovalCreatedAt,
                    detail: "요청 생성 시각",
                    color: ConsoleAgentState.awaitingApproval.accentColor
                )
                summaryTile(
                    icon: "hand.raised.fill",
                    title: "처리 방식",
                    value: "수동 승인 · 거절",
                    detail: "선택 버튼 2개",
                    color: ConsoleAgentState.awaitingApproval.accentColor
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Label("항목을 누르면 상세 내용을 볼 수 있습니다", systemImage: "hand.tap")
                .font(Typography.captionSmall)
                .foregroundStyle(.secondary)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .topLeading)
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
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Label("내 작업 세션", systemImage: "terminal.fill")
                    .font(Typography.sectionTitle)
                Spacer(minLength: 0)
                Text("\(store.sessions.count)개")
                    .font(Typography.metric)
                    .foregroundStyle(Color(red: 0.36, green: 0.78, blue: 0.63))
            }
            Text("로컬 CLI 작업을 이어서 관리합니다")
                .font(Typography.caption)
                .foregroundStyle(.secondary)
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
            HStack(spacing: Spacing.sm) {
                summaryTile(
                    icon: "bolt.fill",
                    title: "활동 중",
                    value: "\(activeSessionCount)개",
                    detail: "실행 상태",
                    color: Color(red: 0.28, green: 0.62, blue: 0.49)
                )
                summaryTile(
                    icon: "moon.fill",
                    title: "유휴",
                    value: "\(idleSessionCount)개",
                    detail: "대기 상태",
                    color: Color(red: 0.28, green: 0.62, blue: 0.49)
                )
                summaryTile(
                    icon: "arrow.turn.down.right",
                    title: "전달 상태",
                    value: "다음 턴",
                    detail: "선택 후 작업 주입",
                    color: Color(red: 0.28, green: 0.62, blue: 0.49)
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Label("작업 주입은 선택한 세션의 다음 턴에 전달됩니다", systemImage: "arrow.turn.down.right")
                .font(Typography.captionSmall)
                .foregroundStyle(.secondary)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .topLeading)
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
                target.isActive
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

    private var activeSessionCount: Int {
        store.sessions.filter(\.isActive).count
    }

    private var idleSessionCount: Int {
        store.sessions.filter { !$0.isActive }.count
    }

    private var recentApprovalCreatedAt: String {
        guard let createdAt = store.approvals.map(\.createdAt).max() else {
            return "없음"
        }
        return formatTime(createdAt)
    }

    private func summaryTile(
        icon: String,
        title: String,
        value: String,
        detail: String,
        color: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Spacer(minLength: 0)
            Image(systemName: icon)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(color.opacity(0.58))
            Text(title)
                .font(Typography.captionSmall)
                .foregroundStyle(.secondary)
            Text(value)
                .font(Typography.metric)
                .foregroundStyle(color)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            Text(detail)
                .font(Typography.captionSmall)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(Spacing.sm)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
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
