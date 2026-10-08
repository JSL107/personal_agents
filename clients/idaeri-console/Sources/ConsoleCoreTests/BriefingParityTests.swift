import Foundation

@testable import ConsoleCore

/// 맥·웹 공용 대조표(`fixtures/president-briefing.json`). 웹 `scripts-check-briefing.mjs` 가 같은 파일을 읽어
/// `briefing.js` 를 잰다 — 기대값이 한 곳에 있어야 맥 규칙이 바뀌었을 때 웹 검사도 같이 깨진다.
/// 예전에는 웹 검사가 맥 출력을 손으로 베낀 값을 들고 있어, 맥이 바뀌어도 웹은 초록이었다.
private struct BriefingFixture: Decodable {
    struct Constants: Decodable {
        let presidentBubbleWidthTiles: Double
        let streakStampMaxCount: Int
        let streakStampHeightRatio: Double
        let streakStampDiameterRatio: Double
        let streakStampStepRatio: Double
    }
    struct TodoCase: Decodable {
        let name: String
        let todos: [ConsoleTodo]
        let expected: [String]
    }
    struct StampCase: Decodable {
        let current: Int
        let count: Int
        let saturated: Bool
    }
    struct DailyReportWindow: Decodable {
        let departureHour: Int
        let shownHours: [Int]
    }
    struct ReportCase: Decodable {
        let name: String
        let report: ConsoleDailyReport
        let streak: ConsoleStreak
        let expected: [String]
    }
    struct BoardCase: Decodable {
        let name: String
        let furniture: [FurniturePlacement]
        let presidentArea: CommonArea?
        let expected: TilePoint?
    }

    let constants: Constants
    let presidentTodoLines: [TodoCase]
    let streakStamps: [StampCase]
    let showsDailyReport: DailyReportWindow
    let dailyReportLines: [ReportCase]
    let streakBoardTile: [BoardCase]
}

private func loadBriefingFixture() throws -> BriefingFixture {
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // ConsoleCoreTests
        .deletingLastPathComponent()  // Sources
        .deletingLastPathComponent()  // 패키지 루트
        .appendingPathComponent("fixtures/president-briefing.json")
    return try JSONDecoder().decode(BriefingFixture.self, from: Data(contentsOf: url))
}

func runBriefingParityTests(_ t: TestRunner) {
    t.suite("BriefingParity")

    let fixture: BriefingFixture
    do {
        fixture = try loadBriefingFixture()
    } catch {
        t.fail("공용 대조표를 읽지 못했다: \(error)")
        return
    }

    // 웹은 상수를 따로 적는다 — 맥 값과 대조표가 어긋나면 웹이 다른 크기로 그린다.
    let constants = fixture.constants
    t.expectEqual(officePresidentBubbleWidthTiles, constants.presidentBubbleWidthTiles, "말풍선 폭")
    t.expectEqual(officeStreakStampMaxCount, constants.streakStampMaxCount, "도장 상한")
    t.expectEqual(officeStreakStampHeightRatio, constants.streakStampHeightRatio, "도장 높이")
    t.expectEqual(officeStreakStampDiameterRatio, constants.streakStampDiameterRatio, "도장 지름")
    t.expectEqual(officeStreakStampStepRatio, constants.streakStampStepRatio, "도장 간격")

    for testCase in fixture.presidentTodoLines {
        t.expectEqual(officePresidentTodoLines(todos: testCase.todos), testCase.expected, testCase.name)
    }

    for testCase in fixture.streakStamps {
        let streak = ConsoleStreak(current: testCase.current, best: 0, todayOpened: 0, todayRemaining: 0)
        t.expectEqual(officeStreakStampCount(streak), testCase.count, "연속 \(testCase.current)일 도장 수")
        t.expectEqual(officeStreakStampSaturated(streak), testCase.saturated, "연속 \(testCase.current)일 포화")
    }

    // 맥은 퇴근 시각을 상수로, 웹은 평면도에서 읽는다. 대조표의 시각이 맥 상수와 같아야 웹 검사의 입력이 맞다.
    t.expectEqual(officeDepartureHour, fixture.showsDailyReport.departureHour, "퇴근 시각")
    t.expectEqual(
        (0..<24).filter { officeShowsDailyReport(hour: $0) },
        fixture.showsDailyReport.shownHours,
        "정산 종이를 놓는 시각"
    )

    for testCase in fixture.dailyReportLines {
        t.expectEqual(
            officeDailyReportLines(report: testCase.report, streak: testCase.streak),
            testCase.expected,
            testCase.name
        )
    }

    for testCase in fixture.streakBoardTile {
        t.expectEqual(
            officeStreakBoardTile(furniture: testCase.furniture, presidentArea: testCase.presidentArea),
            testCase.expected,
            testCase.name
        )
    }
}
