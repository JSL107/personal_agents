import AppKit
import ConsoleCore
import SpriteKit
import SwiftUI

/// 오피스 탭. store.agents 를 씬에 반영하고, SSE 이벤트를 연출(VisualIntent)로 잇는다.
/// 원 클릭 시 지시 입력 바(일반) 또는 승인/거절 팝오버(승인 대기)를 띄우고,
/// 대표(나) 클릭 시 담당자를 정하지 않는 지시 바를 띄운다.
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
    /// 대표에게 지시하는 바가 열렸는지. 담당자를 지정하지 않는 지시라 대상 상태가 따로 없다.
    @State private var isPresidentBarOpen = false
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
                .accessibilityLabel(
                    officeAccessibilitySummary(
                        agents: store.agents, approvals: store.approvals
                    )
                )
                // 창이 가려지거나 최소화되면 씬을 재운다. macOS 는 대신 멈춰주지 않는다(실측).
                .onReceive(
                    NotificationCenter.default.publisher(
                        for: NSWindow.didChangeOcclusionStateNotification)
                ) { notification in
                    applySceneSleep(notifying: notification.object as? NSWindow)
                }
                .onReceive(
                    NotificationCenter.default.publisher(for: NSWindow.didMiniaturizeNotification)
                ) { notification in
                    applySceneSleep(notifying: notification.object as? NSWindow)
                }
                .onReceive(
                    NotificationCenter.default.publisher(for: NSWindow.didDeminiaturizeNotification)
                ) { notification in
                    applySceneSleep(notifying: notification.object as? NSWindow)
                }
                .onAppear {
                    // 통지는 상태가 "바뀔 때" 만 온다. 이미 가려지거나 최소화된 창에서 탭이
                    // 열리면 다음 통지까지 씬이 계속 돌므로, 나타나는 시점에 한 번 맞춘다.
                    applySceneSleep()
                    scene.syncSessions(store.sessions)
                    scene.sync(agents: store.agents, approvals: store.approvals)
                    scene.refreshOverlays(
                        agents: store.agents, runs: store.runs,
                        pendingCommands: store.pendingCommands, now: Date()
                    )
                    replayInitialChoreography()
                    scene.onAgentClick = { agentType in
                        selectedAgent = agentType
                        isPresidentBarOpen = false
                        commandText = ""
                    }
                    scene.onPresidentClick = {
                        selectedAgent = nil
                        isPresidentBarOpen = true
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
                .onChange(of: store.sessions) { newSessions in
                    // 세션은 사규가 배정한 자리가 없어 사무실을 다시 그릴 필요가 없다.
                    // sync 를 부르면 세션 하나 뜰 때마다 바닥·가구·29명이 통째로 다시 그려진다.
                    scene.syncSessions(newSessions)
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
            } else if isPresidentBarOpen {
                presidentBar
            } else if !globalPendingCommands.isEmpty {
                // 바를 닫아도 담당자 미확정 지시의 진행·실패는 남긴다 — 이 지시는 아직 자기 사람이
                // 없어서 씬의 사람 위 오버레이로 갈 자리가 없다. 여기서 지우면 어디에도 안 보인다.
                pendingBadgeRow
                    .padding(.bottom, Spacing.md)
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

    /// 대표에게 지시 — 담당자를 지정하지 않는다. 라우터가 자연어를 보고 워커를 고르고,
    /// 선행 조건이 빠졌으면 그 앞 워커까지 알아서 돌린다.
    private var presidentBar: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text("👑 나 (대표)").font(Typography.sectionTitle)
                Spacer()
                Button("닫기") { isPresidentBarOpen = false }
            }
            HStack {
                TextField("지시… 담당자는 이대리가 고릅니다", text: $commandText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(sendToPresident)
                Button("전송", action: sendToPresident)
                    .disabled(commandText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if !globalPendingCommands.isEmpty {
                pendingBadgeRow
            }
        }
        .padding(Spacing.md)
        .background(.thinMaterial)
        .cornerRadius(10)
        .padding(Spacing.md)
    }

    private func sendToPresident() {
        let trimmed = commandText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }
        onSend(trimmed, nil)
        commandText = ""
        // 에이전트 지시와 달리 바를 닫지 않는다 — 담당자가 정해지기까지의 진행·실패가 이 자리에
        // 뜨는데, 닫아버리면 방금 보낸 지시가 어디로 갔는지 볼 데가 없다.
    }

    /// 아직 담당자가 정해지지 않은 지시의 진행 배지. `run.started` 로 담당자가 확정되면
    /// 그 사람 머리 위 오버레이로 넘어가므로 여기서 빠진다(중복 표시 방지).
    /// 타임아웃 실패(`.failed`, 담당자 여전히 미정)는 계속 남아 ⚠️ 로 보인다.
    private var globalPendingCommands: [PendingCommand] {
        store.pendingCommands.filter { $0.agentTypeHint == nil && $0.resolvedAgentType == nil }
    }

    private var pendingBadgeRow: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(globalPendingCommands) { command in
                VStack(alignment: .leading, spacing: Spacing.tight) {
                    HStack(spacing: Spacing.xs) {
                        Text(command.phase.badgeIcon)
                        Text(command.text)
                            .font(Typography.caption)
                            .lineLimit(1)
                    }
                    if let reason = command.reason {
                        Text(reason)
                            .font(Typography.captionSmall)
                            .foregroundStyle(command.phase == .failed ? Color.red : Color.secondary)
                            .lineLimit(2)
                    }
                }
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, Spacing.xs)
                .background(
                    RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                        .fill(Color.primary.opacity(0.06))
                )
            }
        }
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
    /// - Parameter notifying: 통지를 보낸 창. 창이 여럿일 때 남의 창 상태로 판정하지 않도록
    ///   통지 발생 객체를 우선 본다. 시트는 어느 쪽에서든 제외한다 — 대시보드 탭이 띄우는
    ///   주입 시트가 `NSApp.windows` 앞에 올 수 있고, 시트의 가시성은 이 씬과 무관하다.
    private func applySceneSleep(notifying: NSWindow? = nil) {
        var target = NSApp.windows.first { !$0.isSheet }
        if let notifying, !notifying.isSheet {
            target = notifying
        }
        guard let window = target else {
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
