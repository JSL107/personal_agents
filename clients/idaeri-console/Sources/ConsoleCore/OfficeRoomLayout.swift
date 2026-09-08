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
    .planning, .quality, .evaluation, .treasury, .content, .internalOps,
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
        agents.contains { $0.resolvedDepartment == dept }
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

        let deptAgents = agents.filter { $0.resolvedDepartment == dept }
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

/// 좌상단 요약 판에 적을 줄들. 세션 구간이 있으면 **둘째 줄로 내린다.**
///
/// 한 줄로 이으면 세션 구간(`· 내 세션 19(도는 중 5)`)이 판 길이를 거의 두 배로 만든다.
/// 도면은 창이 작아지면 위로 올라오는데 이 판은 화면 좌상단에 고정이라, 최소 창에서 둘이
/// 같은 높이에서 만난다 — 720×560 에서 판 오른쪽 끝과 상단 밴드 대표 이름표 사이 여백이
/// 세션 9개에 20pt, 19개에 9pt 였다. 세션이 더 늘면 그대로 넘어간다.
///
/// 줄을 나누면 판 폭이 **첫 줄 길이로 묶인다** — 상태 세 칸은 사람 수가 두 자리여도
/// 길이가 거의 안 변하므로, 세션이 몇 개든 여백이 유지된다. 폭 상한을 두고 문구를 자르는
/// 대신 줄을 나눈 이유는, 세션 총계가 "대표 앞줄에 선 여덟" 을 전체로 오해하지 않게 하려고
/// 붙인 값이어서다 — 잘리면 그 목적이 사라진다.
public func officeCompanySummaryLines(
    summary: CompanySummary,
    sessionCount: Int,
    activeSessionCount: Int
) -> [String] {
    // "대기" 는 밀린 일감처럼 읽힌다 — 이대리에 대기 큐는 없고, 이 숫자는 **지금 맡은 일이
    // 없는 사람 수**(29명 중 27명이 예사)다. 적체로 오해하면 화면이 늘 비상처럼 보인다.
    let head =
        "진행 \(summary.inProgress)  ·  승인 \(summary.awaitingApproval)  ·  쉬는 중 \(summary.waiting)"
    guard sessionCount > 0 else {
        return [head]
    }
    return [head, "내 세션 \(sessionCount)(도는 중 \(activeSessionCount))"]
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
