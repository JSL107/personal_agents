import ConsoleCore
import SpriteKit

/// 사무실 안의 사람 하나. 스프라이트 + 발밑 상태 링 + 이름표를 함께 움직이도록 묶는다.
///
/// 상태색을 캐릭터 몸에 칠하지 않고 발밑 링으로 빼는 이유는, 픽셀 캐릭터를 상태색으로 물들이면
/// 부서 구분(옷 색)과 상태 구분이 같은 채널에서 싸우기 때문이다. 링은 바닥에 눕혀 두 신호를 분리한다.
///
/// 스프라이트는 한 장뿐이라 26명이 전부 같은 사람으로 보인다. 그래서 머리색·셔츠색을 사람마다
/// 갈아끼운 텍스처를 쓴다(`SpriteLoader.characterTexture`). 실루엣이 같아도 도트 그림에서는
/// 색만으로 충분히 구별된다.
final class CharacterNode: SKNode {
    let sprite = SKSpriteNode()
    private let ring = SKShapeNode()
    private let nameLabel = SKLabelNode()
    /// 이름표 뒤 어두운 판. 책상·바닥 무늬 위에 글자가 그냥 놓이면 읽히지 않는다.
    private let namePlate = SKShapeNode()

    /// 지금 서 있는 칸.
    var tile: TilePoint
    private(set) var facing: Facing = .down
    /// 자리에 앉아 있는가(앉은 스프라이트는 방향 교체를 하지 않는다).
    var isSeated = false
    /// 걷는 중인가 — 새 지시가 오면 기존 걸음을 끊어야 해서 필요하다.
    var isWalking = false

    private var spriteScale: CGFloat = 1
    private let sheetIndex: Int
    private let hairColor: (red: Double, green: Double, blue: Double)
    private let shirtColor: (red: Double, green: Double, blue: Double)

    init(agentType: String, displayName: String, tile: TilePoint) {
        self.tile = tile
        let look = characterLook(for: agentType)
        sheetIndex = look.sheetIndex
        hairColor = hairPalette[look.hairIndex]
        // 셔츠는 부서색을 흰색 쪽으로 끌어와 파스텔로 만든다. 원색을 그대로 입히면
        // 작업복이 아니라 코스튬처럼 보이고, 얼굴·머리보다 옷이 먼저 눈에 띈다.
        let department = ConsoleCore.department(for: agentType)
        let palette = agentDepartmentPaletteRGBA(department)
        let blend = 0.42 + look.shirtShift
        shirtColor = (
            red: 1.0 - (1.0 - palette.red) * blend,
            green: 1.0 - (1.0 - palette.green) * blend,
            blue: 1.0 - (1.0 - palette.blue) * blend
        )
        super.init()
        name = agentType

        // 발밑 링 — 상태색. 바닥에 눕힌 타원이라 캐릭터를 가리지 않는다.
        ring.fillColor = .clear
        ring.lineWidth = 2
        ring.zPosition = -1
        addChild(ring)

        // 캐릭터 — 발이 칸 바닥에 닿도록 아래쪽을 기준점으로.
        sprite.anchorPoint = CGPoint(x: 0.5, y: 0)
        sprite.zPosition = 1
        addChild(sprite)

        namePlate.fillColor = SKColor(white: 0.05, alpha: 0.62)
        namePlate.strokeColor = .clear
        namePlate.zPosition = 2
        addChild(namePlate)

        // 백엔드 표시명은 슬랙·문서와 공유하는 영문 식별명이라, 화면에서는 직책으로 바꿔 부른다.
        nameLabel.text = agentRoleLabel(for: agentType) ?? displayName
        nameLabel.fontSize = 9
        nameLabel.fontName = "Menlo"
        nameLabel.fontColor = SKColor(white: 0.94, alpha: 1)
        nameLabel.verticalAlignmentMode = .top
        nameLabel.horizontalAlignmentMode = .center
        nameLabel.zPosition = 3
        addChild(nameLabel)

        apply(facing: .down)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not supported")
    }

    /// 타일 크기가 바뀌면(창 크기 변경) 스프라이트·링·이름표를 함께 다시 잰다.
    func resize(tileSize: CGFloat, spriteScale: CGFloat) {
        self.spriteScale = spriteScale
        applySpriteSize()
        let radiusX = tileSize * 0.34
        let radiusY = tileSize * 0.17
        ring.path = CGPath(
            ellipseIn: CGRect(
                x: -radiusX, y: -radiusY * 0.6, width: radiusX * 2, height: radiusY * 2
            ),
            transform: nil
        )
        nameLabel.fontSize = max(7, tileSize * 0.24)
        nameLabel.position = CGPoint(x: 0, y: -tileSize * 0.14)
        let box = nameLabel.frame.insetBy(dx: -3, dy: -1)
        namePlate.path = CGPath(
            roundedRect: box, cornerWidth: 2, cornerHeight: 2, transform: nil
        )
    }

    func apply(state: ConsoleAgentState) {
        let palette = agentStatePaletteRGBA(state)
        ring.strokeColor = SKColor(
            red: palette.red, green: palette.green, blue: palette.blue, alpha: 0.95
        )
    }

    /// 방향을 바꾼다. 앉아 있는 동안은 앉은 자세를 유지한다.
    func apply(facing newFacing: Facing) {
        facing = newFacing
        guard !isSeated else {
            return
        }
        setTexture(characterSprite(for: newFacing).pose)
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

    private func setTexture(_ pose: String) {
        sprite.texture = SpriteLoader.characterTexture(
            pose: pose, sheet: sheetIndex, hair: hairColor, shirt: shirtColor
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
    }

    // MARK: - 몸짓 애니메이션
    //
    // 걷기·타이핑 프레임이 따로 없으므로, 위치·기울기·크기 변형만으로 동작을 만든다.
    // 도트 캐릭터에서는 이 정도 변형으로도 "무엇을 하는 중인지" 가 읽힌다.
    // 모든 동작은 서로 배타적이라 하나를 걸 때 나머지를 끊는다.

    private static let motionKeys = ["typing", "breathing", "slump", "waitTap"]

    func clearMotion() {
        for key in Self.motionKeys {
            sprite.removeAction(forKey: key)
        }
        sprite.zRotation = 0
        sprite.yScale = 1
        sprite.position = .zero
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
    func startBreathing() {
        guard sprite.action(forKey: "breathing") == nil else {
            return
        }
        clearMotion()
        let breathe = SKAction.sequence([
            .scaleY(to: 1.02, duration: 1.7),
            .scaleY(to: 1.0, duration: 1.7),
        ])
        breathe.timingMode = .easeInEaseOut
        sprite.run(.repeatForever(breathe), withKey: "breathing")
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
