import AppKit
import ConsoleCore
import SpriteKit

/// 사무실 안의 사람 하나. 스프라이트 + 발밑 상태 링 + 이름표를 함께 움직이도록 묶는다.
///
/// 상태색을 캐릭터 몸에 칠하지 않고 발밑 링으로 빼는 이유는, 픽셀 캐릭터를 상태색으로 물들이면
/// 부서 구분(옷 색)과 상태 구분이 같은 채널에서 싸우기 때문이다. 링은 바닥에 눕혀 두 신호를 분리한다.
///
/// 스프라이트는 한 장뿐이라 29명이 전부 같은 사람으로 보인다. 그래서 머리색·셔츠색을 사람마다
/// 갈아끼운 텍스처를 쓴다(`SpriteLoader.characterTexture`). 실루엣이 같아도 도트 그림에서는
/// 색만으로 충분히 구별된다.
final class CharacterNode: SKNode {
    let sprite = SKSpriteNode()
    private let ring = SKShapeNode()
    /// 선택 하이라이트 — 몸을 감싸는 흰 테두리. 자세·타일 크기가 바뀌면 함께 다시 잡아야 해서
    /// 씬이 아니라 캐릭터가 들고 있는다(씬이 한 번 만들어 붙이면 갱신 경로가 없다).
    private let selectionRing = SKShapeNode()
    private let nameLabel = SKLabelNode()
    /// 이름표 뒤 어두운 판. 책상·바닥 무늬 위에 글자가 그냥 놓이면 읽히지 않는다.
    private let namePlate = SKShapeNode()

    /// 지금 서 있는 칸.
    var tile: TilePoint
    private(set) var facing: Facing = .down
    /// 자리에 앉아 있는가(앉은 스프라이트는 방향 교체를 하지 않는다).
    var isSeated = false
    /// 걷는 중인가 — 새 지시가 오면 기존 걸음을 끊어야 해서 필요하다.
    /// 걸음 프레임을 쓸지 정지 그림을 쓸지도 이 값이 가른다(`currentPose`).
    var isWalking = false
    /// 몇 번째 걸음인가 — 좌우 다리가 번갈아 나가도록 한 칸마다 늘린다.
    private var walkStep = 0
    /// 상호작용 중에는 상태 몸짓을 다시 걸면 자세가 즉시 덮이므로 씬이 이를 판별해야 한다.
    private(set) var isInteracting = false
    private var interactionFacing: Facing?
    /// 라운지 자세로 전체 노드를 옮긴 양. 종료 때 정확히 빼고, 절대 배치는 새 기준에서 재계산한다.
    private var interactionOffset: CGPoint = .zero

    private var spriteScale: CGFloat = 1
    private var currentTileSize: CGFloat = 32
    /// 스프라이트의 기준 y. 앉으면 책상과 겹치도록 내려가고, 서면 0 으로 돌아온다.
    /// 몸짓 애니메이션은 전부 이 기준 위에서 상대 이동한다.
    ///
    /// 몸에 붙는 장식(이름표·선택 테두리)은 전부 이 값을 더해 놓아야 한다 — 안 그러면
    /// 앉은 사람에게만 장식이 몸에서 한 뼘 떠오른다. 값이 바뀌는 곳은 `applySpriteSize` 하나이므로
    /// 새 장식을 붙일 때는 거기서 함께 다시 잡을 것.
    private var spriteBaseY: CGFloat = 0
    /// 머리 위 표시(말풍선·경과·생각 점)를 붙일 기준 높이. 씬이 라벨을 놓을 때 쓴다.
    ///
    /// `sprite.size.height` 만 쓰면 앉아서 내려간 몫(`spriteBaseY`)이 빠져 **말풍선만 몸에서
    /// 한 뼘 떠오른다.** 이름표는 내려가는데 그 위 말풍선은 안 내려가 둘 사이가 벌어지고,
    /// 부서 문패가 비켜설 높이를 재는 Core 계산(`officeSeatedBubbleTopTiles`)과도 0.28칸
    /// 어긋난다 — 문패에 확보한 0.35칸 간격이 실제로는 0.07칸(최소 창에서 1.4px)만 남는다.
    var headTopY: CGFloat {
        spriteBaseY + sprite.size.height
    }

