import Foundation
import ConsoleCore

func runCozyAgentAppearanceTests(_ t: TestRunner) {
    t.suite("CozyAgentAppearance")
    let first = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .quality)
    let second = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .quality)
    t.expectEqual(first, second, "same agentType resolves to the same appearance")
    t.expectEqual(cozyCharacterAssetCount, 16, "cozy character pool exposes sixteen production assets")
    let departmentVariant = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .planning)
    t.expectEqual(first.assetIndex, departmentVariant.assetIndex, "asset identity is independent of department")
    t.expect(first.assetIndex >= 0 && first.assetIndex < cozyCharacterAssetCount, "character asset is in range")
    t.expect(first.headShapeIndex >= 0 && first.headShapeIndex < 3, "head shape is in range")
    t.expect(first.hairStyleIndex >= 0 && first.hairStyleIndex < 8, "hair style is in range")
    t.expect(first.outfitStyleIndex >= 0 && first.outfitStyleIndex < 6, "outfit style is in range")
    t.expectEqual(cozyAgentMood(for: .completed), .happy, "completed agents look happy")
    t.expectEqual(cozyAgentMood(for: .failed), .concerned, "failed agents look concerned")
}
