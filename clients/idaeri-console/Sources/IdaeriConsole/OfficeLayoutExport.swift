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
    /// 차지하는 칸 수. 두 칸 이상이면 기준 칸 중앙이 아니라 점유 범위 중앙에 놓인다 —
    /// 받는 쪽이 모르면 2칸 깔개가 좌우로 반 칸씩 삐져나간다.
    let footprintWidth: Int
    let footprintHeight: Int
    /// 바닥 깔개는 다른 가구·사람보다 **뒤에** 그린다. 앞뒤를 y 로 정하는 구조에서 깔개가
    /// 자기보다 위 칸의 소파를 덮기 때문이다.
    let floorDecor: Bool
}

/// 그리는 쪽이 되계산할 수 없는 척도값. 스프라이트 배율과 라벨 자리가 여기서 나온다.
///
/// 라벨 상수를 함께 싣는 이유는 **문패와 이름표가 서로를 피하는 계산이 두 값의 관계로만
/// 성립하기 때문**이다. 받는 쪽이 하나라도 다른 숫자를 쓰면 그 방 가운데 좌석의 이름이
/// 문패에 통째로 가려진다 — 맥 앱에서 실제로 겪은 사고다.
struct OfficeRenderMetrics: Codable {
    /// 스프라이트 원본이 그려진 기준 타일 크기(px). 배율 = 타일크기 ÷ 이 값.
    let referenceTileSize: Double
    let characterScaleFactor: Double
    /// 앉은 캐릭터를 책상 쪽으로 내리는 양(타일 배수).
    let seatedSpriteDrop: Double
    /// 앉은 캐릭터 스프라이트 높이(타일 배수). 이름표를 머리 위에 올리는 기준.
    let seatedSpriteTiles: Double
    /// 벽걸이를 발밑에서 벽면 중턱으로 올리는 양(타일 배수).
    let wallMountLiftTiles: Double
    /// 창이 걸치는 벽 줄 수.
    let outerWallRows: Int

    // MARK: 이름표·문패
    let nameplateFontTiles: Double
    let nameplateMinFontSize: Double
    let nameplateGapTiles: Double
    let nameplatePlatePadding: Double
    let nameplateClearancePadding: Double
    /// 이름표가 이웃과 겹치기 시작하는 타일 크기(px). 그 아래에서는 일부만 남긴다.
    let nameplateCrowdedTileSize: Double
    let labelBoxRatio: Double
    let labelFontName: String
    let labelSeparationMinPixels: Double
    let zoneLabelGapTiles: Double
    let zoneLabelMinFontSize: Double
    let commonAreaLabelGapTiles: Double
    let bubbleFontTiles: Double
    let bubbleMaxLines: Double

    // MARK: 책상 위
    let deskPaperMaxCount: Int
    let deskPaperOriginTiles: [Double]
    let deskPaperStepTiles: Double
    let deskPaperJitterTiles: Double
    let deskPaperSpreadGrowth: Double
    let deskPropOriginTiles: [Double]
    let deskScreenWidthRatio: Double
    let deskScreenHeightRatio: Double
    let deskScreenBottomRatio: Double

    /// 자리를 비운 지 이만큼 지난 세션은 사무실에서 지운다(초).
    let sessionLeaveAfterSeconds: Double
}

/// 사람 한 명의 외형. 누가 어떤 얼굴·머리·옷을 쓰는지는 **방 구성에 따라** 정해지므로
/// (같은 방에서 얼굴이 겹치지 않게 미는 규칙) 받는 쪽이 혼자 계산할 수 없다.
struct AgentLookInfo: Codable {
    /// 캐릭터 시트 접두어(`char`·`charb`…). 파일명은 `<시트>-<자세>.png`.
    let sheet: String
    let hair: [Double]
    let shirt: [Double]
    let pants: [Double]
    /// 화면에 쓰는 직책명. 백엔드 표시명은 슬랙·문서와 공유하는 영문 식별명이라 바꿔 부른다.
    let roleLabel: String
    /// 이 사람 책상에 놓을 개인 소품 스프라이트.
    let deskProp: String
}

