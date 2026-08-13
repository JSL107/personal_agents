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

    /// 실제로 만든 도면이 생기기 전에는 nil. 첫 선택은 순수 최대값이어야 하고, 그 뒤에만
    /// 현재 배치를 기준으로 5% 히스테리시스를 적용한다.
    private var zoneColumns: Int?
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
    /// 문 칸 → 문 스프라이트. 사람이 앞에 오면 열린 그림으로 갈아끼운다(`refreshDoors`).
    private var doorNodes: [TilePoint: SKSpriteNode] = [:]
    private var homeSeats: [String: TilePoint] = [:]
    /// 직전 pending phase — 완료 순간에만 한 번 튀어오르게 하려면 전이를 알아야 한다.
    private var lastPhases: [String: PendingPhase] = [:]
    /// 대표실 앞에 줄 선 순서. 승인 대기 인원이 늘면 줄이 길어진다.
    private var queueOrder: [String] = []
    private var lastStates: [String: ConsoleAgentState] = [:]
    private var lastSyncedAgents: [ConsoleAgent] = []
    private var lastSyncedApprovals: [ConsoleApproval] = []
    private var agentBubbles: [String: String] = [:]
    /// agentType → 사규의 직무 한 줄. 호버 쪽지의 첫 줄이 된다.
    private var agentJobs: [String: String] = [:]
    /// agentType → 마지막으로 계산한 상시 말풍선 문구. 호버가 그 자리를 빌려 쓰는 동안 보관해,
    /// 마우스가 떠날 때 다음 갱신을 기다리지 않고 즉시 되돌린다.
    private var lastInfoBubbles: [String: String?] = [:]
    private var hoveredAgentType: String?
    private var selectedAgentType: String?
    private var president: SKSpriteNode?
    /// 내가 직접 돌리는 CLI 세션. 에이전트와 달리 사규가 배정한 자리가 없어 대표 앞줄에 선다.
    /// 세션 하나당 책상 위 표시(켜진 화면 + 이름) 한 묶음.
    private var sessionMarkers: [String: SKNode] = [:]
    /// 마지막으로 세션을 시간축으로 훑은 시각(`update`).
    private var lastSessionSweepAt: TimeInterval = 0
    /// 세션이 쓰는 책상. 한 번 잡으면 지킨다 — 매번 다시 나눠 주면 하나가 끝날 때마다
    /// 남은 표시가 전부 옆 책상으로 옮겨 가, 아무 일도 없었는데 화면이 통째로 움직인다.
    private var sessionSeats: [String: TilePoint] = [:]
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

    /// 대표(나) 클릭 — 담당자를 지정하지 않는 지시 입구다. 부를 사람을 내가 찍는 대신,
    /// 대표에게 말하면 라우터가 알맞은 워커를 고른다.
    var onPresidentClick: (() -> Void)?

    /// 시각을 고정한다(화면 회귀 렌더 전용, 평소엔 nil).
    /// 밤 화면을 확인하려고 밤까지 기다릴 수는 없어서 둔 주입점이다.
    var hourOverride: Int?
    /// 걸음·등장 연출을 건너뛰고 최종 상태로 그린다(오프스크린 렌더 전용).
    /// 정지 화면에서는 걷는 도중이 찍혀, 도착해 있어야 할 사람들이 문 앞에 뭉쳐 보인다.
    var skipsChoreography = false

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
        let nextZoneColumns = officeZoneColumns(
            width: Double(size.width), height: Double(size.height),
            currentZoneColumns: zoneColumns
        )
        sync(
            agents: lastSyncedAgents, approvals: lastSyncedApprovals,
            rebuildPlan: nextZoneColumns != zoneColumns
        )
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
            // 새 격자에 옛 가구 방향 오프셋을 이어 붙이면 몸만 자리 밖에 남는다.
            node.endInteraction()
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
        // 세션 표시도 같은 처리를 받아야 한다. 여기서 빠뜨렸더니 창 크기가 바뀐 뒤 세션만
        // 옛 좌표에 남아 **부서 방 한가운데 떠 있었다** — 위 주석이 경고한 바로 그 현상인데,
        // 화면에 놓이는 것이 `characters` 와 세션 표시 둘로 나뉜 탓에 한쪽만 고쳐졌다.
        syncSessions(lastSyncedSessions)
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

    func sync(
        agents: [ConsoleAgent], approvals: [ConsoleApproval], rebuildPlan: Bool = true
    ) {
        lastSyncedAgents = agents
        lastSyncedApprovals = approvals
        let nextZoneColumns = officeZoneColumns(
            width: Double(size.width), height: Double(size.height),
            currentZoneColumns: zoneColumns
        )
        let layoutChanged = nextZoneColumns != zoneColumns
        zoneColumns = nextZoneColumns
        if rebuildPlan || layoutChanged {
            plan = officeFloorPlan(agents: agents, zoneColumns: nextZoneColumns)
        }
        recalculateMetrics()
        renderFloor()
        renderZoneLabels()
        renderFurniture()
        // 책상이 새로 만들어진 뒤여야 한다 — 서류·소품은 책상 노드의 자식으로 붙는다.
        renderDeskPapers(agents: agents)
        renderDeskProps()
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
            // 이름표가 쓸 수 있는 폭은 자리마다 다르다(옆자리와의 간격·벽까지의 거리).
            // 창 크기가 바뀌면 이 경로를 다시 지나므로 갱신도 여기 한 곳에 둔다.
            node.setNameplateSpan(nameplateSpan(for: seat))
            // 부서는 스냅샷마다 확인한다. 노드는 재사용되므로 여기서 갱신하지 않으면 사규가
            // 사람을 옮겼을 때 방만 바뀌고 옷은 옛 부서색으로 남는다.
            node.apply(department: agent.resolvedDepartment)
            node.apply(state: agent.state)

            // 줄 서 있거나 걷는 중인 사람은 건드리지 않고, 나머지는 자기 자리에 둔다.
            if !queueOrder.contains(agent.agentType),
               !node.isWalking,
               !strollingAgents.contains(agent.agentType) {
                node.endInteraction()
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
        // 사람 배치가 끝난 뒤라야 한다 — 문 여닫이는 지금 누가 어디 서 있는지로만 정해진다.
        refreshDoors()
    }

    /// 회귀 렌더가 자세를 실제로 그리지 않으면 누락도 정상 화면처럼 저장되므로 전부 강제 배치한다.
    ///
    /// 자세 종류가 아니라 **가구 종류마다** 한 명씩 세운다. 같은 자세라도 가구가 어디에 어떻게
    /// 놓였느냐에 따라 몸이 가구에 닿는지가 달라지는데(소파 1칸 vs 회의 테이블 2칸), 자세별로
    /// 한 명만 세우면 그 자세를 대표하는 가구 하나만 확인되고 나머지는 끝까지 안 보인다.
    ///
    /// 배치가 하나도 없는 가구 종류는 건너뛴다 — 평면도가 그 가구를 안 쓸 수도 있고, 그것 때문에
    /// 데모 전체가 실패하면 확인 수단을 잃는다. 대신 **한 종류도 못 세우면** 실패로 돌려준다.
    func applyPoseDemo() -> Bool {
        let spots = officeStrollSpots(plan: plan)
        var placedCount = 0
        for kind in FurnitureKind.allCases {
            // 사람을 **이름으로** 찾는다. 순서로 꺼내면 이름표와 실제 자세가 어긋난다 —
            // 가구 순서(enum)와 사람 이름 순서(정렬)가 무관해서, `sofa2` 이름표를 단 사람이
            // 게시판 앞에서 책을 들고 서 있는 화면이 나왔다. 확인용 화면이 확인을 방해했다.
            guard let pose = kind.interactionPose,
                let spot = spots.first(where: { $0.kind == kind }),
                let node = characters[poseDemoAgentType(for: kind)]
            else {
                continue
            }
            node.removeAllActions()
            node.sprite.removeAllActions()
            node.endInteraction()
            // 데모 자리는 책상 몫이 아니므로 앉아도 원래 좌석의 이름표 폭을 강제하지 않는다.
            node.setNameplateSpan(nil)
            place(node, at: spot.tile)
            node.apply(facing: spot.facing)
            node.beginInteraction(pose: pose, facing: spot.facing)
            placedCount += 1
            // 어느 칸에 누구를 무슨 자세로 세웠는지 남긴다. 굽힌 그림만 보면 사람과 가구가
            // 겹치는 자리에서 "이 사람이 그 가구를 보고 있는지" 를 눈으로 확정할 수 없다
            // (실제로 소파 담당이 옆 의자에 앉은 것처럼 보여 배치를 의심하게 됐다).
            FileHandle.standardError.write(
                Data(
                    """
                    pose-demo \(kind.rawValue) pose=\(pose.rawValue) \
                    tile=(\(spot.tile.x),\(spot.tile.y)) facing=\(spot.facing) \
                    prop=\(pose.handPropSprite ?? "-")\n
                    """.utf8
                )
            )
        }
        return placedCount > 0
    }

    /// 사람이 문 앞에 왔으면 열린 그림으로, 지나갔으면 닫힌 그림으로 갈아끼운다.
    ///
    /// 문마다 "누가 근처인지" 를 따로 들고 있지 않고 **매번 다시 센다.** 걸음을 중간에 끊고
    /// 자리로 순간이동시키는 경로(`sync`·`cancelStroll`)가 여럿이라, 상태를 들고 있으면
    /// 그중 하나가 정리를 빠뜨렸을 때 문 한 짝이 영영 열린 채로 남는다. 문 열둘 × 사람 서른이라
    /// 매번 세도 한 번이 수백 번 비교로 끝난다.
    private func refreshDoors() {
        guard !doorNodes.isEmpty else {
            return
        }
        let occupied = Set(characters.values.map(\.tile))
        for (tile, node) in doorNodes {
            let kind: FurnitureKind =
                officeDoorIsOpen(door: tile, occupied: occupied) ? .doorOpen : .doorClosed
            guard let texture = SpriteLoader.furnitureTexture(kind), node.texture !== texture else {
                continue
            }
            node.texture = texture
        }
    }

    /// 스냅샷을 정본으로 승인 줄을 맞춘다.
    ///
    /// 재연결 경로에는 `approval.resolved` 가 오지 않아, 승인이 끝난 사람이 대표실 앞에 영영
    /// 남는다(`sync` 는 줄 선 사람을 일부러 건드리지 않는다). 그 사람은 자리로 돌아가지도
    /// 배회하지도 못한다 — 유휴 감독관이 줄 선 사람을 후보에서 빼기 때문이다.
    ///
    /// `sync` 와 분리해 둔 이유는 비용이다. 승인 알림은 수 분 간격으로 오가는데, 그때마다
    /// 씬 전체(바닥 500여 타일·가구·29명)를 다시 만들 이유가 없다.
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

    /// 그 자리의 이름표가 좌우로 쓸 수 있는 여유(칸). 같은 방 같은 행 이웃과 방 벽이 정한다.
    /// 방에 속하지 않은 자리는 제한을 두지 않는다.
    private func nameplateSpan(for seat: TilePoint) -> (left: Double, right: Double)? {
        guard let zone = plan.zones.first(where: { officeZoneContains($0, seat) }) else {
            return nil
        }
        return officeNameplateSpanTiles(
            seat: seat,
            seatsInZone: plan.desks.map(\.seat).filter { officeZoneContains(zone, $0) },
            zone: zone,
            tileSize: Double(tileSize)
        )
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
    ///
    /// **순간이동도 문 여닫이의 입력이다.** 걸음은 한 칸마다 문을 다시 보지만(`walk`), 자리로
    /// 되돌리는 경로들은 사람을 한 번에 옮긴다. 그래서 문 앞에 있던 사람이 사라진 것을 문이
    /// 모른 채 열린 상태로 굳는다 — 창 크기를 바꾸면 `sync` 가 문을 갱신한 **뒤** 에
    /// `repositionEveryone` 이 걷던 사람을 좌석으로 끌고 가므로 정확히 그 일이 벌어진다.
    ///
    /// 호출처마다 뒤에 한 줄씩 붙이지 않고 여기에 둔 이유는 그 지점이 넷이고(줄 서기·좌석
    /// 복귀·신규 배치·리사이즈) 앞으로 늘기 때문이다. 문 열둘 × 사람 서른이라 매번 다시 세도
    /// 한 번이 수백 번 비교로 끝난다.
    private func place(_ node: CharacterNode, at tile: TilePoint) {
        node.tile = tile
        node.place(at: floorPoint(tile), depth: depth(of: tile))
        refreshDoors()
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
        // 위아래 어느 쪽으로도 벽이 이어지지 않는 한 칸짜리 가로 벽 — 아래 구역 천장이다.
        // 여기는 벽면과 윗면이 **한 칸에 겹쳐** 있어서 어느 한쪽으로 칠하면 둘 다 틀린다:
        // 벽면(가장 어둡게)으로 두면 바닥과 구별되지 않아 방 사이가 벽이 아니라 어두운 띠로
        // 눕고, 윗면(가장 밝게)으로 올리면 밝은 띠가 가로로 길게 눕는다. 그 사이 값을 준다.
        let isFlatWall = openAbove && !wallBelow
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
        if isTopOfWall {
            node.colorBlendFactor = 0.60
        } else if isFlatWall {
            node.colorBlendFactor = 0.72
        } else {
            node.colorBlendFactor = 0.84
        }
        node.xScale = 1
        node.yScale = 1
        addWallEdges(node, column: column, row: row)
    }

    /// 벽 칸에서 **벽이 아닌 이웃과 맞닿는 변**에 어두운 선을 긋는다.
    ///
    /// 밝기만으로는 벽이 갈리지 않는다. 렌더 픽셀을 재 보면 벽(밝기 117~127)이 방 바닥
    /// (72~92)과 복도(141~155)의 정확히 중간값이라, 벽이 바닥의 일부로도 복도의 연장으로도
    /// 읽힌다 — "어디가 벽이고 어디가 길인지 모르겠다" 는 인상이 여기서 온다. 밝기를 한쪽으로
    /// 밀어도 그쪽과 붙을 뿐이다(어둡게 하면 바닥, 밝게 하면 복도).
    ///
    /// 도트 그림에서 면을 가르는 수단은 명도차가 아니라 **외곽선**이다. 벽끼리 맞닿는 변은
    /// 비워 두어 벽 한 덩어리가 격자로 쪼개져 보이지 않게 하고, 바닥·복도와 만나는 변에만 긋는다.
    ///
    /// 아래 변은 더 두껍게 긋는다 — 위에서 내려보는 시점에서 벽 아래는 벽이 바닥에 드리우는
    /// 그늘이 놓이는 자리이고, 그 한 줄이 평평한 사각형을 "서 있는 것" 으로 읽히게 한다.
    private func addWallEdges(_ node: SKSpriteNode, column: Int, row: Int) {
        node.children.filter { $0.name == "wallEdge" }.forEach { $0.removeFromParent() }
        let thickness = max(1, tileSize * 0.06)
        let half = tileSize / 2
        // dy = +1 이 위쪽이다(격자 원점이 아래).
        let edges: [(dx: Int, dy: Int)] = [(0, 1), (0, -1), (-1, 0), (1, 0)]
        for edge in edges {
            let neighborX = column + edge.dx
            let neighborY = row + edge.dy
            let inBounds =
                neighborX >= 0 && neighborX < plan.columns
                && neighborY >= 0 && neighborY < plan.rows
            // 격자 밖은 화면 끝이라 선을 그어도 잘린다 — 벽으로 취급해 건너뛴다.
            guard !inBounds || plan.floor[neighborY][neighborX] != .wall else {
                continue
            }
            guard inBounds else {
                continue
            }
            let isBottom = edge.dy == -1
            let lineThickness = isBottom ? thickness * 1.8 : thickness
            let size =
                edge.dx == 0
                ? CGSize(width: tileSize, height: lineThickness)
                : CGSize(width: lineThickness, height: tileSize)
            let line = SKSpriteNode(
                color: SKColor(red: 0.05, green: 0.04, blue: 0.05, alpha: isBottom ? 0.72 : 0.9),
                size: size
            )
            line.name = "wallEdge"
            line.position = CGPoint(
                x: CGFloat(edge.dx) * (half - lineThickness / 2),
                y: CGFloat(edge.dy) * (half - lineThickness / 2)
            )
            line.zPosition = 0.1
            node.addChild(line)
        }
    }

    /// 부서 이름을 구역 왼쪽 위에 얹는다. 바닥 재질만으로는 어느 팀 구역인지 알 수 없다.
    private func renderZoneLabels() {
        overlayLayer.children
            .filter { $0.name?.hasPrefix("zone:") == true }
            .forEach { $0.removeFromParent() }
        var occupiedLabelRanges: [ClosedRange<Double>] = []
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
            let occupiedLeading = Double(holder.position.x + plate.frame.minX)
            let occupiedTrailing = Double(holder.position.x + plate.frame.maxX)
            occupiedLabelRanges.append(occupiedLeading...occupiedTrailing)
        }
        renderCommonAreaLabels(occupiedRanges: occupiedLabelRanges)
    }

    /// 상단 밴드(회의실·대표실·탕비실)에 이름을 단다.
    ///
    /// 화면 위쪽 1/4 을 차지하는데 이름이 없어 "가구만 놓인 빈 띠" 로 보였다. 부서 문패와 달리
    /// 왼쪽 끝을 선호하되 실제 부서 문패 판의 x 구간과 겹치면 방 안의 가장 가까운 안전
    /// 위치로 옮긴다. 밴드와 부서가 같은 격자라는 가정 없이 실제 판 폭으로 푸는 이유와,
    /// 이름표용 크기·세로 자산을 쓰지 않는 이유는 `officeNonOverlappingLabelLeadingX`에 남겼다.
    ///
    /// 색은 부서색을 쓰지 않고 중성 회색이다. 사람이 상주하지 않는 방이라 부서 문패보다
    /// 뒤로 물러나야 관제 신호(사람·상태 링)가 먼저 읽힌다.
    private func renderCommonAreaLabels(occupiedRanges: [ClosedRange<Double>]) {
        overlayLayer.children
            .filter { $0.name?.hasPrefix("common:") == true }
            .forEach { $0.removeFromParent() }
        for area in plan.commonAreas {
            let holder = SKNode()
            holder.name = "common:\(area.label)"

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

            let preferredLeading = Double(
                gridOrigin.x + (CGFloat(area.originX) + 0.5) * tileSize
                    + plate.frame.minX
            )
            let availableTrailing = Double(
                gridOrigin.x + (CGFloat(area.originX + area.width) - 0.5) * tileSize
                    - plate.frame.minX
            )
            let leading = officeNonOverlappingLabelLeadingX(
                preferredLeadingX: preferredLeading,
                availableRange: preferredLeading...availableTrailing,
                labelWidth: Double(plate.frame.width),
                occupiedRanges: occupiedRanges
            )
            holder.position = CGPoint(
                x: CGFloat(leading) - plate.frame.minX,
                y: gridOrigin.y + (CGFloat(area.labelY) + 0.2) * tileSize
            )

            holder.addChild(plate)
            holder.addChild(label)
            overlayLayer.addChild(holder)
        }
    }

    private func renderFurniture() {
        // 깔개는 바닥 레이어에 붙으므로 두 레이어를 함께 훑는다. 한쪽만 지우면 창 크기가
        // 바뀔 때마다 깔개가 겹겹이 쌓인다(`renderFloor` 를 거치지 않는 호출 경로가 있다).
        for layer in [objectLayer, floorLayer] {
            layer.children
                .filter { $0.name?.hasPrefix("furn:") == true }
                .forEach { $0.removeFromParent() }
        }
        deskNodes.removeAll()
        doorNodes.removeAll()
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
            if placement.kind.isDoorway {
                doorNodes[placement.tile] = node
            }
            node.anchorPoint = CGPoint(x: 0.5, y: 0)
            let base = texture.size()
            // 큰 가구만 sizeBoost 로 키운다 — 캐릭터를 한 칸으로 줄인 만큼 책상·소파가
            // 상대적으로 작아 보이는 것을 되돌린다(배율의 근거는 FurnitureKind.sizeBoost).
            let scale = spriteScale * CGFloat(placement.kind.sizeBoost)
            node.size = CGSize(width: base.width * scale, height: base.height * scale)
            // 벽에 거는 물건은 벽면 중턱에 걸린다. 다른 가구와 같은 발밑 기준(anchor y = 0)을
            // 그대로 쓰면 타일 바닥선에 붙어 **벽 앞에 세워 둔 것**처럼 보인다 — 벽시계가
            // 탁상시계가 되고 화이트보드가 이젤이 된다. 창문이 벽 두 줄을 꽉 채워 걸리는 것과
            // 같은 눈높이로 올린다.
            var position = floorPoint(placement.tile)
            if placement.kind.isWallMounted {
                position.y += tileSize * 0.32
            }
            // 두 칸 이상을 차지하는 가구는 기준 칸 중앙이 아니라 **점유 범위 중앙**에 놓는다.
            // 발밑 기준(anchor x = 0.5)을 그대로 쓰면 2칸 폭 깔개가 좌우로 반 칸씩 삐져나가
            // 옆 칸 바닥까지 물든다.
            position.x += tileSize * CGFloat(placement.kind.footprint.width - 1) / 2
            node.position = position
            node.zPosition = depth(of: placement.tile)
            // 깔개는 바닥 레이어로 내린다. 앞뒤 순서를 y 로 정하는 구조에서는(아래쪽이 앞)
            // 깔개가 자기보다 위 칸의 소파·테이블을 덮어 버린다 — 깔개 위에 놓인 가구가
            // 깔개 밑으로 사라지는 그림이 된다.
            if placement.kind.isFloorDecor {
                floorLayer.addChild(node)
            } else {
                objectLayer.addChild(node)
            }
        }
    }

    /// 오늘 끝낸 일이 많은 사람의 책상에 서류를 높이 쌓는다.
    ///
    /// 승인 대기처럼 "손이 필요한" 신호가 아니라 하루의 흐름을 보여주는 배경 정보다. 그래서
    /// 상태 링·이름표보다 뒤로 물러나야 하고, 사람이나 라벨을 가리면 안 된다.
    ///
    /// **책상 노드의 자식으로 붙인다.** 창 크기가 바뀌면 `renderFurniture` 가 책상을 통째로
    /// 다시 만드는데, 씬에 직접 붙이면 그때마다 위치와 앞뒤 순서를 손으로 다시 맞춰야 한다.
    /// 자식이면 둘 다 저절로 따라온다(켜진 모니터 화면도 같은 이유로 자식이다).
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

    /// 책상마다 개인 소품 하나를 얹는다 — 노트북·머그·책더미·스탠드·펜꽂이·화분·서류 중 하나.
    ///
    /// 서류 더미(`renderDeskPapers`)와 같은 이유로 책상 노드의 자식으로 붙인다. 창 크기가
    /// 바뀌면 책상이 통째로 다시 만들어지므로, 씬에 직접 붙이면 위치를 손으로 다시 맞춰야 한다.
    ///
    /// 무엇을 놓을지는 코어가 agentType 으로 정한다(`officeDeskProp`) — 여기서 고르면
    /// 스냅샷마다 바뀌어 책상 위가 깜빡인다.
    private func renderDeskProps() {
        for (agentType, desk) in deskNodes {
            desk.childNode(withName: "prop")?.removeFromParent()
            guard let texture = SpriteLoader.texture(officeDeskProp(agentType: agentType)) else {
                continue  // 에셋이 없으면 빈 책상으로 둔다
            }
            let node = SKSpriteNode(texture: texture)
            node.name = "prop"
            node.anchorPoint = CGPoint(x: 0.5, y: 0)
            let base = texture.size()
            node.size = CGSize(width: base.width * spriteScale, height: base.height * spriteScale)
            node.position = CGPoint(
                x: tileSize * CGFloat(officeDeskPropOriginTiles.x),
                y: tileSize * CGFloat(officeDeskPropOriginTiles.y)
            )
            // 책상 상판보다 위에. 서류(0.01~)와 겹치지 않는 반대편이라 순서 다툼은 없다.
            node.zPosition = 0.01
            desk.addChild(node)
        }
    }

    /// "나(대표)" — 승인 줄의 기준점이면서, 담당자를 정하지 않은 지시의 입구다(클릭 가능).
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

        // 판 — 사무실에서 이 라벨만 맨 글자였다. 하필 놓이는 자리가 **밝은 창문 정면**이라
        // 흰 글자가 유리에 묻혀 반쯤 읽히지 않는다. 다른 라벨(부서 문패·공용실·이름표)은 전부
        // 어두운 판 위에 얹혀 있으므로 같은 방식을 따른다.
        let plate = SKShapeNode(rect: crown.frame.insetBy(dx: -5, dy: -3), cornerRadius: 3)
        plate.fillColor = SKColor(white: 0.07, alpha: 0.72)
        plate.strokeColor = SKColor(red: 0.95, green: 0.78, blue: 0.30, alpha: 0.55)
        plate.lineWidth = 1
        plate.zPosition = 0.9  // 글자(1) 바로 뒤
        node.addChild(plate)
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
            node?.apply(facing: spot.facing)
            node?.beginInteraction(pose: spot.pose, facing: spot.facing)
            node?.run(.sequence([
                .wait(forDuration: spot.dwellSeconds),
                .run { [weak self, weak node] in
                    node?.endInteraction()
                    self?.endStroll(agentType)
                },
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
        node.endInteraction()
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
                // 한 칸 옮길 때마다 문을 다시 본다 — 다가서면 열리고 지나가면 닫힌다.
                self.refreshDoors()
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
        node.endInteraction()
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
        guard let loungeTile = plan.loungeTiles.first(where: { !occupied.contains($0) }) else {
            return
        }
        // loungeTiles는 배치 호환 계약이라 유지하고, 자세 정보만 같은 타일의 카탈로그에서 얻는다.
        let interactionSpot = officeStrollSpots(plan: plan).first { $0.tile == loungeTile }
        strollingAgents.insert(agentType)
        stopWorking(node)
        walk(node, to: loungeTile) { [weak self, weak node] in
            if let interactionSpot {
                node?.apply(facing: interactionSpot.facing)
                node?.beginInteraction(
                    pose: interactionSpot.pose,
                    facing: interactionSpot.facing
                )
            } else {
                node?.apply(facing: .down)
            }
            node?.run(.sequence([
                .wait(forDuration: 3.5),
                .run { [weak self, weak node] in
                    node?.endInteraction()
                    self?.endStroll(agentType)
                },
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

    /// 내가 돌리는 CLI 세션을 **대표 책상 위 화면**으로 보여 준다.
    ///
    /// 사람으로 세우지 않는 이유가 이 기능의 핵심이다. 세션은 편집기 창 하나당 하나씩 잡히는데,
    /// 그걸 사람으로 세우면 **없던 직원이 갑자기 생겼다 사라진다.** 게다가 세션은 사규가 배정한
    /// 일이 아니라 대표 본인의 작업이라, 대표가 이미 서 있는 화면에서 그 사람이 다섯으로 복제돼
    /// 자기 앞에 늘어선 꼴이 된다 — 은유가 거기서 깨진다.
    ///
    /// 그래서 늘어나는 것은 사람이 아니라 **켜진 화면**이다. 책상은 평면도에 고정으로 놓여 있고,
    /// 도는 작업이 있는 책상만 모니터가 켜진다. 일이 끝나면 화면이 꺼질 뿐 아무도 사라지지 않는다.

    /// 세션을 시간축으로도 훑는다.
    ///
    /// `syncSessions` 는 세션 목록이 바뀔 때만 불린다. 그런데 화면을 끄는 판정은 **얼마나
    /// 조용했는가**라 목록이 그대로여도 시간이 흐르면 결과가 바뀐다 — 조용한 세션은 상태도
    /// 활동 시각도 그대로라 갱신 이벤트 자체가 오지 않아, 15분을 넘겨도 다음 무관한 이벤트가
    /// 올 때까지 화면이 켜진 채 남는다.
    ///
    /// 절전으로 씬이 멈춘 동안에는 이 호출도 멈추지만 `currentTime` 은 계속 흐르므로, 다시
    /// 깨어난 첫 프레임에서 간격을 넘겨 즉시 한 번 훑는다.
    override func update(_ currentTime: TimeInterval) {
        super.update(currentTime)
        guard currentTime - lastSessionSweepAt >= officeSessionSweepIntervalSeconds else {
            return
        }
        lastSessionSweepAt = currentTime
        syncSessions(lastSyncedSessions)
    }

    func syncSessions(_ sessions: [ConsoleSession]) {
        lastSyncedSessions = sessions
        let desks = officeSessionDesks(plan: plan)
        let visible = officeVisibleSessions(sessions, limit: desks.count, now: Date())
        let assigned = officeAssignSessionSeats(
            sessions: visible, tiles: desks, previous: sessionSeats
        )
        sessionSeats = assigned
        for (sessionId, node) in sessionMarkers where assigned[sessionId] == nil {
            node.removeFromParent()
            sessionMarkers[sessionId] = nil
        }
        for session in visible {
            guard let desk = assigned[session.sessionId] else {
                continue
            }
            let node: SKNode
            if let existing = sessionMarkers[session.sessionId] {
                node = existing
            } else {
                node = SKNode()
                sessionMarkers[session.sessionId] = node
                objectLayer.addChild(node)
            }
            layoutSessionMarker(node, session: session, desk: desk)
        }
        updateCompanySummary(lastSyncedAgents)
    }

    /// 책상 하나에 붙는 표시 — 켜진 화면 + 어느 프로젝트인지.
    ///
    /// 화면 빛은 **도는 작업에만** 켠다. 백엔드의 `idle` 은 60초짜리라 잠깐 생각하는 동안에도
    /// 꺼지는데, 그렇다고 표시를 통째로 지우면 답변을 기다리는 사이 이름표가 깜빡인다. 빛만
    /// 끄고 이름은 남겨 "이 자리는 아직 이 작업 것" 을 유지한다.
    private func layoutSessionMarker(_ node: SKNode, session: ConsoleSession, desk: TilePoint) {
        node.position = floorPoint(desk)
        // 책상 스프라이트보다 앞에 와야 화면 빛이 상판에 가리지 않는다.
        node.zPosition = depth(of: desk) + 5
        let isActive = session.state == officeSessionActiveState
        node.childNode(withName: "screen")?.removeFromParent()
        if isActive {
            let screen = SKSpriteNode(
                color: SKColor(red: 0.58, green: 0.90, blue: 1.0, alpha: 0.9),
                size: CGSize(width: tileSize * 0.34, height: tileSize * 0.22)
            )
            screen.name = "screen"
            // 모니터 **화면** 자리. 책상 스프라이트는 발밑 기준이고 모니터는 상판 위에 얹혀
            // 있으므로, 상판 높이(0.5칸)가 아니라 그보다 위를 짚어야 한다 — 0.5 로 뒀더니
            // 빛이 화면이 아니라 책상 나뭇결 위에 떠 있었다.
            screen.position = CGPoint(x: 0, y: tileSize * 0.70)
            screen.run(
                .repeatForever(
                    .sequence([
                        .fadeAlpha(to: 0.45, duration: 0.8),
                        .fadeAlpha(to: 0.9, duration: 0.8),
                    ])
                )
            )
            node.addChild(screen)
        }
        // 이름 길이는 **실제 적용될 글자 크기**로 정한다. `setChildLabel` 이 한글 하한(11px)을
        // 걸기 때문에, 요청 크기(tileSize × 0.24)로 계산하면 작은 창에서 글자가 하한만큼 커진
        // 몫을 놓쳐 이름표가 다시 옆자리를 침범한다.
        let sessionFontSize = max(officeNameplateMinFontSize, tileSize * 0.24)
        setChildLabel(
            node, name: "sessionName",
            text: officeSessionShortName(
                session.name,
                limit: officeSessionLabelLimit(
                    tileSize: Double(tileSize), fontSize: Double(sessionFontSize)
                )
            ),
            // 책상 아래. 위는 바깥벽이고 그 높이에 대표 이름표가 있어 겹친다.
            position: CGPoint(x: 0, y: -tileSize * 0.24),
            fontSize: sessionFontSize,
            color: SKColor(white: isActive ? 0.95 : 0.60, alpha: 1)
        )
        // 글자 수 상한은 **평균** 글자 폭에서 나오므로 넘치는 이름이 있다(대문자가 이어지는
        // 디렉터리명). 마지막에 그려 본 폭으로 한 번 더 눌러, 어떤 이름이 와도 옆자리를 침범하지
        // 않게 한다.
        //
        // 재기 전에 배율을 1 로 되돌린다. 지금은 `setChildLabel` 이 라벨을 매번 새로 만들어
        // 늘 1 이지만, 재사용 방식으로 바뀌면 이미 눌려 좁아진 폭을 재게 되어 스냅샷마다 조금씩
        // 더 눌린다 — 한 줄로 그 회귀를 막는다.
        if let label = node.childNode(withName: "sessionName") {
            label.xScale = 1
            label.xScale = CGFloat(
                officeLabelSqueeze(
                    renderedWidth: Double(label.calculateAccumulatedFrame().width),
                    availableWidth: Double(tileSize) * officeSessionDeskStrideTiles
                )
            )
        }
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
            // 값이 없으면 지운다. 예전 값을 남기면 서버를 되돌렸을 때(필드를 모르는 버전)
            // 사라진 직무가 화면에 계속 붙어 있다.
            agentJobs[agent.agentType] = agent.job
            let info = agentTokenInfo(
                agent: agent, runs: runs, pendingCommands: pendingCommands, now: now
            )
            let top = node.sprite.size.height
            // 마우스를 올린 사람은 **상시 말풍선 자리를 호버 쪽지가 대신 쓴다.**
            //
            // 상시 말풍선은 일이 도는 사람에게만 붙는데(`agentTokenInfo`), 그 말풍선이 있으면
            // 호버 쪽지를 만들지 않는 구조였다. 결과가 거꾸로였다 — 지금 무엇을 하는지 가장
            // 궁금한 **진행 중·승인 대기 직원에게만 직무가 영영 안 보였다.**
            // 둘을 같은 높이에 함께 붙이면 글자가 겹치므로, 호버 중에는 활동까지 담은 쪽지 하나로
            // 합친다(`officeHoverNote` 가 직무 → 활동 두 줄을 만든다).
            let isHovered = hoveredAgentType == agent.agentType
            let hoverNote = officeHoverNote(job: agent.job, activity: agent.bubble)
            lastInfoBubbles[agent.agentType] = info.bubble
            if isHovered, let hoverNote {
                setChildLabel(
                    node, name: "hoverBubble", text: hoverNote,
                    position: CGPoint(x: 0, y: top + nameplateClearance),
                    fontSize: tileSize * 0.24, color: SKColor(white: 1, alpha: 0.95)
                )
            } else {
                node.childNode(withName: "hoverBubble")?.removeFromParent()
            }
            setChildLabel(
                node, name: "infoBubble", text: isHovered ? nil : info.bubble,
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
        guard let node = characters[agentType], !node.isInteracting,
              let agent = lastSyncedAgents.first(where: { $0.agentType == agentType })
        else {
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
        guard let node = characters[agent.agentType], !node.isWalking, !node.isInteracting else {
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

    /// 작업 중인 사람의 책상 모니터에 불이 들어온다 — 자리에서 뭔가 돌고 있다는 신호.
    ///
    /// 꺼진 화면(검정)이 그려져 있는 자리에 밝은 판을 덮는다. 예전에는 책상 스프라이트
    /// **통째**를 파랗게 22% 물들였는데, 화면에서는 전혀 읽히지 않았다 — 한 칸이 32픽셀로
    /// 줄어든 그림에서 나무 상판까지 함께 옅게 변하는 것은 색이 흔들린 것으로도 안 보인다
    /// (진행 중인 자리와 대기 자리를 나란히 렌더해 확인). 어두운 실내에 **밝은 점** 하나가
    /// 같은 면적에서 대비가 가장 크다.
    ///
    /// 시작을 켜진 상태(alpha 1)로 두고 낮췄다 올린다. 반대로 두면 정지 화면을 굽는
    /// 회귀 렌더(`--render`)가 늘 꺼진 순간을 잡아, 켜지는지 확인할 방법이 없어진다.
    private func startMonitorGlow(_ agentType: String) {
        guard let desk = deskNodes[agentType], desk.childNode(withName: "monitor") == nil else {
            return
        }
        let screen = SKSpriteNode(
            color: SKColor(red: 0.42, green: 0.80, blue: 1.0, alpha: 1),
            size: CGSize(
                width: desk.size.width * CGFloat(officeDeskScreenWidthRatio),
                height: desk.size.height * CGFloat(officeDeskScreenHeightRatio)
            )
        )
        screen.name = "monitor"
        // 책상 노드가 발밑 기준(anchor y = 0)이므로 자식 좌표도 발밑에서 잰다.
        screen.anchorPoint = CGPoint(x: 0.5, y: 0)
        screen.position = CGPoint(
            x: 0, y: desk.size.height * CGFloat(officeDeskScreenBottomRatio)
        )
        screen.zPosition = 0.1
        desk.addChild(screen)
        screen.run(
            .repeatForever(
                .sequence([
                    .fadeAlpha(to: 0.72, duration: 0.7),
                    .fadeAlpha(to: 1.0, duration: 0.7),
                ])
            )
        )
    }

    private func stopMonitorGlow(_ agentType: String) {
        deskNodes[agentType]?.childNode(withName: "monitor")?.removeFromParent()
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
        let label = SKLabelNode()
        label.name = name
        // 말풍선·경과 표시도 한글이므로 이름표와 같은 폰트·하한을 쓴다.
        let resolvedSize = max(officeNameplateMinFontSize, fontSize)
        let font = NSFont(name: officeLabelFontName, size: resolvedSize)
            ?? NSFont.boldSystemFont(ofSize: resolvedSize)
        // 음수 두께 = 채움 + 외곽선. 여기 오는 글자는 전부 바닥·가구 위에 떠서, 외곽선이
        // 없으면 책장·프린터 무늬에 묻혀 읽히지 않는다(에이전트 이름표와 같은 처리).
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        label.attributedText = NSAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: color,
                .strokeColor: NSColor(white: 0.03, alpha: 0.95),
                .strokeWidth: -3.5,
                .paragraphStyle: paragraph,
            ]
        )
        label.verticalAlignmentMode = .center
        label.horizontalAlignmentMode = .center
        // 개행이 있는 문구(호버 쪽지의 직무 + 활동)를 여러 줄로 그린다. 기본값 1 이면 둘째
        // 줄이 조용히 잘려, 활동 문구를 넣어도 화면에서는 첫 줄만 보인다.
        label.numberOfLines = 0
        // 세로 중앙 정렬이라 줄이 늘면 아래로도 자라 사람 머리를 덮는다. 늘어난 만큼 올려
        // **첫 줄이 한 줄일 때와 같은 높이**에 오게 한다.
        let extraLines = text.components(separatedBy: "\n").count - 1
        label.position = CGPoint(
            x: position.x,
            y: position.y + resolvedSize * 0.62 * CGFloat(extraLines)
        )
        label.zPosition = 20
        parent.addChild(label)
    }

    /// 전사 요약을 화면 좌상단에 띄운다.
    func updateCompanySummary(_ agents: [ConsoleAgent]) {
        overlayLayer.childNode(withName: "summaryHUD")?.removeFromParent()
        let summary = companySummary(agents: agents)
        // "대기" 는 밀린 일감처럼 읽힌다 — 이대리에 대기 큐는 없고, 이 숫자는 **지금 맡은 일이
        // 없는 사람 수**(29명 중 27명이 예사)다. 적체로 오해하면 화면이 늘 비상처럼 보인다.
        var text =
            "진행 \(summary.inProgress)  ·  승인 \(summary.awaitingApproval)  ·  쉬는 중 \(summary.waiting)"
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
        guard let hit = hitTarget(at: event.location(in: self)) else {
            return
        }
        if hit == officeHitTargetPresident {
            onPresidentClick?()
            return
        }
        onAgentClick?(hit)
    }

    override func mouseMoved(with event: NSEvent) {
        let hit = hitTarget(at: event.location(in: self))
        if hit == hoveredAgentType {
            return
        }
        // 대표는 CharacterNode 가 아니라 스프라이트 하나뿐이다. 복귀를 여기서 따로 해주지 않으면
        // 마우스가 떠난 뒤에도 커진 채로 남는다.
        if hoveredAgentType == officeHitTargetPresident {
            president?.run(.scale(to: 1.0, duration: 0.1))
        } else if let previous = hoveredAgentType, let node = characters[previous] {
            node.sprite.run(.scale(to: 1.0, duration: 0.1))
            node.childNode(withName: "hoverBubble")?.removeFromParent()
            node.setHovered(false)
            // 호버 중에는 상시 말풍선 자리를 쪽지가 빌려 쓴다(refreshOverlays 의 같은 근거).
            // 마우스가 떠나면 그 사람의 상시 말풍선을 되돌려야 한다 — 다음 갱신까지 기다리면
            // 일이 도는 사람의 말풍선이 최대 30초 동안 비어 보인다.
            restoreInfoBubble(previous)
        }
        hoveredAgentType = hit
        if hit == officeHitTargetPresident {
            // 에이전트와 같은 몸짓으로 "누를 수 있다" 를 알린다.
            president?.run(.scale(to: 1.12, duration: 0.1))
            return
        }
        guard let hit, let node = characters[hit] else {
            return
        }
        node.setHovered(true)
        node.sprite.run(.scale(to: 1.12, duration: 0.1))
        // 상시 말풍선이 있어도 쪽지를 띄운다. 예전에는 말풍선이 있으면 건너뛰어서, 진행 중·승인
        // 대기처럼 **가장 궁금한 상태의 직원에게만** 직무가 안 보였다. 쪽지가 활동까지 담으므로
        // 말풍선을 잠시 내려도 잃는 정보가 없다.
        guard let text = officeHoverNote(job: agentJobs[hit], activity: agentBubbles[hit]) else {
            return
        }
        node.childNode(withName: "infoBubble")?.removeFromParent()
        setChildLabel(
            node, name: "hoverBubble", text: text,
            position: CGPoint(x: 0, y: node.sprite.size.height + nameplateClearance),
            fontSize: tileSize * 0.24, color: SKColor(white: 1, alpha: 0.95)
        )
    }

    /// 마우스가 떠난 사람의 상시 말풍선을 되돌린다.
    ///
    /// 문구는 마지막 `refreshOverlays` 가 계산해 둔 값을 쓴다. 호버 시점의 문구를 따로 들고 있다가
    /// 되돌리면 호버 중에 상태가 바뀐 경우 옛 문구가 되살아나는데, 이 캐시는 상태가 바뀔 때마다
    /// 함께 갱신되므로 항상 지금 값이다.
    private func restoreInfoBubble(_ agentType: String) {
        guard let node = characters[agentType] else {
            return
        }
        setChildLabel(
            node, name: "infoBubble", text: lastInfoBubbles[agentType] ?? nil,
            position: CGPoint(x: 0, y: node.sprite.size.height + nameplateClearance),
            fontSize: tileSize * 0.24, color: SKColor(white: 1, alpha: 0.95)
        )
    }

    /// 좌표에 있는 사람. 캐릭터는 발 기준으로 서 있으므로 몸통 높이의 절반만큼 위를 중심으로 본다.
    /// 대표도 같은 판정에 넣는다 — 따로 재면 사람이 겹친 자리에서 둘 다 반응한다.
    private func hitTarget(at point: CGPoint) -> String? {
        var slots: [(agentType: String, point: OfficePoint)] = characters.map { entry in
            let center = CGPoint(
                x: entry.value.position.x,
                y: entry.value.position.y + entry.value.sprite.size.height / 2
            )
            return (entry.key, OfficePoint(x: Double(center.x), y: Double(center.y)))
        }
        if let president {
            let center = CGPoint(
                x: president.position.x, y: president.position.y + president.size.height / 2
            )
            slots.append(
                (
                    officeHitTargetPresident,
                    OfficePoint(x: Double(center.x), y: Double(center.y))
                )
            )
        }
        return agentTypeAt(
            point: OfficePoint(x: Double(point.x), y: Double(point.y)),
            slots: slots,
            radius: Double(tileSize * 0.6)
        )
    }
}
