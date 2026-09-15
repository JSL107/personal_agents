import Foundation
import ConsoleCore

func runCozyAgentAppearanceTests(_ t: TestRunner) {
    t.suite("CozyAgentAppearance")
    let first = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .quality)
    let second = cozyAgentAppearance(agentType: "CODE_REVIEWER", department: .quality)
    t.expectEqual(first, second, "same agentType resolves to the same appearance")
    t.expectEqual(cozyCharacterAssetCount, 20, "cozy character pool exposes twenty production assets")
    // **오피스 캐릭터는 사람마다 크기가 같아야 한다.** 한때 0.91~1.12 를 손으로 박아 두고
    // "희미한 가장자리를 보상한다" 고 했는데, 실측하니 그 보상은 필요 없었고 이 값이 키를
    // 21% 벌리는 유일한 원인이었다(사용자 보고: "사이즈가 너무 들쭉날쭉").
    //
    // 인덱스를 하나만 찍어 보면 누가 예외값을 하나 되살렸을 때 통과한다. **스무 명 전원**과
    // 범위 밖 인덱스까지 훑는다.
    for assetIndex in 0..<cozyCharacterAssetCount {
        t.expectEqual(
            cozyCharacterVisualScale(assetIndex: assetIndex), 1.00,
            "agent-\(assetIndex) 는 사람별 크기 보정을 받지 않는다"
        )
    }
    t.expectEqual(
        cozyCharacterVisualScale(assetIndex: cozyCharacterAssetCount + 2), 1.00,
        "범위를 넘는 인덱스도 접혀서 같은 값을 받는다"
    )
    t.expectEqual(
        cozyCharacterVisualScale(assetIndex: -1), 1.00,
        "음수 인덱스도 접혀서 같은 값을 받는다"
    )
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
