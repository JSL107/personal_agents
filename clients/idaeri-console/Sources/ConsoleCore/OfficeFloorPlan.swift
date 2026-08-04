import Foundation

/// 타일 격자 좌표. (0,0) = 좌하단, y 는 위로 증가(SpriteKit 좌표계와 같은 방향).
public struct TilePoint: Hashable, Sendable {
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
/// 1칸까지 줄이면 오히려 계보를 벗어나고, 27명을 머리색으로 구별하기도 어려워진다.
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

/// 앉은 캐릭터를 책상 쪽으로 내리는 양(타일 크기 배수).
///
/// 좌석이 책상 **바로 위 칸**이고 캐릭터·가구 모두 발밑 기준(anchor y = 0)이라, 그냥 두면
/// 책상 상단(0.8칸)과 사람 발밑(1칸) 사이에 0.2칸 빈틈이 생긴다. 앉은 사람이 책상에 닿지 않고
/// 공중에 뜬 것처럼 보이는 원인이다. 앉음일 때만 내려 하반신이 책상에 가리게 한다 —
/// 서 있거나 걷는 캐릭터는 발이 바닥에 닿아야 하므로 오프셋 0 을 유지한다.
public let officeSeatedSpriteDrop: Double = 0.28

// MARK: - 이름표·문패가 서로를 가리지 않게 하는 기준
//
// 이름표(캐릭터가 그린다)와 부서 문패(씬이 그린다)는 파일이 달라서, 각자 자기 숫자를 들고
// 있으면 어느 쪽을 옮겨도 상대가 모른다. 실제로 그렇게 어긋나 **각 부서 세 번째 좌석**의
// 이름표가 문패에 통째로 가려져 있었다(문패는 구역 정중앙 = 칸 5.5, 좌석은 1·3·5·7).
// 세로도 0.1칸이 겹쳤다. 두 값을 여기 모아 회귀 테스트가 겹침을 직접 계산하게 한다.

/// 앉은 캐릭터 스프라이트의 높이(타일 배수). `char-*-sit.png` 실측 57px ÷ 기준 타일.
/// 서 있는 그림(54px)보다 높다 — 의자 등받이까지 그려져 있다.
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

/// 라벨 박스 높이 ÷ 글자 크기. `AppleSDGothicNeo-Bold` 한글 실측(11·12·18.3·24pt에서 1.15~1.27).
/// 상한 쪽인 1.3 을 쓴다 — 모자라게 잡으면 문패가 이름표를 다시 덮는다.
public let officeLabelBoxRatio: Double = 1.3

/// 문패 아래끝과 이름표 위끝 사이에 두는 최소 간격(타일 배수).
/// 두 라벨의 판(plate)이 각각 바깥으로 3px·1px 넓어지는 몫이다.
public let officeZoneLabelGapTiles: Double = 0.14

/// 이름표 글자 크기(px). 타일에 비례하되 한글 하한이 걸린다.
public func officeNameplateFontSize(tileSize: Double) -> Double {
    max(officeNameplateMinFontSizeValue, tileSize * officeNameplateFontTiles)
}

/// 좌석에 앉은 사람의 이름표 위끝이 격자에서 몇 칸 높이에 오는가.
public func officeSeatedNameplateTopTiles(seatY: Int, tileSize: Double) -> Double {
    let boxTiles = officeNameplateFontSize(tileSize: tileSize) * officeLabelBoxRatio / tileSize
    return Double(seatY) - officeSeatedSpriteDrop + officeSeatedSpriteTiles
        + officeNameplateGapTiles + boxTiles
}

/// 부서 문패 아래끝을 놓을 높이(격자 칸).
///
/// 구역 경계 줄이 아니라 **그 방 첫 좌석 행 이름표 위끝**에서 파생한다. 문패는
/// 오버레이(z=1000)라 겹치면 가리는 쪽이 늘 문패이고, 문패가 구역 정중앙(칸 5.5)·좌석이
/// 1·3·5·7 이라 겹치는 순간 매번 같은 사람(세 번째 좌석)의 이름이 통째로 사라진다.
///
/// `topSeatY` 가 nil(좌석 없는 구역)이면 경계 줄 바로 위에 둔다.
public func officeZoneLabelBottomTiles(
    zone: DepartmentZone,
    topSeatY: Int?,
    tileSize: Double
) -> Double {
    let boundary = Double(zone.origin.y + zone.height - 1) + officeZoneLabelGapTiles
    guard let topSeatY else {
        return boundary
    }
    let aboveNameplate =
        officeSeatedNameplateTopTiles(seatY: topSeatY, tileSize: tileSize)
        + officeZoneLabelGapTiles
    return max(boundary, aboveNameplate)
}

/// 구역 안에서 가장 위쪽 좌석의 y. 문패를 그 위로 올리기 위한 기준이다.
public func officeTopSeatY(zone: DepartmentZone, desks: [DeskAssignment]) -> Int? {
    desks
        .map(\.seat)
        .filter { seat in
            seat.x >= zone.origin.x && seat.x < zone.origin.x + zone.width
                && seat.y >= zone.origin.y && seat.y < zone.origin.y + zone.height
        }
        .map(\.y)
        .max()
}

/// 바닥·벽 타일 종류. 스프라이트 파일명(tile-*.png)과 1:1.
public enum FloorTile: String, Sendable, CaseIterable {
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
        // 통로는 방보다 확실히 어둡다. 텍스처는 우드를 그대로 쓰고 밝기만 눌러
        // 에셋 추가 없이 구분한다 — 방이 앞으로 나오고 통로가 배경으로 물러난다.
        case .corridor:
            return 0.78
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
public enum FurnitureKind: String, Sendable, CaseIterable {
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

