import CoreGraphics
import Foundation

/// 렌더 픽셀에서 바닥·벽의 밝기를 재는 규칙. 판정까지 여기서 하고, 그림을 굽는 일과 에셋을
/// 읽는 일만 실행 파일(`OfficeSceneColorProbe.swift`)에 남긴다.
///
/// 색은 **파라미터끼리 비교해서는 판정할 수 없다.** 화면 밝기는 원본 텍스처 밝기 ×
/// 누르는 양 × 섞는 색의 곱이고, 그 중 첫 값이 종류마다 크게 달라 누르는 양의 순서가
/// 결과 밝기의 순서와 뒤집힌다. 실제로 통로 누르기가 0.78 까지 올라가 복도가 벽보다
/// 어두워졌는데(당시 실측 26.9 대 87.0) 파라미터 단언은 초록이었다.
///
/// **실행 파일이 아니라 여기 있는 이유는 테스트다**(`officeParseRenderSize` 와 같은 이유).
/// 좌표 변환과 판정 규칙이 `IdaeriConsole` 안에 있으면 검증 러너가 닿지 못해, y축 반전이나
/// 샘플 범위가 어긋나 **엉뚱한 칸을 재고 있어도** 아무 신호가 없다.
///
/// **시간대 조명은 이 경로로 볼 수 없다.** 시간대는 창유리·빛기둥·벽등만 물들이므로
/// (화면 전체를 덮던 색막은 걷어냈다 — `OfficeDaylight`) 시각을 바꿔도 화면 전체 평균이
/// 2.6/255 밖에 움직이지 않는다(실측 173.5~176.1). 그 축은 빛의 **데이터**를 그대로 보는
/// `OfficeIdleTests` 의 단언이 맡는다 — 빛 세기 단조성·벽등 점등 시간·하늘 위아래 색.
public struct OfficeColorProbeGeometry {
    /// `[row][column]`, row 0 = 최하단. 평면도 전체가 아니라 바닥 격자만 받는다 —
    /// 재는 데 필요한 것이 이것뿐이고, 평면도를 요구하면 테스트가 배치를 통째로 세워야 한다.
    public let floor: [[FloorTile]]
    /// 격자 좌하단의 씬 좌표.
    public let gridOrigin: CGPoint
    public let tileSize: CGFloat
    /// 가구·사람이 덮은 칸. 바닥색을 재는 대상에서 뺀다 — 스프라이트가 위로 자라므로
    /// 발이 닿는 칸만 빼면 그 위 칸에서 가구 색을 바닥색으로 잘못 잰다.
    public let occupiedTiles: Set<TilePoint>
    /// **실제로 놓인** 가구. 부서별 요청 목록이 아니라 평면도가 배치한 결과다.
    public let furniture: [FurniturePlacement]

    public init(
        floor: [[FloorTile]],
        gridOrigin: CGPoint,
        tileSize: CGFloat,
        occupiedTiles: Set<TilePoint>,
        furniture: [FurniturePlacement] = []
    ) {
        self.floor = floor
        self.gridOrigin = gridOrigin
        self.tileSize = tileSize
        self.occupiedTiles = occupiedTiles
        self.furniture = furniture
    }
}

/// 한 종류의 바닥이 화면에서 실제로 갖는 밝기.
public struct OfficeColorSample {
    public let tile: FloorTile
    /// 칸별 평균 밝기의 **중앙값**(0~255). 평균이 아닌 이유는 바닥 위에 얹힌 것들이 소수의
    /// 칸을 크게 끌어당기기 때문이다 — 부서 문패·밴드 이름표가 덮은 칸(실측 99~159, 확인:
    /// (17,1)=「콘텐츠」 문패 · (25,16)=「탕비실」 이름표)과 창 빛기둥이 닿은 칸이 그렇다.
    /// 중앙값은 그 소수에 흔들리지 않는다.
    public let median: Double
    public let low: Double
    public let high: Double
    public let tiles: Int

    public init(tile: FloorTile, median: Double, low: Double, high: Double, tiles: Int) {
        self.tile = tile
        self.median = median
        self.low = low
        self.high = high
        self.tiles = tiles
    }
}

