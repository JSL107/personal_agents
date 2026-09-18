import Foundation

@testable import ConsoleCore

/// 월 격자 계산(순수 함수)의 검증.
func runCalendarGridTests(_ t: TestRunner) {
    t.suite("CalendarGrid")

    // 2026-09-01 은 화요일. 월요일 시작 격자라면 앞에 빈 칸 1개가 붙는다.
    do {
        let days = monthGridDays(year: 2026, month: 9)
        t.expectNil(days[0], "9월 1일 앞에 월요일 자리 빈 칸")
        t.expectEqual(days[1], 1, "9월 1일은 화요일 자리")
    }

    // 격자 길이는 항상 7의 배수.
    do {
        let days = monthGridDays(year: 2026, month: 9)
        t.expectEqual(days.count % 7, 0, "격자 길이는 7의 배수")
    }

    // 말일까지 전부 담긴다(2026년 2월 = 28일, 윤년 아님).
    do {
        let days = monthGridDays(year: 2026, month: 2).compactMap { $0 }
        t.expectEqual(days.last, 28, "2월 말일 28일까지 전부 담김")
    }
}
