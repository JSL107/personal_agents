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

/// 구역 열 수 인자(`--zone-columns 2`)를 읽는다. 2 · 3 만 받고 나머지는 nil.
///
/// **아무 숫자나 통과시키면 크래시한다.** 배치 격자는 두 규격뿐이라 `officePlanSize` 가
/// `precondition` 으로 막는데, 그 자리에서 죽으면 사용자가 보는 것은 오타를 알려주는 메시지가
/// 아니라 스택 트레이스다. `nan`·`inf` 는 한술 더 떠서 `Int` 변환 자체가 런타임 트랩이라
/// (`Int(Double.nan)`) 값을 확인해 보기도 전에 프로세스가 끝난다.
///
/// 소수도 받지 않는다 — `2.7` 을 조용히 2 로 깎으면 사용자가 요청한 것과 다른 배치가 나오고,
/// 그 차이를 화면에서 알아챌 방법이 없다.
///
/// 실행 파일이 아니라 여기 있는 이유는 테스트다. `main.swift` 안에 두면 검증 러너가 닿지 못해
/// 파싱 규칙이 확인되지 않은 채 남는다(`officeParseRenderSize` 와 같은 이유).
public func officeParseZoneColumns(_ raw: String) -> Int? {
    // 범위를 **Int 로 바꾸기 전에** 좁힌다. 큰 값(`1e30`)은 유한하고 정수이기도 해서
    // 앞의 검사를 전부 통과하는데, 그 상태로 변환하면 오버플로로 트랩한다.
    guard let value = Double(raw), value.isFinite, value == value.rounded(),
        value == 2 || value == 3
    else {
        return nil
    }
    return Int(value)
}
