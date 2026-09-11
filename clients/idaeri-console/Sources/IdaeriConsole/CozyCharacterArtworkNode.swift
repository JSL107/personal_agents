import AppKit
import ConsoleCore
import SpriteKit

/// A deterministic, vector-like coworker illustration used by the office scene.
final class CozyCharacterArtworkNode: SKNode {
    // Generated mascots should stay more prominent than the former pixel sprites,
    // but still fit inside a department room without covering desks or labels.
    static let officeScaleFactor: CGFloat = 0.72

    /// 아트워크 좌표에서 **발이 놓이는 높이**. 원점이 아니라 이만큼 위에 세워 발밑에 그림자
    /// 자리를 남긴다. 바깥에서 접지 그림자를 대신 그리는 쪽(`CharacterNode`)이 같은 값을
    /// 봐야 그림자가 발보다 아래로 처지지 않는다.
    static let groundContactInset: CGFloat = 5
    private struct CacheKey: Hashable {
        let appearance: [Int]
        let mood: String
        let department: String
        let state: String
        let pose: String
        /// 앉아야 하는 자리에 선 그림을 줄여 쓰는 경우. 봉투 크기가 달라 같은 그림이라도 캐시가 갈린다.
        let seatedFallback: Bool
    }

    private static var cache: [CacheKey: SKNode] = [:]

    /// 몸 그림을 담는 그릇. 접지 그림자와 분리해 둬야 그림자가 몸의 세로 움직임을 따라가지 않는다.
    private let artworkContainer = SKNode()

    /// 발밑 접지 그림자.
    ///
    /// **몸이 아니라 노드 자신에게 붙인다.** 예전에는 캐릭터 그림과 한 덩어리라, 걸음 bob·
    /// 발 구르기·완료 점프로 몸이 뜰 때마다 그림자가 같이 떠올랐다 — 발이 땅을 딛는 신호가
    /// 사라져 "걷는다" 가 아니라 "스티커가 통통 튄다" 로 읽힌 원인 중 하나다. 여기 두면
    /// 몸만 오르내리고 그림자는 바닥에 남는다.
    ///
    /// 사무실 캐릭터(`CharacterNode`)는 타일 크기에 맞춘 자기 그림자를 이미 그리므로 그쪽에서
    /// 끈다(`groundShadowIsHidden`). 대표처럼 이 노드만 쓰는 자리에서는 이 그림자가 유일한
    /// 접지 신호다.
    private let groundShadow = SKShapeNode(ellipseOf: CGSize(width: 42, height: 9))

    /// 마지막으로 화면에 올린 조합. 같은 그림을 걸음마다 다시 굽지 않기 위한 것 —
    /// 한 칸 옮길 때마다 `removeAllChildren` + 노드 복제가 도는 것은 순수 낭비였다.
    private var appliedKey: CacheKey?

    override init() {
        super.init()
        groundShadow.position = CGPoint(x: 0, y: Self.groundContactInset)
        groundShadow.fillColor = SKColor.black.withAlphaComponent(0.14)
        groundShadow.strokeColor = .clear
        groundShadow.zPosition = -1
        addChild(groundShadow)
        addChild(artworkContainer)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not supported")
    }

    var groundShadowIsHidden: Bool {
        get { groundShadow.isHidden }
        set { groundShadow.isHidden = newValue }
    }

    func update(
        appearance: CozyAgentAppearance,
        mood: CozyAgentMood,
        department: Department,
        state: ConsoleAgentState,
        pose: String
    ) {
        // 요청 포즈를 실재하는 에셋으로 옮기는 유일한 지점. 여기를 지난 뒤로는 "없는 그림"이
        // 없으므로 아래 어디에서도 다시 대체를 고민하지 않는다.
        let resolved = SpriteLoader.resolvedCozyPose(assetIndex: appearance.assetIndex, pose: pose)
        // 앉아야 하는 요청인데 선 그림밖에 없는 경우에만 봉투를 줄인다(아래 `makeArtwork`).
        // 지금 에셋은 스무 명 전원이 `sit` 을 가져 이 경우가 없지만, 에셋을 갈아끼웠을 때
        // 책상 위에 올라선 사람이 조용히 생기지 않도록 조건은 남긴다.
        let seatedFallback = normalizedCozyPose(pose) == "sit" && resolved.posture == .standing
        let key = CacheKey(
            appearance: [appearance.assetIndex, appearance.headShapeIndex, appearance.hairStyleIndex, appearance.outfitStyleIndex, appearance.accessoryIndex ?? -1, appearance.paletteIndex],
            mood: String(describing: mood), department: department.rawValue, state: state.rawValue,
            pose: resolved.pose, seatedFallback: seatedFallback
        )
        guard appliedKey != key else {
            return
        }
        appliedKey = key
        artworkContainer.removeAllChildren()
        let artwork = Self.cache[key] ?? makeArtwork(
            appearance: appearance, mood: mood, department: department, state: state,
            pose: resolved.pose, seatedFallback: seatedFallback
        )
        if Self.cache[key] == nil {
            Self.cache[key] = artwork.copy() as? SKNode
        }
        artworkContainer.addChild(artwork.copy() as? SKNode ?? artwork)
    }

