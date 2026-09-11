import AppKit
import ConsoleCore
import SpriteKit

enum SpriteLoader {
    private static var cache: [String: SKTexture] = [:]
    private static var cozyCharacterCache: [String: NSImage] = [:]
    private static var cozyRoomCache: [String: SKTexture] = [:]
    private static var cozyRoomImageCache: [String: NSImage] = [:]
    private static var cozyFurnitureCache: [String: SKTexture] = [:]
    private static var cozyAccentImageCache: [String: NSImage] = [:]

    /// 이미 한 번 알린 결손. 같은 조합이 프레임마다 로그를 다시 찍지 않게 막는다.
    private static var reportedMissingAssets: Set<String> = []

    static func cozyCharacterHasDedicatedPose(assetIndex: Int, pose: String) -> Bool {
        let normalizedIndex = ((assetIndex % cozyCharacterAssetCount) + cozyCharacterAssetCount) % cozyCharacterAssetCount
        let normalizedPose = normalizedCozyPose(pose)
        guard normalizedPose != cozyIdlePose else {
            return false
        }
        return Bundle.module.url(
            forResource: "agent-\(normalizedIndex)-\(normalizedPose)",
            withExtension: "png",
            subdirectory: "cozy/characters"
        ) != nil
    }

    /// 요청 포즈를 실재하는 에셋으로 옮긴다. 계약은 코어(`resolveCozyPose`)가 갖고 여기서는
    /// "이 파일이 번들에 있는가" 만 대답한다 — 파일 목록을 두 곳에 두면 에셋을 갈 때 어긋난다.
    static func resolvedCozyPose(assetIndex: Int, pose: String) -> ResolvedCozyPose {
        resolveCozyPose(requested: pose, assetIndex: assetIndex) { candidate in
            cozyCharacterHasDedicatedPose(assetIndex: assetIndex, pose: candidate)
        }
    }

    /// 캐릭터 그림. `pose` 는 `resolvedCozyPose` 를 지난 이름이어야 한다.
    ///
    /// **없는 포즈를 조용히 기본 그림으로 바꿔치는 것은 더 이상 정상 경로가 아니다.** 예전에는
    /// 도트 시절 이름(`down`·`side`·`-walk1`)이 매번 여기까지 내려와 폴백 로그를 수십 줄씩
    /// 쏟았다. 이제 대체는 코어의 계약이 미리 끝내므로, 여기까지 와서 파일이 없다면 계약을
    /// 건너뛴 호출이거나 에셋이 실제로 빠진 것이다 — 둘 다 한 번은 알릴 값어치가 있다.
    static func cozyCharacterImage(assetIndex: Int, pose: String = cozyIdlePose) -> NSImage? {
        let normalizedIndex = ((assetIndex % cozyCharacterAssetCount) + cozyCharacterAssetCount) % cozyCharacterAssetCount
        let normalizedPose = normalizedCozyPose(pose)
        let posedName = "agent-\(normalizedIndex)-\(normalizedPose)"
        let cacheKey = "\(normalizedIndex):\(normalizedPose)"
        if let cached = cozyCharacterCache[cacheKey] {
            return cached
        }
        let posedURL = normalizedPose == cozyIdlePose
            ? nil
            : Bundle.module.url(
                forResource: posedName, withExtension: "png", subdirectory: "cozy/characters"
            )
        let fallbackURL = Bundle.module.url(
            forResource: "agent-\(normalizedIndex)", withExtension: "png", subdirectory: "cozy/characters"
        )
        if posedURL == nil, normalizedPose != cozyIdlePose {
            reportMissingAsset("\(posedName).png — 포즈 계약을 거치지 않은 요청")
        }
        guard let url = posedURL ?? fallbackURL, let sourceImage = NSImage(contentsOf: url) else {
            reportMissingAsset("agent-\(normalizedIndex).png")
            return nil
        }
        let image = imageByCroppingTransparentMargins(sourceImage)
        cozyCharacterCache[cacheKey] = image
        return image
    }

