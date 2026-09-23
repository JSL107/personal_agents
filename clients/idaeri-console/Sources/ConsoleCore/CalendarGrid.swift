import Foundation

/// 일요일로 시작하는 월 격자. 앞뒤 빈 칸은 nil 로 채워 7의 배수 길이를 보장한다.
///
/// 한국에서 쓰는 종이 달력이 일요일 시작이라 그것에 맞춘다(2026-09-23 변경). 월요일 시작으로
/// 두면 같은 달을 두 배치로 기억하게 되어, 종이 달력에서 본 "둘째 주 수요일" 이 이 화면에서
/// 한 칸 어긋난 자리에 있다.
///
/// 계산은 UTC 로 고정한다 — 로컬 타임존을 쓰면 자정 부근에서 월 경계가 밀릴 수 있고,
/// `ScheduleItem.dueDay`(백엔드 `@db.Date` 앞 10자)도 타임존 없는 순수 날짜라 여기도
/// 맞춰야 같은 날짜끼리 비교된다.
public func monthGridDays(year: Int, month: Int) -> [Int?] {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = 1
    guard
        let first = calendar.date(from: components),
        let range = calendar.range(of: .day, in: .month, for: first)
    else {
        return []
    }
    // weekday 는 일요일이 1, 토요일이 7이다. 일요일 시작 격자에서는 그대로 1을 빼면 된다
    // (일요일 → 0칸, 토요일 → 6칸). 월요일 시작일 때 필요했던 `(weekday + 5) % 7` 의
    // 한 바퀴 돌기가 여기서는 없어진다.
    let weekday = calendar.component(.weekday, from: first)
    let leading = weekday - 1
    var days: [Int?] = Array(repeating: nil, count: leading)
    days.append(contentsOf: range.map { Optional($0) })
    while days.count % 7 != 0 {
        days.append(nil)
    }
    return days
}
