import ConsoleCore
import SpriteKit
import SwiftUI

/// 한글이 뭉개지지 않는 최소 크기. 라틴 문자보다 획이 많아 하한이 높다.
///
/// 값은 `ConsoleCore` 가 단일 소스로 갖는다 — 문패가 이름표를 덮지 않을 높이를 계산하려면
/// 순수 경계(회귀 테스트가 닿는 곳)가 이 하한을 알아야 하기 때문이다.
let officeNameplateMinFontSize = CGFloat(officeNameplateMinFontSizeValue)
let officeZoneLabelMinFontSize = CGFloat(officeZoneLabelMinFontSizeValue)
/// 좌상단 전사 요약(HUD)의 최소 크기. 씬 안의 이름표가 아니라 화면에 얹는 글이라 따로 둔다.
let officeHudMinFontSize: CGFloat = 13
/// 좌상단 전사 요약(HUD) 판의 그리기 순서(overlayLayer 안에서의 로컬 zPosition).
///
/// 구역 문패(overlayLayer 자식, zPosition 미지정 = 0)보다는 위에 그려야 겹쳐도 이기고,
/// 커서 옆 쪽지 판(`makeHoverTooltip`, zPosition 100)보다는 아래여야 한다 — 쪽지가 늘
/// 최상단이어야 하는 이유는 그 판 자체의 주석에 있다(가림 방지).
let officeHudZPosition: CGFloat = 50

/// 책상 스탠드 빛 웅덩이 반지름(도트). `OfficeLightTexture.deskGlow` 텍스처의 한 변이
/// 이 값의 두 배가 된다 — 너무 크면 옆 책상까지 물들어 누구 자리가 켜졌는지 흐려진다.
let officeDeskGlowRadius = 13
/// 빛 웅덩이 색. 벽등 켜짐 색(`OfficeLightLayer.lampColor`)과 같은 계열의 따뜻한 호박색 —
/// 스탠드도 벽등도 같은 실내 조명이라 색이 갈리면 두 광원처럼 읽힌다.
///
/// 처음엔 책상 나무색에 가까운 옅은 호박색(0.82,0.45)을 썼는데, `.add` 로 얹어도 바탕색과
/// 겹쳐 실측 렌더에서 거의 안 보였다 — 채도를 올리고 세기(strength)도 함께 올려야
/// 나무 위에서 도드라진다.
let officeDeskGlowColor = OfficeColor(red: 1.00, green: 0.74, blue: 0.28)
/// 웅덩이 중심의 최대 알파. `.add` 로 얹으므로 1에 가까우면 책상 위가 하얗게 날아간다.
let officeDeskGlowStrength: Double = 0.8
/// 책상 자식 노드 중 그리는 순서(desk 노드 기준 로컬 zPosition). 책상 상판(0) 보다는 위,
/// 소품(0.01)보다는 아래 — 빛 웅덩이가 상판에 깔리고 그 위에 소품·서류가 놓인 그림이어야 한다.
let officeDeskGlowZPosition: CGFloat = 0.005

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
    static let sidebarWidth: CGFloat = 240
    static let cardMinWidth: CGFloat = 220
    static let windowMinWidth: CGFloat = 720
    /// 창 자체의 최소 높이(루트).
    static let windowMinHeight: CGFloat = 560
    /// 탭 안쪽 내용의 최소 높이. 탭 전환 막대만큼 창보다 낮다.
    static let contentMinHeight: CGFloat = 520
    static let officeMinWidth: CGFloat = 640
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
/// 단일 소스로 참조한다 — SwiftUI Color(대시보드)와 SKColor(오피스 씬)가 같은 색을 쓴다.
/// 백엔드가 소유하는 말풍선(bubble)과 달리, 색·라벨은 앱 표현 계층의 소유다.
extension ConsoleAgentState {
    /// 카드 강조색(테두리·상단 바). 배경은 이 색의 옅은 tint 로 파생한다.
    var accentColor: Color {
        let rgb = agentStatePaletteRGBA(self)
        return Color(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }

    /// SpriteKit 노드용 색(accentColor 와 같은 팔레트).
    var skColor: SKColor {
        let rgb = agentStatePaletteRGBA(self)
        return SKColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
    }

    /// 카드 배경 tint.
    var tintColor: Color {
        accentColor.opacity(0.14)
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

/// 부서의 표시 속성(색·아이콘). 색 값은 ConsoleCore 의 부서 팔레트를 단일 소스로 참조한다.
extension Department {
    /// 부서 강조색(범례·아이콘 SwiftUI 표시용).
    var accentColor: Color {
        let rgb = agentDepartmentPaletteRGBA(self)
        return Color(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }

    /// SpriteKit 아이콘 tint 색(accentColor 와 같은 팔레트).
    var skColor: SKColor {
        let rgb = agentDepartmentPaletteRGBA(self)
        return SKColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
    }

    /// 토큰 채움 tint(낮은 불투명도 — 상태 링 가독성 보존).
    var fillTintColor: SKColor {
        let rgb = agentDepartmentPaletteRGBA(self)
        return SKColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 0.20)
    }

    /// 부서 대표 SF Symbol 이름(시스템 제공, macOS 13 존재 확인된 것만).
    var iconSymbolName: String {
        switch self {
        case .planning:
            return "chart.bar.fill"
        case .engineering:
            return "gearshape.fill"
        case .review:
            return "magnifyingglass"
        case .executive:
            return "building.2.fill"
        case .growth:
            return "leaf.fill"
        case .internalOps:
            return "cpu"
        }
    }
}
