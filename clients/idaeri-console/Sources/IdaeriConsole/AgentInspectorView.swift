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
            VStack(alignment: .leading, spacing: Spacing.lg) {
                HStack {
                    HStack(spacing: Spacing.sm) {
                        Circle()
                            .fill(agent.state.accentColor)
                            .frame(width: 12, height: 12)
                        Text("담당자 상세").font(Typography.sectionTitle)
                    }
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(CozyPalette.ink.opacity(0.46))
                    }
                        .buttonStyle(.plain)
                        .keyboardShortcut(.cancelAction)
                        .accessibilityLabel("담당자 상세 닫기")
                }

                ZStack(alignment: .topTrailing) {
                    LinearGradient(
                        colors: [CozyPalette.canvas, CozyPalette.department(agent.resolvedDepartment).opacity(0.16)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    CozyAgentAvatarView(
                        appearance: cozyAgentAppearance(agentType: agent.agentType, department: agent.resolvedDepartment),
                        mood: cozyAgentMood(for: agent.state), department: agent.resolvedDepartment, state: agent.state
                    )
                    .padding(.top, Spacing.sm)
                    .padding(.horizontal, Spacing.lg)
                    .accessibilityHidden(true)
                    Image(systemName: "ellipsis")
                        .font(.headline)
                        .foregroundStyle(CozyPalette.ink.opacity(0.58))
                        .padding(Spacing.md)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 230)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.62), lineWidth: 1)
                )

                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(agent.roleName).font(.title3.bold())
                    Text(agent.displayName).font(Typography.caption).foregroundStyle(CozyPalette.ink.opacity(0.62))
                    HStack(spacing: Spacing.xs) {
                        Text(agent.resolvedDepartment.label)
                            .font(Typography.captionEmphasis)
                            .padding(.horizontal, Spacing.sm).padding(.vertical, Spacing.xs)
                            .background(CozyPalette.department(agent.resolvedDepartment).opacity(0.22), in: Capsule())
                        Label(agent.state.label, systemImage: "circle.fill")
                            .font(Typography.captionEmphasis)
                            .foregroundStyle(agent.state.accentColor)
                            .padding(.horizontal, Spacing.sm).padding(.vertical, Spacing.xs)
                            .background(agent.state.tintColor, in: Capsule())
                    }
                }

                VStack(alignment: .leading, spacing: Spacing.xs) {
                    HStack(spacing: Spacing.sm) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(Color(red: 0.27, green: 0.72, blue: 0.48))
                        VStack(alignment: .leading, spacing: Spacing.tight) {
                            Text("현재 업무").font(Typography.captionEmphasis)
                            Text(agent.bubble.isEmpty ? "업무를 기다리고 있어요" : agent.bubble)
                                .font(Typography.body)
                                .lineLimit(3)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Spacing.md)
                .background(Color(red: 0.88, green: 0.96, blue: 0.88).opacity(0.82), in: RoundedRectangle(cornerRadius: Radius.panel, style: .continuous))
                Text(agent.job ?? agent.description).font(Typography.body).foregroundStyle(CozyPalette.ink.opacity(0.78))
                if !agent.slashCommands.isEmpty {
                    Text(agent.slashCommands.joined(separator: "  ")).font(Typography.metricMono)
                }
                if let approval {
                    VStack(spacing: Spacing.xs) {
                        Button { onApprove(approval.id) } label: {
                            Label("승인", systemImage: "arrow.right")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, Spacing.sm)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 1.0, green: 0.66, blue: 0.28))
                        .keyboardShortcut(.defaultAction)
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
                    VStack(spacing: Spacing.sm) {
                        TextField("\(agent.roleName)에게 지시…", text: $commandText).textFieldStyle(.roundedBorder)
                            .onSubmit { onSend(agent.agentType) }
                        Button { onSend(agent.agentType) } label: {
                            HStack {
                                Spacer()
                                Text("업무 맡기기").font(Typography.bodyEmphasis)
                                Image(systemName: "arrow.right")
                                Spacer()
                            }
                            .padding(.vertical, Spacing.sm)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 1.0, green: 0.66, blue: 0.28))
                            .disabled(commandText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 268)
        }
        .frame(width: Layout.officeInspectorWidth)
        .foregroundStyle(CozyPalette.ink)
        .background(CozyPalette.canvas)
        .overlay(alignment: .leading) {
            Rectangle().fill(CozyPalette.outline.opacity(0.18)).frame(width: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(agent.roleName) 담당자 상세")
    }
}
