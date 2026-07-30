import Foundation

/// 방 사각형(순수 값). (x, y) = 좌하단, y 는 위로 증가(SpriteKit 좌표계).
public struct OfficeRect: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

/// 한 부서의 방(사각형 + 라벨 위치).
public struct OfficeRoom: Equatable, Sendable {
    public let department: Department
    public let rect: OfficeRect
    public let labelPoint: OfficePoint
    public init(department: Department, rect: OfficeRect, labelPoint: OfficePoint) {
        self.department = department
        self.rect = rect
        self.labelPoint = labelPoint
    }
}

/// 부서 방 배치 결과 — 방 목록 + agentType → 중심 좌표.
public struct DepartmentLayout: Equatable, Sendable {
    public let rooms: [OfficeRoom]
    public let positions: [String: OfficePoint]
    public init(rooms: [OfficeRoom], positions: [String: OfficePoint]) {
        self.rooms = rooms
        self.positions = positions
    }
}

/// 부서 canonical 순서(방 배치·범례 공통).
private let departmentOrder: [Department] = [
    .planning, .engineering, .review, .executive, .growth, .internalOps,
]

/// 에이전트를 부서 방으로 그룹핑해 배치한다(순수). 상단 `bandHeight` 는 대표실로 비운다.
/// 방은 `roomColumns` 열 격자, 방 안 에이전트는 `agentColumns` 열 서브격자. 좌표는 방 라벨 아래에 배치.
public func departmentRoomLayout(
    agents: [ConsoleAgent],
    width: Double,
    height: Double,
    bandHeight: Double,
    roomColumns: Int = 3,
    agentColumns: Int = 3
) -> DepartmentLayout {
    guard width > 0, height > 0, !agents.isEmpty, roomColumns > 0, agentColumns > 0 else {
        return DepartmentLayout(rooms: [], positions: [:])
    }

    let present = departmentOrder.filter { dept in
        agents.contains { department(for: $0.agentType) == dept }
    }
    let gridHeight = max(height - max(bandHeight, 0), 1)
    let roomRows = Int((Double(present.count) / Double(roomColumns)).rounded(.up))
    let roomWidth = width / Double(roomColumns)
    let roomHeight = gridHeight / Double(max(roomRows, 1))
    let pad = 12.0
    let labelHeight = 22.0

    var rooms: [OfficeRoom] = []
    var positions: [String: OfficePoint] = [:]

    for (deptIndex, dept) in present.enumerated() {
        let roomColumn = deptIndex % roomColumns
        let roomRow = deptIndex / roomColumns
        let originX = Double(roomColumn) * roomWidth
        let topY = gridHeight - Double(roomRow) * roomHeight  // 방 상단 모서리(y-up)

        let rectX = originX + pad
        let rectY = topY - roomHeight + pad                    // 좌하단 y
        let rectWidth = roomWidth - 2 * pad
        let rectHeight = roomHeight - 2 * pad
        let rect = OfficeRect(x: rectX, y: rectY, width: rectWidth, height: rectHeight)
        let labelPoint = OfficePoint(x: rectX + 8, y: topY - pad - 8)
        rooms.append(OfficeRoom(department: dept, rect: rect, labelPoint: labelPoint))

        let deptAgents = agents.filter { department(for: $0.agentType) == dept }
        let rowCount = Int((Double(deptAgents.count) / Double(agentColumns)).rounded(.up))
        let cellWidth = rectWidth / Double(agentColumns)
        let usableHeight = rectHeight - labelHeight
        let cellHeight = usableHeight / Double(max(rowCount, 1))
        let areaTopY = rectY + rectHeight - labelHeight        // 라벨 아래 배치 시작 y

        for (agentIndex, agent) in deptAgents.enumerated() {
            let column = agentIndex % agentColumns
            let row = agentIndex / agentColumns
            let x = rectX + cellWidth * (Double(column) + 0.5)
            let y = areaTopY - cellHeight * (Double(row) + 0.5)
            positions[agent.agentType] = OfficePoint(x: x, y: y)
        }
    }

    return DepartmentLayout(rooms: rooms, positions: positions)
}

/// 상태별 전사 집계(순수).
public struct CompanySummary: Equatable, Sendable {
    public let inProgress: Int
    public let awaitingApproval: Int
    public let waiting: Int
    public let completed: Int
    public let awaitingIntegration: Int
    public init(
        inProgress: Int, awaitingApproval: Int, waiting: Int,
        completed: Int, awaitingIntegration: Int
    ) {
        self.inProgress = inProgress
        self.awaitingApproval = awaitingApproval
        self.waiting = waiting
        self.completed = completed
        self.awaitingIntegration = awaitingIntegration
    }
}

public func companySummary(agents: [ConsoleAgent]) -> CompanySummary {
    func count(_ state: ConsoleAgentState) -> Int {
        agents.filter { $0.state == state }.count
    }
    return CompanySummary(
        inProgress: count(.inProgress),
        awaitingApproval: count(.awaitingApproval),
        waiting: count(.waiting),
        completed: count(.completed),
        awaitingIntegration: count(.awaitingIntegration)
    )
}
