import Foundation

@testable import ConsoleCore

func runAgentStatePaletteTests(_ t: TestRunner) {
    t.suite("AgentStatePalette")
    var seenColors = Set<String>()
    for state in [ConsoleAgentState.completed, .inProgress, .awaitingApproval, .awaitingIntegration, .waiting, .failed] {
        let rgb = agentStatePaletteRGBA(state)
        let inRange = (0...1).contains(rgb.red) && (0...1).contains(rgb.green) && (0...1).contains(rgb.blue)
        t.expect(inRange, "\(state) RGB 는 0~1 범위")
        seenColors.insert("\(rgb.red),\(rgb.green),\(rgb.blue)")
    }
    t.expectEqual(seenColors.count, 6, "6종 색이 서로 다름")
}
