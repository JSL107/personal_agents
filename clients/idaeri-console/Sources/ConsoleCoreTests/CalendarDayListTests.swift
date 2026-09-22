import Foundation

@testable import ConsoleCore

private func sample(
    id: Int,
    title: String,
    day: String,
    status: ScheduleStatus
) -> ScheduleItem {
    ScheduleItem(
        id: id, title: title, dueDate: "\(day)T00:00:00.000Z",
        linkUrl: nil, memo: nil, status: status
    )
}

/// 날짜별 목록·점 계산(순수 함수)의 검증.
///
/// 이 스위트가 지키는 것은 조판이 아니라 **되돌릴 수 있음** 이다. 치운 항목이 목록에서
/// 빠지면 되돌리기 버튼이 붙을 자리 자체가 없어지고, 그때 백엔드의 `DONE → OPEN` 허용은
/// 앱에서 닿을 수 없는 선언이 된다.
func runCalendarDayListTests(_ t: TestRunner) {
    t.suite("CalendarDayList")

    // 날짜 키는 백엔드 `@db.Date` 표현과 같아야 한다 — 한 자리 월·일에 0 이 안 붙으면
    // `dueDay`(ISO 앞 10자)와 문자열 비교가 전부 어긋나 목록이 통째로 빈다.
    do {
        t.expectEqual(calendarDayKey(year: 2026, month: 9, day: 5), "2026-09-05", "한 자리 월·일에 0 을 채운다")
        t.expectEqual(calendarDayKey(year: 2026, month: 12, day: 31), "2026-12-31", "두 자리 월·일도 그대로")
    }

    // 핵심 회귀. 완료·건너뜀을 걷어내던 동안 완료를 누른 항목은 화면에서 사라졌고,
    // 그래서 앱 안에 되돌릴 입구가 없었다.
    do {
        let items = [
            sample(id: 1, title: "여권", day: "2026-09-30", status: .done),
            sample(id: 2, title: "자동차세", day: "2026-09-30", status: .open),
            sample(id: 3, title: "건강검진", day: "2026-09-30", status: .skipped),
        ]
        let list = daySchedules(items: items, dayKey: "2026-09-30")
        t.expectEqual(list.count, 3, "완료·건너뜀도 목록에 남는다")
        t.expectEqual(list.map { $0.id }, [2, 1, 3], "미완이 위, 치운 것은 받은 순서대로 아래")
    }

    // 묶음 안의 순서는 백엔드가 준 그대로여야 한다(마감일 오름차순). `sorted(by:)` 로
    // 바꾸면 Swift 정렬이 안정이 아니라 같은 상태끼리 순서가 흐트러질 수 있다.
    do {
        let items = [
            sample(id: 1, title: "먼저", day: "2026-09-30", status: .open),
            sample(id: 2, title: "나중", day: "2026-09-30", status: .open),
            sample(id: 3, title: "치운 먼저", day: "2026-09-30", status: .done),
            sample(id: 4, title: "치운 나중", day: "2026-09-30", status: .skipped),
        ]
        let list = daySchedules(items: items, dayKey: "2026-09-30")
        t.expectEqual(list.map { $0.id }, [1, 2, 3, 4], "묶음 안에서는 받은 순서를 유지한다")
    }

    // 다른 날 항목이 섞이면 안 된다.
    do {
        let items = [
            sample(id: 1, title: "그날", day: "2026-09-30", status: .open),
            sample(id: 2, title: "딴날", day: "2026-09-12", status: .open),
            sample(id: 3, title: "딴날 완료", day: "2026-09-05", status: .done),
        ]
        let list = daySchedules(items: items, dayKey: "2026-09-30")
        t.expectEqual(list.map { $0.id }, [1], "선택한 날만 담는다")
    }

    // 치운 항목만 있는 날도 목록은 비지 않는다 — 여기가 비면 되돌릴 입구가 사라진다.
    do {
        let items = [sample(id: 1, title: "치움", day: "2026-09-05", status: .done)]
        t.expectEqual(daySchedules(items: items, dayKey: "2026-09-05").count, 1, "치운 날도 목록엔 남아 되돌릴 수 있다")
    }
}
