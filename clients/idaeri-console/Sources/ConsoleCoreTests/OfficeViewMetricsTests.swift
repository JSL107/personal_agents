import Foundation

@testable import ConsoleCore

func runOfficeViewMetricsTests(_ t: TestRunner) {
    t.suite("OfficeViewMetrics")

    let perspectiveRegion = OfficePerspectiveRegion(originX: 2, originY: 3, width: 10, height: 7)
    let perspectiveFront = officeProjectedFloorPoint(
        tileX: 2, tileY: 3, tileSize: 40,
        gridOriginX: 10, gridOriginY: 20, region: perspectiveRegion
    )
    t.expectEqual(perspectiveFront.x, 10 + 2.5 * 40, "2.5D 앞 경계 x는 기존 타일 중심을 유지")
    t.expectEqual(perspectiveFront.y, 20 + 3 * 40, "2.5D 앞 경계 y는 방 경계를 유지")

    let perspectiveBack = officeProjectedFloorPoint(
        tileX: 2, tileY: 9, tileSize: 40,
        gridOriginX: 10, gridOriginY: 20, region: perspectiveRegion
    )
    t.expect(perspectiveBack.x > perspectiveFront.x, "방 뒤쪽의 왼쪽 좌석은 소실점 쪽으로 수렴")
    t.expectEqual(perspectiveBack.y, 20 + 9 * 40, "2.5D 뒤 경계 y도 방 경계를 유지")

    let perspectiveMiddle = officeProjectedFloorPoint(
        tileX: 6.5, tileY: 6, tileSize: 40,
        gridOriginX: 10, gridOriginY: 20, region: perspectiveRegion
    )
    t.expectEqual(perspectiveMiddle.x, 10 + 7 * 40, "방 중심선은 깊이와 무관하게 고정")
    t.expect(perspectiveMiddle.y > 20 + 6 * 40, "중간 깊이는 앞쪽 간격을 넓히도록 재분배")

    let wideDesk = officeProjectedFloorPoint(
        tileX: 2, tileY: 9, footprintWidth: 2, tileSize: 40,
        gridOriginX: 10, gridOriginY: 20, region: perspectiveRegion
    )
    t.expect(wideDesk.x > perspectiveBack.x, "두 칸 가구는 점유 범위 중심을 같은 원근으로 투영")

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

    // ── 창 크기를 도면에서 거꾸로 잡기 ────────────────────────────────────
    //
    // 표본은 **실측한 모니터 셋**이다(2026-09-07, 전부 backingScale 2). 임의의 숫자를 쓰면
    // 계단 경계를 비껴간 값만 검사하게 되어, 정작 사용자가 쓰는 화면에서 깨지는 것을 못 잡는다.
    // 여유는 창 세로에서 타이틀바(32)+탭 막대(41)=73 을 뺀 값이다.
    let studioDisplay = officeWindowFit(availableWidth: 2560, availableHeight: 1349 - 73)
    t.expectEqual(studioDisplay?.tileSize, 60, "2560x1349 는 3열 60px 을 감당한다")
    t.expectEqual(studioDisplay?.zoneColumns, 3, "가로로 넓은 화면은 3열")
    t.expectEqual(studioDisplay?.width, 2100, "3열 35칸 x 60px")
    t.expectEqual(studioDisplay?.height, 1200, "3열 20줄 x 60px")

    let portraitMonitor = officeWindowFit(availableWidth: 1080, availableHeight: 1890 - 73)
    t.expectEqual(portraitMonitor?.tileSize, 40, "세로 모니터는 폭이 3열 60px 에 못 미친다")
    t.expectEqual(portraitMonitor?.zoneColumns, 2, "세로로 긴 화면은 2열")
    t.expectEqual(portraitMonitor?.height, 1080, "2열 27줄 x 40px — 잘라내기 없이 꼭 맞는다")

    let landscapeMonitor = officeWindowFit(availableWidth: 1920, availableHeight: 1050 - 73)
    t.expectEqual(landscapeMonitor?.tileSize, 40, "1920x1050 은 3열 40px")
    t.expectEqual(landscapeMonitor?.zoneColumns, 3, "3열 20줄이 977 에 들어간다")

    // **여유 두 줄은 쓰지 않는다.** `officeViewMetrics` 는 바깥벽 두 줄을 잘라서라도 배율을
    // 지키지만, 창 크기를 우리가 정하는 자리에서 잘라낼 이유가 없다. 2열 27줄 x 40px 은
    // 1080 이 온전히 필요하고, 1px 이라도 모자라면 한 계단 내려가야 맞다.
    t.expectEqual(
        officeWindowFit(availableWidth: 1080, availableHeight: 1080)?.tileSize, 40,
        "세로가 딱 1080 이면 40px"
    )
    t.expectEqual(
        officeWindowFit(availableWidth: 1080, availableHeight: 1079)?.tileSize, 20,
        "1px 모자라면 잘라내지 않고 20px 로 내려간다"
    )

    // 사용자가 실제로 쓰는 창(세로 모니터 위 절반 1080x945). 오피스 뷰는 872 뿐이라 어느
    // 배치로도 40px 이 안 나온다 — 2열은 세로가(1080 필요), 3열은 폭이(1400 필요) 모자란다.
    // 이 창을 고치는 길은 창을 키우는 것뿐이라는 근거가 여기 남는다.
    t.expectEqual(
        officeWindowFit(availableWidth: 1080, availableHeight: 945 - 73)?.tileSize, 20,
        "1080x945 창에서는 40px 이 구조적으로 불가능하다"
    )

    // 1x 모니터는 계단이 40 · 80 뿐이라 같은 화면에서도 답이 다르다.
    t.expectEqual(
        officeWindowFit(availableWidth: 2560, availableHeight: 1276, backingScale: 1)?.tileSize,
        40,
        "1x 에서는 60px 단계가 없어 40px 에 머문다"
    )

    // 한 계단도 못 들어가는 화면이면 nil — 부르는 쪽이 자기 기본값으로 처리한다.
    t.expect(
        officeWindowFit(availableWidth: 300, availableHeight: 300) == nil,
        "20px 한 배수도 안 들어가면 nil"
    )
    t.expect(
        officeWindowFit(availableWidth: 0, availableHeight: 800) == nil,
        "폭이 0 이면 nil"
    )

    // 20px 계단밖에 못 담는 화면에서는 도면이 앱 최소 크기(720×560)보다 작아진다 —
    // 1366×768 · 1280×800 에서 3열 20px 도면이 700×400 이다. 창을 그 크기로 만들면 루트 뷰가
    // 창 밖으로 밀리므로, 부르는 쪽(`officeWindowSizeFittingFloorPlan`)이 최소까지 키운다.
    // 여기서는 그 보정이 필요한 화면이 실재한다는 사실만 못 박는다.
    for (width, height) in [(1366.0, 768.0), (1280.0, 800.0)] {
        let fit = officeWindowFit(availableWidth: width, availableHeight: height - 73)
        t.expect(
            fit != nil && fit!.width < 720,
            "화면 \(width)x\(height) 은 도면(\(fit?.width ?? -1))이 앱 최소 폭보다 작다"
        )
    }

    // ── 계단 바로 아래에 멈춘 창을 한 계단만 올리기 ───────────────────────
    //
    // 표본은 **실측한 창과 화면**이다(2026-09-08 신고). 임의의 숫자를 쓰면 계단 경계를 비껴간
    // 값만 검사하게 되어, 정작 사용자가 쓰는 화면에서 깨지는 것을 못 잡는다.
    //
    // 첫 표본은 세로 모니터(1080x1920)에 붙인 창 936x945 다 — 오피스 뷰는 945 - 41(탭 막대)
    // = 904 뿐이라 2열 40px(1080 필요)에 세로가 모자라 20px 로 그려졌다.
    let stuckJustBelow = officeSnapUpFit(
        viewWidth: 936, viewHeight: 904,
        maxViewWidth: 1080, maxViewHeight: 1890 - 73
    )
    t.expectEqual(stuckJustBelow?.tileSize, 40, "20px 에 걸린 창을 40px 로 올린다")
    t.expectEqual(stuckJustBelow?.zoneColumns, 2, "폭 936 은 3열(1400 필요)을 못 담는다")
    t.expectEqual(stuckJustBelow?.height, 1080, "2열 27줄 x 40px — 잘림 없는 크기가 여유 안에 든다")
    // **이미 충분한 축은 줄이지 않는다.** 2열 40px 은 폭 920 이면 되지만 창은 936 이다 —
    // 필요치를 그대로 쓰면 세로로 키우면서 옆으로 오므라든다.
    t.expectEqual(stuckJustBelow?.width, 936, "필요보다 넓은 폭은 그대로 둔다")

    // 신고 당시 실제로 떠 있던 창 — 1920x1080 화면(작업영역 세로 1019)의 왼쪽 절반에 붙은
    // 960x989 다. 이 화면은 세로가 1019 뿐이라 2열(1080·잘라도 1000)이 **어느 쪽으로도**
    // 불가능하고, 남는 길은 폭을 3열 40px(1400)까지 넓히는 것뿐이다. 여유를 0.2 로 잡았을 때
    // 걸러진 것이 정확히 이 창이었다(1400/960 = 1.46).
    let reportedWindow = officeSnapUpFit(
        viewWidth: 960, viewHeight: 989 - 32 - 41,
        maxViewWidth: 1920, maxViewHeight: 1019 - 73
    )
    t.expectEqual(reportedWindow?.tileSize, 40, "신고 창은 폭을 넓혀 40px 에 닿는다")
    t.expectEqual(reportedWindow?.zoneColumns, 3, "세로가 1019 뿐이라 2열은 어느 쪽으로도 불가")
    t.expectEqual(reportedWindow?.width, 1400, "3열 35칸 x 40px")
    t.expectEqual(reportedWindow?.height, 916, "세로는 이미 3열 20줄(800)을 넘어 그대로 둔다")

    // 사용자가 **일부러** 작게 만든 창은 건드리지 않는다. 계단이 2배씩 뛰어 한 계단 위가
    // 늘 손 닿는 거리에 있는 것은 아니다 — 그때 자동으로 키우면 보정이 아니라 방해다.
    t.expect(
        officeSnapUpFit(
            viewWidth: 500, viewHeight: 500, maxViewWidth: 2560, maxViewHeight: 1400
        ) == nil,
        "40px(3열 1400)까지 180% 를 늘려야 하는 창은 그냥 둔다"
    )
    // 여유(tolerance)를 열어 주면 같은 창도 올라간다 — 막은 것이 화면이 아니라 정책임을
    // 못 박는다. 가드를 빼면 위 단언이 실패한다.
    t.expectEqual(
        officeSnapUpFit(
            viewWidth: 500, viewHeight: 500, maxViewWidth: 2560, maxViewHeight: 1400,
            tolerance: 2.0
        )?.tileSize,
        40,
        "여유를 200% 로 열면 같은 창도 40px 로 올라간다"
    )

    // **여유는 다음 계단까지 남은 거리에 상대적이다.** 계단 간격이 구간마다 달라서(20 → 40 은
    // 2배, 40 → 60 은 1.5배) 고정 비율을 쓰면 뒷 구간이 통째로 덮인다 — 3열 40px 에 정확히
    // 선 1400x800 뷰가 폭 1px 만 늘어도 60px(2100x1200)로 점프했다. 화면은 그 크기를 담을
    // 수 있으므로, 막는 것은 화면이 아니라 이 규칙이다.
    t.expect(
        officeSnapUpFit(
            viewWidth: 1401, viewHeight: 800, maxViewWidth: 2560, maxViewHeight: 1276
        ) == nil,
        "40px 에 온전히 선 창은 폭이 1px 늘어도 60px 로 뛰지 않는다"
    )
    // 같은 창도 40 → 60 구간의 절반(1.25배)을 넘겨 오면 올라간다 — 계단이 아니라 거리가
    // 기준이라는 뜻이다.
    t.expectEqual(
        officeSnapUpFit(
            viewWidth: 1700, viewHeight: 1000, maxViewWidth: 2560, maxViewHeight: 1276
        )?.tileSize,
        60,
        "60px 까지 1.24 배 남은 창은 마저 올라간다"
    )

    // **온전한 후보는 배치를 가리지 않고 먼저 이긴다.** 잘라낼 줄 수를 배치 안쪽에서 돌리면
    // 한 배치가 잘린 후보로 자리를 잡은 뒤 다른 배치의 온전한 후보가 "덜 늘어나지 않는다" 는
    // 이유로 탈락한다 — 아래 창에서 2열 잘린 후보(1.47배)가 3열 온전한 후보(1.49배)를
    // 밀어냈다. 온전히 그릴 수 있는데 바깥벽을 자르는 것은 어느 배치에서도 이유가 없다.
    let wholeBeatsClipped = officeSnapUpFit(
        viewWidth: 940, viewHeight: 680, maxViewWidth: 1920, maxViewHeight: 1000
    )
    t.expectEqual(wholeBeatsClipped?.zoneColumns, 3, "3열 온전한 도면이 2열 잘린 도면을 이긴다")
    t.expectEqual(wholeBeatsClipped?.height, 800, "3열 20줄 x 40px — 잘라내지 않는다")

    // 온전한 크기(2열 1080)를 **화면이 못 줄 때** 바깥벽 두 줄을 내주고 물러난다 — 도면이 두 줄
    // 잘리는 것과 절반 크기로 남는 것 중에서는 앞이 낫다. 작업영역 세로 1100 이 그 경계 안쪽이다
    // (뷰에 주는 몫이 1027 이라 1080 은 못 담고 1000 은 담는다).
    let fallsBackToClipped = officeSnapUpFit(
        viewWidth: 936, viewHeight: 950,
        maxViewWidth: 1080, maxViewHeight: 1100 - 73
    )
    t.expectEqual(fallsBackToClipped?.tileSize, 40, "온전한 크기가 안 되면 잘림을 받아들인다")
    t.expectEqual(fallsBackToClipped?.height, 1000, "2열 27줄 중 바깥벽 두 줄만큼 물러난다")

    // 한 계단 위가 화면에 안 들어가면 nil — 화면에 남는 안내(⌘0)가 그때의 유일한 길이다.
    t.expect(
        officeSnapUpFit(
            viewWidth: 936, viewHeight: 904, maxViewWidth: 1080, maxViewHeight: 950
        ) == nil,
        "화면 세로가 1000 을 못 주면 올릴 수 없다"
    )

    // 이미 40px 인 창은 60px(1380x1620)을 요구하게 되므로 여유 안에 들어오지 않는다 —
    // 계단 위에 선 창을 매번 더 키우려 들지 않는다는 뜻이다.
    t.expect(
        officeSnapUpFit(
            viewWidth: 920, viewHeight: 1000, maxViewWidth: 2560, maxViewHeight: 1400
        ) == nil,
        "이미 계단 위에 선 창은 그냥 둔다"
    )

    // 1x 모니터는 계단이 40 · 80 뿐이라 한 계단 위가 2배다 — 어떤 창도 여유 안에 못 든다.
    t.expect(
        officeSnapUpFit(
            viewWidth: 1400, viewHeight: 760, maxViewWidth: 2560, maxViewHeight: 1400,
            backingScale: 1
        ) == nil,
        "1x 에서 40px 다음은 80px 이라 손댈 수 있는 창이 없다"
    )

    t.expect(
        officeSnapUpFit(
            viewWidth: 0, viewHeight: 904, maxViewWidth: 1080, maxViewHeight: 1400
        ) == nil,
        "폭이 0 이면 nil"
    )

    // ── 창 자리잡기(왼쪽 위 고정 + 화면 안 가두기) ────────────────────────
    //
    // 세로 모니터(2560,0,1080,1890)의 **위 절반**에 붙은 창을 ⌘0 으로 키우는 실제 경우다.
    // 창은 아래로 자라야 하고 위 모서리는 그대로여야 한다 — 위로 자라면 화면 밖으로 나간다.
    let portraitVisible = OfficeRect(x: 2560, y: 0, width: 1080, height: 1890)
    let tiledTopHalf = OfficeRect(x: 2560, y: 945, width: 1080, height: 945)
    let grown = officeFittedWindowFrame(
        currentFrame: tiledTopHalf, fittedWidth: 920, fittedHeight: 1153,
        visibleFrame: portraitVisible
    )
    t.expectEqual(grown.x, 2560, "왼쪽 끝 유지")
    t.expectEqual(grown.y + grown.height, 1890, "위 모서리 유지(아래로 자란다)")
    t.expectEqual(grown.width, 920, "새 폭")
    t.expectEqual(grown.height, 1153, "새 세로")

    // 아래쪽에 붙은 창이 커지면 화면 아래를 넘으므로 안으로 민다.
    let bottomEdge = officeFittedWindowFrame(
        currentFrame: OfficeRect(x: 2560, y: 0, width: 1080, height: 400),
        fittedWidth: 920, fittedHeight: 1153, visibleFrame: portraitVisible
    )
    t.expectEqual(bottomEdge.y, 0, "화면 아래 경계 안으로 민다")

    // 오른쪽으로 넘치면 왼쪽으로 당긴다.
    let rightEdge = officeFittedWindowFrame(
        currentFrame: OfficeRect(x: 3500, y: 700, width: 140, height: 900),
        fittedWidth: 920, fittedHeight: 1153, visibleFrame: portraitVisible
    )
    t.expectEqual(rightEdge.x, 2560 + 1080 - 920, "화면 오른쪽 경계 안으로 당긴다")

    // **새 크기가 화면보다 크면 왼쪽 위 모서리에 붙인다.** `max` 를 한 번 더 씌우지 않으면
    // 하한(화면 원점)이 상한(화면 끝 - 창 크기)보다 커져 창이 화면 밖 음수 자리로 밀린다.
    let oversized = officeFittedWindowFrame(
        currentFrame: OfficeRect(x: 2600, y: 500, width: 300, height: 300),
        fittedWidth: 1400, fittedHeight: 2400, visibleFrame: portraitVisible
    )
    t.expectEqual(oversized.x, 2560, "화면보다 넓으면 왼쪽 끝에 붙인다")
    t.expectEqual(oversized.y, 0, "화면보다 높으면 아래 끝에 붙인다(밖으로 안 나간다)")

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

    // 벡터 캐릭터·가구를 쓰는 선택 Inspector 레이아웃은 전체 평면도를 작은 도트 배율로
    // 고정하지 않는다. 1100x820 씬에서도 최소 30px 타일을 유지해 실제 오피스가 캔버스를
    // 채워야 한다(기존 전체 뷰의 20px 대비 1.5배).
    let selectedVector = officeVectorViewMetrics(
        viewWidth: 1100, viewHeight: 820, columns: 35, rows: 20
    )
    t.expectEqual(selectedVector.tileSize, 30, "선택 Inspector 씬은 벡터 타일을 30px 이상 유지")
    t.expect(
        selectedVector.tileSize >= officeViewMetrics(
            viewWidth: 1100, viewHeight: 820, columns: 35, rows: 20
        ).tileSize * 1.4,
        "선택 Inspector 씬은 기존 20px 전체 뷰보다 충분히 크다"
    )
    // 일반 1400x820 오피스는 기존 배율을 보존한다 — 선택 레이아웃 정책이 일반 화면을
    // 키워서 잘라내지 않아야 한다.
    let standardVector = officeVectorViewMetrics(
        viewWidth: 1400, viewHeight: 820, columns: 35, rows: 20
    )
    t.expectEqual(standardVector.tileSize, 40, "일반 1400x820 오피스 배율은 유지")
}
