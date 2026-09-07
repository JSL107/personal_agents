import Foundation

@testable import ConsoleCore

func runOfficeViewMetricsTests(_ t: TestRunner) {
    t.suite("OfficeViewMetrics")

    // 실사용 창. 격자 23x27 에 40px 를 깔면 920x1080 — 가로는 들어가고 세로가 30px 넘친다.
    // 잘리는 것이 맨 아래 바깥벽 한 줄이라 1배를 유지한다.
    let wide = officeViewMetrics(viewWidth: 960, viewHeight: 1050, columns: 23, rows: 27)
    t.expectEqual(wide.tileSize, 40, "실사용 창에서는 40px(1배)")

    // 최소 창. 세로 1080 이 563 을 크게 넘어(두 줄 여유로도 안 되어) 한 단계 내려간다.
    let short = officeViewMetrics(viewWidth: 960, viewHeight: 563, columns: 23, rows: 27)
    t.expectEqual(short.tileSize, 20, "최소 창에서는 20px(1/2배)")

    // 배율은 언제나 스프라이트 단위의 정수배여야 한다 — 비정수로 그리면 도트가 불규칙하게
    // 버려져 직선이 몇 칸마다 어긋난다. 창 크기를 촘촘히 훑어 예외가 없는지 본다.
    for width in stride(from: 400.0, through: 2000.0, by: 37.0) {
        for height in stride(from: 300.0, through: 1600.0, by: 41.0) {
            let metrics = officeViewMetrics(
                viewWidth: width, viewHeight: height, columns: 23, rows: 27
            )
            let steps = metrics.tileSize / officeScaleUnit(backingScale: 2)
            // **언제나 정수배다.** 축소 폴백(1/2 배)이 있던 것은 단위가 40px 이라 한 배수도 못
            // 들어가는 창이 있었기 때문인데, 20px 로 내린 뒤에는 최소 배수가 곧 20px 이라
            // 그 아래로 내려갈 이유가 없다. 그 아래는 글자 하한 때문에 이름표도 안 읽힌다.
            t.expect(
                steps >= 1 && steps == steps.rounded(),
                "타일 \(metrics.tileSize)px 가 \(officeScaleUnit(backingScale: 2))px 의 정수배가 아니다"
                    + " (창 \(width)x\(height))"
            )
        }
    }

    // 격자는 화면 가운데에 놓인다. 세로가 넘치면 원점이 음수가 되어 위아래가 고르게 잘린다.
    t.expectEqual(wide.originX, (960 - 23 * 40) / 2, "가로 중앙 정렬")
    t.expectEqual(wide.originY, (1050 - 27 * 40) / 2, "세로 중앙 정렬(넘치면 음수)")
    t.expect(wide.originY < 0, "실사용 창에서는 세로가 넘쳐 원점이 음수")

    // 창이 커지면 배수가 올라간다. 23x80=1840, 27x80=2160 이 들어가는 창.
    let huge = officeViewMetrics(viewWidth: 2000, viewHeight: 2200, columns: 23, rows: 27)
    t.expectEqual(huge.tileSize, 80, "큰 창에서는 80px(2배)")

    // 가로가 기준이다 — 세로만 아주 큰 창에서 가로를 넘는 배수를 고르면 방이 화면 밖으로 나간다.
    let narrow = officeViewMetrics(viewWidth: 960, viewHeight: 4000, columns: 23, rows: 27)
    t.expectEqual(narrow.tileSize, 40, "세로가 남아도 가로가 허용하는 배수까지만")

    // **계단이 촘촘해진 것을 고정한다.** 단위가 40px 이던 때는 이 창에서 40px 로 떨어졌다
    // (80px 을 쓰려면 세로 2000 이 필요했고 1900 이라 100px 모자랐다). 20px 단위에서는 60px 이다.
    t.expectEqual(
        officeViewMetrics(viewWidth: 1900, viewHeight: 1900, columns: 23, rows: 27).tileSize,
        60,
        "큰 창에서 40px 과 80px 사이의 배수를 쓴다"
    )
    // 세로 여유를 **결과 타일 두 줄** 로 재는지 — 단위 기준으로 재면 여기서 20px 로 떨어진다.
    t.expectEqual(
        officeViewMetrics(viewWidth: 1400, viewHeight: 1000, columns: 23, rows: 27).tileSize,
        40,
        "여유를 단위가 아니라 결과 타일로 재므로 40px 을 유지한다"
    )

    // ── backing scale ─────────────────────────────────────────────────────
    // **캐릭터·가구가 실제 화면 픽셀 기준으로 정수배여야 한다.** 그 에셋은 40px 기준이므로
    // 실제 배율은 `tileSize / 40 × backingScale` 이다. 1x 모니터에서 60px 단계를 고르면 1.5배가
    // 되어 원본 도트 하나가 화면 1px 또는 2px 로 번갈아 늘어난다.
    func characterPixelScale(_ tile: Double, _ scale: Double) -> Double {
        tile / officeReferenceTileSize * scale
    }
    for scale in [1.0, 2.0] {
        for width in stride(from: 600.0, through: 2400.0, by: 61.0) {
            for height in stride(from: 500.0, through: 2200.0, by: 67.0) {
                let metrics = officeViewMetrics(
                    viewWidth: width, viewHeight: height,
                    columns: 23, rows: 27, backingScale: scale
                )
                let pixels = characterPixelScale(metrics.tileSize, scale)
                t.expect(
                    pixels >= 1 && pixels == pixels.rounded(),
                    "backingScale \(scale) · 창 \(width)x\(height) 에서 캐릭터 실제 배율"
                        + " \(pixels) 가 정수가 아니다 (타일 \(metrics.tileSize)px)"
                )
            }
        }
    }
    // 1x 에서는 60px 단계를 쓰지 않는다 — 캐릭터가 1.5배가 되기 때문이다.
    t.expectEqual(
        officeViewMetrics(
            viewWidth: 1900, viewHeight: 1900, columns: 23, rows: 27, backingScale: 1
        ).tileSize,
        40,
        "1x 에서는 40px 단위라 60px 을 건너뛴다"
    )
    // 2x 에서는 같은 창에서 60px 을 쓴다(실제 픽셀로는 캐릭터 3배).
    t.expectEqual(
        officeViewMetrics(
            viewWidth: 1900, viewHeight: 1900, columns: 23, rows: 27, backingScale: 2
        ).tileSize,
        60,
        "2x 에서는 20px 단위라 60px 을 쓴다"
    )

    // 값이 이상하면 기본 단위로 닫는다(0 나눗셈·음수 방어).
    t.expectEqual(
        officeViewMetrics(viewWidth: 0, viewHeight: 0, columns: 23, rows: 27).tileSize,
        officeSpriteUnit,
        "창 크기가 0 이면 기본 단위"
    )

    // ── 방 포커스 ───────────────────────────────────────────────────────────
    // 방 하나(10x7 칸)를 실사용 창에 담는다. 방 문과 벽이 경계에 붙어 있어 여유 1칸을 물려
    // 12x9 칸이 기준이고, 960/12 = 80 이라 2배가 나온다.
    // `OfficeRect` 는 `OfficeRoomLayout.swift` 에 이미 있는 값 타입이다.
    let room = OfficeRect(x: 1, y: 6, width: 10, height: 7)
    let focused = officeFocusedViewMetrics(
        viewWidth: 960, viewHeight: 1050, columns: 23, rows: 27, focus: room
    )
    t.expectEqual(focused.tileSize, 80, "방 뷰는 80px(2배)")

    // 실제 구역 크기로도 2배가 나온다 — `DepartmentZone.width` 는 좌우 벽을 포함한
    // `zoneWidth + 1 = 11` 이다(`OfficeFloorPlan.swift:1922`). 여유를 1 칸 물리면 13x9 가 되어
    // 배수가 1 로 떨어진다.
    let realZone = OfficeRect(x: 1, y: 6, width: 11, height: 7)
    t.expectEqual(
        officeFocusedViewMetrics(
            viewWidth: 960, viewHeight: 1050, columns: 23, rows: 27, focus: realZone
        ).tileSize,
        80,
        "실제 구역 크기(11x7)에서도 80px"
    )

    // 방 중심이 화면 중심에 온다.
    let centerX = focused.originX + (room.x + room.width / 2) * focused.tileSize
    let centerY = focused.originY + (room.y + room.height / 2) * focused.tileSize
    t.expect(abs(centerX - 480) < 0.5, "방 중심이 가로 중앙 (실제 \(centerX))")
    t.expect(abs(centerY - 525) < 0.5, "방 중심이 세로 중앙 (실제 \(centerY))")

    for width in stride(from: 500.0, through: 1800.0, by: 53.0) {
        let zoomed = officeFocusedViewMetrics(
            viewWidth: width, viewHeight: 900, columns: 23, rows: 27, focus: room
        )
        let steps = zoomed.tileSize / officeSpriteUnit
        t.expect(
            steps == 0.5 || (steps >= 1 && steps == steps.rounded()),
            "방 뷰 타일 \(zoomed.tileSize)px 가 정수배도 1/2 배도 아니다 (창 폭 \(width))"
        )
        // 눌러서 확대한 것이 축소가 되면 안 된다.
        let full = officeViewMetrics(
            viewWidth: width, viewHeight: 900, columns: 23, rows: 27
        )
        t.expect(
            zoomed.tileSize >= full.tileSize,
            "방 뷰가 전체 뷰보다 크거나 같다 (창 폭 \(width))"
        )
    }
}
