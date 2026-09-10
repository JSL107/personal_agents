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
    let roomAssets = [
        "planning-shell", "quality-shell", "evaluation-shell",
        "treasury-shell", "content-shell", "internalOps-shell",
        "meeting-shell", "president-shell", "pantry-shell",
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
    if valid {
        print("cozy asset check passed: 9 modular rooms + 6 interactive furniture assets + \(cozyCharacterAssetCount) transparent characters")
    }
    return valid
}
