import Foundation
import ConsoleCore

func runCozyAgentAppearanceTests(_ t: TestRunner) {
    t.suite("CozyAgentAppearance")
    let first = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .quality)
    let second = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .quality)
    t.expectEqual(first, second, "same agentType resolves to the same appearance")
    t.expectEqual(cozyCharacterAssetCount, 20, "cozy character pool exposes twenty production assets")
    t.expectEqual(cozyCharacterVisualScale(assetIndex: 2), 1.12, "short alpha silhouette receives optical correction")
    t.expectEqual(cozyCharacterVisualScale(assetIndex: 17), 0.91, "large alpha silhouette receives optical correction")
    t.expectEqual(cozyCharacterVisualScale(assetIndex: 22), 1.12, "optical correction wraps asset index")
    let departmentVariant = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .planning)
    t.expectEqual(first.assetIndex, departmentVariant.assetIndex, "asset identity is independent of department")
    t.expect(first.assetIndex >= 0 && first.assetIndex < cozyCharacterAssetCount, "character asset is in range")
    t.expect(first.headShapeIndex >= 0 && first.headShapeIndex < 3, "head shape is in range")
    t.expect(first.hairStyleIndex >= 0 && first.hairStyleIndex < 8, "hair style is in range")
    t.expect(first.outfitStyleIndex >= 0 && first.outfitStyleIndex < 6, "outfit style is in range")
    let productRoster = ["PM", "CODE_REVIEWER", "WORK_REVIEWER", "HUMANIZER", "VACATION", "PAPER_TRADE", "CAREER_MATE"]
        .map { cozyAgentAppearance(agentType: $0, department: .planning).assetIndex }
    t.expectEqual(Set(productRoster).count, productRoster.count, "dashboard roster uses distinct production characters")
    t.expect(productRoster.contains(16) && productRoster.contains(17), "dashboard roster visibly includes masculine character pack")
    t.expectEqual(cozyAgentMood(for: .completed), .happy, "completed agents look happy")
    t.expectEqual(cozyAgentMood(for: .failed), .concerned, "failed agents look concerned")
}
