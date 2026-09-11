import AppKit
import ConsoleCore

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
    // Pose art is introduced in a small, quality-controlled pilot. The loader
    // still falls back to the matching idle art for agents without a pose, but
    // the release check must prove that the high-frequency interactions have
    // at least one real seated and one real writing variant.
    let requiredPoseAssets = (0..<cozyCharacterAssetCount).map { "agent-\($0)-sit" } + [
        "agent-0-writing", "agent-0-typing", "agent-0-reading", "agent-0-drinking",
        "agent-1-writing", "agent-1-typing", "agent-1-reading", "agent-1-drinking",
        "agent-2-typing", "agent-3-typing", "agent-4-typing", "agent-5-typing",
        "agent-9-typing", "agent-13-typing", "agent-17-typing",
        "agent-6-writing", "agent-7-reading", "agent-8-drinking",
        "agent-16-writing", "agent-17-drinking", "agent-18-typing",
        "agent-19-reading", "agent-2-reading",
    ]
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
        if cgImage.width != 1145 || cgImage.height != 1374 {
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
        "workstation", "chair", "sofa", "meeting-table", "bookshelf", "coffee-station",
        "planning-board-table", "quality-review-station", "evaluation-kpi-console",
        "treasury-ledger-console", "content-storyboard-station", "internal-ops-control-desk",
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
        print("cozy asset check passed: 9 modular rooms + 1 shared oak floor + 12 interactive furniture assets + \(dashboardAccentAssets.count) dashboard accents + \(cozyCharacterAssetCount) transparent characters + \(requiredPoseAssets.count) production pose assets")
    }
    return valid
}
