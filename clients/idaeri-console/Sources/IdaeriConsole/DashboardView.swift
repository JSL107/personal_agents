import Charts
import ConsoleCore
import SwiftUI

/// 운영 대시보드. "지금 무엇이 돌고, 무엇이 막혔고, 요즘 얼마나 일했나" 를 한 화면에서 답한다.
///
/// 위에서부터 지금 일하는 담당자 → 숫자 4개 → 14일 추이 → 최근 실행·승인·세션 순이다.
/// 담당자별 방 장면 카드는 "에이전트 상태" 탭(`AgentStatusView`)으로 옮겼다 — 카드 한 장이
/// 470pt 라 여기 두면 숫자와 추이가 화면 밖으로 밀려난다.
///
/// 승인·세션 처리는 이 탭에만 둔다. 같은 입구가 두 탭에 있으면 어느 쪽이 정본인지 알 수 없다.
struct DashboardView: View {
    /// store·연결은 AppRootView 가 소유하고 주입한다(다른 탭과 공유).
    @ObservedObject var store: ConsoleStore
    let status: ConnectionStatus
    let baseURLLabel: String
    let onApprove: (String) -> Void
    let onReject: (String) -> Void
    let onInject: (String, String) async throws -> InjectOutcome
    /// "전체 보기" — 에이전트 상태 탭으로 넘어간다.
    let onShowAgents: () -> Void

    @State private var injectTarget: ConsoleSession?
    @State private var injectText = ""
    @State private var injectNotice: String?
    @State private var injectNoticeIsFailure = false
    @State private var isInjecting = false
    @State private var selectedApproval: ConsoleApproval?

    /// "지금 담당자" 줄에 세우는 최대 인원. 참고한 관제판처럼 한 줄에 들어가는 수로 묶는다.
    private let liveAgentLimit = 4

    var body: some View {
        GeometryReader { proxy in
            let isWide = proxy.size.width >= 1000
            let fourColumns = columns(isWide ? 4 : 2)
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    header
                    if store.agents.isEmpty {
                        emptyState
                    } else {
                        liveAgentsSection(columns: fourColumns)
                        metricsRow(columns: fourColumns)
                        chartsRow(columns: columns(isWide ? 3 : 1))
                        if isWide {
                            HStack(alignment: .top, spacing: Spacing.lg) {
                                recentRunsSection
                                operationsColumn
                            }
                        } else {
                            recentRunsSection
                            operationsColumn
                        }
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
        .sheet(item: $selectedApproval) { approval in
            ApprovalDetailSheet(
                approval: approval,
                onApprove: { onApprove($0); selectedApproval = nil },
                onReject: { onReject($0); selectedApproval = nil }
            )
        }
    }

    /// 참고 화면처럼 줄을 창 폭에 꽉 채운다. `adaptive` 는 남는 폭을 빈칸으로 남겨
    /// 넓은 창에서 오른쪽이 휑했다.
    private func columns(_ count: Int) -> [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: Spacing.md, alignment: .top), count: count)
    }

    // MARK: - 헤더

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("대시보드")
                .font(Typography.screenTitle)
            Spacer()
            if !store.serverTime.isEmpty {
                Text(formatTime(store.serverTime))
                    .font(Typography.metricMono)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(Typography.captionEmphasis)
            .tracking(0.6)
            .foregroundStyle(.secondary)
    }

    // MARK: - 지금 담당자

