import ConsoleCore
import SwiftUI

/// 에이전트 상태 탭. 담당자 한 명당 방 장면 카드 한 장으로, 누가 어떤 상태인지와 지시 입구를 모은다.
///
/// 원래 대시보드 탭이었다. 카드 한 장이 470pt 라 한 화면에 여섯 장이면 끝나고, 운영 숫자는
/// 머리 칩 한 줄로 밀려 "관제판" 이 아니라 "캐릭터 도감" 으로 읽혔다(2026-10-06 사용자 피드백).
/// 숫자·추이·최근 실행은 새 대시보드(`DashboardView`)가 맡고, 이 탭은 사람 단위 상태만 본다.
struct AgentStatusView: View {
    @ObservedObject var store: ConsoleStore
    let status: ConnectionStatus
    /// 연결 대상 표시용(빈 상태 안내에 노출). 동작에는 영향 없음.
    let baseURLLabel: String
    let onSend: (String, String?) -> Void

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
                }
                .padding(Spacing.xl)
            }
        }
        .background(CozyPalette.canvas)
        .frame(minWidth: Layout.windowMinWidth, minHeight: Layout.contentMinHeight)
    }

    // MARK: - 헤더

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("에이전트 상태")
                .font(Typography.screenTitle)

            HStack(spacing: Spacing.lg) {
                summaryChip(count: countOf(.inProgress), label: "진행 중", color: ConsoleAgentState.inProgress.accentColor)
                summaryChip(count: countOf(.awaitingApproval), label: "승인 대기", color: ConsoleAgentState.awaitingApproval.accentColor)
                summaryChip(count: countOf(.awaitingIntegration), label: "연동 대기", color: ConsoleAgentState.awaitingIntegration.accentColor)
                summaryChip(count: countOf(.completed), label: "완료", color: ConsoleAgentState.completed.accentColor)
                summaryChip(count: countOf(.failed), label: "실패", color: ConsoleAgentState.failed.accentColor)
                Spacer()
            }
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
}
