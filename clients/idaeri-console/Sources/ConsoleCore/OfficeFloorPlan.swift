import Foundation

/// 타일 격자 좌표. (0,0) = 좌하단, y 는 위로 증가(SpriteKit 좌표계와 같은 방향).
public struct TilePoint: Hashable, Codable, Sendable {
    public let x: Int
    public let y: Int
    public init(x: Int, y: Int) {
        self.x = x
        self.y = y
    }
}

/// 캐릭터 전용 배율 계수. 원본 크기를 그대로 쓴다(1.0).
///
/// 한때 0.75 였다. "사람이 가구보다 크다" 를 사람 쪽 문제로 진단했기 때문인데, 탑다운
/// 픽셀아트에서 캐릭터가 타일보다 높은 것은 표준이다 — Gather.town 0.94~1.13칸,
/// RPG Maker XP 1.5칸, 스타듀밸리 2.0칸이고 이 앱은 1.35칸으로 그 범위 중간에 있다.
/// 1칸까지 줄이면 오히려 계보를 벗어나고, 29명을 머리색으로 구별하기도 어려워진다.
/// 사람이 위 칸에 걸치는 것도 이 시점의 정상 동작이다(Gather 공식 문서가 명시).
///
/// 실제 원인은 가구마다 축척이 달랐던 것이라 보정은 `FurnitureKind.sizeBoost` 가 전담한다.
/// 계수를 상수로 남겨 두는 이유는 하한 0.85(→1.15칸)까지 조정 여지를 두기 위함이다.
public let officeCharacterScaleFactor: Double = 1.0

/// 스프라이트 픽셀 ↔ 실물 치수 환산 기준. 서 있는 캐릭터 54px 을 키 170cm 로 본다.
///
/// 3/4 시점이라 정밀한 값은 아니다. 쓸모는 절대 크기가 아니라 **가구끼리의 편차**를 재는 데 있다.
///
/// **캐릭터 배율을 함께 곱해야 한다.** 캐릭터는 `officeCharacterScaleFactor` 를 추가로 받는데
/// 가구는 받지 않으므로, 이 값을 빼면 배율을 0.85 로 내리는 순간 기준은 그대로인 채 캐릭터만
/// 작아져 가구가 사람보다 커진다. 지금은 계수가 1.0 이라 드러나지 않지만 조정 여지를 남긴 값이라
/// 여기서 묶어 둔다.
private let officePixelsPerCentimeter = 54.0 * officeCharacterScaleFactor / 170.0

/// 스프라이트 원본이 그려진 기준 타일 크기(px). 창이 이 크기일 때 배율 1 이 원본 픽셀이다.
///
/// 렌더 쪽(`OfficeScene`)과 배율 계산(`FurnitureKind.sizeBoost`)이 같은 값을 봐야 한다 —
/// 두 곳에 따로 두면 한쪽만 바뀌었을 때 폭 상한이 조용히 어긋난다.
public let officeReferenceTileSize: Double = 40

/// 가구가 차지해도 되는 최대 가로폭(타일 배수). 높이 환산이 여기에 걸려 깎인다.
///
/// 1.0(자기 칸을 절대 안 넘음)이었다. 그런데 배율은 가로·세로에 함께 곱해지므로, 폭이 넓은
/// 에셋은 이 상한이 **높이까지 눌렀다** — 실측하면 책상은 목표의 97%, 소파 85%, 책장 79%만
/// 반영됐고, 그래서 사람 옆에 놓인 가구가 일제히 작아 보였다.
///
/// 1.15 는 "옆 칸을 7.5% 씩 침범"이다. 가구가 사람이나 상태 링을 가리면 관제 정보가 손실되므로
/// 상한 자체는 남기되, 이 정도는 나란히 놓인 책장 둘이 서로 맞닿아 보이는 수준이라 오히려
/// 벽면 가구답게 읽힌다. 더 키우려면 렌더로 겹침을 먼저 확인할 것.
public let officeFurnitureWidthCapTiles: Double = 1.15

/// 앉은 캐릭터를 책상 쪽으로 내리는 양(타일 크기 배수).
///
/// 좌석이 책상 **바로 위 칸**이고 캐릭터·가구 모두 발밑 기준(anchor y = 0)이라, 그냥 두면
/// 책상 상단(0.8칸)과 사람 발밑(1칸) 사이에 0.2칸 빈틈이 생긴다. 앉은 사람이 책상에 닿지 않고
/// 공중에 뜬 것처럼 보이는 원인이다. 앉음일 때만 내려 하반신이 책상에 가리게 한다 —
/// 서 있거나 걷는 캐릭터는 발이 바닥에 닿아야 하므로 오프셋 0 을 유지한다.
public let officeSeatedSpriteDrop: Double = 0.28

/// 벽에 거는 물건을 발밑에서 벽면 중턱으로 올리는 양(타일 배수).
///
/// 다른 가구와 같은 발밑 기준(anchor y = 0)을 그대로 쓰면 타일 바닥선에 붙어 **벽 앞에 세워
/// 둔 것**처럼 보인다 — 벽시계가 탁상시계가 되고 화이트보드가 이젤이 된다.
///
/// 씬에 박아 두면 평면도를 내보내는 쪽(`OfficeLayoutExport`)이 같은 값을 실을 수 없어, 그림을
/// 받아 그리는 다른 기기의 화면에서 벽걸이만 바닥으로 내려앉는다.
public let officeWallMountLiftTiles: Double = 0.32

/// 라운지 좌석은 가구 방향이 고정되지 않아, 책상용 수직 오프셋 대신 바라보는 쪽으로 당긴다.
///
/// 0.22칸은 몸이 가구에 닿지 않아 바닥에 쭈그려 앉은 것처럼 보였고, 0.48칸은 높이 약 1.35칸인
/// 캐릭터가 1×1 소파를 통째로 덮었다. 두 실패 사이인 0.30칸에서 몸과 가구를 겹치되 소파
/// 실루엣을 남긴다. 책상 좌석의 `officeSeatedSpriteDrop`은 별도 수직 오프셋으로 유지한다.
public let officeLoungeSpriteShift: Double = 0.30

// MARK: - 책상 위 서류 더미 (오늘 처리한 일의 양)

/// 한 책상에 쌓을 수 있는 서류의 최대 장수.
///
/// 상한이 필요한 이유는 책상이 좁은 것이다 — 책상 상판이 세로 32픽셀인데 한 장 올릴 때마다
/// 위로 올라가므로, 상한이 없으면 하루 100건 도는 사람의 서류가 책상을 넘어 위 칸 사람의
/// 이름표까지 뚫는다.
public let officeDeskPaperMaxCount: Int = 5

/// 서류 더미를 놓을 자리(책상 발밑 기준, 타일 배수). 오른쪽으로 치우쳐 앉은 사람을 피한다.
///
/// 좌석은 책상 **바로 위 칸**이고 앉은 사람은 `officeSeatedSpriteDrop` 만큼 내려와 책상에
/// 걸치므로, 책상 가운데에 놓으면 서류가 사람 몸통에 파묻힌다. 오른쪽으로 밀어야 하는데,
/// **너무 밀면 상판 밖으로 삐져나와 공중에 뜬 물체로 보인다** — 책상 스프라이트는 폭 37도트
/// 안에 좌우 여백이 있어 실제 상판은 그보다 좁다(0.30 에서 상판 경계에 걸쳤다, 실측).
/// 재제작본(위에서 내려다본 책상)에 맞춰 옮겼다. 상판이 키보드·마우스·모니터로 꽉 차서
/// 남은 빈 자리는 **맨 위 좌우 구석**뿐이다 — 예전 자리(0.22, 0.46)는 키보드와 모니터 사이
/// 3도트 틈이라 둘 중 하나를 반드시 덮었다.
///
/// 좌우로 벌리는 이유는 앉은 사람이 책상 위쪽 절반을 가리기 때문이다(사람 폭 0.65칸).
/// y 를 0.72 로 잡은 것은 서류가 다섯 장까지 위로 자라도(+0.11칸) 상판(0.89칸)을 넘지
/// 않는 상한이다. x 는 0.29 가 상한이다 — 더미는 장수가 늘면 **좌우로도 퍼지므로**
/// (0.34 에서는 세 장째에 상판 오른쪽을 넘어갔다) 그 퍼짐을 뺀 자리에 두어야 한다.
public let officeDeskPaperOriginTiles: (x: Double, y: Double) = (0.29, 0.72)

// MARK: - 책상 위 개인 소품

/// 책상마다 하나씩 얹는 개인 소품. 사람이 스물아홉인데 책상이 전부 똑같아서, 앉은 사람의
/// 머리색만 다르고 자리는 복사한 듯 같아 보였다.
///
/// 에셋 일곱 장은 진작 만들어져 있었는데(`prop-*.png`) 아무도 그리지 않았다 —
/// `draw-props.py` 가 파일만 뽑고 배선이 없었다.
public let officeDeskPropSprites = [
    "prop-laptop",
    "prop-mug",
    "prop-book-stack",
    "prop-desk-lamp",
    "prop-pen-holder",
    "prop-plant-desk",
    "prop-papers",
]

/// 그 사람의 책상에 놓을 소품 하나를 고른다(순수·결정론).
///
/// **스냅샷마다 바뀌면 안 된다.** 무작위로 고르면 5초 폴링마다 책상 위 물건이 갈리고,
/// 서른 개 책상에서 한꺼번에 일어나 화면이 깜빡이는 것으로 보인다. agentType 은 사람마다
/// 고정이므로 거기서 유도한다.
public func officeDeskProp(agentType: String) -> String {
    let hash = agentType.unicodeScalars.reduce(0) { accumulated, scalar in
        (accumulated * 31 + Int(scalar.value)) % 1_000_003
    }
    return officeDeskPropSprites[hash % officeDeskPropSprites.count]
}

/// 소품을 놓을 자리(책상 발밑 기준, 타일 배수).
///
/// 서류 더미가 오른쪽(`officeDeskPaperOriginTiles.x` = 0.22)을 쓰므로 왼쪽에 둔다 — 같은 쪽에
/// 두면 처리량이 많은 사람의 서류가 소품을 덮는다.
///
/// **책상 반폭(0.51칸)보다 훨씬 안쪽이어야 한다.** -0.24 로 뒀다가 렌더를 보니 소품이 상판
/// 왼쪽 모서리에 걸쳐 책상 밖으로 반쯤 나갔다. 스프라이트 폭(37도트) 안에서 실제 상판이
/// 차지하는 범위가 그보다 좁아서다 — 오른쪽 아래는 서류함이 물고 있다. 눈으로 확정한 값.
public let officeDeskPropOriginTiles: (x: Double, y: Double) = (-0.34, 0.72)

/// 한 장 쌓을 때마다 위로 올리는 간격(타일 배수)과 좌우로 어긋내는 폭.
///
/// 낱장이 세로 4도트라 딱 4도트씩 올리면 아래 장이 완전히 가려져 한 장처럼 보인다. 절반쯤만
/// 올려 아래 장의 외곽선이 남게 하고, 좌우로도 번갈아 밀어 손으로 쌓은 더미처럼 만든다.
///
/// **간격이 어긋냄보다 크면 더미가 아니라 세로 막대로 보인다.** 낱장 폭(7도트)이 높이(4도트)의
/// 두 배쯤이라, 위로 쌓는 양을 억제해 더미의 가로가 세로보다 길게 유지되어야 종이로 읽힌다.
public let officeDeskPaperStepTiles: Double = 0.022
public let officeDeskPaperJitterTiles: Double = 0.028

/// 위로 갈수록 어긋냄을 넓히는 비율(장당). 더미의 **가로 폭**이 장수에 따라 자라게 하는 값이다.
///
/// 고정 폭으로 쌓았을 때 1장과 5장이 같은 "흰 뭉치" 로 보였다 — 낱장이 화면에서 16×9픽셀밖에
/// 안 되어 1~2픽셀 층 차이가 뭉개진다. 세로로 더 높이 쌓는 것은 답이 아니다(세로 막대가 되고
/// 위 칸 좌석까지 올라간다). 가로로 퍼뜨리는 쪽이 같은 면적에서 양을 더 잘 보여준다.
///
/// 씬에 박아 두면 테스트가 닿지 않아 서류가 책상 밖으로 넘치는지 확인할 방법이 없어진다.
public let officeDeskPaperSpreadGrowth: Double = 0.6

/// 서류 더미가 책상 스프라이트 좌우 절반을 넘는지 판정할 때 쓰는 낱장 반폭(타일 배수).
/// 에셋(`desk-paper.png`) 실측 폭 7도트를 기준 타일로 환산한 값의 절반이다.
public let officeDeskPaperHalfWidthTiles: Double = 7.0 / 2.0 / officeReferenceTileSize

/// `count` 장을 쌓았을 때 더미가 책상 중심에서 좌우로 가장 멀리 벗어나는 거리(타일 배수).
///
/// 이 값이 책상 반폭을 넘으면 서류가 상판을 벗어나 옆 칸 위 허공에 뜬 물체로 보인다.
public func officeDeskPaperMaxReachTiles(count: Int) -> Double {
    guard count > 0 else {
        return 0
    }
    let widestSpread =
        officeDeskPaperJitterTiles
        * (1.0 + Double(count - 1) * officeDeskPaperSpreadGrowth)
    return officeDeskPaperOriginTiles.x + widestSpread + officeDeskPaperHalfWidthTiles
}

/// 오늘 끝낸 일 건수를 서류 장수로 바꾼다. 건수가 두 배로 늘 때마다 한 장 올라간다.
///
/// 선형(1건=1장)이 아닌 이유는 실측 편차다 — 리뷰 담당이 하루 20건 넘게 도는데 나머지는
/// 0~1건이라, 선형이면 그 한 명만 늘 최대치에 붙어 "조금 바쁨" 과 "매우 바쁨" 이 같은 그림이 된다.
///
/// `nil` 은 이 필드를 모르는 구버전 서버의 응답이다. 0장으로 두어 아무것도 그리지 않는다 —
/// 숫자를 모르는 것과 "오늘 한 건도 안 했다" 를 화면에서 구별할 방법이 없으므로, 없는 정보를
/// 그리지 않는 쪽을 고른다.
public func officeDeskPaperCount(doneToday: Int?) -> Int {
    guard let doneToday, doneToday > 0 else {
        return 0
    }
    // 2로 계속 나누며 세면 정확히 "두 배마다 한 장" 이 된다. log2 를 쓰지 않는 이유는
    // 경계값(4·8·16)에서 부동소수점 오차가 한 장을 깎을 수 있기 때문이다.
    var papers = 0
    var remaining = doneToday
    while remaining > 0, papers < officeDeskPaperMaxCount {
        papers += 1
        remaining /= 2
    }
    return papers
}

// MARK: - 책상 모니터 화면 (지금 일하는 중인가)

/// 책상 스프라이트(`furn-desk.png`, 37×32도트) 안에서 **모니터 화면**이 차지하는 자리.
/// 책상 노드 크기에 대한 비율이고, 좌우 중앙·발밑(anchor y = 0) 기준이다.
///
/// 비율로 두는 이유는 책상만 `sizeBoost` 로 따로 키우기 때문이다(`FurnitureKind.sizeBoost`).
/// 서류·소품처럼 타일 배수로 잡으면 배율이 바뀔 때 화면이 모니터 밖으로 밀려난다 —
/// 저 둘은 상판 위 아무 데나 놓여도 되지만, 이건 **정확히 겹쳐야** 켜진 화면으로 읽힌다.
///
/// 실측: 화면은 x 9~27, 위에서 y 4~8도트다(그 위 y 0~2 는 모니터 윗면, y 9 는 받침).
/// 좌우로 1도트씩 물려 검은 테두리를 남긴다 — 테두리까지 덮으면 화면이 아니라 파란 판이 된다.
/// 재제작본 실측(108×99). 위에서 내려다보면 화면 자체는 모니터 상단의 **2도트 띠**로만
/// 보인다 — 그대로 쓰면 배율(0.36)이 곱해져 0.7도트, 즉 1픽셀도 안 되어 켜짐 신호가 사라진다.
/// 그래서 발광 띠에 모니터 상단 몇 도트를 더해 두께를 확보한다(6도트 → 화면에서 약 2.2도트).
public let officeDeskScreenWidthRatio: Double = 80.0 / 108.0
public let officeDeskScreenHeightRatio: Double = 6.0 / 99.0
public let officeDeskScreenBottomRatio: Double = 43.0 / 99.0

// MARK: - 이름표·문패가 서로를 가리지 않게 하는 기준
//
// 이름표(캐릭터가 그린다)와 부서 문패(씬이 그린다)는 파일이 달라서, 각자 자기 숫자를 들고
// 있으면 어느 쪽을 옮겨도 상대가 모른다. 실제로 그렇게 어긋나 **각 부서 세 번째 좌석**의
// 이름표가 문패에 통째로 가려져 있었다(문패는 구역 정중앙 = 칸 5.5, 좌석은 1·3·5·7).
// 세로도 0.1칸이 겹쳤다. 두 값을 여기 모아 회귀 테스트가 겹침을 직접 계산하게 한다.

