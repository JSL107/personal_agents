import AppKit
import ConsoleCore
import SpriteKit

/// Presentation-only nodes for the office.  Nothing produced here participates in the plan,
/// collision, or path finding; the factory exists to keep the visual treatment out of OfficeScene.
enum CozyOfficeNodeFactory {
    static let outline = SKColor(red: 0.28, green: 0.20, blue: 0.14, alpha: 0.82)
    static let cream = SKColor(red: 0.93, green: 0.87, blue: 0.75, alpha: 0.96)
    // The illustrated shell is brighter than the legacy tile base. Keep the corridor a
    // readable, slightly darker circulation band without changing the logical floor plan.
    // The corridor must remain a visibly darker circulation band than every room
    // shell, including the navy/wood department variants.
    static let walkway = SKColor(red: 0.30, green: 0.24, blue: 0.20, alpha: 0.30)

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

    static func commonAreaSurface(size: CGSize, kind: CommonAreaKind, texture: SKTexture? = nil) -> SKNode {
        if let texture {
            return illustratedRoom(texture: texture, size: size, cornerRadius: min(size.width, size.height) * 0.12)
        }
        let colors: (fill: SKColor, stroke: SKColor)
        switch kind {
        case .meeting:
            colors = (SKColor(red: 0.83, green: 0.75, blue: 0.62, alpha: 0.72), SKColor(red: 0.91, green: 0.61, blue: 0.40, alpha: 0.52))
        case .president:
            colors = (SKColor(red: 0.77, green: 0.70, blue: 0.82, alpha: 0.72), SKColor(red: 0.58, green: 0.44, blue: 0.76, alpha: 0.52))
        case .pantry:
            colors = (SKColor(red: 0.72, green: 0.82, blue: 0.75, alpha: 0.72), SKColor(red: 0.39, green: 0.66, blue: 0.52, alpha: 0.52))
        }
        let node = SKShapeNode(rectOf: size, cornerRadius: min(size.width, size.height) * 0.12)
        node.fillColor = colors.fill
        node.strokeColor = colors.stroke
        node.lineWidth = max(1, min(size.width, size.height) * 0.025)
        node.zPosition = 0.7
        let symbols: [String]
        switch kind {
        case .meeting: symbols = ["●●", "▰"]
        case .president: symbols = ["★", "▤"]
        case .pantry: symbols = ["☕", "▦"]
        }
        for (index, symbol) in symbols.enumerated() {
            let label = SKLabelNode(text: symbol)
            label.name = "common-motif-\(index)"
            label.fontName = "AvenirNext-Bold"
            label.fontSize = max(8, min(size.width, size.height) * 0.14)
            label.fontColor = colors.stroke
            label.horizontalAlignmentMode = .center
            label.verticalAlignmentMode = .center
            label.position = CGPoint(x: (CGFloat(index) - 0.5) * size.width * 0.42, y: 0)
            label.zPosition = 1
            node.addChild(label)
        }
        return node
    }

    /// A self-contained visual room module. It is presentation-only: furniture and characters
    /// remain owned by OfficeScene so hit testing and path finding continue to use OfficePlan.
    static func departmentRoomModule(
        size: CGSize,
        department: Department,
        tileSize: CGFloat,
        texture: SKTexture? = nil
    ) -> SKNode {
        let root = SKNode()
        root.name = "cozy:room:\(department.rawValue)"
        root.zPosition = 3
        if let texture {
            let artwork = illustratedRoom(
                texture: texture,
                size: size,
                cornerRadius: min(size.width, size.height) * 0.08
            )
            artwork.name = "room-artwork"
            root.addChild(artwork)
            return root
        }
        let accent = accent(for: department)
        let surface = roundedIsland(size: size, accent: accent)
        surface.name = "room-surface"
        root.addChild(surface)

        let rear = roundedFurniture(width: size.width * 0.92, height: max(3, tileSize * 0.16), fill: accent.withAlphaComponent(0.34))
        rear.name = "room-rear-wall"
        rear.position = CGPoint(x: 0, y: size.height * 0.44)
        rear.zPosition = 0.2
        root.addChild(rear)
        for side in [-1, 1] {
            let wall = roundedFurniture(width: max(3, tileSize * 0.14), height: size.height * 0.82, fill: accent.withAlphaComponent(0.24))
            wall.name = "room-side-wall"
            wall.position = CGPoint(x: CGFloat(side) * size.width * 0.46, y: 0)
            wall.zPosition = 0.2
            root.addChild(wall)
        }
        let divider = roundedFurniture(width: size.width * 0.72, height: max(2, tileSize * 0.10), fill: outline.withAlphaComponent(0.12))
        divider.name = "room-front-divider"
        divider.position = CGPoint(x: 0, y: -size.height * 0.39)
        divider.zPosition = 0.5
        root.addChild(divider)
        let shadow = SKShapeNode(ellipseOf: CGSize(width: size.width * 0.76, height: tileSize * 0.22))
        shadow.name = "room-floor-shadow"
        shadow.fillColor = outline.withAlphaComponent(0.10)
        shadow.strokeColor = .clear
        shadow.position = CGPoint(x: 0, y: -size.height * 0.27)
        shadow.zPosition = 0.3
        root.addChild(shadow)
        addDepartmentMotifs(to: root, department: department, size: size, tileSize: tileSize)
        return root
    }

