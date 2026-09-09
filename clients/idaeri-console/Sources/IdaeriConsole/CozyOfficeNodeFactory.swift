import AppKit
import ConsoleCore
import SpriteKit

/// Presentation-only nodes for the office.  Nothing produced here participates in the plan,
/// collision, or path finding; the factory exists to keep the visual treatment out of OfficeScene.
enum CozyOfficeNodeFactory {
    static let outline = SKColor(red: 0.28, green: 0.20, blue: 0.14, alpha: 0.82)
    static let cream = SKColor(red: 0.93, green: 0.87, blue: 0.75, alpha: 0.96)
    static let walkway = SKColor(red: 0.76, green: 0.68, blue: 0.54, alpha: 0.035)

    static func accent(for department: Department) -> SKColor {
        let color = agentDepartmentPaletteRGBA(department)
        return SKColor(red: color.red, green: color.green, blue: color.blue, alpha: 1)
    }

    static func roundedIsland(size: CGSize, accent: SKColor) -> SKShapeNode {
        let node = SKShapeNode(rectOf: size, cornerRadius: min(size.width, size.height) * 0.08)
        node.fillColor = cream
        node.strokeColor = accent.withAlphaComponent(0.48)
        node.lineWidth = max(1, min(size.width, size.height) * 0.018)
        node.zPosition = 1
        return node
    }

    static func rug(size: CGSize, accent: SKColor) -> SKShapeNode {
        let node = SKShapeNode(rectOf: size, cornerRadius: min(size.width, size.height) * 0.16)
        node.fillColor = accent.withAlphaComponent(0.16)
        node.strokeColor = accent.withAlphaComponent(0.34)
        node.lineWidth = max(1, min(size.width, size.height) * 0.025)
        return node
    }

    static func walkway(size: CGSize) -> SKShapeNode {
        let node = SKShapeNode(rectOf: size, cornerRadius: min(size.width, size.height) * 0.18)
        node.fillColor = Self.walkway
        node.strokeColor = .clear
        node.zPosition = 0.8
        return node
    }

