import ConsoleCore
import SwiftUI

/// 승인 카드 상세 시트 — previewText 전문 + 만료 시각 + 승인/거절.
/// DashboardView 와 OfficeView 가 공유한다. 닫기(선택 해제)는 호출한 뷰가 콜백 안에서 처리한다.
struct ApprovalDetailSheet: View {
    let approval: ConsoleApproval
    let onApprove: (String) -> Void
    let onReject: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("승인 대기").font(Typography.sectionTitle)
            ScrollView {
                Text(approval.title)
                    .font(Typography.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("만료: \(Self.formatTime(approval.expiresAt))")
                .font(Typography.caption)
                .foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("거절") { onReject(approval.id) }.tint(.red)
                Button("승인") { onApprove(approval.id) }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(Spacing.xl)
        .frame(minWidth: Layout.sheetMinWidth, minHeight: 300)
    }

    /// ISO 8601 → "MM-dd HH:mm:ss". 파싱 실패 시 원문 그대로 (DashboardView.formatTime 과 동일 규칙).
    private static func formatTime(_ iso: String) -> String {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        guard let date = withFraction.date(from: iso) ?? plain.date(from: iso) else {
            return iso
        }
        let output = DateFormatter()
        output.dateFormat = "MM-dd HH:mm:ss"
        return output.string(from: date)
    }
}
