import Foundation

/// 할 일 한 줄의 종류. 백엔드 `ConsoleTodoKind` 와 1:1.
public enum ConsoleTodoKind: String, Codable, Sendable {
    case approval = "APPROVAL"
    case failedRun = "FAILED_RUN"
    case prReview = "PR_REVIEW"
}

/// 회의실 벽면 판에 적히는 한 줄.
public struct ConsoleTodo: Codable, Equatable, Sendable {
    public let kind: ConsoleTodoKind
    public let label: String
    public let detail: String

    public init(kind: ConsoleTodoKind, label: String, detail: String) {
        self.kind = kind
        self.label = label
        self.detail = detail
    }
}

/// 연속 기록. 백엔드가 판정까지 끝낸 값이라 앱은 표시만 한다.
public struct ConsoleStreak: Codable, Equatable, Sendable {
    public let current: Int
    public let best: Int
    public let todayOpened: Int
    public let todayRemaining: Int

    public init(current: Int, best: Int, todayOpened: Int, todayRemaining: Int) {
        self.current = current
        self.best = best
        self.todayOpened = todayOpened
        self.todayRemaining = todayRemaining
    }

    /// 오늘 몫이 아직 남았는가. 남았으면 자정을 넘기는 순간 기록이 끊긴다.
    public var hasWorkLeftToday: Bool { todayRemaining > 0 }
}

/// 퇴근 정산 — 대표 옆에 놓이는 종이 한 장의 내용.
public struct ConsoleDailyReport: Codable, Equatable, Sendable {
    public let date: String
    public let succeeded: Int
    public let failed: Int
    public let approvalsOpened: Int
    public let approvalsHandled: Int
    public let pendingReviewPulls: Int

    public init(
        date: String, succeeded: Int, failed: Int,
        approvalsOpened: Int, approvalsHandled: Int, pendingReviewPulls: Int
    ) {
        self.date = date
        self.succeeded = succeeded
        self.failed = failed
        self.approvalsOpened = approvalsOpened
        self.approvalsHandled = approvalsHandled
        self.pendingReviewPulls = pendingReviewPulls
    }
}

/// `GET /v1/console/briefing` 응답.
public struct ConsoleBriefing: Codable, Equatable, Sendable {
    public let todos: [ConsoleTodo]
    public let streak: ConsoleStreak
    public let dailyReport: ConsoleDailyReport
    public let serverTime: String

    public init(
        todos: [ConsoleTodo], streak: ConsoleStreak,
        dailyReport: ConsoleDailyReport, serverTime: String
    ) {
        self.todos = todos
        self.streak = streak
        self.dailyReport = dailyReport
        self.serverTime = serverTime
    }
}

/// 퇴근 정산 종이를 지금 책상에 놓아야 하는가.
///
/// **시각 판정을 앱이 한다.** 서버가 "지금 보여라" 를 계산해 내려주면 서버 시각과 앱 시각이
/// 어긋날 때 종이가 안 나타나고, 하루 리듬 상수(`officeDepartureHour`)는 이미 앱에 있다.
///
/// 자정을 넘기면 사라진다 — 성적이 리셋되므로 빈 종이를 남기지 않는다.
public func officeShowsDailyReport(hour: Int) -> Bool {
    hour >= officeDepartureHour && hour <= 23
}

/// 정산 종이를 사람이 읽는 문장으로 편다.
///
/// 화면에 숫자만 늘어놓으면 "그래서 오늘 어땠는데" 가 안 남는다. 판정 기준과 규모를 문장에
/// 담아, 카드를 열었을 때 읽고 바로 닫을 수 있게 한다.
public func officeDailyReportLines(
    report: ConsoleDailyReport, streak: ConsoleStreak
) -> [String] {
    var lines: [String] = []
    lines.append("오늘 \(report.succeeded)건 끝냈고 \(report.failed)건 엎어졌습니다.")

    if report.approvalsOpened == 0 {
        lines.append("결재는 올라온 것이 없었습니다.")
    } else if report.approvalsHandled == report.approvalsOpened {
        lines.append(
            "결재 \(report.approvalsOpened)건 전부 오늘 안에 처리했습니다."
        )
    } else {
        let left = report.approvalsOpened - report.approvalsHandled
        lines.append(
            "결재 \(report.approvalsOpened)건 중 \(left)건이 남았습니다. 자정을 넘기면 연속 기록이 끊깁니다."
        )
    }

    if report.pendingReviewPulls > 0 {
        lines.append("리뷰 회수를 기다리는 PR 이 \(report.pendingReviewPulls)건 있습니다.")
    }

    if streak.current > 0 {
        lines.append("깨끗하게 마감 \(streak.current)일 연속 (최고 \(streak.best)일).")
    } else if streak.best > 0 {
        lines.append("연속 기록은 끊겼습니다. 최고 \(streak.best)일.")
    }

    return lines
}