/// 내보내는 한 덩어리 — 평면도 + 그리는 데 필요한 이름표.
struct OfficeLayoutExport: Codable {
    let plan: OfficeFloorPlan
    /// 바닥 타일 이름 → 스프라이트 파일명.
    let floorSprites: [String: String]
    /// 바닥 타일 이름 → 배경으로 누르는 세기(0~1). 원본 텍스처 밝기가 종류마다 달라
    /// 받는 쪽이 추론할 수 없다 — 빠지면 방마다 조명이 다른 화면이 된다.
    let floorMute: [String: Double]
    /// 가구 종류 이름 → 그리기 정보.
    let furniture: [String: FurnitureRenderInfo]
    /// 부서 이름 → 표시색 RGB(0~1). 벽·바닥에 옅게 태워 방을 구분한다.
    let departmentColors: [String: [Double]]
    /// 부서 이름 → 문패에 쓰는 아이콘·한글 이름.
    let departmentLabels: [String: [String]]
    /// 상태 이름 → 발밑 링 색 RGB(0~1).
    let stateColors: [String: [Double]]
    /// agentType → 외형. 스냅샷 시점의 방 구성으로 정해진다.
    let agentLooks: [String: AgentLookInfo]
    /// 시간대 이름 → 창유리·바닥 빛. 받는 쪽이 시각만 보고 고른다.
    let daylight: [String: DaylightInfo]
    /// 대표실 안쪽 줄의 작업 책상 자리(왼쪽부터). 로컬 편집기 세션이 여기 켜진다.
    let sessionDesks: [TilePoint]
    /// 유휴 산책이 갈 수 있는 자리. 어느 가구 앞에 어느 쪽을 보고 몇 초 머무는지까지.
    let strollSpots: [StrollSpotInfo]
    let metrics: OfficeRenderMetrics
}

/// 산책 목적지 하나. 좌표를 받는 쪽이 다시 추측하면 문 앞처럼 서면 안 되는 칸을 고른다.
struct StrollSpotInfo: Codable {
    let kind: String
    let tile: TilePoint
    let dwellSeconds: Double
    let facing: String
    let pose: String
}

