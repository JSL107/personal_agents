import Foundation

@testable import ConsoleCore

/// 등록 폼이 백엔드에 넘기는 값의 검증.
///
/// 이 스위트가 지키는 것은 **고른 날과 저장된 날이 같다** 하나다. 날짜가 하루 밀려도 등록은
/// 성공하고 화면에도 일정이 보이므로, 어긋난 것을 알아채는 유일한 순간은 마감을 놓친 뒤다.
func runScheduleComposeTests(_ t: TestRunner) {
    t.suite("ScheduleCompose")

    // 한국 시간대. UTC 로 찍는 구현이면 여기서 하루가 앞당겨진다 — KST 자정은 UTC 로
    // 전날 15시라, `ISO8601DateFormatter` 계열은 30일을 고른 값에서 29일을 내놓는다.
    var kst = Calendar(identifier: .gregorian)
    kst.timeZone = TimeZone(identifier: "Asia/Seoul") ?? TimeZone(secondsFromGMT: 9 * 3600)!

    let midnight = kst.date(from: DateComponents(year: 2026, month: 9, day: 30))!
    t.expectEqual(
        scheduleDateKey(midnight, calendar: kst),
        "2026-09-30",
        "KST 자정에 고른 날은 그날 그대로 간다"
    )

    // 자정 직후·직전 모두 같은 날이어야 한다. 하루의 양 끝이 다른 날로 새면 새벽이나
    // 늦은 밤에 등록한 것만 조용히 밀린다.
    let lateNight = kst.date(from: DateComponents(
        year: 2026, month: 9, day: 30, hour: 23, minute: 59
    ))!
    t.expectEqual(
        scheduleDateKey(lateNight, calendar: kst),
        "2026-09-30",
        "같은 날 23:59 도 같은 날"
    )

    // 한 자리 월·일에 0 이 붙어야 백엔드 `parseDateParam` 의 되돌려 찍기 대조를 통과한다.
    let singleDigit = kst.date(from: DateComponents(year: 2026, month: 1, day: 5))!
    t.expectEqual(
        scheduleDateKey(singleDigit, calendar: kst),
        "2026-01-05",
        "한 자리 월·일은 0 을 채운다"
    )

    // 서로 반대 방향인 두 함수를 붙여 확인한다 — 날짜 칸 우클릭이 키를 Date 로 되돌려
    // 폼에 채우고, 등록은 그 Date 를 다시 키로 만들어 보낸다. 왕복이 깨지면 우클릭으로
    // 연 폼만 다른 날에 저장된다.
    for key in ["2026-09-30", "2026-01-01", "2026-12-31", "2028-02-29"] {
        guard let restored = scheduleDate(fromKey: key, calendar: kst) else {
            t.expect(false, "\(key) 를 Date 로 되돌리지 못했다")
            continue
        }
        t.expectEqual(scheduleDateKey(restored, calendar: kst), key, "\(key) 왕복")
    }

    // 달력에 없는 날짜는 되돌리지 않는다. `Calendar.date(from:)` 은 2월 30일을 3월 2일로
    // 굴려서라도 값을 만드는데, 그걸 폼에 채우면 사용자가 고르지 않은 날이 미리 들어간다.
    t.expectNil(
        scheduleDate(fromKey: "2026-02-30", calendar: kst),
        "달력에 없는 날짜는 되돌리지 않는다"
    )
    t.expectNil(
        scheduleDate(fromKey: "2026-9-30", calendar: kst),
        "0 을 안 채운 키는 받지 않는다 — 백엔드도 같은 형식만 받는다"
    )
    t.expectNil(
        scheduleDate(fromKey: "오늘", calendar: kst),
        "날짜가 아닌 문자열은 되돌리지 않는다"
    )

    // 등록 버튼을 열지 말아야 하는 제목. 백엔드도 같은 것을 400 으로 끊지만, 화면이 먼저
    // 막아야 "왜 안 되는지" 가 실패 문구가 아니라 버튼 모양으로 보인다.
    t.expect(isSubmittableScheduleTitle("자동차세"), "보통 제목은 등록할 수 있다")
    t.expect(!isSubmittableScheduleTitle(""), "빈 제목은 막는다")
    t.expect(!isSubmittableScheduleTitle("   "), "공백만 친 제목도 막는다")
    t.expect(!isSubmittableScheduleTitle("\n\t"), "줄바꿈·탭만 있는 제목도 막는다")

    // 메모는 비어 있으면 키째로 빠져야 한다 — 빈 문자열을 저장하면 상세 패널이 아무것도
    // 없는 메모 줄을 그린다.
    t.expectNil(trimmedScheduleField("   "), "공백만 남는 메모는 없는 것으로 둔다")
    t.expectEqual(
        trimmedScheduleField("  위택스에서  "),
        "위택스에서",
        "메모는 앞뒤 공백을 떼고 보낸다"
    )

    // 길이 상한. 서버가 400 으로 끊는 것을 화면이 먼저 막아야 한다 — 400 응답 본문은
    // 클라이언트가 버리므로(`ConsoleClient.sendExpectingSuccess`), 서버까지 보내고 나면
    // 무엇이 길어서 막혔는지 알 방법이 없다.
    t.expectEqual(
        scheduleFieldOverflow(String(repeating: "가", count: 200), limit: ScheduleFieldLimit.title),
        0,
        "상한과 같은 길이는 통과한다"
    )
    t.expectEqual(
        scheduleFieldOverflow(String(repeating: "가", count: 203), limit: ScheduleFieldLimit.title),
        3,
        "넘친 만큼을 알려준다 — 얼마나 지워야 하는지가 안내의 전부다"
    )
    t.expectEqual(scheduleFieldOverflow("", limit: ScheduleFieldLimit.memo), 0, "빈 칸은 통과")

    // **이 단언이 이 묶음의 핵심이다.** 서버의 `@MaxLength` 는 JS 문자열 길이(UTF-16)를 보는데
    // Swift 의 `count` 는 사람이 세는 글자 수라, 이모지에서 화면이 서버보다 관대해진다.
    // `count` 로 구현하면 아래가 0 을 내놓고 — 화면은 통과시키는데 서버는 400 을 준다.
    let family = "👨‍👩‍👧"
    t.expect(family.count < family.utf16.count, "이모지는 grapheme 수와 UTF-16 길이가 다르다")
    t.expectEqual(
        scheduleFieldOverflow(family, limit: 1),
        family.utf16.count - 1,
        "서버와 같은 자(UTF-16)로 잰다 — grapheme 으로 재면 화면이 서버보다 관대해진다"
    )

    // 상한 값 자체가 백엔드 DTO 와 짝이다. 한쪽만 바뀌면 이 숫자가 먼저 눈에 띄어야 한다.
    t.expectEqual(ScheduleFieldLimit.title, 200, "제목 상한은 create-schedule.dto.ts 와 같다")
    t.expectEqual(ScheduleFieldLimit.memo, 2_000, "메모 상한은 create-schedule.dto.ts 와 같다")
}
