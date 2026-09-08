import AppKit
import ConsoleCore
import SpriteKit

/// 렌더 픽셀에서 바닥·벽의 밝기를 직접 재서 색 회귀를 판정한다.
///
///     swift run IdaeriConsole --color-check
///
/// 색은 **파라미터끼리 비교해서는 판정할 수 없다.** 화면 밝기는 원본 텍스처 밝기 ×
/// 누르는 양 × 섞는 색의 곱이고, 그 중 첫 값이 종류마다 크게 달라 누르는 양의 순서가
/// 결과 밝기의 순서와 뒤집힌다. 실제로 통로 누르기가 0.78 까지 올라가 복도가 벽보다
/// 어두워졌는데(당시 실측 26.9 대 87.0) 파라미터 단언은 초록이었다.
///
/// 그때 값을 되돌린 근거는 렌더 한 장을 사람이 재 본 **일회성 실측**이었다. 같은 일이
/// 다시 나도 신호가 없다는 뜻이라, 그 실측을 명령 하나로 되돌릴 수 있게 옮긴 것이 이 파일이다.
///
/// **시간대 조명은 이 경로로 볼 수 없다.** 시간대는 창유리·빛기둥·벽등만 물들이므로
/// (화면 전체를 덮던 색막은 걷어냈다 — `OfficeDaylight`) 시각을 바꿔도 화면 전체 평균이
/// 2.6/255 밖에 움직이지 않는다(실측 173.5~176.1). 그 축은 빛의 **데이터**를 그대로 보는
/// `OfficeIdleTests` 의 단언이 맡는다 — 빛 세기 단조성·벽등 점등 시간·하늘 위아래 색.
struct OfficeColorProbeGeometry {
    let plan: OfficeFloorPlan
    /// 격자 좌하단의 씬 좌표.
    let gridOrigin: CGPoint
    let tileSize: CGFloat
    /// 가구·사람이 덮은 칸. 바닥색을 재는 대상에서 뺀다 — 스프라이트가 위로 자라므로
    /// 발이 닿는 칸만 빼면 그 위 칸에서 가구 색을 바닥색으로 잘못 잰다.
    let occupiedTiles: Set<TilePoint>
}

/// 한 종류의 바닥이 화면에서 실제로 갖는 밝기.
struct OfficeColorSample {
    let tile: FloorTile
    /// 칸별 평균 밝기의 **중앙값**(0~255). 평균이 아닌 이유는 바닥 위에 얹힌 것들이 소수의
    /// 칸을 크게 끌어당기기 때문이다 — 부서 문패·밴드 이름표가 덮은 칸(실측 99~159, 확인:
    /// (17,1)=「콘텐츠」 문패 · (25,16)=「탕비실」 이름표)과 창 빛기둥이 닿은 칸이 그렇다.
    /// 중앙값은 그 소수에 흔들리지 않는다.
    let median: Double
    let low: Double
    let high: Double
    let tiles: Int
}