/// 앉은 캐릭터 스프라이트의 높이(타일 배수). `char-*-sit.png` 실측 57px ÷ 기준 타일.
/// 서 있는 그림(54px)보다 높다 — 의자 등받이까지 그려져 있다.
///
/// **이 값을 실물 높이로 환산하려는 시도는 한 번 했고, 되돌렸다.** 가구는 전부
/// `targetHeightCm` 로 환산되는데 앉은 캐릭터만 원본 도트를 그대로 쓴다. 재 보면 57도트는
/// 서 있는 자(54도트 = 170cm)로 179cm 를 뜻하니, 실제로 앉은 사람(바닥에서 정수리까지 약
/// 132cm)보다 36% 크다 — **앉으면 사람이 서 있을 때보다 커진다.** 논리로는 분명한 결함이다.
///
/// 그래서 0.74배를 곱해 봤고, 렌더로 확인하니 화면이 세 군데에서 나빠졌다:
/// 발밑 상태 링(타일 기준 고정 크기)이 작아진 몸의 **허리를 관통**해 상태색과 사람이 겹쳤고,
/// 안경·머리 모양이 뭉개져 옆자리와 구별이 어려워졌고, 몸이 짧아져 책상에 닿지 않고 그 위에
/// 뜬 것처럼 보였다.
///
/// 되돌린 이유는 **이 화면의 일이 관제**라서다. 사람이 정보의 주체이고 가구는 배경이므로,
/// 사람이 가구보다 크게 그려지는 것은 여기서는 결함이 아니라 정보 위계다(픽셀 게임의 캐릭터
/// 우선 축척과도 같은 방향이다). 실물 축척을 맞추고 싶으면 이 값만 건드려서는 안 되고,
/// 링 크기·이름표 하한·책상 오프셋을 한 묶음으로 다시 잡아야 한다.
///
/// 크기 어긋남이 실제로 보이는 곳은 사람이 아니라 **가구끼리**다 — 폭 환산이 없어서
/// 사물함이 실물의 2.4배로, 커피테이블이 0.6배로 그려진다(`targetHeightCm` 참조).
public let officeSeatedSpriteTiles: Double =
    57.0 / officeReferenceTileSize * officeCharacterScaleFactor

/// 이름표를 머리 위로 띄우는 간격(타일 배수). `CharacterNode.layoutNameplate` 가 쓴다.
public let officeNameplateGapTiles: Double = 0.06

/// 이름표 글자 크기(타일 배수). `CharacterNode.refreshNameplate` 가 쓴다.
public let officeNameplateFontTiles: Double = 0.30

/// 한글이 뭉개지지 않는 최소 글자 크기(px). 라틴 문자보다 획이 많아 하한이 높다.
///
/// **이 하한이 겹침 계산을 창 크기에 의존하게 만든다.** 큰 창에서는 글자가 타일에 비례하지만
/// 작은 창에서는 하한이 걸려 타일 대비 이름표가 커진다 — 최소 창(타일 20.6px)에서는 0.68칸으로
/// 기준 크기(0.375칸)의 두 배 가까이 된다. 문패를 "타일의 몇 배" 같은 고정값으로 띄우면
/// 큰 창에서만 안 겹치고 작은 창에서 다시 덮인다.
public let officeNameplateMinFontSizeValue: Double = 11
public let officeZoneLabelMinFontSizeValue: Double = 13

/// 글자 상자가 글자 크기보다 큰 몫(px).
///
/// 화면의 라벨은 전부 외곽선(`strokeWidth: -3.5`)을 두르는데 **그 두께가 상자 높이에 그대로
/// 더해진다.** `AppleSDGothicNeo-Bold` 한글 실측(11~30px)에서 상자는 늘 글자 크기 + 5~7px 이고,
/// 그 몫은 글자 크기에 비례하지 않는다 — 외곽선 두께가 상수이기 때문이다.
///
/// **예전에는 배수(1.3)로 모델링했고, 그게 양쪽 끝에서 틀렸다.** 글자 하한(11px)이 걸리는 작은
/// 창에서는 실제 17px 인 상자를 14.3px 로 잡아 문패가 이름표를 2.7px 덮었고, 30px 에서는 반대로
/// 4px 을 헛되이 띄웠다. 덧셈 모델은 두 끝을 같이 맞춘다. 실측 상한인 7 을 쓴다.
public let officeLabelBoxOverhead: Double = 7

/// 라벨 글자 상자의 실제 높이(px). 판 두께를 재는 모든 계산이 이 함수 하나를 본다.
public func officeLabelBoxHeight(fontSize: Double) -> Double {
    fontSize + officeLabelBoxOverhead
}

/// 문패 아래끝과 이름표 위끝 사이에 두는 최소 간격(타일 배수).
///
/// 두 라벨의 판(plate)이 각각 바깥으로 3px·1px 넓어지는 몫에서 출발했는데(0.14), 그 값은
/// **산술적으로만 안 겹쳤다.** 최소 창의 타일이 20px 남짓이라 0.14칸이면 3픽셀이고, 문패 판과
/// 이름표 판이 맞닿아 하나의 검은 뭉치로 읽힌다 — 여섯 부서 전부에서 구역 가운데 좌석
/// (`커리어`·`문서 개선`·`성과 분석`·`스키마`·`PO 평가`·`CTO`)의 이름이 그렇게 묻혔다.
/// 회귀 테스트는 두 값의 대소만 보므로 이 구간을 그대로 통과시킨다.
///
/// 0.35 는 최소 창에서 7픽셀 — 판 둘이 붙어 보이지 않는 최소치다(렌더 실측).
public let officeZoneLabelGapTiles: Double = 0.35

/// 부서 문패 글자 크기(타일 배수). 씬(`renderZoneLabels`)이 쓰는 값을 여기 둔 이유는
/// 겹침 계산이 같은 값을 봐야 하기 때문이다 — 씬에만 있으면 문패 판이 얼마나 두꺼운지
/// 검증 러너가 알 수 없어, "방 안에 들어가는가" 를 판 높이 없이 어림해야 한다.
public let officeZoneLabelFontTiles: Double = 0.38

/// 부서 문패 판의 높이(타일 배수). 한글 글자 하한(13px) 때문에 작은 창에서 더 두꺼워진다.
public func officeZoneLabelBoxTiles(tileSize: Double) -> Double {
    officeLabelBoxHeight(
        fontSize: max(officeZoneLabelMinFontSizeValue, tileSize * officeZoneLabelFontTiles)
    ) / tileSize
}

/// 라벨 판 둘 사이에 남아야 하는 실제 간격(픽셀).
///
/// 간격을 칸 배수로만 단언하면 **창 크기와 무관한 검사**가 된다 — 0.14칸도 "이름표 위"라는
/// 조건은 만족하지만 최소 창에서는 3픽셀이라 두 판이 맞닿는다. 화면에서 떨어져 보이는지는
/// 칸이 아니라 픽셀이 정한다.
public let officeLabelSeparationMinPixels: Double = 6

/// 다른 문패의 x 구간을 피하면서, 허용 구간 안에서 선호 위치와 가장 가까운 왼쪽 끝(px).
///
/// 상단 밴드와 부서 구역은 열 수에 따라 서로 다른 격자로 나뉜다. 그래서 "밴드 왼쪽, 부서
/// 가운데" 같은 고정 정렬은 3열에서만 우연히 떨어지고 2열에서는 `탕비실`과 `개발`처럼
/// 다시 만난다. 실제 렌더 판의 폭과 점유 구간을 입력으로 받아 경계 후보를 고르면 어느 격자가
/// 오더라도 같은 규칙으로 피한다. `officeLabelSeparationMinPixels`도 판 사이에 그대로 남긴다.
///
/// `officeNameplateFontSize`·`officeSeatedNameplateTopTiles`는 앉은 사람 이름표의 크기와 세로
/// 경계를 푸는 자산이라 여기 재사용하지 않는다. 문패 글꼴은 종류마다 배율이 다르고 이번 충돌은
/// 가로 문제다. 그 값을 억지로 공유하면 실제 판 폭 대신 다른 라벨의 근삿값으로 되돌아간다.
public func officeNonOverlappingLabelLeadingX(
    preferredLeadingX: Double,
    availableRange: ClosedRange<Double>,
    labelWidth: Double,
    occupiedRanges: [ClosedRange<Double>]
) -> Double {
    let minimumLeading = availableRange.lowerBound
    let maximumLeading = max(minimumLeading, availableRange.upperBound - labelWidth)
    let preferred = min(max(preferredLeadingX, minimumLeading), maximumLeading)
    let candidates =
        [preferred, minimumLeading, maximumLeading]
        + occupiedRanges.flatMap { occupied in
            [
                occupied.lowerBound - officeLabelSeparationMinPixels - labelWidth,
                occupied.upperBound + officeLabelSeparationMinPixels,
            ]
        }

    let feasible = candidates.filter { leading in
        leading >= minimumLeading && leading <= maximumLeading
            && occupiedRanges.allSatisfy { occupied in
                leading + labelWidth + officeLabelSeparationMinPixels <= occupied.lowerBound
                    || occupied.upperBound + officeLabelSeparationMinPixels <= leading
            }
    }
    // 현재 2·3열은 안전 구간이 있다. 미래의 긴 번역처럼 구역보다 판이 넓은 입력에서도
    // 좌표를 구역 밖으로 날리지는 않는다. 그 경우 렌더 폭 축소 정책은 별도 문제다.
    return feasible.min { left, right in
        let leftDistance = abs(left - preferred)
        let rightDistance = abs(right - preferred)
        return leftDistance == rightDistance ? left < right : leftDistance < rightDistance
    } ?? preferred
}

/// 오피스 씬의 모든 한글 라벨(이름표·부서 문패·말풍선·대표 표시)이 쓰는 폰트.
///
/// 예전에는 `Menlo` 를 썼는데 이 폰트에 한글 글리프가 없다. 시스템이 대체 폰트로 넘어가고
/// 그 결과가 힌팅 없이 텍스처로 구워져, 9~10px 한글은 획 사이가 1픽셀도 안 나와 서로 붙었다.
/// 굵은 고딕이라 작은 크기에서 획이 버틴다. 폰트 이름을 씬·노드에 흩뿌리면 픽셀 한글 폰트
/// 에셋이 들어올 때 교체가 누락되므로 여기 한 곳에 둔다.
///
/// **앱이 아니라 여기 있는 이유는 회귀 테스트다.** 이름표가 자리에 들어가는지는 글자를
/// 실제로 그려 봐야 알 수 있는데(폭은 글꼴이 정한다), 폰트 이름이 앱 타깃에만 있으면
/// 테스트가 같은 글꼴로 잴 수 없어 상수로 되계산하는 자기 확인이 된다.
public let officeLabelFontName = "AppleSDGothicNeo-Bold"

/// 이름표 글자 크기(px). 타일에 비례하되 한글 하한이 걸린다.
public func officeNameplateFontSize(tileSize: Double) -> Double {
    max(officeNameplateMinFontSizeValue, tileSize * officeNameplateFontTiles)
}

/// 이름표 판이 글자 상자 밖으로 넓어지는 폭(px). 판을 좌우로 3px 씩 벌리므로 그 합이다.
public let officeNameplatePlatePadding: Double = 6

/// 상시 말풍선("#271 리뷰 중")·경과 글자 크기(타일 배수).
///
/// 씬이 라벨을 그릴 때와 문패 높이를 잴 때 **같은 값**을 써야 한다. 한쪽에만 숫자를 두면
/// 말풍선을 키운 날 문패가 조용히 다시 말풍선을 덮는다.
public let officeBubbleFontTiles: Double = 0.24

/// 상시 말풍선 글자 크기(px). 이름표와 같은 한글 하한이 걸린다.
public func officeBubbleFontSize(tileSize: Double) -> Double {
    max(officeNameplateMinFontSizeValue, tileSize * officeBubbleFontTiles)
}

/// 상시 말풍선이 쓸 수 있는 최대 줄 수.
///
/// 말풍선은 12자까지 온다(`ACTIVITY_BUBBLE_MAX_LENGTH`). 한글 글자에 하한(11px)이 있어
/// **어느 창 크기에서도** 한 줄 12자는 좌석 몫 두 칸을 넘는다 — 옆자리도 일이 돌면 두
/// 말풍선이 그대로 포개져 둘 다 못 읽는다(최소 창에서는 네다섯 개가 겹친다).
/// 좌석 몫에 맞춰 접되, 세 줄까지 자라면 머리 위가 글자탑이 되고 문패도 그만큼 더 밀어
/// 올려야 하므로 두 줄에서 끊고 나머지는 말줄임한다 — 창을 키우면 전부 돌아온다.
public let officeBubbleMaxLines: Double = 2

/// 이름표 판 위에 남겨야 하는 여유(px). 말풍선 글자와 이름표 글자가 맞닿지 않을 만큼.
public let officeNameplateClearancePadding: Double = 6

/// 머리 위 라벨(이름표 위에 얹는 말풍선·경과)이 스프라이트 위끝에서 떨어지는 거리(px).
///
/// **이름표 상자 높이를 `officeLabelBoxHeight` 로 재야 한다.** 글자 크기를 그대로 상자
/// 높이로 쓰면 외곽선 몫(5~7px)이 빠져, 확보했다는 여유 6px 이 통째로 그 몫에 먹힌다 —
/// 실측 여백이 어느 창 크기에서도 0.00px 이 되어 말풍선이 이름표 글자에 그대로 얹혔다.
public func officeNameplateClearance(tileSize: Double) -> Double {
    officeLabelBoxHeight(fontSize: officeNameplateFontSize(tileSize: tileSize))
        + tileSize * officeNameplateGapTiles + officeNameplateClearancePadding
}

/// 이름표를 자리 몫에 맞추는 가로 배율과 중심 이동량(px). 몫은 좌석 중심 기준 좌우 여유다.
///
/// **패딩은 눌리지 않는다.** 배율은 글자에만 걸리고 판의 좌우 여백은 그대로 남으므로, 판
/// 전체가 눌린다고 보고 계산하면 실제 판이 몫을 `패딩 × (1 - 배율)` 만큼 넘는다. 절반쯤
/// 눌리는 좁은 자리에서는 3px 가까이 새는 셈이라, 지켜 낸 벽·문 경계와 이웃 사이 6px 를
/// 그만큼 도로 깎아먹는다. 그래서 몫에서 패딩을 먼저 떼고 남은 폭에 글자를 맞춘다.
///
/// 이 산술을 렌더 노드가 아니라 여기 두는 이유는 회귀 테스트가 닿게 하기 위해서다 — 노드
/// 안에 있으면 실제 글꼴로 그려 본 폭으로 검산할 방법이 없다.
public func officeNameplateLayout(
    glyphWidth: Double,
    spanLeft: Double,
    spanRight: Double
) -> (scaleX: Double, offsetX: Double) {
    let available = spanLeft + spanRight
    // 패딩조차 못 담는 몫에서는 손대지 않는다. 밀어 봐야 판이 좌석 중심에서 통째로 빠져
    // 이름이 남의 자리 위에 가 붙는다.
    guard available > officeNameplatePlatePadding, glyphWidth > 0 else {
        return (scaleX: 1, offsetX: 0)
    }
    let scaleX = officeLabelSqueeze(
        renderedWidth: glyphWidth,
        availableWidth: available - officeNameplatePlatePadding
    )
    let half = (glyphWidth * scaleX + officeNameplatePlatePadding) / 2
    return (scaleX: scaleX, offsetX: min(max(0, half - spanLeft), spanRight - half))
}

/// 이 칸이 그 구역 안에 있는가.
public func officeZoneContains(_ zone: DepartmentZone, _ tile: TilePoint) -> Bool {
    tile.x >= zone.origin.x && tile.x < zone.origin.x + zone.width
        && tile.y >= zone.origin.y && tile.y < zone.origin.y + zone.height
}

/// 좌석 이름표가 좌우로 쓸 수 있는 여유(칸). 좌석 중심(`x + 0.5`) 에서 왼쪽·오른쪽 각각.
///
/// 이름표는 캐릭터 노드의 자식이라 늘 좌석 중앙에 놓이는데, 폭은 이름 길이와 창 크기가
/// 정한다. 자리보다 넓어지면 갈 곳이 없어 두 방향으로 샌다 — **옆자리 이름표를 덮거나**
/// (`모순 판정│문서 평가│문서 개선│회고 발행│윤문` 다섯 판이 맞닿았다) **방 벽과 문 위로
/// 넘어간다**(`답변 판정`·`윤문` 은 오른쪽 벽 바로 옆 자리다).
///
/// 좌우 이웃과는 중간선까지, 이웃이 없으면 방 안쪽 벽까지를 자기 몫으로 준다. 이웃도 같은
/// 규칙을 쓰므로 두 이름표의 몫은 중간선에서 만나고 서로를 넘지 않는다 — 자리 간격이나
/// 이름 길이가 바뀌어도 이 성질은 유지된다.
///
/// **문 열도 경계다.** 천장에 낸 문(`officeZoneDoorColumn`)은 그림이 있는 칸이라, 판이 그
/// 위로 밀려 올라가면 문짝 무늬와 글자가 겹쳐 둘 다 안 읽힌다 — 벽 침범만 막았을 때 벽 옆
/// 자리(`답변 판정`)가 왼쪽으로 밀리면서 정확히 그렇게 됐다.
///
/// **자리 간격(`departmentDeskSpots` 의 2칸)으로는 못 푼다.** 한글 글자 크기에 하한(11px)이
/// 있어 창이 작아지면 타일 대비 이름표가 커지는데, 자리 간격은 창을 따라 같이 좁아지기
/// 때문이다. 넘치는 몫은 배치가 아니라 이름표 쪽에서 눌러 흡수한다(`officeLabelSqueeze`).
///
/// 이웃 쪽 경계에서만 여백(`officeLabelSeparationMinPixels` 의 절반씩)을 물러난다. 판 둘이
/// 맞닿으면 한 덩어리로 읽히기 때문인데, 벽과 문은 라벨이 아니라 그럴 일이 없다 — 거기까지
/// 물러나면 가뜩이나 좁은 벽 옆 자리를 이유 없이 더 누르게 된다.
public func officeNameplateSpanTiles(
    seat: TilePoint,
    seatsInZone: [TilePoint],
    zone: DepartmentZone,
    tileSize: Double
) -> (left: Double, right: Double) {
    let center = Double(seat.x) + 0.5
    // 방 안쪽 — 원점 칸과 마지막 칸은 좌우 벽이다.
    var left = Double(zone.origin.x + 1)
    var right = Double(zone.origin.x + zone.width - 1)

    let door = Double(zone.origin.x + officeZoneDoorColumn)
    if center > door + 1 {
        left = max(left, door + 1)
    }
    if center < door {
        right = min(right, door)
    }

    let neighborGap = officeLabelSeparationMinPixels / 2 / max(tileSize, 1)
    let sameRow = seatsInZone.filter { $0.y == seat.y && $0.x != seat.x }
    if let nearest = sameRow.filter({ $0.x < seat.x }).map(\.x).max() {
        left = max(left, (Double(nearest) + 0.5 + center) / 2 + neighborGap)
    }
    if let nearest = sameRow.filter({ $0.x > seat.x }).map(\.x).min() {
        right = min(right, (Double(nearest) + 0.5 + center) / 2 - neighborGap)
    }
    return (left: max(0, center - left), right: max(0, right - center))
}

