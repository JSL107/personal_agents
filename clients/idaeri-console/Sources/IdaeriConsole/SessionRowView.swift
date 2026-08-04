import ConsoleCore
import SwiftUI

/// 로컬 CLI 세션 한 줄. 소스 배지(cc/cx)·이름·cwd·활동 상태·경과를 보여준다. 읽기 전용.
struct SessionRowView: View {
    let session: ConsoleSession
    let onInject: () -> Void

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Text(sourceBadge)
                .font(Typography.badgeMono)
                .padding(.horizontal, Spacing.xs)
                .padding(.vertical, Spacing.tight)
                .background(
                    RoundedRectangle(cornerRadius: Radius.badge, style: .continuous)
                        .fill(Color.primary.opacity(0.08))
                )
            Circle()
                .fill(stateColor)
                .frame(width: Stroke.dot, height: Stroke.dot)
            VStack(alignment: .leading, spacing: Spacing.tight) {
                Text(session.name)
                    .font(Typography.bodyEmphasis)
                    .lineLimit(1)
                Text(session.cwd)
                    .font(Typography.metricMonoSmall)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: Spacing.tight) {
                Text(session.state == "active" ? "활동 중" : "유휴")
                    .font(Typography.captionSmall)
                    .foregroundStyle(.secondary)
                Button("작업 주입", action: onInject)
                    .buttonStyle(.borderless)
                    .font(Typography.captionSmall)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private var sourceBadge: String {
        session.source == "codex" ? "cx" : "cc"
    }

    private var stateColor: Color {
        session.state == "active"
            ? Color(red: 0.36, green: 0.78, blue: 0.63) // 민트 = 활동
            : Color(white: 0.6) // 회색 = 유휴
    }
}