    static func furniture(texture: SKTexture, kind: FurnitureKind, scale: CGFloat, tileSize: CGFloat = 32, visible: Bool = true) -> SKSpriteNode {
        // Keep a transparent sprite as the interaction/lookup anchor (OfficeScene stores desks by
        // SKSpriteNode), while the visible object is vector artwork and no longer a pixel inventory.
        let node = SKSpriteNode(color: .clear, size: texture.size())
        // Keep the anchor itself fully opaque so child vector artwork is not multiplied by zero.
        // `SKColor.clear` supplies the invisible interaction surface.
        node.alpha = 1
        node.anchorPoint = CGPoint(x: 0.5, y: 0)
        let naturalWidth = texture.size().width * scale
        let naturalHeight = texture.size().height * scale
        let minimums: (width: CGFloat, height: CGFloat) = {
            switch kind {
            case .desk: return (27, 15)
            case .chairDown, .chairUp: return (14, 12)
            case .sofa2: return (35, 18)
            case .sofa3: return (54, 19)
            case .bookshelf, .wallShelf: return (23, 26)
            case .plantTall: return (11, 28)
            case .plantSmall: return (10, 12)
            case .meetingTable: return (28, 16)
            case .refrigerator, .vendingMachine: return (14, 29)
            case .sinkCounter: return (28, 15)
            case .doorClosed, .doorOpen: return (23, 42)
            default: return (12, 16)
            }
        }()
        let width = max(naturalWidth, minimums.width, tileSize * minimumSize(kind).width)
        let height = max(naturalHeight, minimums.height, tileSize * minimumSize(kind).height)
        let anchor = SKSpriteNode(color: .clear, size: CGSize(width: width, height: height))
        anchor.anchorPoint = CGPoint(x: 0.5, y: 0)
        let shadow = SKShapeNode(ellipseOf: CGSize(width: width * 0.72,
                                                    height: max(1, texture.size().height * scale * 0.10)))
        shadow.fillColor = SKColor(red: 0.23, green: 0.16, blue: 0.11, alpha: 0.16)
        shadow.strokeColor = .clear
        shadow.position = CGPoint(x: 0, y: -max(1, texture.size().height * scale * 0.035))
        shadow.zPosition = -0.1
        anchor.addChild(shadow)
        let hiddenKinds: Set<FurnitureKind> = [.filingCabinet, .lockers2, .partitionLow, .partitionGlass, .printer, .trash]
        if hiddenKinds.contains(kind) || !visible {
            anchor.removeAllChildren()
            return anchor
        }
        let visual: SKNode
        switch kind {
        case .desk:
            let group = SKNode()
            group.addChild(roundedFurniture(width: width * 0.90, height: height * 0.22, fill: SKColor(red: 0.62, green: 0.39, blue: 0.20, alpha: 1)))
            let monitor = roundedFurniture(width: width * 0.28, height: height * 0.30, fill: SKColor(red: 0.22, green: 0.29, blue: 0.32, alpha: 1))
            monitor.position.y = height * 0.30
            monitor.name = "cozy-static-monitor"
            group.addChild(monitor)
            visual = group
        case .chairDown, .chairUp:
            let group = SKNode()
            let seat = roundedFurniture(width: width * 0.72, height: height * 0.24, fill: SKColor(red: 0.39, green: 0.53, blue: 0.43, alpha: 1))
            seat.position.y = height * 0.10
            group.addChild(seat)
            let back = roundedFurniture(width: width * 0.58, height: height * 0.34, fill: SKColor(red: 0.30, green: 0.43, blue: 0.36, alpha: 1))
            back.position.y = height * 0.34
            group.addChild(back)
            visual = group
        case .sofa2, .sofa3:
            let group = SKNode()
            let body = roundedFurniture(width: width * 0.92, height: height * 0.28, fill: SKColor(red: 0.73, green: 0.54, blue: 0.38, alpha: 1))
            body.position.y = height * 0.12
            group.addChild(body)
            let count = kind == .sofa3 ? 3 : 2
            for index in 0..<count {
                let cushion = roundedFurniture(width: width * (kind == .sofa3 ? 0.25 : 0.36), height: height * 0.30, fill: SKColor(red: 0.86, green: 0.68, blue: 0.48, alpha: 1))
                cushion.position = CGPoint(x: (CGFloat(index) - CGFloat(count - 1) / 2) * width * 0.28, y: height * 0.32)
                group.addChild(cushion)
            }
            visual = group
        case .plantTall, .plantSmall, .wallPlantHanging:
            visual = plant(width: width * 0.46, height: max(8, height * 0.72))
        case .bookshelf, .wallShelf:
            visual = bookshelf(width: width * 0.58, height: max(8, height * 0.72))
        case .meetingTable, .coffeeTable:
            visual = roundedFurniture(width: width * 0.82, height: max(6, height * 0.38), fill: SKColor(red: 0.58, green: 0.37, blue: 0.21, alpha: 1))
        case .doorClosed, .doorOpen:
            let door = roundedFurniture(width: width * 0.82, height: height * 0.88, fill: SKColor(red: 0.78, green: 0.57, blue: 0.39, alpha: 1))
            door.name = "doorPanel"
            visual = door
        default:
            visual = roundedFurniture(width: width * 0.72, height: max(5, height * 0.34), fill: SKColor(red: 0.67, green: 0.51, blue: 0.34, alpha: 1))
        }
        visual.position = CGPoint(x: 0, y: height * 0.08)
        visual.zPosition = 0
        anchor.addChild(visual)
        return anchor
    }

    private static func minimumSize(_ kind: FurnitureKind) -> (width: CGFloat, height: CGFloat) {
        switch kind {
        case .desk: return (0.84, 0.48)
        case .chairDown, .chairUp: return (0.42, 0.38)
        case .sofa2: return (1.10, 0.55)
        case .sofa3: return (1.70, 0.58)
        case .bookshelf, .wallShelf: return (0.72, 0.82)
        case .doorClosed, .doorOpen: return (0.70, 1.30)
        default: return (0.38, 0.38)
        }
    }

    private static func roundedFurniture(width: CGFloat, height: CGFloat, fill: SKColor) -> SKShapeNode {
        let node = SKShapeNode(rectOf: CGSize(width: width, height: height), cornerRadius: min(width, height) * 0.18)
        node.fillColor = fill
        node.strokeColor = outline
        node.lineWidth = max(1, min(width, height) * 0.06)
        return node
    }

    private static func plant(width: CGFloat, height: CGFloat) -> SKNode {
        let group = SKNode()
        let pot = roundedFurniture(width: width * 0.52, height: height * 0.22, fill: SKColor(red: 0.67, green: 0.43, blue: 0.27, alpha: 1))
        let crown = SKShapeNode(ellipseOf: CGSize(width: width, height: height * 0.72))
        crown.fillColor = SKColor(red: 0.38, green: 0.57, blue: 0.40, alpha: 1)
        crown.strokeColor = outline
        crown.lineWidth = max(1, width * 0.05)
        crown.position.y = height * 0.28
        group.addChild(crown)
        group.addChild(pot)
        return group
    }