/// 좌석에 앉은 사람의 이름표 위끝이 격자에서 몇 칸 높이에 오는가.
public func officeSeatedNameplateTopTiles(seatY: Int, tileSize: Double) -> Double {
    let boxTiles =
        officeLabelBoxHeight(fontSize: officeNameplateFontSize(tileSize: tileSize)) / tileSize
    return Double(seatY) - officeSeatedSpriteDrop + officeSeatedSpriteTiles
        + officeNameplateGapTiles + boxTiles
}

/// 좌석에 앉은 사람의 **상시 말풍선** 위끝이 격자에서 몇 칸 높이에 오는가.
///
/// 말풍선은 이름표보다 한 층 더 위다 — 스프라이트 위끝에서 `officeNameplateClearance` 만큼
/// 떨어진 자리에 글자 **아래끝**을 두고 위로 자란다. 아래를 고정하는 이유는 두 줄로 접힐 때
/// (`officeBubbleMaxLines`) 아래로도 자라면 사람 머리와 이름표를 덮기 때문이다.
///
/// 최악(두 줄)을 기준으로 잰다. 지금 한 줄인 사람에 맞춰 문패를 내리면, 옆자리가 긴 문구를
/// 받아 두 줄이 되는 순간 문패가 다시 그 위를 덮는다.
public func officeSeatedBubbleTopTiles(seatY: Int, tileSize: Double) -> Double {
    let boxTiles =
        officeLabelBoxHeight(fontSize: officeBubbleFontSize(tileSize: tileSize))
        * officeBubbleMaxLines / tileSize
    return Double(seatY) - officeSeatedSpriteDrop + officeSeatedSpriteTiles
        + officeNameplateClearance(tileSize: tileSize) / tileSize + boxTiles
}

/// 부서 문패 아래끝을 놓을 높이(격자 칸).
///
/// 구역 경계 줄이 아니라 **그 방 첫 좌석 행 머리 위 라벨 위끝**에서 파생한다. 문패는
/// 오버레이(z=1000)라 겹치면 가리는 쪽이 늘 문패이고, 문패가 구역 정중앙(칸 5.5)·좌석이
/// 1·3·5·7 이라 겹치는 순간 매번 같은 사람(세 번째 좌석)의 글자가 통째로 사라진다.
///
/// 기준은 이름표가 아니라 **말풍선**이다. 이름표 위끝으로 재던 동안, 이름표보다 한 층 위에
/// 뜨는 상시 말풍선("#271 리뷰 중")은 계산에 없어서 첫 행 가운데 좌석의 말풍선이 문패 판에
/// 늘 삼켜졌다 — 지금 무슨 일을 하는지가 정확히 그 자리에서만 안 보였다.
///
/// **말풍선을 피해 올릴 자리가 방 안에 없으면 방 아래쪽에 둔다.** 첫 좌석이 방 위쪽에 있고
/// 그 위로 이름표·말풍선이 두 층 쌓이면 계산값이 방 천장(구역 맨 위 줄)을 넘어간다. 예전에는
/// 그대로 올려서 문패가 **위층 방 안**에 걸렸다 — 여섯 방 전부가 한 칸씩 밀려 리뷰 방에
/// `성장`, 개발 방에 `경영` 문패가 붙었고, 맨 아래 두 방은 문패를 잃었다. 방 이름이 남의
/// 방에 걸리면 자리 배정이 틀린 것으로 읽힌다("성장 방에 왜 개발팀이 앉아 있나").
/// 아래쪽 줄에는 좌석이 없으므로(자리는 구역 위쪽부터 쌓인다) 이름표·말풍선과 겹치지 않는다.
///
/// 한계는 **아래끝이 아니라 판 위끝**으로 잰다. 아래끝만 방 안에 두면 판 두께(작은 창에서
/// 0.82칸)만큼 위로 삐져나가는데, 그 몫이 정확히 위층 방이다. `topSeatY` 가 nil(좌석 없는
/// 구역)인 경로도 같은 한계를 받는다 — 피할 말풍선이 없다고 해서 방을 벗어나도 되는 것은
/// 아니다.
public func officeZoneLabelBottomTiles(
    zone: DepartmentZone,
    topSeatY: Int?,
    tileSize: Double
) -> Double {
    // 판 위끝이 방을 넘지 않는 가장 높은 아래끝.
    let ceiling =
        Double(zone.origin.y + zone.height) - officeZoneLabelBoxTiles(tileSize: tileSize)
    let boundary = Double(zone.origin.y + zone.height - 1) + officeZoneLabelGapTiles
    guard let topSeatY else {
        return min(boundary, ceiling)
    }
    let aboveBubble =
        officeSeatedBubbleTopTiles(seatY: topSeatY, tileSize: tileSize)
        + officeZoneLabelGapTiles
    let above = max(boundary, aboveBubble)
    guard above > ceiling else {
        return above
    }
    return Double(zone.origin.y) + officeZoneLabelGapTiles
}

/// 상단 밴드(회의실·대표실·탕비실) 이름표 아래끝을 놓을 높이(격자 칸).
///
/// 밴드 안이라 좌석을 피할 필요가 없다고 보고 고정 높이를 썼는데, **아래 방의 말풍선이
/// 밴드까지 올라온다.** 최소 창에서는 말풍선이 두 줄로 접혀 더 높아지고, 밴드 이름표도
/// 부서 문패와 같이 오버레이라 겹치면 이기는 쪽이라 첫 좌석의 활동 문구 윗줄이 잘렸다
/// (`회의실` 이 `#2999` 를 덮었다).
///
/// `topSeatYBelow` 는 이 방 바로 아래에서 x 가 겹치는 부서 구역의 첫 좌석 행이다. 없으면
/// (아래가 복도뿐이면) 원래 자리를 그대로 쓴다.
public func officeCommonAreaLabelBottomTiles(
    area: CommonArea,
    topSeatYBelow: Int?,
    tileSize: Double
) -> Double {
    let base = Double(area.labelY) + officeCommonAreaLabelGapTiles
    guard let topSeatYBelow else {
        return base
    }
    return max(
        base,
        officeSeatedBubbleTopTiles(seatY: topSeatYBelow, tileSize: tileSize)
            + officeZoneLabelGapTiles
    )
}

/// 밴드 이름표를 그 줄 바닥에서 띄우는 몫(칸).
public let officeCommonAreaLabelGapTiles: Double = 0.2

/// 구역 안에서 가장 위쪽 좌석의 y. 문패를 그 위로 올리기 위한 기준이다.
public func officeTopSeatY(zone: DepartmentZone, desks: [DeskAssignment]) -> Int? {
    desks
        .map(\.seat)
        .filter { officeZoneContains(zone, $0) }
        .map(\.y)
        .max()
}

/// 바닥·벽 타일 종류. 스프라이트 파일명(tile-*.png)과 1:1.
public enum FloorTile: String, Codable, Sendable, CaseIterable {
    case woodA
    case woodB
    case carpetLight
    case carpetDark
    case ceramic
    /// 방 밖의 통로 — 그리고 **격자의 기본값**. 방·밴드·벽이 덮지 않은 칸이 여기 남는다.
    ///
    /// 기본값은 예전에 `woodA` 였다. 통로 색을 정한 것이 아니라 "안 덮인 자리" 였고, 마침 그
    /// 값이 리뷰 부서의 바닥재여서 칠하기가 빠진 칸이 생기면 리뷰방 바닥으로 위장했다.
    ///
    /// 지금 평면도는 모든 칸을 명시적으로 칠하므로 이 값이 화면에 나오지 않는다(회귀 테스트가
    /// 0을 확인한다). 그래도 전용 종류로 두는 이유는 **누락 감지**다 — 나중에 구역 높이를
    /// 줄이거나 방 사이를 벌려 덮이지 않은 칸이 생기면, 방과 확실히 다른 어두운 바닥으로
    /// 나타나 화면에서 바로 보인다. 값이 우연이 아니라 결정이어야 하는 이유가 여기 있다.
    case corridor
    case wall

    /// 바닥을 배경으로 물릴 때 어두운 색을 섞는 정도(0~1).
    ///
    /// 원본 텍스처는 대비가 강해 40픽셀 타일로 깔면 화면이 지글거리고, 사람과 가구를
    /// 찾으려면 그 노이즈를 헤쳐야 한다. 원본 밝기가 타일마다 크게 달라 같은 값으로 누르면
    /// 방마다 조명이 다른 것처럼 보인다 — 실측(화면 픽셀 밝기 0~255)으로 값을 맞췄다:
    /// 세라믹 139 · 밝은 카펫 103 · 우드 78 이었고, 세라믹 방만 조명을 켠 듯 튀었다.
    /// 부서 구분이 죽지 않게 밝기를 완전히 같게 만들지는 않고 계조만 좁힌다.
    public var muteStrength: Double {
        switch self {
        case .ceramic:
            return 0.68
        case .carpetLight:
            return 0.54
        case .woodA:
            return 0.56
        case .woodB:
            return 0.60
        // 통로는 **모든 방보다 밝다.** 전용 텍스처가 없어(다섯 텍스처가 여섯 방에 이미 쓰인다)
        // 세라믹을 재사용하므로, 겹치지 않는 축은 밝기뿐이다. 거의 누르지 않아 화면에서 가장
        // 밝은 면이 되게 한다 — 어느 방과도 혼동되지 않는 유일한 자리다.
        //
        // 한때 0.78 이었다. "방보다 확실히 어둡게" 를 노린 값인데, 그때는 복도가 화면에 한 칸도
        // 없어서(모든 칸을 방·밴드·벽이 덮었다) **실제로 어떻게 보이는지 확인된 적이 없었다.**
        // 복도를 실제로 낸 뒤 렌더 픽셀을 재 보니 밝기 26.9 로 벽(87.0)의 3분의 1, 바깥벽
        // (33.4)보다도 어두워 통로가 아니라 바닥에 뚫린 구멍으로 읽혔다.
        //
        // 방향을 뒤집은 근거는 **복도에 사람이 지나간다**는 것이다. 누가 어디로 가는지가 이
        // 화면의 핵심 정보인데, 배경이 사람보다 어두우면 지나가는 사람이 실루엣이 되어 셔츠의
        // 부서 색이 죽는다. 실제 사무실 복도가 방보다 밝은 것도 같은 이유다.
        //
        // 다만 위로 끝까지 밀면 안 된다. 0.30(밝기 184) 에서는 셔츠(실측 185.7)와 밝기가 겹쳐
        // 같은 문제가 반대편에서 되돌아왔다. 복도는 **방과 사람 사이**에 있어야 한다 —
        // 0.43 → 밝기 약 160 으로, 가장 밝은 방(세라믹 115)과 45, 셔츠와 25 만큼 떨어진다.
        //
        // **다른 타일의 이 값과 비교해서 밝기 순서를 추론하면 안 된다.** 원본 텍스처 밝기가
        // 종류마다 달라(우드 계열이 카펫보다 훨씬 어둡다) 누르는 양의 순서가 결과 밝기의
        // 순서와 다르다. 실제로 어두운 카펫은 이 값이 0.40 으로 복도보다 작은데 화면 밝기는
        // 66 대 160 이다. 밝기 판정은 `--render` 픽셀 실측으로만 한다.
        case .corridor:
            return 0.43
        case .carpetDark, .wall:
            return 0.40
        }
    }

    /// 부서 방의 바닥으로 쓸 수 있는 종류인가. 통로·벽은 방 바닥이 될 수 없다.
    ///
    /// 통로가 어느 부서 바닥재와도 겹치지 않는 것이 이 구분의 존재 이유다(회귀 테스트가 잡는다).
    public var isRoomFloor: Bool {
        switch self {
        case .corridor, .wall:
            return false
        default:
            return true
        }
    }
}

/// 가구 종류. 스프라이트 파일명(furn-*.png)과 1:1.
public enum FurnitureKind: String, Codable, Sendable, CaseIterable {
    case desk
    case chairDown
    case chairUp
    case meetingTable
    case sofa2
    case sofa3
    case coffeeTable
    case coffeeMachine
    case waterCooler
    case whiteboard
    case printer
    case plantTall
    case plantSmall
    case bookshelf
    case clock
    case trash
    // 벽걸이 10종. 방마다 성격이 다른 벽면을 만든다 — 전부 `isWallMounted`.
    case wallLandscape
    case wallAbstract
    case wallCalendar
    case wallCertificate
    case wallPinboard
    case wallWhiteboard
    case wallShelf
    case wallMonitor
    case wallPoster
    case wallPlantHanging
    // 문·수납 5종. 바닥에 놓는다.
    case doorClosed
    case doorOpen
    case filingCabinet
    case lockers2
    case partitionLow
    // 설비 4종. 에셋은 진작 만들어져 있었는데 배치 코드가 없어 화면에 한 번도 안 나왔다 —
    // 시트 등록(`build-sprites.py`)만 하고 여기까지 오지 않으면 조용히 빠진다.
    case vendingMachine
    case refrigerator
    case sinkCounter
    case partitionGlass
    // 바닥 깔개 3종(2×2칸). 응접·라운지 성격의 방에만 깔아 "앉아서 이야기하는 자리" 를 만든다.
    case rugGreen
    case rugBeige
    case rugNavy

    /// 이 가구가 차지하는 타일 크기. 통로 계산(walkable)과 렌더 크기의 공통 기준.
    public var footprint: (width: Int, height: Int) {
        switch self {
        case .meetingTable:
            return (1, 2)
        case .rugGreen, .rugBeige, .rugNavy:
            return (2, 2)
        // 3인 소파는 두 칸이다. 실물 200cm 는 한 칸(126cm)에 들어가지 않아, 한 칸으로 두면
        // 폭 상한(1.15칸)이 높이 환산을 눌러 **2인 소파까지 함께 작아진다**(둘이 배율 계산을
        // 공유했다). 두 칸을 주면 상한에 걸리지 않아 둘 다 목표 높이 80cm 를 채운다.
        case .sofa3:
            return (2, 1)
        case .whiteboard, .bookshelf:
            return (1, 1)
        default:
            return (1, 1)
        }
    }

    /// 바닥에 까는 깔개인가. 가구가 아니라 **바닥 장식**이라 다르게 다뤄야 한다.
    ///
    /// 두 가지가 걸린다 — 밟고 지나갈 수 있어야 하고(`isWalkThrough`), 다른 가구와 사람보다
    /// **뒤에** 그려져야 한다. 앞뒤 순서는 y 좌표로 정하는데(아래쪽이 앞) 깔개는 자기보다
    /// 위 칸에 놓인 소파까지 덮어 버리므로, 렌더가 깔개만 바닥 레이어로 내려보낸다.
    public var isFloorDecor: Bool {
        switch self {
        case .rugGreen, .rugBeige, .rugNavy:
            return true
        default:
            return false
        }
    }

    /// 벽에 거는 물건인가. 바닥 자리가 아니라 **벽 칸**에 걸어야 한다.
    ///
    /// 상단 밴드는 처음부터 벽 줄(`wallHangY`)에 명시적으로 걸었는데, 부서 방 배치에는 그
    /// 개념 자체가 없어 일반 바닥 후보(`departmentFurnitureSpots`)를 그대로 썼다. 개발실
    /// 시계가 카펫 한가운데 떠 있고 리뷰실 화이트보드가 바닥에 누워 있던 원인이다 —
    /// "벽에 붙는 것이라 바닥을 막지 않는다" 는 판정만 있고 **어디에 붙는지** 가 없었다.
    /// 배치 루프가 이 값을 보고 바닥 후보와 벽 후보를 갈라 쓴다.
    ///
    /// **이동식 화이트보드(`whiteboard`)는 여기 들어오지 않는다.** 한때 벽걸이였는데, 재제작본이
    /// 스탠드와 바퀴까지 담은 그림(55×56)이라 벽에 걸 수 있는 물건이 아니다. 그대로 두었더니
    /// 벽 줄에 걸린 채 세로로 자라 **화면 위쪽 바깥벽을 뚫고 잘렸다.** 벽에 거는 판은
    /// `wallWhiteboard`(39×24) 가 따로 있다.
    public var isWallMounted: Bool {
        switch self {
        case .clock:
            return true
        case .wallLandscape, .wallAbstract, .wallCalendar, .wallCertificate, .wallPinboard,
            .wallWhiteboard, .wallShelf, .wallMonitor, .wallPoster, .wallPlantHanging:
            return true
        default:
            return false
        }
    }

