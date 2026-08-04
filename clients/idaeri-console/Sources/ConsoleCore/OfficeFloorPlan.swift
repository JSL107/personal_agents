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

/// 캐릭터 전용 배율 계수. 원본이 앉기 57px·서기 54px 이라 계수 1 이면 사람이 1.35~1.43칸을
/// 차지해 책상(0.8칸 깊이)보다 커진다. 0.75 를 곱하면 앉은 자세가 1.07칸으로 내려온다.
/// 가구 쪽 보정은 `FurnitureKind.sizeBoost` 가 갖는다 — 둘을 한 값으로 묶으면 한쪽만 조정할 수 없다.
public let officeCharacterScaleFactor: Double = 0.75

/// 앉은 캐릭터를 책상 쪽으로 내리는 양(타일 크기 배수).
///
/// 좌석이 책상 **바로 위 칸**이고 캐릭터·가구 모두 발밑 기준(anchor y = 0)이라, 그냥 두면
/// 책상 상단(0.8칸)과 사람 발밑(1칸) 사이에 0.2칸 빈틈이 생긴다. 앉은 사람이 책상에 닿지 않고
/// 공중에 뜬 것처럼 보이는 원인이다. 앉음일 때만 내려 하반신이 책상에 가리게 한다 —
/// 서 있거나 걷는 캐릭터는 발이 바닥에 닿아야 하므로 오프셋 0 을 유지한다.
public let officeSeatedSpriteDrop: Double = 0.28

/// 바닥·벽 타일 종류. 스프라이트 파일명(tile-*.png)과 1:1.
public enum FloorTile: String, Sendable, CaseIterable {
    case woodA
    case woodB
    case carpetLight
    case carpetDark
    case ceramic
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
        case .carpetDark, .wall:
            return 0.40
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

    /// 렌더 배율 보정. 캐릭터를 한 칸 크기로 줄이면 사람이 쓰는 큰 가구가 상대적으로
    /// 작아 보인다. 책상·회의 테이블·소파만 키워 "사람 폭 : 책상 폭 ≈ 1 : 2" 를 만든다.
    /// 화분·시계 같은 소품까지 키우면 방이 잡동사니로 찬 것처럼 보인다.
    public var sizeBoost: Double {
        switch self {
        case .desk, .meetingTable, .sofa2, .sofa3:
            return 1.15
        default:
            return 1.0
        }
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

// 한 부서 구역의 자리 배치 — 4열 × 3행 = 12석.
// 실제 내부 부서가 10명이라 9석(3열)으로는 한 명이 자리를 못 받아 화면에서 사라진다.
// 책상 간격을 3→2 로 좁혀 열을 늘렸다(구역 폭 10 안에 x = +1,+3,+5,+7).
// 여유 2석은 완충이며, 정원을 넘기는 순간을 테스트가 잡는다(전원 배정 검증).
private let deskColumns = 4
private let deskColumnStride = 2

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
        repeating: Array(repeating: FloorTile.woodA, count: planColumns),
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
        agents.contains { department(for: $0.agentType) == candidate }
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
            .filter { department(for: $0.agentType) == zoneDepartment }
            .map(\.agentType)
            .sorted()
        for (seatIndex, agentType) in members.enumerated() {
            let deskColumn = seatIndex % deskColumns
            let deskRow = seatIndex / deskColumns
            let deskX = originX + 1 + deskColumn * deskColumnStride
            // 자리 묶음을 구역 맨 아래 줄부터 쌓는다. 예전에는 한 칸 위(zoneHeight - 2)에서
            // 시작해 맨 윗줄 좌석이 카펫 밖 나무 바닥에 놓였다 — 화면에서 사람이 사무실
            // 밖에 걸터앉은 것처럼 보였다. 이제 책상·좌석이 전부 카펫 안에 들어간다.
            let deskY = originY + zoneHeight - 3 - deskRow * 2
            guard deskY >= originY, deskX < originX + zoneWidth else {
                // 구역 정원을 넘으면 자리를 못 받아 화면에서 사라진다. 전원 배정을 고정한
                // 테스트가 있으므로, 여기 걸리면 정원(deskColumns × 행 수)을 늘려야 한다.
                continue
            }
            place(.desk, deskX, deskY)
            desks.append(
                DeskAssignment(
                    agentType: agentType,
                    desk: TilePoint(x: deskX, y: deskY),
                    seat: TilePoint(x: deskX, y: deskY + 1)
                )
            )
        }
        // 부서 특색 가구 — 방마다 다른 세트를 놓아 문패 없이도 어느 팀 방인지 읽히게 한다.
        //
        // 자리 후보는 오른쪽 끝 열(originX + zoneWidth - 1)이 먼저다. 이 열은 책상 열(1·3·5·7)
        // 밖이라 인원이 꽉 찬 부서(내부 10명)에서도 남는다 — 예전에는 아래쪽 줄에만 놓아
        // 정원이 찬 부서는 집기가 통째로 사라졌다.
        //
        // 문 열(originX + zoneWidth - 2)은 후보에서 뺀다. 아래 구역 문과 이어지는 수직 동선이라
        // 막으면 아래 구역 전원이 고립된다(쓰레기통으로 막았다가 좌석 16개가 갇힌 적이 있다).
        // 세로 2칸짜리 회의 테이블이 천장·통로 줄을 침범하지 않도록 아래쪽 자리부터 채운다.
        let seatTiles = Set(desks.map(\.seat))
        // 오른쪽 열과 아래쪽 줄을 번갈아 후보로 둔다 — 한쪽에 몰아 놓으면 인원이 적은 방은
        // 가구가 한 줄로 늘어서고 나머지 절반이 빈 바닥으로 남는다.
        let furnitureSpots = [
            TilePoint(x: originX + zoneWidth - 1, y: originY + 1),
            TilePoint(x: originX + 1, y: originY),
            TilePoint(x: originX + zoneWidth - 1, y: originY + 3),
            TilePoint(x: originX + 3, y: originY),
            TilePoint(x: originX + zoneWidth - 1, y: originY + 5),
            TilePoint(x: originX + 5, y: originY),
        ]
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
        zones: zones
    )
}