/// 렌더 이미지에서 바닥 종류별 밝기를 잰다. 칸이 전부 가려진 종류는 결과에서 빠진다.
public func officeMeasureFloorBrightness(
    image: CGImage,
    geometry: OfficeColorProbeGeometry,
    sceneSize: CGSize
) -> [OfficeColorSample] {
    guard let pixels = OfficePixelGrid(image: image), sceneSize.width > 0, sceneSize.height > 0
    else {
        return []
    }
    // 텍스처는 레티나 배율로 굽히므로(실측 --size 1440x860 → 2880×1720 픽셀) 배율을
    // 상수로 두지 않고 실제 이미지 크기에서 구한다.
    let scale = Double(image.width) / Double(sceneSize.width)
    var byKind: [FloorTile: [Double]] = [:]
    for (row, columns) in geometry.floor.enumerated() {
        for (column, kind) in columns.enumerated() {
            let tile = TilePoint(x: column, y: row)
            guard !geometry.occupiedTiles.contains(tile) else {
                continue
            }
            guard
                let brightness = pixels.meanBrightness(
                    ofTile: tile, geometry: geometry, scale: scale, sceneHeight: sceneSize.height)
            else {
                continue
            }
            byKind[kind, default: []].append(brightness)
        }
    }
    return byKind
        .map { kind, values in
            let sorted = values.sorted()
            return OfficeColorSample(
                tile: kind,
                median: sorted[sorted.count / 2],
                low: sorted[sorted.count / 10],
                high: sorted[sorted.count * 9 / 10],
                tiles: sorted.count
            )
        }
        .sorted { $0.median > $1.median }
}

/// 픽셀을 한 번만 읽어 두고 여러 자리에서 재는 버퍼.
///
/// `CGBitmapContext` 의 **메모리 0번 줄은 이미지 맨 위**다. 씬 좌표는 아래에서 위로 자라므로
/// 세로를 뒤집지 않으면 위아래가 통째로 바뀐 자리를 잰다(빛기둥 텍스처에서 같은 실수를 한 적이 있다).
public struct OfficePixelGrid {
    private let bytes: [UInt8]
    private let width: Int
    private let height: Int

    public init?(image: CGImage) {
        let width = image.width
        let height = image.height
        guard width > 0, height > 0 else {
            return nil
        }
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        // 버퍼 주소를 `&bytes` 로 넘기지 않는다 — 그 포인터의 수명은 호출이 끝나면 보장되지
        // 않는데 `CGContext` 는 그 뒤 `draw` 까지 들고 있는다. 블록 안에서만 쓰고 나온다.
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let base = buffer.baseAddress,
                let context = CGContext(
                    data: base,
                    width: width,
                    height: height,
                    bitsPerComponent: 8,
                    bytesPerRow: width * 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                )
            else {
                return false
            }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else {
            return nil
        }
        self.bytes = bytes
        self.width = width
        self.height = height
    }

    /// 밝기 정의는 `scripts/draw-tiles.py` 와 같게 둔다((R+G+B)/3) — 다른 식을 쓰면
    /// 굽는 쪽이 출력하는 숫자와 여기서 재는 숫자를 나란히 놓을 수 없다.
    private func brightness(x: Int, y: Int) -> Double {
        let index = (y * width + x) * 4
        return (Double(bytes[index]) + Double(bytes[index + 1]) + Double(bytes[index + 2])) / 3
    }

    public func mean() -> Double {
        guard width * height > 0 else {
            return 0
        }
        var total = 0.0
        for y in 0..<height {
            for x in 0..<width {
                total += brightness(x: x, y: y)
            }
        }
        return total / Double(width * height)
    }

    /// 불투명 픽셀만의 평균 밝기. 가구·소품처럼 **투명 배경이 있는 스프라이트**를 잴 때 쓴다 —
    /// 투명 픽셀을 함께 세면 검은 배경이 섞여 실제보다 어둡게 나온다.
    public func meanOpaque(alphaThreshold: UInt8 = 16) -> Double? {
        var total = 0.0
        var count = 0
        for y in 0..<height {
            for x in 0..<width {
                guard bytes[(y * width + x) * 4 + 3] >= alphaThreshold else {
                    continue
                }
                total += brightness(x: x, y: y)
                count += 1
            }
        }
        return count > 0 ? total / Double(count) : nil
    }