    /// 이름표가 좌우로 쓸 수 있는 여유(칸). 씬이 좌석·방에서 계산해 넘긴다(`officeNameplateSpanTiles`).
    /// nil 이면 제한 없음 — 방에 속하지 않은 자리다.
    private var nameplateSpan: (left: Double, right: Double)?
    /// 이름표 세기 판정에 쓰는 현재 상태·주목 여부.
    private var currentState: ConsoleAgentState = .waiting
    private var isHovered = false
    private var isSelected = false
    private let nameText: String
    private let sheetIndex: Int
    private let hairColor: (red: Double, green: Double, blue: Double)
    /// 셔츠색은 부서에서 파생하므로 부서가 바뀌면 함께 바뀐다(`apply(department:)`).
    private var shirtColor: (red: Double, green: Double, blue: Double)
    private let pantsColor: (red: Double, green: Double, blue: Double)
    /// 지금 입고 있는 옷이 어느 부서 것인지. 스냅샷 부서와 비교해 갱신 여부를 정한다.
    private var department: Department
    /// 사람마다 다른 셔츠 톤 보정. 부서가 바뀌어도 이 사람의 개성은 유지해야 한다.
    private let shirtShift: Double

    /// 부서는 백엔드 스냅샷 값을 그대로 받는다 — 노드가 agentType 을 보고 다시 분류하면
    /// 배치(방)와 셔츠색이 서로 다른 부서를 가리킬 수 있다.
    ///
    init(agentType: String, displayName: String, department: Department, tile: TilePoint) {
        self.tile = tile
        // 백엔드 표시명은 슬랙·문서와 공유하는 영문 식별명이라, 화면에서는 직책으로 바꿔 부른다.
        nameText = agentRoleLabel(for: agentType) ?? displayName
        let look = characterLook(for: agentType)
        sheetIndex = look.sheetIndex
        hairColor = hairPalette[look.hairIndex]
        self.department = department
        shirtShift = look.shirtShift
        shirtColor = officeShirtColorRGB(department: department, shift: look.shirtShift)
        // 바지는 부서색과 엮지 않는다. 셔츠가 이미 부서를 나타내므로 같은 축을 두 번 쓰면
        // 구별 수단이 늘지 않는다 — 사람을 가르는 축으로만 쓴다.
        pantsColor = pantsPalette[look.pantsIndex]
        super.init()
        name = agentType

        // 발밑 링 — 상태색. 바닥에 눕힌 타원이라 캐릭터를 가리지 않는다.
        //
        // z 는 스프라이트(1)보다 앞이어야 한다. 좌석은 책상보다 한 칸 위라 책상 노드가 더 앞에
        // 그려지는데, 링이 캐릭터 뒤(-1)에 있으면 책상이 링의 아래쪽 절반을 덮어 상태색이
        // 반만 보였다. 관제 화면에서 가장 먼저 읽혀야 할 신호라 책상보다 앞으로 올린다.
        ring.fillColor = .clear
        ring.lineWidth = 2
        ring.zPosition = 1.5
        addChild(ring)

        // 캐릭터 — 발이 칸 바닥에 닿도록 아래쪽을 기준점으로.
        sprite.anchorPoint = CGPoint(x: 0.5, y: 0)
        sprite.zPosition = 1
        addChild(sprite)

        namePlate.strokeColor = .clear
        namePlate.zPosition = 2
        addChild(namePlate)

        nameLabel.verticalAlignmentMode = .bottom
        nameLabel.horizontalAlignmentMode = .center
        nameLabel.zPosition = 3
        addChild(nameLabel)
        refreshNameplate()

        // 선택했을 때만 보인다. 노드를 붙였다 뗐다 하지 않고 숨김만 토글해, 위치 갱신 경로를
        // "선택 중인지" 와 무관하게 한 곳(layoutSelectionRing)으로 유지한다.
        selectionRing.strokeColor = SKColor(white: 1, alpha: 0.85)
        selectionRing.lineWidth = 1.5
        selectionRing.fillColor = .clear
        selectionRing.zPosition = 15
        selectionRing.isHidden = true
        addChild(selectionRing)

        apply(facing: .down)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not supported")
    }

