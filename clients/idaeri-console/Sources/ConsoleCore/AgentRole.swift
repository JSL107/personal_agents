import Foundation

/// 개인 사무실 카드의 주 행동 문구. 필요한 입력을 버튼을 누르기 전에 예측할 수 있게 한다.
public struct AgentPrimaryAction: Equatable, Sendable {
    public let label: String
    public let title: String
    public let placeholder: String

    public init(label: String, title: String, placeholder: String) {
        self.label = label
        self.title = title
        self.placeholder = placeholder
    }
}

public func agentPrimaryAction(for agentType: String, roleName: String) -> AgentPrimaryAction {
    if agentType == "CODE_REVIEWER" {
        return AgentPrimaryAction(
            label: "리뷰 맡기기",
            title: "\(roleName)에게 리뷰 맡기기",
            placeholder: "PR URL이나 owner/repo#번호를 붙여주세요"
        )
    }
    return AgentPrimaryAction(
        label: "업무 맡기기",
        title: "\(roleName)에게 업무 맡기기",
        placeholder: "맡길 일을 적어주세요"
    )
}

/// agentType → 오피스에 표시할 회사사람형 닉네임.
///
/// 백엔드 `displayName` 은 슬랙·문서와 공유하는 영문 식별명이라 그대로 두고, 화면에 사람으로
/// 그릴 때만 직무를 연상할 수 있는 한글 닉네임으로 바꾼다. `김기획`·`박꼼꼼`처럼 실제
/// 회사 동료처럼 부를 수 있어야 하고, 이름만 봐도 어떤 일을 돕는지 대략 짐작할 수 있어야 한다.
///
/// 이름표가 서로 겹치지 않도록 6자 안팎으로 짧게 유지한다.
/// 미등록 타입은 nil — 호출자가 백엔드 displayName 으로 폴백한다.
public func agentRoleLabel(for agentType: String) -> String? {
    switch agentType {
    // 기획
    case "PM":
        return "김기획"
    case "PO_SHADOW":
        return "박보좌"
    case "PO_EVAL":
        return "최성과"
    // 리뷰
    case "CODE_REVIEWER":
        return "박꼼꼼"
    case "WORK_REVIEWER":
        return "정리나"
    case "IMPACT_REPORTER":
        return "이보람"
    // 발행한 글을 사람이 얼마나 고쳤는지 재는 자리. 오른쪽 끝 이름표가 벽에 눌리지 않도록 `한교정`으로
    // 세 글자를 유지한다.
    case "BLOG_REVISION":
        return "한교정"
    // 경영 — 사용자인 대표와 헷갈리지 않게 이 워커의 실제 업무인 총평을 닉네임에 남긴다.
    case "CEO":
        return "이총평"
    // 성장
    case "CAREER_MATE":
        return "강성장"
    case "JOB_APPLICATION":
        return "서지원"
    case "BLOG":
        return "문작가"
    case "BLOG_PUBLISH":
        return "배포해"
    case "VACATION":
        return "오휴가"
    case "INVEST":
        return "주지킴"
    // 셋 다 주식을 보지만 하는 일이 다르다 — 보유 종목 감시(주지킴) · 가상 계좌 평가(백장부) ·
    // 매수 후보 판단(추천호)으로 각자 연상되는 단어를 달리 준다.
    case "PAPER_TRADE":
        return "백장부"
    case "PAPER_RECOMMEND":
        return "추천호"
    case "DELAY_REPORT":
        return "신지연"
    case "CTO_STUDY":
        return "배운이"
    // 내부
    case "ISSUE_LABELER":
        return "나누리"
    case "SUBCONSCIOUS_GATE":
        return "제안나"
    case "CONTRADICTION_JUDGE":
        return "차모순"
    case "REVIEW_REPLY_JUDGE":
        return "정판단"
    case "HUMANIZER":
        return "윤다정"
    case "DOCS_AUDIT_OPTIMIZER":
        return "문고침"
    case "DOCS_AUDIT_EVALUATOR":
        return "문바름"
    case "PREFERENCE_LEARNING":
        return "최취향"
    case "EVENING_RETRO":
        return "하루미"
    case "OPS_SUPERVISOR":
        return "안정민"
    default:
        return nil
    }
}

/// 캐릭터 외형 변주 — 같은 스프라이트 한 장으로 서로 다른 사람처럼 보이게 하는 배정.
///
/// 32명이 전부 같은 얼굴이면 이름표를 읽기 전엔 누가 누군지 구분되지 않는다.
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
    let shirtShift = Double((sum / 7) % officeShirtShiftSteps) * officeShirtShiftStep
    let pantsIndex = (sum / 17) % pantsPalette.count
    return CharacterLook(
        sheetIndex: sheetIndex,
        hairIndex: hairIndex,
        shirtShift: shirtShift,
        pantsIndex: pantsIndex
    )
}

/// 셔츠 톤 단계 폭. 다섯 단계이므로 사람 사이 최대 차이는 이 값의 네 배다.
///
/// 0.05 였을 때는 한 방 사람들의 옷이 사실상 같은 색이었다 — 셔츠는 부서색에서 나오므로
/// 같은 방이면 색상이 같고, 남는 차이가 밝기뿐인데 그 폭이 32픽셀 캐릭터에서 안 보였다.
/// 폭을 키우되 부서색 계열은 유지한다(색상은 그대로, 연하고 진한 정도만 갈린다).
public let officeShirtShiftStep: Double = 0.09

