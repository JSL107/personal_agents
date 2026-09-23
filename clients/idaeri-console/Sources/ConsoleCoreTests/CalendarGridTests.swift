import Foundation

@testable import ConsoleCore

/// 월 격자 계산(순수 함수)의 검증.
func runCalendarGridTests(_ t: TestRunner) {
    t.suite("CalendarGrid")

    // 2026-09-01 은 화요일. 일요일 시작 격자라면 앞에 빈 칸 2개(일·월)가 붙는다.
    do {
        let days = monthGridDays(year: 2026, month: 9)
        t.expectNil(days[0], "9월 1일 앞에 일요일 자리 빈 칸")
        t.expectNil(days[1], "9월 1일 앞에 월요일 자리 빈 칸")
        t.expectEqual(days[2], 1, "9월 1일은 화요일 자리(격자 3번째 칸)")
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

    // 2026-11-01 은 일요일 — 일요일 시작 격자에서 앞 빈 칸이 **0개** 가 되는 경계다.
    // `weekday` 가 1 이므로 `weekday - 1` 이 0 을 내야 맞는다. 월요일 시작이던 시절 이 달은
    // 반대쪽 경계(빈 칸 6개)였다 — 두 경계를 모두 지켜야 한 주가 통째로 밀리는 것을 잡는다.
    do {
        let days = monthGridDays(year: 2026, month: 11)
        t.expectEqual(days[0], 1, "11월 1일은 격자 첫 칸(일요일)")
    }

    // 2026-08-01 은 토요일 — 일요일 시작 격자에서 앞 빈 칸이 최대(6개)가 되는 반대쪽 경계.
    do {
        let days = monthGridDays(year: 2026, month: 8)
        t.expectNil(days[5], "8월 1일 앞 빈 칸은 6개 — 여섯 번째 칸까지 비어 있다")
        t.expectEqual(days[6], 1, "8월 1일은 토요일 자리(격자 7번째 칸)")
    }

    // 윤년 2월은 29일까지. 말일을 달력에서 얻지 않고 28 로 박으면 여기서 하루가 샌다.
    do {
        let days = monthGridDays(year: 2024, month: 2).compactMap { $0 }
        t.expectEqual(days.last, 29, "2024년 2월 말일은 29일(윤년)")
        t.expectEqual(days.count, 29, "윤년 2월은 날짜 칸이 29개")
    }
}
