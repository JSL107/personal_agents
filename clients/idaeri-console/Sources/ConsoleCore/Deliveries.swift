import Foundation

/// 백엔드 정본: `src/slack/domain/port/slack-delivery.repository.port.ts`.
public struct ListDeliveriesResult: Codable, Equatable, Sendable {
    public let status: String
    public let days: Int
    public let limit: Int
    public let items: [SlackDeliveryListRow]

    public init(status: String, days: Int, limit: Int, items: [SlackDeliveryListRow]) {
        self.status = status
        self.days = days
        self.limit = limit
        self.items = items
    }

    /// 서버는 최신 `limit` 건만 주고 전체 건수를 알려 주지 않는다. 한도가 꽉 찼으면 더 오래된
    /// 보고서가 잘렸을 수 있으므로 화면이 그 사실을 알려야 한다.
    public var isTruncated: Bool { items.count >= limit }
}

public struct SlackDeliveryListRow: Codable, Equatable, Sendable, Identifiable {
    public let id: Int
    public let kind: String
    public let itemKinds: [String]
    public let target: String
    public let channelId: String?
    public let messageTs: String?
    public let threadTs: String?
    public let status: String
    public let suppressReason: String?
    public let textPreview: String
    public let fullText: String?
    public let errorMessage: String?
    public let reactionCount: Int
    public let replyCount: Int
    public let createdAt: String

    public init(id: Int, kind: String, itemKinds: [String], target: String,
                channelId: String? = nil, messageTs: String? = nil, threadTs: String? = nil,
                status: String, suppressReason: String? = nil, textPreview: String,
                fullText: String? = nil, errorMessage: String? = nil,
                reactionCount: Int = 0, replyCount: Int = 0, createdAt: String) {
        self.id = id
        self.kind = kind
        self.itemKinds = itemKinds
        self.target = target
        self.channelId = channelId
        self.messageTs = messageTs
        self.threadTs = threadTs
        self.status = status
        self.suppressReason = suppressReason
        self.textPreview = textPreview
        self.fullText = fullText
        self.errorMessage = errorMessage
        self.reactionCount = reactionCount
        self.replyCount = replyCount
        self.createdAt = createdAt
    }

    public var bodyText: String { fullText ?? textPreview }
    public var title: String { itemKinds.map(reportKindLabel).joined(separator: " · ") }
}

public struct DeliveryDayGroup: Equatable, Sendable {
    public let dayKey: String
    public let label: String
    public let rows: [SlackDeliveryListRow]
}

private let reportKST = TimeZone(identifier: "Asia/Seoul")!

/// 서버의 ISO-8601 문자열을 절대 시각으로 해석한다. 유효하지 않으면 nil — 그 행은 「날짜 미상」 묶음으로 간다.
public func deliveryDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

public func deliveryTimeLabel(_ value: String) -> String {
    guard let date = deliveryDate(value) else { return "--:--" }
    let formatter = DateFormatter()
    formatter.timeZone = reportKST
    formatter.dateFormat = "HH:mm"
    return formatter.string(from: date)
}

/// 날짜를 읽지 못한 행을 모으는 묶음 키. 버리면 건수와 화면이 어긋나 빈 목록처럼 보인다.
public let unknownDeliveryDayKey = "unknown"

public func groupDeliveries(_ rows: [SlackDeliveryListRow]) -> [DeliveryDayGroup] {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = reportKST
    let valid = rows.compactMap { row -> (SlackDeliveryListRow, Date)? in
        guard let date = deliveryDate(row.createdAt) else { return nil }
        return (row, date)
    }.sorted { left, right in
        left.1 == right.1 ? left.0.id > right.0.id : left.1 > right.1
    }
    var groups: [DeliveryDayGroup] = []
    for (row, date) in valid {
        let parts = calendar.dateComponents([.year, .month, .day, .weekday], from: date)
        guard let year = parts.year, let month = parts.month,
              let day = parts.day, let weekday = parts.weekday else { continue }
        let key = String(format: "%04d-%02d-%02d", year, month, day)
        if let last = groups.last, last.dayKey == key {
            groups[groups.count - 1] = DeliveryDayGroup(dayKey: key, label: last.label, rows: last.rows + [row])
        } else {
            let weekdayNames = ["일", "월", "화", "수", "목", "금", "토"]
            groups.append(DeliveryDayGroup(dayKey: key,
                label: "\(month)월 \(day)일 (\(weekdayNames[weekday - 1]))", rows: [row]))
        }
    }
    let undated = rows.filter { deliveryDate($0.createdAt) == nil }
    if !undated.isEmpty {
        groups.append(DeliveryDayGroup(dayKey: unknownDeliveryDayKey, label: "날짜 미상", rows: undated))
    }
    return groups
}

/// Autopilot task id의 화면 이름. 미등록 id는 원문으로 남겨 새 작업도 식별 가능하게 한다.
public func reportKindLabel(_ id: String) -> String {
    let labels: [String: String] = [
        "work-reviewer": "업무 회고", "daily-eval": "일일 평가", "run-retro": "실행 회고",
        "paper-recommend": "모의투자 추천", "paper-order-fill": "모의투자 체결",
        "universe-sweep": "종목 수집", "screening-outcome-scoring": "종목 선별 성과 평가",
        "secretariat": "비서실", "study-deepdive": "심층 학습", "job-feed": "채용공고 수집",
        "stock-monitor-us": "미국 주식 모니터링", "docs-sync-audit": "문서 동기화 점검",
        "memory-vacuum": "메모리 정리", "ai-cli-env-snapshot": "AI CLI 환경 스냅샷",
        "preview-sweeper": "미리보기 정리", "run-sweeper": "실행 정리",
        "pr-review-sweep": "PR 리뷰 점검", "paper-trading": "모의투자 평가",
        "job-feed-gap": "채용공고 역량 격차", "portfolio-publish": "포트폴리오 발행",
        "study-brief": "학습 브리핑",
    ]
    return labels[id] ?? id
}
