import Foundation
import ConsoleCore

func runCozyAgentAppearanceTests(_ t: TestRunner) {
    t.suite("CozyAgentAppearance")
    let first = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .quality)
    let second = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .quality)
    t.expectEqual(first, second, "same agentType resolves to the same appearance")
    t.expectEqual(cozyCharacterAssetCount, 20, "cozy character pool exposes twenty production assets")
    let router = cozyAgentAppearance(agentType: "ROUTER", department: .planning)
    t.expectEqual(router.assetIndex, cozyMechanicAssetIndex, "ROUTER uses the reserved mechanic asset")
    // 정비사 번호가 풀 크기에서 나오면 직원 그림을 늘리는 순간 새 `agent-N` 과 겹친다.
    // 풀을 지금보다 크게 잡아도 어떤 칸도 정비사로 접히지 않고, 정비사는 정비사로 남는지 본다.
    for poolSize in [cozyCharacterAssetCount, cozyCharacterAssetCount + 1, 64] {
        let collided = (0..<(poolSize * 2)).filter {
            normalizedCozyAssetIndex($0, poolSize: poolSize) == cozyMechanicAssetIndex
        }
        t.expect(collided.isEmpty, "pool of \(poolSize) never folds onto the mechanic: \(collided)")
        t.expectEqual(
            normalizedCozyAssetIndex(cozyMechanicAssetIndex, poolSize: poolSize), cozyMechanicAssetIndex,
            "mechanic survives normalization with a pool of \(poolSize)"
        )
    }
    t.expectEqual(
        CozyAgentAppearance(
            assetIndex: cozyMechanicAssetIndex, headShapeIndex: 0, hairStyleIndex: 0,
            outfitStyleIndex: 0, accessoryIndex: nil, paletteIndex: 0
        ).assetIndex,
        cozyMechanicAssetIndex,
        "appearance init keeps the mechanic index"
    )
    t.expectEqual(
        cozyDashboardCharacterVisualScale(assetIndex: cozyMechanicAssetIndex, pose: "reading"), 1.00,
        "mechanic does not inherit agent-19's dashboard correction"
    )
    for pose in cozyMechanicPoses {
        let name = pose == cozyIdlePose ? "mechanic" : "mechanic-\(pose)"
        t.expect(
            cozyCharacterAssetFileExists(name),
            "designated cozy mechanic pose exists: \(name).png"
        )
    }
    let coworkerIndices: [String: Int] = [
        "PM": 16, "CODE_REVIEWER": 1, "WORK_REVIEWER": 2, "HUMANIZER": 3,
        "VACATION": 17, "PAPER_TRADE": 18, "CAREER_MATE": 19,
    ]
    for (agentType, expectedIndex) in coworkerIndices {
        t.expectEqual(
            cozyAgentAppearance(agentType: agentType, department: .planning).assetIndex,
            expectedIndex,
            "ROUTER mechanic reservation does not shift \(agentType)'s face"
        )
    }
    t.expectEqual(
        cozyDashboardCharacterVisualScale(assetIndex: 3, pose: "typing"), 1.025,
        "dashboard typing silhouette receives height-only correction"
    )
    t.expectEqual(
        cozyDashboardCharacterVisualScale(assetIndex: 23, pose: "typing"), 1.025,
        "dashboard optical correction wraps asset index"
    )
    t.expectEqual(
        cozyDashboardCharacterVisualScale(assetIndex: 16, pose: "writing"), 1.00,
        "dashboard does not inherit office width correction"
    )
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
