import ConsoleCore
import SwiftUI

/// 탭 막대가 고르는 화면. `AppRootView` 가 선택 상태를 소유하지만 타입은 여기 둔다 —
/// 고르는 쪽과 그리는 쪽(`ConsoleHeaderView`)이 같은 이름을 봐야 한다.
enum ConsoleTab: Hashable {
    case calendar
    case dashboard
    case office
}

/// 창 맨 위 머리글 — 신호등·앱 이름·탭 전환·연결 상태.
///
/// **정본은 이 하나다.** 실제 앱(`AppRootView`)과 캘린더 회귀 렌더(`CalendarPreviewRender`)가
/// 같은 뷰를 쓴다. 렌더가 머리글을 따로 그리면 정본이 둘이 되어, 그림으로 확인한 것이 실제
/// 화면과 같다는 보장이 사라진다 — 이번 변경의 핵심("캘린더가 첫 화면")이 바로 이 탭 막대에
/// 있으므로, 여기가 갈리면 확인할 수 없는 요구가 된다.
struct ConsoleHeaderView: View {
    @Binding var tab: ConsoleTab
    let status: ConnectionStatus

    var body: some View {
        HStack(spacing: Spacing.lg) {
            HStack(spacing: Spacing.sm) {
                Circle().fill(Color(red: 0.96, green: 0.33, blue: 0.27)).frame(width: 12, height: 12)
                Circle().fill(Color(red: 1.00, green: 0.68, blue: 0.24)).frame(width: 12, height: 12)
                Circle().fill(Color(red: 0.27, green: 0.72, blue: 0.43)).frame(width: 12, height: 12)
            }
            HStack(spacing: Spacing.sm) {
                ZStack {
                    Circle().fill(CozyPalette.butter.opacity(0.30))
                    Image(systemName: "sun.max.fill")
                        .foregroundStyle(CozyPalette.butter)
                }
                .frame(width: 32, height: 32)
                Text("이대리 오피스")
                    .font(.title3.bold())
                    .foregroundStyle(CozyPalette.ink)
            }
            // 폭을 고정하지 않는다. 240pt 를 박아 두면 탭이 늘어날수록 칸이 좁아져
            // (둘일 땐 120pt, 셋이 되며 80pt) 한글 라벨이 눌린다. `fixedSize` 는 반대로
            // 내용이 요구하는 만큼 잡아, 라벨이 길어지거나 탭이 더 늘어도 글자가 먼저 상하지 않는다.
            Picker("보기", selection: $tab) {
                Label("캘린더", systemImage: "calendar").tag(ConsoleTab.calendar)
                Label("대시보드", systemImage: "rectangle.grid.2x2.fill").tag(ConsoleTab.dashboard)
                Label("오피스", systemImage: "person.3.fill").tag(ConsoleTab.office)
            }
            .pickerStyle(.segmented)
            .fixedSize()
            Spacer()
            HStack(spacing: Spacing.sm) {
                Circle().fill(status.color).frame(width: Stroke.dot, height: Stroke.dot)
                Text(status.label).font(Typography.captionEmphasis).foregroundStyle(.secondary)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(CozyPalette.canvas, in: Capsule())
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .background(CozyPalette.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(CozyPalette.outline.opacity(0.12)).frame(height: 1)
        }
    }
}
