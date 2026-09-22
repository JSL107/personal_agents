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

    // 2026-11-01 은 일요일 — 월요일 시작 격자에서 앞 빈 칸이 최대(6개)가 되는 경계다.
    // 일요일은 `Calendar` 의 weekday 가 1 이라 `(weekday + 5) % 7` 이 한 바퀴 돌아 6 을 내야
    // 맞는데, 이 자리를 놓치면 leading 이 0 이 되어 한 주가 통째로 밀린다(1일이 월요일 칸에 선다).
    do {
        let days = monthGridDays(year: 2026, month: 11)
        t.expectNil(days[5], "11월 1일 앞 빈 칸은 6개 — 여섯 번째 칸까지 비어 있다")
        t.expectEqual(days[6], 1, "11월 1일은 일요일 자리(격자 7번째 칸)")
    }

    // 윤년 2월은 29일까지. 말일을 달력에서 얻지 않고 28 로 박으면 여기서 하루가 샌다.
    do {
        let days = monthGridDays(year: 2024, month: 2).compactMap { $0 }
        t.expectEqual(days.last, 29, "2024년 2월 말일은 29일(윤년)")
        t.expectEqual(days.count, 29, "윤년 2월은 날짜 칸이 29개")
    }
}