/// 한 시간대의 창유리 색과 실내로 떨어지는 빛.
struct DaylightInfo: Codable {
    let skyHigh: [Double]
    let skyLow: [Double]
    let glow: [Double]
    let glowStrength: Double
    let lampLit: Bool
    /// 이 시간대에 해당하는 시(24시간). 받는 쪽이 지금 시각으로 구간을 고른다.
    let hours: [Int]
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
    var floorMute: [String: Double] = [:]
    for tile in FloorTile.allCases {
        floorSprites[tile.rawValue] = floorSpriteName(tile)
        floorMute[tile.rawValue] = tile.muteStrength
    }
    var furniture: [String: FurnitureRenderInfo] = [:]
    for kind in FurnitureKind.allCases {
        furniture[kind.rawValue] = FurnitureRenderInfo(
            sprite: furnitureSpriteName(kind),
            sizeBoost: kind.sizeBoost,
            wallMounted: kind.isWallMounted,
            doorway: kind.isDoorway,
            footprintWidth: kind.footprint.width,
            footprintHeight: kind.footprint.height,
            floorDecor: kind.isFloorDecor
        )
    }
    var departmentColors: [String: [Double]] = [:]
    var departmentLabels: [String: [String]] = [:]
    for department in Department.allCases {
        let palette = agentDepartmentPaletteRGBA(department)
        departmentColors[department.rawValue] = [palette.red, palette.green, palette.blue]
        departmentLabels[department.rawValue] = [department.icon, department.label]
    }
    var stateColors: [String: [Double]] = [:]
    for state in [
        ConsoleAgentState.completed, .inProgress, .awaitingApproval, .awaitingIntegration,
        .waiting, .failed,
    ] {
        let palette = agentStatePaletteRGBA(state)
        stateColors[state.rawValue] = [palette.red, palette.green, palette.blue]
    }
    // 얼굴·머리색은 **방 단위로** 정한다. 사람 하나만 보고 해시로 뽑으면 같은 방에서 같은
    // 얼굴이 나오는데(시트 5 × 머리 5 = 25조합에 한 방 최대 10명), 옆자리와 똑같이 생긴
    // 사람은 이름표를 읽기 전엔 구별되지 않는다. 받는 쪽은 그 방에 누가 있는지 모르므로
    // 여기서 배정해 넘긴다.
    let roommateLooks = Dictionary(grouping: agents, by: \.resolvedDepartment)
        .values
        .map { officeCharacterLooks(forRoommates: $0.map(\.agentType)) }
        .reduce(into: [String: CharacterLook]()) { merged, looks in
            merged.merge(looks) { current, _ in current }
        }
    var agentLooks: [String: AgentLookInfo] = [:]
    for agent in agents {
        let look = roommateLooks[agent.agentType] ?? characterLook(for: agent.agentType)
        let hair = hairPalette[look.hairIndex]
        let shirt = officeShirtColorRGB(
            department: agent.resolvedDepartment, shift: look.shirtShift
        )
        let pants = pantsPalette[look.pantsIndex]
        agentLooks[agent.agentType] = AgentLookInfo(
            sheet: characterSheetPrefixes[
                min(max(look.sheetIndex, 0), characterSheetPrefixes.count - 1)
            ],
            hair: [hair.red, hair.green, hair.blue],
            shirt: [shirt.red, shirt.green, shirt.blue],
            pants: [pants.red, pants.green, pants.blue],
            roleLabel: agentRoleLabel(for: agent.agentType) ?? agent.displayName,
            deskProp: officeDeskProp(agentType: agent.agentType)
        )
    }
    var daylight: [String: DaylightInfo] = [:]
    for phase in OfficeDaylight.allCases {
        // 어느 시각이 어느 구간인지는 `officeDaylight(hour:)` 하나가 정한다 — 받는 쪽이
        // 경계를 다시 적으면 자정·해질녘처럼 사람이 눈치채기 어려운 시각에서만 어긋난다.
        let hours = (0..<24).filter { officeDaylight(hour: $0) == phase }
        guard let representative = hours.first else {
            continue
        }
        let light = officeWindowLight(hour: representative)
        daylight[phase.rawValue] = DaylightInfo(
            skyHigh: [light.skyHigh.red, light.skyHigh.green, light.skyHigh.blue],
            skyLow: [light.skyLow.red, light.skyLow.green, light.skyLow.blue],
            glow: [light.glow.red, light.glow.green, light.glow.blue],
            glowStrength: light.glowStrength,
            lampLit: light.lampLit,
            hours: hours
        )
    }
    let export = OfficeLayoutExport(
        plan: plan,
        floorSprites: floorSprites,
        floorMute: floorMute,
        furniture: furniture,
        departmentColors: departmentColors,
        departmentLabels: departmentLabels,
        stateColors: stateColors,
        agentLooks: agentLooks,
        daylight: daylight,
        sessionDesks: officeSessionDesks(plan: plan),
        strollSpots: officeStrollSpots(plan: plan).map { spot in
            StrollSpotInfo(
                kind: spot.kind.rawValue,
                tile: spot.tile,
                dwellSeconds: spot.dwellSeconds,
                facing: spot.facing.rawValue,
                pose: spot.pose.rawValue
            )
        },
        metrics: OfficeRenderMetrics(
            referenceTileSize: officeReferenceTileSize,
            characterScaleFactor: officeCharacterScaleFactor,
            seatedSpriteDrop: officeSeatedSpriteDrop,
            seatedSpriteTiles: officeSeatedSpriteTiles,
            wallMountLiftTiles: officeWallMountLiftTiles,
            outerWallRows: officeOuterWallRows,
            nameplateFontTiles: officeNameplateFontTiles,
            nameplateMinFontSize: officeNameplateMinFontSizeValue,
            nameplateGapTiles: officeNameplateGapTiles,
            nameplatePlatePadding: officeNameplatePlatePadding,
            nameplateClearancePadding: officeNameplateClearancePadding,
            nameplateCrowdedTileSize: officeNameplateCrowdedTileSize,
            labelBoxRatio: officeLabelBoxRatio,
            labelFontName: officeLabelFontName,
            labelSeparationMinPixels: officeLabelSeparationMinPixels,
            zoneLabelGapTiles: officeZoneLabelGapTiles,
            zoneLabelMinFontSize: officeZoneLabelMinFontSizeValue,
            commonAreaLabelGapTiles: officeCommonAreaLabelGapTiles,
            bubbleFontTiles: officeBubbleFontTiles,
            bubbleMaxLines: officeBubbleMaxLines,
            deskPaperMaxCount: officeDeskPaperMaxCount,
            deskPaperOriginTiles: [
                officeDeskPaperOriginTiles.x, officeDeskPaperOriginTiles.y,
            ],
            deskPaperStepTiles: officeDeskPaperStepTiles,
            deskPaperJitterTiles: officeDeskPaperJitterTiles,
            deskPaperSpreadGrowth: officeDeskPaperSpreadGrowth,
            deskPropOriginTiles: [
                officeDeskPropOriginTiles.x, officeDeskPropOriginTiles.y,
            ],
            deskScreenWidthRatio: officeDeskScreenWidthRatio,
            deskScreenHeightRatio: officeDeskScreenHeightRatio,
            deskScreenBottomRatio: officeDeskScreenBottomRatio,
            sessionLeaveAfterSeconds: officeSessionLeaveAfterSeconds
        )
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