    func update(
        appearance: CozyAgentAppearance,
        mood: CozyAgentMood,
        department: Department,
        state: ConsoleAgentState,
        pose: OfficeInteractionPose
    ) {
        update(appearance: appearance, mood: mood, department: department, state: state, pose: pose.rawValue)
    }

    func setReferenceScale(_ scale: CGFloat) {
        xScale = scale
        yScale = scale
    }

    private func makeArtwork(
        appearance: CozyAgentAppearance,
        mood: CozyAgentMood,
        department: Department,
        state: ConsoleAgentState,
        pose: String,
        seatedFallback: Bool
    ) -> SKNode {
        let root = SKNode()
        let outline = SKColor(red: 0.38, green: 0.29, blue: 0.24, alpha: 1)

        if let texture = SpriteLoader.cozyCharacterTexture(
            assetIndex: appearance.assetIndex,
            pose: pose
        ) {
            let sprite = SKSpriteNode(texture: texture)
            let textureSize = texture.size()
            let usesIdleAsSeatedFallback = seatedFallback
            // The source sheets are tall full-body illustrations. Limit their
            // height to the compact office mascot envelope so they do not
            // tower over desks and overhead labels at room scale.
            // Until a dedicated seated render exists, compress only the idle
            // fallback used behind a desk. Keeping the standing asset at full
            // height makes it look as though the employee is standing on the
            // keyboard even when the desk correctly occludes the lower body.
            let maximumWidth: CGFloat = usesIdleAsSeatedFallback ? 88 : 96
            let maximumHeight: CGFloat = usesIdleAsSeatedFallback ? 88 : 100
            let visualScale = cozyCharacterVisualScale(assetIndex: appearance.assetIndex)
            let heightScale = maximumHeight * visualScale / max(textureSize.height, 1)
            let scale = min(heightScale, maximumWidth * visualScale / max(textureSize.width, 1))
            sprite.size = CGSize(width: textureSize.width * scale, height: textureSize.height * scale)
            // Place the actual feet on the same baseline as the shared shadow.
            sprite.position = CGPoint(x: 0, y: Self.groundContactInset + sprite.size.height / 2)
            sprite.texture?.filteringMode = .linear
            // Pick up a trace of the honey-colored room bounce so the transparent cutout reads as
            // part of the same lit diorama rather than a sticker placed over the shell.
            sprite.color = SKColor(red: 1.0, green: 0.86, blue: 0.72, alpha: 1)
            sprite.colorBlendFactor = 0.035
            root.addChild(sprite)
            // Generated characters already carry pose-specific hand props. The old vector badge
            // looked like a pixel icon pasted beside a 3D mascot and duplicated the status ring.
            return root
        }
        let skin = SKColor(red: 1.00, green: 0.93, blue: 0.82, alpha: 1)
        let hair = hairColor(index: appearance.hairStyleIndex)
        let outfitRGB = Self.outfitColorRGB(index: appearance.paletteIndex)
        let outfit = SKColor(red: outfitRGB.red, green: outfitRGB.green, blue: outfitRGB.blue, alpha: 1)
        let ink = SKColor(red: 0.30, green: 0.22, blue: 0.18, alpha: 1)

        let sitting = pose.lowercased().contains("sit")
        let body = SKShapeNode(rectOf: CGSize(width: sitting ? 39 : 35, height: sitting ? 31 : 34), cornerRadius: 13)
        body.position = CGPoint(x: 0, y: sitting ? 27 : 29)
        body.fillColor = outfit
        body.strokeColor = outline
        body.lineWidth = 1.15
        root.addChild(body)
        addOutfitDetail(to: root, style: appearance.outfitStyleIndex, color: outfit, outline: outline, sitting: sitting)

        // Skin arms and tiny hands are intentionally shorter and wider than
        // the old long bars; that is the key chibi proportion in the draft.
        addArm(to: root, side: -1, pose: pose, skin: skin, outline: outline)
        addArm(to: root, side: 1, pose: pose, skin: skin, outline: outline)
        addLimb(to: root, at: CGPoint(x: -8, y: 10), size: CGSize(width: 9, height: 16), color: pantsColor(index: appearance.outfitStyleIndex), outline: outline, angle: poseAngle(pose, side: -1) * 0.5)
        addLimb(to: root, at: CGPoint(x: 8, y: 10), size: CGSize(width: 9, height: 16), color: pantsColor(index: appearance.outfitStyleIndex), outline: outline, angle: poseAngle(pose, side: 1) * 0.5)
        addShoes(to: root, outline: outline)

        let ears = SKShapeNode(ellipseOf: CGSize(width: 13, height: 17))
        ears.position = CGPoint(x: 0, y: 70)
        ears.fillColor = skin
        ears.strokeColor = outline
        ears.lineWidth = 1.25
        root.addChild(ears)

        let headWidth: CGFloat = [42, 46, 49][positiveIndex(appearance.headShapeIndex, count: 3)]
        let head = SKShapeNode(ellipseOf: CGSize(width: headWidth, height: 46))
        head.position = CGPoint(x: 0, y: 70)
        head.fillColor = skin
        head.strokeColor = outline
        head.lineWidth = 1.25
        root.addChild(head)

        addHair(to: root, style: appearance.hairStyleIndex, color: hair, outline: outline)
        addFace(to: root, mood: mood, ink: ink)
        addAccessory(to: root, index: appearance.accessoryIndex, outline: outline)
        addStateProp(to: root, pose: pose, state: state, outline: outline)
        return root
    }

