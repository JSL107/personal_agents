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
        if candidate * Double(rows) <= viewHeight + candidate * Double(officeViewHeightSlackRows) {
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

/// 도면이 배율 계단 위에 **잘리지 않고** 꼭 서는 오피스 뷰 크기.
public struct OfficeWindowFit: Equatable, Sendable {
    public let zoneColumns: Int
    public let tileSize: Double
    public let width: Double
    public let height: Double
    public init(zoneColumns: Int, tileSize: Double, width: Double, height: Double) {
        self.zoneColumns = zoneColumns
        self.tileSize = tileSize
        self.width = width
        self.height = height
    }
}

/// 주어진 여유 안에서 도면이 설 수 있는 **가장 큰 계단**과, 그때 도면이 꼭 맞는 뷰 크기(순수).
///
/// 창 크기를 도면 배율에서 거꾸로 잡는 계산이 예전에는 `main.swift` 에 상수 두 개
/// (1440×860 · 960×1140)와 `width >= 1440` 한 줄로 박혀 있었다. 그래서 (1) 그 두 값이 맞는지
/// 테스트할 수가 없었고, (2) `min(preferred, usable)` 로 자른 결과가 여전히 계단 위에 서는지
/// 아무도 보지 않았으며, (3) 두 값보다 큰 화면에서 남는 여유를 쓰지 못했다 — 2560×1349
/// 모니터는 60px 계단을 감당하는데 40px 로 떴다.
///
/// **여유 두 줄(`officeViewMetrics` 의 세로 초과 허용)은 여기서 쓰지 않는다.** 그건 사용자가
/// 창을 줄였을 때 바깥벽 한두 줄을 잘라 배율을 지키는 장치이고, 창 크기를 우리가 정하는
/// 자리에서는 잘라낼 이유가 없다.
///
/// - Returns: 한 계단도 못 들어가면 `nil`. 부르는 쪽이 자기 기본값으로 처리한다.
public func officeWindowFit(
    availableWidth: Double,
    availableHeight: Double,
    backingScale: Double = 2
) -> OfficeWindowFit? {
    let unit = officeScaleUnit(backingScale: backingScale)
    guard availableWidth > 0, availableHeight > 0, unit > 0 else {
        return nil
    }
    var best: OfficeWindowFit?
    for zoneColumns in [2, 3] {
        let planSize = officePlanSize(zoneColumns: zoneColumns)
        let steps = min(
            (availableWidth / Double(planSize.columns) / unit).rounded(.down),
            (availableHeight / Double(planSize.rows) / unit).rounded(.down)
        )
        guard steps >= 1 else {
            continue
        }
        let tileSize = steps * unit
        let candidate = OfficeWindowFit(
            zoneColumns: zoneColumns,
            tileSize: tileSize,
            width: tileSize * Double(planSize.columns),
            height: tileSize * Double(planSize.rows)
        )
        guard let current = best else {
            best = candidate
            continue
        }
        // 계단이 같으면 더 넓게 그려지는 배치를 고른다 — 같은 타일이면 칸이 많은 쪽이
        // 화면을 더 채우고, 남는 검은 여백이 곧 사용자가 신고한 증상이다.
        let isBigger =
            candidate.tileSize > current.tileSize
            || (candidate.tileSize == current.tileSize
                && candidate.width * candidate.height > current.width * current.height)
        if isBigger {
            best = candidate
        }
    }
    return best
}

/// 손으로 키운 창이 배율 계단 **바로 아래**에 멈췄을 때, 그 계단에 서는 데 **모자란 만큼만**
/// 키운 오피스 뷰 크기(순수).
///
/// `officeWindowFit` 과 목적이 다르다. 저쪽은 "이 화면이 감당하는 가장 큰 계단" 을 내므로
/// 창을 화면 크기까지 키우고, 이쪽은 사용자가 잡은 창 크기를 존중한 채 **한 계단만** 올린다.
/// 계단 하나가 2배(20 → 40px)라, 창을 늘리다 몇십 px 앞에서 멈추면 도면이 통째로 절반
/// 크기로 남는다 — 사람 눈에는 "창을 늘렸는데 아무 일도 일어나지 않은" 것으로 보인다.
///
/// **이미 충분한 축은 줄이지 않는다.** 계단에 서는 데 필요한 폭이 지금 창보다 좁을 수 있는데
/// (2열 40px 은 920 이면 되고 창은 936 일 수 있다), 그 값을 그대로 쓰면 창이 옆으로 오므라든다.
///
/// **잘림 없는 크기를 먼저 시도한다.** `officeViewMetrics` 는 바깥벽 두 줄을 잘라서라도 배율을
/// 지키지만, 그건 사용자가 창을 줄였을 때의 장치다 — 창 크기를 우리가 올리는 자리에서 굳이
/// 잘린 도면을 만들 이유가 없다. 온전한 크기가 여유를 넘을 때만 잘림을 받아들이고 물러난다.
///
/// - Parameters:
///   - maxViewWidth: 화면이 오피스 뷰에 줄 수 있는 최대 폭(창 테두리·탭 막대를 뺀 값).
///   - tolerance: 늘려도 되는 비율의 상한. 넘으면 `nil` — 사용자가 **일부러** 작게 만든 창을
///     두 배로 키우는 것은 보정이 아니라 방해다. 기본값 0.5 의 근거는 **계단 하나가 정확히
///     2배**라는 것이다: 그 절반까지는 "거의 닿았다" 로 보고 마저 늘리고, 그보다 멀면 애초에
///     다른 배율을 쓰는 창으로 본다. 0.2 로 잡았더니 실사용 창 960x989(1920x1080 화면)에서
///     3열 40px(폭 1400 필요)이 1.46 배라 걸러져, 정작 고치려던 창에서 아무 일도 안 일어났다.
/// - Returns: 한 계단 위가 화면에 안 들어가거나 `tolerance` 를 넘으면 `nil`.
public func officeSnapUpFit(
    viewWidth: Double,
    viewHeight: Double,
    maxViewWidth: Double,
    maxViewHeight: Double,
    backingScale: Double = 2,
    tolerance: Double = 0.5
) -> OfficeWindowFit? {
    let unit = officeScaleUnit(backingScale: backingScale)
    guard viewWidth > 0, viewHeight > 0, unit > 0, tolerance >= 0 else {
        return nil
    }
    // 지금 화면에 실제로 그려지는 타일. `officeZoneColumns` 는 둘 중 큰 쪽을 고르므로
    // (같을 때만 히스테리시스가 끼어들고, 그때는 타일 값이 어차피 같다) 최댓값이 곧 답이다.
    func drawnTileSize(_ zoneColumns: Int) -> Double {
        let planSize = officePlanSize(zoneColumns: zoneColumns)
        return officeViewMetrics(
            viewWidth: viewWidth, viewHeight: viewHeight,
            columns: planSize.columns, rows: planSize.rows, backingScale: backingScale
        ).tileSize
    }
    let target = max(drawnTileSize(2), drawnTileSize(3)) + unit

    var best: OfficeWindowFit?
    var bestStretch = Double.infinity
    for zoneColumns in [2, 3] {
        let planSize = officePlanSize(zoneColumns: zoneColumns)
        let neededWidth = target * Double(planSize.columns)
        // 앞이 온전한 도면, 뒤가 바깥벽 두 줄을 내주고 배율만 지키는 크기. 순서가 곧 우선순위다.
        let heightCandidates = [
            target * Double(planSize.rows),
            target * Double(planSize.rows - officeViewHeightSlackRows),
        ]
        guard neededWidth <= maxViewWidth else {
            continue
        }
        for neededHeight in heightCandidates {
            guard neededHeight <= maxViewHeight else {
                continue
            }
            let stretch = max(neededWidth / viewWidth, neededHeight / viewHeight)
            guard stretch <= 1 + tolerance, stretch < bestStretch else {
                continue
            }
            bestStretch = stretch
            best = OfficeWindowFit(
                zoneColumns: zoneColumns,
                tileSize: target,
                width: max(neededWidth, viewWidth),
                height: max(neededHeight, viewHeight)
            )
            break
        }
    }
    return best
}

/// 창 세로 부족을 봐주는 줄 수 — 이만큼은 바깥벽을 잘라내고 배율을 지킨다.
/// `officeViewMetrics` 의 "결과 타일 두 줄" 규칙과 `officeSnapUpFit` 이 같은 값을 봐야 한다.
public let officeViewHeightSlackRows = 2

/// 창을 새 크기로 바꾸되 **왼쪽 위를 고정**하고 화면 안에 가둔 프레임(순수).
///
/// 좌표계는 AppKit 화면 좌표와 같다 — `(x, y)` 는 좌하단이고 y 는 위로 증가한다.
///
/// 왼쪽 위를 고정하는 이유: 세로 모니터 위쪽에 붙여 쓰는 배치에서 창이 **위로** 자라면
/// 화면 밖으로 나가고, 가운데로 옮기면(`center()`) 사용자가 둔 자리를 뺏는다.
///
/// 클램프가 필요한 이유: 위를 고정한 채 키우면 아래로 자라 화면 아래 경계를 넘을 수 있다.
/// 새 크기가 화면보다 크면 **왼쪽 위 모서리에 붙인다** — 그 경우 `max` 를 한 번 더 씌우지
/// 않으면 하한이 상한보다 커져 창이 화면 밖 음수 자리로 밀린다.
public func officeFittedWindowFrame(
    currentFrame: OfficeRect,
    fittedWidth: Double,
    fittedHeight: Double,
    visibleFrame: OfficeRect
) -> OfficeRect {
    let anchoredX = currentFrame.x
    let anchoredY = currentFrame.y + currentFrame.height - fittedHeight
    let maxX = max(visibleFrame.x + visibleFrame.width - fittedWidth, visibleFrame.x)
    let maxY = max(visibleFrame.y + visibleFrame.height - fittedHeight, visibleFrame.y)
    return OfficeRect(
        x: min(max(anchoredX, visibleFrame.x), maxX),
        y: min(max(anchoredY, visibleFrame.y), maxY),
        width: fittedWidth,
        height: fittedHeight
    )
}
