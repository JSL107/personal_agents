import ConsoleCore
import SpriteKit
import SwiftUI

/// 오피스 씬의 모든 한글 라벨(이름표·부서 문패·말풍선·대표 표시)이 쓰는 폰트.
///
/// 예전에는 `Menlo` 를 썼는데 이 폰트에 한글 글리프가 없다. 시스템이 대체 폰트로 넘어가고
/// 그 결과가 힌팅 없이 텍스처로 구워져, 9~10px 한글은 획 사이가 1픽셀도 안 나와 서로 붙었다.
/// 굵은 고딕이라 작은 크기에서 획이 버틴다. 폰트 이름을 씬·노드에 흩뿌리면 픽셀 한글 폰트
/// 에셋이 들어올 때 교체가 누락되므로 여기 한 곳에 둔다.
let officeLabelFontName = "AppleSDGothicNeo-Bold"

/// 한글이 뭉개지지 않는 최소 크기. 라틴 문자보다 획이 많아 하한이 높다.
let officeNameplateMinFontSize: CGFloat = 11
let officeZoneLabelMinFontSize: CGFloat = 13

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