    private func addLimb(to root: SKNode, at position: CGPoint, size: CGSize, color: SKColor, outline: SKColor, angle: CGFloat) {
        let limb = SKShapeNode(rectOf: size, cornerRadius: size.width / 2)
        limb.position = position
        limb.zRotation = angle
        limb.fillColor = color
        limb.strokeColor = outline
        limb.lineWidth = 1.2
        root.addChild(limb)
    }

    private func addArm(to root: SKNode, side: CGFloat, pose: String, skin: SKColor, outline: SKColor) {
        let arm = SKShapeNode(ellipseOf: CGSize(width: 10, height: 24))
        arm.position = CGPoint(x: side * 18, y: 29)
        arm.zRotation = poseAngle(pose, side: side) * 0.7
        arm.fillColor = skin
        arm.strokeColor = outline
        arm.lineWidth = 1.15
        root.addChild(arm)
        let hand = SKShapeNode(circleOfRadius: 5.2)
        hand.position = CGPoint(x: side * 18, y: 17)
        hand.fillColor = skin
        hand.strokeColor = outline
        hand.lineWidth = 1.0
        root.addChild(hand)
    }

    private func addShoes(to root: SKNode, outline: SKColor) {
        for side in [-1.0, 1.0] {
            let shoe = SKShapeNode(ellipseOf: CGSize(width: 13, height: 6))
            shoe.position = CGPoint(x: side * 8, y: 5)
            shoe.fillColor = SKColor(red: 0.28, green: 0.24, blue: 0.24, alpha: 1)
            shoe.strokeColor = outline
            shoe.lineWidth = 1.0
            root.addChild(shoe)
        }
    }

