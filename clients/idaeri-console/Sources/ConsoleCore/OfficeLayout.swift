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

/// `count` 개를 `width`×`height` 씬의 **하단 격자 영역**(상단 `bandHeight` 는 대표실 밴드로 비움)에
/// 위→아래·왼→오 격자로 배치한 중심 좌표. 좌표계는 SpriteKit 기본(원점 좌하단, y 위로 증가).
/// `bandHeight` 기본값 0 이면 씬 전체를 격자로 쓴다(Phase 3 동작).
public func officeLayout(
    count: Int,
    width: Double,
    height: Double,
    columns: Int,
    bandHeight: Double = 0
) -> [OfficePoint] {
    guard count > 0, columns > 0, width > 0, height > 0 else {
        return []
    }
    let gridHeight = max(height - max(bandHeight, 0), 1)
    let effectiveColumns = min(columns, count)
    let rows = Int((Double(count) / Double(effectiveColumns)).rounded(.up))
    let cellWidth = width / Double(effectiveColumns)
    let cellHeight = gridHeight / Double(max(rows, 1))
    var points: [OfficePoint] = []
    for index in 0..<count {
        let column = index % effectiveColumns
        let row = index / effectiveColumns
        let x = cellWidth * (Double(column) + 0.5)
        let y = gridHeight - cellHeight * (Double(row) + 0.5)
        points.append(OfficePoint(x: x, y: y))
    }
    return points
}

/// 대표실 밴드(씬 상단 `bandHeight` 높이) 안에 `order` 순번을 가로 균등 배치한 좌표.
/// 승인 대기·소집된 원이 자기 자리에서 여기로 직선 이동해 집결한다.
public func presidentBandSlot(
    order: Int,
    count: Int,
    width: Double,
    height: Double,
    bandHeight: Double
) -> OfficePoint {
    guard count > 0, bandHeight > 0, width > 0 else {
        return OfficePoint(x: width / 2, y: height)
    }
    let y = height - bandHeight / 2
    let x = width * (Double(order) + 0.5) / Double(count)
    return OfficePoint(x: x, y: y)
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

/// 상태 6종의 표시 색(0~1 RGB). Notion 심화편 팔레트. SwiftUI Color·SKColor 가 공통으로 참조한다.
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
    case .failed:
        return (0.90, 0.30, 0.24)  // 코랄 레드
    }
}

/// 렌더 크기 인자(`--size 980x680`)를 읽는다.
///
/// 타일 한 칸은 `min(너비 / 열, 높이 / 줄)` 이라 **창 비율에 따라 병목이 가로에서 세로로 옮겨
/// 간다.** 그래서 격자 규격을 바꾸면 어떤 창에서는 타일이 그대로이고 어떤 창에서는 작아지는데,
/// 렌더 크기가 한 값으로 고정돼 있으면 그 차이를 확인할 방법이 없다.
///
/// 못 읽는 값은 **nil 로 돌려보내 기본 크기를 쓰게 한다.** 여기서 0 이나 음수를 통과시키면
/// 씬이 만들어지긴 하는데 타일 크기가 0 이나 음수가 되어, 아무것도 안 그려진 그림이 정상
/// 결과처럼 저장된다 — 회귀 확인이 조용히 눈멀게 된다.
public func officeParseRenderSize(_ raw: String) -> (width: Double, height: Double)? {
    let parts = raw.lowercased().split(separator: "x")
    guard parts.count == 2,
        let width = Double(parts[0]),
        let height = Double(parts[1]),
        width > 0,
        height > 0
    else {
        return nil
    }
    return (width, height)
}