    private static func bookshelf(width: CGFloat, height: CGFloat) -> SKNode {
        let group = SKNode()
        group.addChild(roundedFurniture(width: width, height: height, fill: SKColor(red: 0.48, green: 0.30, blue: 0.18, alpha: 1)))
        for row in 1...2 {
            let shelf = SKShapeNode(rectOf: CGSize(width: width * 0.82, height: max(1, height * 0.04)))
            shelf.fillColor = cream
            shelf.strokeColor = .clear
            shelf.position.y = height * CGFloat(row) / 3 - height / 2
            group.addChild(shelf)
        }
        return group
    }

    static func desk(texture: SKTexture, scale: CGFloat, tileSize: CGFloat = 32) -> SKSpriteNode {
        furniture(texture: texture, kind: .desk, scale: scale, tileSize: tileSize)
    }

    static func chair(texture: SKTexture, kind: FurnitureKind, scale: CGFloat, tileSize: CGFloat = 32) -> SKSpriteNode {
        furniture(texture: texture, kind: kind, scale: scale, tileSize: tileSize)
    }

    static func plant(texture: SKTexture, kind: FurnitureKind, scale: CGFloat, tileSize: CGFloat = 32) -> SKSpriteNode {
        furniture(texture: texture, kind: kind, scale: scale, tileSize: tileSize)
    }

    static func sofa(texture: SKTexture, kind: FurnitureKind, scale: CGFloat) -> SKSpriteNode {
        furniture(texture: texture, kind: kind, scale: scale)
    }

    static func meetingSurface(texture: SKTexture, kind: FurnitureKind, scale: CGFloat) -> SKSpriteNode {
        furniture(texture: texture, kind: kind, scale: scale)
    }

    static func coffeeMachine(texture: SKTexture, scale: CGFloat, tileSize: CGFloat = 32) -> SKSpriteNode {
        semanticAppliance(texture: texture, kind: .coffeeMachine, scale: scale, tileSize: tileSize)
    }
    static func waterCooler(texture: SKTexture, scale: CGFloat, tileSize: CGFloat = 32) -> SKSpriteNode {
        semanticAppliance(texture: texture, kind: .waterCooler, scale: scale, tileSize: tileSize)
    }
    static func vendingMachine(texture: SKTexture, scale: CGFloat, tileSize: CGFloat = 32) -> SKSpriteNode {
        semanticAppliance(texture: texture, kind: .vendingMachine, scale: scale, tileSize: tileSize)
    }
    static func refrigerator(texture: SKTexture, scale: CGFloat, tileSize: CGFloat = 32) -> SKSpriteNode {
        semanticAppliance(texture: texture, kind: .refrigerator, scale: scale, tileSize: tileSize)
    }
    static func sinkCounter(texture: SKTexture, scale: CGFloat, tileSize: CGFloat = 32) -> SKSpriteNode {
        semanticAppliance(texture: texture, kind: .sinkCounter, scale: scale, tileSize: tileSize)
    }
    static func whiteboard(texture: SKTexture, kind: FurnitureKind, scale: CGFloat, tileSize: CGFloat = 32) -> SKSpriteNode {
        semanticAppliance(texture: texture, kind: kind, scale: scale, tileSize: tileSize)
    }
    static func printer(texture: SKTexture, scale: CGFloat, tileSize: CGFloat = 32, visible: Bool = true) -> SKSpriteNode {
        let node = semanticAppliance(texture: texture, kind: .printer, scale: scale, tileSize: tileSize)
        if !visible { node.removeAllChildren() }
        return node
    }

