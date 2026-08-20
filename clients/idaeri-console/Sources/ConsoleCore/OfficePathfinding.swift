import Foundation

/// 격자 위 최단 경로(BFS). 이동 비용이 칸마다 같고 맵이 작아 A* 가 필요 없다.
///
/// 반환 경로는 `start` 를 제외하고 `goal` 까지의 칸들이다(이동할 목적지들의 순서).
/// 도달 불가면 빈 배열 — 호출자는 걷지 않고 목적지로 순간 이동시키거나 그대로 둔다.
///
/// `goal` 이 walkable 이 아니어도 좋다(책상 앞처럼 막힌 칸을 목표로 삼는 경우는 없지만,
/// 좌석은 walkable 에 포함돼 있어 그대로 도착한다).
public func officePath(
    from start: TilePoint,
    to goal: TilePoint,
    walkable: Set<TilePoint>
) -> [TilePoint] {
    if start == goal {
        return []
    }
    guard walkable.contains(goal) else {
        return []
    }

    var cameFrom: [TilePoint: TilePoint] = [:]
    var visited: Set<TilePoint> = [start]
    var queue: [TilePoint] = [start]
    var head = 0

    while head < queue.count {
        let current = queue[head]
        head += 1
        for next in orthogonalNeighbors(of: current) {
            guard walkable.contains(next), !visited.contains(next) else {
                continue
            }
            visited.insert(next)
            cameFrom[next] = current
            if next == goal {
                return reconstruct(from: start, to: goal, cameFrom: cameFrom)
            }
            queue.append(next)
        }
    }
    return []
}

/// 상하좌우 4방향. 대각선을 빼는 이유는 캐릭터가 책상 모서리를 가로지르지 않게 하기 위함이다.
/// 상하좌우 네 칸. 길찾기와 문 여닫이 판정(`officeDoorIsOpen`)이 같은 정의를 쓴다.
func orthogonalNeighbors(of tile: TilePoint) -> [TilePoint] {
    [
        TilePoint(x: tile.x + 1, y: tile.y),
        TilePoint(x: tile.x - 1, y: tile.y),
        TilePoint(x: tile.x, y: tile.y + 1),
        TilePoint(x: tile.x, y: tile.y - 1),
    ]
}

private func reconstruct(
    from start: TilePoint,
    to goal: TilePoint,
    cameFrom: [TilePoint: TilePoint]
) -> [TilePoint] {
    var path: [TilePoint] = []
    var cursor = goal
    while cursor != start {
        path.append(cursor)
        guard let previous = cameFrom[cursor] else {
            return []
        }
        cursor = previous
    }
    return path.reversed()
}

/// 캐릭터가 바라보는 방향. 걸음의 마지막 한 칸이 방향을 정한다.
public enum Facing: String, Sendable {
    case down
    case up
    case left
    case right
}

/// 한 칸 이동이 어느 방향인지. 이동이 없으면 nil(직전 방향 유지).
public func facing(from: TilePoint, to: TilePoint) -> Facing? {
    if to.x > from.x {
        return .right
    }
    if to.x < from.x {
        return .left
    }
    if to.y > from.y {
        return .up
    }
    if to.y < from.y {
        return .down
    }
    return nil
}

/// `start` 에서 걸어서 닿을 수 있는 칸 전부(BFS 한 번).
///
/// **`walkable` 은 "막히지 않은 칸"이지 "갈 수 있는 칸"이 아니다.** 사방이 가구·벽으로
/// 둘러싸인 한 칸은 walkable 로 남아 있어도 아무도 그 자리에 갈 수 없다 — 운영실에서 실제로
/// 자판기·프린터·워터쿨러를 한 줄에 놓자 그 사이 칸이 그렇게 갇혔고, 그 칸이 프린터의
/// 유일한 walkable 이웃이어서 목적지로 뽑혔다. 걸으라고 지시받은 사람은 경로가 빈 채로
/// 남아 자기 책상에서 프린터 앞 동작만 재생했다.
///
/// 후보마다 `officePath` 를 부르면 목적지 카탈로그를 만들 때마다 A* 를 수십 번 돌리게 되므로
/// (8초마다 한 번), 한 번의 flood fill 로 집합을 만들어 여러 후보가 나눠 쓴다.
public func officeReachableTiles(
    from start: TilePoint,
    walkable: Set<TilePoint>
) -> Set<TilePoint> {
    var visited: Set<TilePoint> = [start]
    var queue: [TilePoint] = [start]
    var head = 0
    while head < queue.count {
        let current = queue[head]
        head += 1
        for next in orthogonalNeighbors(of: current)
        where walkable.contains(next) && !visited.contains(next) {
            visited.insert(next)
            queue.append(next)
        }
    }
    return visited
}
