import ConsoleCore
import SwiftUI

/// The single inspector surface used by the live office and deterministic captures.
struct AgentInspectorView: View {
    let agent: ConsoleAgent
    let approval: ConsoleApproval?
    @Binding var commandText: String
    let onClose: () -> Void
    let onSend: (String) -> Void
    let onApprovalDetail: (ConsoleApproval) -> Void
    let onApprove: (String) -> Void
    let onReject: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Text("담당자 상세").font(Typography.sectionTitle)
                    Spacer()
                    Button("닫기", action: onClose)
                        .keyboardShortcut(.cancelAction)
                        .accessibilityLabel("담당자 상세 닫기")
                }
                CozyAgentAvatarView(
                    appearance: cozyAgentAppearance(agentType: agent.agentType, department: agent.resolvedDepartment),
                    mood: cozyAgentMood(for: agent.state), department: agent.resolvedDepartment, state: agent.state
                )
                .frame(maxWidth: .infinity, alignment: .center)
                .frame(height: 170)
                .accessibilityHidden(true)
                Text(agent.roleName).font(Typography.sectionTitle)
                Text(agent.displayName).font(Typography.caption).foregroundStyle(CozyPalette.ink.opacity(0.7))
                HStack(spacing: Spacing.xs) {
                    Text(agent.resolvedDepartment.label)
                        .font(Typography.captionEmphasis)
                        .padding(.horizontal, Spacing.sm).padding(.vertical, Spacing.tight)
                        .background(CozyPalette.department(agent.resolvedDepartment).opacity(0.22), in: Capsule())
                    Label(agent.state.label, systemImage: "circle.fill")
                        .font(Typography.captionEmphasis)
                        .foregroundStyle(agent.state.accentColor)
                        .padding(.horizontal, Spacing.sm).padding(.vertical, Spacing.tight)
                        .background(agent.state.tintColor, in: Capsule())
                }
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("현재 업무").font(Typography.captionEmphasis)
                    Text(agent.bubble.isEmpty ? "현재 말풍선 없음" : agent.bubble).font(Typography.body)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Spacing.sm)
                .background(CozyPalette.surface, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                Text(agent.job ?? agent.description).font(Typography.body).foregroundStyle(CozyPalette.ink.opacity(0.78))
                if !agent.slashCommands.isEmpty {
                    Text(agent.slashCommands.joined(separator: "  ")).font(Typography.metricMono)
                        .padding(.bottom, Spacing.sm)
                }
                // Keep a clear vertical gap before actions. A rule here can visually
                // intersect wrapped slash commands in an off-screen hosting capture.
                Color.clear.frame(height: Spacing.sm)
                if let approval {
                    VStack(spacing: Spacing.xs) {
                        Button("승인") { onApprove(approval.id) }
                            .frame(maxWidth: .infinity)
                            .tint(CozyPalette.apricot).keyboardShortcut(.defaultAction)
                        HStack(spacing: Spacing.xs) {
                            Button("승인 상세") { onApprovalDetail(approval) }
                                .frame(maxWidth: .infinity)
                            Button("거절") { onReject(approval.id) }
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .controlSize(.small)
                    .frame(maxWidth: .infinity)
                } else if agent.canReceiveCommand {
                    HStack {
                        TextField("\(agent.roleName)에게 지시…", text: $commandText).textFieldStyle(.roundedBorder)
                            .onSubmit { onSend(agent.agentType) }
                        Button("전송") { onSend(agent.agentType) }.tint(CozyPalette.apricot)
                            .disabled(commandText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 264)
        }
        .frame(width: Layout.officeInspectorWidth)
        .foregroundStyle(CozyPalette.ink)
        .background(CozyPalette.surface)
        .overlay(alignment: .leading) {
            Rectangle().fill(CozyPalette.outline).frame(width: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(agent.roleName) 담당자 상세")
    }
}