    private func addOutfitDetail(to root: SKNode, style: Int, color: SKColor, outline: SKColor, sitting: Bool) {
        let y = sitting ? 27 : 32
        switch positiveIndex(style, count: 6) {
        case 0:
            let detail = SKShapeNode(rectOf: CGSize(width: 12, height: 3), cornerRadius: 1.5); detail.position = CGPoint(x: 0, y: y); detail.fillColor = SKColor.white.withAlphaComponent(0.6); detail.strokeColor = .clear; root.addChild(detail)
        case 1:
            let detail = SKShapeNode(circleOfRadius: 3); detail.position = CGPoint(x: 0, y: y); detail.fillColor = color; detail.strokeColor = outline; detail.lineWidth = 1; root.addChild(detail)
        case 2:
            let detail = SKShapeNode(rectOf: CGSize(width: 15, height: 2), cornerRadius: 1); detail.position = CGPoint(x: 0, y: y - 5); detail.zRotation = -0.2; detail.fillColor = SKColor.white.withAlphaComponent(0.5); detail.strokeColor = .clear; root.addChild(detail)
        case 3:
            let detail = SKShapeNode(rectOf: CGSize(width: 6, height: 10), cornerRadius: 1); detail.position = CGPoint(x: 0, y: y); detail.fillColor = SKColor(red: 0.96, green: 0.80, blue: 0.42, alpha: 1); detail.strokeColor = outline; detail.lineWidth = 1; root.addChild(detail)
        case 4:
            let detail = SKShapeNode(rectOf: CGSize(width: 22, height: 2), cornerRadius: 1); detail.position = CGPoint(x: 0, y: y - 8); detail.fillColor = SKColor(red: 0.96, green: 0.62, blue: 0.45, alpha: 1); detail.strokeColor = .clear; root.addChild(detail)
        default:
            let detail = SKShapeNode(circleOfRadius: 4); detail.position = CGPoint(x: 0, y: y + 7); detail.fillColor = SKColor(red: 1, green: 0.93, blue: 0.82, alpha: 1); detail.strokeColor = outline; detail.lineWidth = 1; root.addChild(detail)
        }
    }

    private func addHair(to root: SKNode, style: Int, color: SKColor, outline: SKColor) {
        let normalizedStyle = positiveIndex(style, count: 8)
        let widths: [CGFloat] = [43, 39, 47, 42, 36, 50, 44, 40]
        let heights: [CGFloat] = [19, 15, 22, 17, 13, 24, 18, 20]
        let hair = SKShapeNode(ellipseOf: CGSize(width: widths[normalizedStyle] + 3, height: heights[normalizedStyle] + 6))
        hair.position = CGPoint(x: 0, y: 88)
        hair.fillColor = color
        hair.strokeColor = outline
        hair.lineWidth = 1.15
        root.addChild(hair)
        // Layered fringe/side locks make each deterministic appearance feel
        // like the rounded illustrated draft instead of a single block.
        let fringeSide: CGFloat = style.isMultiple(of: 2) ? -1 : 1
        for (x, y, width, height) in [
            (fringeSide * 11, CGFloat(81), CGFloat(16), CGFloat(12)),
            (-fringeSide * 10, CGFloat(82), CGFloat(13), CGFloat(10)),
            (fringeSide * 17, CGFloat(76), CGFloat(9), CGFloat(17))
        ] {
            let lock = SKShapeNode(ellipseOf: CGSize(width: width, height: height))
            lock.position = CGPoint(x: x, y: y)
            lock.fillColor = color
            lock.strokeColor = outline
            lock.lineWidth = 0.9
            root.addChild(lock)
        }
        let highlight = SKShapeNode(ellipseOf: CGSize(width: 9, height: 3))
        highlight.position = CGPoint(x: -10, y: 93)
        highlight.fillColor = SKColor.white.withAlphaComponent(0.16)
        highlight.strokeColor = .clear
        root.addChild(highlight)
    }

