import Foundation

/// 캘린더 화면이 쓰는 날짜별 목록 계산. **뷰에서 떼어 여기 둔다** — 여기 있는 규칙이
/// "완료를 눌러도 되돌릴 수 있다" 를 실제로 지탱하는 자리라서, 뷰 안에 두면 되돌리기가
/// 사라진 것을 그림을 굽기 전까지 아무도 모른다.

/// 백엔드 `@db.Date` 와 같은 표현(`yyyy-MM-dd`)으로 맞춘 날짜 키.
/// `ScheduleItem.dueDay` 가 ISO 문자열 앞 10자를 떼 온 값이라 그것과 그대로 비교된다.
public func calendarDayKey(year: Int, month: Int, day: Int) -> String {
    String(format: "%04d-%02d-%02d", year, month, day)
}

/// 월 격자의 점을 찍을지. **미완 항목만** 센다 — 완료·건너뜀까지 점을 찍으면 남은 날과
/// 치운 날이 구분되지 않아 격자가 한 달 내내 점으로 덮인다. 점의 뜻은 "여기 아직 할 게 있다" 다.
public func hasOpenSchedule(items: [ScheduleItem], dayKey: String) -> Bool {
    items.contains { $0.dueDay == dayKey && $0.status == .open }
}

/// 선택한 날의 목록. **완료·건너뜀도 남기고** 미완을 위로 올린다.
///
/// 치운 항목을 걷어내면 완료를 누른 순간 그 줄이 화면에서 사라져, 잘못 누른 것을 앱 안에서
/// 되살릴 길이 없어진다. 백엔드가 `DONE → OPEN` 전이를 허용하는 이유(`schedule.type.ts` 의
/// `canTransition`)가 정확히 그 오조작을 영구 기록으로 남기지 않기 위함인데, 화면이 그 길을
/// 막고 있으면 선언과 실제가 어긋난다.
///
/// 정렬은 `sorted(by:)` 를 쓰지 않고 두 묶음을 이어 붙인다 — Swift 의 정렬은 안정(stable)이
/// 보장되지 않아 같은 상태끼리의 순서가 흐트러질 수 있다. 백엔드가 이미 마감일 오름차순으로
/// 내려주므로(`schedule.prisma.repository.ts` 의 `orderBy`) 그 순서를 묶음 안에서 그대로 둔다.
public func daySchedules(items: [ScheduleItem], dayKey: String) -> [ScheduleItem] {
    let onDay = items.filter { $0.dueDay == dayKey }
    return onDay.filter { $0.status == .open } + onDay.filter { $0.status != .open }
}
