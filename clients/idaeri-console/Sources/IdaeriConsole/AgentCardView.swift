import ConsoleCore
import SwiftUI

/// 부서 그리드의 카드 하나. 에이전트 이름·상태 색·말풍선·담당 슬래시를 보여준다.
struct AgentCardView: View {
    let agent: ConsoleAgent
    /// 전체 pending 목록 — 카드는 자신의 agentType 에 매칭되는 항목만 걸러 배지로 보여준다.
    let pendingCommands: [PendingCommand]
    let onSend: (String, String?) -> Void

    @State private var showSheet = false
    @State private var inputText = ""

    private var matchingPending: [PendingCommand] {
        pendingCommands.filter { $0.effectiveAgentType == agent.agentType }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(agent.displayName)
                    .font(.headline)
                    .lineLimit(1)
                Spacer(minLength: 0)
                statusBadge
            }

            // 말풍선 — 백엔드가 소유한 상태 문구
            Text(agent.bubble)
                .font(.callout)
                .foregroundStyle(.primary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.primary.opacity(0.05))
                )

            if !matchingPending.isEmpty {
                pendingBadgeRow
            }

            if !agent.slashCommands.isEmpty {
                Text(agent.slashCommands.joined(separator: "  "))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Button("지시") { showSheet = true }
                .font(.caption)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(agent.state.tintColor)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(agent.state.accentColor.opacity(0.55), lineWidth: 1.5)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.displayName), \(agent.state.label), \(agent.bubble)")
        .sheet(isPresented: $showSheet) {
            commandSheet
        }
    }

    private var statusBadge: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(agent.state.accentColor)
                .frame(width: 8, height: 8)
            Text(agent.state.label)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }

    private var pendingBadgeRow: some View {
        HStack(spacing: 6) {
            ForEach(matchingPending) { command in
                Text("\(command.phase.badgeIcon) \(command.phase.badgeLabel)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// "지시" 버튼으로 여는 텍스트 입력 시트 — 이 카드의 agentType 을 힌트로 고정해 전송한다.
    private var commandSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("\(agent.displayName)에 지시")
                .font(.headline)
            TextField("지시 내용…", text: $inputText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)
            HStack {
                Spacer()
                Button("취소") {
                    inputText = ""
                    showSheet = false
                }
                Button("전송") {
                    onSend(inputText, agent.agentType)
                    inputText = ""
                    showSheet = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(minWidth: 320)
    }
}
