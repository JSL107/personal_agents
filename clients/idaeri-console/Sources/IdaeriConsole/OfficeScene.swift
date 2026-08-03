import ConsoleCore
import SpriteKit

/// 픽셀 사무실 씬 — 에이전트를 타일 평면도 위의 사람으로 그리고, 상태 변화를 몸짓으로 옮긴다.
///
/// 두 축이 분리돼 있다:
///  - **배치**는 `officeFloorPlan`(순수)이 정한다. 이 씬은 타일 좌표를 화면 좌표로 옮겨 그리기만 한다.
///  - **연출**은 `VisualIntent`(순수)가 정한다. 이 씬은 그것을 걸음·앉기·줄서기로 실행한다.
///
/// 화면에서 일어나는 모든 움직임은 실제 상태의 번역이다. 장식용 배회는 넣지 않는다 —
/// 관제 화면에서 의미 없는 움직임은 "지금 뭐가 돌고 있나" 를 읽는 것을 방해한다.
final class OfficeScene: SKScene {
    // 원본 타일 스프라이트의 기준 폭. 화면 타일 크기를 이 값으로 나눈 비율을 모든
    // 스프라이트에 똑같이 적용해야 캐릭터·가구·바닥의 도트 크기가 서로 맞는다.
    private let referenceTileSize: CGFloat = 40

    private let floorLayer = SKNode()
    private let objectLayer = SKNode()
    private let overlayLayer = SKNode()

    private var plan = officeFloorPlan(agents: [])
    private var tileSize: CGFloat = 32
    private var gridOrigin: CGPoint = .zero
    private var spriteScale: CGFloat = 1

    private var characters: [String: CharacterNode] = [:]
    private var deskNodes: [String: SKSpriteNode] = [:]
    private var homeSeats: [String: TilePoint] = [:]
    /// 직전 pending phase — 완료 순간에만 한 번 튀어오르게 하려면 전이를 알아야 한다.
    private var lastPhases: [String: PendingPhase] = [:]
    /// 대표실 앞에 줄 선 순서. 승인 대기 인원이 늘면 줄이 길어진다.
    private var queueOrder: [String] = []
    private var lastStates: [String: ConsoleAgentState] = [:]
    private var lastSyncedAgents: [ConsoleAgent] = []
    private var agentBubbles: [String: String] = [:]
    private var hoveredAgentType: String?
    private var selectedAgentType: String?
    private var president: SKSpriteNode?