    private static func reportMissingAsset(_ description: String) {
        guard reportedMissingAssets.insert(description).inserted else {
            return
        }
        fputs("cozy character asset missing: \(description)\n", stderr)
    }

    /// 생성 이미지마다 투명 캔버스 여백이 조금씩 달라도 실제 머리/발 경계가 같은 기준으로
    /// 배치되게 한다. 전체 1145×1374 캔버스를 기준으로 세우면 발 아래 여백까지 몸 높이로
    /// 계산되어 포즈마다 그림자에서 뜨는 양이 달라진다.
    private static func imageByCroppingTransparentMargins(_ image: NSImage) -> NSImage {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let provider = cgImage.dataProvider,
              let data = provider.data,
              let bytes = CFDataGetBytePtr(data) else {
            return image
        }
        let bytesPerPixel = cgImage.bitsPerPixel / 8
        guard bytesPerPixel > 0 else { return image }
        let alphaInfo = cgImage.alphaInfo
        guard alphaInfo != .none, alphaInfo != .noneSkipFirst, alphaInfo != .noneSkipLast else {
            return image
        }
        let alphaOffset = alphaInfo == .first || alphaInfo == .premultipliedFirst
            ? 0
            : bytesPerPixel - 1
        var minX = cgImage.width
        var minY = cgImage.height
        var maxX = -1
        var maxY = -1
        for y in 0..<cgImage.height {
            let row = y * cgImage.bytesPerRow
            for x in 0..<cgImage.width {
                if bytes[row + x * bytesPerPixel + alphaOffset] > 8 {
                    minX = min(minX, x)
                    minY = min(minY, y)
                    maxX = max(maxX, x)
                    maxY = max(maxY, y)
                }
            }
        }
        guard maxX >= minX, maxY >= minY else { return image }
        let padding = 4
        let crop = CGRect(
            x: max(0, minX - padding),
            y: max(0, minY - padding),
            width: min(cgImage.width - max(0, minX - padding), maxX - minX + 1 + padding * 2),
            height: min(cgImage.height - max(0, minY - padding), maxY - minY + 1 + padding * 2)
        ).integral
        guard let cropped = cgImage.cropping(to: crop) else { return image }
        return NSImage(
            cgImage: cropped,
            size: NSSize(width: cropped.width, height: cropped.height)
        )
    }

    static func cozyCharacterTexture(assetIndex: Int, pose: String = "idle") -> SKTexture? {
        guard let image = cozyCharacterImage(assetIndex: assetIndex, pose: pose) else {
            return nil
        }
        let texture = SKTexture(image: image)
        texture.filteringMode = .linear
        return texture
    }

    static func cozyDepartmentRoomTexture(_ department: Department) -> SKTexture? {
        cozyRoomTexture(named: "\(department.rawValue)-shell")
    }

    static func cozySharedOakFloorTexture() -> SKTexture? {
        cozyRoomTexture(named: "shared-oak-corridor")
    }

    static func cozyDepartmentRoomImage(_ department: Department) -> NSImage? {
        let name = "\(department.rawValue)-shell"
        if let cached = cozyRoomImageCache[name] { return cached }
        guard let url = Bundle.module.url(
            forResource: name,
            withExtension: "png",
            subdirectory: "cozy/rooms"
        ), let image = NSImage(contentsOf: url) else {
            return nil
        }
        cozyRoomImageCache[name] = image
        return image
    }

    static func cozyDashboardAccentImage(
        agentType: String,
        department: Department
    ) -> NSImage? {
        let roleAsset: String?
        switch agentType {
        case "VACATION":
            roleAsset = "vacation-accent"
        case "CAREER_MATE":
            roleAsset = "career-accent"
        default:
            roleAsset = nil
        }
        if let roleAsset, let image = cozyAccentImage(named: roleAsset) {
            return image
        }
        return cozyDepartmentAccentImage(department)
    }

