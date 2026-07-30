import Foundation

/// 오피스 부서 구획. 26개 에이전트를 6개 부서로 묶는다(정체성 표현용, 순수).
/// 상태(ConsoleAgentState)와 직교한다 — 상태는 토큰의 링/색, 부서는 아이콘·채움 tint·(Phase 3)방 배치.
public enum Department: String, CaseIterable, Sendable {
    case planning
    case engineering
    case review
    case executive
    case growth
    case internalOps

    /// 방 라벨·범례용 한글 부서명.
    public var label: String {
        switch self {
        case .planning:
            return "기획"
        case .engineering:
            return "개발"
        case .review:
            return "리뷰"
        case .executive:
            return "경영"
        case .growth:
            return "성장"
        case .internalOps:
            return "내부"
        }
    }
}

/// agentType(백엔드 AgentType enum 문자열) → 부서 매핑.
/// 미지 타입(향후 추가될 에이전트 포함)은 .internalOps 로 폴백해 크래시 없이 흡수한다.
public func department(for agentType: String) -> Department {
    switch agentType {
    case "PM", "PO_SHADOW", "PO_EVAL":
        return .planning
    case "BE", "BE_SCHEMA", "BE_TEST", "BE_SRE", "BE_FIX":
        return .engineering
    case "CODE_REVIEWER", "WORK_REVIEWER", "IMPACT_REPORTER":
        return .review
    case "CTO", "CEO":
        return .executive
    case "CAREER_MATE", "JOB_APPLICATION", "BLOG", "VACATION":
        return .growth
    default:
        return .internalOps
    }
}

/// 부서 6종의 표시 색(0~1 RGB). 부서색은 토큰의 아이콘·채움 tint 로 쓰인다(상태색과 역할 분리).
/// 제약: 6색 서로 구분 + 5개 상태색과 색상 충돌 회피. 채움 불투명도는 표현 계층(Theme)에서 낮춘다.
public func agentDepartmentPaletteRGBA(
    _ department: Department
) -> (red: Double, green: Double, blue: Double) {
    switch department {
    case .planning:
        return (0.28, 0.52, 0.90)  // 파랑
    case .engineering:
        return (0.15, 0.62, 0.70)  // 청록
    case .review:
        return (0.52, 0.40, 0.86)  // 인디고
    case .executive:
        return (0.82, 0.60, 0.20)  // 골드
    case .growth:
        return (0.94, 0.48, 0.36)  // 코랄
    case .internalOps:
        return (0.46, 0.52, 0.60)  // 슬레이트
    }
}