    /// 칸 하나의 평균 밝기. 이음매를 피해 **안쪽 60%** 만 잰다.
    public func meanBrightness(
        ofTile tile: TilePoint,
        geometry: OfficeColorProbeGeometry,
        scale: Double,
        sceneHeight: CGFloat
    ) -> Double? {
        let inset = geometry.tileSize * 0.2
        let originX = geometry.gridOrigin.x + CGFloat(tile.x) * geometry.tileSize + inset
        let originY = geometry.gridOrigin.y + CGFloat(tile.y) * geometry.tileSize + inset
        let side = geometry.tileSize * 0.6
        let left = Int((Double(originX) * scale).rounded())
        let right = Int((Double(originX + side) * scale).rounded())
        // 씬 y(아래에서 위) → 메모리 줄(위에서 아래).
        let top = Int((Double(sceneHeight - (originY + side)) * scale).rounded())
        let bottom = Int((Double(sceneHeight - originY) * scale).rounded())
        guard left >= 0, top >= 0, right <= width, bottom <= height, right > left, bottom > top
        else {
            return nil
        }
        var total = 0.0
        var count = 0
        for y in top..<bottom {
            for x in left..<right {
                total += brightness(x: x, y: y)
                count += 1
            }
        }
        return count > 0 ? total / Double(count) : nil
    }
}

/// 방 섬 바닥이 배경에 묻히지 않도록 요구하는 최소 밝기.
/// 통로는 별도 중성색 대비 규칙으로 검사하며, 벡터 캐릭터의 외곽선과 색상은 이 수치에
/// 포함하지 않는다.
public let officeFloorBrightnessFloor = 190.0

/// 바닥에 놓이는 가구가 그 방 바닥보다 어두워야 하는 여유.
///
/// 가구는 눌리지 않고 원본 밝기 그대로 그려지므로(`renderFurniture` 는 색을 섞지 않는다)
/// 바닥과 밝기가 같아지면 물건이 아니라 무늬로 읽힌다 — 「회의 테이블이 바닥에 묻힌다」가
/// 그 증상이었고, `build-sprites.py` 의 목재 보정을 손볼 때마다 되돌아올 수 있는 자리다.
/// 그 확인은 지금까지 사람이 눈으로 하기로만 적혀 있었다.
///
/// **벽걸이는 이 규칙에서 빠진다.** 벽에 걸리므로 견주는 면이 바닥이 아니고, 실제로 벽걸이
/// 달력(207.8)은 벽(205.4)보다 밝다 — 액자·틀로 갈리는 물건이라 밝기로 요구할 수 없다.
///
/// 검사 대상은 방마다 실제로 놓이는 가구다(`departmentFurniture`) — 2026-09-09 실측으로 51쌍이고
/// 가장 빡빡한 여유가 **14.1**(총무 냉장고 192.6 대 carpetDark 206.7), 그다음이 18.6(기획
/// 화이트보드 188.4 대 carpetLight 207.0)이다. 그 3분의 1 아래로 잡아 정상 변동에 걸리지 않게 한다.
///
/// 깔개(rug-*)는 여기 안 나온다 — #488 리뷰로 되돌려 어느 방에도 놓이지 않는다.
public let officeFurnitureContrastMargin = 5.0

/// 통로는 방 섬보다 충분히 어두워야 시각적 경계가 유지된다.
public let officeCorridorRoomContrastMargin = 15.0


/// 방 바닥 실측이 모델(`텍스처 × (1 - 누르기)`)에서 벗어나도 되는 폭.
///
/// 모델은 **어두운 회색을 섞는 것을 순수 검정으로 근사**하므로 실측보다 낮게 나온다.
/// 통로는 전용 중성색으로 그려져 이 모델에서 제외한다.
/// 이 단언이 지키는 것은 값이 아니라 **모델이 아직 화면을 설명한다**는 사실이다 —
/// 유닛 테스트(`OfficeFloorPlanTests`)가 그 모델로 밝기를 판정하므로, 모델이 화면과
/// 어긋나기 시작한 것은 여기서만 알 수 있다.
public let officeFloorModelTolerance = 16.0