    static func cozyDepartmentAccentImage(_ department: Department) -> NSImage? {
        // The evaluation and internal-ops renders came back with each other's strongest visual
        // metaphor. Route by meaning: charts belong to evaluation, gear/file tray to operations.
        let name: String
        switch department {
        case .evaluation:
            name = "internal-ops-accent"
        case .internalOps:
            name = "evaluation-accent"
        default:
            name = "\(department.rawValue)-accent"
        }
        return cozyAccentImage(named: name)
    }

    private static func cozyAccentImage(named name: String) -> NSImage? {
        if let cached = cozyAccentImageCache[name] { return cached }
        guard let url = Bundle.module.url(
            forResource: name,
            withExtension: "png",
            subdirectory: "cozy/props"
        ), let image = NSImage(contentsOf: url) else {
            return nil
        }
        cozyAccentImageCache[name] = image
        return image
    }

    static func cozyCommonAreaTexture(_ kind: CommonAreaKind) -> SKTexture? {
        cozyRoomTexture(named: "\(kind.rawValue)-shell")
    }

    static func cozyFurnitureTexture(_ kind: FurnitureKind) -> SKTexture? {
        let assetName: String?
        switch kind {
        case .desk:
            assetName = "workstation"
        case .chairDown, .chairUp:
            assetName = "chair"
        case .sofa2, .sofa3:
            assetName = "sofa"
        case .meetingTable, .coffeeTable:
            assetName = "meeting-table"
        case .bookshelf, .wallShelf:
            assetName = "bookshelf"
        case .coffeeMachine, .sinkCounter:
            assetName = "coffee-station"
        default:
            assetName = nil
        }
        guard let assetName else {
            return nil
        }
        return cozyFurnitureTexture(named: assetName)
    }

    /// 로봇청소기 그림. 없으면 nil 을 돌려 부르는 쪽이 도형 fallback 으로 내려간다 —
    /// 청소기는 장식이 아니라 "주간 청소가 살아 있다" 는 신호라, 번들이 어긋났다고
    /// 표시 자체가 사라지면 안 된다.
    static func cozyVacuumRobotTexture() -> SKTexture? {
        cozyFurnitureTexture(named: "vacuum-robot")
    }

    private static func cozyFurnitureTexture(named assetName: String) -> SKTexture? {
        if let cached = cozyFurnitureCache[assetName] {
            return cached
        }
        guard let url = Bundle.module.url(
            forResource: assetName,
            withExtension: "png",
            subdirectory: "cozy/furniture-3d"
        ), let image = NSImage(contentsOf: url) else {
            return nil
        }
        let texture = SKTexture(image: image)
        texture.filteringMode = .linear
        cozyFurnitureCache[assetName] = texture
        return texture
    }

    static func cozyDepartmentFeatureTexture(_ department: Department) -> SKTexture? {
        let assetName: String
        switch department {
        case .planning:
            assetName = "planning-board-table"
        case .quality:
            assetName = "quality-review-station"
        case .evaluation:
            assetName = "evaluation-kpi-console"
        case .treasury:
            assetName = "treasury-ledger-console"
        case .content:
            assetName = "content-storyboard-station"
        case .internalOps:
            assetName = "internal-ops-control-desk"
        }
        return cozyFurnitureTexture(named: assetName)
    }

    private static func cozyRoomTexture(named name: String) -> SKTexture? {
        if let cached = cozyRoomCache[name] {
            return cached
        }
        guard let url = Bundle.module.url(
            forResource: name,
            withExtension: "png",
            subdirectory: "cozy/rooms"
        ), let image = NSImage(contentsOf: url) else {
            return nil
        }
        let texture = SKTexture(image: image)
        texture.filteringMode = .linear
        cozyRoomCache[name] = texture
        return texture
    }

    static func texture(_ name: String) -> SKTexture? {
        if let cached = cache[name] {
            return cached
        }
        guard
            let url = Bundle.module.url(
                forResource: name, withExtension: "png", subdirectory: "sprites"
            ),
            let image = NSImage(contentsOf: url)
        else {
            return nil
        }
        let texture = SKTexture(image: image)
        texture.filteringMode = .nearest
        cache[name] = texture
        return texture
    }

