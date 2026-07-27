import ConsoleCore
import SwiftUI

/// 부서 그리드의 카드 하나. 에이전트 이름·상태 색·말풍선·담당 슬래시를 보여준다.
struct AgentCardView: View {
    let agent: ConsoleAgent

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

            if !agent.slashCommands.isEmpty {
                Text(agent.slashCommands.joined(separator: "  "))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
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
}
