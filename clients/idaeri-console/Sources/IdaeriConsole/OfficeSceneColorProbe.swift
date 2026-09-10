import AppKit
import ConsoleCore
import SpriteKit

/// 바닥 색 게이트의 **실행 쪽**. 그림을 굽고, 에셋 밝기를 읽고, 표를 낸다.
///
///     swift run IdaeriConsole --color-check [--hour 14] [--size 1440x860]
///
/// 재는 규칙과 판정은 `ConsoleCore` 의 `OfficeColorProbe` 가 갖는다 — 좌표 변환과 규칙이
/// 실행 파일 안에 있으면 검증 러너가 닿지 못해, 엉뚱한 칸을 재고 있어도 신호가 없다.

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

/// 가구 스프라이트의 **불투명 픽셀** 평균 밝기.
///
/// 투명 픽셀을 함께 세면 배경이 섞여 가구가 실제보다 어둡게 나온다. 렌더에서 재지 않는 이유도
/// 같다 — 가구는 칸을 온전히 채우지 않아 칸 평균에 바닥이 섞인다.
func officeFurnitureSpriteBrightness(_ kind: FurnitureKind) -> Double? {
    guard let image = SpriteLoader.furnitureTexture(kind)?.cgImage() as CGImage?,
        let pixels = OfficePixelGrid(image: image)
    else {
        return nil
    }
    return pixels.meanOpaque()
}

/// Brightness of the furniture actually used by modular room shells. The legacy
/// sprites are intentionally not mixed into this branch because they are hidden
/// when a complete shell is present.
func officeCozyFurnitureSpriteBrightness(_ kind: FurnitureKind) -> Double? {
    guard let image = SpriteLoader.cozyFurnitureTexture(kind)?.cgImage() as CGImage?,
        let pixels = OfficePixelGrid(image: image)
    else {
        return nil
    }
    return pixels.meanOpaque()
}

/// 한 시각의 사무실을 굽고 바닥 밝기를 재서 돌려준다. 명단은 `--pose-demo` 와 같은 고정 표본이다.
///
/// **백엔드를 쓰지 않는다.** 실제 스냅샷을 쓰면 인원·상태가 회차마다 달라 사람이 덮는 칸이
/// 바뀌고, 백엔드가 꺼져 있으면 부서 구역이 아예 만들어지지 않아(방은 그 부서에 사람이 있을
/// 때만 선다) 바닥 다섯 종류가 하나도 없는 빈 격자를 재게 된다.
func officeProbeFloorColors(
    hour: Int, size: CGSize
) -> (samples: [OfficeColorSample], furniturePairs: [(kind: FurnitureKind, floor: FloorTile)])? {
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
    let geometry = scene.colorProbeGeometry()
    return (
        officeMeasureFloorBrightness(image: image, geometry: geometry, sceneSize: size),
        officeFurnitureFloorPairs(floor: geometry.floor, furniture: geometry.furniture)
    )
}

/// 바닥 색 게이트. 실측표를 내고 규칙을 어기면 false.
func officeCheckFloorColors(hours: [Int], size: CGSize) -> Bool {
    var failures: [String] = []
    let usesModularCozyRooms = Department.allCases.allSatisfy {
        SpriteLoader.cozyDepartmentRoomTexture($0) != nil
    } && [CommonAreaKind.meeting, .president, .pantry].allSatisfy {
        SpriteLoader.cozyCommonAreaTexture($0) != nil
    }
    for hour in hours {
        guard let probe = officeProbeFloorColors(hour: hour, size: size) else {
            return false
        }
        let samples = probe.samples
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
        if usesModularCozyRooms {
            failures += officeCozyRoomColorViolations(
                samples: samples,
                hour: hour,
                furnitureBrightness: officeCozyFurnitureSpriteBrightness,
                furniturePairs: probe.furniturePairs.filter {
                    switch $0.kind {
                    case .desk, .chairDown, .chairUp, .sofa2, .sofa3,
                         .meetingTable, .coffeeTable, .coffeeMachine, .sinkCounter:
                        return true
                    default:
                        return false
                    }
                }
            )
        } else {
            failures += officeFloorColorViolations(
                samples: samples,
                hour: hour,
                textureBrightness: officeFloorTextureBrightness,
                furnitureBrightness: officeFurnitureSpriteBrightness,
                furniturePairs: probe.furniturePairs
            )
        }
    }
    for failure in failures {
        print("✗ \(failure)")
    }
    if failures.isEmpty {
        print("✓ 색 규칙 통과 — 필수 표면·표본·실내 밝기와 부서별 톤 차이가 유효하다")
    }
    return failures.isEmpty
}

private func rounded(_ value: Double) -> String {
    String(format: "%.1f", value)
}

private func signed(_ value: Double) -> String {
    (value >= 0 ? "+" : "") + rounded(value)
}
