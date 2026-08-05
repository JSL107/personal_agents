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
    // 경영 — 이 둘만 영문 약칭. 한국 회사에서도 CEO·CTO 는 그대로 직함으로 읽히고,
    // "기술이사"·"경영 리뷰" 로는 옆자리 둘의 관계(대표 / 기술 총괄)가 이름표에서 안 드러났다.
    case "CTO":
        return "CTO"
    case "CEO":
        return "CEO"
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
    /// 바지색 팔레트 인덱스.
    public let pantsIndex: Int
    public init(sheetIndex: Int, hairIndex: Int, shirtShift: Double, pantsIndex: Int) {
        self.sheetIndex = sheetIndex
        self.hairIndex = hairIndex
        self.shirtShift = shirtShift
        self.pantsIndex = pantsIndex
    }
}

/// 캐릭터 시트 접두어 — 스프라이트 파일명(`char-down` · `charb-down` …)의 앞부분.
/// 사람마다 다른 시트를 배정해 얼굴·체형까지 갈린다.
///
/// 로더가 파일명을 조립할 때와 에셋이 다 있는지 검사할 때가 같은 값을 봐야 한다 —
/// 예전에는 로더가 배열을 따로 들고 코어는 개수만 알아서, 시트를 늘려도 한쪽만 고쳐질 수 있었다.
public let characterSheetPrefixes = ["char", "charb", "charc", "chard", "chare"]

/// 준비된 캐릭터 시트 수(기본 + 선택 4종).
public let characterSheetCount = characterSheetPrefixes.count

/// 머리색 팔레트(0~1 RGB). 검정·짙은 갈색·밝은 갈색·적갈색·회색.
public let hairPalette: [(red: Double, green: Double, blue: Double)] = [
    (0.23, 0.23, 0.23),  // 검정 (원본에 가까움)
    (0.36, 0.24, 0.15),  // 짙은 갈색
    (0.58, 0.42, 0.24),  // 밝은 갈색
    (0.45, 0.20, 0.16),  // 적갈색
    (0.55, 0.55, 0.58),  // 회색
]

/// 바지색 팔레트(0~1 RGB). **어두운 계열로 좁게** 잡는다.
///
/// 이름표를 약하게 만든 만큼(가시성 정리) 사람을 구별하는 몫이 모습으로 옮겨와야 해서 넣은 축이다.
/// 바지는 면적이 넓어 밝거나 채도 높은 색을 쓰면 발밑 상태 링보다 먼저 눈에 들어온다 —
/// 관제 도구에서 가장 먼저 읽혀야 하는 신호가 상태색이므로 옷이 그 앞을 서면 안 된다.
///
/// 원본 바지는 rgb(5~17)의 거의 검정이고 렌더가 원본 명암 단계를 곱해 쓰므로, 여기 값이
/// 그 색조의 상한이 된다. 같은 밝기 대역에 신발이 포함될 수 있으나 어두운 계열이라 함께
/// 물들어도 어색하지 않다.
public let pantsPalette: [(red: Double, green: Double, blue: Double)] = [
    (0.16, 0.16, 0.18),  // 검정 (원본에 가까움)
    (0.18, 0.22, 0.34),  // 남색
    (0.28, 0.24, 0.20),  // 갈색
    (0.24, 0.26, 0.28),  // 짙은 회색
    (0.20, 0.28, 0.26),  // 짙은 청록
]

/// agentType 으로 외형을 정한다(순수·결정론적).
public func characterLook(for agentType: String) -> CharacterLook {
    // 문자열 해시는 프로세스마다 값이 달라질 수 있어(Swift Hasher 시드) 직접 합산한다.
    // 실행할 때마다 사람 머리색이 바뀌면 "누가 누군지" 를 외울 수 없다.
    var sum = 0
    for byte in agentType.utf8 {
        sum = (sum &* 31 &+ Int(byte)) % 100_003
    }
    // 시트·머리색·바지색을 서로 다른 자릿수에서 뽑아 축들이 같이 움직이지 않게 한다
    // (같은 나눗셈을 쓰면 시트 A 는 항상 검은 머리처럼 조합이 고정된다).
    let sheetIndex = (sum / 13) % characterSheetCount
    let hairIndex = sum % hairPalette.count
    let shirtShift = Double((sum / 7) % 5) * 0.05
    let pantsIndex = (sum / 17) % pantsPalette.count
    return CharacterLook(
        sheetIndex: sheetIndex,
        hairIndex: hairIndex,
        shirtShift: shirtShift,
        pantsIndex: pantsIndex
    )
}
