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

/// 겹친 글상자의 자리 번호. 렌더에서 "이 상자를 빨갛게 칠할지" 판단에 쓴다.
///
/// 주인·종류를 조합한 이름으로 고르면 안 된다 — 씬 직속 라벨은 주인이 모두 `scene` 이고
/// 종류도 같아서(세션 이름표 여럿이 전부 `scene/sessionName`) **하나만 겹쳐도 같은 종류가
/// 통째로 겹친 것으로 칠해진다.** 자리 번호는 상자마다 다르므로 그런 번짐이 없다.
public func officeOverlappingLabelIndexes(_ boxes: [OfficeLabelBox]) -> Set<Int> {
    var indexes: Set<Int> = []
    guard boxes.count > 1 else {
        return indexes
    }
    for leftIndex in 0..<(boxes.count - 1) {
        for rightIndex in (leftIndex + 1)..<boxes.count {
            if officeLabelBoxesOverlap(boxes[leftIndex].rect, boxes[rightIndex].rect) {
                indexes.insert(leftIndex)
                indexes.insert(rightIndex)
            }
        }
    }
    return indexes
}

/// 사람이 읽는 이름. 같은 이름이 여럿 나올 수 있으므로 **판정에는 쓰지 않는다**
/// (보고에서는 글자 내용을 함께 찍어 구분한다).
public func officeLabelBoxKey(_ box: OfficeLabelBox) -> String {
    "\(box.owner)/\(box.kind)"
}

/// 라벨이 실제로 보여 주는 글자. 일반 텍스트가 비어 있으면 속성 문자열 쪽을 쓴다.
///
/// **사람 이름표는 속성 문자열로만 그려진다** — 외곽선을 주려고 그렇게 쓰는데
/// (`CharacterNode`), 그 경우 일반 텍스트는 비어 있다. 한쪽만 읽으면 정작 확인하려던
/// 이름표가 통째로 빠지고, 남은 몇 개로 "겹침 없음" 이 나와 **고장이 정상으로 보고된다.**
///
/// SpriteKit 타입을 받지 않고 두 문자열만 받는다 — 그래야 이 선택 규칙을 테스트로 고정할 수
/// 있다(이 경로의 누락이 실제로 확인 대상 20개를 빠뜨렸다).
public func officeLabelText(plain: String?, attributed: String?) -> String? {
    if let plain, !plain.isEmpty {
        return plain
    }
    if let attributed, !attributed.isEmpty {
        return attributed
    }
    return nil
}
