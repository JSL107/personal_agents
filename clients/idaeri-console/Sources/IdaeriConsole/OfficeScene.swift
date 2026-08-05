import ConsoleCore
import SpriteKit

/// 창·벽등에서 나온 빛 한 겹.
///
/// 노드만 들고 있으면 시각이 바뀌었을 때 그 겹이 창 빛인지 등 빛인지 알 수 없어 세기를
/// 되살릴 수 없다. 출처와 감쇠율을 함께 들고 있는 이유다.
struct OfficeLightLayer {
    enum Source {
        case window
        case lamp
    }

    let node: SKSpriteNode
    let fade: CGFloat
    let source: Source

    /// 벽등은 실내 조명이라 창밖 색을 따르지 않는다 — 밤에 창이 푸르다고 등까지 푸르면 전구가 아니다.
    private static let lampColor = SKColor(red: 1.00, green: 0.80, blue: 0.48, alpha: 1)
    private static let lampStrength: CGFloat = 0.26

    func apply(_ light: OfficeWindowLight) {
        switch source {
        case .window:
            node.color = SKColor(
                red: CGFloat(light.glow.red),
                green: CGFloat(light.glow.green),
                blue: CGFloat(light.glow.blue),
                alpha: 1
            )
            node.alpha = CGFloat(light.glowStrength) * fade
        case .lamp:
            node.color = Self.lampColor
            node.alpha = light.lampLit ? Self.lampStrength * fade : 0
        }
    }
}

/// 픽셀 사무실 씬 — 에이전트를 타일 평면도 위의 사람으로 그리고, 상태 변화를 몸짓으로 옮긴다.
///
/// 두 축이 분리돼 있다:
///  - **배치**는 `officeFloorPlan`(순수)이 정한다. 이 씬은 타일 좌표를 화면 좌표로 옮겨 그리기만 한다.
///  - **연출**은 `VisualIntent`(순수)가 정한다. 이 씬은 그것을 걸음·앉기·줄서기로 실행한다.
///
/// 자율 배회는 Core가 선발한 waiting 직원에게만 허용하고 실제 이벤트가 오면 즉시 끊는다 —
/// 정지 화면을 피하되 관제 신호와 충돌하는 순간에는 정보가 연출보다 먼저 보여야 한다.
final class OfficeScene: SKScene {
    // 원본 타일 스프라이트의 기준 폭. 화면 타일 크기를 이 값으로 나눈 비율이 도트 크기의 기준이다.
    // 가구 폭 상한(`FurnitureKind.sizeBoost`)이 같은 값을 봐야 하므로 ConsoleCore 가 단일 소스다.
    private let referenceTileSize = CGFloat(officeReferenceTileSize)

    // 캐릭터·가구 배율 계수는 `ConsoleCore`(순수)가 단일 소스로 갖는다 — 씬에 숫자를 박으면
    // 테스트가 닿지 않는다.
    private let characterScaleFactor = CGFloat(officeCharacterScaleFactor)

    private let floorLayer = SKNode()
    private let objectLayer = SKNode()
    private let overlayLayer = SKNode()

    private var plan = officeFloorPlan(agents: [])
    private var tileSize: CGFloat = 32
    private var gridOrigin: CGPoint = .zero
    private var spriteScale: CGFloat = 1
    /// 캐릭터 전용 배율(= spriteScale × characterScaleFactor).
    private var characterScale: CGFloat = 1

    /// 머리 위 표시(말풍선·경과·생각 점)를 이름표보다 더 위에 띄우기 위한 여유 높이.
    /// 이름표가 발밑에서 머리 위로 올라왔으므로, 이 값이 작으면 둘이 겹쳐 둘 다 못 읽는다.
    private var nameplateClearance: CGFloat {
        CGFloat(officeNameplateFontSize(tileSize: Double(tileSize)))
            + tileSize * CGFloat(officeNameplateGapTiles) + 6
    }

    private var characters: [String: CharacterNode] = [:]
    private var deskNodes: [String: SKSpriteNode] = [:]
    private var homeSeats: [String: TilePoint] = [:]
    /// 직전 pending phase — 완료 순간에만 한 번 튀어오르게 하려면 전이를 알아야 한다.
    private var lastPhases: [String: PendingPhase] = [:]
    /// 대표실 앞에 줄 선 순서. 승인 대기 인원이 늘면 줄이 길어진다.
    private var queueOrder: [String] = []
    private var lastStates: [String: ConsoleAgentState] = [:]
    private var lastSyncedAgents: [ConsoleAgent] = []
    private var lastSyncedApprovals: [ConsoleApproval] = []
    private var agentBubbles: [String: String] = [:]
    private var hoveredAgentType: String?
    private var selectedAgentType: String?
    private var president: SKSpriteNode?
    /// 내가 직접 돌리는 CLI 세션. 에이전트와 달리 사규가 배정한 자리가 없어 대표 앞줄에 선다.
    private var sessionNodes: [String: SKNode] = [:]
    private var lastSyncedSessions: [ConsoleSession] = []
    /// 이벤트가 오면 자율 연출을 즉시 끊을 수 있어야 하므로 완료 후 탕비실 이동도 함께 추적한다.
    private var strollingAgents: Set<String> = []
    /// 같은 사람이 짧은 간격으로 계속 왕복하지 않게 Core 쿨다운 판정에 넘긴다.
    private var lastStrollAt: [String: Double] = [:]
    /// 사람별 목적지를 회차마다 바꾸되 실행마다 같은 순서가 나오게 정수 회차만 섞는다.
    private var strollRound = 0
    private var windowNodes: [SKSpriteNode] = []
    private var wallLampNodes: [SKSpriteNode] = []
    private var lightLayers: [OfficeLightLayer] = []

    /// 캐릭터 클릭 시 해당 agentType 을 뷰로 올린다(뷰가 지시/승인 UI 를 띄운다).
    var onAgentClick: ((String) -> Void)?

    /// 시각을 고정한다(화면 회귀 렌더 전용, 평소엔 nil).
    /// 밤 화면을 확인하려고 밤까지 기다릴 수는 없어서 둔 주입점이다.
    var hourOverride: Int?

