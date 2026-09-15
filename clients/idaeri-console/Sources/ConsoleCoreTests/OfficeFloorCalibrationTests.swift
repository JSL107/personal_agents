import Foundation

@testable import ConsoleCore

func runOfficeFloorCalibrationTests(_ t: TestRunner) {
    t.suite("OfficeFloorCalibration")

    let quad = OfficeFloorQuad(
        backLeft: OfficeNormalizedPoint(0.20, 0.40),
        backRight: OfficeNormalizedPoint(0.80, 0.40),
        frontRight: OfficeNormalizedPoint(1.00, 1.00),
        frontLeft: OfficeNormalizedPoint(0.00, 1.00)
    )
    let epsilon = 1e-9

    // 네 귀퉁이는 정확히 사각형의 네 모서리로 간다 — 여기가 어긋나면 나머지는 볼 것도 없다.
    let corners: [(Double, Double, OfficeNormalizedPoint, String)] = [
        (0, 0, quad.frontLeft, "앞-왼"),
        (1, 0, quad.frontRight, "앞-오"),
        (1, 1, quad.backRight, "뒤-오"),
        (0, 1, quad.backLeft, "뒤-왼"),
    ]
    for (u, v, expected, label) in corners {
        let point = officeFloorQuadPoint(u: u, v: v, quad: quad)
        t.expect(
            abs(point.x - expected.x) < 1e-9 && abs(point.y - expected.y) < 1e-9,
            "\(label) 귀퉁이가 그대로 간다 (\(point.x), \(point.y))"
        )
    }

    // **뒤로 갈수록 줄 간격이 좁아진다.** 단순 비례로 나누면 화면에서 간격이 균일해져 원근이
    // 사라진다 — 깊이의 절반은 화면에서 절반보다 **뒤쪽**에 찍혀야 한다.
    let middle = officeFloorQuadPoint(u: 0.5, v: 0.5, quad: quad)
    let linearY = (quad.frontLeft.y + quad.backLeft.y) / 2
    t.expect(
        middle.y < linearY - 1e-6,
        "깊이 절반이 화면에서는 절반보다 뒤에 찍힌다 (\(middle.y) < \(linearY))"
    )
    t.expect(
        abs(middle.x - 0.5) < 1e-9, "좌우 대칭인 방에서는 가운데가 가운데로 간다"
    )

    // 뒤로 갈수록 좌우 폭이 좁아진다.
    let frontWidth = officeFloorQuadPoint(u: 1, v: 0, quad: quad).x
        - officeFloorQuadPoint(u: 0, v: 0, quad: quad).x
    let backWidth = officeFloorQuadPoint(u: 1, v: 1, quad: quad).x
        - officeFloorQuadPoint(u: 0, v: 1, quad: quad).x
    t.expect(backWidth < frontWidth, "뒤쪽 폭이 앞쪽보다 좁다")

    // 깊이가 커질수록 화면 위로 올라간다(그림 좌표는 아래로 커지므로 y 가 줄어든다).
    var previousY = officeFloorQuadPoint(u: 0.5, v: 0, quad: quad).y
    for step in 1...10 {
        let y = officeFloorQuadPoint(u: 0.5, v: Double(step) / 10, quad: quad).y
        t.expect(y < previousY + epsilon, "깊이 \(step)/10 에서 화면 위로 올라간다")
        previousY = y
    }

    // 평행사변형(뒤쪽 폭이 앞쪽과 같은 경우)에서도 0 으로 나누지 않는다.
    let parallelogram = OfficeFloorQuad(
        backLeft: OfficeNormalizedPoint(0.10, 0.30),
        backRight: OfficeNormalizedPoint(0.90, 0.30),
        frontRight: OfficeNormalizedPoint(1.00, 1.00),
        frontLeft: OfficeNormalizedPoint(0.20, 1.00)
    )
    let flat = officeFloorQuadPoint(u: 0.5, v: 0.5, quad: parallelogram)
    t.expect(flat.x.isFinite && flat.y.isFinite, "평행사변형에서도 유한한 값을 낸다")

    // === 방 그림별 바닥 표 ===
    //
    // 눈금을 그린 원화를 한 장씩 재서 넣은 값이라, 오타 하나가 그 방 사람 전원을 벽으로
    // 올려 보낸다. 값이 도형으로서 말이 되는지 전 방을 훑는다.
    func checkQuad(_ quad: OfficeFloorQuad, _ label: String) {
        let points = [quad.backLeft, quad.backRight, quad.frontRight, quad.frontLeft]
        t.expect(
            points.allSatisfy { $0.x >= -0.05 && $0.x <= 1.05 && $0.y >= 0 && $0.y <= 1.05 },
            "\(label): 네 모서리가 그림 안에 있다"
        )
        t.expect(
            quad.backLeft.y < quad.frontLeft.y && quad.backRight.y < quad.frontRight.y,
            "\(label): 뒤쪽이 앞쪽보다 화면 위에 있다"
        )
        t.expect(
            quad.backLeft.x < quad.backRight.x && quad.frontLeft.x < quad.frontRight.x,
            "\(label): 왼쪽 모서리가 오른쪽보다 왼쪽에 있다"
        )
        let back = quad.backRight.x - quad.backLeft.x
        let front = quad.frontRight.x - quad.frontLeft.x
        t.expect(
            back < front,
            "\(label): 뒤쪽 바닥이 앞쪽보다 좁다 (뒤 \(back) · 앞 \(front))"
        )
        // 뒤쪽이 앞쪽의 절반보다 좁으면 사람이 뒷줄에서 서로 겹친다 — 재는 자리를 잘못
        // 잡았다는 신호다.
        t.expect(back > front * 0.5, "\(label): 뒤쪽 폭이 앞쪽의 절반보다 넓다")
        // **뒷 모서리는 벽과 바닥이 만나는 선이다.** 아홉 장 모두 그 선이 그림 높이의 30~50%
        // 사이에 있었다(눈금을 그려 실측). 0.15 보다 위면 벽까지 바닥으로 삼은 것이고, 0.60
        // 보다 아래면 바닥 절반을 못 쓰는 것이다 — 둘 다 숫자를 잘못 옮겼다는 신호다.
        //
        // 이 범위 검사는 **큰 실수만** 잡는다. 0.33 을 0.28 로 잘못 적는 정도는 여기서 안
        // 걸리고 렌더를 눈으로 봐야 한다 — 그림과 숫자를 맞추는 일이라 코드만으로는 닫히지 않는다.
        t.expect(
            quad.backLeft.y > 0.15 && quad.backLeft.y < 0.60
                && quad.backRight.y > 0.15 && quad.backRight.y < 0.60,
            "\(label): 뒷 모서리가 그림의 15~60% 높이에 있다"
                + " (왼 \(quad.backLeft.y) · 오 \(quad.backRight.y))"
        )
        // 바닥이 그림의 3할 미만이면 방이 아니라 벽 사진이 된다.
        let area = (front + back) / 2 * (quad.frontLeft.y - quad.backLeft.y)
        t.expect(area > 0.25, "\(label): 바닥이 그림의 4분의 1보다 넓다 (\(area))")
    }
    for department in Department.allCases {
        checkQuad(officeRoomFloorQuad(department: department), department.rawValue)
    }
    for kind in CommonAreaKind.allCases {
        checkQuad(officeCommonAreaFloorQuad(kind: kind), kind.rawValue)
    }

    // === 실제 평면도의 모든 칸이 바닥 안에 들어오는가 ===
    //
    // 이 검사가 "사람이 벽 위를 걷는다" 는 신고에 직접 대응한다. 좌석·책상 칸을 그림 좌표로
    // 옮겨 바닥 사각형 안에 있는지 본다.
    func isInside(_ point: OfficeNormalizedPoint, _ quad: OfficeFloorQuad) -> Bool {
        let polygon = [quad.frontLeft, quad.frontRight, quad.backRight, quad.backLeft]
        // **경계 위도 바닥이다.** 맨 앞줄은 바닥 사각형의 앞 모서리에 정확히 놓이는데, 그대로
        // 반직선 판정에 넣으면 "바깥" 으로 나온다. 가운데로 아주 조금 당겨 넣고 판정한다.
        let centerX = polygon.map(\.x).reduce(0, +) / Double(polygon.count)
        let centerY = polygon.map(\.y).reduce(0, +) / Double(polygon.count)
        let nudged = OfficeNormalizedPoint(
            point.x + (centerX - point.x) * 1e-6,
            point.y + (centerY - point.y) * 1e-6
        )
        var inside = false
        var j = polygon.count - 1
        for i in 0..<polygon.count {
            let a = polygon[i], b = polygon[j]
            if (a.y > nudged.y) != (b.y > nudged.y) {
                let x = (b.x - a.x) * (nudged.y - a.y) / (b.y - a.y) + a.x
                if nudged.x < x { inside.toggle() }
            }
            j = i
        }
        return inside
    }
    for zoneColumns in [2, 3] {
        let plan = officeFloorPlan(agents: sampleAgents, zoneColumns: zoneColumns)
        for zone in plan.zones {
            let quad = officeRoomFloorQuad(department: zone.department)
            let floorRect = officeRoomFloorRect(zone: zone)
            let label = "\(zoneColumns)열 · \(zone.department.rawValue)"
            // 좌석 줄(구역 원점 기준 2·5)과 책상 줄(1·4)을 전부 본다.
            for rowOffset in [1, 2, 4, 5] {
                for columnOffset in 1...(zone.width - 2) {
                    let tile = TilePoint(
                        x: zone.origin.x + columnOffset, y: zone.origin.y + rowOffset
                    )
                    let u = (Double(tile.x) + 0.5 - floorRect.x) / floorRect.width
                    let v = (Double(tile.y) - floorRect.y) / floorRect.height
                    let point = officeFloorQuadPoint(u: u, v: v, quad: quad)
                    t.expect(
                        isInside(point, quad),
                        "\(label): (\(columnOffset), \(rowOffset)) 칸이 바닥 안에 있다"
                    )
                }
            }
        }
        // 공용 공간도 같은 방식으로.
        for area in plan.commonAreas {
            let quad = officeCommonAreaFloorQuad(kind: area.kind)
            let floorRect = officeCommonAreaFloorRect(
                originX: area.originX, width: area.width, labelY: area.labelY
            )
            for rowOffset in 0..<Int(floorRect.height) {
                for columnOffset in 0..<Int(floorRect.width) {
                    let u = (Double(columnOffset) + 0.5) / floorRect.width
                    let v = Double(rowOffset) / floorRect.height
                    let point = officeFloorQuadPoint(u: u, v: v, quad: quad)
                    t.expect(
                        isInside(point, quad),
                        "\(zoneColumns)열 · \(area.kind.rawValue): "
                            + "(\(columnOffset), \(rowOffset)) 칸이 바닥 안에 있다"
                    )
                }
            }
        }
    }

    // 그림이 덮는 사각형과 렌더가 쓰는 값이 같아야 한다 — 다르면 사람이 그림 밖 바닥에 선다.
    let surface = officeCommonAreaSurfaceRect(originX: 4, width: 8, labelY: 15)
    t.expectEqual(surface.x, 4, "공용 그림은 구역 왼쪽 끝에서 시작한다")
    t.expectEqual(surface.width, 8, "공용 그림 폭은 구역 폭과 같다")
    t.expectEqual(
        surface.y, 15 + officeCommonAreaSurfaceBottomOffset, "공용 그림 아래 모서리"
    )
    t.expectEqual(surface.height, officeCommonAreaSurfaceHeight, "공용 그림 높이")
}