/// 한 종류를 판정에 쓰기 위해 필요한 최소 표본 칸수.
///
/// 중앙값의 강건성은 **표본이 여러 개**라는 전제에 기댄다. 배치나 스프라이트가 바뀌어 한
/// 종류가 두세 칸만 남으면 문패 하나가 중앙값을 끌어당기고, 그래도 게이트는 통과한다 —
/// 강건성이 사라진 것을 아무도 모르는 상태가 된다(#519 리뷰 지적).
///
/// 실측 최소는 32칸(901×819)이라 그 3분의 1 아래로 잡아, 정상 배치 변동에는 걸리지 않으면서
/// "표본이 사실상 없다" 만 잡는다(세 크기 실측: 1440×860 · 1400×820 · 901×819 에서 최소 33·33·32).
public let officeFloorColorMinimumTiles = 10

/// Generated room shells contain baked lighting, material variation, and wall shadows, so their
/// rendered brightness cannot be predicted by the legacy `tile texture × muteStrength` model.
/// This range instead guards the actual requirement: the rooms stay warm and legible without
/// clipping into a white card or sinking into a dark photographic background.
public let officeCozyRoomBrightnessRange = 110.0...235.0

/// 통로 밝기 하한. 방 범위(`officeCozyRoomBrightnessRange`)와 **따로 두는 이유**는 통로가
/// 방보다 어두운 것이 의도라서다 — 방 하한 110 을 통로에 그대로 걸면 그 의도가 막힌다.
/// 값은 「의도적으로 어두운 통로」(표본 100)는 통과시키고 「바닥에 뚫린 구멍」(옛 사고 26.9)은
/// 잡는 자리에 둔다.
public let officeCozyCorridorBrightnessFloor = 80.0
/// In illustrated rooms furniture may be lighter or darker than the shell; only
/// near-equal values make it disappear into the floor.
public let officeCozyFurnitureContrastMargin = 0.5
/// Shells are individually lit, so the shared circulation band is compared
/// against the brightest room with a tighter, measured boundary margin.
public let officeCozyCorridorRoomContrastMargin = 3.0