    static func floorTexture(_ tile: FloorTile) -> SKTexture? {
        texture(floorSpriteName(tile))
    }

    static func furnitureTexture(_ kind: FurnitureKind) -> SKTexture? {
        texture(furnitureSpriteName(kind))
    }
}

/// 바닥 타일 → 스프라이트 파일명.
func floorSpriteName(_ tile: FloorTile) -> String {
    switch tile {
    case .woodA:
        return "tile-wood-a"
    case .woodB:
        return "tile-wood-b"
    case .carpetLight:
        return "tile-carpet-light"
    case .carpetDark:
        return "tile-carpet-dark"
    case .ceramic:
        return "tile-ceramic"
    // 통로는 전용 에셋이 없어 세라믹(타일) 텍스처를 재사용하고 밝기로 갈린다.
    //
    // 한때 우드를 재사용했다. 그런데 우드는 리뷰·경영 두 방의 바닥재이기도 해서, 렌더 픽셀을
    // 재 보니 복도 RGB (80,39,17) 이 리뷰방 (71,34,16) · 경영방 (69,33,12) 과 거의 같았다 —
    // 복도가 그 두 방의 바닥과 이어져 보였다. "부서 바닥재가 통로와 같으면 안 된다" 는 회귀
    // 테스트가 있었지만 `FloorTile` 값만 비교해서, 값이 다르고 **텍스처가 같은** 이 경우를
    // 놓쳤다. 다섯 텍스처가 여섯 방에 모두 쓰여 안 겹치는 선택지가 없으므로 밝기로 가른다.
    case .corridor:
        return "tile-ceramic"
    case .wall:
        return "tile-wall"
    }
}

/// 가구 → 스프라이트 파일명.
func furnitureSpriteName(_ kind: FurnitureKind) -> String {
    switch kind {
    case .desk:
        return "furn-desk"
    case .chairDown:
        return "furn-chair-down"
    case .chairUp:
        return "furn-chair-up"
    case .meetingTable:
        return "furn-meeting-table"
    case .sofa2:
        return "furn-sofa-2"
    case .sofa3:
        return "furn-sofa-3"
    case .coffeeTable:
        return "furn-coffee-table"
    case .coffeeMachine:
        return "furn-coffee-machine"
    case .waterCooler:
        return "furn-water-cooler"
    case .whiteboard:
        return "furn-whiteboard"
    case .printer:
        return "furn-printer"
    case .plantTall:
        return "furn-plant-tall"
    case .plantSmall:
        return "furn-plant-small"
    case .bookshelf:
        return "furn-bookshelf"
    case .clock:
        return "furn-clock"
    case .trash:
        return "furn-trash"
    case .wallLandscape:
        return "furn-wall-landscape"
    case .wallAbstract:
        return "furn-wall-abstract"
    case .wallCalendar:
        return "furn-wall-calendar"
    case .wallCertificate:
        return "furn-wall-certificate"
    case .wallPinboard:
        return "furn-wall-pinboard"
    case .wallWhiteboard:
        return "furn-wall-whiteboard"
    case .wallShelf:
        return "furn-wall-shelf"
    case .wallMonitor:
        return "furn-wall-monitor"
    case .wallPoster:
        return "furn-wall-poster"
    case .wallPlantHanging:
        return "furn-wall-plant-hanging"
    case .doorClosed:
        return "furn-door-closed"
    case .doorOpen:
        return "furn-door-open"
    case .filingCabinet:
        return "furn-filing-cabinet"
    case .lockers2:
        return "furn-lockers-2"
    case .partitionLow:
        return "furn-partition-low"
    case .vendingMachine:
        return "furn-vending-machine"
    case .refrigerator:
        return "furn-refrigerator"
    case .sinkCounter:
        return "furn-sink-counter"
    case .partitionGlass:
        return "furn-partition-glass"
    case .rugGreen:
        return "furn-rug-green"
    case .rugBeige:
        return "furn-rug-beige"
    case .rugNavy:
        return "furn-rug-navy"
    }
}
