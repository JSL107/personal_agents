/// 상태 6종의 표시 색(0~1 RGB). SwiftUI와 SpriteKit이 공통으로 참조한다.
public func agentStatePaletteRGBA(
    _ state: ConsoleAgentState
) -> (red: Double, green: Double, blue: Double) {
    switch state {
    case .completed:
        return (0.36, 0.78, 0.63)
    case .inProgress:
        return (0.96, 0.78, 0.25)
    case .awaitingApproval:
        return (0.91, 0.36, 0.60)
    case .awaitingIntegration:
        return (0.62, 0.55, 0.90)
    case .waiting:
        return (0.72, 0.72, 0.72)
    case .failed:
        return (0.90, 0.30, 0.24)
    }
}
