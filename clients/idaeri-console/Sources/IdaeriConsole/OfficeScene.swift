import ConsoleCore
import SpriteKit

/// 에이전트를 상태색 원 + 이름 라벨로 격자 배치하고, 이벤트 연출(VisualIntent)을 SKAction 으로 실행하는 씬.
/// - sync(agents:)   : store 상태를 반영(신규 추가·제거·색 갱신). 집 자리를 계산·보관한다.
/// - perform(_:)     : 이벤트 연출(펄스·집결·핸드오프·복귀·거절·말풍선)을 실행한다.
final class OfficeScene: SKScene {
    private var agentNodes: [String: SKShapeNode] = [:]
    private var homePositions: [String: CGPoint] = [:]
    private var bandOrder: [String] = []  // 대표실 밴드에 집결한 순서
    private let columns = 5
    private let bandHeight: Double = 120
    private let nodeRadius: Double = 26
    /// 원 클릭 시 해당 agentType 을 뷰로 올린다(뷰가 지시/승인 UI 를 띄운다).
    var onAgentClick: ((String) -> Void)?

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(white: 0.12, alpha: 1)
    }

    func sync(agents: [ConsoleAgent]) {
        let incoming = agents.map { $0.agentType }
        let diff = officeNodeDiff(existing: Set(agentNodes.keys), incoming: incoming)

        for agentType in diff.removed {
            agentNodes[agentType]?.removeFromParent()
            agentNodes[agentType] = nil
            homePositions[agentType] = nil
            bandOrder.removeAll { $0 == agentType }
        }

        let positions = officeLayout(
            count: agents.count,
            width: Double(size.width),
            height: Double(size.height),
            columns: columns,
            bandHeight: bandHeight
        )

        for (index, agent) in agents.enumerated() {
            let node = agentNodes[agent.agentType] ?? makeNode(for: agent)
            if agentNodes[agent.agentType] == nil {
                agentNodes[agent.agentType] = node
                addChild(node)
            }
            if index < positions.count {
                let home = CGPoint(x: positions[index].x, y: positions[index].y)
                homePositions[agent.agentType] = home
                // 집결 중이 아닌 노드만 자리 갱신(집결 노드는 밴드에 둔다).
                if !bandOrder.contains(agent.agentType) {
                    node.position = home
                }
            }
            // 색은 sync 가 진실원. 단, working 펄스 중이면 색만 바꾸고 펄스는 유지.
            node.fillColor = agent.state.skColor
        }
    }

    /// 연출 실행. 각 intent 를 SKAction 으로.
    func perform(_ intents: [VisualIntent]) {
        for intent in intents {
            switch intent {
            case let .recolor(agentType, state):
                recolor(agentType, to: state.skColor)
            case let .working(agentType):
                startWorking(agentType)
            case let .handoff(from, to):
                handoff(from: from, to: to)
            case let .summonToBand(agentType):
                summonToBand(agentType)
            case let .returnHome(agentType):
                returnHome(agentType)
            case let .reject(agentType):
                reject(agentType)
            case let .bubble(agentType, text):
                showBubble(agentType, text: text)
            }
        }
    }

    // MARK: - 연출 구현

    private func recolor(_ agentType: String, to color: SKColor) {
        guard let node = agentNodes[agentType] else {
            return
        }
        node.removeAction(forKey: "working")
        node.fillColor = color
        node.run(.sequence([.scale(to: 1.15, duration: 0.12), .scale(to: 1.0, duration: 0.12)]))
    }

    private func startWorking(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        let pulse = SKAction.sequence([
            .scaleY(to: 1.12, duration: 0.35),
            .scaleY(to: 1.0, duration: 0.35),
        ])
        node.run(.repeatForever(pulse), withKey: "working")
    }

    private func handoff(from: String, to: String) {
        guard let start = homePositions[from], let end = homePositions[to] else {
            return
        }
        let packet = SKShapeNode(circleOfRadius: 6)
        packet.fillColor = SKColor(white: 1, alpha: 0.9)
        packet.position = start
        packet.zPosition = 10
        addChild(packet)
        packet.run(.sequence([
            .move(to: end, duration: 0.6),
            .removeFromParent(),
        ]))
        if let target = agentNodes[to] {
            target.run(.sequence([.scale(to: 1.2, duration: 0.15), .scale(to: 1.0, duration: 0.15)]))
        }
    }

    private func summonToBand(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        if !bandOrder.contains(agentType) {
            bandOrder.append(agentType)
        }
        node.fillColor = ConsoleAgentState.awaitingApproval.skColor
        layoutBand()
        let blink = SKAction.sequence([.fadeAlpha(to: 0.4, duration: 0.4), .fadeAlpha(to: 1.0, duration: 0.4)])
        node.run(.repeatForever(blink), withKey: "summon")
    }

    private func returnHome(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        node.removeAction(forKey: "summon")
        node.alpha = 1
        bandOrder.removeAll { $0 == agentType }
        if let home = homePositions[agentType] {
            node.run(.move(to: home, duration: 0.5), withKey: "place")
        }
        layoutBand()
    }

    private func reject(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        let shake = SKAction.sequence([
            .moveBy(x: 8, y: 0, duration: 0.05),
            .moveBy(x: -16, y: 0, duration: 0.1),
            .moveBy(x: 8, y: 0, duration: 0.05),
        ])
        let original = node.fillColor
        node.run(.sequence([.repeat(shake, count: 2)]))
        node.fillColor = SKColor(red: 0.9, green: 0.2, blue: 0.2, alpha: 1)
        node.run(.sequence([.wait(forDuration: 0.4), .run { node.fillColor = original }]))
    }

    private func showBubble(_ agentType: String, text: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        node.childNode(withName: "bubble")?.removeFromParent()
        let label = SKLabelNode(text: text)
        label.name = "bubble"
        label.fontSize = 11
        label.fontColor = SKColor(white: 1, alpha: 1)
        label.verticalAlignmentMode = .center
        label.position = CGPoint(x: 0, y: 44)
        label.zPosition = 5
        node.addChild(label)
        label.run(.sequence([.wait(forDuration: 2.5), .fadeOut(withDuration: 0.5), .removeFromParent()]))
    }

    /// 대표실 밴드에 집결한 노드들을 순번대로 재배치한다.
    private func layoutBand() {
        for (order, agentType) in bandOrder.enumerated() {
            guard let node = agentNodes[agentType] else {
                continue
            }
            let slot = presidentBandSlot(
                order: order,
                count: max(bandOrder.count, 1),
                width: Double(size.width),
                height: Double(size.height),
                bandHeight: bandHeight
            )
            node.run(.move(to: CGPoint(x: slot.x, y: slot.y), duration: 0.5), withKey: "place")
        }
    }

    override func mouseDown(with event: NSEvent) {
        let location = event.location(in: self)
        let slots: [(agentType: String, point: OfficePoint)] = agentNodes.map {
            ($0.key, OfficePoint(x: Double($0.value.position.x), y: Double($0.value.position.y)))
        }
        let hit = agentTypeAt(
            point: OfficePoint(x: Double(location.x), y: Double(location.y)),
            slots: slots,
            radius: nodeRadius
        )
        if let hit {
            onAgentClick?(hit)
        }
    }

    private func makeNode(for agent: ConsoleAgent) -> SKShapeNode {
        let node = SKShapeNode(circleOfRadius: nodeRadius)
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
