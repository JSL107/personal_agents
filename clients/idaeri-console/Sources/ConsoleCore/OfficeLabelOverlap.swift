import Foundation

/// 화면 위에 뜨는 글상자 하나(이름표·말풍선 등). 겹침 판정의 입력.
///
/// 좌표는 씬 기준이고 y 는 위로 증가한다(`OfficeRect` 와 같은 규약).
public struct OfficeLabelBox: Equatable, Sendable {
    /// 이 글상자가 누구 것인지 — 캐릭터 노드의 `agentType`.
    public let owner: String
    /// 글상자 종류 — 이름표(`name`)인지 말풍선(`infoBubble`)인지.
    public let kind: String
    /// 화면에 실제로 그려진 글자의 텍스트. 어느 상자인지 사람이 알아보는 단서.
    public let text: String
    public let rect: OfficeRect

    public init(owner: String, kind: String, text: String, rect: OfficeRect) {
        self.owner = owner
        self.kind = kind
        self.text = text
        self.rect = rect
    }
}

/// 두 글상자가 실제로 겹치는지. 변이 맞닿기만 한 경우는 겹침이 아니다.
public func officeLabelBoxesOverlap(_ left: OfficeRect, _ right: OfficeRect) -> Bool {
    let separated =
        left.x + left.width <= right.x || right.x + right.width <= left.x
        || left.y + left.height <= right.y || right.y + right.height <= left.y
    return !separated
}

/// 서로 겹치는 글상자 쌍을 전부 찾는다.
///
/// 화면 글자가 서로를 가리는지는 **그려진 상자로만** 판정된다. 좌석 폭이나 폰트 크기 같은
/// 파라미터끼리 비교하면 글자 폭이 런타임에 정해지는 만큼을 못 보고 초록불이 유지된다
/// (그래서 이 판정의 입력은 계산값이 아니라 렌더된 노드의 실제 프레임이다).
///
/// 같은 주인의 이름표와 말풍선도 검사 대상이다 — 문패가 자기 말풍선을 덮는 것이
/// 실제로 겪은 회귀였다.
public func officeOverlappingLabelPairs(
    _ boxes: [OfficeLabelBox]
) -> [(OfficeLabelBox, OfficeLabelBox)] {
    var pairs: [(OfficeLabelBox, OfficeLabelBox)] = []
    guard boxes.count > 1 else {
        return pairs
    }
    for leftIndex in 0..<(boxes.count - 1) {
        for rightIndex in (leftIndex + 1)..<boxes.count {
            let left = boxes[leftIndex]
            let right = boxes[rightIndex]
            if officeLabelBoxesOverlap(left.rect, right.rect) {
                pairs.append((left, right))
            }
        }
    }
    return pairs
}

/// 겹친 글상자에 속한 주인·종류 집합. 렌더에서 "이 상자를 빨갛게 칠할지" 판단에 쓴다.
public func officeOverlappingLabelKeys(_ boxes: [OfficeLabelBox]) -> Set<String> {
    var keys: Set<String> = []
    for (left, right) in officeOverlappingLabelPairs(boxes) {
        keys.insert(officeLabelBoxKey(left))
        keys.insert(officeLabelBoxKey(right))
    }
    return keys
}

/// 글상자를 가리키는 키. 주인이 같아도 종류가 다르면 다른 상자다.
public func officeLabelBoxKey(_ box: OfficeLabelBox) -> String {
    "\(box.owner)/\(box.kind)"
}
