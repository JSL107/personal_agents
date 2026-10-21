import Foundation

/// Number of transparent, production-ready character portraits available to the console.
public let cozyCharacterAssetCount = 20

/// 정비사 전용 번호. **풀 크기에서 끌어오지 않는다.**
///
/// 예전엔 `cozyCharacterAssetCount`(=20) 를 그대로 썼다. 그러면 직원 그림을 21장으로 늘리는
/// 순간 새 `agent-20` 과 정비사가 같은 번호가 되어, 자동 배정으로 20번을 받은 사람이 정비사
/// 옷을 입는다. 풀은 항상 `0..<count` 라 음수는 어떤 풀 크기와도 겹치지 않는다.
public let cozyMechanicAssetIndex = -1

/// 그림 번호를 실재하는 칸으로 접는다. 정비사 번호는 접지 않고 그대로 둔다.
///
/// 앱의 조회·캐시 키·대시보드 보정·외형 생성이 모두 이 함수를 지난다 — 한곳이라도 따로 접으면
/// 정비사 번호가 `agent-19` 로 떨어지는 경로가 생긴다. `poolSize` 는 풀을 늘렸을 때를 테스트가
/// 흉내 내기 위한 인자이고, 앱은 기본값만 쓴다.
public func normalizedCozyAssetIndex(
    _ assetIndex: Int, poolSize: Int = cozyCharacterAssetCount
) -> Int {
    if assetIndex == cozyMechanicAssetIndex {
        return cozyMechanicAssetIndex
    }
    return ((assetIndex % poolSize) + poolSize) % poolSize
}

/// Every required drawing for the dedicated mechanic character, including the idle base image.
public let cozyMechanicPoses = [
    "idle", "sit", "sitting", "sit-back", "sit-table", "typing", "writing", "reading",
    "drinking", "carryingpapers", "stowing", "tending", "walk", "walk-side",
    "walk-side-idle", "walk-up", "walk-up-idle",
]

/// Optical correction for dashboard portraits, whose square SwiftUI envelope is height-bound.
///
/// These values normalize the measured alpha silhouette of the production PNGs around one
/// shared shoe-to-hair height in cards of the same size.
public func cozyDashboardCharacterVisualScale(assetIndex: Int, pose: String) -> CGFloat {
    let normalizedIndex = normalizedCozyAssetIndex(assetIndex)
    if normalizedIndex == cozyMechanicAssetIndex {
        return 1.00
    }
    switch (normalizedIndex, pose) {
    case (3, "typing"):
        return 1.025
    case (2, "reading"):
        return 1.005
    case (17, "drinking"), (19, "reading"):
        return 0.995
    default:
        return 1.00
    }
}

/// Deterministic visual traits for an agent's cozy character.
public struct CozyAgentAppearance: Equatable, Sendable {
    public let assetIndex: Int
    public let headShapeIndex: Int
    public let hairStyleIndex: Int
    public let outfitStyleIndex: Int
    public let accessoryIndex: Int?
    public let paletteIndex: Int

    public init(
        assetIndex: Int = 0,
        headShapeIndex: Int,
        hairStyleIndex: Int,
        outfitStyleIndex: Int,
        accessoryIndex: Int?,
        paletteIndex: Int
    ) {
        self.assetIndex = normalizedCozyAssetIndex(assetIndex)
        self.headShapeIndex = headShapeIndex
        self.hairStyleIndex = hairStyleIndex
        self.outfitStyleIndex = outfitStyleIndex
        self.accessoryIndex = accessoryIndex
        self.paletteIndex = paletteIndex
    }
}

/// The character's expression/pose derived from its current console state.
public enum CozyAgentMood: Equatable, Sendable {
    case calm
    case focused
    case happy
    case concerned
    case waiting
}

/// Resolves stable character traits from the agent identity and department.
public func cozyAgentAppearance(
    agentType: String,
    department: Department
) -> CozyAgentAppearance {
    let seed = agentType.utf8.reduce(UInt64(1469598103934665603)) {
        ($0 ^ UInt64($1)) &* 1099511628211
    }
    let productRosterAssetIndex: [String: Int] = [
        "ROUTER": cozyMechanicAssetIndex,
        "PM": 16,
        "CODE_REVIEWER": 1,
        "WORK_REVIEWER": 2,
        "HUMANIZER": 3,
        "VACATION": 17,
        "PAPER_TRADE": 18,
        "CAREER_MATE": 19,
    ]
    return CozyAgentAppearance(
        assetIndex: productRosterAssetIndex[agentType]
            ?? Int(seed % UInt64(cozyCharacterAssetCount)),
        headShapeIndex: Int(seed % 3),
        hairStyleIndex: Int((seed / 3) % 8),
        outfitStyleIndex: Int((seed / 24) % 6),
        accessoryIndex: seed.isMultiple(of: 3) ? Int((seed / 144) % 4) : nil,
        paletteIndex: department.cozyPaletteIndex
    )
}

/// Maps each department to its stable cozy palette slot.
public extension Department {
    var cozyPaletteIndex: Int {
        switch self {
        case .planning:
            return 0
        case .quality:
            return 1
        case .evaluation:
            return 2
        case .treasury:
            return 3
        case .content:
            return 4
        case .internalOps:
            return 5
        }
    }
}

/// Resolves the expression/pose for every state in the console contract.
public func cozyAgentMood(for state: ConsoleAgentState) -> CozyAgentMood {
    switch state {
    case .completed:
        return .happy
    case .inProgress:
        return .focused
    case .awaitingApproval:
        return .concerned
    case .awaitingIntegration:
        return .waiting
    case .waiting:
        return .calm
    case .failed:
        return .concerned
    }
}
