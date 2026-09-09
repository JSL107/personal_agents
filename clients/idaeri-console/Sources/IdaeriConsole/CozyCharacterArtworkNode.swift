import AppKit
import ConsoleCore
import SpriteKit

/// A deterministic, vector-like coworker illustration used by the office scene.
final class CozyCharacterArtworkNode: SKNode {
    static let officeScaleFactor: CGFloat = 0.56
    private struct CacheKey: Hashable {
        let appearance: [Int]
        let mood: String
        let department: String
        let state: String
        let pose: String
    }

    private static var cache: [CacheKey: SKNode] = [:]
    func update(
        appearance: CozyAgentAppearance,
        mood: CozyAgentMood,
        department: Department,
        state: ConsoleAgentState,
        pose: String
    ) {
        removeAllChildren()
        let normalizedPose = Self.normalizedPose(pose)
        let key = CacheKey(
            appearance: [appearance.headShapeIndex, appearance.hairStyleIndex, appearance.outfitStyleIndex, appearance.accessoryIndex ?? -1, appearance.paletteIndex],
            mood: String(describing: mood), department: department.rawValue, state: state.rawValue, pose: normalizedPose
        )
        let artwork = Self.cache[key] ?? makeArtwork(
            appearance: appearance, mood: mood, department: department, state: state, pose: normalizedPose
        )
        if Self.cache[key] == nil {
            Self.cache[key] = artwork.copy() as? SKNode
        }
        addChild(artwork.copy() as? SKNode ?? artwork)
    }

    private static func normalizedPose(_ pose: String) -> String {
        switch pose.lowercased() {
        case "down", "up", "left", "right", "sit", "sitting", "reading", "drinking", "writing", "carryingpapers", "tending", "stowing", "default", "idle":
            return pose.lowercased()
        default:
            return pose.lowercased().contains("walk") ? "walk" : "idle"
        }
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
        pose: String
    ) -> SKNode {
        let root = SKNode()
        let outline = SKColor(red: 0.38, green: 0.29, blue: 0.24, alpha: 1)
        let skin = SKColor(red: 1.00, green: 0.93, blue: 0.82, alpha: 1)
        let hair = hairColor(index: appearance.hairStyleIndex)
        let outfitRGB = Self.outfitColorRGB(index: appearance.paletteIndex)
        let outfit = SKColor(red: outfitRGB.red, green: outfitRGB.green, blue: outfitRGB.blue, alpha: 1)
        let ink = SKColor(red: 0.30, green: 0.22, blue: 0.18, alpha: 1)

        let shadow = SKShapeNode(ellipseOf: CGSize(width: 42, height: 10))
        shadow.position = CGPoint(x: 0, y: 4)
        shadow.fillColor = SKColor.black.withAlphaComponent(0.14)
        shadow.strokeColor = .clear
        root.addChild(shadow)

        let sitting = pose.lowercased().contains("sit")
        let body = SKShapeNode(rectOf: CGSize(width: sitting ? 42 : 38, height: sitting ? 32 : 40), cornerRadius: 11)
        body.position = CGPoint(x: 0, y: sitting ? 25 : 29)
        body.fillColor = outfit
        body.strokeColor = outline
        body.lineWidth = 1.25
        root.addChild(body)
        addOutfitDetail(to: root, style: appearance.outfitStyleIndex, color: outfit, outline: outline, sitting: sitting)

        addLimb(to: root, at: CGPoint(x: -14, y: 30), size: CGSize(width: 9, height: 27), color: outfit, outline: outline, angle: poseAngle(pose, side: -1))
        addLimb(to: root, at: CGPoint(x: 14, y: 30), size: CGSize(width: 9, height: 27), color: outfit, outline: outline, angle: poseAngle(pose, side: 1))
        addLimb(to: root, at: CGPoint(x: -9, y: 9), size: CGSize(width: 10, height: 18), color: pantsColor(index: appearance.outfitStyleIndex), outline: outline, angle: poseAngle(pose, side: -1) * 0.5)
        addLimb(to: root, at: CGPoint(x: 9, y: 9), size: CGSize(width: 10, height: 18), color: pantsColor(index: appearance.outfitStyleIndex), outline: outline, angle: poseAngle(pose, side: 1) * 0.5)

        let ears = SKShapeNode(ellipseOf: CGSize(width: 13, height: 17))
        ears.position = CGPoint(x: 0, y: 70)
        ears.fillColor = skin
        ears.strokeColor = outline
        ears.lineWidth = 1.25
        root.addChild(ears)

        let headWidth: CGFloat = [42, 46, 49][positiveIndex(appearance.headShapeIndex, count: 3)]
        let head = SKShapeNode(ellipseOf: CGSize(width: headWidth, height: 44))
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
        let hair = SKShapeNode(rectOf: CGSize(width: widths[normalizedStyle], height: heights[normalizedStyle]), cornerRadius: normalizedStyle == 5 ? 4 : 9)
        hair.position = CGPoint(x: 0, y: 88)
        hair.fillColor = color
        hair.strokeColor = outline
        hair.lineWidth = 1.25
        root.addChild(hair)
        if normalizedStyle >= 4 {
            let fringe = SKShapeNode(ellipseOf: CGSize(width: 15, height: 10))
            fringe.position = CGPoint(x: style.isMultiple(of: 2) ? -12 : 12, y: 80)
            fringe.fillColor = color
            fringe.strokeColor = outline
            fringe.lineWidth = 1.0
            root.addChild(fringe)
        }
    }

