import ConsoleCore
import SwiftUI

/// 캘린더 탭 루트 — 「마감·신청·예약」 일정을 월 격자로 보여준다.
///
/// **등록 입구는 여기가 아니다.** Slack `@이대리 9월 30일 자동차세` 가 유일한 입구이고,
/// 이 화면은 조회 + 상태 변경(완료·건너뜀·되돌리기)만 한다(등록 폼을 두지 않는다 — 백엔드
/// 컨트롤러에도 POST 가 없다, `ScheduleConsoleController` 주석 참조).
struct CalendarView: View {
    @ObservedObject var store: ConsoleStore
    let client: ConsoleClient
    /// 연결 실패 안내에 띄울 백엔드 주소. 어디에 못 붙었는지가 없으면 "실행했는지 확인하라"는
    /// 말이 어느 주소를 두고 하는 말인지 알 수 없다(`AppRootView.approvalFailureReason` 과 같다).
    let baseURLLabel: String

    @State private var year: Int
    @State private var month: Int
    @State private var selectedDay: Int?
    /// 조회 실패 사유. **빈 상태와 반드시 갈라야 한다** — 에러를 버리면 백엔드가 꺼져 있을 때도
    /// "등록된 일정이 없습니다 / 슬랙에서 이렇게 등록하세요" 가 뜨고, 사용자는 연결이 끊긴 줄
    /// 모른 채 슬랙에 다시 등록하러 간다. 하필 이 화면이 앱의 첫 화면이다.
    @State private var loadFailure: String?
    /// 완료·건너뜀 실패 사유. 성공하면 비운다 — 남겨 두면 다음 조작까지 실패한 것처럼 읽힌다.
    @State private var updateFailure: String?

    /// 오늘 날짜 키(`yyyy-MM-dd`). **`let` 이면 안 된다** — 이 앱은 켜 둔 채로 쓰는 상주형이라
    /// 자정을 넘기면 생성 시점 문자열이 어제로 굳고, 오늘 강조가 어제 칸에 남고 "오늘" 버튼도
    /// 어제를 고른다. 자정 알림(`NSCalendarDayChanged`)으로 갱신하고, 알림을 놓친 회차까지
    /// 덮기 위해 `goToToday()` 가 누를 때 다시 계산한다.
    @State private var today: String
    /// 주입된 오늘(회귀 렌더 전용). 오늘 칸 강조는 시각 회귀 렌더가 확인해야 할 조판인데,
    /// 실행일에 따라 그림이 달라지면 어제 구운 PNG 와 오늘 구운 PNG 가 이유 없이 갈려
    /// 회귀인지 날짜 탓인지 구분되지 않는다. **주입했으면 자정 알림도 이 값을 유지한다.**
    private let pinnedToday: String?
    /// 조회가 도는 중인지. **없으면 화면이 "0건" 과 "아직 모른다" 를 같은 모습으로 말한다** —
    /// 최초 조회 중에 머리글은 "남은 일정 없음", 상세는 "등록된 일정이 없습니다 / 슬랙에서
    /// 이렇게 등록하세요" 를 띄운다. 백엔드가 느리거나 응답이 늦을수록 오래 보이고, 사용자는
    /// 있지도 않은 등록을 하러 슬랙으로 간다(조회 실패를 빈 상태와 가르는 것과 같은 이유다).
    @State private var isLoading: Bool

    /// `initial...` 매개변수는 전부 화면 회귀 렌더 전용이다 — 실제 화면 호출부(`AppRootView`)는
    /// 항상 기본값(오늘·실패 없음)을 쓴다. 렌더는 특정 날짜가 이미 선택된 채로 구워야 상세
    /// 목록·완료/건너뜀 버튼까지 한 장에 담기고(점만으로는 그 조판을 볼 수 없다), 조회 실패
    /// 화면은 **백엔드를 실제로 죽이지 않는 한 렌더로 닿을 수가 없다** — 굽는 경로가 네트워크
    /// 응답을 기다리지 않고 끝나기 때문이다. 한 번도 그려 본 적 없는 화면은 깨진 채로 남는다.
    init(
        store: ConsoleStore,
        client: ConsoleClient,
        baseURLLabel: String,
        initialYear: Int? = nil,
        initialMonth: Int? = nil,
        initialSelectedDay: Int? = nil,
        initialLoadFailure: String? = nil,
        initialToday: String? = nil,
        initialLoading: Bool = false
    ) {
        self.store = store
        self.client = client
        self.baseURLLabel = baseURLLabel
        let now = Calendar(identifier: .gregorian)
        _year = State(initialValue: initialYear ?? now.component(.year, from: Date()))
        _month = State(initialValue: initialMonth ?? now.component(.month, from: Date()))
        _selectedDay = State(initialValue: initialSelectedDay)
        _loadFailure = State(initialValue: initialLoadFailure)
        _isLoading = State(initialValue: initialLoading)
        pinnedToday = initialToday
        _today = State(initialValue: initialToday ?? Self.localTodayKey())
    }

