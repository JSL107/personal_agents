import AppKit
import ConsoleCore
import SwiftUI

/// 네트워크 없이 실제 보고서 목록을 PNG로 굽는다.
func renderReportsPreview(path: String) -> Bool {
    let rows = [
        SlackDeliveryListRow(id: 1, kind: "AUTOPILOT", itemKinds: ["work-reviewer", "daily-eval"],
            target: "owner", status: "SUPPRESSED", suppressReason: "CONSOLE_ROUTE",
            textPreview: "오늘의 업무와 평가를 정리했습니다.",
            fullText: "오늘의 업무와 평가를 정리했습니다.\n완료한 작업 세 건을 검토했습니다.\n내일은 남은 항목을 확인합니다.",
            createdAt: "2026-10-13T10:30:00.000Z"),
        SlackDeliveryListRow(id: 2, kind: "AUTOPILOT",
            itemKinds: ["screening-outcome-scoring", "ai-cli-env-snapshot", "docs-sync-audit"],
            target: "owner", status: "SUPPRESSED", textPreview: "긴 제목의 보고서 미리보기입니다.",
            createdAt: "2026-10-13T02:00:00.000Z"),
        SlackDeliveryListRow(id: 3, kind: "AUTOPILOT", itemKinds: ["run-retro"],
            target: "owner", status: "SUPPRESSED", textPreview: "지난 실행을 돌아봤습니다.",
            createdAt: "2026-10-12T05:00:00.000Z"),
    ]
    let size = CGSize(width: 1000, height: 850)
    let view = ReportsContent(rows: rows, expandedIds: .constant([1]), isLoading: false,
                              errorMessage: nil, onRefresh: {})
        .frame(width: size.width, height: size.height)
    let hostingView = NSHostingView(rootView: view)
    hostingView.frame = NSRect(origin: .zero, size: size)
    hostingView.layoutSubtreeIfNeeded()
    guard let bitmap = hostingView.bitmapImageRepForCachingDisplay(in: hostingView.bounds) else { return false }
    hostingView.cacheDisplay(in: hostingView.bounds, to: bitmap)
    guard let data = bitmap.representation(using: .png, properties: [:]) else { return false }
    do {
        try data.write(to: URL(fileURLWithPath: path))
        return true
    } catch { return false }
}