    private func liveAgentsSection(columns: [GridItem]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                sectionTitle("지금 담당자")
                Spacer()
                Button("전체 보기", action: onShowAgents)
                    .buttonStyle(.link)
                    .font(Typography.caption)
            }
            LazyVGrid(columns: columns, spacing: Spacing.md) {
                let stalled = store.stalledAgentTypes
                ForEach(liveAgents(stalled: stalled)) { agent in
                    let isStalled = stalled.contains(agent.agentType)
                    LiveAgentCard(
                        agent: agent,
                        footnote: footnote(for: agent, isStalled: isStalled),
                        isHighlighted: agent.state == .inProgress || isStalled,
                        isStalled: isStalled
                    )
                }
            }
        }
    }

    /// 사람 손이 필요한 순서로 세운다 — 진행 중 > 승인 대기 > 실패 > 정지 > 연동 대기 > 완료 > 대기.
    private func liveAgents(stalled: Set<String>) -> [ConsoleAgent] {
        Array(
            dashboardAttentionOrder(agents: store.agents, stalledAgentTypes: stalled)
                .prefix(liveAgentLimit)
        )
    }

    private func footnote(for agent: ConsoleAgent, isStalled: Bool) -> String {
        if isStalled, let stall = agentStallFootnote(store.ledger?.entry(for: agent.agentType)) {
            return stall
        }
        if agent.state == .inProgress,
            let run = store.runs.first(where: { $0.agentType == agent.agentType }),
            let relative = relativeTime(run.startedAt)
        {
            return "\(relative) 시작"
        }
        let done = agent.doneToday ?? 0
        return done > 0 ? "오늘 \(done)건 완료" : agent.state.label
    }

    // MARK: - 숫자 4개

    private func metricsRow(columns: [GridItem]) -> some View {
        LazyVGrid(columns: columns, spacing: Spacing.md) {
            MetricTile(
                value: "\(store.agents.count)",
                title: "담당자",
                detail: "진행 \(countOf(.inProgress)) · 실패 \(countOf(.failed)) · 연동 대기 \(countOf(.awaitingIntegration))",
                icon: "person.2"
            )
            MetricTile(
                value: "\(store.runs.count)",
                title: "진행 중인 작업",
                detail: "내 세션 \(store.sessions.count)개 · 활동 \(store.sessions.filter(\.isActive).count)",
                icon: "circle.dotted"
            )
            MetricTile(
                value: "\(store.agents.reduce(0) { $0 + ($1.doneToday ?? 0) })",
                title: "오늘 완료",
                detail: fourteenDaySummary,
                icon: "checkmark.circle"
            )
            MetricTile(
                value: "\(store.approvals.count)",
                title: "승인 대기",
                detail: store.approvals.isEmpty ? "확인할 요청 없음" : "아래에서 처리",
                icon: "checkmark.shield",
                valueColor: store.approvals.isEmpty ? nil : ConsoleAgentState.awaitingApproval.accentColor
            )
        }
    }

    private var fourteenDaySummary: String {
        guard let days = store.activity?.days, !days.isEmpty else {
            return "14일 집계 불러오는 중"
        }
        let total = days.reduce(0) { $0 + $1.total }
        let failed = days.reduce(0) { $0 + $1.failed }
        return "14일 \(total)회 실행 · 실패 \(failed)"
    }

    // MARK: - 그래프

    private func chartsRow(columns: [GridItem]) -> some View {
        LazyVGrid(columns: columns, spacing: Spacing.md) {
            ChartPanel(title: "실행 추이", subtitle: "최근 14일") {
                runActivityChart
            }
            ChartPanel(title: "성공률", subtitle: "최근 14일 · 종료된 실행 기준") {
                successRateChart
            }
            ChartPanel(title: "담당자별 오늘 완료", subtitle: "성공으로 끝난 실행") {
                doneTodayChart
            }
        }
    }

    private var activityDays: [ConsoleActivityDay] {
        store.activity?.days ?? []
    }

    @ViewBuilder
    private var runActivityChart: some View {
        if activityDays.isEmpty {
            chartPlaceholder
        } else {
            Chart {
                ForEach(activityDays) { day in
                    BarMark(x: .value("날짜", dayDate(day.date), unit: .day), y: .value("건수", day.succeeded))
                        .foregroundStyle(by: .value("결과", "성공"))
                    BarMark(x: .value("날짜", dayDate(day.date), unit: .day), y: .value("건수", day.failed))
                        .foregroundStyle(by: .value("결과", "실패"))
                    BarMark(x: .value("날짜", dayDate(day.date), unit: .day), y: .value("건수", day.other))
                        .foregroundStyle(by: .value("결과", "기타"))
                }
            }
            .chartForegroundStyleScale([
                "성공": ConsoleAgentState.completed.accentColor,
                "실패": ConsoleAgentState.failed.accentColor,
                "기타": Color.secondary.opacity(0.5),
            ])
            .chartXAxis { sparseDateAxis }
            // 양끝 라벨이 그림 영역 밖으로 반쯤 나가 "..." 로 잘린다 — 여백을 둔다.
            .chartXScale(range: .plotDimension(padding: 14))
            .chartLegend(position: .bottom, alignment: .leading)
        }
    }

    @ViewBuilder
    private var successRateChart: some View {
        let finishedDays = activityDays.filter { $0.succeeded + $0.failed > 0 }
        if finishedDays.isEmpty {
            chartPlaceholder
        } else {
            Chart {
                ForEach(activityDays) { day in
                    let finished = day.succeeded + day.failed
                    BarMark(
                        x: .value("날짜", dayDate(day.date), unit: .day),
                        y: .value("성공률", finished == 0 ? 0 : Double(day.succeeded) / Double(finished) * 100)
                    )
                    .foregroundStyle(CozyPalette.butter)
                }
            }
            .chartYScale(domain: 0...100)
            .chartYAxis {
                AxisMarks(values: [0, 50, 100]) { value in
                    AxisGridLine()
                    AxisValueLabel { Text("\(value.as(Int.self) ?? 0)%") }
                }
            }
            .chartXAxis { sparseDateAxis }
            // 양끝 라벨이 그림 영역 밖으로 반쯤 나가 "..." 로 잘린다 — 여백을 둔다.
            .chartXScale(range: .plotDimension(padding: 14))
        }
    }

    @ViewBuilder
    private var doneTodayChart: some View {
        let rows = store.agents
            .filter { ($0.doneToday ?? 0) > 0 }
            .sorted { ($0.doneToday ?? 0) > ($1.doneToday ?? 0) }
            .prefix(6)
        if rows.isEmpty {
            Text("오늘 아직 완료한 실행이 없습니다")
                .font(Typography.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Chart(Array(rows)) { agent in
                BarMark(
                    x: .value("건수", agent.doneToday ?? 0),
                    y: .value("담당자", agent.roleName)
                )
                .foregroundStyle(CozyPalette.department(agent.resolvedDepartment))
                .annotation(position: .trailing) {
                    Text("\(agent.doneToday ?? 0)")
                        .font(Typography.metricMonoSmall)
                        .foregroundStyle(.secondary)
                }
            }
            .chartXAxis(.hidden)
        }
    }

    /// 14개 라벨을 다 찍으면 겹친다. 첫날·가운데·오늘만 남긴다(참고 화면과 같은 밀도).
    /// x 를 문자열 범주로 두면 라벨이 막대 폭에 갇혀 "8/..." 로 잘려서 날짜 축을 쓴다.
    private var sparseDateAxis: some AxisContent {
        let dates = activityDays.map { dayDate($0.date) }
        let picks = [dates.first, dates.count > 2 ? dates[dates.count / 2] : nil, dates.last]
            .compactMap { $0 }
        return AxisMarks(values: picks) { value in
            AxisValueLabel {
                if let date = value.as(Date.self) {
                    Text(shortDate(date))
                }
            }
        }
    }

    private var chartPlaceholder: some View {
        Text(store.activity == nil ? "집계를 불러오는 중…" : "최근 14일 실행이 없습니다")
            .font(Typography.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - 최근 실행

    private var recentRunsSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            sectionTitle("최근 실행")
            ListPanel {
                let runs = store.activity?.recentRuns ?? []
                if runs.isEmpty {
                    emptyRow(store.activity == nil ? "불러오는 중…" : "실행 기록이 없습니다")
                } else {
                    ForEach(Array(runs.enumerated()), id: \.element.id) { index, run in
                        if index > 0 {
                            Divider()
                        }
                        recentRunRow(run)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func recentRunRow(_ run: ConsoleRecentRun) -> some View {
        let agent = store.agents.first { $0.agentType == run.agentType }
        return HStack(spacing: Spacing.sm) {
            RunStatusIcon(status: run.status)
            Text(run.title)
                .font(Typography.body)
                .lineLimit(1)
            if let count = run.count, count > 1 {
                Text("×\(count)")
                    .font(Typography.metricMonoSmall)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("\(count)회 연속")
            }
            Spacer(minLength: Spacing.sm)
            if let agent {
                AgentFace(agent: agent, size: 22)
            }
            Text(agent?.roleName ?? run.agentType)
                .font(Typography.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(width: 64, alignment: .leading)
            Text(relativeTime(run.finishedAt ?? run.startedAt) ?? "")
                .font(Typography.metricMonoSmall)
                .foregroundStyle(.secondary)
                .frame(width: 64, alignment: .trailing)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .accessibilityElement(children: .combine)
    }

    // MARK: - 승인 대기 · 내 세션

    private var operationsColumn: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                sectionTitle("승인 대기")
                if let notice = store.approvalNotice {
                    Text(notice)
                        .font(Typography.caption)
                        .foregroundStyle(Color.red)
                }
                ListPanel {
                    if store.approvals.isEmpty {
                        emptyRow("확인할 요청이 없습니다")
                    } else {
                        ForEach(Array(store.approvals.enumerated()), id: \.element.id) { index, approval in
                            if index > 0 {
                                Divider()
                            }
                            approvalRow(approval)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: Spacing.sm) {
                sectionTitle("내 작업 세션")
                if let injectNotice {
                    Text(injectNotice)
                        .font(Typography.caption)
                        .foregroundStyle(injectNoticeIsFailure ? Color.red : Color.secondary)
                }
                ListPanel {
                    if store.sessions.isEmpty {
                        emptyRow("열린 세션이 없습니다")
                    } else {
                        ForEach(Array(store.sessions.enumerated()), id: \.element.id) { index, session in
                            if index > 0 {
                                Divider()
                            }
                            SessionRowView(
                                session: session,
                                onInject: {
                                    injectTarget = session
                                    injectText = ""
                                }
                            )
                            .padding(.horizontal, Spacing.md)
                            .padding(.vertical, Spacing.sm)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func approvalRow(_ approval: ConsoleApproval) -> some View {
        HStack(spacing: Spacing.sm) {
            Button {
                selectedApproval = approval
            } label: {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "checkmark.shield")
                        .foregroundStyle(ConsoleAgentState.awaitingApproval.accentColor)
                    Text(approval.title)
                        .font(Typography.body)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.sm)
                    Text(relativeTime(approval.createdAt) ?? "")
                        .font(Typography.metricMonoSmall)
                        .foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("승인 상세 \(approval.title)")
            .accessibilityHint("승인 상세 화면 열기")
            Button("승인") { onApprove(approval.id) }
            Button("거절") { onReject(approval.id) }
                .tint(.red)
        }
        .controlSize(.small)
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
    }

    private func emptyRow(_ text: String) -> some View {
        Text(text)
            .font(Typography.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
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
            Text(status == .live ? "표시할 담당자가 없습니다" : "백엔드에 연결하는 중…")
                .font(Typography.emptyStateTitle)
            Text("\(baseURLLabel) 의 콘솔 API(/v1/console) 응답을 기다리는 중입니다.")
                .font(Typography.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xxl * 2)
    }

    // MARK: - 파생값

    private func countOf(_ state: ConsoleAgentState) -> Int {
        store.agents.filter { $0.state == state }.count
    }

    /// "2026-10-06"(KST) → 그날 정오(KST). 정오로 잡아 어느 시간대에서 그려도 날짜가 밀리지 않는다.
    private func dayDate(_ date: String) -> Date {
        parseISODate("\(date)T12:00:00+09:00") ?? Date.distantPast
    }

    /// "MM/dd" 대신 "10/6" — 축 라벨은 짧을수록 덜 겹친다.
    private func shortDate(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        let parts = calendar.dateComponents([.month, .day], from: date)
        return "\(parts.month ?? 0)/\(parts.day ?? 0)"
    }

    /// 서버 시각 기준 상대 시간("3분 전"). 기준을 서버 시각으로 잡아 맥 시계가 어긋나도 맞는다.
    private func relativeTime(_ iso: String) -> String? {
        guard let date = parseISODate(iso) else {
            return nil
        }
        let reference = parseISODate(store.serverTime) ?? Date()
        let seconds = max(0, reference.timeIntervalSince(date))
        if seconds < 60 {
            return "방금"
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: max(reference, date))
    }

    private func formatTime(_ iso: String) -> String {
        guard let date = parseISODate(iso) else {
            return iso
        }
        let output = DateFormatter()
        output.dateFormat = "MM-dd HH:mm:ss"
        return output.string(from: date)
    }
}


private func parseISODate(_ iso: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
}

// MARK: - 조각 뷰

/// 담당자 얼굴만 둥글게 잘라 보여 준다. 전신 일러스트를 위쪽 기준으로 키워 머리만 원 안에 남긴다.
struct AgentFace: View {
    let agent: ConsoleAgent
    let size: CGFloat

    var body: some View {
        CozyAgentAvatarView(
            appearance: cozyAgentAppearance(agentType: agent.agentType, department: agent.resolvedDepartment),
            mood: cozyAgentMood(for: agent.state),
            department: agent.resolvedDepartment,
            state: agent.state
        )
        // 아바타는 정사각 틀에 전신을 신발선 기준으로 그린다. 머리 중심이 틀 위에서 약 17%
        // 근처라, 틀을 2.4배로 키우고 살짝 내려 머리를 원 가운데에 맞춘다(렌더로 맞춘 값).
        .frame(width: size * 2.4, height: size * 2.4)
        .offset(y: size * 0.4)
        .frame(width: size, height: size)
        .background(CozyPalette.department(agent.resolvedDepartment).opacity(0.25))
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// "지금 담당자" 카드 한 장 — 얼굴·이름, 지금 하는 일 한 줄, 시작/완료 시각.
private struct LiveAgentCard: View {
    let agent: ConsoleAgent
    let footnote: String
    let isHighlighted: Bool
    /// 자율 워커 정지. 상태(대개 대기)는 그대로 두고 아이콘·테두리·각주만 바꾼다.
    var isStalled = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                AgentFace(agent: agent, size: 28)
                Text(agent.roleName)
                    .font(Typography.bodyEmphasis)
                    .lineLimit(1)
                Text(agent.resolvedDepartment.label)
                    .font(Typography.captionSmall)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack(spacing: Spacing.sm) {
                if isStalled {
                    Image(systemName: "pause.circle.fill")
                        .foregroundStyle(CozyPalette.apricot)
                        .font(Typography.body)
                } else {
                    AgentStateIcon(state: agent.state)
                }
                Text(agent.bubble)
                    .font(Typography.body)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                    .strokeBorder(CozyPalette.outline.opacity(0.15))
            )
            Text(footnote)
                .font(isStalled ? Typography.captionEmphasis : Typography.captionSmall)
                .foregroundStyle(isStalled ? AnyShapeStyle(CozyPalette.apricot) : AnyShapeStyle(.secondary))
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .fill(CozyPalette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .strokeBorder(
                    isHighlighted
                        ? (isStalled ? CozyPalette.apricot : agent.state.accentColor).opacity(0.6)
                        : CozyPalette.outline.opacity(0.12),
                    lineWidth: isHighlighted ? Stroke.emphasis : 1
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.roleName), \(agent.state.label), \(agent.bubble), \(footnote)")
    }
}

/// 상태를 색 + 모양으로 함께 말한다(색만으로 구분하지 않게).
private struct AgentStateIcon: View {
    let state: ConsoleAgentState

    var body: some View {
        Image(systemName: symbol)
            .foregroundStyle(state.accentColor)
            .font(Typography.body)
    }

    private var symbol: String {
        switch state {
        case .inProgress: return "arrow.triangle.2.circlepath"
        case .completed: return "checkmark.circle"
        case .failed: return "xmark.octagon"
        case .awaitingApproval: return "checkmark.shield"
        case .awaitingIntegration: return "link.badge.plus"
        case .waiting: return "clock"
        }
    }
}

/// 최근 실행 한 줄의 상태 아이콘. 원장 status 문자열을 그대로 받는다.
private struct RunStatusIcon: View {
    let status: String

    var body: some View {
        switch status {
        case "SUCCEEDED":
            AgentStateIcon(state: .completed)
        case "FAILED":
            AgentStateIcon(state: .failed)
        default:
            AgentStateIcon(state: .inProgress)
        }
    }
}

private struct MetricTile: View {
    let value: String
    let title: String
    let detail: String
    let icon: String
    var valueColor: Color?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .top) {
                Text(value)
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .foregroundStyle(valueColor ?? CozyPalette.ink)
                    .monospacedDigit()
                Spacer()
                Image(systemName: icon)
                    .foregroundStyle(.secondary)
            }
            Text(title)
                .font(Typography.bodyEmphasis)
            Text(detail)
                .font(Typography.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct ChartPanel<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(title)
                .font(Typography.bodyEmphasis)
            Text(subtitle)
                .font(Typography.captionSmall)
                .foregroundStyle(.secondary)
            content
                .frame(height: 150)
                .padding(.top, Spacing.sm)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .fill(CozyPalette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .strokeBorder(CozyPalette.outline.opacity(0.12))
        )
    }
}

private struct ListPanel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .fill(CozyPalette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .strokeBorder(CozyPalette.outline.opacity(0.12))
        )
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
