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
            // 프레임 하나를 건너뛴다는 정보 로그이고 화면·기능에는 영향이 없다.
            // occlusionState 로 렌더를 멈추는 방식(구 #177)은 실측에서 무효였다 — shouldRender 콜백이
            // 호출되지 않고, 창이 보이는 상태에서도 로그가 나므로 원천 차단이 안 된다.
            // 터미널 노이즈는 개발 실행 스크립트(scripts/console-dev.sh)의 필터에서 걷어낸다.
            SpriteView(scene: scene)
                .frame(minWidth: Layout.officeMinWidth, minHeight: 480)
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
