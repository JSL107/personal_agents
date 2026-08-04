import AppKit
import ConsoleCore
import SpriteKit
import SwiftUI

/// 오피스 탭. store.agents 를 씬에 반영하고, SSE 이벤트를 연출(VisualIntent)로 잇는다.
/// 원 클릭 시 지시 입력 바(일반) 또는 승인/거절 팝오버(승인 대기)를 띄운다.
struct OfficeView: View {
    @ObservedObject var store: ConsoleStore
    let onSend: (String, String?) -> Void
    let onApprove: (String) -> Void
    let onReject: (String) -> Void

    @State private var scene: OfficeScene = {
        let scene = OfficeScene(size: CGSize(width: 900, height: 600))
        scene.scaleMode = .resizeFill
        return scene
    }()
    @State private var selectedAgent: String?
    @State private var commandText: String = ""

    var body: some View {
        ZStack(alignment: .bottom) {
            // SpriteKit 이 "SKView: no drawables available for rendering" 을 간헐적으로 남기지만
            // 프레임 하나를 건너뛴다는 정보 로그이고 화면·기능에는 영향이 없다. 터미널 노이즈는
            // 개발 실행 스크립트(scripts/console-dev.sh)의 필터에서 걷어낸다(#183).
            //
            // 아래 절전은 그 로그와 무관하다. #177 은 로그를 없애려고 `shouldRender` 로 렌더를
            // 막으려 했지만 그 콜백은 90초에 0~2회만 불려 게이트가 되지 못했다(#183). 여기서
            // 쓰는 것은 다른 레버(`scene.isPaused`)이고, 판정도 로그가 아니라 CPU 로 한다 —
            // 그 로그는 같은 조건에서도 90초당 0~7회로 요동쳐 효과 판정에 쓸 수 없다.
            SpriteView(scene: scene)
                .frame(minWidth: Layout.officeMinWidth, minHeight: 480)
                // 씬은 보조기술 트리에 이름 없는 이미지 덩어리로만 잡힌다(실측). 자식을 덮고
                // 한 문장으로 대신 읽게 한다 — 그림 안의 몸짓·자리로만 전하던 정보를
                // 소리로 듣는 유일한 통로다.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(officeAccessibilitySummary(agents: store.agents))
                // 창이 가려지거나 최소화되면 씬을 재운다. macOS 는 대신 멈춰주지 않는다(실측).
                .onReceive(
                    NotificationCenter.default.publisher(
                        for: NSWindow.didChangeOcclusionStateNotification)
                ) { _ in
                    applySceneSleep()
                }
                .onReceive(
                    NotificationCenter.default.publisher(for: NSWindow.didMiniaturizeNotification)
                ) { _ in
                    applySceneSleep()
                }
                .onReceive(
                    NotificationCenter.default.publisher(for: NSWindow.didDeminiaturizeNotification)
                ) { _ in
                    applySceneSleep()
                }
                .onAppear {
                    scene.sync(agents: store.agents, approvals: store.approvals)
                    scene.refreshOverlays(
                        agents: store.agents, runs: store.runs,
                        pendingCommands: store.pendingCommands, now: Date()
                    )
                    replayInitialChoreography()
                    scene.onAgentClick = { agentType in
                        selectedAgent = agentType
                        commandText = ""
                    }
                }
                .onChange(of: store.agents) { newAgents in
                    scene.sync(agents: newAgents, approvals: store.approvals)
                    scene.refreshOverlays(
                        agents: newAgents, runs: store.runs,
                        pendingCommands: store.pendingCommands, now: Date()
                    )
                }
                .onChange(of: store.approvals) { newApprovals in
                    // 승인만 바뀐 경우는 줄만 맞춘다. 여기서 sync 를 부르면 승인 알림이 오갈
                    // 때마다 바닥·가구·사람이 통째로 다시 그려진다.
                    scene.reconcileQueue(agents: store.agents, approvals: newApprovals)
                }
                .onChange(of: selectedAgent) { newSelection in
                    scene.setSelected(newSelection)
                }
                .onChange(of: store.pendingCommands) { _ in
                    scene.refreshOverlays(
                        agents: store.agents, runs: store.runs,
                        pendingCommands: store.pendingCommands, now: Date()
                    )
                }
                .onChange(of: store.runs) { _ in
                    // 재연결 스냅샷은 이벤트를 방출하지 않으므로, agents 불변인데 runs 만 바뀐
                    // 경우(같은 에이전트의 새 run)에도 경과 오버레이를 갱신한다.
                    scene.refreshOverlays(
                        agents: store.agents, runs: store.runs,
                        pendingCommands: store.pendingCommands, now: Date()
                    )
                }
                .onReceive(store.eventStream) { event in
                    let context = ChoreographyContext(
                        agents: store.agents,
                        runs: store.runs,
                        pendingCommands: store.pendingCommands
                    )
                    scene.perform(visualIntents(for: event, context: context))
                    scene.refreshOverlays(
                        agents: store.agents, runs: store.runs,
                        pendingCommands: store.pendingCommands, now: Date()
                    )
                }

            if let agentType = selectedAgent {
                interactionBar(for: agentType)
            } else if let notice = store.approvalNotice {
                // 승인/거절을 누르면 상호작용 바가 닫히므로, 실패 사유는 바 자리에서 이어 보여준다.
                Text(notice)
                    .font(Typography.caption)
                    .foregroundStyle(Color.red)
                    .padding(Spacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                            .fill(Color.primary.opacity(0.08))
                    )
                    .padding(.bottom, Spacing.md)
            }
        }
    }