    /// 오늘은 **로컬 달력** 기준으로 잡는다. 격자 자체는 UTC 로 계산하지만(`monthGridDays`),
    /// 그건 요일 배치가 타임존에 따라 흔들리지 않게 하려는 것이고, "오늘이 며칠이냐" 는
    /// 화면 앞에 앉은 사람의 날짜여야 한다. 마감일(`dueDay`)도 타임존 없는 순수 날짜라
    /// 문자열끼리 그대로 비교된다.
    private static func localTodayKey() -> String {
        let calendar = Calendar.current
        let now = Date()
        return calendarDayKey(
            year: calendar.component(.year, from: now),
            month: calendar.component(.month, from: now),
            day: calendar.component(.day, from: now)
        )
    }

    /// 지금 기준의 오늘. 렌더가 날짜를 박아 넣었으면 그 값을 지킨다 — 안 그러면 회귀 렌더가
    /// 자정 알림 한 번에 다른 그림을 낸다.
    private func resolvedToday() -> String {
        pinnedToday ?? Self.localTodayKey()
    }

    private static let weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"]
    private static let weekdayNames = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]

    // MARK: - 조판 상수

    /// 상세를 오른쪽에 세울지 가를 폭. **이 아래로는 두 단이 성립하지 않는다** — 격자 일곱 칸이
    /// 칩(일정 제목)을 담으려면 칸당 86pt 는 있어야 하고(86×7=602), 상세 패널 340 과 바깥
    /// 여백·사이 간격을 더하면 1014 가 된다. 창 최소폭은 720 이라 좁은 쪽은 반드시 생긴다.
    private static let sidePanelBreakpoint: CGFloat = 1020
    private static let sidePanelWidth: CGFloat = 340
    /// 한 칸의 최소 높이. **칩 두 줄이 들어가는 자리까지 잡는다** — 숫자 21 + 칩 17×2 +
    /// "+N" 13 + 위아래 여백 10 = 78. 68 로 두면 좁은 창에서 칩이 한 줄로 접혀, 일정이
    /// 두 건인 날이 전부 "일정 하나 + 1" 로 보인다(실측 렌더).
    private static let minCellHeight: CGFloat = 78
    /// 한 칸의 최대 높이. **상한이 없으면 칸이 화면 세로를 나눠 가지며 끝없이 커진다** —
    /// 1900×1100 창에서 칸이 220×192 까지 벌어져, 일정 두 줄을 담은 칸조차 대부분이 빈 면이
    /// 되고 달력이 아니라 큰 격자로 읽혔다(실측 렌더). 남는 세로는 아래에 여백으로 두는 쪽이
    /// 낫다 — 달력은 원래 빈 칸이 많은 화면이고, 칸을 키워 채워지는 것도 아니다.
    private static let maxCellHeight: CGFloat = 168
    /// 격자 위쪽이 가져가는 세로(머리글 + 요일 줄 + 바깥 여백). 격자가 남는 세로를 채우게
    /// 하려면 얼마를 빼야 하는지 알아야 하는데, **넉넉히(과대) 잡는 쪽이 안전하다** —
    /// 모자라게 잡으면 격자가 화면 밖으로 밀려 마지막 주가 잘린다.
    private static let gridChromeHeight: CGFloat = 160
    /// 칩 한 줄이 차지하는 세로(글자 + 위아래 여백 + 줄 간격). 칸 높이에서 몇 줄이 들어가는지
    /// 거꾸로 셀 때 쓴다 — 칩 수를 2개로 박아 두면 칸이 커져도 "+3" 만 늘어, 넓은 창에서
    /// 빈 면을 남기면서 정작 일정은 접혀 있는 상태가 된다.
    private static let chipRowHeight: CGFloat = 17
    /// 날짜 숫자 줄 + "+N" 줄이 가져가는 세로. 칩 자리를 셀 때 먼저 빼 둔다.
    private static let cellChromeHeight: CGFloat = 40

    /// 살구색 버튼 위의 글자색. 살구는 밝은 색이라 시스템 기본 흰 글자로는 대비가 모자란다 —
    /// `AgentCardView` 의 주 행동 버튼이 쓰는 값(`ConsoleCore`)을 그대로 쓴다.
    private var primaryActionForeground: Color {
        Color(
            red: agentPrimaryActionTextRGBA.red,
            green: agentPrimaryActionTextRGBA.green,
            blue: agentPrimaryActionTextRGBA.blue
        )
    }

    private var gridDays: [Int?] {
        monthGridDays(year: year, month: month)
    }

    /// 주 단위로 자른 격자. 행마다 높이를 나눠 주려면 평평한 배열이 아니라 주 묶음이어야 한다
    /// (`LazyVGrid` 는 행에 높이를 걸 자리가 없다 — 그래서 칸이 40pt 로 눌린 채 가로로만
    /// 늘어났다). `monthGridDays` 가 7의 배수를 보장하므로 나머지 처리가 필요 없다.
    private var gridWeeks: [[Int?]] {
        let days = gridDays
        return stride(from: 0, to: days.count, by: 7).map { Array(days[$0 ..< $0 + 7]) }
    }

    // 날짜별 목록·점 계산은 `ConsoleCore` 의 순수 함수에 있다(`CalendarDayList.swift`).
    // 뷰 안에 두면 "완료해도 되돌릴 수 있다" 를 지탱하는 규칙이 테스트 밖에 남는다 —
    // 실제로 그 규칙이 없어진 것을 화면을 굽기 전까지 아무도 몰랐다.
    // 백엔드 `findByDateRange` 는 상태로 거르지 않고 기간 안 전 항목을 그대로 내려주므로
    // (`schedule.prisma.repository.ts`) 상태를 나누는 몫은 화면이 진다.

    private func dayKey(_ day: Int) -> String {
        calendarDayKey(year: year, month: month, day: day)
    }

    /// 화면이 그리는 일정. **조회에 실패했으면 비운다.** 실패해도 `store.schedules` 에는
    /// 직전 달 항목이 남는데 화면의 달은 이미 바뀌어 있어(`shiftMonth` 가 먼저 바꾼다),
    /// 그대로 그리면 격자가 "이 달 이 날에 이 일정이 있다" 는 거짓을 말한다 — 상세 목록이
    /// 같은 이유로 실패를 먼저 가르는데(`detailBody`) 격자만 낡은 데이터를 계속 들고 있었다.
    /// 점 하나였을 때는 덜 보였고, 칩에 제목이 실리면서 드러났다(실측 렌더).
    private var visibleSchedules: [ScheduleItem] {
        loadFailure == nil ? store.schedules : []
    }

    private func itemsOn(day: Int) -> [ScheduleItem] {
        daySchedules(items: visibleSchedules, dayKey: dayKey(day))
    }

    /// 이 달에 아직 남은 건수. 머리글의 한 줄 요약이 쓴다 — 달을 넘길 때마다 격자를 눈으로
    /// 훑지 않고도 "이 달은 할 게 있나" 를 알 수 있어야 한다.
    private var openCount: Int {
        visibleSchedules.filter { $0.status == .open }.count
    }

    var body: some View {
        // 폭·높이를 **부모에게서 한 번에** 받는다. 안쪽에서 `.background(GeometryReader)` +
        // `onPreferenceChange` 로 재면 "실측 → State → 재렌더" 두 패스가 필요한데, 시각 회귀
        // 렌더는 `layoutSubtreeIfNeeded()` 한 번만 부르고 캡처해 두 번째 패스 전에 굳는다
        // (`DashboardView.gridColumns` 주석에 같은 사고가 실측으로 적혀 있다).
        GeometryReader { proxy in
            let isWide = proxy.size.width >= Self.sidePanelBreakpoint
            Group {
                if isWide {
                    HStack(alignment: .top, spacing: Spacing.xl) {
                        calendarColumn(availableHeight: proxy.size.height)
                        detailPanel
                            .frame(width: Self.sidePanelWidth)
                    }
                } else {
                    // 좁은 창에서는 격자와 상세가 세로로 쌓여 창 높이(최소 560)를 넘는다.
                    // 넘치는 것을 자르는 대신 스크롤로 넘긴다 — 잘리면 마지막 주와 상세가
                    // 통째로 사라지는데, 그게 화면 밖에 있다는 사실조차 보이지 않는다.
                    ScrollView {
                        VStack(alignment: .leading, spacing: Spacing.lg) {
                            calendarColumn(availableHeight: nil)
                            detailPanel
                        }
                    }
                }
            }
            .padding(Spacing.xl)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(minHeight: Layout.contentMinHeight, alignment: .top)
        .background(CozyPalette.canvas)
        .task { await reload() }
        // 자정을 넘기면 오늘이 바뀐다. 타이머로 재는 대신 시스템이 알려 주는 것을 받는다 —
        // 타이머는 절전·시간대 변경·시각 수동 조정에서 어긋난다.
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
            today = resolvedToday()
        }
    }

    /// 머리글 + 요일 줄 + 월 격자. `availableHeight` 가 있으면 격자가 남는 세로를 채운다
    /// (넓은 창에서 달력 아래가 절반씩 비던 자리다). nil 이면 칸 높이를 하한으로 고정한다.
    private func calendarColumn(availableHeight: CGFloat?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            header
            VStack(spacing: Spacing.xs) {
                weekdayHeader
                grid(rowHeight: rowHeight(availableHeight: availableHeight))
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func rowHeight(availableHeight: CGFloat?) -> CGFloat {
        guard let availableHeight else {
            return Self.minCellHeight
        }
        let rows = max(gridWeeks.count, 1)
        let usable = availableHeight - Self.gridChromeHeight
        return min(Self.maxCellHeight, max(Self.minCellHeight, usable / CGFloat(rows)))
    }

    /// 칸 높이가 허락하는 칩 수. 최소 하나는 보여준다 — 하나도 못 세우면 그 칸은 일정이
    /// 있는지조차 알 수 없어, 점 하나만 찍던 이전 화면보다도 못해진다.
    private func chipCount(rowHeight: CGFloat) -> Int {
        max(1, Int((rowHeight - Self.cellChromeHeight) / Self.chipRowHeight))
    }

    // MARK: - 머리글

    private var header: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            // 연도는 작게, 달을 크게. 달력에서 매번 읽는 값은 달이고 연도는 확인용이다 —
            // 둘을 같은 크기로 쓰면 "2026년 9월" 일곱 글자가 한 덩어리가 되어 달이 안 띈다.
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text(String(year))
                    .font(Typography.captionEmphasis)
                    .foregroundStyle(.secondary)
                Text("\(month)월")
                    .font(Typography.screenTitle)
                    .foregroundStyle(CozyPalette.ink)
            }
            monthSummary
            Spacer()
            monthStepper
        }
    }

    /// 이 달의 한 줄 요약. 건수가 0 이어도 "남은 일정 없음" 을 적는다 — 빈칸으로 두면 아직
    /// 안 불러온 것인지 정말 없는 것인지 갈리지 않는다.
    private var monthSummary: some View {
        HStack(spacing: Spacing.xs) {
            Circle()
                .fill(openCount > 0 ? CozyPalette.apricot : CozyPalette.outline.opacity(0.35))
                .frame(width: Stroke.dot - 2, height: Stroke.dot - 2)
            // 조회에 실패한 회차에 "남은 일정 없음" 을 적으면 0건이라는 거짓이 된다 —
            // 격자를 비운 것과 같은 이유로, 못 불러왔다는 사실을 그대로 적는다.
            Text(summaryLabel)
                .font(Typography.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.xs)
        .background(CozyPalette.surface, in: Capsule())
    }

    private var summaryLabel: String {
        if loadFailure != nil {
            return "불러오지 못함"
        }
        // **조회가 끝나기 전에는 건수를 말하지 않는다.** `shiftMonth` 는 달을 먼저 바꾸고
        // 조회를 비동기로 띄우므로, 그 사이 `store` 에는 직전 달 항목이 남아 새 달 머리글에
        // 이전 달 건수가 찍힌다. 최초 조회 중에는 0건이라 "남은 일정 없음" 이 되는데, 그건
        // 아직 모르는 것을 확정해 말하는 것이다.
        if isLoading {
            return "불러오는 중"
        }
        return openCount > 0 ? "남은 일정 \(openCount)건" : "남은 일정 없음"
    }

    private var monthStepper: some View {
        HStack(spacing: Spacing.xs) {
            stepperButton(systemImage: "chevron.left", accessibilityLabel: "이전 달") {
                shiftMonth(-1)
            }
            // 달을 넘기다 보면 오늘이 어느 달이었는지 잃는다. 돌아오는 길을 한 번에 둔다.
            Button("오늘") { goToToday() }
                .buttonStyle(.plain)
                .font(Typography.captionEmphasis)
                .foregroundStyle(CozyPalette.ink)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.xs + 1)
                .background(CozyPalette.surface, in: Capsule())
            stepperButton(systemImage: "chevron.right", accessibilityLabel: "다음 달") {
                shiftMonth(1)
            }
        }
    }

    /// 달 이동 버튼. 맨 글자(`chevron`)만 두면 글자와 구분이 안 가 누를 곳으로 보이지 않는다 —
    /// 바탕을 깔아 조작 요소임을 드러낸다(머리글의 "오늘" 과 같은 처리).
    private func stepperButton(
        systemImage: String,
        accessibilityLabel: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(Typography.captionEmphasis)
                .foregroundStyle(CozyPalette.ink)
                .frame(width: 28, height: 24)
                .background(CozyPalette.surface, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private var weekdayHeader: some View {
        HStack(spacing: Spacing.xs) {
            ForEach(Array(Self.weekdayLabels.enumerated()), id: \.offset) { index, label in
                Text(label)
                    .font(Typography.captionEmphasis)
                    // 주말은 한 단 낮춰 평일과 가른다. 색(빨강·파랑)으로 가르지 않는 건
                    // 이 앱의 빨강이 이미 "실패" 신호라서다(`agentStatePaletteRGBA(.failed)`) —
                    // 같은 색이 두 뜻을 가지면 어느 쪽이 위급한지 읽는 쪽이 판단해야 한다.
                    .foregroundStyle(index >= 5 ? Color.secondary.opacity(0.7) : Color.secondary)
                    // 칸 안 날짜 숫자가 왼쪽 위에 서므로 요일도 같은 축에 세운다. 가운데
                    // 정렬로 두면 요일과 그 아래 숫자가 칸마다 어긋나 두 줄이 따로 읽힌다.
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, Spacing.sm)
            }
        }
    }

    // MARK: - 월 격자

    private func grid(rowHeight: CGFloat) -> some View {
        VStack(spacing: Spacing.xs) {
            ForEach(Array(gridWeeks.enumerated()), id: \.offset) { _, week in
                HStack(spacing: Spacing.xs) {
                    ForEach(Array(week.enumerated()), id: \.offset) { index, day in
                        if let day {
                            dayCell(day, isWeekend: index >= 5, chipLimit: chipCount(rowHeight: rowHeight))
                        } else {
                            // 앞뒤 달 자리. 바탕을 깔지 않아 이 달이 어디서 시작하고
                            // 끝나는지가 면으로 보인다.
                            Color.clear.frame(maxWidth: .infinity)
                        }
                    }
                }
                .frame(height: rowHeight)
            }
        }
    }

    private func dayCell(_ day: Int, isWeekend: Bool, chipLimit: Int) -> some View {
        let key = dayKey(day)
        let items = daySchedules(items: visibleSchedules, dayKey: key)
        let isSelected = selectedDay == day
        let isToday = key == today
        return Button {
            selectedDay = day
        } label: {
            VStack(alignment: .leading, spacing: Spacing.tight) {
                dayNumber(day, isToday: isToday, isWeekend: isWeekend)
                // 점 하나로는 "뭔가 있다" 까지만 전해진다. 제목을 칸 안에 세우면 달력을
                // 훑는 것만으로 이 달에 무엇이 걸려 있는지 읽힌다 — 상세를 열어야만
                // 알 수 있던 것을 격자로 끌어올린 자리다.
                ForEach(items.prefix(chipLimit)) { item in
                    scheduleChip(item)
                }
                if items.count > chipLimit {
                    Text("+\(items.count - chipLimit)")
                        .font(Typography.captionSmall)
                        .foregroundStyle(.secondary)
                        .padding(.leading, Spacing.xs)
                }
                Spacer(minLength: 0)
            }
            .padding(Spacing.xs + 1)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(
                isSelected ? CozyPalette.apricot.opacity(0.12) : CozyPalette.surface,
                in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                    .strokeBorder(
                        isSelected ? CozyPalette.apricot : CozyPalette.outline.opacity(0.10),
                        lineWidth: isSelected ? Stroke.emphasis : 1
                    )
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(month)월 \(day)일, 일정 \(items.count)건")
    }

    /// 날짜 숫자. 오늘만 살구색 알약 안에 넣는다 — **선택 표시와 겹쳐도 갈려야** 하므로
    /// 선택은 칸 전체(바탕+테두리), 오늘은 숫자 하나로 신호를 나눠 가진다. 둘을 같은 방식으로
    /// 칠하면 오늘을 고른 순간 "오늘이라서 칠해진 것" 과 "내가 골라서 칠해진 것" 이 섞인다.
    private func dayNumber(_ day: Int, isToday: Bool, isWeekend: Bool) -> some View {
        Text("\(day)")
            .font(isToday ? Typography.bodyEmphasis : Typography.body)
            .foregroundStyle(
                isToday
                    ? primaryActionForeground
                    : (isWeekend ? Color.secondary : CozyPalette.ink)
            )
            .frame(width: 24, height: 21)
            .background(isToday ? CozyPalette.apricot : Color.clear, in: Capsule())
    }

    /// 칸 안의 일정 칩. 치운 항목도 싣고(상세 목록과 같은 규칙) 취소선·흐림으로 가른다 —
    /// 미완만 실으면 완료를 누르는 순간 그 일정이 달력에서 통째로 사라져, 무엇을 처리했는지
    /// 달력만 보고는 되짚을 수 없다.
    private func scheduleChip(_ item: ScheduleItem) -> some View {
        let isClosed = item.status != .open
        return Text(item.title)
            .font(Typography.captionSmall)
            .lineLimit(1)
            .truncationMode(.tail)
            .strikethrough(isClosed)
            .foregroundStyle(isClosed ? Color.secondary : CozyPalette.ink)
            .padding(.horizontal, Spacing.xs + 1)
            .padding(.vertical, 1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                // 고른 칸의 바탕도 살구색이라, 칩이 그 위에서 도드라지려면 더 진해야 한다
                // (0.30 은 선택 칸 안에서 배경과 거의 같은 색으로 읽혔다 — 실측 렌더).
                isClosed ? CozyPalette.outline.opacity(0.14) : CozyPalette.apricot.opacity(0.42),
                in: RoundedRectangle(cornerRadius: Radius.badge, style: .continuous)
            )
    }

    // MARK: - 상세

    /// 고른 날의 목록. 넓은 창에서는 오른쪽 기둥, 좁은 창에서는 격자 아래에 선다.
    private var detailPanel: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            detailTitle
            if let updateFailure {
                // 대시보드의 승인 실패 안내(`DashboardView` 의 `store.approvalNotice`)와 같은 처리.
                Text(updateFailure)
                    .font(Typography.caption)
                    .foregroundStyle(Color.red)
            }
            detailBody
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.lg)
        .background(CozyPalette.surface, in: RoundedRectangle(cornerRadius: Radius.panel, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.panel, style: .continuous)
                .strokeBorder(CozyPalette.outline.opacity(0.10), lineWidth: 1)
        }
    }

    @ViewBuilder
    private var detailTitle: some View {
        if let selectedDay {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text("\(month)월 \(selectedDay)일")
                    .font(Typography.sectionTitle)
                    .foregroundStyle(CozyPalette.ink)
                Text(weekdayName(day: selectedDay))
                    .font(Typography.caption)
                    .foregroundStyle(.secondary)
            }
        } else {
            Text("일정")
                .font(Typography.sectionTitle)
                .foregroundStyle(CozyPalette.ink)
        }
    }

    /// 조회 실패 > 빈 상태 > 선택한 날 순으로 가른다.
    ///
    /// **조회에 실패했으면 목록을 보여주지 않는다.** 실패하면 `store.schedules` 에는 직전 달의
    /// 항목이 그대로 남는데, 화면의 달은 이미 바뀌어 있어(`shiftMonth` 가 먼저 바꾼다) 날짜
    /// 필터가 0건을 내놓는다 — 그대로 두면 "이 달은 일정이 없다"는 거짓말이 된다.
    @ViewBuilder
    private var detailBody: some View {
        if let loadFailure {
            loadFailureState(loadFailure)
        } else if isLoading, visibleSchedules.isEmpty {
            // 아직 아무것도 못 받은 회차. 빈 상태 안내(슬랙 등록법)를 여기 띄우면 등록이
            // 필요 없는데도 등록하러 가게 만든다. 이미 받은 게 있으면(달 안에서 완료를 누른
            // 직후 등) 목록을 그대로 두고 갱신을 기다린다 — 깜빡임이 오히려 혼란을 만든다.
            loadingState
        } else if visibleSchedules.isEmpty {
            // 미완이 0건이어도 빈 상태로 넘기지 않는다. 마지막 항목을 완료한 순간 목록이
            // 통째로 "등록된 일정이 없습니다" 로 바뀌면 방금 잘못 누른 것을 되돌릴 수 없다.
            emptyState
        } else if let selectedDay {
            let items = itemsOn(day: selectedDay)
            if items.isEmpty {
                Text("이 날엔 일정이 없습니다")
                    .font(Typography.body)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    ForEach(items) { item in
                        scheduleRow(item)
                    }
                }
            }
        } else {
            Text("날짜를 선택하세요")
                .font(Typography.body)
                .foregroundStyle(.secondary)
        }
    }

    /// 치운 줄의 **제목만** 흐리게 만드는 정도. 읽을 수는 있되 미완 줄과 한눈에 갈려야 한다 —
    /// 더 흐리면 되돌릴 대상을 못 찾고, 덜 흐리면 아직 할 일처럼 보인다.
    ///
    /// **메모에는 걸지 않는다.** 메모는 이미 `.secondary` 로 한 번 죽인 색이라 거기 0.5 를 또
    /// 곱하면 어두운 배경에서 대비가 2.34:1 까지 떨어져 읽을 수 없게 된다(다크 렌더 실측).
    /// 밝은 배경에서는 `.secondary` 가 짙은 회색이라 같은 실수가 드러나지 않아 못 보고 지나갔다.
    /// 치웠다는 신호는 제목의 흐림 + 취소선과 아래 상태 글자가 이미 충분히 낸다.
    private static let closedTitleOpacity: Double = 0.5

    /// 한 줄. 제목·메모 위, 버튼 아래의 **세로 배치**다 — 상세가 340pt 기둥으로 들어갈 수
    /// 있으므로 제목과 버튼 둘을 한 줄에 세우면 제목이 먼저 잘린다. 넓은 창에서도 같은 배치를
    /// 쓰는 건 두 조판을 따로 관리하면 한쪽만 손보게 되기 때문이다.
    private func scheduleRow(_ item: ScheduleItem) -> some View {
        let isClosed = item.status != .open
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(item.title)
                    .font(Typography.bodyEmphasis)
                    .foregroundStyle(CozyPalette.ink)
                    .strikethrough(isClosed)
                    .opacity(isClosed ? Self.closedTitleOpacity : 1)
                    .fixedSize(horizontal: false, vertical: true)
                if let memo = item.memo, !memo.isEmpty {
                    Text(memo)
                        .font(Typography.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                // 백엔드가 링크를 실어 보내는데도 화면 어디에도 나오지 않았다. 메모 아래
                // 한 줄로 둔다 — 여는 것 말고 할 일이 없는 값이라 버튼 하나면 족하다.
                if let linkUrl = item.linkUrl, let url = URL(string: linkUrl) {
                    Link(destination: url) {
                        Label("링크 열기", systemImage: "arrow.up.right.square")
                            .font(Typography.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(CozyPalette.ink.opacity(0.75))
                }
            }
            HStack(spacing: Spacing.sm) {
                if isClosed {
                    // 흐림·취소선만으로는 "완료" 와 "건너뜀" 이 구분되지 않는다. 글자는 버튼 이름과
                    // 같은 것을 쓴다(`actionLabel`) — 사용자가 누른 그 말이 그대로 남아야 잇는다.
                    Text(actionLabel(item.status))
                        .font(Typography.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    // 되돌리기는 보조 행동으로 둔다. 흐려 놓은 줄 위에 살구색 주 행동 버튼을 얹으면
                    // 아직 남은 항목보다 눈에 띄어 흐림이 무의미해진다(`AgentCardView` 의 "확인" 쪽).
                    Button("되돌리기") {
                        Task { await update(id: item.id, status: .open) }
                    }
                } else {
                    // 주 행동은 살구색, 보조는 기본 버튼 — `AgentCardView` 의 "업무 맡기기 / 확인"
                    // 짝과 같은 처리다. 시스템 기본 `.borderedProminent` 는 파란색이라 크림·살구
                    // 팔레트 위에서 이 화면만 튄다(앱 어디에도 파란 버튼이 없다).
                    Button {
                        Task { await update(id: item.id, status: .done) }
                    } label: {
                        Text("완료").foregroundStyle(primaryActionForeground)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(CozyPalette.apricot)
                    Button("건너뜀") {
                        Task { await update(id: item.id, status: .skipped) }
                    }
                    Spacer()
                }
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(CozyPalette.canvas, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
    }

    // MARK: - 빈 상태 안내

    /// 항목이 0개인 상태가 이 탭의 초기 기본값이다 — 등록 입구(Slack)를 여기 적어 두지 않으면
    /// 첫 화면을 본 사람이 무엇을 해야 할지 알 방법이 없다.
    private var emptyState: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "calendar.badge.checkmark")
                .font(Typography.emptyStateIcon)
                .foregroundStyle(CozyPalette.apricot.opacity(0.7))
            Text("등록된 일정이 없습니다")
                .font(Typography.emptyStateTitle)
                .foregroundStyle(CozyPalette.ink)
            Text("슬랙에서 이렇게 등록하세요")
                .font(Typography.caption)
                .foregroundStyle(.secondary)
            // 따라 칠 수 있는 형태로 보여준다 — 본문에 섞어 쓰면 예시인지 설명인지 갈리지 않는다.
            // **고정폭(`metricMono`)은 쓰지 않는다.** 한글은 라틴 글자 폭에 맞춰 늘어나므로
            // 낱자 사이가 벌어져 "@이대리 9월  30일  자동차세" 처럼 읽힌다(실측 렌더).
            Text("@이대리 9월 30일 자동차세")
                .font(Typography.bodyEmphasis)
                .foregroundStyle(CozyPalette.ink)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.xs)
                .background(CozyPalette.canvas, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        }
        .frame(maxWidth: .infinity)
        .multilineTextAlignment(.center)
        .padding(.vertical, Spacing.xl)
    }

    /// 조회 중 안내. 빈 상태·실패와 **셋이 서로 달라야** 한다 — 닮으면 "없다", "못 받았다",
    /// "아직 모른다" 가 한 모습으로 보이고, 사용자가 다음에 할 일을 고를 근거가 사라진다.
    private var loadingState: some View {
        VStack(spacing: Spacing.sm) {
            ProgressView()
            Text("일정을 불러오는 중입니다")
                .font(Typography.body)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xl)
    }

    /// 조회 실패 안내. 빈 상태와 **아이콘도 문구도 달라야** 한다 — 둘이 닮으면 연결이 끊긴 것을
    /// "일정이 0건" 으로 읽고, 있지도 않은 등록을 하러 슬랙으로 간다.
    private func loadFailureState(_ reason: String) -> some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "exclamationmark.triangle")
                .font(Typography.emptyStateIcon)
                .foregroundStyle(.secondary)
            Text("일정을 불러오지 못했습니다")
                .font(Typography.emptyStateTitle)
                .foregroundStyle(CozyPalette.ink)
            Text(reason)
                .font(Typography.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .multilineTextAlignment(.center)
        .padding(.vertical, Spacing.xl)
    }

    // MARK: - 동작

    private func weekdayName(day: Int) -> String {
        // 격자에서 이 날이 몇 번째 칸인지로 요일을 얻는다. 달력이 이미 월요일 시작으로
        // 계산해 둔 배치를 그대로 쓰므로 여기서 요일을 또 계산하지 않는다(두 벌이 되면 갈린다).
        guard let index = gridDays.firstIndex(where: { $0 == day }) else {
            return ""
        }
        return Self.weekdayNames[index % 7]
    }

    private func shiftMonth(_ delta: Int) {
        var nextMonth = month + delta
        var nextYear = year
        if nextMonth < 1 {
            nextMonth = 12
            nextYear -= 1
        }
        if nextMonth > 12 {
            nextMonth = 1
            nextYear += 1
        }
        month = nextMonth
        year = nextYear
        selectedDay = nil
        Task { await reload() }
    }

    /// 오늘이 든 달로 돌아가 그 날을 고른다. 달만 바꾸고 선택을 비우면 돌아와서 한 번 더
    /// 눌러야 오늘 일정이 보인다 — 버튼 이름이 "오늘" 이면 오늘이 열려야 맞다.
    private func goToToday() {
        // 알림을 놓친 회차(잠들어 있던 사이 자정이 지난 경우 등)까지 여기서 정정한다 —
        // 버튼 이름이 "오늘" 이면 눌린 순간의 오늘이어야 한다.
        let key = resolvedToday()
        today = key
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else {
            return
        }
        let sameMonth = parts[0] == year && parts[1] == month
        year = parts[0]
        month = parts[1]
        selectedDay = parts[2]
        if !sameMonth {
            Task { await reload() }
        }
    }

    /// 말일을 달력에서 직접 얻는다. `"%02d-31"` 로 만들면 2월은 백엔드의 `new Date` 가
    /// 3월 3일로 조용히 굴려 다음 달 항목이 이번 달 화면에 섞인다(에러가 안 나 발견이 늦다).
    private var lastDayOfMonth: Int {
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
            return 28
        }
        return range.count
    }

    private func reload() async {
        // 어느 달을 요청했는지 붙들어 둔다. `shiftMonth` 는 이동마다 독립 Task 를 띄우므로
        // 10월 요청이 11월 요청보다 늦게 도착할 수 있고, 그대로 반영하면 화면은 11월인데
        // 내용만 10월인 상태가 된다 — 오류가 나지 않아 눈치채기 어려운 쪽이다.
        let requestedYear = year
        let requestedMonth = month
        await MainActor.run { isLoading = true }
        let from = String(format: "%04d-%02d-01", requestedYear, requestedMonth)
        let to = String(format: "%04d-%02d-%02d", requestedYear, requestedMonth, lastDayOfMonth)
        do {
            let items = try await client.fetchSchedules(from: from, to: to)
            await MainActor.run {
                // 늦게 도착한 옛 요청은 로딩도 끄지 않는다 — 끄면 뒤에 뜬 새 요청이 아직
                // 도는 중인데 화면은 다 받은 것처럼 보인다.
                guard requestedYear == year, requestedMonth == month else { return }
                store.apply(schedules: items)
                loadFailure = nil
                isLoading = false
            }
        } catch {
            await MainActor.run {
                guard requestedYear == year, requestedMonth == month else { return }
                loadFailure = failureReason(error)
                isLoading = false
            }
        }
    }

    private func update(id: Int, status: ScheduleStatus) async {
        do {
            try await client.updateSchedule(id: id, status: status)
            await MainActor.run { updateFailure = nil }
        } catch {
            let reason = "\(actionLabel(status)) 실패 — \(failureReason(error))"
            await MainActor.run { updateFailure = reason }
        }
        // 실패해도 다시 읽는다. 실패의 상당수는 화면이 낡아 생긴 것(이미 처리된 항목을 누름)이라
        // 재동기화가 곧 정정이다 — `AppRootView.resolveApproval` 이 같은 이유로 그렇게 한다.
        await reload()
    }

    /// 행동 이름. 실패 문구와 치운 줄의 상태 표시가 함께 쓴다 — **버튼 글자와 같아야**
    /// 사용자가 무엇이 실패했는지, 자기가 무엇을 눌러 이렇게 됐는지 바로 잇는다.
    private func actionLabel(_ status: ScheduleStatus) -> String {
        switch status {
        case .done:
            return "완료"
        case .skipped:
            return "건너뜀"
        case .open:
            return "되돌리기"
        }
    }

    /// 실패를 사용자가 다음에 뭘 해야 할지 아는 문장으로 옮긴다.
    ///
    /// 구조는 `AppRootView.approvalFailureReason` 을 그대로 따른다 — 같은 `ConsoleClientError`,
    /// 같은 상태코드 묶음. 문구만 일정에 맞게 쓴다(승인 카드가 아니라 마감·신청·예약이라
    /// "만료된 요청" 같은 말이 여기서는 맞지 않는다).
    private func failureReason(_ error: Error) -> String {
        guard case let ConsoleClientError.badStatus(status) = error else {
            return "백엔드에 연결하지 못했습니다. 주소(\(baseURLLabel))와 실행 여부를 확인하세요."
        }
        switch status {
        case 404, 409, 412:
            return "이미 처리됐거나 사라진 일정입니다. 목록을 새로 고쳤습니다."
        case 401, 403:
            return "콘솔 접근이 거부됐습니다(토큰/loopback 확인)."
        case 503:
            return "백엔드에 CONSOLE_OWNER_SLACK_USER_ID 가 설정되지 않았습니다."
        default:
            return "백엔드 오류 (HTTP \(status))."
        }
    }
}
