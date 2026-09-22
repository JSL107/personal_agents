import ConsoleCore
import SwiftUI

/// 캘린더에서 일정을 등록하는 시트.
///
/// **닫는 책임을 호출부에 넘기지 않는다.** 등록이 실패해도 시트가 닫히면 사용자가 방금 친
/// 제목과 메모가 함께 사라진다 — 실패의 상당수는 백엔드가 안 떠 있는 경우라 다시 켜고
/// 그대로 눌러야 하는데, 그때 처음부터 다시 쳐야 한다. 그래서 성공했을 때만 스스로 닫고,
/// 실패는 폼 안에 남긴다(`CalendarView` 의 `updateFailure` 와 같은 정신).
struct ScheduleComposeSheet: View {
    /// 폼을 열 때 채워 둘 날짜. 날짜 칸에서 열면 그 날, 머리글의 + 로 열면 선택한 날(없으면 오늘).
    let initialDate: Date
    /// 등록을 수행하고 **실패 사유를 돌려준다**(성공은 nil). 시트는 그 값만 보고 닫을지 정한다.
    let onSubmit: (String, String, String?) async -> String?

    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var dueDate: Date
    @State private var memo: String
    @State private var isSubmitting: Bool = false
    @State private var failure: String?

    /// 라벨 열 폭. 세 라벨("제목"·"날짜"·"메모")을 같은 자리에서 시작시켜 입력칸의 왼쪽
    /// 모서리가 한 줄로 선다 — 제각각이면 폼이 계단처럼 보인다.
    private static let labelWidth: CGFloat = 40

    /// 시트 폭. 하한(380)에 조금 얹어 제목 한 줄이 넉넉히 들어가되, 실패 문구는 두세 줄로
    /// 감기게 둔다 — 한 줄로 펴려 하면 그만큼 폼 전체가 넓어진다.
    private static let sheetWidth: CGFloat = Layout.sheetMinWidth + 60

    /// `initialTitle`·`initialMemo`·`initialFailure` 는 시각 회귀 렌더 전용이다 — 실제
    /// 호출부(`CalendarView`)는 날짜와 콜백만 넘긴다. 빈 폼만 구우면 **긴 제목이 입력칸을
    /// 넘는지, 실패 문구가 버튼을 밀어내는지** 를 볼 수 없는데, 그 두 화면은 백엔드를 실제로
    /// 죽이고 긴 글을 쳐 넣지 않는 한 렌더로 닿지 않는다(`CalendarView` 의 `initial...` 과 같다).
    init(
        initialDate: Date,
        initialTitle: String = "",
        initialMemo: String = "",
        initialFailure: String? = nil,
        onSubmit: @escaping (String, String, String?) async -> String?
    ) {
        self.initialDate = initialDate
        self.onSubmit = onSubmit
        _dueDate = State(initialValue: initialDate)
        _title = State(initialValue: initialTitle)
        _memo = State(initialValue: initialMemo)
        _failure = State(initialValue: initialFailure)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text("새 일정")
                .font(Typography.sectionTitle)
                .foregroundStyle(CozyPalette.ink)

            VStack(alignment: .leading, spacing: Spacing.md) {
                field("제목") {
                    TextField("예: 자동차세 납부", text: $title)
                        .textFieldStyle(.roundedBorder)
                        .font(Typography.body)
                }
                field("날짜") {
                    DatePicker("", selection: $dueDate, displayedComponents: .date)
                        .labelsHidden()
                        .datePickerStyle(.stepperField)
                }
                field("메모") {
                    TextField("선택 — 어디서·어떻게", text: $memo, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .font(Typography.body)
                        .lineLimit(3...5)
                }
            }

            if let failure {
                Text(failure)
                    .font(Typography.caption)
                    .foregroundStyle(Color.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: Spacing.sm) {
                Spacer()
                Button("취소") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(isSubmitting)
                Button(isSubmitting ? "등록 중…" : "등록") { submit() }
                    .keyboardShortcut(.defaultAction)
                    // 공백만 친 제목은 백엔드가 400 으로 끊는다. 여기서 먼저 막아 두면
                    // "왜 안 되는지" 를 실패 문구가 아니라 버튼 모양으로 알 수 있다.
                    .disabled(isSubmitting || !isSubmittableScheduleTitle(title))
            }
        }
        .padding(Spacing.xl)
        // **`minWidth` 가 아니라 고정 폭이다.** 하한만 두면 폭이 내용을 따라가는데, 등록 실패
        // 문구는 백엔드 주소가 통째로 들어간 한 문장이라 시트를 910pt 까지 끌고 갔다(렌더 실측).
        // 폼은 칸 셋이 전부라 넓어져서 좋아질 것이 없고, 넓어지면 실패 문구만 화면 끝에 붙는다.
        .frame(width: Self.sheetWidth)
        .background(CozyPalette.canvas)
    }

    /// 라벨 + 입력칸 한 줄. 라벨은 입력칸 첫 줄에 맞춰 위로 붙인다 — 메모가 여러 줄로
    /// 늘어날 때 가운데 정렬이면 라벨만 아래로 내려가 어느 칸의 이름인지 흐려진다.
    private func field<Content: View>(
        _ label: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Text(label)
                .font(Typography.caption)
                .foregroundStyle(.secondary)
                .frame(width: Self.labelWidth, alignment: .leading)
                .padding(.top, Spacing.xs + 1)
            content()
        }
    }

    private func submit() {
        guard !isSubmitting else {
            return
        }
        isSubmitting = true
        failure = nil
        Task {
            let reason = await onSubmit(
                title.trimmingCharacters(in: .whitespacesAndNewlines),
                scheduleDateKey(dueDate),
                trimmedScheduleField(memo)
            )
            await MainActor.run {
                isSubmitting = false
                guard let reason else {
                    dismiss()
                    return
                }
                failure = reason
            }
        }
    }
}

/// 열려 있는 등록 폼 한 건. `sheet(item:)` 이 Identifiable 을 요구해서 날짜 키를 감싼다.
///
/// **매번 새 `id` 를 만든다.** 같은 날짜 칸을 두 번 눌렀을 때 값이 같으면 SwiftUI 가 같은
/// 항목으로 보고 시트를 다시 띄우지 않는다 — 첫 등록 뒤 같은 날에 하나 더 넣으려는 때가
/// 정확히 그 경우다.
struct ScheduleComposeRequest: Identifiable {
    let id = UUID()
    let dayKey: String
}