    @ViewBuilder
    private func interactionBar(for agentType: String) -> some View {
        let approval = approvalFor(agentType: agentType, in: store.approvals)
        VStack(spacing: Spacing.sm) {
            HStack {
                Text(agentType).font(Typography.sectionTitle)
                Spacer()
                Button("닫기") { selectedAgent = nil }
            }
            if let approval {
                HStack {
                    Text("승인 대기: \(approval.title)").lineLimit(1)
                    Spacer()
                    Button("승인") { onApprove(approval.id); selectedAgent = nil }
                        .keyboardShortcut(.defaultAction)
                    Button("거절") { onReject(approval.id); selectedAgent = nil }
                }
            } else {
                HStack {
                    TextField("\(agentType)에게 지시…", text: $commandText)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { send(to: agentType) }
                    Button("전송") { send(to: agentType) }
                        .disabled(commandText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .padding(Spacing.md)
        .background(.thinMaterial)
        .cornerRadius(10)
        .padding(Spacing.md)
    }

    private func send(to agentType: String) {
        let trimmed = commandText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }
        onSend(trimmed, agentType)
        commandText = ""
        selectedAgent = nil
    }

    /// 창이 화면에 보이지 않는 동안 씬을 재운다.
    ///
    /// 유휴 상태(대기 24명)에서도 오피스 씬은 CPU 9~11% 를 쓴다. 같은 앱의 대시보드 탭이
    /// 0.5% 미만이므로 그 비용은 전부 씬 몫이고, **창을 최소화해도 macOS 가 대신 멈춰주지
    /// 않는다**(실측: 최소화 상태에서 7.9~10.8%).
    ///
    /// 씬 시계를 세우는 것만으로 9.3% → 1.9% 가 된다 — 비용의 대부분이 24명의 몸짓과 배회
    /// 경로 계산이라서다. 렌더 루프 자체까지 끄려면 `SKView` 를 직접 소유해야 하지만
    /// (`SpriteView` 로는 닿지 않는다, #183), 남는 1.9% 를 위해 렌더 경로를 바꿀 이유가 없다.
    private func applySceneSleep() {
        guard let window = NSApp.windows.first else {
            return
        }
        // 최소화는 occlusion 과 별개로 확인한다 — 둘 중 하나만 보면 사각지대가 생긴다.
        //
        // 비활성(다른 앱을 쓰는 중이지만 창은 보임)은 일부러 재우지 않는다. 보조 모니터에
        // 띄워두고 흘끗 보는 것이 이 화면의 주 용도라, 멈추면 관제 가치가 사라진다.
        // 그 대가로 아끼는 것은 기계 전체 CPU 의 1% 미만이다.
        let visible = window.occlusionState.contains(.visible) && !window.isMiniaturized
        scene.isPaused = !visible
    }

    /// 탭이 처음 나타날 때 현재 상태로 연출을 재구성한다(닫혀 있던 동안 놓친 이벤트 보완).
    private func replayInitialChoreography() {
        for run in store.runs where run.finishedAt == nil {
            scene.perform([.working(agentType: run.agentType)])
        }
        for approval in store.approvals {
            if let agentType = approval.agentType {
                scene.perform([.summonToBand(agentType: agentType)])
            }
        }
    }
}