/// 렌더 이미지에서 바닥 종류별 밝기를 잰다. 칸이 전부 가려진 종류는 결과에서 빠진다.
func officeMeasureFloorBrightness(
    image: CGImage,
    geometry: OfficeColorProbeGeometry,
    sceneSize: CGSize
) -> [OfficeColorSample] {
    guard let pixels = OfficePixelGrid(image: image) else {
        return []
    }
    // 텍스처는 레티나 배율로 굽히므로(실측 --size 1440x860 → 2880×1720 픽셀) 배율을
    // 상수로 두지 않고 실제 이미지 크기에서 구한다.
    let scale = Double(image.width) / Double(sceneSize.width)
    var byKind: [FloorTile: [Double]] = [:]
    for row in 0..<geometry.plan.rows {
        for column in 0..<geometry.plan.columns {
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
            byKind[geometry.plan.floor[row][column], default: []].append(brightness)
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

/// 구운 타일 PNG 자체의 평균 밝기. `scripts/draw-tiles.py` 가 굽고 나서 출력하는 값과 같다.
///
/// 표로 적어 두지 않고 **에셋에서 다시 재는** 이유는, 타일을 다시 구우면 손으로 옮긴 숫자가
/// 조용히 낡기 때문이다. 화면 밝기 모델(`텍스처 × (1 - 누르기)`)이 아직 성립하는지 보는
/// 대조군이라, 낡은 값으로는 그 확인 자체가 성립하지 않는다.
func officeFloorTextureBrightness(_ tile: FloorTile) -> Double? {
    guard let image = SpriteLoader.floorTexture(tile)?.cgImage() as CGImage?,
        let pixels = OfficePixelGrid(image: image)
    else {
        return nil
    }
    return pixels.mean()
}

/// 픽셀을 한 번만 읽어 두고 여러 자리에서 재는 버퍼.
///
/// `CGBitmapContext` 의 **메모리 0번 줄은 이미지 맨 위**다. 씬 좌표는 아래에서 위로 자라므로
/// 세로를 뒤집지 않으면 위아래가 통째로 바뀐 자리를 잰다(빛기둥 텍스처에서 같은 실수를 한 적이 있다).
struct OfficePixelGrid {
    private let bytes: [UInt8]
    private let width: Int
    private let height: Int

    init?(image: CGImage) {
        let width = image.width
        let height = image.height
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

    func mean() -> Double {
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

    /// 칸 하나의 평균 밝기. 이음매를 피해 **안쪽 60%** 만 잰다.
    func meanBrightness(
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

/// 한 시각의 사무실을 굽고 바닥 밝기를 재서 돌려준다. 명단은 `--pose-demo` 와 같은 고정 표본이다.
///
/// **백엔드를 쓰지 않는다.** 실제 스냅샷을 쓰면 인원·상태가 회차마다 달라 사람이 덮는 칸이
/// 바뀌고, 백엔드가 꺼져 있으면 부서 구역이 아예 만들어지지 않아(방은 그 부서에 사람이 있을
/// 때만 선다) 바닥 다섯 종류가 하나도 없는 빈 격자를 재게 된다.
func officeProbeFloorColors(hour: Int, size: CGSize) -> [OfficeColorSample]? {
    let scene = OfficeScene(size: size)
    scene.scaleMode = .resizeFill
    scene.hourOverride = hour
    scene.skipsChoreography = true
    let view = SKView(frame: CGRect(origin: .zero, size: size))
    view.presentScene(scene)
    scene.sync(agents: poseDemoAgents(), approvals: [])
    // `applyPoseDemo` 는 부르지 않는다. 사람을 가구 앞으로 흩는 것은 자세 확인용이고 여기서는
    // 사람이 덮은 칸을 어차피 재지 않는다 — 게다가 새벽·밤에는 출근한 사람이 없어 그 함수가
    // 실패로 끊어 버려, 정작 밤 화면을 봐야 하는 시각에서 실측이 불가능해진다.
    guard let texture = view.texture(from: scene), let image = texture.cgImage() as CGImage? else {
        FileHandle.standardError.write(Data("씬을 이미지로 만들지 못했다\n".utf8))
        return nil
    }
    return officeMeasureFloorBrightness(
        image: image, geometry: scene.colorProbeGeometry(), sceneSize: size)
}

/// 화면에서 가장 어두워도 되는 바닥 밝기.
///
/// 이 사무실은 **모든 바닥이 사람보다 밝다**는 전제로 칠해져 있다(밝은 톤 전환 이후).
/// 셔츠 실측이 186 이라 바닥이 그 아래로 내려가면 지나가는 사람이 배경에 묻힌다 —
/// 한때 통로를 184 까지 올렸다가 셔츠(185.7)와 겹쳐 같은 문제가 반대편에서 되돌아온 적이 있다.
let officeFloorBrightnessFloor = 190.0

/// 통로가 방·벽보다 밝다고 인정할 최소 여유. 순서만 지키게 하고 절대값은 묶지 않는다 —
/// 타일을 다시 구우면 값은 함께 움직여도 순서는 유지돼야 하는 것이 규칙이다.
/// (실측 여유는 통로−방 14.4 · 통로−벽 19~29 이라 이 문턱에 정상 변동으로 걸리지 않는다.
/// 벽 값만 창 크기·시각에 따라 197.7~207.7 로 흔들린다 — 창·벽등이 함께 잡히기 때문이다.)
let officeCorridorBrightnessMargin = 5.0

/// 실측이 모델(`텍스처 × (1 - 누르기)`)에서 벗어나도 되는 폭.
///
/// 모델은 **어두운 회색을 섞는 것을 순수 검정으로 근사**하므로 실측보다 낮게 나온다
/// (섞는 색 rgb(0.17,0.16,0.18) + 부서 색조). 실측 편차는 +2.1~+8.6 이었고 그 위로 여유를 뒀다.
/// 이 단언이 지키는 것은 값이 아니라 **모델이 아직 화면을 설명한다**는 사실이다 —
/// 유닛 테스트(`OfficeFloorPlanTests`)가 그 모델로 밝기를 판정하므로, 모델이 화면과
/// 어긋나기 시작한 것은 여기서만 알 수 있다.
let officeFloorModelTolerance = 12.0

/// 바닥 색 게이트. 실측표를 내고 규칙을 어기면 false.
func officeCheckFloorColors(hours: [Int], size: CGSize) -> Bool {
    var failures: [String] = []
    for hour in hours {
        guard let samples = officeProbeFloorColors(hour: hour, size: size) else {
            return false
        }
        print("── \(hour)시 · 오피스 뷰 \(Int(size.width))x\(Int(size.height))")
        print("   종류           실측  (p10~p90 · 칸수)    텍스처   모델    편차")
        print("   * 판정은 실측(중앙값)으로 한다 — p10 은 문패·이름표가 덮은 칸을 물고 있다")
        for sample in samples {
            let texture = officeFloorTextureBrightness(sample.tile)
            let model = texture.map { $0 * (1 - sample.tile.muteStrength) }
            print(
                "   \(sample.tile.rawValue.padding(toLength: 12, withPad: " ", startingAt: 0))"
                    + "  \(rounded(sample.median))"
                    + "  (\(rounded(sample.low))~\(rounded(sample.high)) · \(sample.tiles)칸)"
                    + "   \(texture.map(rounded) ?? "—")"
                    + "   \(model.map(rounded) ?? "—")"
                    + "   \(model.map { signed(sample.median - $0) } ?? "—")"
            )
        }
        failures += officeFloorColorViolations(samples: samples, hour: hour)
    }
    for failure in failures {
        print("✗ \(failure)")
    }
    if failures.isEmpty {
        print("✓ 바닥 색 규칙 통과 — 통로가 가장 밝고, 모든 바닥이 사람보다 밝다")
    }
    return failures.isEmpty
}

/// 실측표가 어기는 규칙을 모아 돌려준다(빈 배열 = 통과).
///
/// 판정을 목록으로 내는 이유는 **첫 위반에서 멈추지 않기** 위해서다 — 색을 손볼 때는 여러
/// 종류가 함께 움직이므로, 하나만 알려 주면 고치고 다시 돌리는 왕복이 그만큼 늘어난다.
func officeFloorColorViolations(samples: [OfficeColorSample], hour: Int) -> [String] {
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
    for sample in samples where officeFloorTextureBrightness(sample.tile) == nil {
        violations.append(
            "\(prefix) \(sample.tile.rawValue) 타일 텍스처를 읽지 못했다 — 그 칸은 배경색으로"
                + " 남으므로 밝기 비교가 성립하지 않는다 (실측 \(rounded(sample.median)))"
        )
    }
    // 통로는 어느 방과도 혼동되면 안 되는 유일한 자리다 — 전용 텍스처가 없어 겹치지 않는
    // 축이 밝기뿐이고, 복도에 사람이 지나가므로 배경이 사람보다 밝아야 셔츠 색이 산다.
    for room in rooms where corridor.median < room.median + officeCorridorBrightnessMargin {
        violations.append(
            "\(prefix) 통로(\(rounded(corridor.median)))가 \(room.tile.rawValue)"
                + "(\(rounded(room.median))) 보다 밝지 않다"
        )
    }
    // 벽과의 관계는 따로 본다. 0.78 사고가 정확히 이 자리였다 — 복도가 벽보다 어두워
    // 통로가 아니라 바닥에 뚫린 구멍으로 읽혔다.
    //
    // 벽이 표본에 없으면 **건너뛰지 않고 위반으로 낸다.** 격자 테두리가 벽이라 없을 수 없는데,
    // 그래도 없다면 재는 자리가 어긋난 것이다 — 그 상태의 침묵은 통과와 구별되지 않는다.
    if let wall = samples.first(where: { $0.tile == .wall }) {
        if corridor.median < wall.median + officeCorridorBrightnessMargin {
            violations.append(
                "\(prefix) 통로(\(rounded(corridor.median)))가 벽(\(rounded(wall.median))) 보다"
                    + " 밝지 않다 — 통로가 바닥에 뚫린 구멍으로 읽힌다"
            )
        }
    } else {
        violations.append("\(prefix) 벽 칸을 하나도 재지 못했다 — 재는 자리가 어긋났다")
    }
    for sample in rooms + [corridor] where sample.median < officeFloorBrightnessFloor {
        violations.append(
            "\(prefix) \(sample.tile.rawValue)(\(rounded(sample.median)))가 밝은 사무실 하한"
                + " \(rounded(officeFloorBrightnessFloor)) 아래다 — 사람이 배경에 묻힌다"
        )
    }
    // 벽은 이 모델을 따르지 않는다 — `applyWallShading` 이 부서 색조·창·벽등을 따로 얹는다.
    // (텍스처를 못 읽는 경우는 위에서 이미 걸렀으므로 여기서는 건너뛴다.)
    for sample in rooms + [corridor] {
        guard let texture = officeFloorTextureBrightness(sample.tile) else {
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

private func rounded(_ value: Double) -> String {
    String(format: "%.1f", value)
}

private func signed(_ value: Double) -> String {
    (value >= 0 ? "+" : "") + rounded(value)
}