    /// Each department owns an independent room illustration. Cropping happens per room,
    /// so resizing or focusing one department never samples an unrelated part of a global image.
    private static func illustratedRoom(
        texture: SKTexture,
        size: CGSize,
        cornerRadius: CGFloat
    ) -> SKNode {
        let root = SKNode()
        let shadow = SKShapeNode(rectOf: size, cornerRadius: cornerRadius)
        shadow.fillColor = SKColor.black.withAlphaComponent(0.16)
        shadow.strokeColor = .clear
        shadow.position = CGPoint(x: 0, y: -max(3, size.height * 0.025))
        shadow.zPosition = -0.2
        root.addChild(shadow)

        let crop = SKCropNode()
        let mask = SKShapeNode(rectOf: size, cornerRadius: cornerRadius)
        mask.fillColor = .white
        mask.strokeColor = .clear
        crop.maskNode = mask
        let sourceSize = texture.size()
        let scale = max(size.width / max(1, sourceSize.width), size.height / max(1, sourceSize.height))
        let image = SKSpriteNode(texture: texture)
        image.name = "room-artwork-image"
        image.size = CGSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
        image.texture?.filteringMode = .linear
        crop.addChild(image)
        root.addChild(crop)

        let border = SKShapeNode(rectOf: size, cornerRadius: cornerRadius)
        border.fillColor = .clear
        border.strokeColor = SKColor.white.withAlphaComponent(0.62)
        border.lineWidth = max(1, min(size.width, size.height) * 0.012)
        border.zPosition = 0.2
        root.addChild(border)
        return root
    }

