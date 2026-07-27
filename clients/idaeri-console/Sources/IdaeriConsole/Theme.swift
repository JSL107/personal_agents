import ConsoleCore
import SwiftUI

/// 상태 5종의 표시 속성(색·한글 라벨). 색은 spec §의 Notion 심화편 팔레트에 대응한다.
/// 백엔드가 소유하는 말풍선(bubble)과 달리, 색·라벨은 앱 표현 계층의 소유다.
extension ConsoleAgentState {
    /// 카드 강조색(테두리·상단 바). 배경은 이 색의 옅은 tint 로 파생한다.
    var accentColor: Color {
        switch self {
        case .completed:
            return Color(red: 0.36, green: 0.78, blue: 0.63)  // 민트
        case .inProgress:
            return Color(red: 0.96, green: 0.78, blue: 0.25)  // 노랑
        case .awaitingApproval:
            return Color(red: 0.91, green: 0.36, blue: 0.60)  // 진한 핑크
        case .awaitingIntegration:
            return Color(red: 0.62, green: 0.55, blue: 0.90)  // 라벤더
        case .waiting:
            return Color(white: 0.72)  // 흰색 계열(대비 위해 옅은 회색 테두리)
        }
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