    /// 벽에 낸 구멍에 세우는 문인가.
    ///
    /// 문 칸에는 두 규칙이 함께 걸린다 — **통행은 열어 두고**(`isWalkThrough`) **사람은
    /// 머물지 않는다**(`officeStrollSpots`). 방의 유일한 출입구라, 막으면 그 방이 고립되고
    /// 누가 서 있으면 드나드는 사람이 그 사람을 통과해 지나가는 그림이 된다.
    public var isDoorway: Bool {
        switch self {
        case .doorClosed, .doorOpen:
            return true
        default:
            return false
        }
    }

    /// 사람이 통과할 수 있는가. 벽에 걸린 물건은 바닥을 막지 않는다.
    ///
    /// **문은 벽걸이가 아닌데도 관통한다.** 문은 벽에 뚫린 구멍 위에 서 있는 바닥 가구이고,
    /// 그 구멍이 방의 유일한 출입구다 — 막으면 그 방 전원이 고립된다(도달성 테스트가 잡는다).
    /// 두 값이 같은 집합이던 시절의 위임(`isWalkThrough = isWallMounted`)을 여기서 갈랐다.
    public var isWalkThrough: Bool {
        isDoorway || isWallMounted || isFloorDecor
    }

    /// 자기 자리인 책상·의자와 사람이 찾을 이유가 없는 시계·쓰레기통을 목적지에서 뺀다.
    public var strollDwellSeconds: Double? {
        switch self {
        case .coffeeMachine:
            return 4
        case .waterCooler:
            return 3
        case .printer:
            return 3
        case .sofa2, .sofa3:
            return 8
        case .coffeeTable:
            return 5
        case .meetingTable:
            return 5
        case .whiteboard:
            return 4
        case .bookshelf:
            return 4
        case .plantTall, .plantSmall:
            return 2
        // 벽걸이 중 **읽을 것이 있는 것만** 목적지다. 게시판·선반·설계 화이트보드·지표 모니터는
        // 사람이 앞에 서서 볼 이유가 있고, 액자·포스터·달력·상장·행잉플랜트는 배경이다.
        case .wallPinboard, .wallWhiteboard:
            return 4
        case .wallShelf, .wallMonitor:
            return 3
        // 서류를 꺼내러·짐을 넣으러 간다.
        case .filingCabinet, .lockers2:
            return 3
        // 설비 — 음료를 뽑고 물을 받으러 간다. 파티션은 서 있을 이유가 없다.
        case .vendingMachine:
            return 4
        case .refrigerator, .sinkCounter:
            return 3
        // **문은 목적지가 될 수 없다.** 아래 구역의 유일한 출입구라, 누가 문 앞에 4초 서 있으면
        // 그동안 그 방을 드나드는 사람이 전부 막힌다.
        case .desk, .chairDown, .chairUp, .clock, .trash,
            .wallLandscape, .wallAbstract, .wallCalendar, .wallCertificate, .wallPoster,
            .wallPlantHanging, .doorClosed, .doorOpen, .partitionLow, .partitionGlass,
            .rugGreen, .rugBeige, .rugNavy:
            return nil
        }
    }

    /// 머무름이 있는 가구만 자세를 가진다. 두 switch를 나란히 둬 새 종류 추가 시 함께 검토한다.
    public var interactionPose: OfficeInteractionPose? {
        switch self {
        case .sofa2, .sofa3, .coffeeTable, .meetingTable:
            return .sitting
        case .coffeeMachine, .waterCooler, .vendingMachine, .refrigerator, .sinkCounter:
            return .drinking
        case .printer, .filingCabinet:
            return .carryingPapers
        case .whiteboard, .wallWhiteboard:
            return .writing
        case .bookshelf, .wallShelf, .wallMonitor, .wallPinboard:
            return .reading
        case .plantTall, .plantSmall:
            return .tending
        case .lockers2:
            return .stowing
        case .desk, .chairDown, .chairUp, .clock, .trash,
            .wallLandscape, .wallAbstract, .wallCalendar, .wallCertificate, .wallPoster,
            .wallPlantHanging, .doorClosed, .doorOpen, .partitionLow, .partitionGlass,
            .rugGreen, .rugBeige, .rugNavy:
            return nil
        }
    }

    /// 스프라이트 원본 크기(실측 px). `sips -g pixelWidth -g pixelHeight Resources/sprites/furn-*.png`
    ///
    /// 에셋을 다시 뽑으면 이 값도 함께 갱신해야 한다 — 어긋나면 배율이 조용히 틀어진다.
    /// ConsoleCore 는 SpriteKit 비의존이라 이미지를 읽어 자동 검증할 수 없다.
    public var nativeSize: (width: Double, height: Double) {
        switch self {
        case .desk:
            // 위에서 내려다본 재제작본(furniture-desk-top). 정면도였을 때는 모니터 화면이
            // 화면 앞쪽을 봤는데 앉은 사람도 앞쪽을 봐서, 서른두 좌석 전부가 모니터 뒷판을
            // 마주하고 있었다. 도트 격자가 촘촘해 원본이 세 배 크다 — 배율 환산이 그만큼
            // 작아지므로 화면에 그려지는 크기는 그대로다.
            return (108, 99)
        case .chairDown:
            return (16, 26)
        case .chairUp:
            return (17, 24)
        case .meetingTable:
            // 재제작본(furniture-4). 의자 여덟 개를 함께 그려 두어 그 자리가 늘 빈 채였다 —
            // 이제 상판만 있고 사람이 둘레에 실제로 앉는다.
            return (27, 62)
        case .sofa2:
            return (30, 21)
        case .sofa3:
            // 재제작본. 39×21 로는 2인 소파(30×21)와 폭 차이가 30% 뿐이어서 화면에서
            // 구별되지 않았다. 실물 비(200:80 = 2.5)에 맞춰 다시 뽑았다.
            return (49, 20)
        case .coffeeTable:
            // 재제작본. 유리 원형 테이블(18×17)이 40픽셀 칸에서 파란 원반이 되어 물웅덩이로
            // 읽혔다. 낮고 넓은 나무 상판으로 바꿨다 — 폭 오차 −40% → −5%.
            return (27, 16)
        case .coffeeMachine:
            return (27, 31)
        case .waterCooler:
            return (12, 30)
        case .whiteboard:
            // 재제작본(furniture-3). 39×22 로 납작하던 것을 스탠드까지 담은 정사각형에 가깝게
            // 다시 뽑았다 — 폭 상한에 걸려 목표의 70% 에서 멈추던 것이 100% 로 올라간다.
            return (55, 56)
        case .printer:
            // 재제작본. 24×28 은 거의 정사각형이라 높이를 맞추면 폭이 실물의 1.7배가 되어
            // 탁상 프린터가 복사기 크기로 부풀었다.
            return (13, 31)
        case .plantTall:
            // 재제작본. 세로로 늘려 화분 비율을 되찾았다(폭 +41% → −3%).
            return (17, 44)
        case .plantSmall:
            return (17, 20)
        case .bookshelf:
            // 재제작본. 37×35(거의 정사각형)에서 세로로 늘려 3단 책장 비율을 되찾았다.
            return (37, 59)
        case .clock:
            return (20, 19)
        case .trash:
            return (13, 17)
        case .wallLandscape:
            return (20, 16)
        case .wallAbstract:
            return (14, 18)
        case .wallCalendar:
            return (16, 18)
        case .wallCertificate:
            return (16, 16)
        case .wallPinboard:
            return (36, 24)
        case .wallWhiteboard:
            return (39, 24)
        case .wallShelf:
            return (34, 22)
        case .wallMonitor:
            return (30, 22)
        case .wallPoster:
            return (22, 32)
        case .wallPlantHanging:
            return (18, 30)
        case .doorClosed, .doorOpen:
            // 재제작본. 40×45(폭:높이 1:1.13)라 실물 문 비율(1:2)과 어긋나 사람보다 낮게
            // 그려졌다 — 이제 1:1.83 이라 환산이 폭 상한에 걸리지 않고 1.59칸까지 선다.
            //
            // **열린 문 원본은 세로 67 로 3도트 더 높다.** 렌더는 실제 텍스처 크기를 쓰므로
            // (`OfficeScene` 의 `texture.size()`) 문이 열릴 때 5% 커진다. 배율 계산에 쓰는
            // 이 값은 닫힌 문 기준 하나로 둔다 — 두 값을 따로 두면 열림·닫힘이 서로 다른
            // 배율을 받아 차이가 오히려 커진다.
            return (35, 64)
        case .filingCabinet:
            // 재제작본. 30×34 는 3단 서랍장인데 거의 정사각형이라 폭이 실물의 2.1배였다.
            return (10, 31)
        case .lockers2:
            // 재제작본. 30×35 는 2연 사물함인데 폭이 실물의 2.4배로, 벽 하나를 통째로 먹었다.
            return (17, 47)
        case .partitionLow:
            return (40, 25)
        case .vendingMachine:
            // 재제작본. 폭 +50% → +9%.
            return (24, 44)
        case .refrigerator:
            // 재제작본. 요청은 소형 1문이었는데 2문 대형으로 그려져 왔다 — 세로가 길어진
            // 만큼 `targetHeightCm` 도 함께 올렸다(85 → 120). 그림과 목표 높이 중 한쪽만
            // 바꾸면 배율이 어긋나 폭이 실물의 3분의 2로 눌린다.
            return (14, 34)
        case .sinkCounter:
            return (40, 30)
        case .partitionGlass:
            return (40, 25)
        case .rugGreen, .rugBeige, .rugNavy:
            return (80, 80)
        }
    }

    /// 원본 세로 픽셀. 높이 환산의 분모다.
    public var nativeHeight: Double {
        nativeSize.height
    }

    /// 실물 높이(cm). 이 값으로 배율을 환산한다. nil 이면 환산하지 않는다.
    ///
    /// **한때 벽걸이 10종과 시계·화이트보드·문이 전부 nil 이었다.** "정면 그림이라 세로 픽셀이
    /// 높이가 아니다" 라는 이유였는데, 벽에 걸린 정면도야말로 세로 픽셀이 곧 높이다 — 성립하지
    /// 않는 것은 위에서 내려다본 회의 테이블뿐이다(세로가 깊이라서). 예외로 빼 둔 결과 그 13종만
    /// 원본 픽셀로 남아 자기들끼리도 축척이 어긋났다: 실측 cm/px 이 액자·포스터류는 2.5 로 고른데
    /// **시계만 1.58(2배 크게), 화이트보드는 5.0(40% 작게)** 이었다. 기준(캐릭터 54px = 170cm)은
    /// 3.15 cm/px 이므로 액자류도 21% 크다.
    ///
    /// 그래서 회의 테이블만 남기고 전부 환산 안으로 넣는다. 예외가 적을수록 다음에 에셋을
    /// 늘렸을 때 조용히 어긋나는 자리도 줄어든다.
    public var targetHeightCm: Double? {
        switch self {
        case .desk:
            return 112  // 책상 상판 + 모니터
        case .chairDown, .chairUp:
            return 85  // 등받이까지
        case .sofa2, .sofa3:
            return 80
        case .coffeeTable:
            return 45
        case .coffeeMachine:
            return 95  // 캐비닛형
        case .waterCooler:
            return 100
        case .printer:
            return 100
        case .plantTall:
            return 150
        case .plantSmall:
            return 45
        case .bookshelf:
            return 150  // 3단
        case .trash:
            return 55
        case .filingCabinet:
            return 105  // 3단 서랍
        case .lockers2:
            return 180
        case .partitionLow:
            // 낮은 파티션. 폭이 이미 1칸(40px)이라 상한에 먼저 걸려 목표를 다 채우지 못한다.
            return 120
        // --- 벽에 거는 것들. 벽면 정면도라 세로 픽셀이 그대로 높이다. ---
        case .clock:
            // 사무실 벽시계 지름. 실물 표준은 30cm 인데 40 을 쓴다 — 30 이면 9.5px(타일의 1/4)라
            // 문자판이 뭉개져 시계로 안 읽힌다. 가독 하한을 값으로 흡수한 자리다.
            return 40
        case .whiteboard, .wallWhiteboard:
            // 보드 판 높이(스탠드 제외). 폭이 39px 라 상한에 걸려 목표의 70% 선에서 멈춘다 —
            // 에셋이 39×22 로 가로로 납작해서다(재제작 목록).
            return 120
        case .wallPinboard:
            return 90
        case .wallPoster:
            return 84  // A1 세로
        case .wallPlantHanging:
            return 75
        case .wallMonitor:
            return 55  // 32인치 세로
        case .wallShelf:
            return 50
        case .wallAbstract, .wallCalendar:
            return 45
        case .wallLandscape, .wallCertificate:
            return 40
        case .doorClosed, .doorOpen:
            // 문틀까지 포함한 정면도. 200cm 면 배율 1.41 이지만 폭 상한에 걸려 1.29칸까지만
            // 큰다 — 여전히 사람(1.35칸)보다 낮다. 에셋이 40×45 로 실제 문 비율(1:2)과
            // 다른 것이 원인이라 배율로는 여기까지다(재제작 목록).
            return 200
        case .vendingMachine:
            return 180
        case .refrigerator:
            // 슬림 2문. 재제작본 그림이 2문 대형이라 소형(85)으로 두면 폭이 35cm 로 눌려
            // 냉장고로 안 읽힌다. 그렇다고 대형(170)으로 올리면 1.35칸이 되어 탕비실 창을
            // 덮으므로(자판기를 운영실로 보낸 것과 같은 이유) 0.95칸에서 멈추는 값을 쓴다.
            return 120
        case .sinkCounter:
            return 90  // 카운터 높이
        case .partitionGlass:
            // 낮은 파티션과 같은 40×25 에셋이라 같은 높이로 본다. 유리라 더 높아 보이지만
            // 그림이 그만큼 크지 않으므로 값을 올리면 폭만 넘치고 높이는 상한에 걸린다.
            return 120
        // 위에서 내려다본 테이블과 바닥 깔개는 환산이 성립하지 않는다 — 세로 픽셀이 높이가
        // 아니라 깊이(원근)이거나, 애초에 높이가 없다.
        case .meetingTable, .rugGreen, .rugBeige, .rugNavy:
            return nil
        }
    }

    /// 렌더 배율 보정. 가구 높이를 캐릭터 키(170cm 기준) 축척에 맞춘다.
    ///
    /// 한때 "책상·회의 테이블·소파만 1.15배" 였다. 실측해 보니 가구마다 축척이 달랐다 —
    /// 정수기만 94% 로 맞고 책상 90%, 소파 83%, 3단 책장은 **73%** 였다. 책장이 사람 키의
    /// 65% 라 150cm 책장이 아니라 허리 높이 수납장으로 읽혔는데, 일괄 보정에서는 빠져 있었다.
    /// 그래서 종류별로 환산한다. 되돌아가면 같은 편차가 다시 생긴다.
    ///
    /// 환산 대상이 아닌 회의 테이블만 기존 확대값을 잇는다 — 2칸(footprint)을 차지하는데
    /// 원본이 1.4칸이라 칸을 덜 채운다.
    ///
    /// **높이 환산값은 폭 상한에 걸려 깎일 수 있다.** 렌더는 배율을 가로·세로에 같이 곱하므로
    /// (`OfficeScene` 의 `node.size`) 높이만 보고 키우면 폭이 자기 칸을 넘어 옆 칸을 침범한다.
    /// 상한 자체는 `officeFurnitureWidthCapTiles` 가 정하고, 여기서는 그 값을 곱해 쓴다.
    ///
    /// 상한에 걸린 가구는 목표 높이를 다 채우지 못한다 — 화이트보드(70%)와 문(91%)이 그렇다.
    /// 원인은 에셋의 가로세로비가 실물과 다른 것(화이트보드 39×22 로 납작, 문 40×45 인데 실제
    /// 문은 1:2)이므로 배율로는 여기까지가 한계다. 해소는 에셋 재제작 몫이다.
    public var sizeBoost: Double {
        let byHeight: Double
        if let targetHeightCm {
            byHeight = targetHeightCm * officePixelsPerCentimeter / nativeHeight
        } else if self == .meetingTable {
            // 위에서 내려다본 테이블은 세로가 높이가 아니라 깊이라 cm 환산이 성립하지 않는다.
            // 대신 **자기 칸을 채우는 배율**을 쓴다 — 8인 테이블이 칸을 덜 채우면 4인용으로
            // 읽힌다. 한때 1.15 고정이었는데, 그 값은 옛 그림(37×56)이 폭 상한에 걸리는 것을
            // 피하려고 손으로 눌러 둔 것이라 그림을 다시 뽑으면 근거가 사라진다. 상한은
            // 아래 `widthCap` 이 이미 보고 있으므로 여기서 미리 눌러 둘 필요가 없다.
            byHeight =
                Double(footprint.height) * officeReferenceTileSize / nativeHeight
        } else {
            byHeight = 1.0
        }
        // 폭 상한은 **자기 그림만** 본다. 한때 2인·3인 소파가 이 계산을 공유했다 — 둘이
        // 나란히 놓이는데 배율이 갈리면 2인이 3인보다 높아 보인다는 이유였다. 그런데 그
        // 공유가 거꾸로 물었다: 3인 소파를 실물 비(200:80)로 다시 뽑자 폭 49px 이 한 칸
        // 상한에 걸려, **3인 때문에 2인까지 목표 높이의 78% 로 눌렸다.**
        //
        // 3인 소파에 두 칸을 주는 것(`footprint`)이 옳은 해법이었다. 실물 200cm 는 한 칸
        // (126cm)에 애초에 들어가지 않는다. 두 칸을 받으면 둘 다 상한에 걸리지 않고, 같은
        // 목표 높이(80cm)를 각자 채우므로 결과 높이도 저절로 같아진다 — 배율을 묶지 않아도
        // 원래 걱정했던 어긋남이 생기지 않는다.
        let widthCap =
            Double(footprint.width) * officeFurnitureWidthCapTiles * officeReferenceTileSize
            / nativeSize.width
        return min(byHeight, widthCap)
    }
}

