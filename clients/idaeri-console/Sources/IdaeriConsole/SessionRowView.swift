import ConsoleCore
import SwiftUI

/// 로컬 CLI 세션 한 줄. 소스 배지(cc/cx)·이름·cwd·활동 상태·경과를 보여준다. 읽기 전용.
struct SessionRowView: View {
    let session: ConsoleSession
    let onInject: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text(sourceBadge)
                .font(.system(.caption2, design: .monospaced).weight(.bold))
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(Color.primary.opacity(0.08))
                )
            Circle()
                .fill(stateColor)
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 1) {
                Text(session.name)
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                Text(session.cwd)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 2) {
                Text(session.state == "active" ? "활동 중" : "유휴")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Button("작업 주입", action: onInject)
                    .buttonStyle(.borderless)
                    .font(.caption2)
            }
        }
        .padding(.vertical, 3)
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