    /// 타일 크기가 바뀌면(창 크기 변경) 스프라이트·링·이름표를 함께 다시 잰다.
    func resize(tileSize: CGFloat, spriteScale: CGFloat) {
        self.spriteScale = spriteScale
        currentTileSize = tileSize
        applySpriteSize()
        let radiusX = tileSize * 0.34
        let radiusY = tileSize * 0.17
        ring.path = CGPath(
            ellipseIn: CGRect(
                x: -radiusX, y: -radiusY * 0.6, width: radiusX * 2, height: radiusY * 2
            ),
            transform: nil
        )
        refreshNameplate()
    }

    /// 씬의 절대 배치 진입점. 이전 좌표계의 interaction offset은 버리고 새 기준에서 다시 계산한다.
    func place(at position: CGPoint, depth: CGFloat) {
        self.position = position
        zPosition = depth
        interactionOffset = .zero
        refreshInteractionOffset()
    }

    /// 이 사람 자리의 이름표 몫을 정한다. 자리·방이 바뀌면 다시 넘어온다.
    func setNameplateSpan(_ span: (left: Double, right: Double)?) {
        nameplateSpan = span
        layoutNameplate()
    }

    func apply(state: ConsoleAgentState) {
        currentState = state
        let palette = agentStatePaletteRGBA(state)
        ring.strokeColor = SKColor(
            red: palette.red, green: palette.green, blue: palette.blue, alpha: 0.95
        )
        // 상태 링이 이름표보다 먼저 읽혀야 한다. 손이 필요한 두 상태는 선을 더 굵게 준다.
        ring.lineWidth = (state == .awaitingApproval || state == .failed) ? 3.2 : 2.2
        refreshNameplate()
    }

    /// 마우스가 올라갔는가 / 선택됐는가 — 이름표 세기에만 쓴다.
    func setHovered(_ hovered: Bool) {
        guard isHovered != hovered else {
            return
        }
        isHovered = hovered
        refreshNameplate()
    }

    func setSelected(_ selected: Bool) {
        guard isSelected != selected else {
            return
        }
        isSelected = selected
        selectionRing.isHidden = !selected
        refreshNameplate()
    }

    /// 선택 테두리를 현재 자세·타일 크기에 맞춘다.
    ///
    /// 앉으면 스프라이트가 `spriteBaseY` 만큼 내려가고 창 크기가 바뀌면 키까지 달라진다.
    /// 그래서 이름표와 같은 자리(`applySpriteSize`)에서 함께 다시 잡는다 — 한 번 만들고 두면
    /// 앉았다 서는 것만으로 테두리가 몸에서 한 뼘 떨어진다.
    private func layoutSelectionRing() {
        selectionRing.path = CGPath(
            roundedRect: CGRect(
                x: -currentTileSize * 0.42, y: spriteBaseY - currentTileSize * 0.16,
                width: currentTileSize * 0.84, height: sprite.size.height + currentTileSize * 0.24
            ),
            cornerWidth: 4, cornerHeight: 4, transform: nil
        )
    }