/// Color gate for the modular 2.5D room path. The five logical floor kinds remain useful sampling
/// regions, but their old palette ordering is no longer a visual contract because each department
/// shell owns its material and daylight.
public func officeCozyRoomColorViolations(
    samples: [OfficeColorSample],
    hour: Int,
    furnitureBrightness: ((FurnitureKind) -> Double?)? = nil,
    furniturePairs: [(kind: FurnitureKind, floor: FloorTile)] = []
) -> [String] {
    let prefix = "\(hour)시:"
    let rooms = samples.filter { $0.tile.isRoomFloor }
    guard rooms.count == 5 else {
        let measured = rooms.map(\.tile.rawValue).joined(separator: " · ")
        return ["\(prefix) 2.5D 방 표면 다섯 종류를 다 재지 못했다 (실측: \(measured))"]
    }
    var violations: [String] = []
    for sample in samples where sample.tiles < officeFloorColorMinimumTiles {
        violations.append(
            "\(prefix) \(sample.tile.rawValue) 표본이 \(sample.tiles)칸뿐이다"
                + " (최소 \(officeFloorColorMinimumTiles)) — 중앙값이 강건하지 않다"
        )
    }
    for room in rooms where !officeCozyRoomBrightnessRange.contains(room.median) {
        violations.append(
            "\(prefix) \(room.tile.rawValue) 2.5D 방 밝기 \(rounded(room.median))가"
                + " 허용 범위 \(rounded(officeCozyRoomBrightnessRange.lowerBound))"
                + "~\(rounded(officeCozyRoomBrightnessRange.upperBound)) 밖이다"
        )
    }
    // 타일 텍스처 존재 검사는 두지 않는다. 모듈형 경로의 바닥은 방 셸 일러스트와 단색
    // base 로 그려지고 `FloorTile` 텍스처를 한 장도 읽지 않으므로, 「텍스처가 없어 그 칸이
    // 배경색으로 남는」 옛 사고가 이 경로에서는 일어나지 않는다. 없는 위험을 지키는 검사는
    // 쓰이지 않는 PNG 를 지웠을 때 빨간불을 켜는 쪽으로만 작동한다.
    //
    // 그 자리를 대신하는 것은 아래 **밝기 하한**이다 — 바닥이 통째로 어두워지는 사고는
    // 원인이 무엇이든 실측으로 잡힌다.
    guard samples.contains(where: { $0.tile == .corridor }) else {
        violations.append("\(prefix) 통로 칸이 화면에 없다 — 방 사이 여백을 확인할 것")
        return violations
    }
    guard samples.contains(where: { $0.tile == .wall }) else {
        violations.append("\(prefix) 벽 칸을 하나도 재지 못했다 — 재는 자리가 어긋났다")
        return violations
    }
    let medians = rooms.map(\.median)
    if let darkest = medians.min(), let brightest = medians.max(), brightest - darkest < 12 {
        violations.append(
            "\(prefix) 부서 방 밝기 차가 \(rounded(brightest - darkest))뿐이다"
                + " — 모든 방이 같은 빈 카드처럼 보인다"
        )
    }
    if let corridor = samples.first(where: { $0.tile == .corridor }) {
        // The circulation band surrounds every shell, including the darker treasury room.
        // Compare with the darkest room so no individual boundary disappears.
        if let darkestRoom = rooms.min(by: { $0.median < $1.median }),
            corridor.median > darkestRoom.median - officeCozyCorridorRoomContrastMargin
        {
            violations.append(
                "\(prefix) 통로(\(rounded(corridor.median)))가 \(darkestRoom.tile.rawValue)"
                    + "(\(rounded(darkestRoom.median))) 보다 충분히 어둡지 않다"
            )
        }
    }
    // 통로는 `rooms` 필터 밖이라 위의 방 밝기 범위 검사를 받지 않는다 — 방은 이미
    // `officeCozyRoomBrightnessRange` 가 아래위를 다 막지만 통로는 **어느 쪽도 없었다.**
    // 통로를 방보다 어둡게 두는 것은 새 디자인의 의도이고 100 대까지 내려가도 된다(표본 100·
    // 실측 140.7). 다만 「어둡게」와 「바닥이 뚫린 것처럼」 사이에는 선이 있다 — 옛 사고에서
    // 통로는 26.9 까지 내려가 구멍으로 읽혔고, 그 회차에도 게이트는 초록이었다.
    if let corridor = samples.first(where: { $0.tile == .corridor }),
        corridor.median < officeCozyCorridorBrightnessFloor
    {
        violations.append(
            "\(prefix) 통로(\(rounded(corridor.median)))가 하한"
                + " \(rounded(officeCozyCorridorBrightnessFloor)) 아래다 — 바닥에 뚫린 구멍으로 읽힌다"
        )
    }
    if let furnitureBrightness {
        for pair in furniturePairs {
            guard let floorSample = samples.first(where: { $0.tile == pair.floor }) else {
                continue
            }
            guard let brightness = furnitureBrightness(pair.kind) else {
                violations.append("\(prefix) \(pair.kind.rawValue) 가구 스프라이트를 읽지 못했다")
                continue
            }
            if abs(brightness - floorSample.median) < officeCozyFurnitureContrastMargin {
                violations.append(
                    "\(prefix) \(pair.kind.rawValue)(\(rounded(brightness)))가"
                        + " \(pair.floor.rawValue) 바닥(\(rounded(floorSample.median)))과 밝기가 겹친다"
                )
            }
        }
    }
    return violations
}

/// 대비를 견줄 (가구, 그 가구가 선 칸의 바닥) 짝. **실제 배치에서 만든다.**
///
/// 부서별 요청 목록(`departmentFurniture`)을 순회하면 두 가지가 빠진다 — 상단 밴드(회의실·
/// 대표실·탕비실)에 놓이는 가구 전부와, 목록에 없이 평면도가 직접 놓는 깔개 셋이다
/// (`rugGreen`·`rugBeige` 는 밴드 후보, `rugNavy` 는 자산 방). #520 리뷰에서 지적받아 고쳤다.
///
/// 벽 칸에 걸린 것(벽걸이·문)은 뺀다 — 견주는 면이 바닥이 아니라 벽이고, 실제로 벽걸이
/// 달력(207.8)은 벽(205.4~207.7)보다 밝다. 같은 종류가 여러 개 놓이는 방이 있어 중복도 접는다.
public func officeFurnitureFloorPairs(
    floor: [[FloorTile]],
    furniture: [FurniturePlacement]
) -> [(kind: FurnitureKind, floor: FloorTile)] {
    var seen: Set<String> = []
    var pairs: [(kind: FurnitureKind, floor: FloorTile)] = []
    for placement in furniture where !placement.kind.isWallMounted && !placement.kind.isDoorway {
        guard placement.tile.y >= 0, placement.tile.y < floor.count,
            placement.tile.x >= 0, placement.tile.x < floor[placement.tile.y].count
        else {
            continue
        }
        let tile = floor[placement.tile.y][placement.tile.x]
        guard tile != .wall else {
            continue
        }
        let key = "\(placement.kind.rawValue)|\(tile.rawValue)"
        guard seen.insert(key).inserted else {
            continue
        }
        pairs.append((placement.kind, tile))
    }
    return pairs.sorted {
        $0.kind.rawValue == $1.kind.rawValue
            ? $0.floor.rawValue < $1.floor.rawValue : $0.kind.rawValue < $1.kind.rawValue
    }
}

