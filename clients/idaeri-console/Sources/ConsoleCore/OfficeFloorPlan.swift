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

/// 바닥·벽 타일 종류. 스프라이트 파일명(tile-*.png)과 1:1.
public enum FloorTile: String, Sendable, CaseIterable {
    case woodA
    case woodB
    case carpetLight
    case carpetDark
    case ceramic
    case wall
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
private let zoneWidth = 10
private let zoneHeight = 7
private let bandHeight = 4
private let planColumns = zoneWidth * 3
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
    paint(.ceramic, x0: zoneWidth * 2, y0: bandY, width: zoneWidth, height: bandHeight)
    // 최상단 한 줄은 벽 — 화면 위쪽에 사무실 경계를 만든다.
    paint(.wall, x0: 0, y0: planRows - 1, width: planColumns, height: 1)
    for x in 0..<planColumns {
        blocked.insert(TilePoint(x: x, y: planRows - 1))
    }

    // 회의실 — 긴 테이블(세로 2칸)과 벽 화이트보드.
    place(.meetingTable, 4, bandY + 1)
    place(.whiteboard, 2, planRows - 1)
    place(.plantSmall, 8, bandY + 1)

    // 대표실 — 대표는 밴드 가운데 서 있고, 그 앞줄이 승인 대기 줄이 된다.
    let presidentTile = TilePoint(x: zoneWidth + zoneWidth / 2, y: bandY + 2)
    place(.plantTall, zoneWidth + 1, bandY + 2)
    place(.clock, zoneWidth + zoneWidth / 2, planRows - 1)
    place(.bookshelf, zoneWidth + zoneWidth - 2, bandY + 2)

    // 탕비실 겸 라운지 — 커피·정수기·소파.
    let pantryX = zoneWidth * 2
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
                width: zoneWidth,
                height: zoneHeight
            )
        )
        // 구역 바닥은 카펫 — 부서 경계를 선이 아니라 바닥 재질로 보여준다.
        paint(
            index % 2 == 0 ? .carpetLight : .carpetDark,
            x0: originX + 1,
            y0: originY,
            width: zoneWidth - 2,
            height: zoneHeight - 1
        )

        let members = agents
            .filter { department(for: $0.agentType) == zoneDepartment }
            .map(\.agentType)
            .sorted()
        for (seatIndex, agentType) in members.enumerated() {
            let deskColumn = seatIndex % deskColumns
            let deskRow = seatIndex / deskColumns
            let deskX = originX + 1 + deskColumn * deskColumnStride
            let deskY = originY + zoneHeight - 2 - deskRow * 2
            guard deskY > originY, deskX < originX + zoneWidth else {
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
        // 구역 구석 장식 — 통로를 막지 않는 자리에만.
        if members.count <= 6 {
            place(.plantSmall, originX + zoneWidth - 2, originY + 1)
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
