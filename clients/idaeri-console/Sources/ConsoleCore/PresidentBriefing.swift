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

// MARK: - 대표 머리 위 할 일 말풍선

/// 대표 말풍선이 쓸 수 있는 가로 폭(격자 칸).
///
/// **길이는 만드는 쪽이 묶는다.** 대표는 상단 밴드 가운데에 서 있고 좌우가 세션 책상이라,
/// 말풍선이 책상 하나를 넘어가면 그 위에 뜨는 세션 이름을 덮는다. 받는 쪽에는 자기 자리를
/// 지킬 수단이 없다.
public let officePresidentBubbleWidthTiles: Double = 4.6

/// 대표 말풍선 줄 수 — **한 줄이다.**
///
/// 대표실은 화면 최상단 밴드라 머리 위로 쌓을 여유가 한 줄뿐이다. 왕관 문패 위에 경고등까지
/// 켜지면 그만큼 더 올라가는데, 두 줄로 접히면 윗줄이 창문 위 벽을 넘어 화면 밖으로 나간다.
public let officePresidentBubbleMaxLines: Int = 1

/// 대표 머리 위에 띄울 할 일 한 줄. 할 일이 없으면 nil — 말풍선을 띄우지 않는다.
///
/// **목록이 아니라 한 줄이다.** 회의실 벽 판이었을 때는 세 줄을 나열했는데, 그 판이 실제로
/// 새로 알려주는 것은 리뷰 회수 한 줄뿐이었다 — 승인은 대표실 앞 줄과 방치 압력으로
/// (`OfficeApprovalPressure`), 실패는 어깨 처짐으로(`CharacterNode.startSlump`) 이미 화면이
/// 말한다. 같은 사실을 글자로 한 번 더 적는 대신 가장 급한 하나를 말하고 나머지는 건수로 접는다.
///
/// **급한 순서는 목록 순서를 그대로 믿는다.** 백엔드가 승인 → 실패 → 리뷰 순으로 조립한다
/// (`BuildPresidentBriefingUsecase`). 여기서 다시 정렬하면 급한 기준을 두 곳이 따로 갖는다.
/// 대표 머리 위에 띄울 할 일 문장 후보들 — **긴 것부터**. 비어 있으면 말풍선을 띄우지 않는다. 몫에 들어가는 첫 문장을 고르는 것은 폭을 아는 쪽(씬)이다.
///
/// 후보가 필요한 이유는 작은 창이다. 글자 크기에는 하한이 있어 창을 줄이면 **글자는 그대로인데
/// 몫만 좁아진다** — 960×563 에서 굽어 보니 `승인 3건 — 19:04 만료 · 외 2건` 의 끝이 잘려
/// `· …` 이 됐다. 하필 사라진 것이 "다른 할 일이 2건 더 있다" 였다.
///
/// 그래서 버리는 순서를 정해 둔다: **상세를 먼저 버리고 건수를 남긴다.** 만료 시각은 카드를
/// 열면 다시 볼 수 있지만, 나머지 할 일이 있다는 사실은 이 한 줄이 유일한 통로다.
public func officePresidentTodoLines(todos: [ConsoleTodo]) -> [String] {
    guard let first = todos.first else {
        return []
    }
    let remaining = todos.count - 1
    // 마지막 후보는 **라벨을 통째로 버리고 건수만** 남긴다.
    //
    // 라벨에는 워커 이름이 그대로 들어온다 — 실패 할 일은 백엔드가 `${agentType} 재시도` 로
    // 만들어서(`buildFailedRunTodo`) `IMPACT_REPORTER 재시도` 같은 15자 이름이 온다. 작은 창
    // (타일 27.4pt·20.6pt)에서는 라벨을 남긴 후보가 전부 몫을 넘겨, 말줄임표가 끝을 먹으면서
    // 하필 "몇 건 더 있다" 가 사라졌다. 라벨을 자르면 어느 워커인지 알 수 없게 되므로,
    // 개별 정보를 다 버리고 건수를 지키는 쪽을 최후 후보로 둔다.
    let countOnly = "할 일 \(todos.count)건"
    guard remaining > 0 else {
        // 한 건뿐이면 상세만 버려도 대개 들어간다. 그래도 안 들어가면 건수 후보로 내려간다.
        return ["\(first.label) — \(first.detail)", first.label, countOnly]
    }
    return [
        "\(first.label) — \(first.detail) · 외 \(remaining)건",
        "\(first.label) · 외 \(remaining)건",
        "\(first.label) 외 \(remaining)건",
        countOnly,
    ]
}

