import Foundation

/// 오피스 씬 내 배치 좌표(SpriteKit 비의존, 순수 값).
public struct OfficePoint: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// `count` 개를 `width`×`height` 씬에 위→아래·왼→오 격자로 배치한 중심 좌표.
/// 좌표계는 SpriteKit 기본(원점 좌하단, y 위로 증가)에 맞춘다.
public func officeLayout(
    count: Int,
    width: Double,
    height: Double,
    columns: Int
) -> [OfficePoint] {
    guard count > 0, columns > 0, width > 0, height > 0 else {
        return []
    }
    let effectiveColumns = min(columns, count)
    let rows = Int((Double(count) / Double(effectiveColumns)).rounded(.up))
    let cellWidth = width / Double(effectiveColumns)
    let cellHeight = height / Double(max(rows, 1))
    var points: [OfficePoint] = []
    for index in 0..<count {
        let column = index % effectiveColumns
        let row = index / effectiveColumns
        let x = cellWidth * (Double(column) + 0.5)
        let y = height - cellHeight * (Double(row) + 0.5)
        points.append(OfficePoint(x: x, y: y))
    }
    return points
}

/// 오피스 노드 동기화 diff. 현재 노드 집합과 새 목록을 비교한다.
public struct OfficeNodeDiff: Equatable, Sendable {
    public let added: [String]
    public let removed: [String]
    public init(added: [String], removed: [String]) {
        self.added = added
        self.removed = removed
    }
}

/// `existing` 에 없는 `incoming` 은 추가, `incoming` 에 없는 `existing` 은 제거 대상.
/// `added` 는 incoming 순서 보존, `removed` 는 결정론적 정렬.
public func officeNodeDiff(existing: Set<String>, incoming: [String]) -> OfficeNodeDiff {
    let incomingSet = Set(incoming)
    let added = incoming.filter { !existing.contains($0) }
    let removed = existing.subtracting(incomingSet).sorted()
    return OfficeNodeDiff(added: added, removed: removed)
}

/// 상태 5종의 표시 색(0~1 RGB). Notion 심화편 팔레트. SwiftUI Color·SKColor 가 공통으로 참조한다.
public func agentStatePaletteRGBA(
    _ state: ConsoleAgentState
) -> (red: Double, green: Double, blue: Double) {
    switch state {
    case .completed:
        return (0.36, 0.78, 0.63)  // 민트
    case .inProgress:
        return (0.96, 0.78, 0.25)  // 노랑
    case .awaitingApproval:
        return (0.91, 0.36, 0.60)  // 진한 핑크
    case .awaitingIntegration:
        return (0.62, 0.55, 0.90)  // 라벤더
    case .waiting:
        return (0.72, 0.72, 0.72)  // 흰색 계열
    }
}
