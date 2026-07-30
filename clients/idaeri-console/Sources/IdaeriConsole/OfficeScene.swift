import ConsoleCore
import SpriteKit

/// 두 색을 sRGB 성분으로 선형 보간한다(SKColor == NSColor, macOS).
private func lerpColor(_ from: SKColor, _ to: SKColor, _ ratio: CGFloat) -> SKColor {
    let clamped = max(0, min(1, ratio))
    guard
        let start = from.usingColorSpace(.sRGB),
        let end = to.usingColorSpace(.sRGB)
    else {
        return to
    }
    let red = start.redComponent + (end.redComponent - start.redComponent) * clamped
    let green = start.greenComponent + (end.greenComponent - start.greenComponent) * clamped
    let blue = start.blueComponent + (end.blueComponent - start.blueComponent) * clamped
    return SKColor(red: red, green: green, blue: blue, alpha: 1)
}

/// 링(stroke) 색을 duration 동안 부드럽게 전이한다.
private func animateStroke(_ node: SKShapeNode, to color: SKColor, duration: TimeInterval) {
    let from = node.strokeColor
    let action = SKAction.customAction(withDuration: duration) { runningNode, elapsed in
        guard let shape = runningNode as? SKShapeNode else {
            return
        }
        let ratio = duration > 0 ? CGFloat(elapsed) / CGFloat(duration) : 1
        shape.strokeColor = lerpColor(from, color, ratio)
    }
    node.run(action)
}

/// 대기 노드의 은은한 숨쉬기(미세 scale 반복). 이미 돌고 있으면 중복 시작 안 함.
private func startBreathing(_ node: SKShapeNode) {
    guard node.action(forKey: "breathing") == nil else {
        return
    }
    let breathe = SKAction.sequence([
        .scale(to: 1.03, duration: 1.6),
        .scale(to: 1.0, duration: 1.6),
    ])
    breathe.timingMode = .easeInEaseOut
    node.run(.repeatForever(breathe), withKey: "breathing")
}

private func stopBreathing(_ node: SKShapeNode) {
    node.removeAction(forKey: "breathing")
    node.setScale(1.0)
}

