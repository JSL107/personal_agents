import Foundation

/// agentType → 오피스에 표시할 한글 직책.
///
/// 백엔드 `displayName` 은 슬랙·문서와 공유하는 영문 식별명이라 그대로 두고, 화면에 사람으로
/// 그릴 때만 직책으로 바꾼다. 회사 롤플레이에서 "Docs Audit Optimizer" 같은 이름은 사람의
/// 직책으로 읽히지 않는다.
///
/// 이름표가 서로 겹치지 않도록 6자 안팎으로 짧게 유지한다.
/// 미등록 타입은 nil — 호출자가 백엔드 displayName 으로 폴백한다.
public func agentRoleLabel(for agentType: String) -> String? {
    switch agentType {
    // 기획
    case "PM":
        return "기획 PM"
    case "PO_SHADOW":
        return "PO 대행"
    case "PO_EVAL":
        return "PO 평가"
    // 개발
    case "BE":
        return "백엔드"
    case "BE_SCHEMA":
        return "스키마"
    case "BE_TEST":
        return "테스트"
    case "BE_SRE":
        return "장애 대응"
    case "BE_FIX":
        return "규약 점검"
    // 리뷰
    case "CODE_REVIEWER":
        return "코드 리뷰"
    case "WORK_REVIEWER":
        return "업무 리뷰"
    case "IMPACT_REPORTER":
        return "성과 분석"
    // 경영
    case "CTO":
        return "기술이사"
    case "CEO":
        return "경영 리뷰"
    // 성장
    case "CAREER_MATE":
        return "커리어"
    case "JOB_APPLICATION":
        return "지원 관리"
    case "BLOG":
        return "블로그"
    case "VACATION":
        return "휴가 관리"
    // 내부
    case "ISSUE_LABELER":
        return "이슈 분류"
    case "SUBCONSCIOUS_GATE":
        return "제안 게이트"
    case "CONTRADICTION_JUDGE":
        return "모순 판정"
    case "REVIEW_REPLY_JUDGE":
        return "답변 판정"
    case "HUMANIZER":
        return "윤문"
    case "DOCS_AUDIT_OPTIMIZER":
        return "문서 개선"
    case "DOCS_AUDIT_EVALUATOR":
        return "문서 평가"
    case "PREFERENCE_LEARNING":
        return "선호 학습"
    case "EVENING_RETRO":
        return "회고 발행"
    case "OPS_SUPERVISOR":
        return "운영 감독"
    default:
        return nil
    }
}

/// 캐릭터 외형 변주 — 같은 스프라이트 한 장으로 서로 다른 사람처럼 보이게 하는 배정.
///
/// 26명이 전부 같은 얼굴이면 이름표를 읽기 전엔 누가 누군지 구분되지 않는다.
/// 머리색·피부톤을 agentType 에서 결정론적으로 뽑아, 스냅샷이 갱신돼도 같은 사람이
/// 같은 외모를 유지하게 한다.
public struct CharacterLook: Equatable, Sendable {
    /// 캐릭터 시트 인덱스(0 = 기본). 시트가 여러 종이면 얼굴·체형까지 갈린다.
    /// 해당 시트 파일이 없으면 렌더 쪽이 0번으로 폴백한다.
    public let sheetIndex: Int
    /// 머리색 팔레트 인덱스.
    public let hairIndex: Int
    /// 셔츠 색조를 부서색에서 얼마나 밀어낼지(같은 부서 안에서도 미세하게 다르도록).
    public let shirtShift: Double
    public init(sheetIndex: Int, hairIndex: Int, shirtShift: Double) {
        self.sheetIndex = sheetIndex
        self.hairIndex = hairIndex
        self.shirtShift = shirtShift
    }
}

/// 준비된 캐릭터 시트 수(기본 + 선택 3종).
public let characterSheetCount = 4

/// 머리색 팔레트(0~1 RGB). 검정·짙은 갈색·밝은 갈색·적갈색·회색.
public let hairPalette: [(red: Double, green: Double, blue: Double)] = [
    (0.23, 0.23, 0.23),  // 검정 (원본에 가까움)
    (0.36, 0.24, 0.15),  // 짙은 갈색
    (0.58, 0.42, 0.24),  // 밝은 갈색
    (0.45, 0.20, 0.16),  // 적갈색
    (0.55, 0.55, 0.58),  // 회색
]

/// agentType 으로 외형을 정한다(순수·결정론적).
public func characterLook(for agentType: String) -> CharacterLook {
    // 문자열 해시는 프로세스마다 값이 달라질 수 있어(Swift Hasher 시드) 직접 합산한다.
    // 실행할 때마다 사람 머리색이 바뀌면 "누가 누군지" 를 외울 수 없다.
    var sum = 0
    for byte in agentType.utf8 {
        sum = (sum &* 31 &+ Int(byte)) % 100_003
    }
    // 시트·머리색을 서로 다른 자릿수에서 뽑아 둘이 같이 움직이지 않게 한다
    // (같은 나눗셈을 쓰면 시트 A 는 항상 검은 머리처럼 조합이 고정된다).
    let sheetIndex = (sum / 13) % characterSheetCount
    let hairIndex = sum % hairPalette.count
    let shirtShift = Double((sum / 7) % 5) * 0.05
    return CharacterLook(sheetIndex: sheetIndex, hairIndex: hairIndex, shirtShift: shirtShift)
}
