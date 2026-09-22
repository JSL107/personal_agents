import AppKit
import ConsoleCore
import SwiftUI

/// 등록 폼(`ScheduleComposeSheet`)만 PNG로 굽는 시각 회귀 입구.
///
/// **캘린더 렌더가 이 화면을 담지 못한다.** 시트는 `.sheet` 가 띄우는 별도 표면이라 부모
/// 뷰의 비트맵에 들어오지 않는다 — 한 번도 그려 보지 않으면 라벨과 입력칸이 어긋나거나
/// 한글 안내 문구가 잘려도 알 수 없고, 그건 사용자가 등록을 눌러 보고서야 드러난다.
///
/// `filled` 는 긴 제목·여러 줄 메모가 든 폼을, `failure` 는 등록이 실패해 폼이 열린 채
/// 사유를 띄운 화면을, `overflow` 는 길이 상한을 넘겨 등록이 막힌 화면을 굽는다. 셋 다 실제
/// 조작 없이는 닿지 못하는 상태다 — 특히 `overflow` 는 200 자를 쳐 넣어야 보인다.
func renderScheduleComposePreview(
    path: String,
    darkMode: Bool,
    filled: Bool,
    failure: Bool,
    overflow: Bool = false
) -> Bool {
    // 표본 날짜는 캘린더 렌더와 같은 2026-09-30 — 두 그림을 나란히 놓고 볼 때 같은 건을
    // 등록하는 장면으로 읽힌다.
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? calendar.timeZone
    let date = scheduleDate(fromKey: "2026-09-30", calendar: calendar) ?? Date()

    let sheet = ScheduleComposeSheet(
        initialDate: date,
        // 입력칸 폭을 넘기는 길이로 둔다. 짧은 제목만 구우면 넘칠 때 어떻게 되는지가
        // 그림에 안 나오고, 그 조판은 코드로 판정되지 않는다.
        initialTitle: overflow
            ? String(repeating: "자동차세 납부 연납 할인 기한 확인 ", count: 12)
            : (filled ? "자동차세 납부 — 연납 할인 기한 확인하고 위택스에서 처리" : ""),
        initialMemo: filled ? "9월분.\n10월 16일까지 연납하면 할인.\n카드 무이자 여부도 같이 확인." : "",
        // 백엔드가 꺼져 있을 때 실제로 나오는 문구 그대로(`CalendarView.failureReason` 의 비-HTTP 분기).
        initialFailure: failure
            ? "등록 실패 — 백엔드에 연결하지 못했습니다. 주소(http://127.0.0.1:3002)와 실행 여부를 확인하세요."
            : nil,
        onSubmit: { _, _, _ in nil }
    )
        .environment(\.colorScheme, darkMode ? .dark : .light)
        .background(Color(nsColor: .windowBackgroundColor))

    let hostingView = NSHostingView(rootView: sheet)
    hostingView.appearance = NSAppearance(named: darkMode ? .darkAqua : .aqua)
    // 시트는 창 크기가 정해져 있지 않고 내용이 자기 크기를 정한다 — 고정 크기를 주면
    // 실제로 뜨는 것과 다른 그림이 나온다.
    hostingView.frame = NSRect(origin: .zero, size: hostingView.fittingSize)
    hostingView.layoutSubtreeIfNeeded()
    guard let bitmap = hostingView.bitmapImageRepForCachingDisplay(in: hostingView.bounds) else {
        return false
    }
    hostingView.cacheDisplay(in: hostingView.bounds, to: bitmap)
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        return false
    }
    do {
        try data.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        FileHandle.standardError.write(Data("등록 폼 렌더 저장 실패: \(error)\n".utf8))
        return false
    }
}