    /// 이 가구가 차지하는 타일 크기. 통로 계산(walkable)과 렌더 크기의 공통 기준.
    public var footprint: (width: Int, height: Int) {
        switch self {
        case .meetingTable:
            return (1, 2)
        case .sofa3, .whiteboard, .bookshelf:
            return (1, 1)
        default:
            return (1, 1)
        }
    }

    /// 사람이 통과할 수 있는가. 벽시계처럼 벽에 붙는 것은 바닥을 막지 않는다.
    public var isWalkThrough: Bool {
        switch self {
        case .clock, .whiteboard:
            return true
        default:
            return false
        }
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
        case .desk, .chairDown, .chairUp, .clock, .trash:
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
            return (37, 32)
        case .chairDown:
            return (16, 26)
        case .chairUp:
            return (17, 24)
        case .meetingTable:
            return (37, 56)
        case .sofa2:
            return (30, 21)
        case .sofa3:
            return (39, 21)
        case .coffeeTable:
            return (18, 17)
        case .coffeeMachine:
            return (27, 31)
        case .waterCooler:
            return (12, 30)
        case .whiteboard:
            return (39, 22)
        case .printer:
            return (24, 28)
        case .plantTall:
            return (18, 32)
        case .plantSmall:
            return (17, 20)
        case .bookshelf:
            return (37, 35)
        case .clock:
            return (20, 19)
        case .trash:
            return (13, 17)
        }
    }

    /// 원본 세로 픽셀. 높이 환산의 분모다.
    public var nativeHeight: Double {
        nativeSize.height
    }

    /// 폭 상한을 함께 계산하는 계열. 같은 종류 가구가 서로 다른 배율을 받으면 나란히 놓였을 때
    /// 2인 소파가 3인 소파보다 높아 보인다 — 탕비실 밴드에 둘이 3칸 간격으로 함께 놓인다.
    /// 3인 소파가 폭 39px 로 더 넓어 상한이 먼저 걸리므로, 2인 소파도 그 값을 따른다.
    private var scaleGroup: [FurnitureKind] {
        switch self {
        case .sofa2, .sofa3:
            return [.sofa2, .sofa3]
        default:
            return [self]
        }
    }

