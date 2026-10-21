import ConsoleCore
import SwiftUI

// MARK: - 간격

/// 화면의 모든 여백·간격이 고르는 단계. 값을 손으로 적는 대신 여기서 이름을 고른다.
///
/// 단계를 두는 이유는 미감이 아니라 **일관성의 검사 가능성**이다. 여백이 자유 숫자면
/// `10` 과 `12` 가 섞여도 아무도 눈치채지 못하지만, 이름을 고르게 하면 어긋남이 코드에서
/// 바로 보인다. 색이 이미 `ConsoleCore` 팔레트 단일 소스인데 간격만 자유였던 비대칭을 닫는다.
///
/// `tight`(2)만 4의 배수 밖에 있다. 배지 안에서 아이콘과 두 줄 글자가 붙는 자리인데
/// 4를 주면 배지가 글자보다 커진다 — 실측으로 남긴 예외이고, 여기 외에 쓰지 않는다.
enum Spacing {
    /// 2 — 배지·칩 내부의 줄 간격. 이 파일에 적힌 예외.
    static let tight: CGFloat = 2
    /// 4 — 아이콘과 글자처럼 한 덩어리로 읽혀야 하는 것 사이.
    static let xs: CGFloat = 4
    /// 8 — 같은 묶음 안의 항목 사이(라벨과 값, 버튼과 버튼).
    static let sm: CGFloat = 8
    /// 12 — 묶음의 안쪽 여백, 목록 행 사이.
    static let md: CGFloat = 12
    /// 16 — 패널 안쪽 여백, 나란한 카드 사이.
    static let lg: CGFloat = 16
    /// 24 — 화면 바깥 여백, 큰 섹션 사이.
    static let xl: CGFloat = 24
    /// 32 — 빈 화면 안내처럼 일부러 넉넉히 비우는 자리.
    static let xxl: CGFloat = 32
}

/// 모서리 굴림. 크기가 커질수록 굴림도 커져야 같은 곡률로 보인다.
enum Radius {
    /// 4 — 작은 배지.
    static let badge: CGFloat = 4
    /// 8 — 버튼·입력·칩 같은 조작 요소.
    static let control: CGFloat = 8
    /// 12 — 카드·패널.
    static let panel: CGFloat = 12
}

/// 상태 점·테두리처럼 굵기·지름이 곧 신호인 요소.
enum Stroke {
    /// 8 — 상태 점 지름. 세 곳이 7·8·9 로 갈려 있던 것을 하나로 모았다.
    static let dot: CGFloat = 8
    /// 1.5 — 카드 선택 테두리.
    static let emphasis: CGFloat = 1.5
}

/// 창·컴포넌트의 최소 치수. 여백이 아니라 레이아웃 뼈대라 따로 둔다.
enum Layout {
    /// 초상화 장면과 두 줄 직무가 찌그러지지 않는 대시보드 카드 하한.
    static let cardMinWidth: CGFloat = 300
    /// 대시보드 카드가 지향하는 폭. 열 수를 이 값으로 나눠 정한다.
    ///
    /// 카드 폭이 이 근처를 유지해야 초상화가 **방으로 읽힌다.** 방 일러스트는 1400×900
    /// (약 1.56:1)인데 초상화 높이는 218pt 로 고정이라, 카드가 넓어질수록 `scaledToFill` 이
    /// 좌우를 채우느라 벽과 창문을 잘라낸다 — 2560pt 창에서 3열이면 카드 폭이 827pt 까지
    /// 벌어져 비율이 3.8:1 이 되고, 화면에는 마룻바닥만 남았다(실측 렌더로 확인).
    /// 360 은 초상화 폭이 좌우 여백(16×2)을 뺀 328pt 가 되는 자리 — 218pt 높이와 짝지으면
    /// 1.5:1 로 원본 비율에 붙는다.
    static let cardTargetWidth: CGFloat = 360
    static let windowMinWidth: CGFloat = 720
    /// 창 자체의 최소 높이(루트).
    static let windowMinHeight: CGFloat = 560
    /// 탭 안쪽 내용의 최소 높이. 탭 전환 막대만큼 창보다 낮다.
    static let contentMinHeight: CGFloat = 520
    static let officeInspectorWidth: CGFloat = 300
    static let sheetMinWidth: CGFloat = 380
    static let editorMinHeight: CGFloat = 120
}

// MARK: - 글자

