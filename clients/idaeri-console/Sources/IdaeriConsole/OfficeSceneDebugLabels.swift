import AppKit
import ConsoleCore
import SpriteKit

/// 렌더 위에 글상자 경계와 주인 이름을 덧그린다(회귀 확인 전용).
///
/// 이름표가 서로를 가리는지는 **그려진 글자 폭**에 달려 있는데, 그 폭은 SpriteKit 이 런타임에
/// 정한다. 그래서 좌석 크기나 폰트 값 같은 파라미터끼리 비교하는 단언은 화면을 못 보고
/// 초록불을 유지한다 — 실제로 겹친 이름표가 그 방식으로 여러 차례 통과했다.
///
/// 반대로 사람이 그림만 보는 방식도 반쪽이다. 겹친 것이 보여도 그게 누구 이름표인지
/// 그림에는 적혀 있지 않아, 코드에서 어느 노드를 고쳐야 하는지 지목할 수가 없다.
///
/// 이 오버레이는 둘 사이를 잇는다. 노드에 이미 붙어 있는 이름(`agentType`)을 화면에 찍고,
/// 겹친 상자만 빨갛게 칠한 뒤 같은 목록을 stderr 로도 내보낸다.
///
///     swift run IdaeriConsole --render /tmp/office.png --busy-demo --labels
///
/// 판정만 하고 실패시키지는 않는다 — 이건 게이트가 아니라 확인 입구다.
func officeOverlayDebugLabels(on scene: SKScene) {
    let boxes = officeSceneLabelBoxes(in: scene)
    let overlapping = officeOverlappingLabelKeys(boxes)

    for box in boxes {
        let isOverlapping = overlapping.contains(officeLabelBoxKey(box))
        scene.addChild(debugBoxNode(box, emphasized: isOverlapping))
        // 이름은 겹친 상자에만 붙인다. 전부 붙이면 덧글자끼리 다시 뒤엉켜, 무엇이 원래
        // 겹침이고 무엇이 오버레이 때문인지 구분할 수 없게 된다.
        if isOverlapping {
            scene.addChild(debugOwnerNode(box))
        }
    }

    reportOverlaps(officeOverlappingLabelPairs(boxes), total: boxes.count)
}

/// 씬에 실제로 그려진 글상자를 모은다.
///
/// 좌표는 씬 기준으로 바꿔 담는다 — 캐릭터마다 부모 좌표계가 달라, 각자의 지역 좌표로
/// 비교하면 서로 다른 자리에 있는 글자가 같은 값으로 보인다.
private func officeSceneLabelBoxes(in scene: SKScene) -> [OfficeLabelBox] {
    var boxes: [OfficeLabelBox] = []
    scene.enumerateChildNodes(withName: "//*") { node, _ in
        guard
            let label = node as? SKLabelNode,
            let text = labelText(of: label),
            let parent = label.parent,
            isVisibleInScene(label, scene: scene)
        else {
            return
        }
        let frame = label.calculateAccumulatedFrame()
        guard frame.width > 0, frame.height > 0 else {
            return
        }
        // 두 모서리를 각각 씬 좌표로 옮겨 사각형을 다시 세운다. 부모 체인에 배율이 걸려
        // 있으면 크기도 함께 변하므로, 원점만 옮기고 크기를 그대로 쓰면 어긋난다.
        let lower = scene.convert(CGPoint(x: frame.minX, y: frame.minY), from: parent)
        let upper = scene.convert(CGPoint(x: frame.maxX, y: frame.maxY), from: parent)
        boxes.append(
            OfficeLabelBox(
                owner: labelOwner(of: label),
                kind: label.name ?? "name",
                text: text,
                rect: OfficeRect(
                    x: Double(min(lower.x, upper.x)),
                    y: Double(min(lower.y, upper.y)),
                    width: Double(abs(upper.x - lower.x)),
                    height: Double(abs(upper.y - lower.y))
                )
            )
        )
    }
    return boxes
}

