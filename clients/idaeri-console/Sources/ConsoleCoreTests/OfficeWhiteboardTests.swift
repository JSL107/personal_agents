import Foundation

@testable import ConsoleCore

/// 실사용 창(960×1050)에서 부서가 2열로 잡힐 때의 회의실 규격.
///
/// **타일 크기는 씬 좌표 기준(960 / 23열 ≒ 41.7pt)이다.** 처음에 렌더 PNG 의 픽셀(2배)로
/// 재서 83.5 를 넣었더니, 실제보다 두 배 넉넉한 판에서 계산해 "세 줄이 다 들어간다" 는
/// 결론이 나왔다 — 화면에서는 마지막 줄이 잘려 있는데 테스트는 초록이었다.
private let realTileSize = 960.0 / 23.0
private let realBoardWidth = 8.0 * officeBoardWidthRatio * realTileSize
private let realBoardHeight = officeBoardHeightTiles * realTileSize

private let sampleTodos = [
    ConsoleTodo(kind: .prReview, label: "PR 리뷰 회수 3건", detail: "10일째")
]
private let sampleStreak = ConsoleStreak(
    current: 0, best: 3, todayOpened: 0, todayRemaining: 0
)

func runOfficeWhiteboardTests(_ t: TestRunner) {
    t.suite("OfficeWhiteboard")

    // 연속 기록이 남는가 — 실사용 창 기준
    let streakLayout = officeBoardLayout(
        todos: sampleTodos,
        streak: sampleStreak,
        boardWidth: realBoardWidth,
        boardHeight: realBoardHeight
    )

    // 연속 기록은 이 기능의 절반이다. 실사용 창에서 잘리면 보드가 반쪽만 말한다.
    t.expect(
        streakLayout.lines.count == 2,
        "실사용 창에서 할 일 + 연속 기록 두 줄이 모두 남아야 한다 (실제: \(streakLayout.lines.count)줄)"
    )
    t.expect(
        streakLayout.lines.last?.text.contains("최고 3일") == true,
        "마지막 줄이 연속 기록이어야 한다 (실제: \(streakLayout.lines.last?.text ?? "없음"))"
    )

    // 줄 높이 합이 판을 넘지 않는가 — 할 일이 꽉 찬 경우
    let fullLayout = officeBoardLayout(
        todos: [
            ConsoleTodo(kind: .approval, label: "승인 2건", detail: "19:04 만료"),
            ConsoleTodo(kind: .failedRun, label: "PM 재시도", detail: "다음 실행은 내일"),
            ConsoleTodo(kind: .prReview, label: "PR 리뷰 회수 3건", detail: "10일째"),
        ],
        streak: sampleStreak,
        boardWidth: realBoardWidth,
        boardHeight: realBoardHeight
    )

    // 계산이 줄 수를 책임진다. 씬은 받은 줄을 그대로 그리므로, 여기서 넘치면 글자가 판
    // 밖으로 흘러 문패를 덮는다(실제로 그렇게 그려졌던 자리다).
    let titleHeight: Double = fullLayout.titleFontSize * officeBoardTitleSpacing
    var bodyHeight: Double = 0
    for line in fullLayout.lines {
        bodyHeight += line.fontSize * officeBoardLineSpacing
    }
    let consumed: Double = titleHeight + bodyHeight
    let allowed: Double = realBoardHeight * officeBoardVerticalUsage
    t.expect(
        consumed <= allowed + 0.01,
        "줄 높이 합(\(consumed))이 판 안(\(allowed))에 들어가야 한다"
    )

    // 긴 줄은 자르지 않고 줄인다
    let long = ConsoleTodo(
        kind: .prReview, label: "PR #1005 리뷰 회수", detail: "11일째 방치되는 중"
    )
    let longLayout = officeBoardLayout(
        todos: [long], streak: nil,
        boardWidth: realBoardWidth, boardHeight: realBoardHeight
    )

    guard let line = longLayout.lines.first else {
        t.expect(false, "긴 줄이 통째로 사라지면 안 된다")
        return
    }
    // 말줄임표로 자르면 어느 PR 인지가 사라진다. 글자를 줄여서라도 번호를 남긴다.
    t.expect(line.text.contains("#1005"), "PR 번호가 남아야 한다: \(line.text)")
    t.expect(
        officeBoardTextWidth(line.text, fontSize: line.fontSize)
            <= realBoardWidth * 0.88 + 0.01,
        "줄이 판 폭 안에 들어가야 한다"
    )

    // 밀린 것이 없으면 그 사실을 적는다
    let emptyLayout = officeBoardLayout(
        todos: [], streak: sampleStreak,
        boardWidth: realBoardWidth, boardHeight: realBoardHeight
    )

    // 빈 판은 고장과 구별되지 않는다.
    t.expect(
        emptyLayout.lines.contains { $0.text.contains("밀린 일 없음") },
        "할 일이 없으면 그 사실을 적어야 한다"
    )

    // 정산 종이는 저녁에만 놓인다
    t.expect(!officeShowsDailyReport(hour: 10), "낮에는 종이를 놓지 않는다")
    t.expect(!officeShowsDailyReport(hour: 20), "퇴근 시각 전에는 놓지 않는다")
    t.expect(officeShowsDailyReport(hour: 21), "퇴근 시각부터 놓는다")
    t.expect(officeShowsDailyReport(hour: 23), "자정 직전까지 놓는다")
    // 자정을 넘기면 성적이 리셋되므로 빈 종이를 남기지 않는다.
    t.expect(!officeShowsDailyReport(hour: 0), "자정 이후에는 걷는다")

    // 정산 문장이 남은 몫을 말한다
    let lines = officeDailyReportLines(
        report: ConsoleDailyReport(
            date: "2026-08-20", succeeded: 15, failed: 0,
            approvalsOpened: 2, approvalsHandled: 1, pendingReviewPulls: 3
        ),
        streak: ConsoleStreak(current: 0, best: 3, todayOpened: 2, todayRemaining: 1)
    )

    // 숫자만 늘어놓으면 "그래서 오늘 어땠는데" 가 안 남는다. 남은 몫과 그 결과를 말해야 한다.
    t.expect(
        lines.contains { $0.contains("1건이 남았습니다") },
        "남은 결재를 말해야 한다: \(lines)"
    )
    t.expect(
        lines.contains { $0.contains("연속 기록이 끊깁니다") },
        "자정을 넘기면 어떻게 되는지 말해야 한다: \(lines)"
    )
    t.expect(
        lines.contains { $0.contains("최고 3일") },
        "최고 기록을 남겨야 한다: \(lines)"
    )

}
