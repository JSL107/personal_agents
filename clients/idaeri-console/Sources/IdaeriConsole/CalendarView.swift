import ConsoleCore
import SwiftUI

/// 캘린더 탭 루트 — 「마감·신청·예약」 일정을 월 격자로 보여준다.
///
/// **등록 입구는 여기가 아니다.** Slack `@이대리 9월 30일 자동차세` 가 유일한 입구이고,
/// 이 화면은 조회 + 완료·건너뜀만 한다(등록 폼을 두지 않는다 — 백엔드 컨트롤러에도 POST 가
/// 없다, `ScheduleConsoleController` 주석 참조).
struct CalendarView: View {
    @ObservedObject var store: ConsoleStore
    let client: ConsoleClient

    @State private var year: Int
    @State private var month: Int
    @State private var selectedDay: Int?

    /// `initialYear`/`initialMonth`/`initialSelectedDay` 는 화면 회귀 렌더 전용이다 — 실제
    /// 화면 호출부(`AppRootView`)는 항상 기본값(오늘)을 쓴다. 렌더는 특정 날짜가 이미 선택된
    /// 채로 구워야 상세 목록·완료/건너뜀 버튼까지 한 장에 담긴다(점만으로는 그 조판을 볼 수 없다).
    init(
        store: ConsoleStore,
        client: ConsoleClient,
        initialYear: Int? = nil,
        initialMonth: Int? = nil,
        initialSelectedDay: Int? = nil
    ) {
        self.store = store
        self.client = client
        let now = Calendar(identifier: .gregorian)
        _year = State(initialValue: initialYear ?? now.component(.year, from: Date()))
        _month = State(initialValue: initialMonth ?? now.component(.month, from: Date()))
        _selectedDay = State(initialValue: initialSelectedDay)
    }

    private static let weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"]

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

    /// 완료·건너뜀 항목은 화면에서 걷어낸다 — 완료를 누른 항목이 "사라지는" 동작이 이 필터에서 나온다.
    /// 백엔드 `findByDateRange` 는 상태로 거르지 않고 기간 안 전 항목을 그대로 내려준다
    /// (`schedule.prisma.repository.ts`), 그래서 걸러내는 몫은 화면이 진다.
    private var openSchedules: [ScheduleItem] {
        store.schedules.filter { $0.status == .open }
    }

    private func itemsOn(day: Int) -> [ScheduleItem] {
        let prefix = String(format: "%04d-%02d-%02d", year, month, day)
        return openSchedules.filter { $0.dueDay == prefix }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            header
            weekdayHeader
            grid
            Divider()
            detail
            Spacer()
        }
        .padding(Spacing.lg)
        .frame(minHeight: Layout.contentMinHeight, alignment: .top)
        .background(CozyPalette.canvas)
        .task { await reload() }
    }

    private var header: some View {
        HStack {
            Button {
                shiftMonth(-1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.plain)
            Text("\(String(year))년 \(month)월")
                .font(Typography.screenTitle)
                .foregroundStyle(CozyPalette.ink)
            Button {
                shiftMonth(1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.plain)
            Spacer()
        }
    }

    private var weekdayHeader: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7), spacing: Spacing.sm) {
            ForEach(Self.weekdayLabels, id: \.self) { label in
                Text(label)
                    .font(Typography.captionEmphasis)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var grid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7), spacing: Spacing.sm) {
            ForEach(Array(gridDays.enumerated()), id: \.offset) { _, day in
                if let day {
                    dayCell(day)
                } else {
                    Color.clear.frame(minHeight: 40)
                }
            }
        }
    }

    private func dayCell(_ day: Int) -> some View {
        let hasItems = !itemsOn(day: day).isEmpty
        let isSelected = selectedDay == day
        return Button {
            selectedDay = day
        } label: {
            VStack(spacing: Spacing.tight) {
                Text("\(day)")
                    .font(Typography.body)
                    .foregroundStyle(CozyPalette.ink)
                Circle()
                    .fill(hasItems ? CozyPalette.apricot : Color.clear)
                    .frame(width: 5, height: 5)
            }
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(
                isSelected ? CozyPalette.apricot.opacity(0.24) : Color.clear,
                in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var detail: some View {
        if openSchedules.isEmpty {
            emptyState
        } else if let selectedDay {
            let items = itemsOn(day: selectedDay)
            if items.isEmpty {
                Text("\(month)월 \(selectedDay)일엔 일정이 없습니다")
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
            Text("날짜를 선택하세요").foregroundStyle(.secondary)
        }
    }

    private func scheduleRow(_ item: ScheduleItem) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(item.title)
                    .font(Typography.bodyEmphasis)
                    .foregroundStyle(CozyPalette.ink)
                if let memo = item.memo, !memo.isEmpty {
                    Text(memo)
                        .font(Typography.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
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
        }
        .padding(Spacing.md)
        .background(CozyPalette.surface, in: RoundedRectangle(cornerRadius: Radius.panel, style: .continuous))
    }

    // MARK: - 빈 상태 안내

    /// 항목이 0개인 상태가 이 탭의 초기 기본값이다 — 등록 입구(Slack)를 여기 적어 두지 않으면
    /// 첫 화면을 본 사람이 무엇을 해야 할지 알 방법이 없다.
    private var emptyState: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "calendar.badge.checkmark")
                .font(Typography.emptyStateIcon)
                .foregroundStyle(.secondary)
            Text("등록된 일정이 없습니다")
                .font(Typography.emptyStateTitle)
            Text("슬랙에서 이렇게 등록하세요 — @이대리 9월 30일 자동차세")
                .font(Typography.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xxl)
        .padding(.horizontal, Spacing.xxl)
    }

    // MARK: - 동작

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
        let from = String(format: "%04d-%02d-01", year, month)
        let to = String(format: "%04d-%02d-%02d", year, month, lastDayOfMonth)
        guard let items = try? await client.fetchSchedules(from: from, to: to) else {
            return
        }
        await MainActor.run { store.apply(schedules: items) }
    }

    private func update(id: Int, status: ScheduleStatus) async {
        try? await client.updateSchedule(id: id, status: status)
        await reload()
    }
}
