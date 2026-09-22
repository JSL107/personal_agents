import Foundation

@testable import ConsoleCore

/// 일정 링크 허용 판정의 검증.
///
/// 이 스위트가 지키는 것은 조판이 아니라 **신뢰 경계** 다. 백엔드가 `linkUrl` 을 검사 없이
/// 내려보내므로(`schedule.type.ts` 의 `string | null`) 여기가 통과시킨 것은 그대로 열린다.
func runScheduleLinkTests(_ t: TestRunner) {
    t.suite("ScheduleLink")

    // 웹 링크는 통과한다 — 막는 것이 목적이 아니라 **웹만** 여는 것이 목적이다.
    do {
        t.expectEqual(safeScheduleLinkURL("https://example.com/tax")?.absoluteString, "https://example.com/tax", "https 는 열린다")
        t.expectEqual(safeScheduleLinkURL("http://example.com")?.absoluteString, "http://example.com", "http 도 열린다")
        t.expectEqual(safeScheduleLinkURL("HTTPS://EXAMPLE.COM")?.host, "EXAMPLE.COM", "스킴 대소문자는 가리지 않는다")
    }

    // 여기가 뚫리면 링크 한 번에 로컬 파일·앱 핸들러가 실행된다. `URL(string:)` 은
    // 아래 전부를 유효한 URL 로 받아들이므로 그 통과만 믿을 수 없다.
    do {
        t.expectEqual(safeScheduleLinkURL("file:///etc/passwd") == nil, true, "file 은 막는다")
        t.expectEqual(safeScheduleLinkURL("javascript:alert(1)") == nil, true, "javascript 는 막는다")
        t.expectEqual(safeScheduleLinkURL("myapp://do-something") == nil, true, "커스텀 앱 스킴은 막는다")
        t.expectEqual(safeScheduleLinkURL("ftp://example.com") == nil, true, "웹이 아닌 스킴은 막는다")
    }

    // 스킴만 맞고 닿을 곳이 없는 값. 열어도 빈 창이 뜨거나 아무 일도 안 나므로 버튼을 두지 않는다.
    do {
        t.expectEqual(safeScheduleLinkURL("https:") == nil, true, "host 없는 값은 막는다")
        t.expectEqual(safeScheduleLinkURL("/tax/2026") == nil, true, "스킴 없는 경로는 막는다")
        t.expectEqual(safeScheduleLinkURL("") == nil, true, "빈 문자열은 막는다")
        t.expectEqual(safeScheduleLinkURL(nil) == nil, true, "nil 은 막는다")
    }
}
