import AppKit
import ConsoleCore
import SwiftUI

/// 백엔드 없이 캘린더 탭을 PNG로 굽는 시각 회귀 입구. `DashboardPreviewRender.swift` 와
/// 같은 목적 — 실제 `CalendarView` 를 써서 격자 조판·선택 상태·빈 상태를 눈으로 확인한다.
///
/// **탭 막대(`ConsoleHeaderView`)까지 함께 굽는다.** 이번 변경의 요구는 "캘린더를 첫 화면으로"
/// 인데, 캘린더 본문만 담으면 정작 그 요구가 지켜졌는지(캘린더 탭이 맨 앞이고 선택돼 있는지)가
/// 그림에 안 나온다 — 확인할 수 없는 요구는 확인되지 않은 것이다. 실제 앱과 같은 뷰를 쓰므로
/// 머리글 조판이 갈릴 일도 없다.
///
/// 캘린더는 스크롤이 없는 고정 높이 화면이라 대시보드처럼 콘텐츠 끝에 맞춘 캔버스 계산이
/// 필요 없다 — 창 폭 하나만 고정하면 된다.
private let calendarPreviewSize = CGSize(width: 1000, height: 760)

/// 표본 데이터. 2026-09-30(자동차세)을 포함해 실제 등록 경로(`@이대리 9월 30일 자동차세`)로
/// 들어온 값처럼 보이게 한다. `--empty` 면 이 표본을 아예 싣지 않는다.
private let calendarPreviewSchedules: [ScheduleItem] = [
    ScheduleItem(
        id: 1, title: "자동차세 납부", dueDate: "2026-09-30T00:00:00.000Z",
        linkUrl: nil, memo: "9월분, 10월 16일까지 연납 시 할인", status: .open
    ),
    ScheduleItem(
        id: 2, title: "국민연금 신고", dueDate: "2026-09-30T00:00:00.000Z",
        linkUrl: nil, memo: nil, status: .open
    ),
    ScheduleItem(
        id: 3, title: "헬스장 재등록", dueDate: "2026-09-12T00:00:00.000Z",
        linkUrl: nil, memo: nil, status: .open
    ),
    // 완료 상태는 화면에서 걷어내는 필터(`CalendarView.openSchedules`)가 실제로 먹는지도
    // 같은 렌더에서 드러나야 한다 — 9월 5일엔 점이 찍히지 않아야 맞다.
    ScheduleItem(
        id: 4, title: "지난달 정산", dueDate: "2026-09-05T00:00:00.000Z",
        linkUrl: nil, memo: nil, status: .done
    ),
]

/// `empty` 가 true 면 표본을 싣지 않는다 — 캘린더 탭의 초기 기본값이 빈 상태이고
/// 그것이 첫인상이므로, 항목 있는 화면보다 이쪽이 맞는지가 더 중요하다.
///
/// `size` 를 생략하면 위 고정값을 쓴다. 폭을 넘길 수 있어야 하는 이유는 머리글이다 — 탭 막대가
/// 내용 크기로 자리를 잡으므로(`ConsoleHeaderView` 의 `fixedSize`), 좁은 창에서 머리글이 넘치는지는
/// **그 폭으로 굽지 않으면 확인할 방법이 없다**(코드로는 판정되지 않는다).
/// 대시보드 렌더(`--render-dashboard --size`)가 같은 이유로 먼저 열어 둔 입구다.
///
/// `failure` 는 조회 실패 화면을 굽는다. 이 화면이 빈 상태와 확실히 갈라지는지는 **그려 봐야만**
/// 알 수 있는데, 굽는 경로는 네트워크 응답을 기다리지 않고 끝나 실패 상태에 자연히 닿지 못한다.
func renderCalendarPreview(
    path: String,
    darkMode: Bool,
    empty: Bool,
    failure: Bool = false,
    size: CGSize? = nil
) -> Bool {
    let calendarPreviewSize = size ?? calendarPreviewSize
    let store = ConsoleStore()
    if !empty {
        store.apply(schedules: calendarPreviewSchedules)
    }

    let client = ConsoleClient(baseURL: URL(string: "http://127.0.0.1:0")!, token: nil)
    // 실제 앱(`AppRootView`)과 같은 구성 — 머리글 + 고른 탭의 화면. 탭은 앱을 처음 열었을 때의
    // 기본값(`.calendar`)으로 고정하고, 연결 상태는 정상(`.live`)으로 둔다.
    let screen = VStack(spacing: 0) {
        ConsoleHeaderView(tab: .constant(.calendar), status: .live)
        // 항목 있는 렌더는 9월 30일이 이미 선택된 채로 구워, 점만이 아니라 상세 목록·완료/건너뜀
        // 버튼 조판까지 한 장에서 확인한다.
        CalendarView(
            store: store, client: client, baseURLLabel: "http://127.0.0.1:3002",
            initialYear: 2026, initialMonth: 9,
            initialSelectedDay: empty ? nil : 30,
            // 백엔드가 꺼져 있을 때 실제로 나오는 문구 그대로 — `failureReason` 의 비-HTTP 분기.
            initialLoadFailure: failure
                ? "백엔드에 연결하지 못했습니다. 주소(http://127.0.0.1:3002)와 실행 여부를 확인하세요."
                : nil
        )
    }
        .environment(\.colorScheme, darkMode ? .dark : .light)
        .frame(width: calendarPreviewSize.width, height: calendarPreviewSize.height, alignment: .top)
        .background(Color(nsColor: .windowBackgroundColor))

    let hostingView = NSHostingView(rootView: screen)
    hostingView.appearance = NSAppearance(named: darkMode ? .darkAqua : .aqua)
    hostingView.frame = NSRect(origin: .zero, size: calendarPreviewSize)
    hostingView.layoutSubtreeIfNeeded()
    guard
        let bitmap = hostingView.bitmapImageRepForCachingDisplay(in: hostingView.bounds)
    else {
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
        FileHandle.standardError.write(Data("캘린더 렌더 저장 실패: \(error)\n".utf8))
        return false
    }
}
