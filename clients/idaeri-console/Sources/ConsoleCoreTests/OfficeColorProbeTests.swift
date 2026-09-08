import ConsoleCore
import CoreGraphics
import Foundation

/// 바닥 색 게이트의 두 축을 고정한다 — **어디를 재는가**(좌표 변환)와 **무엇을 위반으로 보는가**(규칙).
///
/// 렌더 픽셀 실측은 이 러너에서 돌릴 수 없다(그림을 굽는 일은 SpriteKit·실행 파일 몫). 그래서
/// 여기서는 **밝기를 이미 아는 합성 이미지**를 만들어 좌표 변환만 검증하고, 규칙은 실측표를
/// 손으로 세워 분기별로 확인한다. 게이트가 실제 화면에서 통과·실패하는지는
/// `swift run IdaeriConsole --color-check` 가 본다.
func runOfficeColorProbeTests(_ t: TestRunner) {
    t.suite("OfficeColorProbe")

    verifyTileMapping(t)
    verifyInnerSampleWindow(t)
    verifyOccupiedTilesAreSkipped(t)
    verifyRetinaScale(t)
    verifyViolationRules(t)
    verifyHourParsing(t)
}

// MARK: - 좌표 변환

/// 칸마다 다른 밝기를 칠해 두고, 각 종류가 자기 칸의 밝기로 잡히는지 본다.
///
/// **y축 반전이 이 검사의 요점이다.** 씬 좌표는 아래에서 위로 자라고 픽셀 버퍼의 0번 줄은
/// 이미지 맨 위라, 뒤집는 것을 빠뜨리면 위아래가 통째로 바뀐 칸을 잰다. 그래서 위와 아래 줄에
/// **다른 종류·다른 밝기**를 놓는다 — 같은 값으로 채우면 뒤집혀도 통과한다.
private func verifyTileMapping(_ t: TestRunner) {
    // 3×2 격자(가로 3칸 · 세로 2줄), 타일 20px, 여백 없음.
    // row 0(맨 아래) = 어두운 카펫 40 · 40 · 40, row 1(맨 위) = 세라믹 200 · 200 · 200.
    let floor: [[FloorTile]] = [
        [.carpetDark, .carpetDark, .carpetDark],
        [.ceramic, .ceramic, .ceramic],
    ]
    let brightnessByRow = [40.0, 200.0]
    guard
        let image = syntheticFloorImage(
            floor: floor, tileSize: 20, brightnessByRow: brightnessByRow, scale: 1)
    else {
        t.expect(false, "합성 이미지를 만들지 못했다")
        return
    }
    let geometry = OfficeColorProbeGeometry(
        floor: floor,
        gridOrigin: .zero,
        tileSize: 20,
        occupiedTiles: []
    )
    let samples = officeMeasureFloorBrightness(
        image: image, geometry: geometry, sceneSize: CGSize(width: 60, height: 40))

    t.expectEqual(samples.count, 2, "종류 두 개가 잡힌다")
    let ceramic = samples.first { $0.tile == .ceramic }
    let carpet = samples.first { $0.tile == .carpetDark }
    t.expectEqual(ceramic?.tiles, 3, "세라믹 3칸")
    t.expectEqual(carpet?.tiles, 3, "어두운 카펫 3칸")
    // 아래 줄이 어둡고 위 줄이 밝다. 뒤집혀 있으면 이 두 단언이 서로 바뀐 값을 본다.
    t.expect(
        abs((ceramic?.median ?? 0) - 200) < 1,
        "위 줄(세라믹)이 200 으로 잡힌다 — 실제 \(ceramic?.median ?? -1)"
    )
    t.expect(
        abs((carpet?.median ?? 0) - 40) < 1,
        "아래 줄(어두운 카펫)이 40 으로 잡힌다 — 실제 \(carpet?.median ?? -1)"
    )
}