    /// 실물 높이(cm). 이 값으로 배율을 환산한다. nil 이면 환산하지 않는다.
    ///
    /// **벽걸이(시계·화이트보드)와 탑다운 시점(회의 테이블)은 nil 이다.** 세로 픽셀이 높이가
    /// 아니라서 환산이 성립하지 않는다 — 벽시계를 지름 30cm 로 환산하면 절반으로 줄어 보이지
    /// 않게 되고, 회의 테이블의 세로는 깊이(원근)다. 이 세 종은 화면에서 읽히는 크기로 판단한다.
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
        case .clock, .whiteboard, .meetingTable:
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
    /// 환산 대상이 아닌 세 종(`targetHeightCm == nil`)은 1.0 을 유지하되, 회의 테이블만
    /// 예외로 기존 확대값을 잇는다 — 2칸(footprint)을 차지하는데 원본이 1.4칸이라 칸을 덜 채운다.
    /// 정확한 값은 실앱에서 눈으로 확정할 항목이다.
    ///
    /// **높이 환산값은 폭 상한에 걸려 깎일 수 있다.** 렌더는 배율을 가로·세로에 같이 곱하므로
    /// (`OfficeScene` 의 `node.size`) 높이만 보고 키우면 폭이 자기 칸을 넘어 옆 칸을 침범한다.
    /// 책장은 개발·리뷰 부서와 상단 밴드에서 **두 개가 인접 배치**되므로 넘친 폭이 곧 겹침이다.
    /// 관제 화면에서 가구가 사람이나 상태 링을 가리는 것은 정보 손실이라, 시각 축척보다
    /// 겹침 방지가 우선한다(관통 제약 6번).
    ///
    /// 그래서 폭이 큰 가구는 목표 높이를 다 채우지 못한다 — 책장이 대표적이다(88% → 70%).
    /// 원인은 에셋의 가로세로비가 실물과 다른 것(37×35 로 거의 정사각형인데 실물 3단 책장은
    /// 세로로 길다)이므로, 배율로는 여기까지가 한계다. 해소는 에셋 재제작(3단계) 몫이다.
    public var sizeBoost: Double {
        let byHeight: Double
        if let targetHeightCm {
            byHeight = targetHeightCm * officePixelsPerCentimeter / nativeHeight
        } else if self == .meetingTable {
            byHeight = 1.15
        } else {
            byHeight = 1.0
        }
        let widthCap =
            scaleGroup
            .map { Double(footprint.width) * officeReferenceTileSize / $0.nativeSize.width }
            .min() ?? 1
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

/// 부서별 대표 가구 3종(방의 성격). 에셋을 새로 만들지 않고 "어디에 무엇을 놓는지" 만 바꾼다.
public func departmentFurniture(_ department: Department) -> [FurnitureKind] {
    switch department {
    case .planning:
        return [.meetingTable, .whiteboard, .plantSmall]  // 모여서 논의하는 방
    case .engineering:
        return [.bookshelf, .bookshelf, .clock]  // 자료 벽을 세운 집중하는 방
    case .review:
        return [.whiteboard, .bookshelf, .bookshelf]  // 검토하는 방
    case .executive:
        return [.sofa2, .coffeeTable, .plantTall]  // 손님을 맞는 방
    case .growth:
        return [.plantTall, .plantSmall, .sofa2]  // 밝고 트인 방
    case .internalOps:
        return [.printer, .waterCooler, .trash]  // 설비가 모인 방
    }
}

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
        return spots([(4, 2), (9, 5), (9, 3), (9, 1), (1, 0)])
    case .engineering:
        // 2열 종대가 x=1·4·7 을 쓰므로 자료 벽은 오른쪽 끝에 세운다.
        return spots([(9, 5), (9, 3), (9, 1), (2, 0), (6, 0)])
    case .review:
        // 자리와 자리 사이를 책장으로 막아 부스처럼 나눈다.
        return spots([(3, 4), (7, 4), (5, 1), (9, 1), (1, 1)])
    case .executive:
        // 응접 세트를 방 가운데에 — 두 사람이 멀찍이 앉고 가운데서 손님을 맞는 모양.
        return spots([(4, 4), (4, 3), (8, 1), (9, 4), (9, 1)])
    case .growth:
        // 어긋난 자리 사이를 화분·소파로 메워 자유석 느낌을 만든다.
        return spots([(3, 4), (5, 1), (9, 3), (1, 1), (9, 1)])
    case .internalOps:
        // 10명이 x=1~9 를 다 쓰므로 설비는 맨 아래 줄로 내려간다.
        return spots([(2, 0), (4, 0), (6, 0), (8, 0), (9, 5)])
    }
}

/// 배치된 가구 하나.
public struct FurniturePlacement: Equatable, Sendable {
    public let kind: FurnitureKind
    public let tile: TilePoint
    public init(kind: FurnitureKind, tile: TilePoint) {
        self.kind = kind
        self.tile = tile
    }
}

/// 에이전트 한 명의 자리 — 책상과 그 뒤에 앉는 칸.
public struct DeskAssignment: Equatable, Sendable {
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
public struct DepartmentZone: Equatable, Sendable {
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
public struct OfficeFloorPlan: Sendable {
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
    public let zones: [DepartmentZone]
    /// 상단 공용 밴드의 세 구역(회의실·대표실·탕비실). 부서 구역과 달리 사람이 상주하지 않아
    /// 이름이 없으면 "가구만 놓인 빈 띠" 로 읽힌다 — 화면 위쪽 1/4 을 차지하는데도.
    public let commonAreas: [CommonArea]
}

/// 상단 공용 밴드의 한 구역. 문패를 달기 위한 이름과 가로 범위.
public struct CommonArea: Equatable, Sendable {
    public let label: String
    public let icon: String
    /// 시작 열과 폭(칸). 문패는 이 범위의 가운데에 놓인다.
    public let originX: Int
    public let width: Int
    /// 문패를 놓을 줄(격자 y). 밴드 안이라 부서 문패와 달리 좌석을 피할 필요가 없다.
    public let labelY: Int