    private static func addDepartmentMotifs(to root: SKNode, department: Department, size: CGSize, tileSize: CGFloat) {
        let motifColor = accent(for: department).withAlphaComponent(0.78)
        let positions = [CGPoint(x: -size.width * 0.32, y: size.height * 0.28), CGPoint(x: size.width * 0.32, y: size.height * 0.28)]
        let symbols: [String]
        switch department {
        case .planning: symbols = ["▤", "• • •"]
        case .quality: symbols = ["⌕", "✓"]
        case .evaluation: symbols = ["▥", "▤"]
        case .treasury: symbols = ["₩", "▣"]
        case .content: symbols = ["✎", "≡"]
        case .internalOps: symbols = ["⚙", "▦"]
        }
        for (index, symbol) in symbols.enumerated() {
            let label = SKLabelNode(text: symbol)
            label.name = "room-motif-\(index)"
            label.fontName = "AvenirNext-Bold"
            label.fontSize = max(8, tileSize * 0.34)
            label.fontColor = motifColor
            label.horizontalAlignmentMode = .center
            label.verticalAlignmentMode = .center
            label.position = positions[index]
            label.zPosition = 0.6
            root.addChild(label)
        }
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
            let top = roundedFurniture(width: width * 0.90, height: height * 0.22, fill: SKColor(red: 0.62, green: 0.39, blue: 0.20, alpha: 1))
            top.name = "desk-top"
            group.addChild(top)
            let edge = roundedFurniture(width: width * 0.78, height: max(1.5, height * 0.035), fill: SKColor(red: 0.82, green: 0.59, blue: 0.34, alpha: 1))
            edge.strokeColor = .clear
            edge.position = CGPoint(x: 0, y: height * 0.105)
            group.addChild(edge)
            for x in [-1, 1] {
                let leg = roundedFurniture(width: width * 0.055, height: height * 0.25, fill: SKColor(red: 0.42, green: 0.27, blue: 0.17, alpha: 1))
                leg.position = CGPoint(x: CGFloat(x) * width * 0.31, y: -height * 0.08)
                leg.zPosition = -0.1
                group.addChild(leg)
            }
            let monitor = roundedFurniture(width: width * 0.28, height: height * 0.30, fill: SKColor(red: 0.22, green: 0.29, blue: 0.32, alpha: 1))
            monitor.position.y = height * 0.30
            monitor.name = "cozy-static-monitor"
            group.addChild(monitor)
            let screen = roundedFurniture(width: width * 0.20, height: height * 0.18, fill: SKColor(red: 0.48, green: 0.70, blue: 0.72, alpha: 1))
            screen.position = CGPoint(x: 0, y: height * 0.31)
            screen.strokeColor = .clear
            group.addChild(screen)
            let keyboard = roundedFurniture(width: width * 0.27, height: height * 0.07, fill: SKColor(red: 0.83, green: 0.77, blue: 0.65, alpha: 1))
            keyboard.position = CGPoint(x: -width * 0.02, y: height * 0.12)
            keyboard.strokeColor = outline.withAlphaComponent(0.5)
            group.addChild(keyboard)
            let monitorStand = roundedFurniture(width: width * 0.07, height: height * 0.12, fill: outline)
            monitorStand.position = CGPoint(x: 0, y: height * 0.19)
            monitorStand.strokeColor = .clear
            group.addChild(monitorStand)
            visual = group
        case .chairDown, .chairUp:
            let group = SKNode()
            let seat = roundedFurniture(width: width * 0.72, height: height * 0.24, fill: SKColor(red: 0.39, green: 0.53, blue: 0.43, alpha: 1))
            seat.position.y = height * 0.10
            group.addChild(seat)
            let back = roundedFurniture(width: width * 0.58, height: height * 0.34, fill: SKColor(red: 0.30, green: 0.43, blue: 0.36, alpha: 1))
            back.position.y = height * 0.34
            group.addChild(back)
            for x in [-1, 1] {
                let leg = roundedFurniture(width: width * 0.055, height: height * 0.18, fill: SKColor(red: 0.35, green: 0.23, blue: 0.16, alpha: 1))
                leg.position = CGPoint(x: CGFloat(x) * width * 0.22, y: -height * 0.03)
                leg.zPosition = -0.1
                group.addChild(leg)
            }
            visual = group
        case .sofa2, .sofa3:
            let group = SKNode()
            let body = roundedFurniture(width: width * 0.92, height: height * 0.28, fill: SKColor(red: 0.73, green: 0.54, blue: 0.38, alpha: 1))
            body.position.y = height * 0.12
            group.addChild(body)
            let back = roundedFurniture(width: width * 0.88, height: height * 0.25, fill: SKColor(red: 0.66, green: 0.45, blue: 0.31, alpha: 1))
            back.position.y = height * 0.35
            group.addChild(back)
            for x in [-1, 1] {
                let arm = roundedFurniture(width: width * 0.08, height: height * 0.38, fill: SKColor(red: 0.62, green: 0.41, blue: 0.28, alpha: 1))
                arm.position = CGPoint(x: CGFloat(x) * width * 0.43, y: height * 0.23)
                group.addChild(arm)
            }
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
            let group = SKNode()
            let surface = roundedFurniture(width: width * 0.82, height: max(6, height * 0.38), fill: SKColor(red: 0.58, green: 0.37, blue: 0.21, alpha: 1))
            group.addChild(surface)
            let inset = SKShapeNode(ellipseOf: CGSize(width: width * 0.42, height: height * 0.12))
            inset.fillColor = SKColor(red: 0.78, green: 0.56, blue: 0.34, alpha: 0.72)
            inset.strokeColor = .clear
            inset.position.y = height * 0.03
            group.addChild(inset)
            for x in [-1, 1] {
                let leg = roundedFurniture(width: width * 0.06, height: height * 0.30, fill: SKColor(red: 0.42, green: 0.27, blue: 0.17, alpha: 1))
                leg.position = CGPoint(x: CGFloat(x) * width * 0.26, y: -height * 0.13)
                leg.zPosition = -0.1
                group.addChild(leg)
            }
            visual = group
        case .doorClosed, .doorOpen:
            let door = roundedFurniture(width: width * 0.82, height: height * 0.88, fill: SKColor(red: 0.78, green: 0.57, blue: 0.39, alpha: 1))
            door.name = "doorPanel"
            let knob = SKShapeNode(circleOfRadius: max(1.2, width * 0.045))
            knob.fillColor = SKColor(red: 0.96, green: 0.80, blue: 0.48, alpha: 1)
            knob.strokeColor = outline
            knob.position = CGPoint(x: width * 0.23, y: -height * 0.04)
            door.addChild(knob)
            visual = door
        case .clock:
            let face = SKShapeNode(circleOfRadius: min(width, height) * 0.38)
            face.fillColor = SKColor(red: 0.98, green: 0.91, blue: 0.74, alpha: 1)
            face.strokeColor = outline
            face.lineWidth = max(1, width * 0.05)
            let hand = line(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 0, y: height * 0.20), width: max(1, width * 0.04), color: outline)
            let minute = line(from: CGPoint(x: 0, y: 0), to: CGPoint(x: width * 0.16, y: height * 0.02), width: max(1, width * 0.035), color: outline)
            face.addChild(hand)
            face.addChild(minute)
            visual = face
        case .wallLandscape, .wallAbstract, .wallCalendar, .wallCertificate, .wallPinboard, .wallMonitor, .wallPoster:
            visual = wallArt(kind: kind, width: width * 0.82, height: height * 0.64)
        default:
            visual = roundedFurniture(width: width * 0.72, height: max(5, height * 0.34), fill: SKColor(red: 0.67, green: 0.51, blue: 0.34, alpha: 1))
        }
        visual.position = CGPoint(x: 0, y: height * 0.08)
        visual.zPosition = 0
        anchor.addChild(visual)
        return anchor
    }

    static func illustratedFurniture(
        texture: SKTexture,
        kind: FurnitureKind,
        tileSize: CGFloat,
        visible: Bool = true
    ) -> SKSpriteNode {
        let sourceSize = texture.size()
        let widthInTiles: CGFloat
        switch kind {
        case .desk: widthInTiles = 2.05
        case .chairDown, .chairUp: widthInTiles = 1.05
        case .sofa2: widthInTiles = 2.05
        case .sofa3: widthInTiles = 2.75
        case .meetingTable: widthInTiles = 3.0
        case .coffeeTable: widthInTiles = 1.45
        case .bookshelf, .wallShelf: widthInTiles = 1.35
        case .coffeeMachine, .sinkCounter: widthInTiles = 1.65
        default: widthInTiles = max(0.9, CGFloat(kind.footprint.width))
        }
        let width = tileSize * widthInTiles
        let height = width * sourceSize.height / max(1, sourceSize.width)
        let node = SKSpriteNode(texture: texture)
        node.anchorPoint = CGPoint(x: 0.5, y: 0.08)
        node.size = CGSize(width: width, height: height)
        node.texture?.filteringMode = .linear
        node.alpha = visible ? 1 : 0
        return node
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

    private static func line(from start: CGPoint, to end: CGPoint, width: CGFloat, color: SKColor) -> SKShapeNode {
        let path = CGMutablePath()
        path.move(to: start)
        path.addLine(to: end)
        let node = SKShapeNode(path: path)
        node.strokeColor = color
        node.lineWidth = width
        node.lineCap = .round
        return node
    }

    private static func wallArt(kind: FurnitureKind, width: CGFloat, height: CGFloat) -> SKNode {
        let frame = roundedFurniture(width: width, height: height, fill: SKColor(red: 0.55, green: 0.36, blue: 0.22, alpha: 1))
        let inner = roundedFurniture(width: width * 0.84, height: height * 0.76, fill: SKColor(red: 0.92, green: 0.85, blue: 0.70, alpha: 1))
        inner.strokeColor = .clear
        frame.addChild(inner)
        switch kind {
        case .wallLandscape:
            let hill = SKShapeNode(rectOf: CGSize(width: width * 0.62, height: height * 0.22), cornerRadius: 2)
            hill.fillColor = SKColor(red: 0.45, green: 0.64, blue: 0.50, alpha: 1); hill.strokeColor = .clear; hill.position.y = -height * 0.14
            inner.addChild(hill)
            let sun = SKShapeNode(circleOfRadius: width * 0.10)
            sun.fillColor = SKColor(red: 0.96, green: 0.67, blue: 0.31, alpha: 1); sun.strokeColor = .clear; sun.position = CGPoint(x: -width * 0.22, y: height * 0.18)
            inner.addChild(sun)
        case .wallCalendar:
            for index in 0..<3 {
                let row = line(from: CGPoint(x: -width * 0.25, y: height * (0.12 - CGFloat(index) * 0.13)), to: CGPoint(x: width * 0.25, y: height * (0.12 - CGFloat(index) * 0.13)), width: max(1, width * 0.025), color: outline.withAlphaComponent(0.55))
                inner.addChild(row)
            }
        case .wallMonitor:
            let screen = roundedFurniture(width: width * 0.58, height: height * 0.46, fill: SKColor(red: 0.30, green: 0.44, blue: 0.48, alpha: 1)); screen.strokeColor = outline; screen.position.y = height * 0.05
            inner.addChild(screen)
        default:
            let dot = SKShapeNode(circleOfRadius: width * 0.10)
            dot.fillColor = accent(for: .content); dot.strokeColor = .clear; dot.position = CGPoint(x: -width * 0.18, y: height * 0.12)
            inner.addChild(dot)
            inner.addChild(line(from: CGPoint(x: -width * 0.08, y: -height * 0.10), to: CGPoint(x: width * 0.24, y: height * 0.20), width: max(1, width * 0.035), color: SKColor(red: 0.70, green: 0.51, blue: 0.33, alpha: 1)))
        }
        return frame
    }

    private static func plant(width: CGFloat, height: CGFloat) -> SKNode {
        let group = SKNode()
        let pot = roundedFurniture(width: width * 0.52, height: height * 0.22, fill: SKColor(red: 0.67, green: 0.43, blue: 0.27, alpha: 1))
        let soil = SKShapeNode(ellipseOf: CGSize(width: width * 0.43, height: height * 0.08))
        soil.fillColor = SKColor(red: 0.25, green: 0.17, blue: 0.11, alpha: 1)
        soil.strokeColor = .clear
        soil.position.y = height * 0.12
        group.addChild(soil)
        let leafColors = [SKColor(red: 0.30, green: 0.52, blue: 0.34, alpha: 1), SKColor(red: 0.42, green: 0.64, blue: 0.40, alpha: 1)]
        for index in 0..<7 {
            let leaf = SKShapeNode(ellipseOf: CGSize(width: width * (index.isMultiple(of: 2) ? 0.32 : 0.25), height: height * 0.27))
            leaf.fillColor = leafColors[index % leafColors.count]
            leaf.strokeColor = outline.withAlphaComponent(0.6)
            leaf.lineWidth = max(1, width * 0.025)
            let angle = CGFloat(index - 3) * 0.28
            leaf.zRotation = angle
            leaf.position = CGPoint(x: CGFloat(index - 3) * width * 0.12, y: height * (0.27 + CGFloat(index % 3) * 0.10))
            group.addChild(leaf)
        }
        group.addChild(pot)
        return group
    }

    private static func bookshelf(width: CGFloat, height: CGFloat) -> SKNode {
        let group = SKNode()
        let casework = roundedFurniture(width: width, height: height, fill: SKColor(red: 0.48, green: 0.30, blue: 0.18, alpha: 1))
        group.addChild(casework)
        for x in [-1, 1] {
            let trim = roundedFurniture(width: max(1, width * 0.055), height: height * 0.90, fill: SKColor(red: 0.67, green: 0.43, blue: 0.24, alpha: 1))
            trim.strokeColor = .clear
            trim.position.x = CGFloat(x) * width * 0.44
            group.addChild(trim)
        }
        for row in 1...2 {
            let shelf = SKShapeNode(rectOf: CGSize(width: width * 0.82, height: max(1, height * 0.04)))
            shelf.fillColor = cream
            shelf.strokeColor = .clear
            shelf.position.y = height * CGFloat(row) / 3 - height / 2
            group.addChild(shelf)
        }
        let bookColors = [
            SKColor(red: 0.92, green: 0.54, blue: 0.38, alpha: 1),
            SKColor(red: 0.40, green: 0.62, blue: 0.66, alpha: 1),
            SKColor(red: 0.84, green: 0.70, blue: 0.38, alpha: 1)
        ]
        for row in 0..<2 {
            for column in 0..<4 {
                let book = roundedFurniture(width: width * (column.isMultiple(of: 3) ? 0.10 : 0.12), height: height * (0.16 + CGFloat((row + column) % 2) * 0.05), fill: bookColors[(row + column) % bookColors.count])
                book.strokeColor = outline.withAlphaComponent(0.6)
                book.position = CGPoint(x: (CGFloat(column) - 1.5) * width * 0.17, y: height * (-0.22 + CGFloat(row) * 0.34))
                group.addChild(book)
            }
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
            let button = SKShapeNode(circleOfRadius: max(1, width * 0.045)); button.fillColor = SKColor(red: 0.96, green: 0.67, blue: 0.31, alpha: 1); button.strokeColor = .clear; button.position = CGPoint(x: width * 0.22, y: height * 0.34); node.addChild(button)
        case .waterCooler:
            let body = box(width * 0.58, height * 0.45, SKColor(red: 0.55, green: 0.72, blue: 0.76, alpha: 1)); body.position.y = height * 0.2; node.addChild(body)
            let bottle = SKShapeNode(ellipseOf: CGSize(width: width * 0.42, height: height * 0.42)); bottle.fillColor = SKColor(red: 0.60, green: 0.84, blue: 0.90, alpha: 1); bottle.strokeColor = outline; bottle.position.y = height * 0.58; node.addChild(bottle)
        case .vendingMachine:
            let body = box(width * 0.72, height * 0.82, SKColor(red: 0.36, green: 0.48, blue: 0.52, alpha: 1)); body.position.y = height * 0.38; node.addChild(body)
            for i in 0..<3 { let row = box(width * 0.48, height * 0.07, SKColor(red: 0.93, green: 0.75, blue: 0.43, alpha: 1)); row.position.y = height * (0.22 + CGFloat(i) * 0.18); node.addChild(row) }
            let slot = box(width * 0.22, height * 0.06, outline); slot.position = CGPoint(x: width * 0.22, y: height * 0.12); node.addChild(slot)
        case .refrigerator:
            let body = box(width * 0.82, height * 0.86, SKColor(red: 0.82, green: 0.86, blue: 0.84, alpha: 1)); body.position.y = height * 0.4; node.addChild(body)
            for x in [-1, 1] { let handle = box(width * 0.05, height * 0.28, outline); handle.position = CGPoint(x: CGFloat(x) * width * 0.18, y: height * 0.42); node.addChild(handle) }
        case .sinkCounter:
            let counter = box(width * 0.86, height * 0.30, SKColor(red: 0.66, green: 0.47, blue: 0.30, alpha: 1)); counter.position.y = height * 0.16; node.addChild(counter)
            let bowl = SKShapeNode(ellipseOf: CGSize(width: width * 0.34, height: height * 0.16)); bowl.fillColor = cream; bowl.strokeColor = outline; bowl.position.y = height * 0.36; node.addChild(bowl)
            let faucet = line(from: CGPoint(x: 0, y: height * 0.39), to: CGPoint(x: width * 0.13, y: height * 0.53), width: max(1, width * 0.035), color: outline); node.addChild(faucet)
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

    /// Complete room shells already include the illustrated door itself. This small, independent
    /// status marker is intentionally separate from the hidden logical fallback door so the live
    /// open/closed state remains visible without mutating or parenting state to the shell texture.
    static func doorStatusOverlay(tileSize: CGFloat) -> SKNode {
        let holder = SKNode()
        holder.name = "doorStatusOverlay"

        let panel = roundedFurniture(
            width: tileSize * 0.18,
            height: tileSize * 0.28,
            fill: SKColor(red: 0.78, green: 0.57, blue: 0.39, alpha: 1)
        )
        panel.name = "doorPanel"
        panel.lineWidth = max(1, tileSize * 0.022)
        panel.position.y = tileSize * 0.05

        let knob = SKShapeNode(circleOfRadius: max(0.8, tileSize * 0.022))
        knob.name = "doorKnob"
        knob.fillColor = SKColor(red: 0.96, green: 0.80, blue: 0.48, alpha: 1)
        knob.strokeColor = .clear
        knob.position = CGPoint(x: tileSize * 0.04, y: tileSize * 0.04)
        panel.addChild(knob)

        holder.addChild(panel)
        return holder
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