    private func addFace(to root: SKNode, mood: CozyAgentMood, ink: SKColor) {
        // Large dark eyes with tiny white catches are the most important face
        // cue in the reference. Blush stays subtle so state colors remain the
        // primary operational signal.
        for x in [-8.0, 8.0] {
            let blush = SKShapeNode(ellipseOf: CGSize(width: 8, height: 3))
            blush.position = CGPoint(x: x * 1.55, y: 62)
            blush.fillColor = SKColor(red: 1, green: 0.55, blue: 0.48, alpha: 0.22)
            blush.strokeColor = .clear
            root.addChild(blush)
        }
        switch mood {
        case .happy:
            for x in [-8.0, 8.0] { addGlossyEye(to: root, x: x, y: 70, ink: ink, height: 8) }
            let smile = SKShapeNode(ellipseOf: CGSize(width: 10, height: 5)); smile.position = CGPoint(x: 0, y: 60); smile.fillColor = SKColor(red: 0.84, green: 0.35, blue: 0.33, alpha: 1); smile.strokeColor = ink; smile.lineWidth = 0.8; root.addChild(smile)
        case .focused:
            for x in [-8.0, 8.0] { addGlossyEye(to: root, x: x, y: 69, ink: ink, height: 7) }
            addBrow(to: root, x: -8, angle: -0.22, ink: ink); addBrow(to: root, x: 8, angle: 0.22, ink: ink)
            let mouth = SKShapeNode(rectOf: CGSize(width: 6, height: 2), cornerRadius: 1); mouth.position = CGPoint(x: 0, y: 61); mouth.fillColor = ink; mouth.strokeColor = .clear; root.addChild(mouth)
        case .waiting:
            for x in [-8.0, 8.0] { addGlossyEye(to: root, x: x, y: 70, ink: ink, height: 7) }
            let mouth = SKShapeNode(rectOf: CGSize(width: 7, height: 2), cornerRadius: 1); mouth.position = CGPoint(x: 0, y: 61); mouth.fillColor = ink; mouth.strokeColor = .clear; root.addChild(mouth)
        case .concerned:
            for x in [-8.0, 8.0] { addGlossyEye(to: root, x: x, y: 70, ink: ink, height: 8) }
            addBrow(to: root, x: -8, angle: 0.25, ink: ink); addBrow(to: root, x: 8, angle: -0.25, ink: ink)
            let mouth = SKShapeNode(ellipseOf: CGSize(width: 6, height: 2)); mouth.position = CGPoint(x: 0, y: 61); mouth.fillColor = SKColor(red: 0.96, green: 0.62, blue: 0.45, alpha: 1); mouth.strokeColor = ink; root.addChild(mouth)
        case .calm:
            for x in [-8.0, 8.0] { addGlossyEye(to: root, x: x, y: 70, ink: ink, height: 7) }
            let mouth = SKShapeNode(rectOf: CGSize(width: 6, height: 2), cornerRadius: 1); mouth.position = CGPoint(x: 0, y: 61); mouth.fillColor = ink; mouth.strokeColor = .clear; root.addChild(mouth)
        }
    }

    private func addGlossyEye(to root: SKNode, x: CGFloat, y: CGFloat, ink: SKColor, height: CGFloat) {
        let eye = SKShapeNode(ellipseOf: CGSize(width: 6, height: height))
        eye.position = CGPoint(x: x, y: y)
        eye.fillColor = ink
        eye.strokeColor = .clear
        root.addChild(eye)
        let gloss = SKShapeNode(circleOfRadius: 1.35)
        gloss.position = CGPoint(x: x - 1.3, y: y + height * 0.22)
        gloss.fillColor = .white
        gloss.strokeColor = .clear
        root.addChild(gloss)
    }

    private func addBrow(to root: SKNode, x: CGFloat, angle: CGFloat, ink: SKColor) {
        let brow = SKShapeNode(rectOf: CGSize(width: 7, height: 1.5), cornerRadius: 0.75)
        brow.position = CGPoint(x: x, y: 75); brow.zRotation = angle; brow.fillColor = ink; brow.strokeColor = .clear; root.addChild(brow)
    }

    private func addAccessory(to root: SKNode, index: Int?, outline: SKColor) {
        guard let index else { return }
        switch positiveIndex(index, count: 4) {
        case 0:
            for x in [-8.0, 8.0] {
                let lens = SKShapeNode(circleOfRadius: 5.5)
                lens.position = CGPoint(x: x, y: 70)
                lens.fillColor = .clear; lens.strokeColor = outline; lens.lineWidth = 1.1; root.addChild(lens)
            }
        case 1:
            let hat = SKShapeNode(rectOf: CGSize(width: 9, height: 5), cornerRadius: 2)
            hat.position = CGPoint(x: 0, y: 96); hat.fillColor = SKColor(red: 0.96, green: 0.80, blue: 0.42, alpha: 1); hat.strokeColor = outline; hat.lineWidth = 1.1; root.addChild(hat)
        case 2:
            let pin = SKShapeNode(circleOfRadius: 4.5)
            pin.position = CGPoint(x: 20, y: 58); pin.fillColor = SKColor(red: 0.96, green: 0.62, blue: 0.45, alpha: 1); pin.strokeColor = outline; pin.lineWidth = 1.1; root.addChild(pin)
        default:
            let scarf = SKShapeNode(rectOf: CGSize(width: 13, height: 3), cornerRadius: 1.5)
            scarf.position = CGPoint(x: 0, y: 57); scarf.fillColor = SKColor(red: 0.49, green: 0.70, blue: 0.83, alpha: 1); scarf.strokeColor = outline; scarf.lineWidth = 1.1; root.addChild(scarf)
        }
    }