/// 부서별 바닥재. 문패를 읽지 않아도 방이 구별되는 1차 신호다.
/// 개발·내부가 같은 어두운 카펫인 것은 의도 — 두 구역은 서로 맞닿지 않고,
/// 가구 세트(자료 벽 vs 설비)와 벽 색조로 갈린다.
public func departmentFloor(_ department: Department) -> FloorTile {
    switch department {
    case .planning:
        return .carpetLight
    case .engineering:
        return .carpetDark
    case .review:
        return .woodA
    case .executive:
        return .woodB
    case .growth:
        return .ceramic
    case .internalOps:
        return .carpetDark
    }
}

/// 벽 한 칸을 물들일 부서 색을 정한다(순수). 문패를 읽지 않아도 방이 구별되게 하는 보조 신호다.
///
/// 인접 구역이 벽 한 칸을 공유하므로 한 칸에 두 부서 색을 칠할 수 없다 — 구역 목록에서
/// 먼저 나오는 쪽(왼쪽·위 구역)을 쓴다. 밴드 위 바깥 벽처럼 어느 구역에도 속하지 않는
/// 칸은 nil 이고, 호출자는 부서 색 없이 기본 벽색만 쓴다.
public func wallDepartment(x: Int, y: Int, zones: [DepartmentZone]) -> Department? {
    zones.first { zone in
        x >= zone.origin.x && x < zone.origin.x + zone.width
            && y >= zone.origin.y && y < zone.origin.y + zone.height
    }?.department
}

/// 부서별 대표 가구(방의 성격). 에셋을 새로 만들지 않고 "어디에 무엇을 놓는지" 만 바꾼다.
///
/// **방마다 벽걸이를 세 종 둔다.** 예전에는 위 세 방(기획·개발·리뷰)만 시계나 화이트보드를
/// 들고 있어서, 창·등·시계가 전부 몰린 상단 밴드와 벽이 텅 빈 아래 세 방으로 화면이 갈렸다.
/// 벽걸이는 바닥 후보를 쓰지 않으므로(`isWallMounted`) 기존 바닥 배치와 경합하지 않는다.
///
/// **벽 자리는 방당 정확히 세 칸이다(`zoneWallMountSpots`).** 네 번째부터는 걸 자리가 없어
/// 조용히 버려지므로, 방마다 벽걸이가 셋을 넘지 않아야 한다.
///
/// 무엇을 거는지가 방의 성격을 말한다 — 리뷰방 게시판, 성장방 지표 모니터, 경영방 상장처럼
/// 문패를 읽지 않아도 무슨 일을 하는 방인지 벽이 먼저 알려주게.
public func departmentFurniture(_ department: Department) -> [FurnitureKind] {
    switch department {
    case .planning:
        // 모여서 논의하는 방 — 일정과 아이디어를 붙여 두는 벽.
        //
        // 세 명뿐이라 아래 절반이 통째로 빈 바닥이었다. 자료 선반과 큰 화분으로 방의 남은
        // 쪽을 쓰게 한다 — 자리를 늘리는 대신 가구로 채우는 이유는, 인원이 늘면 그 자리가
        // 다시 책상에 밀려나야 하기 때문이다(가구는 좌석에 막히면 알아서 건너뛴다).
        // 벽걸이가 둘뿐이라 세 자리 중 하나가 비어 있었다. 추상화 액자를 여기 건다 —
        // 운영 방의 벽을 지표 모니터로 바꾸면서 그 액자가 **어느 방에도 안 남았고**,
        // 그림은 있는데 화면에 한 번도 안 나오는 에셋이 될 뻔했다. 아이디어를 모으는 방이라
        // 성격도 맞는다.
        return [
            .meetingTable, .whiteboard, .plantSmall, .bookshelf, .plantTall,
            .wallPinboard, .wallCalendar, .wallAbstract,
        ]
    case .engineering:
        // 자료 벽을 세운 집중하는 방 — 설계를 그리는 벽과 기술서 선반.
        // 자료 벽 맨 아래 칸은 유리 파티션으로 막아 벽 줄을 아래까지 이어 준다
        // (자리 후보 순서상 책장 둘 다음이 오른쪽 끝 아래 칸이다).
        return [.bookshelf, .bookshelf, .partitionGlass, .clock, .wallWhiteboard, .wallShelf]
    case .review:
        // 검토하는 방 — 체크리스트 게시판과 자료 캐비닛.
        //
        // **판은 벽에 건다(`wallWhiteboard`).** 예전에는 이동식 보드(`whiteboard`)를 첫 후보
        // (3,4)에 놓아 방 한가운데에 바퀴 달린 판이 홀로 서 있었다 — 재제작본이 스탠드까지
        // 담은 그림이라 자리를 크게 먹는데, 정작 자료 캐비닛·책장이 뒤로 밀렸다.
        return [.bookshelf, .bookshelf, .filingCabinet, .wallWhiteboard, .wallPinboard, .wallPoster]
    case .executive:
        // 손님을 맞는 방 — 상장과 풍경화를 건 응접실.
        //
        // 둘뿐인 방이라 오른쪽 절반이 빈 나무 바닥이었다. 응접 세트 반대편에 서가와 자료
        // 캐비닛을 세워, 사람 수가 적은 것이 "덜 지은 방" 으로 보이지 않게 한다.
        return [
            .sofa2, .coffeeTable, .plantTall, .bookshelf, .filingCabinet, .plantSmall,
            .clock, .wallCertificate, .wallLandscape,
        ]
    case .growth:
        // 밝고 트인 방 — 지표 모니터를 걸고 자유석을 낮은 파티션으로만 나눈다.
        //
        // 판도 벽에 건다(리뷰방과 같은 이유). 이동식 보드는 후보 (7,1) 을 받아 **아래 줄
        // 책상 사이에 끼어** 있었다 — 자유석 사이를 나누는 것은 파티션의 몫이다.
        return [
            .plantTall, .plantSmall, .sofa2, .partitionLow,
            .wallWhiteboard, .wallMonitor, .wallPlantHanging,
        ]
    case .internalOps:
        // 설비가 모인 방 — 사물함과 비품 선반, 그리고 자판기.
        //
        // 자판기가 여기 있는 것은 탕비실에 자리가 없어서다. 탕비실 빈 칸은 전부 창 아래인데
        // 자판기는 1.43칸으로 벽 줄까지 올라와 창을 덮는다. 이 방은 창이 없다.
        // 벽에는 지표 화면을 건다(예전에는 추상화 액자였다). 이 방 사람들이 하는 일이
        // 운영 이상 징후 감시·상태 변화 판정이라, 액자는 장식일 뿐이고 볼 것이 없었다 —
        // 그래서 감시 담당이 자기 방을 지나쳐 성장방 모니터까지 걸어갔다
        // (`officeWorkAffinity`). 방 벽이 그 방의 일을 말하게 한다.
        return [
            .printer, .waterCooler, .trash, .lockers2, .vendingMachine,
            .clock, .wallShelf, .wallMonitor,
        ]
    }
}

/// 벽걸이를 걸 벽 칸(구역 원점 기준 상대). 위에서부터 쓴다.
///
/// **세로 벽 한 열만 쓴다(여기서는 상대 x = 0).** 아래 구역은 천장(y = zoneHeight - 1)도
/// 벽이라 정면 벽에 걸 수 있지만, 위 구역 천장은 밴드로 나가는 통로여서 벽이 아니다. 여섯 방이
/// 같은 규칙을 쓰려면 어느 구역에나 있는 세로 벽뿐이다 — 위·아래를 갈라 쓰면 규칙이 둘이 된다.
///
/// 어느 쪽 세로 벽을 쓸지는 배치 루프가 정한다(`wallMountColumn`) — 맨 왼쪽 열의 방은 왼쪽
/// 벽이 건물 바깥벽이라 오른쪽으로 옮겨 건다. 각 방이 자기 벽 하나만 쓰므로 이웃 방과 겹치지
/// 않는 성질은 그대로다.
/// 이 문이 열린 그림으로 보여야 하는가 — 사람이 그 칸에 있거나 바로 앞에 서 있으면 연다(순수).
///
/// 문을 **닫아 두는 것이 기본**이다. 한때 전부 열린 문을 놓았다. 사람이 지나다니는 유일한
/// 통로라 닫아 두면 문짝을 통과해 걸어 나오기 때문인데, 그 대가로 여섯 방의 문 열두 짝이
/// 항상 활짝 열린 채로 고정돼 사무실이 문을 안 닫고 사는 곳처럼 보였다.
///
/// 칸에 정확히 선 순간에만 열면 한 걸음(0.2초) 동안만 열려 눈에 남지 않는다. 상하좌우 한 칸을
/// 함께 보면 다가올 때 열리고 지나간 뒤 닫혀, 사람이 문을 밀고 드나드는 그림이 된다.
public func officeDoorIsOpen(door: TilePoint, occupied: Set<TilePoint>) -> Bool {
    if occupied.contains(door) {
        return true
    }
    return orthogonalNeighbors(of: door).contains { occupied.contains($0) }
}

/// 이 구역의 벽걸이를 걸 벽 열(격자 절대 x). 배치와 검증이 같은 값을 봐야 한다 —
/// 한쪽만 바꾸면 벽걸이는 옮겨졌는데 검사는 옛 자리를 훑어 "빠졌다" 고 잡는다.
///
/// 맨 왼쪽 열의 방(원점 x = 0)만 오른쪽 벽을 쓴다. 그 방들의 왼쪽 벽은 칸막이가 아니라
/// 격자 최외곽, 즉 건물 바깥벽이라 거기 건 액자는 사무실 밖에 걸린 그림이 된다.
public func officeWallMountColumn(zoneOriginX: Int) -> Int {
    zoneOriginX == 0 ? zoneOriginX + zoneWidth : zoneOriginX
}

private let zoneWallMountSpots: [TilePoint] = [
    TilePoint(x: 0, y: 4),
    TilePoint(x: 0, y: 2),
    TilePoint(x: 0, y: 0),
]

/// 부서 집기를 놓을 자리 후보(구역 원점 기준 상대). 앞에서부터 쓰고, 자리·다른 집기와
/// 겹치면 다음 후보로 넘어간다.
///
/// 자리 배치(`departmentDeskSpots`)와 짝이다 — 배치를 바꾸면 여기도 함께 봐야 한다.
/// 문 열(x = 8)은 아래 구역과 이어지는 세로 동선이라 후보에서 뺀다.
public func departmentFurnitureSpots(_ department: Department) -> [TilePoint] {
    func spots(_ pairs: [(Int, Int)]) -> [TilePoint] {
        pairs.map { TilePoint(x: $0.0, y: $0.1) }
    }
    switch department {
    case .planning:
        // 회의 테이블은 세 자리 바로 앞. 세로 2칸이라 (4,2)~(4,3) 을 차지한다.
        // 뒤 두 자리는 빈 아래쪽을 메우는 몫이다. **맨 아래 줄에만 더한다** — 아래 행 좌석
        // (책상 (1,1)·(7,1) 의 윗칸)에 사람이 앉으면 그 이름표가 y=3 언저리에 뜨므로,
        // 거기 가구를 세우면 인원이 늘었을 때 이름이 가구에 묻힌다.
        return spots([(4, 2), (9, 5), (9, 3), (9, 1), (1, 0), (3, 0), (6, 0)])
    case .engineering:
        // 2열 종대가 x=1·4·7 을 쓰므로 자료 벽은 오른쪽 끝에 세운다.
        return spots([(9, 5), (9, 3), (9, 1), (2, 0), (6, 0)])
    case .review:
        // 자리와 자리 사이를 책장으로 막아 부스처럼 나눈다.
        return spots([(3, 4), (7, 4), (5, 1), (9, 1), (1, 1)])
    case .executive:
        // 응접 세트를 방 가운데에 — 두 사람이 멀찍이 앉고 가운데서 손님을 맞는 모양.
        // 뒤 세 자리는 빈 오른쪽·아래를 메우는 몫이다. 좌석이 앉는 칸과 그 위(이름표가 뜨는
        // 높이)를 피해, 오른쪽 벽면과 맨 아래 줄에 붙인다.
        //
        // **커피테이블은 소파와 같은 줄 옆 칸(3,4)이다.** 자리 세 개를 함께 만족해야 한다 —
        // 소파 정면(4,3)은 앉는 자리라 비워 두고(앉는 자리는 가구 정면 칸뿐이다), 테이블은
        // 깔개 안에 있어야 하고, 소파와 관계가 보여야 한다.
        //
        // 두 가지를 먼저 시도했고 렌더에서 각각 어긋났다. 대각선 아래(3,3)는 소파는 깔개
        // 중앙, 테이블은 모서리로 흩어져 **둘이 아무 관계가 없었다.** 정면 한 칸 더 앞(4,2)은
        // 세로로 줄은 섰지만 깔개(2×2)가 세로 세 칸을 못 덮어 **테이블만 깔개 밖에** 남았다.
        //
        // 같은 줄 옆 칸이면 깔개 한 장이 소파·테이블·앉는 자리를 모두 담는다. 소파 옆에
        // 사이드 테이블이 놓인 응접 세트로 읽히고, 테이블 자신의 앉는 자리(3,3)도 깔개 안이다.
        return spots([(4, 4), (3, 4), (8, 1), (9, 4), (9, 1), (9, 2), (4, 1), (1, 0)])
    case .growth:
        // 어긋난 자리 사이를 화분·소파로 메워 자유석 느낌을 만든다.
        //
        // 후보가 넉넉한 것은 이 방의 바닥 가구가 다섯인데 **후보가 좌석·기존 가구에 막히면
        // 건너뛰기 때문**이다. 화이트보드가 벽걸이에서 바닥 가구로 바뀌면서 다섯 번째가 됐고,
        // 딱 다섯 자리로는 마지막 파티션이 자리를 못 받아 조용히 사라졌다.
        //
        // 자리가 여덟으로 늘면서 예전 후보 (3,4)·(9,1) 이 책상에 막혔다. 아래 행 책상
        // 사이사이(3·5·7, y=1)를 채우면 자리 하나 건너 가구 하나가 되어 칸막이가 자리를
        // 나누는 모양이 된다. (9,3) 은 맨 뒤다 — 오른쪽 끝 좌석의 이름표가 뜨는 높이라
        // 앞 후보가 다 막힌 경우에만 쓴다.
        return spots([(3, 4), (5, 1), (1, 1), (7, 1), (3, 1), (9, 5), (9, 3)])
    case .internalOps:
        // 10명이 x=1~9 를 다 쓰므로 설비는 맨 아래 줄로 내려간다.
        //
        // 예전 목록의 뒤 두 자리는 둘 다 못 쓰는 자리였다 — (8,0) 은 위 규칙이 금지한 문 열이고
        // (9,5) 는 (9,4) 책상의 좌석이라 배치 루프가 건너뛴다. 설비가 셋뿐이라 거기까지 커서가
        // 가지 않아 드러나지 않았을 뿐이다. 실제로 쓸 수 있는 양 끝 칸으로 바꾼다.
        return spots([(2, 0), (4, 0), (6, 0), (9, 0), (1, 0)])
    }
}

/// 배치된 가구 하나.
public struct FurniturePlacement: Equatable, Codable, Sendable {
    public let kind: FurnitureKind
    public let tile: TilePoint
    public init(kind: FurnitureKind, tile: TilePoint) {
        self.kind = kind
        self.tile = tile
    }
}

/// 에이전트 한 명의 자리 — 책상과 그 뒤에 앉는 칸.
public struct DeskAssignment: Equatable, Codable, Sendable {
    public let agentType: String
    public let desk: TilePoint
    /// 캐릭터가 앉는 칸(책상 바로 위). 탑다운이라 책상이 캐릭터 앞을 가린다.
    public let seat: TilePoint
    public init(agentType: String, desk: TilePoint, seat: TilePoint) {
        self.agentType = agentType
        self.desk = desk
        self.seat = seat
    }
}

/// 부서 구역(라벨·바닥색 용).
public struct DepartmentZone: Equatable, Codable, Sendable {
    public let department: Department
    public let origin: TilePoint
    public let width: Int
    public let height: Int
    public init(department: Department, origin: TilePoint, width: Int, height: Int) {
        self.department = department
        self.origin = origin
        self.width = width
        self.height = height
    }
}

