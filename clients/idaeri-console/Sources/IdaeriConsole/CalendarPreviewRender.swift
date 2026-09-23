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
/// 캘린더는 창 안에서 끝나는 화면이라 대시보드처럼 콘텐츠 끝에 맞춘 캔버스 계산이 필요
/// 없다. 단 **높이도 조판을 바꾼다** — 넓은 창에서는 칸 높이가 남는 세로를 나눠 갖고(상한
/// 168), 1020pt 미만에서는 상세가 격자 아래로 내려가며 스크롤이 생긴다. 두 조판을 다 보려면
/// `--size` 를 양쪽으로 굽는 수밖에 없다.
private let calendarPreviewSize = CGSize(width: 1000, height: 760)

/// 표본 데이터. 2026-09-30(자동차세)을 포함해 실제 등록 경로(`@이대리 9월 30일 자동차세`)로
/// 들어온 값처럼 보이게 한다. `--empty` 면 이 표본을 아예 싣지 않는다.
///
/// **백엔드가 내려주는 순서 그대로 적는다** — 마감일 오름차순, 같은 날이면 id 오름차순
/// (`schedule.prisma.repository.ts` 의 `orderBy`). 화면의 정렬(미완 위·치운 것 아래)이
/// 실제로 먹는지는 표본이 그 순서를 거슬러야만 그림에 드러나므로, 9월 30일 묶음의 맨 앞을
/// 치운 항목(id 3, 먼저 등록해 이미 처리한 건)으로 둔다. 화면에서는 그것이 아래로 내려가야 맞다.
private let calendarPreviewSchedules: [ScheduleItem] = [
    // 치운 항목이 칸에서 어떻게 보이는지도 같은 렌더에서 드러나야 한다 — 9월 5일 칸의
    // 칩은 취소선·회색이어야 하고, 살구색(남은 일정)으로 보이면 안 된다.
    ScheduleItem(
        id: 1, title: "지난달 정산", dueDate: "2026-09-05T00:00:00.000Z",
        linkUrl: nil, memo: nil, status: .done
    ),
    ScheduleItem(
        id: 2, title: "헬스장 재등록", dueDate: "2026-09-12T00:00:00.000Z",
        linkUrl: nil, memo: nil, status: .open
    ),
    // 공휴일 한 건. **이게 없으면 빨간 날짜·빨간 칩이 그림에 안 나와** 색이 실제로 먹는지
    // 확인할 길이 없다. 2026년 추석은 9월 25일(금)이라 주말과 겹치지 않는 자리에 선다 —
    // 토요일 파랑·일요일 빨강과 따로 읽히는지도 같은 장에서 보인다.
    ScheduleItem(
        id: 6, title: "추석", dueDate: "2026-09-25T00:00:00.000Z",
        linkUrl: nil, memo: nil, status: .open, isHoliday: true
    ),
    // **선택된 날(9월 30일)에 치운 항목을 하나 둔다.** 되돌리기 버튼과 흐림·취소선 조판은
    // 완료 항목이 목록에 실제로 남아야만 그림에 나오고, 안 나오면 "되돌릴 수 있다" 는 주장에
    // 근거가 없다. 미완 두 줄과 나란히 서므로 둘이 한눈에 갈리는지도 같은 장에서 보인다.
    ScheduleItem(
        id: 3, title: "여권 재발급 신청", dueDate: "2026-09-30T00:00:00.000Z",
        linkUrl: nil, memo: "구청 방문 완료", status: .done
    ),
    ScheduleItem(
        id: 4, title: "자동차세 납부", dueDate: "2026-09-30T00:00:00.000Z",
        linkUrl: nil, memo: "9월분, 10월 16일까지 연납 시 할인", status: .open
    ),
    ScheduleItem(
        id: 5, title: "국민연금 신고", dueDate: "2026-09-30T00:00:00.000Z",
        linkUrl: nil, memo: nil, status: .open
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
/// `failure` 는 조회 실패 화면을, `loading` 은 조회 중 화면을 굽는다. 두 화면이 빈 상태와
/// 확실히 갈라지는지는 **그려 봐야만** 알 수 있는데, 굽는 경로는 네트워크 응답을 기다리지 않고
/// 끝나 둘 중 어느 상태에도 자연히 닿지 못한다.
/// `month` 는 굽는 달을 바꾼다. **행 수가 달마다 다른 것이 조판 위험이다** — 5주 달은 창
/// 하한(560)에 들어가지만 6주 달은 같은 창에서 넘친다(78×6 + 간격·머리글·여백 = 616).
/// 표본은 9월 것이라 다른 달은 빈 격자가 되지만, 확인 대상은 행 수가 늘어난 조판 자체다.
func renderCalendarPreview(
    path: String,
    darkMode: Bool,
    empty: Bool,
    failure: Bool = false,
    loading: Bool = false,
    month: Int = 9,
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
            initialYear: 2026, initialMonth: month,
            initialSelectedDay: empty ? nil : 30,
            // 백엔드가 꺼져 있을 때 실제로 나오는 문구 그대로 — `failureReason` 의 비-HTTP 분기.
            initialLoadFailure: failure
                ? "백엔드에 연결하지 못했습니다. 주소(http://127.0.0.1:3002)와 실행 여부를 확인하세요."
                : nil,
            // 오늘 칸 강조를 고정한다. 실행일을 그대로 쓰면 9월을 굽는 그림에서 오늘 표시가
            // 10월부터 사라지고, 그 변화가 회귀인지 날짜 탓인지 그림만 보고는 갈리지 않는다.
            initialToday: "2026-09-22",
            initialLoading: loading
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