    public init(label: String, icon: String, originX: Int, width: Int, labelY: Int) {
        self.label = label
        self.icon = icon
        self.originX = originX
        self.width = width
        self.labelY = labelY
    }
}

// 격자 규격 — 부서 구역 3열×2행 + 상단 공용 밴드.
//
// 구역 하나는 "왼쪽 벽 1칸 + 내부 9칸" 이고 오른쪽 벽은 다음 구역의 왼쪽 벽과 **같은 칸**이다.
// 예전에는 구역마다 좌우 여백을 따로 벽으로 세워 맞닿는 자리가 2칸(80px)짜리 회색 띠가 됐다.
// 그래서 열 개수는 10×3 이 아니라 10×3 + 1 — 마지막 구역의 오른쪽 벽 한 열만 더 붙인다.
private let zoneWidth = 10
private let zoneHeight = 7
private let bandHeight = 4
private let planColumns = zoneWidth * 3 + 1
private let planRows = zoneHeight * 2 + bandHeight

// 부서별 자리 배치를 다 쓴 뒤의 예비 격자 — 4열 × 3행 = 12석.
// 에이전트가 늘어 부서 배치표를 넘겼을 때 사람이 화면에서 사라지지 않게 하는 안전망이다.
private let deskColumns = 4
private let deskColumnStride = 2

/// 예비 격자(구역 상대 좌표). 부서 배치표를 다 쓴 뒤 이어서 채운다.
private let fallbackDeskSpots: [TilePoint] = (0..<12).map { index in
    TilePoint(
        x: 1 + (index % deskColumns) * deskColumnStride,
        y: zoneHeight - 3 - (index / deskColumns) * 2
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
        return spots([(1, 4), (5, 4), (9, 4), (3, 1), (7, 1)])
    case .executive:
        // 둘뿐이고 손님을 맞는 방 — 멀찍이 떨어뜨려 각자 방을 쓰는 것처럼 보이게.
        return spots([(2, 4), (6, 4), (2, 1), (6, 1)])
    case .growth:
        // 밝고 트인 방 — 줄을 맞추지 않고 어긋나게 놓아 자유석으로 읽히게 한다.
        return spots([(1, 4), (5, 4), (3, 1), (7, 1), (7, 4)])
    case .internalOps:
        // 설비가 모인 운영실 — 10명이 들어가야 해서 가장 조밀하다(5열 × 2행).
        // x=9 까지 쓰므로 집기는 y=0 줄로 밀려난다(자리·집기 충돌 회피가 자동으로 처리).
        return spots([
            (1, 4), (3, 4), (5, 4), (7, 4), (9, 4),
            (1, 1), (3, 1), (5, 1), (7, 1), (9, 1),
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
public func officeFloorPlan(agents: [ConsoleAgent]) -> OfficeFloorPlan {
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
    let bandY = zoneHeight * 2
    paint(.carpetDark, x0: 0, y0: bandY, width: zoneWidth, height: bandHeight)
    paint(.carpetLight, x0: zoneWidth, y0: bandY, width: zoneWidth, height: bandHeight)
    // 마지막 구간만 한 칸 넓다 — 벽 공유로 늘어난 오른쪽 끝 열(planColumns - 1)까지 덮는다.
    paint(.ceramic, x0: zoneWidth * 2, y0: bandY, width: zoneWidth + 1, height: bandHeight)
    // 최상단 한 줄은 벽 — 화면 위쪽에 사무실 경계를 만든다.
    paint(.wall, x0: 0, y0: planRows - 1, width: planColumns, height: 1)
    for x in 0..<planColumns {
        blocked.insert(TilePoint(x: x, y: planRows - 1))
    }

    // 밴드 안쪽 두 줄(bandY+1, bandY+2)에만 가구를 놓는다. 맨 아래 줄(bandY)은 부서에서
    // 대표실 줄까지 올라오는 가로 통로이므로 비워 두고, 맨 위 줄은 벽이다.
    //
    // 회의실 — 회의 테이블·화이트보드에 자료 코너(책장·복합기)를 붙였다. 테이블 하나만
    // 두면 10칸 폭에서 왼쪽 절반이 빈 바닥으로 남는다.
    place(.meetingTable, 4, bandY + 1)
    place(.whiteboard, 2, planRows - 1)
    place(.whiteboard, 6, planRows - 1)
    place(.bookshelf, 0, bandY + 2)
    place(.bookshelf, 1, bandY + 2)
    place(.plantTall, 3, bandY + 2)
    place(.printer, 9, bandY + 2)
    place(.plantSmall, 8, bandY + 1)

    // 대표실 — 대표는 밴드 가운데 서 있고, 그 앞줄이 승인 대기 줄이 된다.
    // 대표 앞 칸(bandY+1)은 비워 둔다: 줄 선 사람과 대표 사이의 면담 공간이고,
    // 여기 책상을 놓으면 서 있는 대표와 겹치지 않아 가구가 붕 떠 보인다.
    let presidentTile = TilePoint(x: zoneWidth + zoneWidth / 2, y: bandY + 2)
    place(.plantTall, zoneWidth + 1, bandY + 2)
    place(.sofa2, zoneWidth + 2, bandY + 2)
    place(.coffeeTable, zoneWidth + 3, bandY + 2)
    // 시계는 대표 머리 위를 피한다 — 같은 열에 두면 "나 (대표)" 라벨과 겹쳐 둘 다 안 읽힌다.
    place(.clock, zoneWidth + 2, planRows - 1)
    place(.bookshelf, zoneWidth + zoneWidth - 2, bandY + 2)
    place(.bookshelf, zoneWidth + zoneWidth - 1, bandY + 2)

    // 탕비실 겸 라운지 — 커피·정수기·소파.
    let pantryX = zoneWidth * 2
    place(.plantTall, pantryX, bandY + 2)
    place(.coffeeMachine, pantryX + 1, bandY + 2)
    place(.waterCooler, pantryX + 3, bandY + 2)
    place(.sofa3, pantryX + 5, bandY + 2)
    place(.coffeeTable, pantryX + 6, bandY + 1)
    place(.sofa2, pantryX + 8, bandY + 2)
    place(.trash, pantryX + 9, bandY + 1)

    // 상단 밴드 세 구역의 문패. 부서 문패는 구역 **중앙**에 놓이므로, 이쪽은 **왼쪽 끝**에
    // 붙여 x 가 겹치지 않게 한다(밴드 맨 아래 줄과 위 구역 문패가 같은 높이대에 있다).
    let commonAreas = [
        CommonArea(label: "회의실", icon: "🗣", originX: 0, width: zoneWidth, labelY: bandY),
        CommonArea(label: "대표실", icon: "👑", originX: zoneWidth, width: zoneWidth, labelY: bandY),
        CommonArea(
            label: "탕비실", icon: "☕", originX: zoneWidth * 2, width: zoneWidth + 1,
            labelY: bandY
        ),
    ]

    // 승인 대기 줄 — 대표 바로 아래 가로 한 줄(왼쪽부터 채운다).
    let queueTiles = (0..<6).map { index in
        TilePoint(x: zoneWidth + 2 + index, y: bandY)
    }
    // 휴식 자리 — 소파·커피 앞 칸.
    let loungeTiles = [
        TilePoint(x: pantryX + 5, y: bandY + 1),
        TilePoint(x: pantryX + 8, y: bandY + 1),
        TilePoint(x: pantryX + 1, y: bandY + 1),
    ]

    // === 부서 구역 ===
    let presentDepartments = zoneOrder.filter { candidate in
        agents.contains { $0.resolvedDepartment == candidate }
    }
    for (index, zoneDepartment) in presentDepartments.enumerated() {
        let column = index % 3
        let row = index / 3
        let originX = column * zoneWidth
        // row 0 이 위(밴드 바로 아래), row 1 이 아래.
        let originY = row == 0 ? zoneHeight : 0
        zones.append(
            DepartmentZone(
                department: zoneDepartment,
                origin: TilePoint(x: originX, y: originY),
                // 좌우 벽을 모두 포함한 폭. 인접 구역과 벽 한 칸을 공유하므로 구역 사각형은
                // 벽에서 겹친다 — 문패 중앙 계산과 벽 열 판정이 이 값을 본다.
                width: zoneWidth + 1,
                height: zoneHeight
            )
        )
        // 구역 바닥은 부서마다 다른 재질 — 부서 경계를 선이 아니라 바닥으로 보여준다.
        // 예전에는 `index % 2` 로 밝은/어두운 카펫을 번갈아 써서 여섯 방이 두 종류로만 보였다.
        // 세로는 구역 전체 높이를 칠한다 — 천장 줄은 뒤에서 벽이 덮고, 벽이 없는 위 구역
        // 맨 윗줄은 방 바닥으로 남아 통로가 방 안을 갈라 보이게 하지 않는다.
        paint(
            departmentFloor(zoneDepartment),
            x0: originX + 1,
            y0: originY,
            width: zoneWidth - 1,
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
        let seatTiles = Set(desks.map(\.seat))
        let furnitureSpots = departmentFurnitureSpots(zoneDepartment).map {
            TilePoint(x: originX + $0.x, y: originY + $0.y)
        }
        var spotCursor = 0
        for kind in departmentFurniture(zoneDepartment) {
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

    // === 부서 구역 칸막이 벽 ===
    // 구역 사이 벽은 **한 칸을 두 방이 공유한다.** 구역마다 자기 좌우 여백을 따로 세우면
    // 맞닿는 자리가 2칸이 되어, 화면에서 방 사이가 80픽셀짜리 회색 띠로 벌어진다.
    //
    // 세로 여백은 전부 벽. 가로 여백은 아래 구역 천장(zoneHeight - 1)만 벽으로 막고 문 한 칸을
    // 남긴다 — 위 구역 천장은 밴드로 나가는 통로라 열어 둔다. 즉 아래 구역 → 문 → 위 구역 →
    // 밴드 순으로 이어지며, 이 연결은 좌석·줄·휴식 자리 도달성 테스트가 지킨다.
    let zoneAreaRows = zoneHeight * 2
    func raiseWall(_ x: Int, _ y: Int) {
        guard x >= 0, y >= 0, x < planColumns, y < zoneAreaRows else {
            return
        }
        floor[y][x] = .wall
        blocked.insert(TilePoint(x: x, y: y))
    }
    for column in 0..<3 {
        let originX = column * zoneWidth
        for y in 0..<zoneAreaRows {
            raiseWall(originX, y)
            // 오른쪽 벽은 다음 구역의 왼쪽 벽과 같은 칸이다(마지막 구역은 격자 끝 열).
            raiseWall(originX + zoneWidth, y)
        }
        // 문은 책상 열(originX + 1, 3, 5, 7)을 피해 오른쪽 끝 빈 열에 낸다.
        let doorX = originX + zoneWidth - 2
        for x in originX...(originX + zoneWidth) where x != doorX {
            raiseWall(x, zoneHeight - 1)
        }
    }

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
        zones: zones,
        commonAreas: commonAreas
    )
}
