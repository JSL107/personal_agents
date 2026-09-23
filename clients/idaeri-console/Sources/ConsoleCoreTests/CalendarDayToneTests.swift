import Foundation

@testable import ConsoleCore

/// 「어느 날이 빨간 날인가」 규칙의 검증.
func runCalendarDayToneTests(_ t: TestRunner) {
    t.suite("CalendarDayTone")

    // 일요일 시작 격자이므로 0번 칸이 일요일, 6번 칸이 토요일이다.
    do {
        t.expectEqual(
            calendarDayTone(weekdayIndex: 0, isHoliday: false), .holiday,
            "일요일은 빨간 날")
        t.expectEqual(
            calendarDayTone(weekdayIndex: 6, isHoliday: false), .saturday,
            "토요일은 파랑")
        t.expectEqual(
            calendarDayTone(weekdayIndex: 3, isHoliday: false), .weekday,
            "평일은 평범한 잉크색")
    }

    // 공휴일은 무슨 요일이든 일요일과 같은 갈래다 — 빨강을 둘로 나누면 화면에 빨강이
    // 셋(일요일·공휴일·실패)이 되어 어느 것이 위급한지 읽는 쪽이 판단해야 한다.
    do {
        t.expectEqual(
            calendarDayTone(weekdayIndex: 5, isHoliday: true), .holiday,
            "금요일 공휴일도 빨간 날")
        t.expectEqual(
            calendarDayTone(weekdayIndex: 6, isHoliday: true), .holiday,
            "토요일과 겹친 공휴일은 파랑이 아니라 빨강 — 쉬는 날이 우선한다")
    }
}
