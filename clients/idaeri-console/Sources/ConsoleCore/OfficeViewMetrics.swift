import Foundation

/// 스프라이트 한 도트 칸의 픽셀 수. 에셋 파이프라인의 `TILE_PX` 와 짝이고, 원본 시트가
/// 이 크기로 그려져 있다(`clients/idaeri-console/scripts/build-sprites.py`).
///
/// 화면 배율이 이 값의 정수배가 아니면 도트가 불규칙하게 버려져 직선이 몇 칸마다 어긋난다.
/// 재정합 전에는 창 크기를 격자로 나눈 실수값을 써서 0.83~0.97배로 그렸다.
public let officeSpriteUnit: Double = 40

/// 격자를 화면에 앉히는 값. 타일 크기와 격자 왼쪽 아래 원점.
public struct OfficeViewMetrics: Equatable, Sendable {
    public let tileSize: Double
    public let originX: Double
    public let originY: Double
    public init(tileSize: Double, originX: Double, originY: Double) {
        self.tileSize = tileSize
        self.originX = originX
        self.originY = originY
    }
}

/// 창 크기에 맞는 **정수 배율** 타일 크기와 중앙 정렬 원점을 낸다(순수).
///
/// 창에 들어가는 가장 큰 배수를 고르고, 한 배수도 못 들어가면 절반 단계(16px)까지 내려간다.
/// 그 아래로는 내려가지 않는다 — 글자 크기에 하한이 있어 더 줄이면 이름표가 읽히지 않는다.
public func officeViewMetrics(
    viewWidth: Double,
    viewHeight: Double,
    columns: Int,
    rows: Int,
    unit: Double = officeSpriteUnit
) -> OfficeViewMetrics {
    guard viewWidth > 0, viewHeight > 0, columns > 0, rows > 0, unit > 0 else {
        return OfficeViewMetrics(tileSize: unit, originX: 0, originY: 0)
    }
    // **가로를 기준으로 배수를 고른다.** 좌우가 잘리면 방이 통째로 화면 밖으로 나가지만,
    // 세로는 조금 넘쳐도 잘리는 것이 맨 아래 바깥벽 한 줄이라 방을 보는 데 지장이 없다.
    // 실사용 창(960x1050, 격자 23x27)에서 40px 1배면 920x1080 으로 세로가 30px 넘치는데,
    // 그 30px 때문에 배율을 1/2 로 떨어뜨리면 460x540 이 되어 이름표가 읽히지 않는다.
    let byWidth = viewWidth / Double(columns)
    var steps = (byWidth / unit).rounded(.down)
    // 세로 초과가 두 줄을 넘으면 한 단계씩 내린다 — 그 이상 잘리면 아래 방이 사라진다.
    let verticalSlack = unit * 2
    while steps >= 1, unit * steps * Double(rows) > viewHeight + verticalSlack {
        steps -= 1
    }
    let tileSize = steps >= 1 ? steps * unit : unit / 2
    return OfficeViewMetrics(
        tileSize: tileSize,
        originX: (viewWidth - tileSize * Double(columns)) / 2,
        originY: (viewHeight - tileSize * Double(rows)) / 2
    )
}

/// 방 하나를 화면 가운데에 담는 정수 배율 값(순수).
///
/// 카메라를 쓰지 않는다. 타일 크기와 원점만 바꿔 기존 재배치 경로를 그대로 태우므로,
/// 이름표 글자 크기 계산(타일 크기 기반)이 함께 따라온다 — 카메라로 확대하면 글자도 같이
/// 커져서 겹침 규칙을 다시 짜야 한다.
///
/// `margin` 은 방 주변으로 **더** 보여 줄 칸 수다. 기본값이 0 인 이유는 `DepartmentZone` 이
/// 이미 좌우 벽을 포함한 폭(`zoneWidth + 1`)이기 때문이다 — 여유를 1 칸 물렸더니 실사용 창에서
/// 구역 11x7 이 13x9 로 잡혀 배수가 2 에서 1 로 떨어졌다(확대가 안 되는 것으로 보였다).
///
/// 전체 뷰와 달리 세로 초과를 허용하지 않는다 — 전체 뷰에서 잘리는 것은 바깥벽이지만,
/// 방 뷰에서 잘리면 보려고 확대한 그 방이 잘린다.
public func officeFocusedViewMetrics(
    viewWidth: Double,
    viewHeight: Double,
    columns: Int,
    rows: Int,
    focus: OfficeRect,
    margin: Double = 0,
    unit: Double = officeSpriteUnit
) -> OfficeViewMetrics {
    let full = officeViewMetrics(
        viewWidth: viewWidth, viewHeight: viewHeight,
        columns: columns, rows: rows, unit: unit
    )
    guard viewWidth > 0, viewHeight > 0, focus.width > 0, focus.height > 0, unit > 0 else {
        return full
    }
    let fitting = min(
        viewWidth / (focus.width + margin * 2),
        viewHeight / (focus.height + margin * 2)
    )
    let steps = (fitting / unit).rounded(.down)
    // 확대인데 축소가 되면 안 된다 — 창이 작아 배수가 안 나오면 전체 뷰 배율을 그대로 쓰고
    // 원점만 그 방으로 옮긴다.
    let tileSize = max(steps >= 1 ? steps * unit : unit, full.tileSize)
    return OfficeViewMetrics(
        tileSize: tileSize,
        originX: viewWidth / 2 - (focus.x + focus.width / 2) * tileSize,
        originY: viewHeight / 2 - (focus.y + focus.height / 2) * tileSize
    )
}
