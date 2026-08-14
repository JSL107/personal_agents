import Foundation

/// 오피스 부서 구획. 26개 에이전트를 6개 부서로 묶는다(정체성 표현용, 순수).
/// 상태(ConsoleAgentState)와 직교한다 — 상태는 토큰의 링/색, 부서는 아이콘·채움 tint·(Phase 3)방 배치.
public enum Department: String, CaseIterable, Codable, Sendable {
    case planning
    case engineering
    case review
    case executive
    case growth
    case internalOps

    /// 방 문패·카드에 붙는 부서 아이콘. 글자만으로는 구역을 훑을 때 어느 팀인지 안 잡힌다
    /// — 모양은 색·글자보다 먼저 읽히므로 부서를 구분하는 1차 신호로 쓴다.
    public var icon: String {
        switch self {
        case .planning:
            return "📋"
        case .engineering:
            return "💻"
        case .review:
            return "🔍"
        case .executive:
            return "👔"
        case .growth:
            return "🌱"
        case .internalOps:
            return "⚙️"
        }
    }

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

/// 백엔드가 보낸 부서 문자열을 앱 enum 으로 옮긴다. **판정이 아니라 변환이다.**
///
/// 예전에는 이 자리에 agentType → 부서 매핑 표가 있었다. 백엔드 사규(`agent-contract.ts`)에
/// 같은 표가 이미 있었으므로 정본이 둘이었고, 실제로 어긋나 있었다 — 백엔드가 리뷰로 배정한
/// `REVIEW_REPLY_JUDGE` 가 앱 표에는 없어 폴백을 타고 내부방에 앉았다. 부서 편성은 사규의
/// 소관이므로 앱은 그 값을 받아 쓴다.
///
/// nil·미지 문자열은 `.internalOps` 로 떨어진다. 백엔드가 부서를 새로 추가해 앱이 모르는 값이
/// 오는 경우인데, 크래시보다 한 방에 몰리는 편이 낫다 — 화면에서 바로 보이므로 조용히 틀리지 않는다.
public func departmentFromRaw(_ raw: String?) -> Department {
    guard let raw, let department = Department(rawValue: raw) else {
        return .internalOps
    }
    return department
}

/// 캐릭터 셔츠색(0~1 RGB). 부서색을 흰색 쪽으로 끌어와 파스텔로 만든다.
///
/// 원색을 그대로 입히면 작업복이 아니라 코스튬처럼 보이고, 얼굴·머리보다 옷이 먼저 눈에 띈다.
/// `shift` 는 사람마다 조금씩 다른 톤을 주는 값이라 같은 부서 안에서도 옷이 완전히 같지 않다.
///
/// 씬(`CharacterNode`)이 아니라 여기 있는 이유는 **부서가 바뀌면 옷도 바뀌어야 한다**는 규칙을
/// 테스트가 확인할 수 있게 하기 위해서다. SpriteKit 타깃에 두면 검증 러너가 닿지 못한다.
public func officeShirtColorRGB(
    department: Department,
    shift: Double
) -> (red: Double, green: Double, blue: Double) {
    let palette = agentDepartmentPaletteRGBA(department)
    // 시작점을 낮춘 것은 `shift` 폭을 넓히면서(`officeShirtShiftStep`) 방 전체가 진해지지
    // 않게 중심을 그대로 두기 위해서다 — 폭만 키우면 한 방이 통째로 원색 쪽으로 쏠린다.
    let blend = 0.34 + shift
    return (
        red: 1.0 - (1.0 - palette.red) * blend,
        green: 1.0 - (1.0 - palette.green) * blend,
        blue: 1.0 - (1.0 - palette.blue) * blend
    )
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