    /// 이름표를 현재 세기로 다시 그린다.
    ///
    /// 판을 옅게 깔고 글자에 어두운 외곽선을 줘, 판 없이도 읽히게 한다. 29명 전원이 늘
    /// 진한 검은 딱지를 달고 있으면 방이 라벨로 덮여 상태 링을 볼 수 없다.
    private func refreshNameplate() {
        let emphasized = nameplateIsEmphasized(
            state: currentState, isHovered: isHovered, isSelected: isSelected
        )
        // 창이 작아 이름표가 서로 겹치는 구간에서는 읽히는 몇 개만 남긴다.
        let visible = nameplateIsVisible(
            tileSize: Double(currentTileSize), state: currentState,
            isHovered: isHovered, isSelected: isSelected
        )
        nameLabel.isHidden = !visible
        namePlate.isHidden = !visible
        // 문패를 이 글자 위로 올리는 계산이 Core 에 있으므로, 크기도 같은 함수에서 받는다.
        let fontSize = CGFloat(officeNameplateFontSize(tileSize: Double(currentTileSize)))
        let font = NSFont(name: officeLabelFontName, size: fontSize)
            ?? NSFont.boldSystemFont(ofSize: fontSize)
        nameLabel.attributedText = NSAttributedString(
            string: nameText,
            attributes: [
                .font: font,
                .foregroundColor: NSColor(white: emphasized ? 1.0 : 0.84, alpha: 1),
                // 음수 두께 = 채움 + 외곽선. 바닥·가구 무늬 위에서도 글자가 뭉개지지 않는다.
                .strokeColor: NSColor(white: 0.03, alpha: 0.95),
                .strokeWidth: -3.5,
            ]
        )
        // 아래 행 사람의 이름표는 위 행 책상 위에 얹힌다(좌석 행 간격이 2칸이라 구조적으로 그렇다).
        // 판이 너무 옅으면 나뭇결에 묻히므로, 기본값도 글자가 버틸 만큼은 남긴다.
        namePlate.fillColor = SKColor(white: 0.05, alpha: emphasized ? 0.72 : 0.38)
        layoutNameplate()
    }

    /// 이름표를 머리 위에 올린다.
    ///
    /// 예전에는 발밑(`-tileSize × 0.14`)에 뒀는데, 캐릭터를 한 칸 크기로 줄이고 책상을 키우자
    /// 이름표가 책상 상판과 정확히 겹쳐 글자가 나뭇결에 묻혔다. 좌석 위쪽은 늘 비어 있으므로
    /// 머리 위가 겹칠 일이 없는 유일한 자리다(말풍선·점 표시는 그보다 더 위에 붙는다).
    private func layoutNameplate() {
        // 눌린 폭이 아니라 원래 폭을 재야 한다 — 배율을 안 되돌리면 갱신될 때마다 이미
        // 좁아진 폭을 다시 재서 스냅샷마다 조금씩 더 눌린다.
        nameLabel.xScale = 1
        // 앉아서 내려간 만큼 이름표도 함께 내려간다(spriteBaseY) — 안 그러면 앉은 사람만
        // 라벨이 머리에서 한 뼘 떠 있다.
        nameLabel.position = CGPoint(
            x: 0,
            y: spriteBaseY + sprite.size.height
                + currentTileSize * CGFloat(officeNameplateGapTiles)
        )
        fitNameplateToSeat()
        // 판 여백은 Core 가 배치 계산에 쓰는 값과 같아야 한다 — 여기만 넓히면 판이 자리 몫을
        // 그만큼 넘는다(배율은 글자에만 걸리므로 이 여백은 눌리지 않는다).
        let box = nameLabel.frame.insetBy(
            dx: -CGFloat(officeNameplatePlatePadding) / 2, dy: -1
        )
        namePlate.path = CGPath(
            roundedRect: box, cornerWidth: 2, cornerHeight: 2, transform: nil
        )
    }

    /// 이름표를 자기 자리 몫 안에 넣는다 — 넘치면 옆으로 밀고, 그래도 넘치면 눌러 넣는다.
    ///
    /// 이름표는 캐릭터의 자식이라 늘 좌석 중앙에 놓이는데, 폭은 이름 길이와 창 크기가 정한다.
    /// 그래서 몫보다 넓어지는 순간 갈 곳이 없어 밖으로 샜다 — 벽 옆자리(구역 상대 x=9)는
    /// 오른쪽 여유가 반 칸뿐이라 `답변 판정`·`윤문` 의 판이 벽과 문 위로 올라탔고, 이웃이 있는
    /// 쪽은 중간선을 넘어 옆 사람 이름을 덮었다.
    ///
    /// **서 있을 때는 적용하지 않는다.** 자리를 떠난 사람에게 그 자리 몫을 계속 물리면,
    /// 복도로 나가서도 이름표가 한쪽으로 치우친 채 눌려 따라다닌다.
    private func fitNameplateToSeat() {
        guard isSeated, let span = nameplateSpan else {
            return
        }
        // 이웃과의 여백은 몫을 계산할 때 이미 빠져 있다(`officeNameplateSpanTiles`).
        // 배율·이동량 산술은 Core 가 갖는다 — 판 여백은 눌리지 않는다는 규칙까지 포함해서
        // 회귀 테스트가 실제 글꼴 폭으로 검산할 수 있어야 하기 때문이다.
        let layout = officeNameplateLayout(
            glyphWidth: Double(nameLabel.frame.width),
            spanLeft: span.left * Double(currentTileSize),
            spanRight: span.right * Double(currentTileSize)
        )
        nameLabel.xScale = CGFloat(layout.scaleX)
        nameLabel.position.x = CGFloat(layout.offsetX)
    }

