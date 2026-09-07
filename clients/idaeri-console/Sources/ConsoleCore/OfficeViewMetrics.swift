import Foundation

/// 스프라이트 한 도트 칸의 픽셀 수. 에셋 파이프라인의 `TILE_PX` 와 짝이고, 원본 시트가
/// 이 크기로 그려져 있다(`clients/idaeri-console/scripts/build-sprites.py`).
///
/// 화면 배율이 이 값의 정수배가 아니면 도트가 불규칙하게 버려져 직선이 몇 칸마다 어긋난다.
/// 재정합 전에는 창 크기를 격자로 나눈 실수값을 써서 0.83~0.97배로 그렸다.
///
/// **40px 에서 20px 로 내린 이유는 계단이다.** 40px 이면 쓸 수 있는 배율이 40 · 80 뿐이라
/// 중간이 없어, 창이 1840x2000 에 못 미치면 곧바로 40px 로 떨어진다 — 실사용 창 1900x1900 에서
/// 세로가 100px 부족해 화면 절반이 빈 채로 남았다. 20px 이면 20 · 40 · 60 · 80 이 되어 같은
/// 창에서 60px 을 쓴다. 바닥이 절차형 타일이라 어느 배수에서도 이음매가 맞는다.
public let officeSpriteUnit: Double = 20

/// 배율의 최소 단위 — **화면의 실제 픽셀 기준으로 정수배가 되게** 정한다.
///
/// 바닥은 20px 타일이지만 캐릭터·가구는 40px 기준(`officeReferenceTileSize`)으로 환산되므로,
/// 실제 배율 `tileSize / 40 × backingScale` 이 정수여야 도트가 균일하게 남는다.
///
/// | 화면 | 단위 | 쓸 수 있는 타일 | 캐릭터 실제 배율 |
/// |---|---|---|---|
/// | Retina 2x | 20px | 20 · 40 · 60 · 80 | 1 · 2 · 3 · 4 |
/// | 외부 1x | 40px | 40 · 80 | 1 · 2 |
///
/// 1x 에서 60px 을 쓰면 캐릭터가 1.5배로 그려져 원본 도트 하나가 화면 1px 또는 2px 로 번갈아
/// 늘어난다 — `filteringMode = .nearest` 로도 막을 수 없고 직선과 걸음 프레임이 불규칙해진다.
/// 그래서 1x 에서는 60px 단계를 포기하고 화면이 조금 비는 것을 받아들인다.
public func officeScaleUnit(backingScale: Double) -> Double {
    guard backingScale > 0 else {
        return officeReferenceTileSize
    }
    return officeReferenceTileSize / backingScale
}

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
    backingScale: Double = 2,
    unit: Double? = nil
) -> OfficeViewMetrics {
    let unit = unit ?? officeScaleUnit(backingScale: backingScale)
    guard viewWidth > 0, viewHeight > 0, columns > 0, rows > 0, unit > 0 else {
        return OfficeViewMetrics(tileSize: unit, originX: 0, originY: 0)
    }
    // **가로를 기준으로 배수를 고른다.** 좌우가 잘리면 방이 통째로 화면 밖으로 나가지만,
    // 세로는 조금 넘쳐도 잘리는 것이 맨 아래 바깥벽 한 줄이라 방을 보는 데 지장이 없다.
    // 실사용 창(960x1050, 격자 23x27)에서 40px 1배면 920x1080 으로 세로가 30px 넘치는데,
    // 그 30px 때문에 배율을 1/2 로 떨어뜨리면 460x540 이 되어 이름표가 읽히지 않는다.
    let byWidth = viewWidth / Double(columns)
    var steps = (byWidth / unit).rounded(.down)
    // 세로 초과가 **결과 타일 두 줄** 을 넘으면 한 단계씩 내린다. 여유를 단위(unit) 기준으로
    // 잡으면 안 된다 — 단위를 20px 로 내렸을 때 여유도 절반이 되어, 40px 이 들어가던 창에서
    // 20px 로 떨어졌다(1400x1000 에서 실제로 그랬다). "두 줄" 은 그 배율의 타일 두 줄이다.
    while steps >= 1 {
        let candidate = unit * steps
        if candidate * Double(rows) <= viewHeight + candidate * 2 {
            break
        }
        steps -= 1
    }
    // 한 배수도 못 들어가면 최소 단위로 둔다. 그 아래로는 내려가지 않는다 — 글자 크기에
    // 하한이 있어 더 줄이면 이름표가 읽히지 않는다.
    let tileSize = max(steps, 1) * unit
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
    backingScale: Double = 2,
    unit: Double? = nil
) -> OfficeViewMetrics {
    let unit = unit ?? officeScaleUnit(backingScale: backingScale)
    let full = officeViewMetrics(
        viewWidth: viewWidth, viewHeight: viewHeight,
        columns: columns, rows: rows, backingScale: backingScale, unit: unit
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
