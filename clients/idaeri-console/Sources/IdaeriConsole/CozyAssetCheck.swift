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
    for pose in cozyMechanicPoses {
        let name = pose == cozyIdlePose ? "mechanic" : "mechanic-\(pose)"
        guard let url = Bundle.module.url(
            forResource: name, withExtension: "png", subdirectory: "cozy/characters"
        ), let image = NSImage(contentsOf: url),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            fputs("missing or unreadable designated cozy character asset: \(name).png\n", stderr)
            valid = false
            continue
        }
        if cgImage.width != cozyCharacterCanvasWidth || cgImage.height != cozyCharacterCanvasHeight {
            fputs("designated cozy character asset has unexpected dimensions: \(name).png\n", stderr)
            valid = false
        }
    }
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
    // **포즈를 전원분 건다.** 한때는 포즈 원화가 몇 명분뿐이라 "적어도 한 장은
    // 있는지" 를 이름으로 하나씩 적어 확인했는데, 그 목록은 사람이 늘 때 조용히 빠진다 —
    // 적어 둔 인덱스만 보고 새로 생긴 인덱스는 아무도 안 본다. 이제 전원분이 들어왔으므로
    // 포즈 × 인덱스로 걸어, 한 장이라도 없으면 게이트가 그 이름을 그대로 말한다.
    //
    // 한 장이 빠지면 그 사람만 다른 그림으로 떨어진다. 자리는 틀리지 않지만 혼자 다른
    // 자세를 하고 있어, 화면을 봐도 "그림이 빠졌다" 가 아니라 "저 사람만 이상하다" 로
    // 보인다 — 그래서 눈이 아니라 게이트가 잡아야 한다.
    let requiredPoses = ["reading", "writing", "drinking"]
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
    let roomAssets = [
        "planning-shell", "quality-shell", "evaluation-shell",
        "treasury-shell", "content-shell", "internalOps-shell",
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
        print("cozy asset check passed: 6 department rooms + \(dashboardAccentAssets.count) dashboard accents + \(cozyCharacterAssetCount) transparent characters + \(cozyMechanicPoses.count) designated mechanic poses + \(requiredPoseAssets.count) production pose assets")
    }
    return valid
}