/// 글자의 **역할**. 크기를 직접 고르지 않고 "이것이 무엇인지" 를 고른다.
///
/// 전부 시스템 텍스트 스타일에서 파생한다 — 고정 포인트로 박으면 사용자가 시스템
/// 글자 크기를 키웠을 때 이 앱만 안 따라간다. `.system(size:)` 를 쓰는 곳은
/// 글자가 아니라 도형으로 읽히는 큰 아이콘 하나뿐이다.
enum Typography {
    /// 화면 제목("이대리 주식회사").
    static let screenTitle = Font.title.bold()
    /// 패널·카드 제목.
    static let sectionTitle = Font.headline
    /// 본문.
    static let body = Font.callout
    /// 강조 본문(배너 문구).
    static let bodyEmphasis = Font.callout.weight(.medium)
    /// 여러 줄 입력 본문.
    static let editorBody = Font.body
    /// 캡션(보조 설명).
    static let caption = Font.caption
    /// 강조 캡션(연결 상태).
    static let captionEmphasis = Font.caption.weight(.medium)
    /// 더 작은 캡션(카드 부제·세션 메타).
    static let captionSmall = Font.caption2
    /// 수치(요약 칩의 건수).
    static let metric = Font.title3.bold()
    /// 시각·식별자처럼 자릿수가 흔들리면 안 되는 수치.
    static let metricMono = Font.system(.caption, design: .monospaced)
    /// 좁은 자리의 고정폭 수치.
    static let metricMonoSmall = Font.system(.caption2, design: .monospaced)
    /// 배지 안의 짧은 식별자(세션 출처처럼 대문자 약어).
    static let badgeMono = Font.system(.caption2, design: .monospaced).weight(.bold)
    /// 빈 화면 안내 제목.
    static let emptyStateTitle = Font.title3.weight(.semibold)
    /// 빈 화면 안내 아이콘 — 글자가 아니라 도형이라 유일하게 고정 크기다.
    static let emptyStateIcon = Font.system(size: 40, weight: .light)
}

/// 상태 6종의 표시 속성(색·한글 라벨). 색 값은 ConsoleCore 의 팔레트(agentStatePaletteRGBA)를
/// 단일 소스로 참조한다.
/// 백엔드가 소유하는 말풍선(bubble)과 달리, 색·라벨은 앱 표현 계층의 소유다.
extension ConsoleAgentState {
    /// 카드 강조색(테두리·상단 바). 배경은 이 색의 옅은 tint 로 파생한다.
    var accentColor: Color {
        let rgb = agentStatePaletteRGBA(self)
        return Color(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }

    /// 카드 배경 tint.
    var tintColor: Color {
        accentColor.opacity(0.14)
    }

    /// 상태 배지의 점이 **맥박을 칠 상태인가.**
    ///
    /// 둘만 움직인다 — 지금 돌고 있는 일(`inProgress`)과 사람이 손을 대 주기를 기다리는 일
    /// (`awaitingApproval`). 나머지는 멈춰 있는 상태라 움직이면 뜻이 틀린다. 실패는 눈에
    /// 띄어야 하지만 **끝난** 일이므로 빨간색이 말하게 두고, 움직임은 주지 않는다 — 멈춘
    /// 것이 뛰고 있으면 아직 진행 중인 줄 안다.
    var showsActivityPulse: Bool {
        switch self {
        case .inProgress, .awaitingApproval:
            return true
        case .completed, .awaitingIntegration, .waiting, .failed:
            return false
        }
    }

    /// 카드 하단·범례용 한글 상태 라벨.
    var label: String {
        switch self {
        case .completed:
            return "완료"
        case .inProgress:
            return "진행 중"
        case .awaitingApproval:
            return "승인 대기"
        case .awaitingIntegration:
            return "연동 대기"
        case .waiting:
            return "대기"
        case .failed:
            return "실패"
        }
    }
}

/// pending 지시(리모컨 명령)의 배지 표현. bubble 과 마찬가지로 상태 자체는
/// ConsoleStore(도메인) 소유지만, 아이콘·라벨은 앱 표현 계층이 소유한다.
extension PendingPhase {
    var badgeIcon: String {
        switch self {
        case .sent:
            return "⏳"
        case .running:
            return "🔄"
        case .done:
            return "✅"
        case .answered:
            return "💡"
        case .failed:
            return "⚠️"
        }
    }

    var badgeLabel: String {
        switch self {
        case .sent:
            return "전송됨"
        case .running:
            return "진행 중"
        case .done:
            return "완료"
        case .answered:
            return "제안"
        case .failed:
            return "실패"
        }
    }
}

/// 부서 강조색은 ConsoleCore 의 부서 팔레트를 단일 소스로 참조한다.
extension Department {
    /// 부서 강조색(범례·아이콘 SwiftUI 표시용).
    var accentColor: Color {
        let rgb = agentDepartmentPaletteRGBA(self)
        return Color(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }
}