/// 사무실 평면도 — 바닥·가구·자리·통로가 전부 타일 격자 위에 확정된 값.
/// 렌더(SpriteKit)와 이동(길찾기)이 같은 이 하나의 값을 본다.
public struct OfficeFloorPlan: Codable, Sendable {
    public let columns: Int
    public let rows: Int
    /// [row][column], row 0 = 최하단.
    public let floor: [[FloorTile]]
    public let furniture: [FurniturePlacement]
    public let desks: [DeskAssignment]
    /// 사람이 지나갈 수 있는 칸. 길찾기의 정의역.
    public let walkable: Set<TilePoint>
    /// 대표실 앞 줄서기 자리(승인 대기 순서대로).
    public let queueTiles: [TilePoint]
    /// 탕비실 휴식 자리(완료 후 잠깐 다녀오는 곳).
    public let loungeTiles: [TilePoint]
    public let presidentTile: TilePoint
    /// 출퇴근이 시작·끝나는 칸 — 세로 복도의 바닥벽 쪽 끝(대표실 밴드에서 가장 먼 자리).
    ///
    /// 도면 밖에는 아무 타일도 없다(사방이 벽으로 닫혀 있다). "화면 밖에서 걸어온다"가
    /// 성립하지 않으므로, 실제로 걸을 수 있는 칸 중 사무실 로비에 해당하는 이 자리를 대신 쓴다.
    /// 대표실 앞 승인 대기 줄(`queueTiles`)과 같은 가로 복도 줄에 두면 겹칠 수 있어(2열
    /// 배치에서 실제로 겹쳤다), 일부러 그 줄에서 가장 먼 반대쪽 끝을 쓴다.
    public let entranceTile: TilePoint
    public let zones: [DepartmentZone]
    /// 상단 공용 밴드의 세 구역(회의실·대표실·탕비실). 부서 구역과 달리 사람이 상주하지 않아
    /// 이름이 없으면 "가구만 놓인 빈 띠" 로 읽힌다 — 화면 위쪽 1/4 을 차지하는데도.
    public let commonAreas: [CommonArea]
    /// 바깥과 접한 벽에 낸 창문 칸. 시간대에 따라 유리 색이 바뀌고 아래로 빛이 떨어진다.
    public let windowTiles: [TilePoint]
    /// 벽등을 건 칸. 해가 낮은 시간대에만 켜진다.
    public let wallLampTiles: [TilePoint]
}

/// 공용 구역의 종류. 라벨 문자열로 구역을 찾으면 이름을 다듬는 순간 조용히 어긋난다.
public enum CommonAreaKind: String, Equatable, Codable, Sendable {
    case meeting
    case president
    case pantry
}

/// 상단 공용 밴드의 한 구역. 문패를 달기 위한 이름과 가로 범위.
public struct CommonArea: Equatable, Codable, Sendable {
    public let kind: CommonAreaKind
    public let label: String
    public let icon: String
    /// 시작 열과 폭(칸). 문패는 이 범위의 가운데에 놓인다.
    public let originX: Int
    public let width: Int
    /// 문패를 놓을 줄(격자 y). 밴드 안이라 부서 문패와 달리 좌석을 피할 필요가 없다.
    public let labelY: Int

    public init(
        kind: CommonAreaKind, label: String, icon: String, originX: Int, width: Int, labelY: Int
    ) {
        self.kind = kind
        self.label = label
        self.icon = icon
        self.originX = originX
        self.width = width
        self.labelY = labelY
    }
}

// 격자 규격 — 부서 구역 3열×2행 또는 2열×3행 + 상단 공용 밴드.
//
// 구역 하나는 "왼쪽 벽 1칸 + 내부 9칸 + 오른쪽 벽 1칸" 이고, 구역과 구역 사이에 복도 한 열이
// 지나간다. 그래서 원점 간 거리(`zoneStride`)가 구역 폭보다 두 칸 넓다.
//
// 한때 인접 구역이 벽 한 칸을 **공유**했다(원점 간 거리 = 10). 벽을 따로 세우면 맞닿는 자리가
// 2칸짜리 회색 띠가 되기 때문인데, 그 대가로 방끼리 문 하나를 두고 바로 붙어 복도가 설 자리가
// 없었다. 실제로 왼쪽 아래 방에서 오른쪽 아래 방까지 가려면 다른 방 넷을 관통해야 했다.
// 지금은 벽 사이를 복도로 벌려, 회색 띠 대신 사람이 지나다니는 통로가 들어간다.
private let zoneWidth = 10
private let zoneHeight = 7
// 통로 1줄 + 가구 2줄 + 바깥벽 2줄. 벽을 두 줄로 세우면서 4 에서 늘렸다.
private let bandHeight = 5

/// 구역 원점 사이 거리 — 구역 폭(벽 포함 11칸)에서 마지막 벽이 다음 구역과 겹치지 않게
/// 한 칸, 그 사이 복도로 한 칸을 더 쓴다.
private let zoneStride = zoneWidth + 2

/// 세로 복도 열(격자 절대 좌표). 구역 사이를 남북으로 관통해 가로 복도와 만난다.
///
/// **줄이 아니라 열로 낸 이유는 타일 크기다.** 화면에 맞추는 배율이
/// `min(창너비 / 열, 창높이 / 줄)` 이다. 가로 창에서는 3열×2행이, 세로 창에서는 2열×3행이
/// 더 큰 타일을 만든다. 어느 쪽이든 남북 복도는 구역 사이 열을 쓰고, 동서 복도는 줄을
/// 늘리는 대신 밴드 맨 아래 줄(`officeCorridorRow(zoneColumns:)`)을 전환해 쓴다.
public func officeCorridorColumns(zoneColumns: Int) -> [Int] {
    precondition(zoneColumns == 2 || zoneColumns == 3)
    return (0..<(zoneColumns - 1)).map { zoneStride * $0 + zoneWidth + 1 }
}

/// 격자 맨 아래 벽 줄의 두께. 아래 구역은 여기서부터 시작한다.
///
/// **한때 없었다.** 좌·우·위는 바깥벽으로 닫혀 있는데 아래만 열려 있어, 사무실이 화면 아래로
/// 뚫린 모양이었다. 그 줄에 놓인 운영실 설비(프린터·정수기·쓰레기통·사물함)가 등을 댈 벽 없이
/// 허공에서 끝나 바닥 한가운데 놓인 것처럼 보인 원인이다.
///
/// 위쪽 바깥벽(`officeOuterWallRows` = 2)과 달리 한 줄인 것은 여기에 물건을 걸지 않기
/// 때문이다 — 두 줄이 필요했던 이유가 "벽에 건 물건이 바닥에 놓인 것처럼 보인다" 였다.
public let officeFloorWallRows = 1

/// 가로 복도 줄. 밴드 맨 아래 줄이자 부서 구역 바로 위 줄이다.
///
/// 원래도 이 줄만 비워 가로 이동에 썼지만 방 바닥재로 칠해져 있어 통로로 읽히지 않았다.
public func officeCorridorRow(zoneColumns: Int) -> Int {
    officePlanSize(zoneColumns: zoneColumns).rows - bandHeight
}

public func officePlanSize(zoneColumns: Int) -> (columns: Int, rows: Int) {
    precondition(zoneColumns == 2 || zoneColumns == 3)
    let zoneRows = (zoneOrder.count + zoneColumns - 1) / zoneColumns
    return (
        columns: zoneStride * (zoneColumns - 1) + zoneWidth + 1,
        rows: zoneHeight * zoneRows + bandHeight + officeFloorWallRows
    )
}

/// 현재 창에서 더 큰 타일을 만드는 부서 열 수. 직전 배치가 있으면 반대쪽이 5% 이상 커질
/// 때만 바꿔, 리사이즈 경계에서 두 도면이 번갈아 재구성되는 떨림을 막는다.
public func officeZoneColumns(
    width: Double, height: Double, currentZoneColumns: Int? = nil
) -> Int {
    guard width > 0, height > 0 else {
        return currentZoneColumns ?? 3
    }
    func tileSize(_ zoneColumns: Int) -> Double {
        let planSize = officePlanSize(zoneColumns: zoneColumns)
        return min(width / Double(planSize.columns), height / Double(planSize.rows))
    }

    let twoColumnSize = tileSize(2)
    let threeColumnSize = tileSize(3)
    guard let currentZoneColumns else {
        return twoColumnSize > threeColumnSize ? 2 : 3
    }
    precondition(currentZoneColumns == 2 || currentZoneColumns == 3)
    let candidate = currentZoneColumns == 2 ? 3 : 2
    return tileSize(candidate) >= tileSize(currentZoneColumns) * 1.05
        ? candidate : currentZoneColumns
}

/// 바깥벽(격자 맨 위) 두께. 아래 칸이 벽면, 위 칸이 벽 윗면이 되어 높이감을 만든다.
/// 창을 세로로 몇 칸에 걸쳐 그릴지 렌더 쪽이 같은 값을 봐야 한다.
public let officeOuterWallRows = 2
private let outerWallRows = officeOuterWallRows

// 부서별 자리 배치를 다 쓴 뒤의 예비 격자 — 5열 × 2행 = 10석.
// 에이전트가 늘어 부서 배치표를 넘겼을 때 사람이 화면에서 사라지지 않게 하는 안전망이다.
private let deskColumns = 5
private let deskColumnStride = 2

/// 예비 격자(구역 상대 좌표). 부서 배치표를 다 쓴 뒤 이어서 채운다.
///
/// **행 간격은 아래 배치표와 같은 3 칸이다.** 예전에는 여기만 2 여서, 배치표를 넘긴 사람이
/// 바로 아래 주석이 금지한 배치로 앉았다 — 성장 부서가 5석 배치표에 8명이 되자 넘친 셋이
/// y = 2 · 1 에 앉아, 이름표가 위 행 책상과 아래 사람 얼굴을 덮었다. 안전망이 규칙을
/// 비껴가면 규칙을 지키는 쪽이 오히려 예외가 된다.
///
/// 방 하나에 들어가는 자리는 이 격자가 상한이다(간격 3 이면 y = 4 · 1 두 행뿐). 11명째가
/// 생기면 배정에서 밀려나 `officeFloorPlan` 의 전원 배정 테스트가 깨진다 — 겹쳐 그려
/// 못 읽게 두는 것보다, 방 배치를 손볼 때가 됐다고 알리는 편이 낫다.
private let fallbackDeskSpots: [TilePoint] = (0..<10).map { index in
    TilePoint(
        x: 1 + (index % deskColumns) * deskColumnStride,
        y: zoneHeight - 3 - (index / deskColumns) * 3
    )
}

// 한 부서 구역에서 자리로 쓸 수 있는 범위 — 구역 원점 기준 상대 좌표.
//
//   x: 1~9 (0 과 10 은 좌우 벽). 다만 x=8 은 아래 구역 문과 이어지는 세로 동선이라
//      막으면 아래 구역 전원이 고립된다. y=0 줄과 x=9 열은 부서 집기 자리다.
//   y: 0~5 (6 은 천장 벽). 좌석은 책상 **바로 위 칸**이므로 책상 y 는 최대 4.
//
// **행 간격은 3 칸을 유지한다(책상 y = 1 과 4).** 예전 3행 배치는 간격이 2 여서, 아래 행
// 사람의 이름표가 위 행 책상 위에 얹혀 글자가 나뭇결에 묻혔다 — 사진에서 내부 부서의
// "윤문"·"이슈 분류" 가 그렇게 읽히지 않았다. 간격 3 이면 이름표(좌석 위 약 1.5~1.8칸)가
// 위 행 책상(1.1칸 높이)에 닿지 않는다.

/// 구역 안에서 문과 이어지는 세로 동선 열(구역 원점 기준 상대). 여기를 막으면 아래 구역이
/// 고립된다. 배치표가 이 열을 피했는지 테스트가 직접 확인한다.
public let officeZoneDoorColumn = zoneWidth - 2

/// 부서마다 다른 자리 배치(책상 칸, 구역 원점 기준 상대 좌표). 순서대로 채운다.
///
/// 여섯 방이 전부 같은 4열 격자였다. 바닥재와 집기 3종만 다르고 자리는 복사한 듯 같아서,
/// 방이 "무엇을 하는 곳" 이 아니라 "몇 명 있는 곳" 으로만 읽혔다. 인원과 일하는 방식에 맞춰
/// 자리 모양을 다르게 준다 — 문패를 읽지 않아도 방의 성격이 배치에서 드러나게.
///
/// **마주보기(책상 아래 칸 착석)는 넣지 않았다.** 앉은 그림이 정면 한 장뿐(`char-*-sit.png`)이라
/// 아래쪽 사람도 정면을 보게 되어, 마주보는 게 아니라 등을 돌린 두 줄로 보인다. 짝 배치는
/// 대신 책상 두 개를 가로로 붙인 "섬" 으로 표현한다.
public func departmentDeskSpots(_ department: Department) -> [TilePoint] {
    func spots(_ pairs: [(Int, Int)]) -> [TilePoint] {
        pairs.map { TilePoint(x: $0.0, y: $0.1) }
    }
    switch department {
    case .planning:
        // 셋이 늘 함께 정하는 팀 — 회의 테이블을 앞에 두고 한 줄로 마주 본다.
        //
        // 처음에는 테이블을 가운데 두고 위아래로 둘러앉혔는데, 테이블 **아래** 사람의 이름표가
        // 머리 위로 떠올라 테이블 상판에 얹혔다. 이름표가 머리 위에 붙는 한 구조적으로 그렇게
        // 되므로, 사람을 전부 테이블 위쪽에 둔다.
        return spots([(2, 4), (4, 4), (6, 4), (1, 1), (7, 1)])
    case .engineering:
        // 짝지어 일하는 자리 — 같은 열에 위아래로 앉은 2열 종대.
        //
        // 책상 둘을 **가로로** 붙였더니 이름표가 서로 덮었다("백엔드규약 점검"). 이름표 폭이
        // 1.4칸쯤이라 가로 간격은 2칸 아래로 못 내려간다. 세로로 짝지으면 행 간격 3칸이
        // 그대로 살아 겹치지 않는다.
        return spots([(1, 4), (1, 1), (4, 4), (4, 1), (7, 4), (7, 1)])
    case .review:
        // 혼자 집중해 읽는 자리 — 위 줄은 끝까지 벌리고 아래 줄은 그 사이로 어긋나게.
        // 사이를 책장으로 막아 부스처럼 나눈다.
        //
        // 아래 줄 왼쪽 끝을 채워 여섯 자리가 됐다. 사규(`agent-contract.ts`)가 BE_FIX 와
        // PO_EVAL 을 리뷰로 옮기면서 인원이 넷에서 여섯으로 늘었는데, 다섯 자리 그대로면
        // 넘친 하나가 예비 격자로 밀려 이름표를 덮는다. 방에 몇 명이 사는지는 사규가 정하고,
        // 자리표는 그 인원을 담는다.
        return spots([(1, 4), (5, 4), (9, 4), (1, 1), (3, 1), (7, 1)])
    case .executive:
        // 둘뿐이고 손님을 맞는 방 — 멀찍이 떨어뜨려 각자 방을 쓰는 것처럼 보이게.
        return spots([(2, 4), (6, 4), (2, 1), (6, 1)])
    case .growth:
        // 밝고 트인 방 — 줄을 맞추지 않고 어긋나게 놓아 자유석으로 읽히게 한다.
        // 두 줄을 한 칸씩 엇갈리게 두면 격자로 보이지 않으면서도 행 간격 3 이 유지된다.
        //
        // 다섯 자리로 시작했다가 모의투자 둘이 늘어 여덟 명이 됐고, 넘친 셋이 예비 격자의
        // 좁은 행으로 밀려나 이름표가 서로를 덮었다. 방에 몇 명이 사는지는 사규가 정하므로,
        // 자리표는 그 인원을 담고도 남게 둔다.
        //
        // 아홉 번째(CTO_STUDY 가 붙으면서 늘었다)는 자리표에 없어 예비 격자에 앉아 있었다.
        // 우연히 빈 칸이라 겹치지 않았을 뿐 안전망에 기댄 배치였으므로, 그 칸을 자리표에
        // 적어 둔다. 쓰는 칸은 그대로지만 **누가 어디 앉는지는 바뀐다** — 배정이 자리표
        // 순서를 따르므로, 예비 격자로 밀려 맨 끝에 앉던 VACATION 대신 사전순 다섯 번째인
        // INVEST 가 (9, 4) 를 받는다.
        return spots([
            (1, 4), (3, 4), (5, 4), (7, 4), (9, 4),
            (2, 1), (4, 1), (6, 1), (9, 1),
        ])
    case .internalOps:
        // 설비가 모인 운영실 — 10명이 들어가야 해서 가장 조밀하다(5열 × 2행).
        // x=9 까지 쓰므로 집기는 y=0 줄로 밀려난다(자리·집기 충돌 회피가 자동으로 처리).
        // 첫째·마지막 자리를 스왑한 것은 오른쪽 끝의 긴 `제안 게이트` 이름표가 27.4 타일에서
        // 0.5 미만으로 눌리는 실측을 피하기 위해서다. 좌석 집합과 방 정원은 바꾸지 않는다.
        return spots([
            (9, 1), (3, 4), (5, 4), (7, 4), (9, 4),
            (1, 1), (3, 1), (5, 1), (7, 1), (1, 4),
        ])
    }
}

/// 부서 배치 순서(왼→오, 위→아래). 방 배치·범례가 공유하는 canonical 순서.
private let zoneOrder: [Department] = [
    .planning, .engineering, .review, .executive, .growth, .internalOps,
]