/// 실측표가 어기는 규칙을 모아 돌려준다(빈 배열 = 통과).
///
/// 판정을 목록으로 내는 이유는 **첫 위반에서 멈추지 않기** 위해서다 — 색을 손볼 때는 여러
/// 종류가 함께 움직이므로, 하나만 알려 주면 고치고 다시 돌리는 왕복이 그만큼 늘어난다.
///
/// 타일 텍스처 밝기는 **밖에서 받는다.** 에셋을 읽는 일은 실행 파일의 스프라이트 로더가 하고,
/// 규칙은 그 값이 어디서 왔는지 몰라도 된다 — 그래서 테스트가 가짜 표로 각 분기를 고정할 수 있다.
public func officeFloorColorViolations(
    samples: [OfficeColorSample],
    hour: Int,
    textureBrightness: (FloorTile) -> Double?,
    furnitureBrightness: ((FurnitureKind) -> Double?)? = nil,
    furniturePairs: [(kind: FurnitureKind, floor: FloorTile)] = []
) -> [String] {
    let prefix = "\(hour)시:"
    guard let corridor = samples.first(where: { $0.tile == .corridor }) else {
        return ["\(prefix) 통로 칸이 화면에 없다 — 복도가 그려졌는지부터 확인할 것"]
    }
    let rooms = samples.filter { $0.tile.isRoomFloor }
    // 방 바닥 다섯 종류가 다 나오지 않으면 밝기 비교의 대상이 빠진 것이다. 그 상태로 "통과"
    // 를 내면 재지 못한 종류가 정상으로 위장한다(빈 사무실을 성공으로 저장하던 것과 같은 구멍).
    guard rooms.count == 5 else {
        let measured = rooms.map(\.tile.rawValue).joined(separator: " · ")
        return ["\(prefix) 방 바닥 다섯 종류를 다 재지 못했다 (실측: \(measured))"]
    }

    var violations: [String] = []
    // **읽히는지부터 본다.** 그리는 쪽(`renderFloor`)은 텍스처를 못 얻으면 그 칸의 노드를
    // 아예 만들지 않아, 그 자리에 씬 배경색(rgb 23,23,28 → 밝기 24.6)이 남는다. 그런데 어두워진
    // 쪽이 벽이면 「통로가 벽보다 밝다」가 **벽이 사라졌기 때문에** 통과한다 — 벽 스프라이트
    // 이름을 어긋내 재현했더니 벽 밝기가 24.7 로 떨어지고 게이트는 exit 0 이었다.
    //
    // 방 바닥은 하한 190 이 같은 사고를 잡지만 벽에는 하한이 없다(창·벽등 때문에 값이 흔들려
    // 절대 범위를 줄 수 없다). 그래서 밝기가 아니라 **에셋이 있는가**를 직접 묻는다.
    for sample in samples where textureBrightness(sample.tile) == nil {
        violations.append(
            "\(prefix) \(sample.tile.rawValue) 타일 텍스처를 읽지 못했다 — 그 칸은 배경색으로"
                + " 남으므로 밝기 비교가 성립하지 않는다 (실측 \(rounded(sample.median)))"
        )
    }
    // 표본이 몇 칸뿐이면 중앙값이 더는 강건하지 않다 — 통과·실패 어느 쪽도 믿을 수 없다.
    for sample in samples where sample.tiles < officeFloorColorMinimumTiles {
        violations.append(
            "\(prefix) \(sample.tile.rawValue) 표본이 \(sample.tiles)칸뿐이다"
                + " (최소 \(officeFloorColorMinimumTiles)) — 중앙값이 강건하지 않다"
        )
    }
    // 새 오피스는 통로를 따뜻한 중성색으로 의도적으로 어둡게 두고, 방 섬을 밝게 띄운다.
    for room in rooms where corridor.median > room.median - officeCorridorRoomContrastMargin {
        violations.append(
            "\(prefix) 통로(\(rounded(corridor.median)))가 \(room.tile.rawValue)"
                + "(\(rounded(room.median))) 보다 충분히 어둡지 않다"
        )
    }
    // 벽은 방 섬의 대비 기준이 아니다. 밝기는 보지 않고 재는 자리만 확인한다.
    if !samples.contains(where: { $0.tile == .wall }) {
        violations.append("\(prefix) 벽 칸을 하나도 재지 못했다 — 재는 자리가 어긋났다")
    }
    for sample in rooms where sample.median < officeFloorBrightnessFloor {
        violations.append(
            "\(prefix) \(sample.tile.rawValue)(\(rounded(sample.median)))가 밝은 사무실 하한"
                + " \(rounded(officeFloorBrightnessFloor)) 아래다 — 사람이 배경에 묻힌다"
        )
    }
    // 바닥에 놓이는 가구는 그 방 바닥보다 어두워야 물건으로 읽힌다. 가구는 눌리지 않고 원본
    // 밝기로 그려지므로 스프라이트 밝기를 그대로 견준다 — 칸을 온전히 채우지 않아 렌더에서
    // 재면 배경이 섞인다(그래서 렌더 픽셀이 아니라 에셋을 읽는다).
    if let furnitureBrightness {
        for pair in furniturePairs {
            guard let floorSample = samples.first(where: { $0.tile == pair.floor }) else {
                continue
            }
            guard let brightness = furnitureBrightness(pair.kind) else {
                violations.append("\(prefix) \(pair.kind.rawValue) 가구 스프라이트를 읽지 못했다")
                continue
            }
            guard brightness > floorSample.median - officeFurnitureContrastMargin else {
                continue
            }
            violations.append(
                "\(prefix) \(pair.kind.rawValue)(\(rounded(brightness)))가"
                    + " \(pair.floor.rawValue) 바닥(\(rounded(floorSample.median)))과 밝기가 겹친다"
                    + " — 물건이 무늬로 읽힌다"
            )
        }
    }
    // 벽은 이 모델을 따르지 않는다 — `applyWallShading` 이 부서 색조·창·벽등을 따로 얹는다.
    // (텍스처를 못 읽는 경우는 위에서 이미 걸렀으므로 여기서는 건너뛴다.)
    // corridor는 전용 중성색으로 그려져 texture × mute 모델을 따르지 않는다.
    for sample in rooms {
        guard let texture = textureBrightness(sample.tile) else {
            continue
        }
        let model = texture * (1 - sample.tile.muteStrength)
        if abs(sample.median - model) > officeFloorModelTolerance {
            violations.append(
                "\(prefix) \(sample.tile.rawValue) 실측 \(rounded(sample.median))이 모델"
                    + " \(rounded(model))에서 \(rounded(abs(sample.median - model))) 벗어났다"
                    + " — 밝기 모델이 화면을 설명하지 못한다"
            )
        }
    }
    return violations
}

/// `--hour` 값을 읽는다. 못 읽으면 nil — 부르는 쪽이 그것으로 실행을 끊는다.
///
/// **조용히 기본값으로 물러서면 안 된다.** `--hour 2p` 같은 오타에서 낮 화면을 보고 밤을
/// 확인한 줄 알게 된다. `--room`·`--zone-columns` 가 이미 같은 이유로 오타를 끊는다.
///
/// 24 시 밖 값도 받는다 — `officeDaylight` 가 `((h % 24) + 24) % 24` 로 접는 것이 문서화된
/// 동작이고 테스트도 24·-1 을 고정하고 있다. 여기서 범위를 좁히면 그 계약이 둘로 갈린다.
///
/// `Int(raw)` 하나로 충분하다 — 소수(`2.5`)·지수(`1e30`)·오버플로 값 모두 nil 이 되므로
/// `officeParseZoneColumns` 처럼 Double 로 우회할 필요가 없다.
public func officeParseHour(_ raw: String) -> Int? {
    Int(raw)
}

private func rounded(_ value: Double) -> String {
    String(format: "%.1f", value)
}
