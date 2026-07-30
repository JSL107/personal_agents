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
            SpriteView(scene: scene)
                .frame(minWidth: 640, minHeight: 480)
                .onAppear {
                    scene.sync(agents: store.agents)
                    replayInitialChoreography()
                    scene.onAgentClick = { agentType in
                        selectedAgent = agentType
                        commandText = ""
                    }
                }
                .onChange(of: store.agents) { newAgents in
                    scene.sync(agents: newAgents)
                }
                .onReceive(store.eventStream) { event in
                    let context = ChoreographyContext(
                        agents: store.agents,
                        runs: store.runs,
                        pendingCommands: store.pendingCommands
                    )
                    scene.perform(visualIntents(for: event, context: context))
                }

            if let agentType = selectedAgent {
                interactionBar(for: agentType)
            }
        }
    }

    @ViewBuilder
    private func interactionBar(for agentType: String) -> some View {
        let approval = approvalFor(agentType: agentType, in: store.approvals)
        VStack(spacing: 8) {
            HStack {
                Text(agentType).font(.headline)
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
        .padding(12)
        .background(.thinMaterial)
        .cornerRadius(10)
        .padding(12)
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