/// 에이전트 목록으로 사무실 평면도를 만든다(순수). 같은 입력이면 항상 같은 배치.
///
/// 자리 배정은 부서별로 묶은 뒤 agentType 사전순으로 채운다 — 에이전트가 추가·제거돼도
/// 남은 사람의 자리가 흔들리지 않게(스냅샷마다 자리가 바뀌면 화면이 요동친다).
public func officeFloorPlan(agents: [ConsoleAgent], zoneColumns: Int = 3) -> OfficeFloorPlan {
    let zoneRows = (zoneOrder.count + zoneColumns - 1) / zoneColumns
    let planSize = officePlanSize(zoneColumns: zoneColumns)
    let planColumns = planSize.columns
    let planRows = planSize.rows
    let corridorColumns = officeCorridorColumns(zoneColumns: zoneColumns)
    let corridorRow = officeCorridorRow(zoneColumns: zoneColumns)
    var floor = Array(
        repeating: Array(repeating: FloorTile.corridor, count: planColumns),
        count: planRows
    )
    var furniture: [FurniturePlacement] = []
    var desks: [DeskAssignment] = []
    var zones: [DepartmentZone] = []
    var blocked: Set<TilePoint> = []

    func place(_ kind: FurnitureKind, _ x: Int, _ y: Int) {
        guard x >= 0, y >= 0, x < planColumns, y < planRows else {
            return
        }
        furniture.append(FurniturePlacement(kind: kind, tile: TilePoint(x: x, y: y)))
        guard !kind.isWalkThrough else {
            return
        }
        let size = kind.footprint
        for offsetY in 0..<size.height {
            for offsetX in 0..<size.width {
                blocked.insert(TilePoint(x: x + offsetX, y: y + offsetY))
            }
        }
    }

    func paint(_ tile: FloorTile, x0: Int, y0: Int, width: Int, height: Int) {
        for y in y0..<min(y0 + height, planRows) {
            for x in x0..<min(x0 + width, planColumns) {
                floor[y][x] = tile
            }
        }
    }

    // === 상단 공용 밴드: 회의실 | 대표실 | 탕비실 ===
    //
    // 방 바닥은 맨 아래 줄을 **비워 두고** 그 위부터 칠한다 — 그 줄이 가로 복도이고, 세 방은
    // 거기서 각자 안으로 들어가는 구조다. 예전에는 밴드 전체를 방 바닥재로 칠해, 유일한 가로
    // 동선이 방 안을 관통하는 모양이었다(대표실 앞에 늘어선 줄이 어색해 보인 원인).
    let bandY = corridorRow
    let bandRoomY = bandY + 1
    let bandRoomHeight = bandHeight - 1
    let baseBandWidth = (planColumns + 2) / 3
    let bandSpans = (0..<3).map { index in
        (
            originX: index * baseBandWidth,
            width: index == 2 ? planColumns - baseBandWidth * 2 : baseBandWidth
        )
    }
    let commonAreas = [
        CommonArea(
            kind: .meeting, label: "회의실", icon: "🗣",
            originX: bandSpans[0].originX, width: bandSpans[0].width, labelY: bandY
        ),
        CommonArea(
            kind: .president, label: "대표실", icon: "👑",
            originX: bandSpans[1].originX, width: bandSpans[1].width, labelY: bandY
        ),
        CommonArea(
            kind: .pantry, label: "탕비실", icon: "☕",
            originX: bandSpans[2].originX, width: bandSpans[2].width, labelY: bandY
        ),
    ]
    let bandFloors: [FloorTile] = [.carpetDark, .carpetLight, .ceramic]
    for (index, span) in bandSpans.enumerated() {
        paint(
            bandFloors[index], x0: span.originX, y0: bandRoomY,
            width: span.width, height: bandRoomHeight
        )
    }
    // 가로 복도 — 격자 폭 전체. 좌우 끝은 뒤에서 바깥벽이 덮는다.
    paint(.corridor, x0: 0, y0: bandY, width: planColumns, height: 1)
    // 최상단 두 줄은 벽 — 화면 위쪽에 사무실 경계를 만든다.
    //
    // 한 줄이었을 때는 벽에 건 물건(창·등·시계)이 **바닥에 놓인 것처럼** 보였다. 3/4 탑다운에서
    // 벽면 높이가 한 칸이면 그 칸이 바닥과 구별되지 않기 때문이다. 두 줄로 세우면 위 칸이
    // 벽 윗면(밝게), 아래 칸이 벽면(어둡게)으로 갈려 물건이 벽에 걸린 것으로 읽힌다.
    paint(.wall, x0: 0, y0: planRows - outerWallRows, width: planColumns, height: outerWallRows)
    for y in (planRows - outerWallRows)..<planRows {
        for x in 0..<planColumns {
            blocked.insert(TilePoint(x: x, y: y))
        }
    }
    // 벽에 거는 물건은 전부 아래 줄(사람 눈높이)에 건다 — 위 줄은 벽 윗면이라 물건을 걸면
    // 천장에 붙은 것처럼 보인다.
    let wallHangY = planRows - outerWallRows

    // === 상단 밴드 창·벽등 ===
    // 세 방 모두 바깥벽에 접해 있다. 대표실에만 창을 내면 위쪽 줄이 한 곳만 밝고 좌우가
    // 휑하게 남는다. 넓은 방은 가운데 네 칸을 통창처럼 이어 붙이고, 폭 8 이하에서는 세 칸을
    // 쓴다 — 좁은 방에서 한 칸짜리 창까지 줄면 40픽셀짜리 액자와 구별되지 않는다.
    let windowRanges: [ClosedRange<Int>] = bandSpans.map { span in
        let windowWidth = span.width <= 8 ? 3 : 4
        let start = span.originX + (span.width - windowWidth) / 2
        return start...(start + windowWidth - 1)
    }
    let windowTiles = windowRanges.flatMap { range in
        range.map { TilePoint(x: $0, y: wallHangY) }
    }
    // 등은 창 무리 양옆 — 창에서 떨어뜨리면 두 광원이 따로 놀아 벽이 산만해진다.
    let wallLampTiles = windowRanges.flatMap { range in
        [
            TilePoint(x: range.lowerBound - 1, y: wallHangY),
            TilePoint(x: range.upperBound + 1, y: wallHangY),
        ]
    }
    let wallFixtureColumns = Set((windowTiles + wallLampTiles).map(\.x))

    struct BandFurnitureCandidate {
        let kind: FurnitureKind
        let relativeX: Int
        let relativeY: Int
    }

    func placeBand(_ candidate: BandFurnitureCandidate, in areaIndex: Int) {
        let span = bandSpans[areaIndex]
        let footprintEnd = candidate.relativeX + candidate.kind.footprint.width
        guard candidate.relativeX > 0, footprintEnd <= span.width - 1 else {
            return
        }
        let absoluteX = span.originX + candidate.relativeX
        if candidate.kind == .plantTall, wallFixtureColumns.contains(absoluteX) {
            return
        }
        place(candidate.kind, absoluteX, bandRoomY + candidate.relativeY)
    }

    // 밴드 안쪽 두 줄(bandY+1, bandY+2)에만 가구를 놓는다. 맨 아래 줄(bandY)은 부서에서
    // 대표실 줄까지 올라오는 가로 통로이므로 비워 두고, 맨 위 줄은 벽이다.
    //
    // 회의실 — 회의 테이블·화이트보드에 자료 코너(책장·복합기)를 붙였다. 테이블 하나만
    // 두면 10칸 폭에서 왼쪽 절반이 빈 바닥으로 남는다.
    //
    // 왼쪽 끝 칸(x = 0)이 칸막이 벽이 되면서 전체가 한 칸씩 안으로 들어왔다. 예전에는 그 칸도
    // 방 바닥이라 책장과 화이트보드가 거기 놓여 있었다.
    let meetingFurniture = [
        BandFurnitureCandidate(kind: .meetingTable, relativeX: 4, relativeY: 0),
    // 화이트보드는 회의 테이블 옆 바닥에 **한 대만** 세운다.
    //
    // 예전에는 벽 줄(`wallHangY`)에 두 개를 걸었다. 벽에 거는 판이라고 보았기 때문인데,
    // 재제작본이 스탠드·바퀴까지 담은 이동식이라 걸 수 있는 물건이 아니고, 세로로 2.5배
    // 자라면서 바깥벽을 뚫고 화면 밖으로 잘렸다. 크기가 커진 만큼 두 대는 회의실을 꽉 채워
    // 한 대로 줄인다. 벽면은 게시판·달력이 대신 채운다.
        BandFurnitureCandidate(kind: .whiteboard, relativeX: 2, relativeY: 0),
        BandFurnitureCandidate(kind: .bookshelf, relativeX: 1, relativeY: 1),
        BandFurnitureCandidate(kind: .bookshelf, relativeX: 2, relativeY: 1),
        BandFurnitureCandidate(kind: .printer, relativeX: 8, relativeY: 1),
    // 회의 테이블 옆 빈 바닥에 깔개. 2×2 칸을 차지하고 밟고 지나갈 수 있다.
        BandFurnitureCandidate(kind: .rugGreen, relativeX: 5, relativeY: 0),
    // 큰 화분은 벽걸이가 없는 열에만 둔다 — 잎이 벽 줄까지 올라와 창이든 등이든 덮는다
    // (대표실 시계가 같은 이유로 안 보였다). 창 4~7 · 등 3·8 을 뺀 자리가 9 뿐이다.
        BandFurnitureCandidate(kind: .plantTall, relativeX: 9, relativeY: 1),
    // 작은 화분은 방 **아래 줄**에 두므로 자리를 신중히 골라야 한다. 이 줄이 복도에서 가구
    // 줄로 올라가는 유일한 통로여서, 막으면 그 위 칸이 통째로 고립된다 — 3번 칸에 뒀다가
    // 회의 테이블 옆 자리(3, 가구줄) 로 아무도 못 가게 만들었다(테이블·책장이 이미 4·2를
    // 막고 있어 3 이 유일한 진입로였다). 회의 자리에서 먼 8번 칸에 둔다.
        BandFurnitureCandidate(kind: .plantSmall, relativeX: 8, relativeY: 0),
    ]
    for candidate in meetingFurniture {
        placeBand(candidate, in: 0)
    }

    // 대표실 — 대표는 밴드 가운데 서 있고, 그 앞줄이 승인 대기 줄이 된다.
    // 대표 앞 칸(bandY+1)은 비워 둔다: 줄 선 사람과 대표 사이의 면담 공간이고,
    // 여기 책상을 놓으면 서 있는 대표와 겹치지 않아 가구가 붕 떠 보인다.
    let presidentSpan = bandSpans[1]
    let presidentTile = TilePoint(
        x: presidentSpan.originX + (presidentSpan.width - 1) / 2,
        y: bandRoomY + 1
    )
    // 대표가 직접 띄운 작업(세션)이 올라갈 **작업 책상**. 짝수 칸에 고정으로 두고 홀수 칸은
    // 응접 가구가 쓴다.
    //
    // 한때 여기에 사람을 앉혔다. 세션은 편집기 창 하나당 하나씩 잡히는데 그걸 사람으로 세우니
    // **없던 직원이 갑자기 생겼다 사라지는** 화면이 됐다. 세션은 사규가 배정한 일이 아니라
    // 대표 본인의 작업이므로, 사람을 늘리는 대신 대표 책상 위에서 화면이 켜지는 쪽이 맞다.
    //
    // 홀수 칸(1·3·7·9)이 응접 가구 몫이고 5 는 대표가 서는 칸이다. 짝수 칸을 가구가 물면
    // 책상이 그만큼 조용히 사라지므로, 개수는 테스트가 고정한다(`officeSessionDesks`).
    //
    // **2 부터 시작한다.** 복도를 내면서 방 왼쪽 첫 칸(offset 0)이 칸막이 벽이 됐다. 거기에
    // 놓으면 책상이 벽을 뚫고 그려진다 — 자리를 고르는 쪽(`officeSessionDesks`)은 놓인 책상을
    // 그대로 읽으므로 통행 가능 여부로 걸러 주지 않는다. 그래서 네 자리다.
    for offset in stride(from: 2, to: min(presidentSpan.width - 1, zoneWidth), by: 2) {
        placeBand(
            BandFurnitureCandidate(kind: .desk, relativeX: offset, relativeY: 1), in: 1
        )
    }
    let presidentFurniture = [
        BandFurnitureCandidate(kind: .sofa2, relativeX: 1, relativeY: 1),
    // 여기도 홀수 칸이다. 나란히 두려고 -2·-1(짝수·홀수) 로 붙이면 짝수 쪽이 세션 자리를 먹는다.
        BandFurnitureCandidate(kind: .bookshelf, relativeX: 7, relativeY: 1),
        BandFurnitureCandidate(kind: .bookshelf, relativeX: 9, relativeY: 1),
        BandFurnitureCandidate(kind: .plantTall, relativeX: 3, relativeY: 1),
    // 시계는 대표 머리 위를 피한다 — 같은 열에 두면 "나 (대표)" 라벨과 겹쳐 둘 다 안 읽힌다.
    //
    // 창·벽등이 벽 가운데를 쓰면서 오른쪽 끝으로 옮겼다. 왼쪽 끝에 뒀더니 바로 아래 큰 화분의
    // 잎이 시계를 덮어 시간이 안 보였다 — 벽에 거는 물건은 자기 칸만 비어 있어서는 안 되고
    // **아래 칸의 키 큰 가구**까지 봐야 한다.
        BandFurnitureCandidate(
            kind: .clock, relativeX: presidentSpan.width - 2,
            relativeY: wallHangY - bandRoomY
        ),
    // 연속 기록 게시판. 도장이 찍히는 자리라 **대표와 같은 방** 이어야 한다 — 할 일 말풍선이
    // 대표 머리 위에 뜨므로, 기록까지 이 방에 있으면 "내 몫" 이 한 화면에 모인다.
    //
    // **달력(16×18px)이 아니라 게시판(36×24px)을 쓴다.** 달력이 뜻으로는 맞지만 실사용 창에서
    // 13×15pt(타일의 1/3)로 그려져, 도장 다섯 개를 넣으면 하나가 2.6pt 가 된다 — 개수를 세라고
    // 찍는 도장이 개수를 셀 수 없게 된다. 게시판은 1.07칸 폭이라 상한까지 찍어도 읽힌다.
    //
    // 왼쪽 끝(1)을 쓰는 이유는 벽 줄에 빈 칸이 거기뿐이라서다. 창이 가운데 네 칸, 벽등이 그
    // 양옆 두 칸, 시계가 오른쪽 끝(width-2)을 쓴다. 아래 칸이 소파(1)라 안전하다 — 책장(7·9)
    // 위에 걸면 책장 상단이 벽 줄까지 올라와 게시판을 덮는다(시계가 화분에 덮인 것과 같은 함정).
        BandFurnitureCandidate(
            kind: .wallPinboard, relativeX: 1, relativeY: wallHangY - bandRoomY
        ),
    ]
    for candidate in presidentFurniture {
        placeBand(candidate, in: 1)
    }

    // 탕비실 겸 라운지 — 커피·정수기·소파.
    //
    // `pantryX` 는 이제 **왼쪽 칸막이 벽**이라 가구를 놓을 수 없다(예전에는 방 바닥이었다).
    // 그래서 맨 앞에 있던 큰 화분이 자리를 잃었다. 벽걸이가 없는 열(창 +3~+6 · 등 +2·+7 을
    // 뺀 +9)로 내려보내고, 나머지는 원래 오프셋을 지킨다 — 휴식 자리(`loungeTiles`)가
    // 커피 머신·소파 앞 칸을 오프셋으로 가리키므로 여기서 밀면 사람이 가구 앞이 아닌 곳에 선다.
    let pantrySpan = bandSpans[2]
    let pantryFurniture = [
        BandFurnitureCandidate(kind: .coffeeMachine, relativeX: 1, relativeY: 1),
    // 정수기를 한 칸 왼쪽으로 — 원래 자리 위가 벽등 자리다.
        BandFurnitureCandidate(kind: .waterCooler, relativeX: 2, relativeY: 1),
    // 냉장고·싱크대. 창 아래(+3~+6)에 두어도 되는 것은 둘 다 0.7칸으로 낮아 벽 줄에 닿지
    // 않기 때문이다 — 자판기(1.43칸)를 여기 두면 창을 덮으므로 운영실로 보냈다.
        BandFurnitureCandidate(kind: .refrigerator, relativeX: 3, relativeY: 1),
        BandFurnitureCandidate(kind: .sinkCounter, relativeX: 4, relativeY: 1),
        BandFurnitureCandidate(kind: .sofa3, relativeX: 5, relativeY: 1),
        BandFurnitureCandidate(kind: .coffeeTable, relativeX: 6, relativeY: 0),
        BandFurnitureCandidate(kind: .sofa2, relativeX: 8, relativeY: 1),
    // 소파·커피테이블 아래에 깔개 — 앉아서 이야기하는 자리로 읽히게 한다.
        BandFurnitureCandidate(kind: .rugBeige, relativeX: 5, relativeY: 0),
        BandFurnitureCandidate(
            kind: .plantTall, relativeX: pantrySpan.width - 2, relativeY: 1
        ),
        BandFurnitureCandidate(kind: .trash, relativeX: 9, relativeY: 0),
    ]
    for candidate in pantryFurniture {
        placeBand(candidate, in: 2)
    }

    // 승인 대기 줄 — 대표 바로 아래 가로 한 줄(왼쪽부터 채운다).
    // 그 줄이 가로 복도이므로, 줄은 대표실 안이 아니라 **문 앞 복도**에 선다.
    let queueTiles = (1..<(presidentSpan.width - 1)).map { offset in
        TilePoint(x: presidentSpan.originX + offset, y: bandY)
    }
    // 휴식 자리는 실제로 남은 커피머신·소파 앞 칸을 따라간다. 좁은 방에서 낮은 우선순위
    // 소파가 빠졌는데 좌표만 남으면 사람이 빈 벽 앞에서 쉬는 것으로 보인다.
    let loungeTiles = furniture.compactMap { placement -> TilePoint? in
        guard placement.tile.x >= pantrySpan.originX,
            placement.tile.x < pantrySpan.originX + pantrySpan.width,
            placement.kind == .coffeeMachine || placement.kind == .sofa2
                || placement.kind == .sofa3
        else {
            return nil
        }
        return TilePoint(x: placement.tile.x, y: placement.tile.y - 1)
    }

    // === 부서 구역 ===
    let presentDepartments = zoneOrder.filter { candidate in
        agents.contains { $0.resolvedDepartment == candidate }
    }
    for (index, zoneDepartment) in presentDepartments.enumerated() {
        let column = index % zoneColumns
        let row = index / zoneColumns
        let originX = column * zoneStride
        // row 0 이 위(밴드 바로 아래), 마지막 row 가 아래. 아래 구역은 격자 바닥이 아니라
        // 하단 벽 바로 위에서 시작한다 — 배치가 전부 원점 기준 상대좌표라 여기만 올리면
        // 책상·가구·벽걸이가 통째로 따라온다.
        let originY = (zoneRows - row - 1) * zoneHeight + officeFloorWallRows
        zones.append(
            DepartmentZone(
                department: zoneDepartment,
                origin: TilePoint(x: originX, y: originY),
                // 좌우 벽을 모두 포함한 폭. 구역과 구역 사이에는 복도가 한 열 더 있으므로
                // (`zoneStride`) 이 사각형끼리는 겹치지 않는다 — 문패 중앙 계산과 벽 열 판정이
                // 이 값을 본다.
                width: zoneWidth + 1,
                height: zoneHeight
            )
        )
        // 구역 바닥은 부서마다 다른 재질 — 부서 경계를 선이 아니라 바닥으로 보여준다.
        // 예전에는 `index % 2` 로 밝은/어두운 카펫을 번갈아 써서 여섯 방이 두 종류로만 보였다.
        // 세로는 구역 전체 높이를 칠한다 — 천장 줄은 뒤에서 벽이 덮고, 벽이 없는 위 구역
        // 맨 윗줄은 방 바닥으로 남아 통로가 방 안을 갈라 보이게 하지 않는다.
        //
        // **가로는 좌우 벽 칸까지 칠한다.** 벽은 뒤에서 덮으므로 결과가 달라지는 칸은 딱
        // 하나 — 복도로 낸 문이다. 문턱이 방 바닥재로 남아 방이 복도까지 이어져 보인다.
        // 내부만 칠하면 그 칸이 격자 기본값으로 남아 문이 통로색 점으로 찍힌다.
        paint(
            departmentFloor(zoneDepartment),
            x0: originX,
            y0: originY,
            width: zoneWidth + 1,
            height: zoneHeight
        )

        let members = agents
            .filter { $0.resolvedDepartment == zoneDepartment }
            .map(\.agentType)
            .sorted()
        // 부서 배치표를 먼저 쓰고, 다 쓰면 예비 격자로 이어 채운다. 배치표만 두면 에이전트가
        // 늘었을 때 자리를 못 받은 사람이 화면에서 조용히 사라진다.
        let spotCandidates = departmentDeskSpots(zoneDepartment) + fallbackDeskSpots
        var usedLocals: Set<TilePoint> = []
        for agentType in members {
            // 좌석은 책상 바로 위 칸이므로 책상 y 는 천장 벽 아래(zoneHeight - 2)까지만 유효하다.
            guard let local = spotCandidates.first(where: { candidate in
                !usedLocals.contains(candidate)
                    && candidate.x >= 1 && candidate.x < zoneWidth
                    && candidate.y >= 0 && candidate.y <= zoneHeight - 3
            }) else {
                // 배치표와 예비 격자를 모두 소진한 경우. 전원 배정을 고정한 테스트가 있으므로,
                // 여기 걸리면 그 부서의 배치표를 늘려야 한다.
                continue
            }
            usedLocals.insert(local)
            let deskTile = TilePoint(x: originX + local.x, y: originY + local.y)
            place(.desk, deskTile.x, deskTile.y)
            desks.append(
                DeskAssignment(
                    agentType: agentType,
                    desk: deskTile,
                    seat: TilePoint(x: deskTile.x, y: deskTile.y + 1)
                )
            )
        }
        // 부서 특색 가구 — 자리 배치와 짝을 이뤄야 방의 성격이 산다. 기획방의 회의 테이블이
        // 구석에 있으면 "둘러앉은 팀" 이 아니라 "책상 셋과 남는 테이블" 이 된다.
        //
        // 문 열(originX + zoneWidth - 2)은 후보에서 뺀다. 아래 구역 문과 이어지는 수직 동선이라
        // 막으면 아래 구역 전원이 고립된다(쓰레기통으로 막았다가 좌석 16개가 갇힌 적이 있다).
        // 응접실 바닥에 깔개. 부서 여섯 방 중 여기만 두는 것은 소파와 커피테이블이 함께 놓인
        // 유일한 방이라서다 — 깔개는 "앉아서 이야기하는 자리" 를 만드는 물건이고, 일하는 방
        // 바닥에 깔면 부서 바닥재(방을 구별하는 1차 신호)를 두 겹으로 덮는다.
        //
        // 자리를 후보 목록(`departmentFurnitureSpots`)에서 뽑지 않고 직접 지정하는 이유는
        // 소파·테이블 **아래** 라는 것이 요점이기 때문이다. 후보 순서를 따르면 남은 빈 칸으로
        // 밀려나 방 구석에 깔개만 덩그러니 놓인다.
        if zoneDepartment == .executive {
            place(.rugNavy, originX + 3, originY + 3)
        }

        let seatTiles = Set(desks.map(\.seat))
        let furnitureSpots = departmentFurnitureSpots(zoneDepartment).map {
            TilePoint(x: originX + $0.x, y: originY + $0.y)
        }
        // 벽걸이 자리는 바닥 후보와 별개다. 같은 목록에서 뽑으면 시계가 방 한가운데 바닥에
        // 놓인다 — 벽 칸은 바닥 후보(x = 1~9)에 아예 들어 있지 않기 때문이다.
        //
        // **맨 왼쪽 열의 방은 오른쪽 벽에 건다.** 그 방들(기획·경영)의 왼쪽 벽은 칸막이가 아니라
        // 격자 최외곽, 즉 건물 **바깥벽**이다. 거기 걸면 화면 맨 가장자리에 액자·게시판·시계가
        // 세로로 줄줄이 붙어 사무실 밖에 건 그림이 된다. 오른쪽 벽은 복도에 면해 있지만 문 줄
        // (`corridorDoorRows`, 상대 y = 3)과 벽걸이 줄(4·2·0)이 겹치지 않는다.
        let wallMountColumn = officeWallMountColumn(zoneOriginX: originX)
        let wallSpots = zoneWallMountSpots.map {
            TilePoint(x: wallMountColumn + $0.x, y: originY + $0.y)
        }
        var spotCursor = 0
        var wallCursor = 0
        for kind in departmentFurniture(zoneDepartment) {
            if kind.isWallMounted {
                guard wallCursor < wallSpots.count else {
                    continue
                }
                let spot = wallSpots[wallCursor]
                wallCursor += 1
                place(kind, spot.x, spot.y)
                continue
            }
            while spotCursor < furnitureSpots.count {
                let spot = furnitureSpots[spotCursor]
                spotCursor += 1
                guard !blocked.contains(spot), !seatTiles.contains(spot) else {
                    continue
                }
                place(kind, spot.x, spot.y)
                break
            }
        }
    }

    // === 칸막이 벽과 복도 ===
    // 구역 사이는 **벽 · 복도 · 벽** 세 칸이다. 예전에는 벽 한 칸을 두 방이 공유해 방끼리 바로
    // 붙어 있었고, 그래서 가로로 이동하는 길이 밴드 맨 아래 줄 하나뿐이었다 — 왼쪽 아래 방에서
    // 오른쪽 아래 방으로 가려면 다른 방 넷을 관통해야 했다.
    //
    // 세로 여백은 복도 쪽 문 한 칸을 빼고 전부 벽. 가로 여백은 아래 구역 천장(zoneHeight - 1)만
    // 벽으로 막고 문 한 칸을 남긴다 — 위 구역 천장은 밴드로 나가는 통로라 열어 둔다. 그래서
    // 방에서 나가는 길이 둘이다: 복도로 바로, 또는 천장 문으로 위 구역을 거쳐.
    // 이 연결은 좌석·줄·휴식 자리 도달성 테스트가 지킨다.
    // 부서 구역이 차지하는 줄 범위(하단 벽 위 ~ 가로 복도 아래). 칸막이 벽 루프가 쓴다.
    let zoneAreaFirstRow = officeFloorWallRows
    let zoneAreaRows = zoneHeight * zoneRows
    // 벽을 세울 수 있는 범위 — 바깥벽 아래 전부. 밴드도 포함한다(공용 세 방을 갈라야 한다).
    let wallableRows = planRows - outerWallRows
    func raiseWall(_ x: Int, _ y: Int) {
        guard x >= 0, y >= 0, x < planColumns, y < wallableRows else {
            return
        }
        floor[y][x] = .wall
        blocked.insert(TilePoint(x: x, y: y))
    }

    let corridorColumnSet = Set(corridorColumns)
    // 복도에 면한 벽인가 — 좌우 이웃 중 하나가 복도 열이면 그 벽에 문을 낸다.
    // 격자 좌우 최외곽 벽은 바깥과 접해 있어 여기 걸리지 않는다.
    func facesCorridor(_ x: Int) -> Bool {
        corridorColumnSet.contains(x - 1) || corridorColumnSet.contains(x + 1)
    }
    // 방마다 복도로 나가는 문 한 칸. 자리 배치가 쓰는 줄(책상 y = 1·4, 좌석 y = 2·5)을 피해
    // 구역 원점에서 세 칸 위에 낸다 — 위·아래 구역이 같은 상대 위치를 쓴다.
    let corridorDoorRows = Set(
        (0..<zoneRows).map { zoneAreaFirstRow + $0 * zoneHeight + 3 }
    )

    // 벽에 낸 구멍마다 문을 세운다. 지금까지 출입구는 **벽을 안 세운 빈 칸**이라, 방을 닫아
    // 놓고도 어디가 문인지 바닥과 구별되지 않았다.
    //
    // **닫힌 문을 놓는다.** 한때 전부 열린 문이었다 — 사람이 문짝을 통과해 걸어 나오는 그림을
    // 피하려던 것인데, 열두 짝이 항상 활짝 열려 있으니 사무실이 문을 안 닫고 사는 곳이 됐다.
    // 지금은 렌더가 사람 위치를 보고 여닫으므로(`officeDoorIsOpen`) 평면도는 닫힌 상태를
    // 기본으로 둔다. 통행 자체는 `isWalkThrough` 가 열어 두므로 그림과 무관하게 지나갈 수 있다.
    //
    // 구멍을 내는 자리와 문을 세우는 자리가 **같은 분기**여야 한다. 따로 적으면 한쪽만 옮겼을
    // 때 문이 벽 한가운데 서거나 구멍이 문 없이 남는다.
    func openDoor(_ x: Int, _ y: Int) {
        place(.doorClosed, x, y)
    }

    for column in 0..<zoneColumns {
        let originX = column * zoneStride
        for wallX in [originX, originX + zoneWidth] {
            let doorRows = facesCorridor(wallX) ? corridorDoorRows : []
            for y in zoneAreaFirstRow..<(zoneAreaFirstRow + zoneAreaRows) {
                if doorRows.contains(y) {
                    openDoor(wallX, y)
                } else {
                    raiseWall(wallX, y)
                }
            }
        }
        // 위·아래 구역 모두 천장을 막고 문 한 칸을 남긴다. 문은 책상 열(originX + 1, 3, 5, 7)을
        // 피해 오른쪽 끝 빈 열에 낸다.
        //
        // 위 구역 천장은 한때 통째로 열려 있었다. 그 줄이 밴드로 나가는 **유일한** 출구여서
        // 막으면 그 방 전원이 고립됐기 때문이다. 이제는 복도 쪽 문이 따로 있어 막을 수 있고,
        // 막아야 한다 — 열어 두면 방 위쪽 경계가 없어 복도와 방이 한 덩어리로 보인다.
        let doorX = originX + zoneWidth - 2
        for ceilingY in (1...zoneRows).map({
            zoneAreaFirstRow + $0 * zoneHeight - 1
        }) {
            for x in originX...(originX + zoneWidth) where x != doorX {
                raiseWall(x, ceilingY)
            }
            openDoor(doorX, ceilingY)
        }
    }

    // 밴드 세 방도 벽으로 닫는다. 바닥재만으로 갈라 두면 화면 위쪽 1/4 이 "가구 놓인 띠 하나"
    // 로 읽힌다 — 문패가 셋 붙어 있어도 어디까지가 회의실인지 보이지 않았다.
    // 맨 아래 줄(가로 복도)에는 세우지 않는다: 그 줄이 세 방의 공통 입구다.
    for span in bandSpans {
        for y in bandRoomY..<wallableRows {
            raiseWall(span.originX, y)
        }
    }

    // 좌우 최외곽은 세로로 전 구간이 벽 — 가로 복도가 격자 끝에서 밖으로 뚫려 보이지 않게 한다.
    for y in 0..<wallableRows {
        raiseWall(0, y)
        raiseWall(planColumns - 1, y)
    }

    // 격자 맨 아래 줄도 벽. 좌·우·위만 닫혀 있어 사무실이 아래로 뚫려 있었다 —
    // 그 줄에 놓인 운영실 설비가 등 댈 벽 없이 허공에서 끝났다(`officeFloorWallRows`).
    for y in 0..<officeFloorWallRows {
        for x in 0..<planColumns {
            raiseWall(x, y)
        }
    }

    // 세로 복도는 벽을 세운 **뒤에** 칠한다. 지금은 벽 루프가 복도 열을 건드리지 않지만,
    // 순서를 뒤집으면 나중에 벽 범위가 넓어졌을 때 복도가 조용히 벽에 먹힌다.
    //
    // **하단 벽 줄은 건너뛴다.** 여기서 0 부터 칠하면 방금 세운 아래 벽이 복도색으로 덮여
    // 다시 뚫린다 — 벽을 세운 뒤에 칠하는 순서가 그대로 함정이 되는 자리다.
    //
    // 부서 복도와 밴드는 서로 다른 격자를 쓴다. 복도 열이 다음 밴드 span의 왼쪽 경계와
    // 맞닿을 때만 바깥벽 아래까지 이어 칠한다. 경계가 아닌 방 내부를 지나는 열은 가로 복도에서
    // 끊어야 한다. 이 규칙으로 3열의 기존 경계 복도는 유지되고, 2열 x=11은 대표실을 관통하지
    // 않는다.
    let bandBoundaryCorridorColumns = Set(
        bandSpans.dropFirst().map { $0.originX - 1 }
    )
    for x in corridorColumns {
        let corridorTopExclusive = bandBoundaryCorridorColumns.contains(x)
            ? wallableRows : bandRoomY
        paint(
            .corridor,
            x0: x,
            y0: officeFloorWallRows,
            width: 1,
            height: corridorTopExclusive - officeFloorWallRows
        )
    }

    // 출퇴근 진입점은 세로 복도의 **아래쪽 끝**(바닥벽 바로 위)에 둔다. 처음에는 가로
    // 복도와 만나는 자리(대표실 앞)를 썼는데, 2열 배치에서 그 칸이 승인 대기 줄
    // 세 번째 자리(`queueTiles[2]`)와 그대로 겹쳤다 — 대표 앞 대기줄에 자세·경고등 같은
    // 시각 신호를 얹을 다음 태스크들의 전제를 깨는 자리였다. 대표실 밴드에서 최대한 먼
    // 자리가 필요했으므로 좌표를 미세조정하는 대신 **구조적으로 분리된** 반대쪽 끝을 골랐다 —
    // `officeFloorWallRows`는 세로 복도 칠 루프(`paint(.corridor, x0: x, y0: officeFloorWallRows, ...)`)
    // 가 이미 "복도의 시작 줄"로 쓰는 값이라 새 상수가 아니다.
    let entranceTile = TilePoint(x: corridorColumns[0], y: officeFloorWallRows)

    // 앉는 칸은 통로에서 도달 가능해야 하므로 막지 않는다.
    let seats = Set(desks.map(\.seat))
    var walkable: Set<TilePoint> = []
    for y in 0..<planRows {
        for x in 0..<planColumns {
            let tile = TilePoint(x: x, y: y)
            if seats.contains(tile) || !blocked.contains(tile) {
                walkable.insert(tile)
            }
        }
    }

    return OfficeFloorPlan(
        columns: planColumns,
        rows: planRows,
        floor: floor,
        furniture: furniture,
        desks: desks,
        walkable: walkable,
        queueTiles: queueTiles,
        loungeTiles: loungeTiles,
        presidentTile: presidentTile,
        entranceTile: entranceTile,
        zones: zones,
        commonAreas: commonAreas,
        windowTiles: windowTiles,
        wallLampTiles: wallLampTiles
    )
}