/// 셔츠 톤 단계 수. 배정(`characterLook`)과 밝기 대역 계산(`officeShirtBrightnessRange`)이
/// **같은 값을 봐야 한다** — 두 곳에 적으면 단계를 늘렸을 때 대역 계산이 옛 범위만 훑는다.
public let officeShirtShiftSteps = 5

/// 한 방 사람들의 얼굴·머리색이 겹치지 않게 조정한 외형표를 만든다(순수·결정론적).
///
/// `characterLook(for:)` 단독으로는 같은 방에서 같은 얼굴이 나온다. 시트 5종 × 머리 5색은
/// 25조합인데 한 방에 최대 10명이 앉으므로, 해시가 부딪히는 쪽이 오히려 흔하다 —
/// 실제로 `PAPER_TRADE` 와 `PAPER_RECOMMEND` 가 같은 시트·같은 머리로 나란히 앉아 있었다.
///
/// **해시를 먼저 쓰고 부딪힌 사람만 다음 자리로 민다.** 순번으로 배정하면 간단하지만 사람이
/// 하나 추가될 때 그 뒤 사람들의 얼굴이 전부 밀려, 외워 둔 얼굴이 무너진다. 이 방식에서도
/// 사전순 앞자리에 사람이 들어오면 일부는 밀리므로, 방 전체가 뒤집히지 않는지(과반 유지)를
/// 테스트가 고정한다.
///
/// **셔츠 톤도 같은 방식으로 돌린다.** 톤 폭을 0.05 → 0.09 로 키운 것이(`officeShirtShiftStep`)
/// 한 방 사람들의 옷을 갈라 놓으려던 일인데, 배정이 해시 값을 그대로 통과시켜 절반만
/// 실현돼 있었다 — 평가 방 세 명이 렌더 픽셀까지 같은 218.0 이었다(2026-09-09 실측).
/// 부서색이 흐려지지는 않는다: 셔츠는 색상을 부서에서 받고 여기서 갈리는 것은 명도뿐이다.
///
/// 바지는 조정하지 않는다 — 부서와 엮이지 않은 축이라 방 단위로 돌릴 근거가 없고,
/// 어두운 계열로 좁게 잡아(`pantsPalette`) 단계 차이가 화면에서 읽히지도 않는다.
public func officeCharacterLooks(forRoommates agentTypes: [String]) -> [String: CharacterLook] {
    var usedHair: Set<Int> = []
    var usedFace: Set<Int> = []
    var usedShirt: Set<Int> = []
    var looks: [String: CharacterLook] = [:]
    // 배정 순서가 입력 순서에 흔들리면 스냅샷마다 얼굴이 뒤바뀐다.
    for agentType in agentTypes.sorted() {
        let base = characterLook(for: agentType)
        var sheet = base.sheetIndex
        var hair = base.hairIndex
        if usedHair.count < hairPalette.count {
            // **머리색이 남아 있는 동안은 머리색부터 유일하게 준다.** 32픽셀 캐릭터에서
            // 가장 먼저 읽히는 건 머리다 — 면적이 크고 색이 서로 멀다(검정·갈색·금발·적갈·회색).
            // 해시에 맡겼더니 성장방 8명이 5색 중 3색만 써서, 같은 갈색 머리가 방에 넷이었다.
            while usedHair.contains(hair) {
                hair = (hair + 1) % hairPalette.count
            }
        } else {
            // 색을 다 쓴 뒤(6명째부터)는 얼굴로 가른다 — 같은 머리색이라도 시트가 다르면
            // 이목구비·머리모양이 달라진다.
            for _ in 0..<(characterSheetCount * hairPalette.count) {
                if !usedFace.contains(sheet * hairPalette.count + hair) {
                    break
                }
                hair = (hair + 1) % hairPalette.count
                if hair == base.hairIndex {
                    sheet = (sheet + 1) % characterSheetCount
                }
            }
        }
        // 셔츠 톤은 **단계를 다 쓰면 라운드를 새로 연다.** 머리처럼 「소진 뒤에는 해시 그대로」
        // 로 두면 뒤늦게 오는 사람이 앞사람과 그대로 겹쳐, 정작 가장 붐비는 방이 안 고쳐진다 —
        // 콘텐츠 7명에서 톤 4 인 셋이 사전순 뒤쪽이라 셋 다 그대로 남았다(시뮬레이션 실측).
        // 라운드를 열면 한 톤에 몰리는 인원이 ⌈인원 ÷ 단계⌉ 로 묶인다.
        var shirtStep = Int((base.shirtShift / officeShirtShiftStep).rounded())
        if usedShirt.count == officeShirtShiftSteps {
            usedShirt.removeAll()
        }
        while usedShirt.contains(shirtStep) {
            shirtStep = (shirtStep + 1) % officeShirtShiftSteps
        }
        usedHair.insert(hair)
        usedFace.insert(sheet * hairPalette.count + hair)
        usedShirt.insert(shirtStep)
        looks[agentType] = CharacterLook(
            sheetIndex: sheet,
            hairIndex: hair,
            shirtShift: Double(shirtStep) * officeShirtShiftStep,
            pantsIndex: base.pantsIndex
        )
    }
    return looks
}