/// 에이전트를 상태색 링 토큰으로 부서 방에 배치하고, 이벤트 연출(VisualIntent)을 SKAction 으로 실행하는 씬.
/// - sync(agents:)   : store 상태를 반영(신규 추가·제거·색 갱신·방 배치·전사 요약). 집 자리를 계산·보관한다.
/// - perform(_:)     : 이벤트 연출(펄스·집결·핸드오프·복귀·거절·말풍선)을 실행한다.
final class OfficeScene: SKScene {
    private var agentNodes: [String: SKShapeNode] = [:]
    private var homePositions: [String: CGPoint] = [:]
    private var bandOrder: [String] = []  // 대표실 밴드에 집결한 순서
    private let bandHeight: Double = 120
    private let nodeRadius: Double = 26
    private var hoveredAgentType: String?
    private var agentBubbles: [String: String] = [:]
    private var waitingAgentTypes: Set<String> = []
    private var lastSyncedAgents: [ConsoleAgent] = []
    private var selectedAgentType: String?
    /// 원 클릭 시 해당 agentType 을 뷰로 올린다(뷰가 지시/승인 UI 를 띄운다).
    var onAgentClick: ((String) -> Void)?

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(white: 0.12, alpha: 1)
        view.window?.acceptsMouseMovedEvents = true
        let tracking = NSTrackingArea(
            rect: view.bounds,
            options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect],
            owner: view,
            userInfo: nil
        )
        view.addTrackingArea(tracking)
        setupPresidentBand()
    }

    /// 씬 크기가 바뀌면(resizeFill) 방·토큰·대표실이 어긋나므로 다시 배치한다.
    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        positionPresidentBand()
        guard !lastSyncedAgents.isEmpty else {
            return
        }
        sync(agents: lastSyncedAgents)
        // sync 는 집결(bandOrder) 토큰의 위치를 건너뛰므로, 새 size 기준으로 밴드 슬롯을 다시 배치한다.
        layoutBand()
    }

    /// 뷰의 선택 상태를 반영한다. 선택 노드에 지속 하이라이트 링을 얹고, 이전 선택은 해제한다.
    func setSelected(_ agentType: String?) {
        if selectedAgentType == agentType {
            return
        }
        if let previous = selectedAgentType, let node = agentNodes[previous] {
            node.childNode(withName: "selectionRing")?.removeFromParent()
        }
        selectedAgentType = agentType
        guard let agentType, let node = agentNodes[agentType] else {
            return
        }
        let ring = SKShapeNode(circleOfRadius: nodeRadius + 5)
        ring.name = "selectionRing"
        ring.strokeColor = SKColor(white: 1, alpha: 0.9)
        ring.lineWidth = 2
        ring.fillColor = .clear
        ring.zPosition = 4
        node.addChild(ring)
    }

    func sync(agents: [ConsoleAgent]) {
        let incoming = agents.map { $0.agentType }
        let diff = officeNodeDiff(existing: Set(agentNodes.keys), incoming: incoming)
        waitingAgentTypes = Set(
            agents
                .filter { $0.state == .waiting }
                .map(\.agentType)
        )

        for agentType in diff.removed {
            agentNodes[agentType]?.removeFromParent()
            agentNodes[agentType] = nil
            homePositions[agentType] = nil
            bandOrder.removeAll { $0 == agentType }
        }

        lastSyncedAgents = agents
        let layout = departmentRoomLayout(
            agents: agents,
            width: Double(size.width),
            height: Double(size.height),
            bandHeight: bandHeight
        )
        renderRooms(layout.rooms)

        for agent in agents {
            let node = agentNodes[agent.agentType] ?? makeNode(for: agent)
            if agentNodes[agent.agentType] == nil {
                agentNodes[agent.agentType] = node
                addChild(node)
            }
            if let home = layout.positions[agent.agentType] {
                let homePoint = CGPoint(x: home.x, y: home.y)
                homePositions[agent.agentType] = homePoint
                // 집결 중이 아닌 노드만 자리 갱신(집결 노드는 밴드에 둔다).
                if !bandOrder.contains(agent.agentType) {
                    node.position = homePoint
                }
            }
            // 색은 sync 가 진실원. 상태색은 링(stroke) — 채움은 부서 tint 로 고정.
            node.strokeColor = agent.state.skColor
            let isWorking = node.childNode(withName: "progressArc") != nil
            if agent.state == .waiting,
               hoveredAgentType != agent.agentType,
               !bandOrder.contains(agent.agentType),
               !isWorking
            {
                startBreathing(node)
            } else {
                stopBreathing(node)
            }
        }

        updateCompanySummary(agents)
    }

    /// 이름붙은 라벨 자식을 text 유무에 따라 add/update/remove 한다(매 갱신 remove 후 재생성).
    private func setChildLabel(
        _ parent: SKShapeNode,
        name: String,
        text: String?,
        position: CGPoint,
        fontSize: CGFloat,
        color: SKColor
    ) {
        parent.childNode(withName: name)?.removeFromParent()
        guard let text, !text.isEmpty else {
            return
        }
        let label = SKLabelNode(text: text)
        label.name = name
        label.fontSize = fontSize
        label.fontColor = color
        label.verticalAlignmentMode = .center
        label.horizontalAlignmentMode = .center
        label.position = position
        label.zPosition = 6
        parent.addChild(label)
    }

    /// 토큰 위 정보(상시 말풍선·경과·pending 배지)를 현재 상태로 다시 그린다.
    func refreshOverlays(
        agents: [ConsoleAgent],
        runs: [ConsoleRun],
        pendingCommands: [PendingCommand],
        now: Date
    ) {
        for agent in agents {
            guard let node = agentNodes[agent.agentType] else {
                continue
            }
            agentBubbles[agent.agentType] = agent.bubble
            let info = agentTokenInfo(agent: agent, runs: runs, pendingCommands: pendingCommands, now: now)
            if info.bubble != nil {
                node.childNode(withName: "hoverBubble")?.removeFromParent()
            }
            setChildLabel(
                node, name: "infoBubble", text: info.bubble,
                position: CGPoint(x: 0, y: 46), fontSize: 11, color: SKColor(white: 1, alpha: 0.95)
            )
            setChildLabel(
                node, name: "elapsed", text: info.elapsed,
                position: CGPoint(x: 0, y: -54), fontSize: 10, color: SKColor(white: 0.7, alpha: 1)
            )
            setChildLabel(
                node, name: "pendingBadge", text: info.badge?.badgeIcon,
                position: CGPoint(x: 22, y: 22), fontSize: 15, color: SKColor(white: 1, alpha: 1)
            )
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
        stopWorking(node)
        animateStroke(node, to: color, duration: 0.35)
        node.run(.sequence([.scale(to: 1.15, duration: 0.12), .scale(to: 1.0, duration: 0.12)]))
    }

    private func startWorking(_ agentType: String) {
        guard let node = agentNodes[agentType] else {
            return
        }
        stopBreathing(node)
        node.childNode(withName: "progressArc")?.removeFromParent()

        let arc = SKShapeNode()
        arc.name = "progressArc"
        let path = CGMutablePath()
        path.addArc(
            center: .zero,
            radius: nodeRadius + 6,
            startAngle: 0,
            endAngle: .pi * 0.6,
            clockwise: false
        )
        arc.path = path
        arc.strokeColor = ConsoleAgentState.inProgress.skColor
        arc.lineWidth = 3
        arc.fillColor = .clear
        arc.zPosition = 3
        node.addChild(arc)
        arc.run(.repeatForever(.rotate(byAngle: -.pi * 2, duration: 1.4)), withKey: "spin")
    }

    /// 진행 호 제거(진행 상태를 벗어날 때).
    private func stopWorking(_ node: SKShapeNode) {
        node.childNode(withName: "progressArc")?.removeFromParent()
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
        stopBreathing(node)
        if !bandOrder.contains(agentType) {
            bandOrder.append(agentType)
        }
        node.strokeColor = ConsoleAgentState.awaitingApproval.skColor
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
        let original = node.strokeColor
        node.run(.sequence([.repeat(shake, count: 2)]))
        node.strokeColor = SKColor(red: 0.9, green: 0.2, blue: 0.2, alpha: 1)
        node.run(.sequence([.wait(forDuration: 0.4), .run { node.strokeColor = original }]))
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

    // MARK: - 방·대표실

    /// 부서 방 배경(rounded-rect, 부서 tint)과 라벨을 그린다. 매 호출 시 기존 방 노드 제거 후 재생성.
    private func renderRooms(_ rooms: [OfficeRoom]) {
        for child in children where child.name?.hasPrefix("room:") == true {
            child.removeFromParent()
        }
        for room in rooms {
            let rect = CGRect(
                x: room.rect.x, y: room.rect.y,
                width: room.rect.width, height: room.rect.height
            )
            let background = SKShapeNode(rect: rect, cornerRadius: 14)
            background.name = "room:\(room.department.rawValue)"
            background.fillColor = room.department.skColor.withAlphaComponent(0.08)
            background.strokeColor = room.department.skColor.withAlphaComponent(0.30)
            background.lineWidth = 1
            background.zPosition = -2
            addChild(background)

            let label = SKLabelNode(text: room.department.label)
            label.name = "room:\(room.department.rawValue):label"
            label.fontSize = 12
            label.fontColor = room.department.skColor
            label.horizontalAlignmentMode = .left
            label.verticalAlignmentMode = .top
            label.position = CGPoint(x: room.labelPoint.x, y: room.labelPoint.y)
            label.zPosition = -1
            addChild(label)
        }
    }

    /// 상단 밴드의 상시 "나(대표)" 노드를 1회 생성한다. 밴드 좌측에 배치(집결 슬롯과 최대한 분리).
    private func setupPresidentBand() {
        guard childNode(withName: "president") == nil else {
            return
        }
        let president = SKShapeNode(circleOfRadius: 22)
        president.name = "president"
        president.fillColor = Department.executive.skColor.withAlphaComponent(0.25)
        president.strokeColor = SKColor(white: 1, alpha: 0.5)
        president.lineWidth = 2
        president.zPosition = 8

        if let texture = symbolTexture(systemName: "crown.fill", pointSize: 20, color: Department.executive.skColor) {
            let icon = SKSpriteNode(texture: texture)
            icon.size = CGSize(width: 20, height: 20)
            icon.zPosition = 9
            president.addChild(icon)
        }
        let label = SKLabelNode(text: "나 (대표)")
        label.fontSize = 11
        label.fontColor = SKColor(white: 0.95, alpha: 1)
        label.verticalAlignmentMode = .center
        label.position = CGPoint(x: 0, y: -34)
        label.zPosition = 9
        president.addChild(label)

        addChild(president)
        positionPresidentBand()
    }

    /// 대표 노드·요약 HUD 를 밴드 좌측에 배치(크기 변화 시 재호출).
    private func positionPresidentBand() {
        let centerY = size.height - bandHeight / 2
        childNode(withName: "president")?.position = CGPoint(x: 44, y: centerY)
        if let summary = childNode(withName: "summaryHUD") as? SKLabelNode {
            summary.position = CGPoint(x: 84, y: centerY)
        }
    }

    /// 전사 요약(진행·승인·대기)을 밴드에 갱신한다.
    func updateCompanySummary(_ agents: [ConsoleAgent]) {
        let summary = companySummary(agents: agents)
        childNode(withName: "summaryHUD")?.removeFromParent()
        let label = SKLabelNode(
            text: "진행 \(summary.inProgress)  ·  승인 \(summary.awaitingApproval)  ·  대기 \(summary.waiting)"
        )
        label.name = "summaryHUD"
        label.fontSize = 13
        label.fontColor = SKColor(white: 0.85, alpha: 1)
        label.horizontalAlignmentMode = .left
        label.verticalAlignmentMode = .center
        label.zPosition = 8
        addChild(label)
        positionPresidentBand()
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

    override func mouseMoved(with event: NSEvent) {
        let location = event.location(in: self)
        let slots: [(agentType: String, point: OfficePoint)] = agentNodes.map {
            ($0.key, OfficePoint(x: Double($0.value.position.x), y: Double($0.value.position.y)))
        }
        let hit = agentTypeAt(
            point: OfficePoint(x: Double(location.x), y: Double(location.y)),
            slots: slots,
            radius: nodeRadius
        )
        if hit == hoveredAgentType {
            return
        }
        if let previous = hoveredAgentType, let node = agentNodes[previous] {
            node.removeAction(forKey: "hover")
            let restoreBreathing = SKAction.run { [weak self, weak node] in
                guard
                    let self,
                    let node,
                    self.waitingAgentTypes.contains(previous),
                    !self.bandOrder.contains(previous),
                    node.childNode(withName: "progressArc") == nil
                else {
                    return
                }
                startBreathing(node)
            }
            node.run(
                .sequence([.scale(to: 1.0, duration: 0.12), restoreBreathing]),
                withKey: "hover"
            )
            node.childNode(withName: "hoverBubble")?.removeFromParent()
        }
        hoveredAgentType = hit
        if let hit, let node = agentNodes[hit] {
            node.removeAction(forKey: "breathing")
            node.run(.scale(to: 1.12, duration: 0.12), withKey: "hover")
            if node.childNode(withName: "infoBubble") == nil, let text = agentBubbles[hit] {
                setChildLabel(
                    node, name: "hoverBubble", text: text,
                    position: CGPoint(x: 0, y: 46), fontSize: 11, color: SKColor(white: 1, alpha: 0.95)
                )
            }
        }
    }

    private func makeNode(for agent: ConsoleAgent) -> SKShapeNode {
        let dept = department(for: agent.agentType)
        let node = SKShapeNode(circleOfRadius: nodeRadius)
        node.fillColor = dept.fillTintColor
        node.strokeColor = agent.state.skColor
        node.lineWidth = 4

        // 부서 아이콘(SF Symbol → SKTexture). 실패 시 이니셜 폴백.
        if let texture = symbolTexture(systemName: dept.iconSymbolName, pointSize: 22, color: dept.skColor) {
            let icon = SKSpriteNode(texture: texture)
            icon.name = "icon"
            icon.size = CGSize(width: 22, height: 22)
            icon.position = .zero
            icon.zPosition = 2
            node.addChild(icon)
        } else {
            let initials = SKLabelNode(text: String(agent.displayName.prefix(2)))
            initials.name = "icon"
            initials.fontSize = 14
            initials.fontColor = dept.skColor
            initials.verticalAlignmentMode = .center
            initials.zPosition = 2
            node.addChild(initials)
        }

        let label = SKLabelNode(text: agent.displayName)
        label.name = "nameLabel"
        label.fontSize = 11
        label.fontColor = SKColor(white: 0.95, alpha: 1)
        label.verticalAlignmentMode = .center
        label.position = CGPoint(x: 0, y: -40)
        label.preferredMaxLayoutWidth = 90
        node.addChild(label)

        return node
    }
}