    /// 조명이 볼 시각. 주입값이 있으면 그것을, 없으면 실제 시계를 본다.
    private func currentHour() -> Int {
        hourOverride ?? Calendar.current.component(.hour, from: Date())
    }

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
        startIdleLoop()
    }

    /// 창 크기가 바뀌면 타일 크기와 격자 원점이 통째로 달라진다. 전부 다시 배치한다.
    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        guard !lastSyncedAgents.isEmpty else {
            return
        }
        sync(agents: lastSyncedAgents, approvals: lastSyncedApprovals)
        // sync 는 줄 선 사람·걷는 사람의 자리를 일부러 건드리지 않는다(연출 유지).
        // 그런데 좌표계가 바뀐 지금은 그 배려가 독이 된다 — 옛 화면 좌표에 남아
        // 사무실 밖 허공에 서 있게 된다. 새 좌표계로 강제로 다시 앉힌다.
        repositionEveryone()
        updateDaylight()
    }

    /// 모든 캐릭터를 현재 타일 기준으로 다시 놓는다(진행 중인 걸음은 끊는다).
    /// 좌표계가 바뀐 뒤에는 목적지까지의 남은 경로도 옛 좌표라 이어서 갈 수 없다.
    private func repositionEveryone() {
        // 옛 좌표계 목적지와 머무름 콜백은 새 격자에서 의미가 없으므로 추적을 먼저 비운다.
        strollingAgents.removeAll()
        for (agentType, node) in characters {
            node.removeAction(forKey: "walk")
            node.removeAction(forKey: "stroll")
            // endWalk 가 isWalking 해제까지 맡는다(걸음 프레임 도입 때 캡슐화).
            node.endWalk()
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
        characterScale = spriteScale * characterScaleFactor
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

    func sync(agents: [ConsoleAgent], approvals: [ConsoleApproval]) {
        lastSyncedAgents = agents
        lastSyncedApprovals = approvals
        plan = officeFloorPlan(agents: agents)
        recalculateMetrics()
        renderFloor()
        renderZoneLabels()
        renderFurniture()
        // 책상이 새로 만들어진 뒤여야 한다 — 서류는 책상 노드의 자식으로 붙는다.
        renderDeskPapers(agents: agents)
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
            strollingAgents.remove(agentType)
            lastStrollAt[agentType] = nil
        }

        reconcileQueue(agents: agents, approvals: approvals)

        // 재연결처럼 이벤트 없이 스냅샷만 갱신되는 경로에는 cancelStroll 훅이 없다.
        // 상태가 대기에서 벗어난 배회자는 여기서 끊고 자리로 돌려보낸다.
        for agentType in strollersToStop(strolling: strollingAgents, agents: agents) {
            cancelStroll(agentType)
            goHome(agentType)
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
            node.resize(tileSize: tileSize, spriteScale: characterScale)
            // 부서는 스냅샷마다 확인한다. 노드는 재사용되므로 여기서 갱신하지 않으면 사규가
            // 사람을 옮겼을 때 방만 바뀌고 옷은 옛 부서색으로 남는다.
            node.apply(department: agent.resolvedDepartment)
            node.apply(state: agent.state)

            // 줄 서 있거나 걷는 중인 사람은 건드리지 않고, 나머지는 자기 자리에 둔다.
            if !queueOrder.contains(agent.agentType),
               !node.isWalking,
               !strollingAgents.contains(agent.agentType) {
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
        // 평면도·타일 크기가 새로 잡혔으므로 세션도 다시 세운다(내부에서 요약까지 갱신한다).
        syncSessions(lastSyncedSessions)
        updateDaylight()
    }

    /// 스냅샷을 정본으로 승인 줄을 맞춘다.
    ///
    /// 재연결 경로에는 `approval.resolved` 가 오지 않아, 승인이 끝난 사람이 대표실 앞에 영영
    /// 남는다(`sync` 는 줄 선 사람을 일부러 건드리지 않는다). 그 사람은 자리로 돌아가지도
    /// 배회하지도 못한다 — 유휴 감독관이 줄 선 사람을 후보에서 빼기 때문이다.
    ///
    /// `sync` 와 분리해 둔 이유는 비용이다. 승인 알림은 수 분 간격으로 오가는데, 그때마다
    /// 씬 전체(바닥 500여 타일·가구·27명)를 다시 만들 이유가 없다.
    func reconcileQueue(agents: [ConsoleAgent], approvals: [ConsoleApproval]) {
        lastSyncedApprovals = approvals
        let reconciled = reconciledQueueOrder(
            current: queueOrder,
            agents: agents,
            approvals: approvals
        )
        guard reconciled != queueOrder else {
            return
        }
        let leaving = queueOrder.filter { !reconciled.contains($0) }
        let joining = reconciled.filter { !queueOrder.contains($0) }
        queueOrder = reconciled
        for agentType in leaving {
            goHome(agentType)
        }
        // 새로 줄에 들어온 사람이 배회 중이면 끊는다 — 승인 대기는 관제 신호이고 배회는 연출이다.
        // 끊지 않으면 머무름 콜백이 나중에 깨어나 줄에서 자리로 끌고 간다.
        for agentType in joining {
            cancelStroll(agentType)
        }
        // 앞사람이 빠지면 뒷사람 순번이 당겨진다 — 줄에 빈 칸이 남지 않게 다시 세운다.
        layoutQueue()
    }

    private func makeCharacter(for agent: ConsoleAgent, seat: TilePoint) -> CharacterNode {
        let node = CharacterNode(
            agentType: agent.agentType, displayName: agent.displayName,
            department: agent.resolvedDepartment, tile: seat
        )
        node.resize(tileSize: tileSize, spriteScale: characterScale)
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
                let kind = plan.floor[row][column]
                guard let texture = SpriteLoader.floorTexture(kind) else {
                    continue
                }
                let node = SKSpriteNode(texture: texture)
                node.size = CGSize(width: tileSize, height: tileSize)
                node.position = centerPoint(tile)
                if kind == .wall {
                    applyWallShading(node, column: column, row: row)
                } else {
                    // 바닥은 배경으로 물러나야 한다. 어두운 색을 섞어 대비·채도를 함께 누른다
                    // (누르는 세기는 타일 원본 밝기에 따라 다르다 — FloorTile.muteStrength).
                    //
                    // 섞는 색에 **부서색을 태운다.** 누르는 세기가 0.54~0.78 로 높아 원본 바닥재의
                    // 차이가 거의 지워지는데, 시간대 색막까지 얹히면 여섯 방이 한 가지 색으로
                    // 보였다("어디가 어느 부서인지 문패를 읽어야 안다"). 벽이 이미 같은 방식으로
                    // 부서 색조를 띠므로(applyWallShading), 바닥도 같은 규칙을 따르게 해 방 전체가
                    // 한 색조로 묶이게 한다.
                    node.color = floorMuteColor(
                        department: wallDepartment(x: column, y: row, zones: plan.zones)
                    )
                    node.colorBlendFactor = CGFloat(kind.muteStrength)
                    // 이음선 제거 — 한 칸 걸러 뒤집어 깔면 맞닿는 변이 서로 같은 변이 된다.
                    // 생성 이미지라 타일의 좌우·상하 끝이 서로 안 맞는데(실측 색차 15~22),
                    // 뒤집어 깔면 그 불일치가 원리적으로 사라진다.
                    node.xScale = column % 2 == 0 ? 1 : -1
                    node.yScale = row % 2 == 0 ? 1 : -1
                }
                floorLayer.addChild(node)
            }
        }
        // 벽 타일을 다 깐 뒤에 얹는다 — 먼저 그리면 같은 레이어의 벽이 창을 덮는다.
        renderWallFixtures()
    }

    /// 바닥 노이즈를 누를 때 섞는 색. 부서 구역 안이면 그 부서 색조를 옅게 태운다.
    ///
    /// 밝기는 중성 회색에 맡기고 **색조만** 가져온다. 부서색을 그대로 섞으면 골드·코랄처럼
    /// 밝은 색을 쓰는 방의 바닥이 통째로 밝아져, 방이 아니라 조명이 다른 것처럼 보인다
    /// (벽에서 이미 겪은 문제 — applyWallShading 의 같은 근거).
    private func floorMuteColor(department: Department?) -> SKColor {
        let base = (red: 0.17, green: 0.16, blue: 0.18)
        guard let department else {
            return SKColor(red: base.red, green: base.green, blue: base.blue, alpha: 1)
        }
        let tint = agentDepartmentPaletteRGBA(department)
        let mix = 0.32
        let dim = 0.55
        return SKColor(
            red: base.red * (1 - mix) + tint.red * dim * mix,
            green: base.green * (1 - mix) + tint.green * dim * mix,
            blue: base.blue * (1 - mix) + tint.blue * dim * mix,
            alpha: 1
        )
    }
    /// 눌러 놓은 벽의 기본색. 벽 원본이 밝은 크림이라 그대로 깔면 도면처럼 보인다.
    private let wallBaseColor = (red: 0.26, green: 0.22, blue: 0.20)

    /// 벽 한 칸의 색·명암을 정한다.
    ///
    /// 세 가지를 함께 처리한다.
    ///  - **뒤집지 않는다.** 뒤집기는 바닥 이음선 대책인데, 벽 원본은 아래쪽에 어두운 걸레받이
    ///    띠가 있어서 한 칸 걸러 뒤집으면 그 띠가 위아래로 오가며 가로 줄무늬가 된다.
    ///  - **세그먼트 맨 위 칸만 밝게.** 위가 벽이 아닌 칸이 벽면의 윗면이다. 여기만 덜 누르면
    ///    평평한 사각형에 "위가 밝고 아래가 어두운" 최소한의 높이감이 생긴다.
    ///  - **부서색을 아주 옅게.** 방마다 벽 색조가 미세하게 달라 문패 없이도 구별된다.
    private func applyWallShading(_ node: SKSpriteNode, column: Int, row: Int) {
        // 벽면의 "윗면" = 위쪽이 벽이 아니면서 아래쪽으로는 벽이 이어지는 칸. 두 조건을 함께
        // 봐야 한다 — 위쪽만 보면 아래 구역 천장처럼 한 칸짜리 가로 벽이 전 구간 밝아져,
        // 방과 방 사이에 밝은 띠가 가로로 길게 눕는다.
        let openAbove = row + 1 >= plan.rows || plan.floor[row + 1][column] != .wall
        let wallBelow = row > 0 && plan.floor[row - 1][column] == .wall
        let isTopOfWall = openAbove && wallBelow
        var color = wallBaseColor
        if let department = wallDepartment(x: column, y: row, zones: plan.zones) {
            let tint = agentDepartmentPaletteRGBA(department)
            let mix = 0.34
            // 부서색을 그대로 섞으면 골드·코랄처럼 밝은 색을 쓰는 방의 벽이 통째로 밝아져,
            // 방 사이가 다시 눈에 띄는 띠가 된다. 밝기는 벽 기본색에 맡기고 색조만 가져온다.
            let dim = 0.5
            color = (
                red: color.red * (1 - mix) + tint.red * dim * mix,
                green: color.green * (1 - mix) + tint.green * dim * mix,
                blue: color.blue * (1 - mix) + tint.blue * dim * mix
            )
        }
        node.color = SKColor(red: color.red, green: color.green, blue: color.blue, alpha: 1)
        // 벽 원본이 밝은 크림이라 덜 누르면 눌러 놓은 색이 원본에 씻긴다.
        node.colorBlendFactor = isTopOfWall ? 0.60 : 0.84
        node.xScale = 1
        node.yScale = 1
    }

    /// 부서 이름을 구역 왼쪽 위에 얹는다. 바닥 재질만으로는 어느 팀 구역인지 알 수 없다.
    private func renderZoneLabels() {
        overlayLayer.children
            .filter { $0.name?.hasPrefix("zone:") == true }
            .forEach { $0.removeFromParent() }
        for zone in plan.zones {
            let palette = agentDepartmentPaletteRGBA(zone.department)
            // 구역 위쪽 경계 줄(칸막이 벽 또는 통로)에 문패처럼 얹는다. 자리 묶음이 구역
            // 맨 아래 줄부터 쌓이므로 아래쪽은 책상·사람과 겹친다.
            let holder = SKNode()
            holder.name = "zone:\(zone.department.rawValue)"
            holder.position = CGPoint(
                x: gridOrigin.x + (CGFloat(zone.origin.x) + CGFloat(zone.width) / 2) * tileSize,
                // 높이는 구역 경계가 아니라 **그 방 첫 좌석 행 이름표 위끝**에서 파생한다.
                // 문패는 overlayLayer(z=1000) 라 겹치면 캐릭터 라벨을 덮는데, 문패가 구역
                // 정중앙(칸 5.5)이고 좌석이 1·3·5·7 이라 겹치는 순간 매번 같은 사람
                // (세 번째 좌석)의 이름이 통째로 사라진다. 한글 글자 크기에 하한이 있어
                // 작은 창일수록 타일 대비 이름표가 커지므로, 고정 배수로는 큰 창에서만 맞는다.
                y: gridOrigin.y
                    + CGFloat(
                        officeZoneLabelBottomTiles(
                            zone: zone,
                            topSeatY: officeTopSeatY(zone: zone, desks: plan.desks),
                            tileSize: Double(tileSize)
                        )
                    ) * tileSize
            )

            let label = SKLabelNode(text: "\(zone.department.icon) \(zone.department.label)")
            label.fontName = officeLabelFontName
            label.fontSize = max(officeZoneLabelMinFontSize, tileSize * 0.38)
            label.fontColor = SKColor(
                red: palette.red, green: palette.green, blue: palette.blue, alpha: 1
            )
            label.horizontalAlignmentMode = .center
            label.verticalAlignmentMode = .bottom
            label.zPosition = 1

            // 문패 판 — 벽돌·나무 무늬 위에 글자가 그냥 놓이면 읽히지 않는다.
            let plate = SKShapeNode(
                rect: label.frame.insetBy(dx: -6, dy: -3), cornerRadius: 3
            )
            plate.fillColor = SKColor(white: 0.07, alpha: 0.78)
            plate.strokeColor = SKColor(
                red: palette.red, green: palette.green, blue: palette.blue, alpha: 0.55
            )
            plate.lineWidth = 1

            holder.addChild(plate)
            holder.addChild(label)
            overlayLayer.addChild(holder)
        }
        renderCommonAreaLabels()
    }

    /// 상단 밴드(회의실·대표실·탕비실)에 이름을 단다.
    ///
    /// 화면 위쪽 1/4 을 차지하는데 이름이 없어 "가구만 놓인 빈 띠" 로 보였다. 부서 문패와 달리
    /// **왼쪽 끝에 붙인다** — 밴드 맨 아래 줄과 위 구역 문패가 같은 높이대라, 둘 다 가운데
    /// 정렬하면 x 까지 겹쳐 서로를 덮는다.
    ///
    /// 색은 부서색을 쓰지 않고 중성 회색이다. 사람이 상주하지 않는 방이라 부서 문패보다
    /// 뒤로 물러나야 관제 신호(사람·상태 링)가 먼저 읽힌다.
    private func renderCommonAreaLabels() {
        overlayLayer.children
            .filter { $0.name?.hasPrefix("common:") == true }
            .forEach { $0.removeFromParent() }
        for area in plan.commonAreas {
            let holder = SKNode()
            holder.name = "common:\(area.label)"
            holder.position = CGPoint(
                x: gridOrigin.x + (CGFloat(area.originX) + 0.5) * tileSize,
                y: gridOrigin.y + (CGFloat(area.labelY) + 0.2) * tileSize
            )

            let label = SKLabelNode(text: "\(area.icon) \(area.label)")
            label.fontName = officeLabelFontName
            label.fontSize = max(officeZoneLabelMinFontSize, tileSize * 0.32)
            label.fontColor = SKColor(white: 0.72, alpha: 1)
            label.horizontalAlignmentMode = .left
            label.verticalAlignmentMode = .bottom
            label.zPosition = 1

            let plate = SKShapeNode(
                rect: label.frame.insetBy(dx: -5, dy: -3), cornerRadius: 3
            )
            plate.fillColor = SKColor(white: 0.07, alpha: 0.62)
            plate.strokeColor = SKColor(white: 0.45, alpha: 0.4)
            plate.lineWidth = 1

            holder.addChild(plate)
            holder.addChild(label)
            overlayLayer.addChild(holder)
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
            // 큰 가구만 sizeBoost 로 키운다 — 캐릭터를 한 칸으로 줄인 만큼 책상·소파가
            // 상대적으로 작아 보이는 것을 되돌린다(배율의 근거는 FurnitureKind.sizeBoost).
            let scale = spriteScale * CGFloat(placement.kind.sizeBoost)
            node.size = CGSize(width: base.width * scale, height: base.height * scale)
            node.position = floorPoint(placement.tile)
            node.zPosition = depth(of: placement.tile)
            objectLayer.addChild(node)
        }
    }

    /// 오늘 끝낸 일이 많은 사람의 책상에 서류를 높이 쌓는다.
    ///
    /// 승인 대기처럼 "손이 필요한" 신호가 아니라 하루의 흐름을 보여주는 배경 정보다. 그래서
    /// 상태 링·이름표보다 뒤로 물러나야 하고, 사람이나 라벨을 가리면 안 된다.
    ///
    /// **책상 노드의 자식으로 붙인다.** 창 크기가 바뀌면 `renderFurniture` 가 책상을 통째로
    /// 다시 만드는데, 씬에 직접 붙이면 그때마다 위치와 앞뒤 순서를 손으로 다시 맞춰야 한다.
    /// 자식이면 둘 다 저절로 따라온다. 모니터 깜빡임이 책상 노드의 색을 물들이지만
    /// (`startMonitorGlow`) 자식은 그 색을 물려받지 않으므로 서류가 함께 파래지지 않는다.
    private func renderDeskPapers(agents: [ConsoleAgent]) {
        guard let texture = SpriteLoader.texture("desk-paper") else {
            return  // 에셋이 없으면 아무것도 그리지 않는다(빈 책상 = 0건과 같은 그림)
        }
        let base = texture.size()
        for agent in agents {
            guard let desk = deskNodes[agent.agentType] else {
                continue
            }
            // 책상이 다시 만들어진 직후라 자식이 없는 것이 정상이지만, 갱신 경로가 하나로
            // 유지되도록 지우고 다시 쌓는다 — 나중에 이 함수만 따로 부르게 되어도 장수가 누적되지 않는다.
            desk.childNode(withName: "papers")?.removeFromParent()
            let count = officeDeskPaperCount(doneToday: agent.doneToday)
            guard count > 0 else {
                continue
            }
            let holder = SKNode()
            holder.name = "papers"
            // 책상 노드가 발밑 기준(anchor y = 0)이므로 자식 좌표도 발밑에서 잰다.
            holder.position = CGPoint(
                x: tileSize * CGFloat(officeDeskPaperOriginTiles.x),
                y: tileSize * CGFloat(officeDeskPaperOriginTiles.y)
            )
            for index in 0..<count {
                let sheet = SKSpriteNode(texture: texture)
                sheet.anchorPoint = CGPoint(x: 0.5, y: 0)
                sheet.size = CGSize(
                    width: base.width * spriteScale, height: base.height * spriteScale
                )
                // 한 장씩 위로 쌓고 좌우로 번갈아 어긋낸다 — 자로 맞춰 쌓으면 한 장처럼 보인다.
                //
                // 어긋내는 폭을 위로 갈수록 넓힌다. 고정 폭으로 쌓으면 낱장이 16×9픽셀밖에 안 돼
                // 층이 뭉개지고, 1장과 5장이 "흰 뭉치" 하나로 같아 보인다(실측). 위가 벌어지면
                // 더미의 **가로 폭**이 장수에 따라 자라, 확대하지 않아도 양이 읽힌다.
                let jitter = index % 2 == 0 ? 1.0 : -1.0
                let spread =
                    officeDeskPaperJitterTiles
                    * (1.0 + Double(index) * officeDeskPaperSpreadGrowth)
                sheet.position = CGPoint(
                    x: tileSize * CGFloat(spread * jitter),
                    y: tileSize * CGFloat(Double(index) * officeDeskPaperStepTiles)
                )
                // 위 장이 아래 장을 덮어야 층이 읽힌다.
                sheet.zPosition = CGFloat(index) * 0.01
                holder.addChild(sheet)
            }
            desk.addChild(holder)
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
        // 대표도 사람이므로 캐릭터 배율을 따른다 — 여기만 빠지면 대표만 거인이 된다.
        node.size = CGSize(
            width: base.width * characterScale, height: base.height * characterScale
        )
        node.position = floorPoint(plan.presidentTile)
        node.zPosition = depth(of: plan.presidentTile)
        node.color = SKColor(red: 0.95, green: 0.78, blue: 0.30, alpha: 1)
        node.colorBlendFactor = 0.35
        objectLayer.addChild(node)
        president = node

        let crown = SKLabelNode(text: "👑 나 (대표)")
        crown.fontName = officeLabelFontName
        crown.fontSize = max(officeNameplateMinFontSize, tileSize * 0.30)
        crown.fontColor = SKColor(white: 0.95, alpha: 1)
        crown.verticalAlignmentMode = .bottom
        crown.position = CGPoint(x: 0, y: node.size.height + 2)
        crown.zPosition = 1
        node.addChild(crown)
    }

    // MARK: - 걸음

    /// 틱 단위 반복 하나면 충분해 프레임마다 같은 판정을 되풀이하지 않는다.
    private func startIdleLoop() {
        removeAction(forKey: "idleLoop")
        let cycle = SKAction.sequence([
            .wait(forDuration: officeStrollTickSeconds),
            .run { [weak self] in self?.runIdleSupervisor() },
        ])
        run(.repeatForever(cycle), withKey: "idleLoop")
    }

    /// 씬 상태를 순수 후보 값으로 옮긴 뒤 선발·배정 판단은 전부 ConsoleCore에 맡긴다.
    private func runIdleSupervisor() {
        guard !lastSyncedAgents.isEmpty else {
            return
        }
        let now = Date().timeIntervalSinceReferenceDate
        let candidates = lastSyncedAgents.map { agent in
            OfficeIdleCandidate(
                agentType: agent.agentType,
                state: agent.state,
                isQueued: queueOrder.contains(agent.agentType),
                isWalking: characters[agent.agentType]?.isWalking ?? true,
                hasPendingWork: lastPhases[agent.agentType] != nil,
                lastStrollAt: lastStrollAt[agent.agentType]
            )
        }
        let picks = officeStrollPicks(
            candidates: candidates,
            activeStrollCount: strollingAgents.count,
            now: now
        )

        strollRound += 1
        let spots = officeStrollSpots(plan: plan)
        var occupied = Set(characters.values.map(\.tile))
        for agentType in picks {
            guard let spot = officeStrollSpot(
                for: agentType,
                round: strollRound,
                spots: spots,
                occupied: occupied
            ) else {
                continue
            }
            occupied.insert(spot.tile)
            stroll(agentType, to: spot)
        }
        updateDaylight()
    }

    /// 목적지에 머무는 action을 따로 이름 붙여 실제 이벤트가 걸음과 대기를 모두 끊게 한다.
    private func stroll(_ agentType: String, to spot: OfficeStrollSpot) {
        guard let node = characters[agentType] else {
            return
        }
        strollingAgents.insert(agentType)
        lastStrollAt[agentType] = Date().timeIntervalSinceReferenceDate
        stopWorking(node)
        walk(node, to: spot.tile) { [weak self, weak node] in
            node?.apply(facing: .up)
            node?.run(.sequence([
                .wait(forDuration: spot.dwellSeconds),
                .run { [weak self] in self?.endStroll(agentType) },
            ]), withKey: "stroll")
        }
    }

    /// 이벤트가 이미 배회를 취소했다면 늦게 도착한 콜백이 사람을 다시 움직이지 못하게 한다.
    ///
    /// **자리로 다 돌아온 뒤에** 배회 인원에서 뺀다. 머무름이 끝나는 순간 빼 버리면 복귀하는
    /// 걸음이 상한 계산에서 빠져, 다음 틱이 곧바로 두 명을 더 내보낸다 — 화면에서 동시에
    /// 움직이는 사람이 상한(2명)을 넘어 넷까지 늘어난다. 복귀도 배회의 일부다.
    private func endStroll(_ agentType: String) {
        guard strollingAgents.contains(agentType) else {
            return
        }
        goHome(agentType) { [weak self] in
            self?.strollingAgents.remove(agentType)
        }
    }

    /// 관제 이벤트가 장식 연출보다 우선하므로 이동 중간 위치에서라도 즉시 제어권을 넘긴다.
    private func cancelStroll(_ agentType: String) {
        guard strollingAgents.remove(agentType) != nil else {
            return
        }
        guard let node = characters[agentType] else {
            return
        }
        node.removeAction(forKey: "stroll")
        node.removeAction(forKey: "walk")
        node.sprite.removeAllActions()
        node.sprite.yScale = 1
        node.sprite.zRotation = 0
        // bob 중간 프레임에서 끊기면 y가 떠 있는 값으로 남으므로 서 있는 자세의 기준점도 복원한다.
        node.clearMotion()
        // 걸음 프레임까지 되돌린다. isWalking 만 내리면 다리가 엇갈린 그림이 그대로 남아
        // 배회를 끊긴 사람만 짝다리로 굳는다(3단계에서 walkStep 이 붙은 뒤 생긴 조건).
        node.endWalk()
    }

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
            // 위에서 진행 중이던 걸음을 끊었으므로 상태 표식도 함께 되돌린다. 안 그러면
            // 이 사람만 영구히 "걷는 중" 으로 남아 상태 갱신에서 통째로 빠지고(sync·applyMotion 이
            // 걷는 사람을 건드리지 않는다), 걸음 프레임이 붙은 뒤로는 짝다리로 굳는다.
            node.endWalk()
            completion?()
            return
        }
        node.stand()
        node.isWalking = true

        // 한 칸당 이동 + 방향 전환 + 걸음 그림 교체. 다리 교차는 그림이 보여준다.
        var actions: [SKAction] = []
        var cursor = node.tile
        // 한 칸 0.16초는 초당 6칸이라, 다리가 교차하는 것보다 몸이 먼저 지나가 종종거려 보였다.
        // 픽셀 게임의 보통 걸음 속도(초당 4~5칸)로 늦춘다.
        let stepDuration = 0.20
        // 상하 흔들림은 **보조 신호로만** 남긴다.
        //
        // 예전에는 이 bob(0.11칸)과 좌우 기울임(±5°)·착지 눌림이 걸음 그림을 대신하는
        // 유일한 신호였다. 3단계에서 걸음 그림 2장이 들어왔는데 이 셋을 걷어내지 않아,
        // 다리가 교차하는 위에 몸이 튀고 기울고 눌리는 것이 겹쳐 걷는 게 아니라 옆으로
        // 통통 뛰는 것으로 보였다. 기울임·눌림은 걸음 그림과 역할이 정확히 겹치므로 뺐고,
        // bob 만 그림에 없는 성분(상하 성분은 다리만 옮긴 파생 프레임에 없다)이라 남긴다.
        let bobHeight = tileSize * 0.035
        for step in path {
            let direction = facing(from: cursor, to: step)
            let target = floorPoint(step)
            let stepAction = SKAction.run { [weak self, weak node] in
                guard let self, let node else {
                    return
                }
                if let direction {
                    node.apply(facing: direction)
                }
                node.tile = step
                node.zPosition = self.depth(of: step)
                // 한 칸에 한 걸음 — 다리가 엇갈린 프레임으로 갈아끼운다. 방향 전환보다 뒤에
                // 와야 한다(apply(facing:) 이 포즈를 다시 고르므로).
                node.stepWalkFrame()
                // 그림 교체 위에 얹는 보조 신호. 올라갈 때 빠르고 내려올 때 느리게(0.42/0.58)
                // 해서 발을 떼는 쪽에 힘이 실린다. 진폭이 작아 "튄다" 가 아니라 걸음의 무게로만
                // 읽힌다 — 크게 주면 다시 뛰는 것처럼 보인다.
                let stride = SKAction.sequence([
                    .moveBy(x: 0, y: bobHeight, duration: stepDuration * 0.42),
                    .moveBy(x: 0, y: -bobHeight, duration: stepDuration * 0.58),
                ])
                node.sprite.run(stride)
            }
            let move = SKAction.move(to: target, duration: stepDuration)
            move.timingMode = .linear
            actions.append(stepAction)
            actions.append(move)
            cursor = step
        }
        actions.append(.run { [weak self, weak node] in
            // 걸음 자체는 회전·눌림을 쓰지 않지만, 실패 몸짓(startSlump 의 scaleY 0.86)이
            // 걸린 채 걷기 시작했을 수 있다. 도착 자세를 기본값으로 되돌린다 —
            // 이어지는 reapplyMotion 이 필요하면 다시 건다.
            node?.sprite.run(.rotate(toAngle: 0, duration: 0.1))
            node?.sprite.yScale = 1
            // 걸음 프레임(한쪽 발이 들린 그림)도 함께 되돌린다 — 안 하면 도착한 사람이
            // 계속 짝다리로 서 있다. completion 보다 먼저 와야 앉기가 최종 자세를 이긴다.
            node?.endWalk()
            completion?()
            // 걷는 동안 들어온 상태 변화는 보류됐다(applyMotion 이 걷는 사람을 건드리지 않는다).
            // 도착했으니 최신 상태를 다시 적용한다 — 안 하면 승인 줄에 도착해도 다음 동기화까지
            // 발 구르기가 안 걸리고, 복귀 중 실패한 작업이 완료 콜백의 타이핑에 덮인다.
            if let agentType = node?.name {
                self?.reapplyMotion(agentType)
            }
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
    ///
    /// 배회 중이던 사람이 완료로 바뀔 수 있다(이벤트 없이 스냅샷만 갱신되는 경로). 그때 앞선
    /// 배회의 머무름 콜백이 살아 있으면, 탕비실에 도착한 뒤 그 콜백이 깨어나 자리로 끌고 간다.
    /// 먼저 끊고 시작한다 — 완료 축하가 배회를 이긴다.
    private func visitLounge(_ agentType: String) {
        guard let node = characters[agentType], !queueOrder.contains(agentType) else {
            return
        }
        cancelStroll(agentType)
        let occupied = Set(characters.values.map(\.tile))
        guard let spot = plan.loungeTiles.first(where: { !occupied.contains($0) }) else {
            return
        }
        strollingAgents.insert(agentType)
        stopWorking(node)
        walk(node, to: spot) { [weak self, weak node] in
            node?.apply(facing: .down)
            node?.run(.sequence([
                .wait(forDuration: 3.5),
                .run { [weak self] in self?.endStroll(agentType) },
            ]), withKey: "stroll")
        }
    }

    // MARK: - 연출 실행

    func perform(_ intents: [VisualIntent]) {
        for intent in intents {
            for agentType in affectedAgentTypes(of: intent) {
                cancelStroll(agentType)
            }
        }
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
            case let .meeting(agentTypes, thenWorking):
                holdMeeting(agentTypes, thenWorking: thenWorking)
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

    // MARK: - 내 작업 세션

    /// 내가 돌리는 CLI 세션을 대표 앞줄에 세운다.
    ///
    /// 에이전트와 **다르게 보여야 한다.** 사규가 배정한 일이 아니라 내가 직접 띄운 작업이라,
    /// 같은 사람 그림을 쓰되 청록으로 물들이고 부서 방이 아닌 대표 앞에 둔다. 대시보드 탭
    /// 아래쪽 목록에만 있던 정보를 사무실에서도 한눈에 보게 하는 것이 목적이다.
    func syncSessions(_ sessions: [ConsoleSession]) {
        lastSyncedSessions = sessions
        let tiles = officeSessionTiles(plan: plan)
        let visible = officeVisibleSessions(sessions, limit: tiles.count)
        let incoming = Set(visible.map(\.sessionId))
        for (sessionId, node) in sessionNodes where !incoming.contains(sessionId) {
            node.removeFromParent()
            sessionNodes[sessionId] = nil
        }
        for (index, session) in visible.enumerated() {
            let node = sessionNodes[session.sessionId] ?? makeSessionNode(for: session)
            if sessionNodes[session.sessionId] == nil {
                sessionNodes[session.sessionId] = node
                objectLayer.addChild(node)
            }
            layoutSessionNode(node, session: session, tile: tiles[index])
        }
        updateCompanySummary(lastSyncedAgents)
    }

    /// 세션 캐릭터 한 명. 외형은 세션 id 로 정해 실행마다 같은 세션이 같은 모습을 갖는다.
    ///
    /// 예전에는 전원이 `char-down` 한 장에 같은 청록 tint 였다. 화면에 여덟이 늘어서면
    /// **한 사람을 복제해 붙여 놓은 것처럼** 보였고, 구분은 이름표에만 걸려 있었는데 그
    /// 이름표마저 서로 겹쳤다. 에이전트가 쓰는 외형 결정(`characterLook`)을 그대로 태워
    /// 시트·머리·바지를 흩고, 셔츠만 청록 계열에 묶어 "내가 돌리는 작업" 표식을 남긴다.
    private func makeSessionNode(for session: ConsoleSession) -> SKNode {
        let holder = SKNode()
        let look = characterLook(for: session.sessionId)
        let texture =
            SpriteLoader.characterTexture(
                pose: "down",
                sheet: look.sheetIndex,
                hair: hairPalette[look.hairIndex],
                shirt: officeSessionShirtRGB(shift: look.shirtShift),
                pants: pantsPalette[look.pantsIndex]
            ) ?? SpriteLoader.texture("char-down")
        let sprite = SKSpriteNode(texture: texture)
        sprite.name = "sessionSprite"
        sprite.anchorPoint = CGPoint(x: 0.5, y: 0)
        sprite.zPosition = 1
        holder.addChild(sprite)
        return holder
    }

    private func layoutSessionNode(_ node: SKNode, session: ConsoleSession, tile: TilePoint) {
        node.position = floorPoint(tile)
        node.zPosition = depth(of: tile)
        guard let sprite = node.childNode(withName: "sessionSprite") as? SKSpriteNode,
              let texture = sprite.texture
        else {
            return
        }
        let base = texture.size()
        sprite.size = CGSize(
            width: base.width * characterScale, height: base.height * characterScale
        )
        let isActive = session.state == officeSessionActiveState
        // 쉬는 세션은 옅게. 화면에 여덟 개가 늘어서도 지금 돌고 있는 것이 먼저 읽힌다.
        sprite.alpha = isActive ? 1.0 : 0.45
        setChildLabel(
            node, name: "sessionName", text: officeSessionShortName(session.name),
            position: CGPoint(x: 0, y: sprite.size.height + tileSize * 0.10),
            fontSize: tileSize * 0.24,
            color: SKColor(white: isActive ? 0.95 : 0.66, alpha: 1)
        )
        sprite.removeAction(forKey: "sessionTyping")
        guard isActive else {
            sprite.position = .zero
            return
        }
        // 돌고 있는 세션은 사람이 자리에서 두드리는 것과 같은 몸짓을 쓴다.
        let beat = SKAction.sequence([
            .moveBy(x: 0, y: 1.4, duration: 0.09),
            .moveBy(x: 0, y: -1.4, duration: 0.09),
            .wait(forDuration: 0.06),
        ])
        sprite.run(.repeatForever(beat), withKey: "sessionTyping")
    }

    /// 회의 — 체인에 얽힌 사람들이 회의실 테이블에 모였다가 각자 자리로 흩어진다.
    ///
    /// 배회와 같은 추적 집합(`strollingAgents`)에 넣는다. 그래야 회의 도중 실제 이벤트가 오면
    /// 기존 취소 경로가 그대로 회의를 끊는다 — 관제 신호가 연출을 이긴다는 규칙은 여기서도 같다.
    ///
    /// 회의를 열지 못하는 경우(자리가 없거나 참석자를 아무도 못 찾음)에도 **일은 시작해야 한다.**
    /// 연출이 실패했다고 "일이 돌기 시작했다" 는 신호까지 사라지면, 화면이 조용히 거짓말을 한다.
    private func holdMeeting(_ agentTypes: [String], thenWorking: String) {
        let seats = officeMeetingSeats(plan: plan)
        let tableTile = plan.furniture.first { $0.kind == .meetingTable }?.tile
        var assigned = 0
        for agentType in agentTypes {
            guard assigned < seats.count,
                  let node = characters[agentType],
                  !queueOrder.contains(agentType)
            else {
                continue
            }
            let seat = seats[assigned]
            assigned += 1
            cancelStroll(agentType)
            strollingAgents.insert(agentType)
            stopWorking(node)
            walk(node, to: seat) { [weak self, weak node] in
                if let tableTile, let direction = facing(from: seat, to: tableTile) {
                    node?.apply(facing: direction)
                }
                node?.run(.sequence([
                    .wait(forDuration: officeMeetingDwellSeconds),
                    .run { [weak self] in
                        self?.endMeeting(agentType, thenWorking: thenWorking)
                    },
                ]), withKey: "stroll")
            }
        }
        guard assigned > 0 else {
            startWorking(thenWorking)
            return
        }
    }

    /// 회의가 끝나면 각자 자리로. 이 일을 이어받은 사람은 자리에 앉아 곧바로 일을 시작한다.
    private func endMeeting(_ agentType: String, thenWorking: String) {
        guard strollingAgents.contains(agentType) else {
            return
        }
        guard agentType == thenWorking else {
            endStroll(agentType)
            return
        }
        strollingAgents.remove(agentType)
        startWorking(agentType)
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
        label.fontName = officeLabelFontName
        label.fontSize = max(officeNameplateMinFontSize, tileSize * 0.28)
        label.fontColor = SKColor(white: 1, alpha: 1)
        label.verticalAlignmentMode = .bottom
        label.position = CGPoint(x: 0, y: node.sprite.size.height + nameplateClearance)
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
                position: CGPoint(x: 0, y: top + nameplateClearance),
                fontSize: tileSize * 0.24, color: SKColor(white: 1, alpha: 0.95)
            )
            setChildLabel(
                node, name: "elapsed", text: info.elapsed,
                position: CGPoint(x: 0, y: -tileSize * 0.42),
                fontSize: tileSize * 0.21, color: SKColor(white: 0.7, alpha: 1)
            )
            // 진행 표시는 머리 위 이모지(⏳🔄✅⚠️) 대신 몸짓으로 낸다 — 사람이 일하는 화면에서
            // 아이콘이 떠 있는 것보다 타이핑·엎드림이 무슨 일인지 더 빨리 읽힌다.
            applyMotion(for: agent, phase: info.badge)
        }
    }

    // MARK: - 상태 → 몸짓

    /// 마지막으로 받은 스냅샷과 phase 로 몸짓을 다시 건다. 걸음이 끝난 직후에 쓴다.
    private func reapplyMotion(_ agentType: String) {
        guard let agent = lastSyncedAgents.first(where: { $0.agentType == agentType }) else {
            return
        }
        applyMotion(for: agent, phase: lastPhases[agentType])
    }

    /// 상태와 pending 진행 단계를 몸짓으로 옮긴다.
    /// 내가 방금 보낸 지시(phase)가 있으면 그쪽이 우선한다 — 지금 눈으로 좇는 대상이라서.
    ///
    /// 걷는 중인 사람은 건너뛴다(걸음 자체가 지금의 동작이다). 대신 도착 시점에 walk 가
    /// `reapplyMotion` 으로 최신 상태를 다시 걸어, 걷는 동안의 변화가 유실되지 않게 한다.
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
        label.fontName = officeLabelFontName
        label.fontSize = max(10, tileSize * 0.4)
        label.fontColor = SKColor(white: 0.95, alpha: 0.9)
        label.verticalAlignmentMode = .bottom
        label.horizontalAlignmentMode = .center
        label.position = CGPoint(x: 0, y: node.sprite.size.height + nameplateClearance)
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

    /// 시간대에 따라 창유리 색과 빛 세기만 갈아 끼운다(노드는 그대로 둔다).
    ///
    /// 시각이 바뀌었다고 바닥을 통째로 다시 깔 이유가 없다 — 31×18 칸을 새로 만드는 비용이
    /// 창 네 칸 텍스처 교체보다 훨씬 크고, 사람이 걷는 중에 씬을 갈면 걸음이 끊긴다.
    private func updateDaylight() {
        let hour = currentHour()
        let light = officeWindowLight(hour: hour)
        let daylight = officeDaylight(hour: hour)
        if let texture = OfficeLightTexture.window(light, daylight: daylight) {
            windowNodes.forEach { $0.texture = texture }
        }
        if let texture = OfficeLightTexture.wallLamp(lit: light.lampLit) {
            wallLampNodes.forEach { $0.texture = texture }
        }
        for layer in lightLayers {
            layer.apply(light)
        }
    }

    /// 벽에 붙는 것들(창문·벽등)과 거기서 나오는 빛을 그린다.
    ///
    /// 바닥과 함께 다시 그린다 — 창 위치는 평면도가 정하고, 평면도는 인원이 바뀌면 새로
    /// 계산되기 때문이다. 노드 참조를 들고 있는 이유는 시각만 바뀌었을 때(`updateDaylight`)
    /// 색만 갈아 끼우기 위해서다.
    private func renderWallFixtures() {
        windowNodes.removeAll()
        wallLampNodes.removeAll()
        lightLayers.removeAll()

        let hour = currentHour()
        let light = officeWindowLight(hour: hour)
        let daylight = officeDaylight(hour: hour)

        if let texture = OfficeLightTexture.window(light, daylight: daylight) {
            for tile in plan.windowTiles {
                // 창은 벽 두 줄에 걸친다 — 아래 칸 바닥을 기준으로 위로 두 칸을 채운다.
                windowNodes.append(
                    addWallFixture(texture: texture, at: tile, tileHeight: officeOuterWallRows)
                )
            }
        }
        if let texture = OfficeLightTexture.wallLamp(lit: light.lampLit) {
            for tile in plan.wallLampTiles {
                wallLampNodes.append(addWallFixture(texture: texture, at: tile))
            }
        }
        addWindowShaft(light)
        addLampHalos(light)
        for layer in lightLayers {
            layer.apply(light)
        }
    }

    /// 벽 타일 위에 얹는 설치물(창문·벽등 공통). 세로로 여러 칸을 쓰면 위로 자란다.
    private func addWallFixture(
        texture: SKTexture,
        at tile: TilePoint,
        tileHeight: Int = 1
    ) -> SKSpriteNode {
        let node = SKSpriteNode(texture: texture)
        node.size = CGSize(width: tileSize, height: tileSize * CGFloat(tileHeight))
        // 가구와 같은 발밑 기준 — 위로 자라야 벽 위 칸을 덮는다.
        node.anchorPoint = CGPoint(x: 0.5, y: 0)
        node.position = floorPoint(tile)
        // 바닥 레이어 안에서 벽 타일보다만 앞이면 된다. 가구·사람(objectLayer)보다는 뒤다 —
        // 벽에 붙은 물건이 방 안 물건을 가리면 앞뒤가 뒤집혀 보인다.
        node.zPosition = 1
        floorLayer.addChild(node)
        return node
    }

    /// 창에서 바닥으로 떨어지는 빛. 아래로 갈수록 넓어지고 옅어지는 세 단.
    ///
    /// 밝은 쪽에 더하는 합성(`.add`)이라 **어두운 곳은 어두운 채로 남는다** — 예전 색막이
    /// 어두운 배경까지 들어 올려 화면을 세피아로 만들었던 것과 정반대다.
    private func addWindowShaft(_ light: OfficeWindowLight) {
        guard let texture = OfficeLightTexture.windowShaft() else {
            return
        }
        for cluster in windowClusters() {
            guard let first = cluster.first, let last = cluster.last else {
                continue
            }
            let spanWidth = CGFloat(last.x - first.x + 1)
            let node = SKSpriteNode(texture: texture)
            // 창 폭보다 좌우로 한 칸씩 넓게, 아래로 세 칸 반 — 방 안쪽 두 줄까지만 닿고
            // 아래 가로 통로를 넘지 않는다(넘으면 옆 부서 방까지 밝아져 광원이 흐려진다).
            node.size = CGSize(width: (spanWidth + 2) * tileSize, height: tileSize * 3.5)
            // 창 아래에 매다는 그림이라 위쪽 변을 기준점으로 잡는다.
            node.anchorPoint = CGPoint(x: 0.5, y: 1)
            node.position = CGPoint(
                x: gridOrigin.x + (CGFloat(first.x) + spanWidth / 2) * tileSize,
                y: gridOrigin.y + CGFloat(first.y) * tileSize
            )
            node.zPosition = 0.5
            node.blendMode = .add
            node.colorBlendFactor = 1
            floorLayer.addChild(node)
            lightLayers.append(OfficeLightLayer(node: node, fade: 1, source: .window))
        }
    }

    /// 가로로 이어 붙은 창을 한 무리로 묶는다.
    ///
    /// 빛기둥은 **창 무리마다 하나씩** 떨어져야 한다. 전체 창의 최소·최대 x 로 하나만 만들면
    /// 회의실 창부터 탕비실 창까지 걸친 거대한 기둥이 되어, 창이 없는 벽 앞까지 밝아진다.
    private func windowClusters() -> [[TilePoint]] {
        var clusters: [[TilePoint]] = []
        for tile in plan.windowTiles.sorted(by: { ($0.y, $0.x) < ($1.y, $1.x) }) {
            if let previous = clusters.last?.last, previous.y == tile.y, previous.x + 1 == tile.x {
                clusters[clusters.count - 1].append(tile)
            } else {
                clusters.append([tile])
            }
        }
        return clusters
    }

    /// 벽등 아래로 퍼지는 빛무리. 꺼진 시간대에는 세기 0 이라 보이지 않는다.
    private func addLampHalos(_ light: OfficeWindowLight) {
        guard let texture = OfficeLightTexture.glowHalo() else {
            return
        }
        for tile in plan.wallLampTiles {
            let node = SKSpriteNode(texture: texture)
            node.size = CGSize(width: tileSize * 2.6, height: tileSize * 2.6)
            let anchor = centerPoint(tile)
            // 빛 중심을 등보다 아래로 내린다 — 등 높이에 두면 빛이 벽 위쪽 절반을 데우고
            // 정작 사람이 서 있는 바닥은 어둡게 남는다.
            node.position = CGPoint(x: anchor.x, y: anchor.y - tileSize * 0.7)
            node.zPosition = 0.5
            node.blendMode = .add
            node.colorBlendFactor = 1
            floorLayer.addChild(node)
            lightLayers.append(OfficeLightLayer(node: node, fade: 1, source: .lamp))
        }
    }

    /// 창 빛의 단 — (아래로 몇 칸, 좌우로 얼마나 벌어지나, 세기 감쇠).
    /// 세 단이면 사다리꼴로 읽히고, 더 늘리면 밴드 안쪽 두 줄을 넘어 통로까지 밝아진다.
    private static let windowShaftSteps: [(drop: Int, spread: CGFloat, fade: CGFloat)] = [
        (1, 0.25, 1.0),
        (2, 0.75, 0.55),
        (3, 1.35, 0.25),
    ]

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
        // 말풍선·경과 표시도 한글이므로 이름표와 같은 폰트·하한을 쓴다.
        label.fontName = officeLabelFontName
        label.fontSize = max(officeNameplateMinFontSize, fontSize)
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
        var text =
            "진행 \(summary.inProgress)  ·  승인 \(summary.awaitingApproval)  ·  대기 \(summary.waiting)"
        if !lastSyncedSessions.isEmpty {
            // 대표 앞줄에 설 수 있는 세션은 여덟 남짓이라, 그 수가 곧 전체라고 오해하지 않게
            // 총계를 여기 적는다.
            let active = lastSyncedSessions.filter { $0.state == officeSessionActiveState }.count
            text += "  ·  내 세션 \(lastSyncedSessions.count)(도는 중 \(active))"
        }
        let label = SKLabelNode(text: text)
        label.name = "summaryHUD"
        // 창이 작아지면 타일이 작아지는데 이 글자만 고정 크기로 남아, 사무실 대비 혼자 커 보였다.
        // 씬의 다른 글자와 같은 방식(타일 비례 + 한글 하한)으로 맞춘다.
        label.fontName = officeLabelFontName
        label.fontSize = max(officeHudMinFontSize, tileSize * 0.30)
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
        if let previous = selectedAgentType, let node = characters[previous] {
            node.setSelected(false)
        }
        selectedAgentType = agentType
        // 테두리를 그리는 일은 캐릭터가 한다. 씬이 만들어 붙이면 앉기·서기·창 크기 변경 때
        // 다시 잡아줄 경로가 없어 테두리만 몸에서 떨어진다.
        if let agentType {
            characters[agentType]?.setSelected(true)
        }
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
            node.setHovered(false)
        }
        hoveredAgentType = hit
        guard let hit, let node = characters[hit] else {
            return
        }
        node.setHovered(true)
        node.sprite.run(.scale(to: 1.12, duration: 0.1))
        if node.childNode(withName: "infoBubble") == nil, let text = agentBubbles[hit] {
            setChildLabel(
                node, name: "hoverBubble", text: text,
                position: CGPoint(x: 0, y: node.sprite.size.height + nameplateClearance),
                fontSize: tileSize * 0.24, color: SKColor(white: 1, alpha: 0.95)
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