/// 글자 내용. `text` 와 `attributedText` 둘 다 본다.
///
/// **사람 이름표는 `attributedText` 로만 그려진다** — 외곽선을 주려고 속성 문자열을 쓰는데
/// (`CharacterNode`), 그 경우 `text` 는 비어 있다. `text` 만 보면 정작 확인하려던 이름표가
/// 통째로 빠지고, 남은 몇 개로 "겹침 없음" 이 나와 **고장이 정상으로 보고된다**
/// (실제로 첫 구현이 20개를 놓치고 그렇게 통과했다).
private func labelText(of label: SKLabelNode) -> String? {
    if let text = label.text, !text.isEmpty {
        return text
    }
    if let attributed = label.attributedText?.string, !attributed.isEmpty {
        return attributed
    }
    return nil
}

/// 글상자의 주인. 부모 체인에서 이름이 붙은 가장 가까운 노드를 쓴다.
///
/// 캐릭터 노드는 이미 `name = agentType` 을 갖고 있다(`CharacterNode`). 새 식별자를 만들지
/// 않고 그것을 그대로 읽는다 — 순서로 이름을 매기면 배치가 바뀔 때 멀쩡한 코드를
/// 고장으로 오인하게 된다.
private func labelOwner(of label: SKLabelNode) -> String {
    var current: SKNode? = label.parent
    while let node = current {
        if let name = node.name, !name.isEmpty {
            return name
        }
        current = node.parent
    }
    return "scene"
}

/// 씬까지 올라가며 숨김 여부를 확인한다. 부모가 숨겨져 있으면 자식 글자도 화면에 없다.
private func isVisibleInScene(_ label: SKLabelNode, scene: SKScene) -> Bool {
    var current: SKNode? = label
    while let node = current, node !== scene {
        if node.isHidden || node.alpha <= 0.01 {
            return false
        }
        current = node.parent
    }
    return true
}

private func debugBoxNode(_ box: OfficeLabelBox, emphasized: Bool) -> SKShapeNode {
    let node = SKShapeNode(
        rect: CGRect(
            x: CGFloat(box.rect.x), y: CGFloat(box.rect.y),
            width: CGFloat(box.rect.width), height: CGFloat(box.rect.height)
        )
    )
    node.fillColor = emphasized ? SKColor(red: 1, green: 0.2, blue: 0.2, alpha: 0.22) : .clear
    node.strokeColor =
        emphasized
        ? SKColor(red: 1, green: 0.25, blue: 0.25, alpha: 0.95)
        : SKColor(red: 0.3, green: 0.85, blue: 1, alpha: 0.45)
    node.lineWidth = emphasized ? 1.5 : 0.75
    // 사무실의 어떤 요소보다도 위에 올린다 — 진단선이 가구에 가리면 볼 이유가 없다.
    node.zPosition = 9_000
    return node
}

private func debugOwnerNode(_ box: OfficeLabelBox) -> SKLabelNode {
    let node = SKLabelNode(text: "\(box.owner)/\(box.kind)")
    node.fontName = "Menlo-Bold"
    node.fontSize = 8
    node.fontColor = SKColor(red: 1, green: 0.85, blue: 0.3, alpha: 1)
    node.horizontalAlignmentMode = .left
    node.verticalAlignmentMode = .top
    // 상자 바로 아래에 붙인다. 위에 두면 이 글자가 다시 남의 이름표를 덮는다.
    node.position = CGPoint(x: CGFloat(box.rect.x), y: CGFloat(box.rect.y) - 1)
    node.zPosition = 9_001
    return node
}

/// 겹침 목록을 stderr 로 낸다.
///
/// 그림만 내보내면 확인이 다시 "사람이 눈으로 본다" 로 돌아간다. 같은 판정을 글로도
/// 남겨 두면 화면을 열지 못하는 환경에서도 결과를 읽을 수 있다.
private func reportOverlaps(_ pairs: [(OfficeLabelBox, OfficeLabelBox)], total: Int) {
    var lines = ["[labels] 글상자 \(total)개 검사"]
    if pairs.isEmpty {
        lines.append("[labels] 겹침 없음")
    } else {
        lines.append("[labels] 겹침 \(pairs.count)쌍:")
        for (left, right) in pairs {
            lines.append(
                "  - \(officeLabelBoxKey(left)) \"\(left.text)\""
                    + " ↔ \(officeLabelBoxKey(right)) \"\(right.text)\""
            )
        }
    }
    FileHandle.standardError.write(Data(lines.joined(separator: "\n").appending("\n").utf8))
}