    /// 방향을 바꾼다. 앉아 있는 동안은 앉은 자세를 유지한다.
    func apply(facing newFacing: Facing) {
        facing = newFacing
        guard !isSeated else {
            return
        }
        setTexture(currentPose())
    }

    /// 지금 써야 할 포즈 — 걷는 중이면 현재 걸음의 프레임, 서 있으면 정지 그림.
    ///
    /// 방향 전환도 이 함수를 지나야 한다. 걷다가 코너를 돌 때 정지 그림으로 되돌리면
    /// 그 한 칸만 다리가 모아져 걸음이 끊겨 보인다.
    private func currentPose() -> String {
        let pose = characterSprite(for: facing).pose
        return isWalking ? officeWalkPose(pose, step: walkStep) : pose
    }

    /// 한 걸음 내디딘다 — 다음 걸음 프레임으로 갈아끼운다.
    ///
    /// 한 칸마다 한 번 불린다. 두 프레임을 번갈아 쓰므로 한 걸음에 다리가 한 번 교차한다.
    func stepWalkFrame() {
        guard !isSeated else {
            return
        }
        walkStep += 1
        setTexture(currentPose())
    }

    /// 걸음을 마치고 정지 자세로 돌아온다.
    ///
    /// 걸음 프레임은 한쪽 발이 들린 그림이라, 도착해서 그대로 두면 그 사람만 계속 짝다리로
    /// 서 있다. 걸음이 끊기는 모든 경로(도착·창 크기 변경으로 인한 강제 재배치)가 이걸 부른다.
    func endWalk() {
        isWalking = false
        walkStep = 0
        guard !isSeated else {
            return
        }
        setTexture(characterSprite(for: facing).pose)
    }

    /// 스냅샷 부서를 반영한다. 바뀌었으면 셔츠를 새 부서색으로 갈아입힌다.
    ///
    /// 노드는 한 번 만들면 계속 재사용되므로(`sync` 가 `characters[agentType]` 를 다시 쓴다),
    /// 부서만 바뀐 경우 방은 새 구역으로 옮겨 가는데 옷은 옛 부서색으로 남는다 — 이 PR 이
    /// 닫으려던 "방과 옷이 다른 부서를 가리키는" 상태가 재동기화 경로에서 되살아난다.
    func apply(department newDepartment: Department) {
        guard newDepartment != department else {
            return
        }
        department = newDepartment
        shirtColor = officeShirtColorRGB(department: newDepartment, shift: shirtShift)
        // 새 색으로 다시 굽는다. 걷는 중이면 다음 걸음 프레임이 자연히 새 색으로 그려진다.
        if isSeated {
            setTexture("sit")
        } else {
            apply(facing: facing)
        }
    }

    func sit() {
        isSeated = true
        setTexture("sit")
    }

    func stand() {
        guard isSeated else {
            return
        }
        isSeated = false
        apply(facing: facing)
    }