// MARK: - 연속 기록 벽 게시판

/// 게시판에 찍을 수 있는 도장의 최대 개수.
///
/// 게시판 그림 폭(실사용 창에서 1.07칸)이 도장을 가로로 늘어놓을 수 있는 수를 정한다. 상한이
/// 없으면 연속 20일에 도장이 게시판을 넘어 벽으로 번진다.
public let officeStreakStampMaxCount: Int = 5

/// 게시판에 찍히는 도장 수 — 어제까지 이어진 연속 일수.
///
/// 도장은 **개수만** 말한다(0일이면 빈 게시판). 최고 기록·끊김 같은 맥락은 `streakText` 가
/// 맡아 퇴근 정산 카드에서 문장으로 나온다.
public func officeStreakStampCount(_ streak: ConsoleStreak) -> Int {
    max(0, min(streak.current, officeStreakStampMaxCount))
}

/// 연속 기록 한 줄. 끊긴 상태를 감추지 않는다 — 감추면 다시 이어 붙일 이유가 사라진다.
public func streakText(_ streak: ConsoleStreak) -> String {
    if streak.current > 0 {
        return "🔥 깨끗하게 마감 \(streak.current)일 연속"
    }
    if streak.best > 0 {
        return "연속 0일 (최고 \(streak.best)일)"
    }
    return "연속 기록 없음"
}

// MARK: - 노드 이름

/// 대표 머리 위 할 일 말풍선 노드 이름. 갱신 때 통째로 지우고 다시 그린다.
public let officePresidentTodoBubbleNodeName = "briefing:todo-bubble"
/// 벽 달력에 찍힌 도장 묶음 노드 이름.
public let officeStreakStampNodeName = "briefing:streak-stamps"
/// 대표 옆 정산 종이 노드 이름.
public let officeDailyReportNodeName = "briefing:paper"
/// 정산 종이를 펼쳤을 때 뜨는 카드 이름.
public let officeDailyReportCardNodeName = "briefing:paper-card"
/// 히트 판정에서 정산 종이를 가리키는 키. 대표(`officeHitTargetPresident`)보다 먼저 재야 한다 —
/// 종이가 더 작고 대표 옆에 붙어 있어, 순서를 뒤집으면 종이를 눌러도 지시 입력창이 열린다.
public let officeHitTargetDailyReport = "__daily_report__"

/// 도장을 게시판 그림 안쪽 어느 높이에 찍는가(게시판 높이 대비).
///
/// 위쪽은 코르크판 테두리라 거기 찍으면 판 밖으로 걸친 것처럼 보인다.
public let officeStreakStampHeightRatio: Double = 0.42
/// 도장 지름(게시판 폭 대비).
public let officeStreakStampDiameterRatio: Double = 0.13
/// 도장 사이 간격(게시판 폭 대비).
///
/// 지름보다 커야 도장이 서로 붙지 않는다. 상한(`officeStreakStampMaxCount`)까지 찍어도
/// 총 폭이 게시판을 넘지 않아야 하며, 그 관계는 테스트가 지킨다.
public let officeStreakStampStepRatio: Double = 0.16

/// 연속 기록 도장을 찍을 게시판 칸. 대표실 벽에 걸린 것만 고른다.
///
/// **`kind` 만으로 찾으면 안 된다.** 게시판은 기획방·리뷰방 벽에도 걸려 있어, 목록에서 처음
/// 만난 것을 집으면 도장이 남의 방 벽에 찍힌다 — 렌더를 봐야 알아차리는 종류의 어긋남이다.
/// 대표실 가로 범위 안이고 문패 줄보다 위(방 안쪽)인 것으로 좁힌다.
public func officeStreakBoardTile(
    furniture: [FurniturePlacement], presidentArea: CommonArea?
) -> TilePoint? {
    guard let presidentArea else {
        return nil
    }
    return furniture.first { placement in
        placement.kind == .wallPinboard
            && placement.tile.x >= presidentArea.originX
            && placement.tile.x < presidentArea.originX + presidentArea.width
            && placement.tile.y > presidentArea.labelY
    }?.tile
}
