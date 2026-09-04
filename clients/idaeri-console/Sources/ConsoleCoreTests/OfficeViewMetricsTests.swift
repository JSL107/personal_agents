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
            let steps = metrics.tileSize / officeSpriteUnit
            // 허용하는 것은 정수배(1x · 2x · 3x …)와 정확히 1/2 축소뿐이다. 1/2 은 2픽셀에서
            // 1픽셀을 균일하게 버리므로 도트가 규칙적으로 남는다 — 0.83배처럼 어긋난 축소와
            // 근본이 다르다. 그 아래로는 내려가지 않는다(글자 하한 때문에 이름표가 안 읽힌다).
            t.expect(
                steps == 0.5 || (steps >= 1 && steps == steps.rounded()),
                "타일 \(metrics.tileSize)px 가 \(officeSpriteUnit)px 의 정수배도 1/2 배도 아니다"
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

    // 값이 이상하면 기본 단위로 닫는다(0 나눗셈·음수 방어).
    t.expectEqual(
        officeViewMetrics(viewWidth: 0, viewHeight: 0, columns: 23, rows: 27).tileSize,
        officeSpriteUnit,
        "창 크기가 0 이면 기본 단위"
    )
}