    /// 가구 자세는 몸과 소품을 한 생명주기로 묶어, 취소 경로가 어느 한쪽만 남기지 않게 한다.
    func beginInteraction(pose: OfficeInteractionPose, facing: Facing) {
        endInteraction()
        apply(facing: facing)
        clearMotion()
        isInteracting = true
        interactionFacing = facing

        if pose == .sitting {
            sit()
        } else {
            // **앉아 있던 사람은 명시적으로 일으켜야 한다.** 자세를 걸기 전 상태가 남으면
            // 커피머신·화이트보드 앞에서 앉은 그림이 그대로 유지된다(렌더로 확인). 걸어와서
            // 자세를 잡는 경로는 `walk` 가 이미 세우지만, 걸음 없이 자리를 옮기는 경로
            // (스냅샷 재배치·회귀 렌더)에는 그 보정이 없다.
            stand()
            applySpriteSize()
        }

        if let spriteName = pose.handPropSprite,
           let texture = SpriteLoader.texture(spriteName) {
            let prop = SKSpriteNode(texture: texture)
            prop.name = "handProp"
            prop.zPosition = 1.2
            addChild(prop)
            layoutHandProp(prop, facing: facing)
            animateHandProp(prop, pose: pose)
        }

        switch pose {
        case .reading:
            startBreathing()
        case .tending:
            let tend = SKAction.sequence([
                .scaleY(to: 0.94, duration: 0.34),
                .scaleY(to: 1, duration: 0.34),
            ])
            tend.timingMode = .easeInEaseOut
            sprite.run(.repeatForever(tend), withKey: "interaction")
        case .sitting, .drinking, .carryingPapers, .writing, .stowing:
            break
        }
    }

    /// 같은 취소 신호가 겹쳐도 소품·오프셋·앉은 그림이 남지 않도록 항상 완전한 기본값을 복원한다.
    func endInteraction() {
        guard isInteracting
            || childNode(withName: "handProp") != nil
            || sprite.action(forKey: "interaction") != nil
        else {
            return
        }
        childNode(withName: "handProp")?.removeFromParent()
        sprite.removeAction(forKey: "interaction")
        isInteracting = false
        interactionFacing = nil
        refreshInteractionOffset()
        stand()
        clearMotion()
    }

    private func animateHandProp(_ prop: SKSpriteNode, pose: OfficeInteractionPose) {
        switch pose {
        case .drinking:
            let sip = SKAction.sequence([
                .moveBy(x: 0, y: currentTileSize * 0.20, duration: 0.20),
                .wait(forDuration: 0.25),
                .moveBy(x: 0, y: -currentTileSize * 0.20, duration: 0.20),
                .wait(forDuration: 0.25),
            ])
            prop.run(.repeat(sip, count: 2), withKey: "interaction")
        case .writing:
            let stroke = SKAction.sequence([
                .moveBy(x: -currentTileSize * 0.07, y: 0, duration: 0.18),
                .moveBy(x: currentTileSize * 0.14, y: 0, duration: 0.36),
                .moveBy(x: -currentTileSize * 0.07, y: 0, duration: 0.18),
            ])
            prop.run(.repeatForever(stroke), withKey: "interaction")
        case .carryingPapers, .stowing:
            prop.run(
                .moveBy(x: 0, y: currentTileSize * 0.12, duration: 0.24),
                withKey: "interaction"
            )
        case .sitting, .reading, .tending:
            break
        }
    }

    private func layoutHandProp(_ prop: SKSpriteNode, facing: Facing) {
        guard let texture = prop.texture else {
            return
        }
        let sourceSize = texture.size()
        // **캐릭터와 같은 도트 배율을 쓴다.** "타일의 몇 할" 로 크기를 정하면 7×6px 짜리 머그가
        // 캐릭터보다 훨씬 굵은 도트로 확대돼, 픽셀 그림에서 가장 먼저 눈에 걸리는 부조화가 된다
        // (렌더에서 머그가 흰 사각형 덩어리로 보였다). 소품 원본은 캐릭터와 같은 해상도로 그려져
        // 있으므로 같은 배율이면 손에 든 물건으로 읽힌다.
        //
        // 다만 1배로 두면 7px 머그가 몸에 묻혀 아예 안 보였다(렌더 확인). 2배는 정수배라 도트가
        // 깨지지 않으면서 손에 든 것이 실루엣 밖으로 나온다 — 가시성이 도트 정합보다 앞선다.
        let propScale = spriteScale * 2
        prop.size = CGSize(
            width: sourceSize.width * propScale, height: sourceSize.height * propScale
        )

        let handOffset: CGPoint
        switch facing {
        case .left:
            handOffset = CGPoint(x: -currentTileSize * 0.20, y: 0)
        case .right:
            handOffset = CGPoint(x: currentTileSize * 0.20, y: 0)
        // 위·아래를 볼 때는 몸이 소품을 가린다(뒤·앞모습이라 손이 실루엣 안에 들어간다).
        // 옆으로 더 내보내 어깨선 밖에서 보이게 한다.
        case .up:
            handOffset = CGPoint(x: currentTileSize * 0.26, y: currentTileSize * 0.06)
        case .down:
            handOffset = CGPoint(x: -currentTileSize * 0.26, y: -currentTileSize * 0.04)
        }
        prop.position = CGPoint(
            x: handOffset.x,
            y: spriteBaseY + sprite.size.height * 0.55 + handOffset.y
        )
    }