    private static func semanticAppliance(texture: SKTexture, kind: FurnitureKind, scale: CGFloat, tileSize: CGFloat) -> SKSpriteNode {
        let node = furniture(texture: texture, kind: kind, scale: scale, tileSize: tileSize)
        node.removeAllChildren()
        let width = node.size.width
        let height = node.size.height
        func box(_ w: CGFloat, _ h: CGFloat, _ color: SKColor) -> SKShapeNode {
            roundedFurniture(width: w, height: h, fill: color)
        }
        switch kind {
        case .coffeeMachine:
            let body = box(width * 0.7, height * 0.55, SKColor(red: 0.28, green: 0.34, blue: 0.35, alpha: 1)); body.position.y = height * 0.22; node.addChild(body)
            let cup = box(width * 0.25, height * 0.18, SKColor(red: 0.95, green: 0.83, blue: 0.62, alpha: 1)); cup.position.y = height * 0.52; node.addChild(cup)
        case .waterCooler:
            let body = box(width * 0.58, height * 0.45, SKColor(red: 0.55, green: 0.72, blue: 0.76, alpha: 1)); body.position.y = height * 0.2; node.addChild(body)
            let bottle = SKShapeNode(ellipseOf: CGSize(width: width * 0.42, height: height * 0.42)); bottle.fillColor = SKColor(red: 0.60, green: 0.84, blue: 0.90, alpha: 1); bottle.strokeColor = outline; bottle.position.y = height * 0.58; node.addChild(bottle)
        case .vendingMachine:
            let body = box(width * 0.72, height * 0.82, SKColor(red: 0.36, green: 0.48, blue: 0.52, alpha: 1)); body.position.y = height * 0.38; node.addChild(body)
            for i in 0..<3 { let row = box(width * 0.48, height * 0.07, SKColor(red: 0.93, green: 0.75, blue: 0.43, alpha: 1)); row.position.y = height * (0.22 + CGFloat(i) * 0.18); node.addChild(row) }
        case .refrigerator:
            let body = box(width * 0.82, height * 0.86, SKColor(red: 0.82, green: 0.86, blue: 0.84, alpha: 1)); body.position.y = height * 0.4; node.addChild(body)
            for x in [-1, 1] { let handle = box(width * 0.05, height * 0.28, outline); handle.position = CGPoint(x: CGFloat(x) * width * 0.18, y: height * 0.42); node.addChild(handle) }
        case .sinkCounter:
            let counter = box(width * 0.86, height * 0.30, SKColor(red: 0.66, green: 0.47, blue: 0.30, alpha: 1)); counter.position.y = height * 0.16; node.addChild(counter)
            let bowl = SKShapeNode(ellipseOf: CGSize(width: width * 0.34, height: height * 0.16)); bowl.fillColor = cream; bowl.strokeColor = outline; bowl.position.y = height * 0.36; node.addChild(bowl)
        case .printer:
            let body = box(width * 0.72, height * 0.48, SKColor(red: 0.72, green: 0.74, blue: 0.70, alpha: 1)); body.position.y = height * 0.22; node.addChild(body)
            let paper = box(width * 0.35, height * 0.18, cream); paper.position.y = height * 0.52; node.addChild(paper)
        case .whiteboard, .wallWhiteboard:
            let board = box(width * 0.86, height * 0.72, cream); board.position.y = height * 0.4; node.addChild(board)
            let tray = box(width * 0.72, height * 0.06, outline); tray.position.y = height * 0.06; node.addChild(tray)
        default: break
        }
        return node
    }

    static func setDoor(_ node: SKNode, open: Bool) {
        guard let panel = node.childNode(withName: "doorPanel") as? SKShapeNode else { return }
        panel.fillColor = open
            ? SKColor(red: 0.91, green: 0.78, blue: 0.56, alpha: 1)
            : SKColor(red: 0.78, green: 0.57, blue: 0.39, alpha: 1)
        panel.xScale = open ? 0.42 : 1
        panel.zRotation = open ? -0.18 : 0
    }

    static func wallLamp(tileSize: CGFloat, lit: Bool) -> SKNode {
        let holder = SKNode()
        let stem = SKShapeNode(rectOf: CGSize(width: max(1, tileSize * 0.06), height: tileSize * 0.28), cornerRadius: 1)
        stem.fillColor = outline; stem.strokeColor = .clear; stem.position.y = tileSize * 0.18
        let shade = SKShapeNode(ellipseOf: CGSize(width: tileSize * 0.34, height: tileSize * 0.16))
        shade.fillColor = SKColor(red: 0.96, green: 0.67, blue: 0.32, alpha: 1); shade.strokeColor = outline; shade.lineWidth = 1; shade.position.y = tileSize * 0.33
        let halo = SKShapeNode(circleOfRadius: tileSize * 0.32)
        halo.fillColor = SKColor(red: 1, green: 0.72, blue: 0.30, alpha: lit ? 0.16 : 0); halo.strokeColor = .clear; halo.blendMode = .add; halo.name = "lampHalo"; halo.zPosition = -1
        holder.addChild(stem); holder.addChild(shade); holder.addChild(halo)
        return holder
    }

    static func zonePill(text: String, accent: SKColor, fontSize: CGFloat) -> SKNode {
        let holder = SKNode()
        let label = SKLabelNode(text: text)
        label.fontName = officeLabelFontName
        label.fontSize = fontSize
        label.fontColor = SKColor(red: 0.28, green: 0.20, blue: 0.14, alpha: 1)
        label.horizontalAlignmentMode = .center
        label.verticalAlignmentMode = .center
        let plate = SKShapeNode(rect: label.frame.insetBy(dx: -fontSize * 0.72, dy: -fontSize * 0.38), cornerRadius: fontSize * 0.62)
        plate.fillColor = cream
        plate.strokeColor = accent.withAlphaComponent(0.58)
        plate.lineWidth = max(1, fontSize * 0.07)
        holder.addChild(plate)
        holder.addChild(label)
        return holder
    }
}