/// 칸 테두리를 극단값으로 칠해 두고, 안쪽 60% 만 재는지 본다.
///
/// 이음매를 물면 맞닿은 칸의 색이 섞여 들어온다. 테두리(각 변 20%)를 255 로 칠했으므로,
/// 안쪽만 재면 128 근처가 나오고 칸 전체를 재면 그보다 훨씬 밝아진다.
private func verifyInnerSampleWindow(_ t: TestRunner) {
    let floor: [[FloorTile]] = [[.woodA]]
    guard
        let image = syntheticFloorImage(
            floor: floor, tileSize: 20, brightnessByRow: [128], scale: 1, borderBrightness: 255)
    else {
        t.expect(false, "테두리 있는 합성 이미지를 만들지 못했다")
        return
    }
    let geometry = OfficeColorProbeGeometry(
        floor: floor, gridOrigin: .zero, tileSize: 20, occupiedTiles: [])
    let samples = officeMeasureFloorBrightness(
        image: image, geometry: geometry, sceneSize: CGSize(width: 20, height: 20))
    t.expect(
        abs((samples.first?.median ?? 0) - 128) < 1,
        "테두리(255)를 물지 않고 안쪽 128 만 잰다 — 실제 \(samples.first?.median ?? -1)"
    )
}

/// 가려진 칸으로 넘긴 좌표는 표본에서 빠진다.
private func verifyOccupiedTilesAreSkipped(_ t: TestRunner) {
    let floor: [[FloorTile]] = [[.woodB, .woodB, .woodB]]
    guard
        let image = syntheticFloorImage(
            floor: floor, tileSize: 20, brightnessByRow: [100], scale: 1)
    else {
        t.expect(false, "합성 이미지를 만들지 못했다")
        return
    }
    let geometry = OfficeColorProbeGeometry(
        floor: floor,
        gridOrigin: .zero,
        tileSize: 20,
        occupiedTiles: [TilePoint(x: 1, y: 0)]
    )
    let samples = officeMeasureFloorBrightness(
        image: image, geometry: geometry, sceneSize: CGSize(width: 60, height: 20))
    t.expectEqual(samples.first?.tiles, 2, "가려진 한 칸을 뺀 두 칸만 잰다")
}

/// 이미지가 씬보다 크면(레티나) 배율을 이미지 크기에서 구한다.
///
/// 배율을 2 로 못 박거나 1 로 가정하면 재는 자리가 절반·두 배로 어긋난다. 여기서는 위아래
/// 줄의 밝기를 다르게 두었으므로, 배율이 틀리면 두 종류의 값이 섞여 단언이 깨진다.
private func verifyRetinaScale(_ t: TestRunner) {
    let floor: [[FloorTile]] = [[.carpetDark], [.ceramic]]
    guard
        let image = syntheticFloorImage(
            floor: floor, tileSize: 20, brightnessByRow: [40, 200], scale: 2)
    else {
        t.expect(false, "2배 합성 이미지를 만들지 못했다")
        return
    }
    t.expectEqual(image.width, 40, "이미지가 씬 폭의 2배로 굽혔다")
    let geometry = OfficeColorProbeGeometry(
        floor: floor, gridOrigin: .zero, tileSize: 20, occupiedTiles: [])
    let samples = officeMeasureFloorBrightness(
        image: image, geometry: geometry, sceneSize: CGSize(width: 20, height: 40))
    t.expect(
        abs((samples.first { $0.tile == .ceramic }?.median ?? 0) - 200) < 1,
        "2배 이미지에서도 위 줄이 200 — 실제 \(samples.first { $0.tile == .ceramic }?.median ?? -1)"
    )
    t.expect(
        abs((samples.first { $0.tile == .carpetDark }?.median ?? 0) - 40) < 1,
        "2배 이미지에서도 아래 줄이 40"
    )
}

// MARK: - 판정 규칙