    private func setTexture(_ pose: String) {
        sprite.texture = SpriteLoader.characterTexture(
            pose: pose, sheet: sheetIndex, hair: hairColor, shirt: shirtColor, pants: pantsColor
        )
        applySpriteSize()
    }

    /// 텍스처 원본 크기 × 배율로 표시한다 — 도트 크기가 다른 스프라이트끼리 비율이 맞도록.
    private func applySpriteSize() {
        guard let texture = sprite.texture else {
            return
        }
        let base = texture.size()
        sprite.size = CGSize(
            width: base.width * spriteScale, height: base.height * spriteScale
        )
        let flipped = !isSeated && characterSprite(for: facing).flipped
        sprite.xScale = flipped ? -1 : 1
        // 앉으면 책상 쪽으로 내려 하반신이 책상에 가리게 한다. 안 내리면 좌석이 책상 바로 위 칸이라
        // 사람이 책상 위 허공에 별개로 놓인 물체처럼 보인다(근거는 officeSeatedSpriteDrop).
        spriteBaseY = isSeated ? -currentTileSize * CGFloat(officeSeatedSpriteDrop) : 0
        sprite.position = CGPoint(x: 0, y: spriteBaseY)
        refreshInteractionOffset()
        if let prop = childNode(withName: "handProp") as? SKSpriteNode,
           let interactionFacing {
            layoutHandProp(prop, facing: interactionFacing)
        }
        // 포즈에 따라 키가 달라진다(앉기 57px · 서기 54px). 이름표가 머리 위에 붙으므로
        // 여기서 함께 다시 잡지 않으면 앉고 설 때마다 라벨이 머리에 파묻히거나 떠오른다.
        layoutNameplate()
        layoutSelectionRing()
        layoutHeadLabels()
    }

    /// 씬이 붙인 머리 위 라벨(말풍선·생각 점)을 지금 자세에 맞춰 다시 놓는다.
    ///
    /// 이 라벨들은 씬이 만들어 붙이므로 위치를 한 번만 계산한다. 그런데 앉고 서면
    /// `spriteBaseY` 가 오르내리고, **자리로 걸어와 앉는 경로(`goHome` → `sit`)에는
    /// `refreshOverlays` 가 뒤따르지 않는다** — 그대로 두면 도착해 앉은 사람의 말풍선만
    /// 다음 상태 갱신(최대 30초)까지 서 있던 높이에 떠 있다. 이름표가 여기서 다시 잡히는
    /// 것과 같은 이유이고, 같은 자리에서 함께 처리해야 새 라벨이 빠지지 않는다.
    private func layoutHeadLabels() {
        let y = headTopY + CGFloat(officeNameplateClearance(tileSize: Double(currentTileSize)))
        for name in officeHeadLabelNames {
            childNode(withName: name)?.position.y = y
        }
    }

    // MARK: - 몸짓 애니메이션
    //
    // 걷기·타이핑 프레임이 따로 없으므로, 위치·기울기·크기 변형만으로 동작을 만든다.
    // 도트 캐릭터에서는 이 정도 변형으로도 "무엇을 하는 중인지" 가 읽힌다.
    // 모든 동작은 서로 배타적이라 하나를 걸 때 나머지를 끊는다.

    private static let motionKeys = ["typing", "breathing", "slump", "waitTap"]

