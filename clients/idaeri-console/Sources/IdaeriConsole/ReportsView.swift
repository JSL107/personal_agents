import ConsoleCore
import SwiftUI

/// 콘솔 경로로 보관된 보고서를 날짜별로 보여 준다.
struct ReportsView: View {
    let client: ConsoleClient
    @State private var rows: [SlackDeliveryListRow] = []
    @State private var expandedIds: Set<Int> = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        ReportsContent(rows: rows, expandedIds: $expandedIds,
                       isLoading: isLoading, errorMessage: errorMessage,
                       onRefresh: { Task { await load() } })
            .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            rows = try await client.fetchDeliveries().items
        } catch {
            errorMessage = "보고서를 불러오지 못했습니다: \(error.localizedDescription)"
        }
        isLoading = false
    }
}

/// 렌더 fixture에서도 실제 화면과 동일한 목록과 상태를 쓴다.
struct ReportsContent: View {
    let rows: [SlackDeliveryListRow]
    @Binding var expandedIds: Set<Int>
    let isLoading: Bool
    let errorMessage: String?
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack {
                Text("보고서").font(.title2.bold()).foregroundStyle(CozyPalette.ink)
                Text("\(rows.count)건").font(Typography.captionEmphasis).foregroundStyle(.secondary)
                Spacer()
                Button(action: onRefresh) { Label("새로고침", systemImage: "arrow.clockwise") }
                    .disabled(isLoading)
            }
            if isLoading {
                ProgressView("보고서를 불러오는 중입니다")
                    .frame(maxWidth: .infinity, minHeight: 180)
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, minHeight: 180)
            } else if rows.isEmpty {
                Text("콘솔로 온 보고서가 없습니다").foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 180)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        ForEach(groupDeliveries(rows), id: \.dayKey) { group in
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                Text(group.label).font(Typography.captionEmphasis)
                                    .foregroundStyle(CozyPalette.ink)
                                ListPanel {
                                    ForEach(Array(group.rows.enumerated()), id: \.element.id) { index, row in
                                        if index > 0 { Divider() }
                                        reportRow(row)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(CozyPalette.canvas)
    }

    private func reportRow(_ row: SlackDeliveryListRow) -> some View {
        let expanded = expandedIds.contains(row.id)
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            Button {
                if expanded { expandedIds.remove(row.id) } else { expandedIds.insert(row.id) }
            } label: {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack(alignment: .top) {
                        Text(row.title).font(.headline).foregroundStyle(CozyPalette.ink)
                        Spacer(minLength: Spacing.sm)
                        Text(deliveryTimeLabel(row.createdAt)).font(Typography.caption)
                            .foregroundStyle(.secondary)
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(Typography.caption).foregroundStyle(.secondary)
                    }
                    // 펼치면 아래 본문이 미리보기를 대신한다 — 같은 문장이 두 번 보이지 않게.
                    if !expanded {
                        Text(row.textPreview).font(Typography.caption)
                            .foregroundStyle(.secondary).lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded {
                Text(row.bodyText).font(.body).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, Spacing.sm)
            }
        }
        .padding(Spacing.md)
    }
}