    private func addStateProp(to root: SKNode, pose: String, state: ConsoleAgentState, outline: SKColor) {
        let normalized = pose.lowercased()
        switch state {
        case .waiting:
            // 포즈 계약을 지난 이름만 들어온다 — 방향·걸음 이름은 전부 `idle` 로 접힌다.
            if normalized == cozyIdlePose {
                addMug(to: root, outline: outline)
            }
        case .inProgress:
            // Desk interactions already render a full 2.5D workstation. A second flat laptop
            // badge across the torso breaks the shared perspective and can cover the face of the
            // lowered seated fallback.
            if !["sit", "writing", "reading"].contains(normalized) {
                addLaptop(to: root, outline: outline)
            }
        case .awaitingApproval: addDocument(to: root, x: -25, y: 40, outline: outline)
        case .awaitingIntegration: addLinkedNodes(to: root, outline: outline)
        case .completed: addCheck(to: root, outline: outline)
        case .failed: addDocument(to: root, x: 25, y: 39, outline: outline); addExclamation(to: root, outline: outline)
        }
        switch normalized {
        case "reading": addBook(to: root, outline: outline)
        case "drinking": addMug(to: root, outline: outline)
        case "writing": addWritingLine(to: root, outline: outline)
        case "carryingpapers": addPaperStack(to: root, outline: outline)
        case "tending": addLeaf(to: root, outline: outline)
        case "stowing": addBox(to: root, outline: outline)
        case "sit": addSeatCue(to: root, outline: outline)
        default: break
        }
    }

    private func addMug(to root: SKNode, outline: SKColor) { let mug = SKShapeNode(rectOf: CGSize(width: 9, height: 11), cornerRadius: 2); mug.position = CGPoint(x: 25, y: 38); mug.fillColor = SKColor(red: 0.96, green: 0.80, blue: 0.42, alpha: 1); mug.strokeColor = outline; mug.lineWidth = 1.1; root.addChild(mug) }
    private func addBook(to root: SKNode, outline: SKColor) { let book = SKShapeNode(rectOf: CGSize(width: 15, height: 8), cornerRadius: 1); book.position = CGPoint(x: 22, y: 37); book.fillColor = SKColor(red: 1, green: 0.98, blue: 0.94, alpha: 1); book.strokeColor = outline; book.lineWidth = 1.1; root.addChild(book) }
    private func addLaptop(to root: SKNode, outline: SKColor) { let laptop = SKShapeNode(rectOf: CGSize(width: 19, height: 9), cornerRadius: 2); laptop.position = CGPoint(x: 0, y: 31); laptop.fillColor = SKColor(red: 0.49, green: 0.70, blue: 0.83, alpha: 1); laptop.strokeColor = outline; laptop.lineWidth = 1.1; root.addChild(laptop) }
    private func addDocument(to root: SKNode, x: CGFloat, y: CGFloat, outline: SKColor) { let doc = SKShapeNode(rectOf: CGSize(width: 12, height: 15), cornerRadius: 2); doc.position = CGPoint(x: x, y: y); doc.fillColor = SKColor(red: 1, green: 0.98, blue: 0.94, alpha: 1); doc.strokeColor = outline; doc.lineWidth = 1.1; root.addChild(doc) }
    private func addLinkedNodes(to root: SKNode, outline: SKColor) { let line = SKShapeNode(rectOf: CGSize(width: 13, height: 1)); line.position = CGPoint(x: 24, y: 42); line.zRotation = 0.5; line.fillColor = outline; line.strokeColor = .clear; root.addChild(line); for (x, color) in [(20.0, SKColor(red: 0.68, green: 0.58, blue: 0.82, alpha: 1)), (29.0, SKColor(red: 0.49, green: 0.70, blue: 0.83, alpha: 1))] { let node = SKShapeNode(circleOfRadius: 4); node.position = CGPoint(x: x, y: x == 20 ? 39 : 46); node.fillColor = color; node.strokeColor = outline; node.lineWidth = 1; root.addChild(node) } }
    private func addCheck(to root: SKNode, outline: SKColor) { let check = SKShapeNode(rectOf: CGSize(width: 12, height: 3), cornerRadius: 1); check.position = CGPoint(x: 23, y: 49); check.fillColor = SKColor(red: 0.55, green: 0.72, blue: 0.55, alpha: 1); check.strokeColor = outline; check.lineWidth = 1; root.addChild(check) }
    private func addExclamation(to root: SKNode, outline: SKColor) { let mark = SKShapeNode(rectOf: CGSize(width: 3, height: 10), cornerRadius: 1); mark.position = CGPoint(x: 29, y: 43); mark.fillColor = SKColor(red: 0.96, green: 0.62, blue: 0.45, alpha: 1); mark.strokeColor = outline; mark.lineWidth = 1; root.addChild(mark) }
    private func addWritingLine(to root: SKNode, outline: SKColor) { let line = SKShapeNode(rectOf: CGSize(width: 18, height: 2), cornerRadius: 1); line.position = CGPoint(x: 0, y: 23); line.fillColor = outline; line.strokeColor = .clear; root.addChild(line) }
    private func addPaperStack(to root: SKNode, outline: SKColor) { let paper = SKShapeNode(rectOf: CGSize(width: 13, height: 11), cornerRadius: 1); paper.position = CGPoint(x: -23, y: 34); paper.fillColor = .white; paper.strokeColor = outline; paper.lineWidth = 1; root.addChild(paper) }
    private func addLeaf(to root: SKNode, outline: SKColor) { let leaf = SKShapeNode(ellipseOf: CGSize(width: 10, height: 5)); leaf.position = CGPoint(x: 25, y: 36); leaf.fillColor = SKColor(red: 0.55, green: 0.72, blue: 0.55, alpha: 1); leaf.strokeColor = outline; leaf.lineWidth = 1; root.addChild(leaf) }
    private func addBox(to root: SKNode, outline: SKColor) { let box = SKShapeNode(rectOf: CGSize(width: 12, height: 10), cornerRadius: 1); box.position = CGPoint(x: -24, y: 24); box.fillColor = SKColor(red: 0.82, green: 0.67, blue: 0.53, alpha: 1); box.strokeColor = outline; box.lineWidth = 1; root.addChild(box) }
    private func addSeatCue(to root: SKNode, outline: SKColor) { let seat = SKShapeNode(rectOf: CGSize(width: 23, height: 4), cornerRadius: 2); seat.position = CGPoint(x: 0, y: 8); seat.fillColor = outline; seat.strokeColor = .clear; root.addChild(seat) }

