import Foundation

/// 일정에 달린 링크를 열어도 되는지 판정한다.
///
/// **`URL(string:)` 이 통과시키는 것과 "열어도 되는 것" 은 다르다.** `URL(string:)` 은
/// `file:`·`javascript:`·앱 커스텀 스킴(`myapp://`)을 모두 받아들이고, `Link` 는 그것을
/// `NSWorkspace` 에 넘겨 로컬 파일이나 등록된 앱 핸들러를 실행시킨다 — 링크 한 번에
/// 의도하지 않은 것이 열린다.
///
/// 이 값은 **신뢰 경계 밖에서 온다.** 일정은 Slack 메시지에서 만들어지고, 백엔드는
/// `linkUrl` 을 `string | null` 로 받아 그대로 내려보낸다(`schedule.type.ts`,
/// `schedule.prisma.repository.ts` 에 스킴 검사가 없다) — 즉 **화면이 유일한 방어선이다.**
///
/// 뷰가 아니라 여기 두는 이유는 이것이 조판이 아니라 규칙이기 때문이다. 뷰 안에 두면
/// 허용 스킴이 늘거나 줄어도 테스트가 알지 못한다.
public func safeScheduleLinkURL(_ raw: String?) -> URL? {
    guard let raw, !raw.isEmpty, let url = URL(string: raw) else {
        return nil
    }
    // 여는 것 말고 할 일이 없는 값이라 웹 스킴 둘만 받는다. 목록을 늘릴 일이 생기면
    // 그때 무엇을 왜 더하는지 여기 적는다 — 넓혀 두고 잊는 쪽이 사고가 된다.
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
        return nil
    }
    // 스킴만 맞고 host 가 없는 값(`http:///`, `https:`)은 열어도 아무 데도 닿지 않는다.
    guard let host = url.host, !host.isEmpty else {
        return nil
    }
    return url
}
