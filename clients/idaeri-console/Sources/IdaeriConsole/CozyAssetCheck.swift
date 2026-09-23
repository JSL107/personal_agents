import AppKit
import ConsoleCore

/// 캐릭터 원화의 캔버스 크기.
///
/// **이 값은 `scripts/downscale-characters.py` 의 결과와 같아야 한다.** #616 이 원화를
/// 1145×1374 에서 750×900 으로 줄이면서 이 검사를 함께 고치지 않아, 머지 직후부터
/// `--asset-check` 가 183장 중 163건을 "unexpected dimensions" 로 떨어뜨리고 있었다
/// (종료 코드 1). 숫자를 두 곳에 손으로 적어 둔 것이 원인이라 상수 하나로 모은다.
private let cozyCharacterCanvasWidth = 750
private let cozyCharacterCanvasHeight = 900

/// Validates the generated character sheets before they are used in a release render.
func runCozyAssetCheck() -> Bool {
    var valid = true
    for index in 0..<cozyCharacterAssetCount {
        guard let url = Bundle.module.url(
            forResource: "agent-\(index)", withExtension: "png", subdirectory: "cozy/characters"
        ), let image = NSImage(contentsOf: url),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            fputs("missing or unreadable cozy character asset: agent-\(index).png\n", stderr)
            valid = false
            continue
        }
        let alphaInfo = cgImage.alphaInfo
        guard alphaInfo != .none, alphaInfo != .noneSkipFirst, alphaInfo != .noneSkipLast else {
            fputs("cozy character asset has no alpha channel: agent-\(index).png\n", stderr)
            valid = false
            continue
        }
        guard cgImage.width > 0, cgImage.height > 0 else {
            fputs("cozy character asset has empty dimensions: agent-\(index).png\n", stderr)
            valid = false
            continue
        }
        guard let provider = cgImage.dataProvider, let data = provider.data,
              let bytes = CFDataGetBytePtr(data) else {
            fputs("cozy character asset has no pixel data: agent-\(index).png\n", stderr)
            valid = false
            continue
        }
        let bytesPerPixel = cgImage.bitsPerPixel / 8
        guard bytesPerPixel > 0 else {
            fputs("cozy character asset has invalid pixel format: agent-\(index).png\n", stderr)
            valid = false
            continue
        }
        let alphaOffset = alphaInfo == .first || alphaInfo == .premultipliedFirst ? 0 : bytesPerPixel - 1
        let cornerOffsets = [0, cgImage.width - 1, (cgImage.height - 1) * cgImage.bytesPerRow, (cgImage.height - 1) * cgImage.bytesPerRow + (cgImage.width - 1) * bytesPerPixel]
        let hasTransparentCorner = cornerOffsets.contains { offset in
            offset >= 0 && offset + alphaOffset < CFDataGetLength(data) && bytes[offset + alphaOffset] < 245
        }
        if !hasTransparentCorner {
            fputs("cozy character asset appears to have an opaque background: agent-\(index).png\n", stderr)
            valid = false
        }
    }
    let showcaseIndices = populatedDemoAgents().map {
        cozyAgentAppearance(agentType: $0.agentType, department: $0.resolvedDepartment).assetIndex
    }
    let expectedShowcaseIndices = Set(0..<cozyCharacterAssetCount)
    if showcaseIndices.count != cozyCharacterAssetCount
        || Set(showcaseIndices) != expectedShowcaseIndices {
        fputs("cozy showcase roster does not cover every character asset exactly once\n", stderr)
        valid = false
    }
    // **포즈 열한 종을 전원분 건다.** 한때는 포즈 원화가 몇 명분뿐이라 "적어도 한 장은
    // 있는지" 를 이름으로 하나씩 적어 확인했는데, 그 목록은 사람이 늘 때 조용히 빠진다 —
    // 적어 둔 인덱스만 보고 새로 생긴 인덱스는 아무도 안 본다. 이제 전원분이 들어왔으므로
    // 포즈 × 인덱스로 걸어, 한 장이라도 없으면 게이트가 그 이름을 그대로 말한다.
    //
    // 한 장이 빠지면 그 사람만 다른 그림으로 떨어진다. 자리는 틀리지 않지만 혼자 다른
    // 자세를 하고 있어, 화면을 봐도 "그림이 빠졌다" 가 아니라 "저 사람만 이상하다" 로
    // 보인다 — 그래서 눈이 아니라 게이트가 잡아야 한다.
    //
    // 착석 넷은 서로 대신할 수 없다. 책상 정면(`sit`)은 허리 아래가 없고, 책상 뒷모습
    // (`sit-back`)은 의자까지 그려진 전신이며, 소파용(`sitting`)은 가구가 앉을 면을 주는
    // 자리에, 테이블용(`sit-table`)은 상판뿐인 자리에 쓴다.
    let requiredPoses = [
        "sit", "sit-back", "sitting", "sit-table",
        "typing", "reading", "writing", "drinking",
        "tending", "carryingpapers", "stowing",
    ]
    let requiredPoseAssets = requiredPoses.flatMap { pose in
        (0..<cozyCharacterAssetCount).map { "agent-\($0)-\(pose)" }
    }
    for name in requiredPoseAssets {
        guard let url = Bundle.module.url(
            forResource: name, withExtension: "png", subdirectory: "cozy/characters"
        ), let image = NSImage(contentsOf: url),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            fputs("missing or unreadable cozy pose asset: \(name).png\n", stderr)
            valid = false
            continue
        }
        let alphaInfo = cgImage.alphaInfo
        guard alphaInfo != .none, alphaInfo != .noneSkipFirst, alphaInfo != .noneSkipLast else {
            fputs("cozy pose asset has no alpha channel: \(name).png\n", stderr)
            valid = false
            continue
        }
        if cgImage.width != cozyCharacterCanvasWidth || cgImage.height != cozyCharacterCanvasHeight {
            fputs("cozy pose asset has unexpected dimensions: \(name).png\n", stderr)
            valid = false
        }
        guard let provider = cgImage.dataProvider, let data = provider.data,
              let bytes = CFDataGetBytePtr(data) else {
            fputs("cozy pose asset has no pixel data: \(name).png\n", stderr)
            valid = false
            continue
        }
        let bytesPerPixel = cgImage.bitsPerPixel / 8
        let alphaOffset = alphaInfo == .first || alphaInfo == .premultipliedFirst ? 0 : bytesPerPixel - 1
        let cornerOffsets = [
            0,
            cgImage.width - 1,
            (cgImage.height - 1) * cgImage.bytesPerRow,
            (cgImage.height - 1) * cgImage.bytesPerRow + (cgImage.width - 1) * bytesPerPixel,
        ]
        let hasTransparentCorner = cornerOffsets.contains { offset in
            offset >= 0 && offset + alphaOffset < CFDataGetLength(data) && bytes[offset + alphaOffset] < 245
        }
        if !hasTransparentCorner {
            fputs("cozy pose asset appears to have an opaque background: \(name).png\n", stderr)
            valid = false
        }
    }
    // 정면·후면·측면 걸음 모두 스무 명 전원이 가진다. 후면과 측면은 두 발을 모은 정지
    // 프레임까지 필수로 두어, 어느 방향으로 걸어도 실제 2프레임 걸음이 보이게 한다.
    let frontWalkIndices = Array(0..<cozyCharacterAssetCount)
    let backWalkIndices = Array(0..<cozyCharacterAssetCount)
    let sideWalkIndices = Array(0..<cozyCharacterAssetCount)
    let requiredWalkAssets = frontWalkIndices.map { "agent-\($0)-walk" }
        + backWalkIndices.map { "agent-\($0)-walk-up" }
        + backWalkIndices.map { "agent-\($0)-walk-up-idle" }
        + sideWalkIndices.map { "agent-\($0)-walk-side" }
        + sideWalkIndices.map { "agent-\($0)-walk-side-idle" }
    for name in requiredWalkAssets {
        guard let url = Bundle.module.url(
            forResource: name, withExtension: "png", subdirectory: "cozy/characters"
        ), let image = NSImage(contentsOf: url),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            fputs("missing or unreadable cozy walk asset: \(name).png\n", stderr)
            valid = false
            continue
        }
        let alphaInfo = cgImage.alphaInfo
        if alphaInfo == .none || alphaInfo == .noneSkipFirst || alphaInfo == .noneSkipLast {
            fputs("cozy walk asset has no alpha channel: \(name).png\n", stderr)
            valid = false
        }
        if cgImage.width != cozyCharacterCanvasWidth || cgImage.height != cozyCharacterCanvasHeight {
            fputs("cozy walk asset has unexpected dimensions: \(name).png\n", stderr)
            valid = false
        }
        guard let provider = cgImage.dataProvider, let data = provider.data,
              let bytes = CFDataGetBytePtr(data) else {
            fputs("cozy walk asset has no pixel data: \(name).png\n", stderr)
            valid = false
            continue
        }
        let bytesPerPixel = cgImage.bitsPerPixel / 8
        let alphaOffset = alphaInfo == .first || alphaInfo == .premultipliedFirst
            ? 0 : bytesPerPixel - 1
        let cornerOffsets = [
            0,
            (cgImage.width - 1) * bytesPerPixel,
            (cgImage.height - 1) * cgImage.bytesPerRow,
            (cgImage.height - 1) * cgImage.bytesPerRow + (cgImage.width - 1) * bytesPerPixel,
        ]
        if !cornerOffsets.contains(where: { bytes[$0 + alphaOffset] < 245 }) {
            fputs("cozy walk asset appears to have an opaque background: \(name).png\n", stderr)
            valid = false
        }
    }
    // 걸음 그림이 **실제로 화면에 쓰이는지**를 계약 쪽에서 확인한다. 파일이 번들에 들어간
    // 것만 보면, 포즈 계약이 그 이름을 모르는 채여도 초록불이 된다 — 가구가 그려진 원화
    // 셋이 정확히 그 방식으로 조용히 안 쓰이고 있었다.
    for (index, requested) in frontWalkIndices.map({ ($0, "walk") })
        + backWalkIndices.map({ ($0, "walk-up") })
        + backWalkIndices.map({ ($0, "walk-up-idle") })
        + sideWalkIndices.map({ ($0, "walk-side") })
        + sideWalkIndices.map({ ($0, "walk-side-idle") })
    {
        let resolved = resolveCozyPose(
            requested: requested,
            assetIndex: index,
            hasAsset: { pose in
                SpriteLoader.cozyCharacterHasDedicatedPose(assetIndex: index, pose: pose)
            }
        )
        if resolved.pose != requested {
            fputs("cozy walk artwork is not wired for agent-\(index)\n", stderr)
            valid = false
        }
    }
    let roomAssets = [
        "planning-shell", "quality-shell", "evaluation-shell",
        "treasury-shell", "content-shell", "internalOps-shell",
        "meeting-shell", "president-shell", "pantry-shell",
        "shared-oak-corridor",
    ]
    for name in roomAssets {
        guard let url = Bundle.module.url(
            forResource: name, withExtension: "png", subdirectory: "cozy/rooms"
        ), let image = NSImage(contentsOf: url), image.size.width > 0, image.size.height > 0 else {
            fputs("missing or unreadable cozy room asset: \(name).png\n", stderr)
            valid = false
            continue
        }
    }
    let furnitureAssets = [
        "workstation", "chair", "sofa", "meeting-table", "coffee-table",
        "bookshelf", "coffee-station",
        "planning-board-table", "quality-review-station", "evaluation-kpi-console",
        "treasury-ledger-console", "content-storyboard-station", "internal-ops-control-desk",
        "vacuum-robot", "waste-bin", "dust-pile",
        "door-closed", "door-open", "desk-items",
    ]
    for name in furnitureAssets {
        guard let url = Bundle.module.url(
            forResource: name, withExtension: "png", subdirectory: "cozy/furniture-3d"
        ), let image = NSImage(contentsOf: url),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            fputs("missing or unreadable cozy furniture asset: \(name).png\n", stderr)
            valid = false
            continue
        }
        let alphaInfo = cgImage.alphaInfo
        if alphaInfo == .none || alphaInfo == .noneSkipFirst || alphaInfo == .noneSkipLast {
            fputs("cozy furniture asset has no alpha channel: \(name).png\n", stderr)
            valid = false
        }
        // 배경이 통째로 불투명하면 바닥 위에 흰 사각형이 얹힌다. 생성형 에셋에서 실제로
        // 겪은 사고라(먼지 그림이 체크무늬 배경째 들어왔다) 새로 받는 바닥 소품은 전부 검사한다.
        if [
            "vacuum-robot", "waste-bin", "dust-pile",
            "door-closed", "door-open", "desk-items",
        ].contains(name),
           let provider = cgImage.dataProvider,
           let data = provider.data, let bytes = CFDataGetBytePtr(data) {
            let bytesPerPixel = cgImage.bitsPerPixel / 8
            let alphaOffset = alphaInfo == .first || alphaInfo == .premultipliedFirst
                ? 0 : bytesPerPixel - 1
            let cornerOffsets = [
                0,
                (cgImage.width - 1) * bytesPerPixel,
                (cgImage.height - 1) * cgImage.bytesPerRow,
                (cgImage.height - 1) * cgImage.bytesPerRow
                    + (cgImage.width - 1) * bytesPerPixel,
            ]
            if !cornerOffsets.contains(where: { bytes[$0 + alphaOffset] < 245 }) {
                fputs("cozy floor prop appears to have an opaque background: \(name).png\n", stderr)
                valid = false
            }
        }
    }
    let dashboardAccentAssets = [
        "planning-accent", "quality-accent", "evaluation-accent",
        "treasury-accent", "content-accent", "internal-ops-accent",
        "vacation-accent", "career-accent",
    ]
    for name in dashboardAccentAssets {
        guard let url = Bundle.module.url(
            forResource: name, withExtension: "png", subdirectory: "cozy/props"
        ), let image = NSImage(contentsOf: url),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            fputs("missing or unreadable cozy dashboard accent: \(name).png\n", stderr)
            valid = false
            continue
        }
        let alphaInfo = cgImage.alphaInfo
        if alphaInfo == .none || alphaInfo == .noneSkipFirst || alphaInfo == .noneSkipLast {
            fputs("cozy dashboard accent has no alpha channel: \(name).png\n", stderr)
            valid = false
        }
    }
    if valid {
        print("cozy asset check passed: 9 modular rooms + 1 shared oak floor + \(furnitureAssets.count) interactive furniture assets + \(dashboardAccentAssets.count) dashboard accents + \(cozyCharacterAssetCount) transparent characters + \(requiredPoseAssets.count) production pose assets + \(requiredWalkAssets.count) walk assets")
    }
    return valid
}