/// 정상 표본과, 규칙마다 하나씩 어긋낸 표본을 넣어 각 분기가 실제로 발화하는지 고정한다.
///
/// 수동 대조군(값을 손으로 되돌려 게이트를 돌려 보는 것)으로 확인한 것들이라, 여기 고정하지
/// 않으면 다음 변경에서 그 확인이 사라진다 — 이 PR 이 고치려던 문제와 같은 구조다.
private func verifyViolationRules(_ t: TestRunner) {
    // 2026-09-08 실측(1440×860)에 맞춘 정상 표본.
    let texture: [FloorTile: Double] = [
        .corridor: 236.9, .ceramic: 236.9, .carpetLight: 227.2,
        .carpetDark: 223.4, .woodA: 221.2, .woodB: 213.3, .wall: 244.3,
    ]
    func brightness(_ tile: FloorTile) -> Double? {
        texture[tile]
    }
    let healthy: [OfficeColorSample] = [
        sample(.corridor, 226.7), sample(.ceramic, 212.3), sample(.woodA, 210.9),
        sample(.carpetLight, 207.0), sample(.woodB, 206.9), sample(.carpetDark, 206.7),
        sample(.wall, 205.4),
    ]
    t.expectEqual(
        officeFloorColorViolations(samples: healthy, hour: 14, textureBrightness: brightness).count,
        0,
        "실측 표본은 위반 0"
    )

    // 통로가 어두워지면(0.78 사고) 방·벽 비교와 하한이 함께 걸린다.
    let darkCorridor = healthy.map { $0.tile == .corridor ? sample(.corridor, 83.7) : $0 }
    let corridorViolations = officeFloorColorViolations(
        samples: darkCorridor, hour: 14, textureBrightness: brightness)
    t.expectEqual(corridorViolations.filter { $0.contains("보다 밝지 않다") }.count, 6, "방 5 + 벽 1")
    t.expect(
        corridorViolations.contains { $0.contains("밝은 사무실 하한") },
        "통로가 하한 아래로 내려간 것도 잡는다"
    )

    // 방 하나만 어두워지면 하한과 모델 이탈이 걸린다(woodB 0.30 대조군).
    let darkRoom = healthy.map { $0.tile == .woodB ? sample(.woodB, 162.8) : $0 }
    let roomViolations = officeFloorColorViolations(
        samples: darkRoom, hour: 14, textureBrightness: brightness)
    t.expect(roomViolations.contains { $0.contains("밝은 사무실 하한") }, "방 하한 위반")
    t.expect(roomViolations.contains { $0.contains("밝기 모델이") }, "모델 이탈도 함께")

    // 누르는 값을 건드리지 않고 화면만 밝아지는 경우 — 모델만 잡을 수 있는 종류다.
    let brighterThanModel = healthy.map { $0.tile == .ceramic ? sample(.ceramic, 230.3) : $0 }
    t.expect(
        officeFloorColorViolations(
            samples: brighterThanModel, hour: 14, textureBrightness: brightness
        ).contains { $0.contains("밝기 모델이") },
        "모델보다 26 밝아진 것을 잡는다"
    )

    // 벽 에셋이 빠지면 벽이 배경색으로 남아 「통로가 벽보다 밝다」가 오히려 통과한다.
    func brightnessWithoutWall(_ tile: FloorTile) -> Double? {
        tile == .wall ? nil : texture[tile]
    }
    let vanishedWall = healthy.map { $0.tile == .wall ? sample(.wall, 24.7) : $0 }
    let wallViolations = officeFloorColorViolations(
        samples: vanishedWall, hour: 14, textureBrightness: brightnessWithoutWall)
    t.expect(
        wallViolations.contains { $0.contains("텍스처를 읽지 못했다") },
        "밝기가 아니라 에셋 유무로 잡는다 — 실제 \(wallViolations)"
    )

    // 벽 표본이 아예 없으면 그 규칙을 조용히 건너뛰지 않는다.
    t.expect(
        officeFloorColorViolations(
            samples: healthy.filter { $0.tile != .wall }, hour: 14, textureBrightness: brightness
        ).contains { $0.contains("벽 칸을 하나도") },
        "벽 표본 부재는 침묵이 아니라 위반"
    )

    // 표본이 몇 칸뿐이면 중앙값이 강건하지 않다.
    let thinSample = healthy.map {
        $0.tile == .woodA ? sample(.woodA, 210.9, tiles: 3) : $0
    }
    t.expect(
        officeFloorColorViolations(
            samples: thinSample, hour: 14, textureBrightness: brightness
        ).contains { $0.contains("표본이 3칸뿐") },
        "표본 수 하한이 걸린다"
    )

    // 방 바닥 종류가 빠진 채로는 판정 자체가 성립하지 않는다.
    let missingKind = healthy.filter { $0.tile != .woodB }
    t.expect(
        officeFloorColorViolations(
            samples: missingKind, hour: 14, textureBrightness: brightness
        ).contains { $0.contains("다섯 종류를 다 재지 못했다") },
        "종류가 빠지면 즉시 끊는다"
    )

    // 통로 자체가 없으면(복도가 안 그려졌으면) 다른 규칙을 보기 전에 끊는다.
    t.expectEqual(
        officeFloorColorViolations(
            samples: healthy.filter { $0.tile != .corridor }, hour: 14,
            textureBrightness: brightness
        ).count,
        1,
        "통로 부재는 한 줄로 끊는다"
    )
}

