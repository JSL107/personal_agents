import ConsoleCore
import SpriteKit
import SwiftUI

/// 상태 5종의 표시 속성(색·한글 라벨). 색 값은 ConsoleCore 의 팔레트(agentStatePaletteRGBA)를
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
