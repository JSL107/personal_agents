import ConsoleCore
import Foundation

/// 사무실 평면도를 JSON 으로 내보낸다 — 다른 기기의 앱이 **같은 배치**를 그리게 하는 통로.
///
///     swift run IdaeriConsole --layout-json /tmp/layout.json --zone-columns 3
///
/// 배치 규칙을 옮겨 적지 않고 여기서 계산한 결과만 넘기는 이유는, 좌석이 한 칸이라도 어긋나면
/// 두 화면이 서로 다른 사무실이 되기 때문이다. 규칙은 `officeFloorPlan` 한 곳에만 둔다.
///
/// 격자 열 수는 창 비율이 정하므로(세로로 긴 창은 2열×3행) 부르는 쪽이 넘긴다.
/// `--zone-columns 2` 처럼 숫자 인자를 읽는다. 없거나 형식이 틀리면 nil 이라 호출부가 기본값을 쓴다.
func doubleArgument(named name: String) -> Double? {
    guard let index = CommandLine.arguments.firstIndex(of: name),
        index + 1 < CommandLine.arguments.count
    else {
        return nil
    }
    return Double(CommandLine.arguments[index + 1])
}

/// 가구 한 종류를 그리는 데 필요한 값. 받는 쪽이 종류별 규칙을 다시 짜지 않게 함께 보낸다 —
/// 규칙이 두 곳에 생기면 새 가구를 넣을 때 한쪽만 고쳐져 조용히 어긋난다.
struct FurnitureRenderInfo: Codable {
    let sprite: String
    /// 큰 가구만 키운다(캐릭터를 한 칸으로 줄인 만큼 상대적으로 작아 보이는 것을 되돌림).
    let sizeBoost: Double
    /// 벽에 거는 물건은 발밑이 아니라 벽면 중턱에 걸린다.
    let wallMounted: Bool
    let doorway: Bool
}

/// 내보내는 한 덩어리 — 평면도 + 그리는 데 필요한 이름표.
struct OfficeLayoutExport: Codable {
    let plan: OfficeFloorPlan
    /// 바닥 타일 이름 → 스프라이트 파일명.
    let floorSprites: [String: String]
    /// 가구 종류 이름 → 그리기 정보.
    let furniture: [String: FurnitureRenderInfo]
}

func exportOfficeLayout(client: ConsoleClient, path: String, zoneColumns: Int) -> Bool {
    let snapshot = fetchSnapshotSynchronously(client: client)
    guard let agents = snapshot?.agents, !agents.isEmpty else {
        // 사람이 0명이면 좌석도 0개다. 그런 평면도를 성공으로 저장하면 받는 쪽은 빈 사무실을
        // 정상으로 읽는다 — 백엔드가 꺼져 있었다는 사실이 그림에서 사라진다.
        FileHandle.standardError.write(
            Data("평면도를 내보내지 못했다 — 스냅샷이 비었다 (백엔드와 IDAERI_CONSOLE_URL 확인)\n".utf8)
        )
        return false
    }
    let plan = officeFloorPlan(agents: agents, zoneColumns: zoneColumns)
    var floorSprites: [String: String] = [:]
    for tile in FloorTile.allCases {
        floorSprites[tile.rawValue] = floorSpriteName(tile)
    }
    var furniture: [String: FurnitureRenderInfo] = [:]
    for kind in FurnitureKind.allCases {
        furniture[kind.rawValue] = FurnitureRenderInfo(
            sprite: furnitureSpriteName(kind),
            sizeBoost: kind.sizeBoost,
            wallMounted: kind.isWallMounted,
            doorway: kind.isDoorway
        )
    }
    let export = OfficeLayoutExport(
        plan: plan, floorSprites: floorSprites, furniture: furniture
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    do {
        let data = try encoder.encode(export)
        try data.write(to: URL(fileURLWithPath: path))
        FileHandle.standardOutput.write(
            Data(
                "평면도 저장: \(path) — \(plan.columns)x\(plan.rows) 칸, 자리 \(plan.desks.count)개,"
                    .appending(" 가구 \(plan.furniture.count)개, \(data.count) bytes\n").utf8
            )
        )
        return true
    } catch {
        FileHandle.standardError.write(Data("평면도 저장 실패: \(error)\n".utf8))
        return false
    }
}