    private func poseAngle(_ pose: String, side: CGFloat) -> CGFloat {
        let value = pose.lowercased()
        if value.contains("carry") || value.contains("tend") { return side * 0.12 }
        if value.contains("write") || value.contains("read") || value.contains("drink") { return side * 0.2 }
        return 0
    }

    private func hairColor(index: Int) -> SKColor {
        let colors: [SKColor] = [SKColor(red: 0.24, green: 0.17, blue: 0.14, alpha: 1), SKColor(red: 0.12, green: 0.10, blue: 0.09, alpha: 1), SKColor(red: 0.42, green: 0.25, blue: 0.14, alpha: 1), SKColor(red: 0.58, green: 0.31, blue: 0.18, alpha: 1)]
        return colors[positiveIndex(index, count: colors.count)]
    }

    private func pantsColor(index: Int) -> SKColor {
        let colors: [SKColor] = [SKColor(red: 0.20, green: 0.18, blue: 0.22, alpha: 1), SKColor(red: 0.18, green: 0.25, blue: 0.34, alpha: 1), SKColor(red: 0.30, green: 0.22, blue: 0.18, alpha: 1)]
        return colors[positiveIndex(index, count: colors.count)]
    }

    /// The shirt colour used by the vector artwork. Keeping the RGB source here
    /// lets diagnostics measure the same rendered token without depending on
    /// the retired `char-*` sprite sheets.
    static func outfitColorRGB(index: Int) -> (red: CGFloat, green: CGFloat, blue: CGFloat) {
        let normalizedIndex = ((index % 6) + 6) % 6
        switch normalizedIndex {
        case 0: return (0.96, 0.62, 0.45)
        case 1: return (0.55, 0.72, 0.55)
        case 2: return (0.68, 0.58, 0.82)
        case 3: return (0.96, 0.80, 0.42)
        case 4: return (0.49, 0.70, 0.83)
        default: return (0.82, 0.67, 0.53)
        }
    }

    private func positiveIndex(_ value: Int, count: Int) -> Int {
        let remainder = value % count
        return remainder >= 0 ? remainder : remainder + count
    }
}
