import Foundation

/// 등록 폼이 백엔드에 보내는 날짜 키(`yyyy-MM-dd`).
///
/// **`ISO8601DateFormatter` 나 `.formatted(.iso8601)` 을 쓰면 안 된다.** 그것들은 UTC 로 찍는데
/// `DatePicker` 가 주는 값은 사용자가 고른 날의 **로컬 자정**이라, 한국(UTC+9)에서는 9시간을
/// 빼면서 하루가 앞당겨진다 — 30일을 골랐는데 29일에 저장된다. 사용자가 본 달력과 같은
/// 캘린더로 되읽어야 같은 날이 나온다.
///
/// `DateFormatter` 대신 컴포넌트를 직접 찍는 것은 달력 종류·로케일 때문이다. 기기가 불교력·
/// 일본력을 쓰면 `yyyy` 가 2569 같은 연도를 내놓는다(`dateFormat` 은 캘린더를 따라간다).
public func scheduleDateKey(_ date: Date, calendar: Calendar = .current) -> String {
    let gregorian = normalizedCalendar(calendar)
    let parts = gregorian.dateComponents([.year, .month, .day], from: date)
    return String(
        format: "%04d-%02d-%02d",
        parts.year ?? 0,
        parts.month ?? 0,
        parts.day ?? 0
    )
}

/// `yyyy-MM-dd` 를 `DatePicker` 가 쓰는 Date 로 되돌린다. 날짜 칸에서 폼을 열면 그 날이
/// 미리 채워져야 하는데, 격자가 들고 있는 것은 키 문자열뿐이다.
///
/// 달력에 없는 날짜(`2026-02-30`)는 nil 을 준다 — 채우지 못한 것이지 오늘로 눌러앉을 일이
/// 아니다. 호출부가 오늘로 되돌릴지 정한다.
public func scheduleDate(fromKey key: String, calendar: Calendar = .current) -> Date? {
    let parts = key.split(separator: "-")
    guard parts.count == 3,
          let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
          parts[0].count == 4, parts[1].count == 2, parts[2].count == 2
    else {
        return nil
    }
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    let gregorian = normalizedCalendar(calendar)
    guard let date = gregorian.date(from: components) else {
        return nil
    }
    // `date(from:)` 은 2월 30일을 3월 2일로 굴려서라도 값을 만든다. 되돌려 찍어 원문과
    // 다르면 달력에 없던 날짜다(백엔드 `parseDateParam` 이 같은 방식으로 거른다).
    guard scheduleDateKey(date, calendar: gregorian) == key else {
        return nil
    }
    return date
}

/// 등록 버튼을 열어도 되는지. 공백만 친 제목은 백엔드가 400 으로 끊으므로 화면에서 먼저
/// 막는다 — 누를 수 있는 버튼이 매번 실패로만 끝나면 무엇이 잘못됐는지 알 수 없다.
public func isSubmittableScheduleTitle(_ title: String) -> Bool {
    return !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

/// 서버로 보내기 전에 다듬는다. 백엔드도 같은 `trim` 을 하지만(신뢰 경계라 거기서도 해야
/// 한다), 여기서 다듬어야 화면의 검사와 실제로 보내는 값이 같아진다.
public func trimmedScheduleField(_ raw: String) -> String? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

/// 날짜 산술만 그레고리력으로 고정한다. 시간대는 기기 것을 그대로 쓴다 — 사용자가 보는
/// 달력의 "오늘" 이 기기 시간대를 따르기 때문이다.
private func normalizedCalendar(_ calendar: Calendar) -> Calendar {
    if calendar.identifier == .gregorian {
        return calendar
    }
    var gregorian = Calendar(identifier: .gregorian)
    gregorian.timeZone = calendar.timeZone
    gregorian.locale = calendar.locale
    return gregorian
}

/// 제목·메모 길이 상한. 백엔드 `src/schedule/interface/dto/create-schedule.dto.ts` 의
/// `@MaxLength` 와 **같은 값**이다 — 언어가 달라 상수를 나눠 가질 수 없으므로 양쪽 주석이
/// 서로를 가리킨다. 한쪽만 늘리면 화면이 통과시킨 입력이 서버에서 400 이 되고, 그 400 은
/// 무엇이 길어서 막혔는지 말해 주지 않는다(응답 본문을 클라이언트가 버린다).
public enum ScheduleFieldLimit {
    public static let title = 200
    public static let memo = 2_000
}

/// 상한을 넘은 글자 수(넘지 않으면 0).
///
/// **`count` 가 아니라 `utf16.count` 로 센다.** 서버의 `@MaxLength` 는 JS 문자열 길이, 즉
/// UTF-16 코드 유닛 수를 본다. Swift 의 `count` 는 사람이 세는 글자 수(grapheme)라 이모지
/// 하나가 여기서는 1, 서버에서는 여럿으로 잡힌다 — 그 차이만큼 화면이 서버보다 관대해지고,
/// 막으려던 400 이 그대로 난다. 화면이 서버와 같은 자로 재야 한다.
///
/// **넘쳐도 자르지 않는다.** 붙여넣은 글이 조용히 잘리면 사용자는 무엇이 사라졌는지 모른 채
/// 등록하고, 그 일정은 내용이 빠진 채 남는다. 얼마나 줄여야 하는지 알려주고 사용자가 지운다.
public func scheduleFieldOverflow(_ text: String, limit: Int) -> Int {
    return max(0, text.utf16.count - limit)
}
