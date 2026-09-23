import Foundation

/// 달력 날짜 숫자의 색 갈래. **뷰에서 떼어 여기 둔다** — 색 자체(`CozyPalette`)는 SwiftUI 라
/// 여기 못 들어오지만, "어느 날이 빨간 날인가" 라는 **규칙** 은 여기 있어야 단위 테스트가
/// 잡는다. 뷰 안에 두면 규칙이 깨진 것을 그림을 굽고 사람이 들여다볼 때까지 아무도 모른다
/// (`CalendarDayList.swift` 와 같은 이유).
public enum CalendarDayTone {
    /// 일요일과 공휴일. **둘을 하나로 묶은 것이 규칙이다** — 서로 다른 빨강으로 가르면
    /// 화면의 빨강이 셋(일요일·공휴일·실패)이 되어 어느 것이 위급한지 흐려진다.
    case holiday
    case saturday
    case weekday
}

/// 격자에서 이 칸이 어느 갈래인가. `weekdayIndex` 는 일요일 시작 격자의 0~6 이다
/// (`monthGridDays` 의 배치와 같은 기준 — 둘이 어긋나면 색이 한 칸씩 밀린다).
///
/// 오늘 강조는 이 판정보다 앞선다(호출부가 먼저 가른다) — 오늘이면서 일요일인 칸을 두 번
/// 칠하면 "오늘이라서" 와 "일요일이라서" 가 한 자리에서 겹친다.
public func calendarDayTone(weekdayIndex: Int, isHoliday: Bool) -> CalendarDayTone {
    if isHoliday || weekdayIndex == 0 {
        return .holiday
    }
    if weekdayIndex == 6 {
        return .saturday
    }
    return .weekday
}
