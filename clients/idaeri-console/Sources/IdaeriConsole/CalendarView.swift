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
        initialLoadFailure: String? = nil
    ) {
        self.store = store
        self.client = client
        self.baseURLLabel = baseURLLabel
        let now = Calendar(identifier: .gregorian)
        _year = State(initialValue: initialYear ?? now.component(.year, from: Date()))
        _month = State(initialValue: initialMonth ?? now.component(.month, from: Date()))
        _selectedDay = State(initialValue: initialSelectedDay)
        _loadFailure = State(initialValue: initialLoadFailure)
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

    // 날짜별 목록·점 계산은 `ConsoleCore` 의 순수 함수에 있다(`CalendarDayList.swift`).
    // 뷰 안에 두면 "완료해도 되돌릴 수 있다" 를 지탱하는 규칙이 테스트 밖에 남는다 —
    // 실제로 그 규칙이 없어진 것을 화면을 굽기 전까지 아무도 몰랐다.
    // 백엔드 `findByDateRange` 는 상태로 거르지 않고 기간 안 전 항목을 그대로 내려주므로
    // (`schedule.prisma.repository.ts`) 상태를 나누는 몫은 화면이 진다.

    private func dayKey(_ day: Int) -> String {
        calendarDayKey(year: year, month: month, day: day)
    }

    private func itemsOn(day: Int) -> [ScheduleItem] {
        daySchedules(items: store.schedules, dayKey: dayKey(day))
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
        let hasItems = hasOpenSchedule(items: store.schedules, dayKey: dayKey(day))
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

    private var detail: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let updateFailure {
                // 대시보드의 승인 실패 안내(`DashboardView` 의 `store.approvalNotice`)와 같은 처리.
                Text(updateFailure)
                    .font(Typography.caption)
                    .foregroundStyle(Color.red)
            }
            detailBody
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
        } else if store.schedules.isEmpty {
            // 미완이 0건이어도 빈 상태로 넘기지 않는다. 마지막 항목을 완료한 순간 목록이
            // 통째로 "등록된 일정이 없습니다" 로 바뀌면 방금 잘못 누른 것을 되돌릴 수 없다.
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

    /// 치운 줄을 흐리게 만드는 정도. 읽을 수는 있되 미완 줄과 한눈에 갈려야 한다 —
    /// 더 흐리면 되돌릴 대상을 못 찾고, 덜 흐리면 아직 할 일처럼 보인다.
    private static let closedRowOpacity: Double = 0.5

    private func scheduleRow(_ item: ScheduleItem) -> some View {
        let isClosed = item.status != .open
        return HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(item.title)
                    .font(Typography.bodyEmphasis)
                    .foregroundStyle(CozyPalette.ink)
                    .strikethrough(isClosed)
                if let memo = item.memo, !memo.isEmpty {
                    Text(memo)
                        .font(Typography.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .opacity(isClosed ? Self.closedRowOpacity : 1)
            Spacer()
            if isClosed {
                // 흐림·취소선만으로는 "완료" 와 "건너뜀" 이 구분되지 않는다. 글자는 버튼 이름과
                // 같은 것을 쓴다(`actionLabel`) — 사용자가 누른 그 말이 그대로 남아야 잇는다.
                Text(actionLabel(item.status))
                    .font(Typography.caption)
                    .foregroundStyle(.secondary)
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

    /// 조회 실패 안내. 빈 상태와 **아이콘도 문구도 달라야** 한다 — 둘이 닮으면 연결이 끊긴 것을
    /// "일정이 0건" 으로 읽고, 있지도 않은 등록을 하러 슬랙으로 간다.
    private func loadFailureState(_ reason: String) -> some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(Typography.emptyStateIcon)
                .foregroundStyle(.secondary)
            Text("일정을 불러오지 못했습니다")
                .font(Typography.emptyStateTitle)
            Text(reason)
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
        do {
            let items = try await client.fetchSchedules(from: from, to: to)
            await MainActor.run {
                store.apply(schedules: items)
                loadFailure = nil
            }
        } catch {
            await MainActor.run { loadFailure = failureReason(error) }
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
