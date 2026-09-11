import Foundation

/// Number of transparent, production-ready character portraits available to the cozy office.
public let cozyCharacterAssetCount = 20

/// Small optical correction for the production PNGs after alpha-bound normalization.
/// Values compensate residual faint-edge padding; the square dashboard envelope prevents
/// hair width from becoming a second scale constraint.
public func cozyCharacterVisualScale(assetIndex: Int) -> CGFloat {
    let normalizedIndex = ((assetIndex % cozyCharacterAssetCount) + cozyCharacterAssetCount)
        % cozyCharacterAssetCount
    switch normalizedIndex {
    case 1, 16:
        return 0.97
    case 2:
        return 1.12
    case 17:
        return 0.91
    case 18:
        return 1.04
    case 19:
        return 1.03
    case 3:
        return 1.01
    default:
        return 1.00
    }
}

/// Optical correction for dashboard portraits, whose square SwiftUI envelope is height-bound.
///
/// Office sprites also have a width cap and therefore need the broader correction above. Reusing
/// those values on the dashboard made PM/Vacation visibly smaller and Paper Trade/Career Mate
/// larger even though every card had the same frame. These values normalize the measured alpha
/// silhouette of the production PNGs around one shared shoe-to-hair height.
public func cozyDashboardCharacterVisualScale(assetIndex: Int, pose: String) -> CGFloat {
    let normalizedIndex = ((assetIndex % cozyCharacterAssetCount) + cozyCharacterAssetCount)
        % cozyCharacterAssetCount
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
        self.assetIndex = ((assetIndex % cozyCharacterAssetCount) + cozyCharacterAssetCount) % cozyCharacterAssetCount
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