    /// 캐릭터 클릭 시 해당 agentType 을 뷰로 올린다(뷰가 지시/승인 UI 를 띄운다).
    var onAgentClick: ((String) -> Void)?

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1)
        view.window?.acceptsMouseMovedEvents = true
        let tracking = NSTrackingArea(
            rect: view.bounds,
            options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect],
            owner: view,
            userInfo: nil
        )
        view.addTrackingArea(tracking)

        floorLayer.zPosition = -1000
        objectLayer.zPosition = 0
        overlayLayer.zPosition = 1000
        addChild(floorLayer)
        addChild(objectLayer)
        addChild(overlayLayer)
    }

    /// 창 크기가 바뀌면 타일 크기와 격자 원점이 통째로 달라진다. 전부 다시 배치한다.
    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        guard !lastSyncedAgents.isEmpty else {
            return
        }
        sync(agents: lastSyncedAgents)
        // sync 는 줄 선 사람·걷는 사람의 자리를 일부러 건드리지 않는다(연출 유지).
        // 그런데 좌표계가 바뀐 지금은 그 배려가 독이 된다 — 옛 화면 좌표에 남아
        // 사무실 밖 허공에 서 있게 된다. 새 좌표계로 강제로 다시 앉힌다.
        repositionEveryone()
    }

    /// 모든 캐릭터를 현재 타일 기준으로 다시 놓는다(진행 중인 걸음은 끊는다).
    /// 좌표계가 바뀐 뒤에는 목적지까지의 남은 경로도 옛 좌표라 이어서 갈 수 없다.
    private func repositionEveryone() {
        for (agentType, node) in characters {
            node.removeAction(forKey: "walk")
            node.isWalking = false
            // 걷던 중이었다면 node.tile 은 경로 중간이라 자리로 못 쓴다.
            // 줄 선 사람은 자기 순번 칸으로, 나머지는 자기 책상으로 확정해 되돌린다.
            if let order = queueOrder.firstIndex(of: agentType), !plan.queueTiles.isEmpty {
                place(node, at: plan.queueTiles[min(order, plan.queueTiles.count - 1)])
                node.stand()
                node.apply(facing: .up)
            } else if let seat = homeSeats[agentType] {
                place(node, at: seat)
                node.sit()
            }
        }
    }

    // MARK: - 좌표 변환

    /// 격자 크기와 화면 크기로 타일 한 칸의 픽셀 크기·격자 원점을 정한다.
    /// 관제 화면이라 스크롤을 두지 않고 사무실 전체가 한 화면에 들어가게 맞춘다.
    private func recalculateMetrics() {
        guard plan.columns > 0, plan.rows > 0, size.width > 0, size.height > 0 else {
            return
        }
        tileSize = min(size.width / CGFloat(plan.columns), size.height / CGFloat(plan.rows))
        spriteScale = tileSize / referenceTileSize
        let usedWidth = tileSize * CGFloat(plan.columns)
        let usedHeight = tileSize * CGFloat(plan.rows)
        gridOrigin = CGPoint(
            x: (size.width - usedWidth) / 2,
            y: (size.height - usedHeight) / 2
        )
    }

    /// 타일의 바닥 중앙(캐릭터 발이 닿는 지점).
    private func floorPoint(_ tile: TilePoint) -> CGPoint {
        CGPoint(
            x: gridOrigin.x + (CGFloat(tile.x) + 0.5) * tileSize,
            y: gridOrigin.y + CGFloat(tile.y) * tileSize
        )
    }

    /// 타일 정중앙(바닥 타일용).
    private func centerPoint(_ tile: TilePoint) -> CGPoint {
        CGPoint(
            x: gridOrigin.x + (CGFloat(tile.x) + 0.5) * tileSize,
            y: gridOrigin.y + (CGFloat(tile.y) + 0.5) * tileSize
        )
    }

    /// 화면 아래쪽에 있을수록 앞에 그린다 — 탑다운에서 앞뒤가 뒤집히지 않게.
    /// 캐릭터 좌석은 책상보다 한 칸 위라, 이 규칙만으로 책상이 사람 앞을 가린다.
    private func depth(of tile: TilePoint) -> CGFloat {
        CGFloat(plan.rows - tile.y)
    }

    // MARK: - 동기화

    func sync(agents: [ConsoleAgent]) {
        lastSyncedAgents = agents
        plan = officeFloorPlan(agents: agents)
        recalculateMetrics()
        renderFloor()
        renderZoneLabels()
        renderFurniture()
        renderPresident()

        homeSeats = Dictionary(
            uniqueKeysWithValues: plan.desks.map { ($0.agentType, $0.seat) }
        )

        let incoming = Set(agents.map(\.agentType))
        for (agentType, node) in characters where !incoming.contains(agentType) {
            node.removeFromParent()
            characters[agentType] = nil
            queueOrder.removeAll { $0 == agentType }
            lastStates[agentType] = nil
        }

        for agent in agents {
            guard let seat = homeSeats[agent.agentType] else {
                continue  // 구역 정원을 넘어 자리를 못 받은 인원(현재 구성에서는 발생하지 않음)
            }
            let node = characters[agent.agentType] ?? makeCharacter(for: agent, seat: seat)
            if characters[agent.agentType] == nil {
                characters[agent.agentType] = node
                objectLayer.addChild(node)
                place(node, at: seat)
                node.sit()
            }
            node.resize(tileSize: tileSize, spriteScale: spriteScale)
            node.apply(state: agent.state)

            // 줄 서 있거나 걷는 중인 사람은 건드리지 않고, 나머지는 자기 자리에 둔다.
            if !queueOrder.contains(agent.agentType), !node.isWalking {
                place(node, at: seat)
                node.sit()
            }

            // 완료로 갓 바뀐 사람만 잠깐 탕비실에 다녀온다(상태 전이 시점 1회).
            let previous = lastStates[agent.agentType]
            if previous != nil, previous != .completed, agent.state == .completed {
                visitLounge(agent.agentType)
            }
            lastStates[agent.agentType] = agent.state
            // 직전 phase 를 그대로 넘긴다 — 여기서 nil 로 지우면 곧바로 이어지는
            // refreshOverlays 가 "완료로 막 바뀌었다" 로 오인해 매번 튀어오른다.
            applyMotion(for: agent, phase: lastPhases[agent.agentType])
        }

        layoutQueue()
        updateCompanySummary(agents)
    }

    private func makeCharacter(for agent: ConsoleAgent, seat: TilePoint) -> CharacterNode {
        let node = CharacterNode(
            agentType: agent.agentType, displayName: agent.displayName, tile: seat
        )
        node.resize(tileSize: tileSize, spriteScale: spriteScale)
        node.apply(state: agent.state)
        return node
    }

    /// 노드를 타일 위에 놓는다(즉시 이동 — 걸음 연출은 walk 가 담당).
    private func place(_ node: CharacterNode, at tile: TilePoint) {
        node.tile = tile
        node.position = floorPoint(tile)
        node.zPosition = depth(of: tile)
    }

    // MARK: - 바닥·가구

    private func renderFloor() {
        floorLayer.removeAllChildren()
        for row in 0..<plan.rows {
            for column in 0..<plan.columns {
                let tile = TilePoint(x: column, y: row)
                guard let texture = SpriteLoader.floorTexture(plan.floor[row][column]) else {
                    continue
                }
                let node = SKSpriteNode(texture: texture)
                node.size = CGSize(width: tileSize, height: tileSize)
                node.position = centerPoint(tile)
                // 이음선 제거 — 한 칸 걸러 뒤집어 깔면 맞닿는 변이 서로 같은 변이 된다.
                // 생성 이미지라 타일의 좌우·상하 끝이 서로 안 맞는데(실측 색차 15~22),
                // 뒤집어 깔면 그 불일치가 원리적으로 사라진다.
                node.xScale = column % 2 == 0 ? 1 : -1
                node.yScale = row % 2 == 0 ? 1 : -1
                floorLayer.addChild(node)
            }
        }
    }

    /// 부서 이름을 구역 왼쪽 위에 얹는다. 바닥 재질만으로는 어느 팀 구역인지 알 수 없다.
    private func renderZoneLabels() {
        overlayLayer.children
            .filter { $0.name?.hasPrefix("zone:") == true }
            .forEach { $0.removeFromParent() }
        for zone in plan.zones {
            let label = SKLabelNode(text: zone.department.label)
            label.name = "zone:\(zone.department.rawValue)"
            label.fontName = "Menlo-Bold"
            label.fontSize = max(9, tileSize * 0.34)
            let palette = agentDepartmentPaletteRGBA(zone.department)
            label.fontColor = SKColor(
                red: palette.red, green: palette.green, blue: palette.blue, alpha: 1
            )
            // 구역 아래쪽 빈 통로에 놓는다. 위쪽은 첫 줄 자리라 사람·책상과 겹친다.
            label.horizontalAlignmentMode = .center
            label.verticalAlignmentMode = .bottom
            label.position = CGPoint(
                x: gridOrigin.x + (CGFloat(zone.origin.x) + CGFloat(zone.width) / 2) * tileSize,
                y: gridOrigin.y + CGFloat(zone.origin.y) * tileSize + 3
            )
            overlayLayer.addChild(label)
        }
    }

    private func renderFurniture() {
        objectLayer.children
            .filter { $0.name?.hasPrefix("furn:") == true }
            .forEach { $0.removeFromParent() }
        deskNodes.removeAll()
        // 책상 칸 → 주인. 작업 중일 때 그 사람의 모니터만 깜빡이게 하려면 짝을 알아야 한다.
        let deskOwners = Dictionary(
            uniqueKeysWithValues: plan.desks.map { ($0.desk, $0.agentType) }
        )
        for placement in plan.furniture {
            guard let texture = SpriteLoader.furnitureTexture(placement.kind) else {
                continue
            }
            let node = SKSpriteNode(texture: texture)
            node.name = "furn:\(placement.kind.rawValue)"
            if placement.kind == .desk, let owner = deskOwners[placement.tile] {
                deskNodes[owner] = node
            }
            node.anchorPoint = CGPoint(x: 0.5, y: 0)
            let base = texture.size()
            node.size = CGSize(
                width: base.width * spriteScale, height: base.height * spriteScale
            )
            node.position = floorPoint(placement.tile)
            node.zPosition = depth(of: placement.tile)
            objectLayer.addChild(node)
        }
    }

    /// "나(대표)" — 조작 대상이 아니라 승인 줄의 기준점이다.
    private func renderPresident() {
        president?.removeFromParent()
        guard let texture = SpriteLoader.texture("char-down") else {
            return
        }
        let node = SKSpriteNode(texture: texture)
        node.anchorPoint = CGPoint(x: 0.5, y: 0)
        let base = texture.size()
        node.size = CGSize(width: base.width * spriteScale, height: base.height * spriteScale)
        node.position = floorPoint(plan.presidentTile)
        node.zPosition = depth(of: plan.presidentTile)
        node.color = SKColor(red: 0.95, green: 0.78, blue: 0.30, alpha: 1)
        node.colorBlendFactor = 0.35
        objectLayer.addChild(node)
        president = node

        let crown = SKLabelNode(text: "👑 나 (대표)")
        crown.fontSize = max(8, tileSize * 0.26)
        crown.fontColor = SKColor(white: 0.95, alpha: 1)
        crown.verticalAlignmentMode = .bottom
        crown.position = CGPoint(x: 0, y: node.size.height + 2)
        crown.zPosition = 1
        node.addChild(crown)
    }

    // MARK: - 걸음

    /// 목적지까지 걸어간다. 경로가 없으면 그 자리에 둔다(순간이동시키지 않는다 —
    /// 갑자기 사라졌다 나타나면 무슨 일이 일어났는지 읽을 수 없다).
    private func walk(
        _ node: CharacterNode,
        to goal: TilePoint,
        completion: (() -> Void)? = nil
    ) {
        node.removeAction(forKey: "walk")
        let path = officePath(from: node.tile, to: goal, walkable: plan.walkable)
        guard !path.isEmpty else {
            completion?()
            return
        }
        node.stand()
        node.isWalking = true

        // 한 칸당 이동 + 방향 전환 + 살짝 튀는 상하 움직임. 걷기 프레임이 없어도
        // 이 bob 만으로 "걸어간다" 로 읽힌다.
        var actions: [SKAction] = []
        var cursor = node.tile
        let stepDuration = 0.16
        let bobHeight = tileSize * 0.06
        for (index, step) in path.enumerated() {
            let direction = facing(from: cursor, to: step)
            let target = floorPoint(step)
            let lean: CGFloat = index % 2 == 0 ? 0.05 : -0.05
            let stepAction = SKAction.run { [weak self, weak node] in
                guard let self, let node else {
                    return
                }
                if let direction {
                    node.apply(facing: direction)
                }
                node.tile = step
                node.zPosition = self.depth(of: step)
                // 걷기 프레임이 없으니 한 걸음마다 위로 튀고 좌우로 살짝 기울여 발걸음을 만든다.
                let stride = SKAction.group([
                    .sequence([
                        .moveBy(x: 0, y: bobHeight, duration: stepDuration / 2),
                        .moveBy(x: 0, y: -bobHeight, duration: stepDuration / 2),
                    ]),
                    .rotate(toAngle: lean, duration: stepDuration / 2),
                ])
                node.sprite.run(stride)
            }
            let move = SKAction.move(to: target, duration: stepDuration)
            move.timingMode = .linear
            actions.append(stepAction)
            actions.append(move)
            cursor = step
        }
        actions.append(.run { [weak node] in
            node?.sprite.run(.rotate(toAngle: 0, duration: 0.1))
            node?.isWalking = false
            completion?()
        })
        node.run(.sequence(actions), withKey: "walk")
    }

    /// 자기 자리로 돌아가 앉는다.
    private func goHome(_ agentType: String, then afterArrival: (() -> Void)? = nil) {
        guard let node = characters[agentType], let seat = homeSeats[agentType] else {
            return
        }
        queueOrder.removeAll { $0 == agentType }
        layoutQueue()
        walk(node, to: seat) { [weak node] in
            node?.apply(facing: .down)
            node?.sit()
            afterArrival?()
        }
    }

    /// 대표실 앞에 줄을 선다. 이미 서 있으면 자리만 다시 정렬한다.
    private func joinQueue(_ agentType: String) {
        guard characters[agentType] != nil else {
            return
        }
        if !queueOrder.contains(agentType) {
            queueOrder.append(agentType)
        }
        layoutQueue()
    }

    /// 줄 선 사람들을 순서대로 대표 앞 칸에 배치한다.
    private func layoutQueue() {
        guard !plan.queueTiles.isEmpty else {
            return
        }
        for (order, agentType) in queueOrder.enumerated() {
            guard let node = characters[agentType] else {
                continue
            }
            // 줄이 자리보다 길면 마지막 칸에 겹쳐 세운다(대기 인원이 많다는 것 자체가 신호).
            let tile = plan.queueTiles[min(order, plan.queueTiles.count - 1)]
            if node.tile == tile {
                continue
            }
            walk(node, to: tile) { [weak node] in
                node?.apply(facing: .up)  // 대표를 바라본다
            }
        }
    }

    /// 완료 직후 탕비실에 잠깐 다녀온다. 비어 있는 휴식 자리를 고른다.
    private func visitLounge(_ agentType: String) {
        guard let node = characters[agentType], !queueOrder.contains(agentType) else {
            return
        }
        let occupied = Set(characters.values.map(\.tile))
        guard let spot = plan.loungeTiles.first(where: { !occupied.contains($0) }) else {
            return
        }
        stopWorking(node)
        walk(node, to: spot) { [weak self, weak node] in
            node?.apply(facing: .down)
            node?.run(.sequence([
                .wait(forDuration: 3.5),
                .run { self?.goHome(agentType) },
            ]))
        }
    }

    // MARK: - 연출 실행

    func perform(_ intents: [VisualIntent]) {
        for intent in intents {
            switch intent {
            case let .recolor(agentType, state):
                if let node = characters[agentType] {
                    node.apply(state: state)
                    if state != .inProgress {
                        stopWorking(node)
                    }
                }
            case let .working(agentType):
                startWorking(agentType)
            case let .handoff(from, to):
                handoff(from: from, to: to)
            case let .summonToBand(agentType):
                joinQueue(agentType)
            case let .returnHome(agentType):
                goHome(agentType)
            case let .reject(agentType):
                reject(agentType)
            case let .bubble(agentType, text):
                showBubble(agentType, text: text)
            }
        }
    }

    /// 일을 시작하면 자기 책상으로 걸어가 앉고, 앉자마자 타이핑을 시작한다.
    private func startWorking(_ agentType: String) {
        goHome(agentType) { [weak self] in
            self?.characters[agentType]?.startTyping()
            self?.startMonitorGlow(agentType)
        }
    }

    private func stopWorking(_ node: CharacterNode) {
        node.clearMotion()
        if let agentType = node.name {
            stopMonitorGlow(agentType)
        }
    }

    /// 결과를 넘겨주는 연출 — 보내는 사람이 받는 사람 자리 앞까지 걸어갔다 돌아온다.
    private func handoff(from: String, to: String) {
        guard let sender = characters[from], let receiverSeat = homeSeats[to] else {
            return
        }
        stopWorking(sender)
        // 받는 사람 책상 앞 칸에서 건넨다. 막혀 있으면 좌우 옆 칸으로.
        let approach = [
            TilePoint(x: receiverSeat.x, y: receiverSeat.y - 2),
            TilePoint(x: receiverSeat.x - 1, y: receiverSeat.y),
            TilePoint(x: receiverSeat.x + 1, y: receiverSeat.y),
        ].first { plan.walkable.contains($0) }
        guard let approach else {
            return
        }
        walk(sender, to: approach) { [weak self] in
            self?.characters[to]?.sprite.run(
                .sequence([.scale(to: 1.12, duration: 0.12), .scale(to: 1.0, duration: 0.12)])
            )
            self?.goHome(from)
        }
    }

    private func reject(_ agentType: String) {
        guard let node = characters[agentType] else {
            return
        }
        let shake = SKAction.sequence([
            .moveBy(x: 5, y: 0, duration: 0.05),
            .moveBy(x: -10, y: 0, duration: 0.1),
            .moveBy(x: 5, y: 0, duration: 0.05),
        ])
        node.sprite.run(.repeat(shake, count: 2))
        showBubble(agentType, text: "!")
    }

    private func showBubble(_ agentType: String, text: String) {
        guard let node = characters[agentType], !text.isEmpty else {
            return
        }
        node.childNode(withName: "bubble")?.removeFromParent()
        let label = SKLabelNode(text: text)
        label.name = "bubble"
        label.fontSize = max(8, tileSize * 0.26)
        label.fontColor = SKColor(white: 1, alpha: 1)
        label.verticalAlignmentMode = .bottom
        label.position = CGPoint(x: 0, y: node.sprite.size.height + 12)
        label.zPosition = 20
        node.addChild(label)
        label.run(
            .sequence([.wait(forDuration: 2.5), .fadeOut(withDuration: 0.5), .removeFromParent()])
        )
    }

    // MARK: - 관제 정보 오버레이

    /// 캐릭터 머리 위 정보(상시 말풍선·경과·승인 배지)를 현재 상태로 다시 그린다.
    func refreshOverlays(
        agents: [ConsoleAgent],
        runs: [ConsoleRun],
        pendingCommands: [PendingCommand],
        now: Date
    ) {
        for agent in agents {
            guard let node = characters[agent.agentType] else {
                continue
            }
            agentBubbles[agent.agentType] = agent.bubble
            let info = agentTokenInfo(
                agent: agent, runs: runs, pendingCommands: pendingCommands, now: now
            )
            if info.bubble != nil {
                node.childNode(withName: "hoverBubble")?.removeFromParent()
            }
            let top = node.sprite.size.height
            setChildLabel(
                node, name: "infoBubble", text: info.bubble,
                position: CGPoint(x: 0, y: top + 12),
                fontSize: max(8, tileSize * 0.24), color: SKColor(white: 1, alpha: 0.95)
            )
            setChildLabel(
                node, name: "elapsed", text: info.elapsed,
                position: CGPoint(x: 0, y: -tileSize * 0.42),
                fontSize: max(7, tileSize * 0.21), color: SKColor(white: 0.7, alpha: 1)
            )
            // 진행 표시는 머리 위 이모지(⏳🔄✅⚠️) 대신 몸짓으로 낸다 — 사람이 일하는 화면에서
            // 아이콘이 떠 있는 것보다 타이핑·엎드림이 무슨 일인지 더 빨리 읽힌다.
            applyMotion(for: agent, phase: info.badge)
        }
    }

    // MARK: - 상태 → 몸짓

    /// 상태와 pending 진행 단계를 몸짓으로 옮긴다.
    /// 내가 방금 보낸 지시(phase)가 있으면 그쪽이 우선한다 — 지금 눈으로 좇는 대상이라서.
    private func applyMotion(for agent: ConsoleAgent, phase: PendingPhase?) {
        guard let node = characters[agent.agentType], !node.isWalking else {
            return
        }
        let previous = lastPhases[agent.agentType]
        lastPhases[agent.agentType] = phase

        if let phase {
            switch phase {
            case .sent:
                // 지시는 접수됐지만 아직 시작 전 — 머리 위 점이 차오른다.
                showThinkingDots(agent.agentType)
                stopMonitorGlow(agent.agentType)
                node.startBreathing()
            case .running:
                hideThinkingDots(agent.agentType)
                startMonitorGlow(agent.agentType)
                node.startTyping()
            case .done:
                hideThinkingDots(agent.agentType)
                stopMonitorGlow(agent.agentType)
                if previous != .done {
                    node.playHop()
                }
                node.startBreathing()
            case .failed:
                hideThinkingDots(agent.agentType)
                stopMonitorGlow(agent.agentType)
                node.startSlump()
            }
            return
        }

        hideThinkingDots(agent.agentType)
        switch agent.state {
        case .inProgress:
            startMonitorGlow(agent.agentType)
            node.startTyping()
        case .failed:
            stopMonitorGlow(agent.agentType)
            node.startSlump()
        case .awaitingApproval:
            stopMonitorGlow(agent.agentType)
            node.startWaitTap()
        case .completed, .waiting, .awaitingIntegration:
            stopMonitorGlow(agent.agentType)
            node.startBreathing()
        }
    }

    /// 접수 대기 표시 — 점이 하나씩 늘었다 줄어든다.
    private func showThinkingDots(_ agentType: String) {
        guard let node = characters[agentType], node.childNode(withName: "dots") == nil else {
            return
        }
        let label = SKLabelNode(text: "·")
        label.name = "dots"
        label.fontName = "Menlo-Bold"
        label.fontSize = max(10, tileSize * 0.4)
        label.fontColor = SKColor(white: 0.95, alpha: 0.9)
        label.verticalAlignmentMode = .bottom
        label.horizontalAlignmentMode = .center
        label.position = CGPoint(x: 0, y: node.sprite.size.height + 2)
        label.zPosition = 20
        node.addChild(label)
        let cycle = SKAction.sequence([
            .run { label.text = "·" }, .wait(forDuration: 0.32),
            .run { label.text = "··" }, .wait(forDuration: 0.32),
            .run { label.text = "···" }, .wait(forDuration: 0.32),
        ])
        label.run(.repeatForever(cycle), withKey: "dots")
    }

    private func hideThinkingDots(_ agentType: String) {
        characters[agentType]?.childNode(withName: "dots")?.removeFromParent()
    }

    /// 작업 중인 사람의 책상 모니터가 은은하게 깜빡인다 — 자리에서 뭔가 돌고 있다는 신호.
    private func startMonitorGlow(_ agentType: String) {
        guard let desk = deskNodes[agentType], desk.action(forKey: "monitor") == nil else {
            return
        }
        desk.color = SKColor(red: 0.55, green: 0.85, blue: 1.0, alpha: 1)
        let pulse = SKAction.sequence([
            .colorize(withColorBlendFactor: 0.22, duration: 0.7),
            .colorize(withColorBlendFactor: 0.0, duration: 0.7),
        ])
        desk.run(.repeatForever(pulse), withKey: "monitor")
    }

    private func stopMonitorGlow(_ agentType: String) {
        guard let desk = deskNodes[agentType] else {
            return
        }
        desk.removeAction(forKey: "monitor")
        desk.colorBlendFactor = 0
    }

    /// 이름붙은 라벨 자식을 text 유무에 따라 add/update/remove 한다.
    private func setChildLabel(
        _ parent: SKNode,
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
        label.zPosition = 20
        parent.addChild(label)
    }

    /// 전사 요약을 화면 좌상단에 띄운다.
    func updateCompanySummary(_ agents: [ConsoleAgent]) {
        overlayLayer.childNode(withName: "summaryHUD")?.removeFromParent()
        let summary = companySummary(agents: agents)
        let label = SKLabelNode(
            text: "진행 \(summary.inProgress)  ·  승인 \(summary.awaitingApproval)  ·  대기 \(summary.waiting)"
        )
        label.name = "summaryHUD"
        label.fontSize = 13
        label.fontColor = SKColor(white: 0.88, alpha: 1)
        label.horizontalAlignmentMode = .left
        label.verticalAlignmentMode = .top
        label.position = CGPoint(x: 12, y: size.height - 10)
        overlayLayer.addChild(label)
    }

    /// 선택된 캐릭터에 지속 하이라이트를 얹는다.
    func setSelected(_ agentType: String?) {
        if selectedAgentType == agentType {
            return
        }
        if let previous = selectedAgentType {
            characters[previous]?.childNode(withName: "selectionRing")?.removeFromParent()
        }
        selectedAgentType = agentType
        guard let agentType, let node = characters[agentType] else {
            return
        }
        let ring = SKShapeNode(
            rect: CGRect(
                x: -tileSize * 0.42, y: -tileSize * 0.16,
                width: tileSize * 0.84, height: node.sprite.size.height + tileSize * 0.24
            ),
            cornerRadius: 4
        )
        ring.name = "selectionRing"
        ring.strokeColor = SKColor(white: 1, alpha: 0.85)
        ring.lineWidth = 1.5
        ring.fillColor = .clear
        ring.zPosition = 15
        node.addChild(ring)
    }

    // MARK: - 마우스

    override func mouseDown(with event: NSEvent) {
        if let hit = agentType(at: event.location(in: self)) {
            onAgentClick?(hit)
        }
    }

    override func mouseMoved(with event: NSEvent) {
        let hit = agentType(at: event.location(in: self))
        if hit == hoveredAgentType {
            return
        }
        if let previous = hoveredAgentType, let node = characters[previous] {
            node.sprite.run(.scale(to: 1.0, duration: 0.1))
            node.childNode(withName: "hoverBubble")?.removeFromParent()
        }
        hoveredAgentType = hit
        guard let hit, let node = characters[hit] else {
            return
        }
        node.sprite.run(.scale(to: 1.12, duration: 0.1))
        if node.childNode(withName: "infoBubble") == nil, let text = agentBubbles[hit] {
            setChildLabel(
                node, name: "hoverBubble", text: text,
                position: CGPoint(x: 0, y: node.sprite.size.height + 12),
                fontSize: max(8, tileSize * 0.24), color: SKColor(white: 1, alpha: 0.95)
            )
        }
    }

    /// 좌표에 있는 캐릭터. 캐릭터는 발 기준으로 서 있으므로 몸통 높이의 절반만큼 위를 중심으로 본다.
    private func agentType(at point: CGPoint) -> String? {
        let slots: [(agentType: String, point: OfficePoint)] = characters.map { entry in
            let center = CGPoint(
                x: entry.value.position.x,
                y: entry.value.position.y + entry.value.sprite.size.height / 2
            )
            return (entry.key, OfficePoint(x: Double(center.x), y: Double(center.y)))
        }
        return agentTypeAt(
            point: OfficePoint(x: Double(point.x), y: Double(point.y)),
            slots: slots,
            radius: Double(tileSize * 0.6)
        )
    }
}