    private func addFace(to root: SKNode, mood: CozyAgentMood, ink: SKColor) {
        switch mood {
        case .happy:
            for x in [-8.0, 8.0] { let eye = SKShapeNode(ellipseOf: CGSize(width: 5, height: 2)); eye.position = CGPoint(x: x, y: 70); eye.fillColor = ink; eye.strokeColor = .clear; root.addChild(eye) }
            let smile = SKShapeNode(ellipseOf: CGSize(width: 10, height: 4)); smile.position = CGPoint(x: 0, y: 61); smile.fillColor = ink; smile.strokeColor = ink; root.addChild(smile)
        case .focused:
            for x in [-8.0, 8.0] { let eye = SKShapeNode(ellipseOf: CGSize(width: 3, height: 3)); eye.position = CGPoint(x: x, y: 68); eye.fillColor = ink; eye.strokeColor = .clear; root.addChild(eye) }
            addBrow(to: root, x: -8, angle: -0.22, ink: ink); addBrow(to: root, x: 8, angle: 0.22, ink: ink)
            let mouth = SKShapeNode(rectOf: CGSize(width: 6, height: 2), cornerRadius: 1); mouth.position = CGPoint(x: 0, y: 61); mouth.fillColor = ink; mouth.strokeColor = .clear; root.addChild(mouth)
        case .waiting:
            for x in [-8.0, 8.0] { let eye = SKShapeNode(rectOf: CGSize(width: 5, height: 2), cornerRadius: 1); eye.position = CGPoint(x: x, y: 70); eye.fillColor = ink; eye.strokeColor = .clear; root.addChild(eye) }
            let mouth = SKShapeNode(rectOf: CGSize(width: 7, height: 2), cornerRadius: 1); mouth.position = CGPoint(x: 0, y: 61); mouth.fillColor = ink; mouth.strokeColor = .clear; root.addChild(mouth)
        case .concerned:
            for x in [-8.0, 8.0] { let eye = SKShapeNode(ellipseOf: CGSize(width: 3, height: 4)); eye.position = CGPoint(x: x, y: 70); eye.fillColor = ink; eye.strokeColor = .clear; root.addChild(eye) }
            addBrow(to: root, x: -8, angle: 0.25, ink: ink); addBrow(to: root, x: 8, angle: -0.25, ink: ink)
            let mouth = SKShapeNode(ellipseOf: CGSize(width: 6, height: 2)); mouth.position = CGPoint(x: 0, y: 61); mouth.fillColor = SKColor(red: 0.96, green: 0.62, blue: 0.45, alpha: 1); mouth.strokeColor = ink; root.addChild(mouth)
        case .calm:
            for x in [-8.0, 8.0] { let eye = SKShapeNode(circleOfRadius: 2); eye.position = CGPoint(x: x, y: 70); eye.fillColor = ink; eye.strokeColor = .clear; root.addChild(eye) }
            let mouth = SKShapeNode(rectOf: CGSize(width: 6, height: 2), cornerRadius: 1); mouth.position = CGPoint(x: 0, y: 61); mouth.fillColor = ink; mouth.strokeColor = .clear; root.addChild(mouth)
        }
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
            if normalized == "default" || normalized == "idle" || normalized == "down" || normalized == "up" || normalized == "left" || normalized == "right" || normalized == "walk" {
                addMug(to: root, outline: outline)
            }
        case .inProgress: addLaptop(to: root, outline: outline)
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
        case "sitting": addSeatCue(to: root, outline: outline)
        case "walk": addWalkCue(to: root, outline: outline)
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
    private func addWalkCue(to root: SKNode, outline: SKColor) { for x in [-10.0, 10.0] { let foot = SKShapeNode(ellipseOf: CGSize(width: 8, height: 3)); foot.position = CGPoint(x: x, y: 4); foot.fillColor = outline; foot.strokeColor = .clear; root.addChild(foot) } }

    private func poseAngle(_ pose: String, side: CGFloat) -> CGFloat {
        let value = pose.lowercased()
        if value.contains("walk") || value.contains("carry") || value.contains("tend") { return side * 0.12 }
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