// MARK: - 인자 파싱

private func verifyHourParsing(_ t: TestRunner) {
    t.expectEqual(officeParseHour("14"), 14, "정상값")
    t.expectEqual(officeParseHour("0"), 0, "자정")
    // 24 시 밖도 받는다 — `officeDaylight` 가 접는 것이 문서화된 동작이다.
    t.expectEqual(officeParseHour("24"), 24, "24시는 그대로 받아 넘긴다")
    t.expectEqual(officeParseHour("-1"), -1, "음수도 받아 넘긴다")
    t.expect(officeParseHour("") == nil, "값이 없으면 거부(플래그 뒤가 비었을 때)")
    t.expect(officeParseHour("2p") == nil, "오타는 거부 — 조용히 기본값으로 물러서지 않는다")
    t.expect(officeParseHour("2.5") == nil, "소수는 거부")
    t.expect(officeParseHour("1e30") == nil, "지수 표기는 거부")
    t.expect(officeParseHour("999999999999999999999") == nil, "오버플로 값은 거부")
}

// MARK: - 합성 이미지

private func sample(
    _ tile: FloorTile, _ median: Double, tiles: Int = 40
) -> OfficeColorSample {
    OfficeColorSample(tile: tile, median: median, low: median, high: median, tiles: tiles)
}

/// 줄마다 정해진 밝기로 칠한 회색 이미지. `brightnessByRow[0]` 이 **맨 아래 줄**(씬 좌표 y=0)이다.
///
/// `borderBrightness` 를 주면 각 칸의 테두리(변마다 20%)를 그 값으로 칠한다 — 안쪽만 재는지
/// 확인할 때 쓴다.
private func syntheticFloorImage(
    floor: [[FloorTile]],
    tileSize: Int,
    brightnessByRow: [Double],
    scale: Int,
    borderBrightness: Double? = nil
) -> CGImage? {
    let columns = floor.first?.count ?? 0
    let rows = floor.count
    guard columns > 0, rows > 0, brightnessByRow.count == rows else {
        return nil
    }
    let width = columns * tileSize * scale
    let height = rows * tileSize * scale
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let border = tileSize * scale / 5
    for pixelY in 0..<height {
        // 메모리 0번 줄이 이미지 맨 위 = 격자의 마지막 줄.
        let row = rows - 1 - (pixelY / (tileSize * scale))
        let withinTileY = pixelY % (tileSize * scale)
        for pixelX in 0..<width {
            let withinTileX = pixelX % (tileSize * scale)
            let onBorder =
                withinTileX < border || withinTileX >= tileSize * scale - border
                || withinTileY < border || withinTileY >= tileSize * scale - border
            let level = onBorder ? (borderBrightness ?? brightnessByRow[row]) : brightnessByRow[row]
            let value = UInt8(max(0, min(255, level.rounded())))
            let index = (pixelY * width + pixelX) * 4
            bytes[index] = value
            bytes[index + 1] = value
            bytes[index + 2] = value
            bytes[index + 3] = 255
        }
    }
    var image: CGImage?
    bytes.withUnsafeMutableBytes { buffer in
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
            return
        }
        image = context.makeImage()
    }
    return image
}