    private func refreshInteractionOffset() {
        let nextOffset: CGPoint
        if isInteracting, isSeated, let interactionFacing {
            let offset = officeLoungeInteractionOffset(
                facing: interactionFacing,
                tileSize: Double(currentTileSize)
            )
            nextOffset = CGPoint(x: offset.x, y: offset.y)
        } else {
            nextOffset = .zero
        }
        position = CGPoint(
            x: position.x - interactionOffset.x + nextOffset.x,
            y: position.y - interactionOffset.y + nextOffset.y
        )
        interactionOffset = nextOffset
    }

    func clearMotion() {
        for key in Self.motionKeys {
            sprite.removeAction(forKey: key)
        }
        sprite.zRotation = 0
        sprite.yScale = 1
        // 기준 y 로 돌린다 — `.zero` 로 되돌리면 앉은 사람이 몸짓을 멈출 때마다 책상 위로 튀어오른다.
        sprite.position = CGPoint(x: 0, y: spriteBaseY)
    }

    /// 작업 중 — 키보드를 두드리듯 짧고 빠르게 위아래로.
    func startTyping() {
        guard sprite.action(forKey: "typing") == nil else {
            return
        }
        clearMotion()
        let beat = SKAction.sequence([
            .moveBy(x: 0, y: 1.4, duration: 0.09),
            .moveBy(x: 0, y: -1.4, duration: 0.09),
            .wait(forDuration: 0.06),
        ])
        sprite.run(.repeatForever(beat), withKey: "typing")
    }

    /// 대기 — 느린 숨쉬기. 멈춰 있어도 살아 있다는 신호.
    ///
    /// 시작 위상을 사람마다 어긋낸다. 전원이 같은 순간에 같은 주기로 오르내리면 사람이 아니라
    /// 군무로 보이고, 스프라이트가 한 장뿐인 이 화면에서는 "다 똑같아 보인다" 는 인상을
    /// 한 번 더 굳힌다.
    func startBreathing() {
        guard sprite.action(forKey: "breathing") == nil else {
            return
        }
        clearMotion()
        let half = officeBreathCycleSeconds / 2
        let breathe = SKAction.sequence([
            .scaleY(to: 1.02, duration: half),
            .scaleY(to: 1.0, duration: half),
        ])
        breathe.timingMode = .easeInEaseOut
        sprite.run(
            .sequence([
                .wait(forDuration: officeBreathPhaseSeconds(agentType: name ?? nameText)),
                .repeatForever(breathe),
            ]),
            withKey: "breathing"
        )
    }

    /// 실패 — 어깨가 축 처진다. 세로로 눌러 낮아지고 살짝 내려앉는다.
    ///
    /// 예전에는 몸을 -0.18 rad 기울였는데, 탑다운에서 앉은 캐릭터를 회전시키면 "엎드림" 이
    /// 아니라 "의자에서 미끄러져 기우뚱한 사람" 으로 읽혔다. 회전 대신 압축을 쓴다.
    func startSlump() {
        guard sprite.action(forKey: "slump") == nil else {
            return
        }
        clearMotion()
        let fall = SKAction.group([
            .scaleY(to: 0.86, duration: 0.35),
            .moveBy(x: 0, y: -2, duration: 0.35),
        ])
        fall.timingMode = .easeOut
        sprite.run(fall, withKey: "slump")
    }

    /// 승인 대기 — 줄에서 발을 구르며 기다린다.
    func startWaitTap() {
        guard sprite.action(forKey: "waitTap") == nil else {
            return
        }
        clearMotion()
        let tap = SKAction.sequence([
            .moveBy(x: 0, y: 2.2, duration: 0.22),
            .moveBy(x: 0, y: -2.2, duration: 0.22),
            .wait(forDuration: 0.9),
        ])
        sprite.run(.repeatForever(tap), withKey: "waitTap")
    }

    /// 완료 — 한 번 튀어오른다(1회성이라 상시 동작을 지우지 않는다).
    func playHop() {
        let hop = SKAction.sequence([
            .moveBy(x: 0, y: 7, duration: 0.14),
            .moveBy(x: 0, y: -7, duration: 0.14),
        ])
        hop.timingMode = .easeOut
        sprite.run(hop)
    }
}
