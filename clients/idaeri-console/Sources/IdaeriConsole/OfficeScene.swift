import ConsoleCore
import SpriteKit

/// 에이전트를 상태색 원 + 이름 라벨로 격자 배치하는 씬.
/// sync(agents:) 로 store 상태를 반영한다 — 신규 추가·사라진 것 제거·남은 것 색 갱신.
final class OfficeScene: SKScene {
    private var agentNodes: [String: SKShapeNode] = [:]
    private let columns = 5

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(white: 0.12, alpha: 1)
    }

    func sync(agents: [ConsoleAgent]) {
        let incoming = agents.map { $0.agentType }
        let diff = officeNodeDiff(existing: Set(agentNodes.keys), incoming: incoming)

        for agentType in diff.removed {
            agentNodes[agentType]?.removeFromParent()
            agentNodes[agentType] = nil
        }

        let positions = officeLayout(
            count: agents.count,
            width: Double(size.width),
            height: Double(size.height),
            columns: columns
        )

        for (index, agent) in agents.enumerated() {
            let node = agentNodes[agent.agentType] ?? makeNode(for: agent)
            if agentNodes[agent.agentType] == nil {
                agentNodes[agent.agentType] = node
                addChild(node)
            }
            if index < positions.count {
                let point = positions[index]
                node.position = CGPoint(x: point.x, y: point.y)
            }
            node.fillColor = agent.state.skColor
        }
    }

    private func makeNode(for agent: ConsoleAgent) -> SKShapeNode {
        let node = SKShapeNode(circleOfRadius: 26)
        node.strokeColor = SKColor(white: 1, alpha: 0.25)
        node.lineWidth = 1
        node.fillColor = agent.state.skColor

        let label = SKLabelNode(text: agent.displayName)
        label.fontSize = 11
        label.fontColor = SKColor(white: 0.95, alpha: 1)
        label.verticalAlignmentMode = .center
        label.position = CGPoint(x: 0, y: -40)
        label.preferredMaxLayoutWidth = 90
        node.addChild(label)

        return node
    }
}
