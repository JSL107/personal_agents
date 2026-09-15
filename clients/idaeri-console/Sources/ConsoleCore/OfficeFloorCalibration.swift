import Foundation

/// 방 그림 안에서 **사람이 설 수 있는 바닥**의 네 모서리. 그림 기준 0~1 좌표이고 y 는 아래로
/// 커진다(그림 위가 0).
///
/// 방 그림 아홉 장은 서로 **다른 각도로 그려졌다.** 기획·품질·평가는 정면에서 낮게 본 그림이라
/// 뒷벽이 화면의 절반 가까이를 차지하고, 자산·콘텐츠·총무는 위에서 비스듬히 내려다본 그림이라
/// 바닥이 사다리꼴로 기울어 있으며, 회의실은 아예 비틀려 있다. 그런데 사람과 가구 자리는 아홉
/// 장 모두에 같은 격자로 놓여, 뒷줄 좌석이 벽 밑동이나 책장 위에 걸렸다(사용자 보고: "배경은
/// 3D 인데 동작은 2D 라 벽을 걸어다닌다").
///
/// 그래서 그림마다 바닥을 따로 알려준다. 격자의 논리 좌표는 그대로 두고, 화면에 놓을 때만 이
/// 사각형 안으로 옮긴다 — 평면도·길찾기·좌석 계약은 건드리지 않는다.
public struct OfficeFloorQuad: Equatable, Sendable {
    /// 뒤쪽 왼쪽(벽과 만나는 쪽).
    public let backLeft: OfficeNormalizedPoint
    public let backRight: OfficeNormalizedPoint
    /// 앞쪽(화면 아래쪽).
    public let frontRight: OfficeNormalizedPoint
    public let frontLeft: OfficeNormalizedPoint

    public init(
        backLeft: OfficeNormalizedPoint,
        backRight: OfficeNormalizedPoint,
        frontRight: OfficeNormalizedPoint,
        frontLeft: OfficeNormalizedPoint
    ) {
        self.backLeft = backLeft
        self.backRight = backRight
        self.frontRight = frontRight
        self.frontLeft = frontLeft
    }
}

/// 그림 기준 0~1 좌표 한 점. y 는 아래로 커진다.
public struct OfficeNormalizedPoint: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }
}

/// 단위 정사각형의 한 점을 바닥 사각형 안으로 옮긴다 — **원근이 살아 있는 사영 변환**.
///
/// `u` 는 왼쪽 0 · 오른쪽 1, `v` 는 앞 0 · 뒤 1 이다. 네 귀퉁이는 정확히 사각형의 네 모서리로
/// 가고, 그 사이는 원근에 맞게 나뉜다 — 단순 비례(쌍선형)로 나누면 줄 간격이 화면에서 균일해져
/// 뒤로 갈수록 좁아지는 느낌이 사라진다.
///
/// 사각형 밖(`u`·`v` 가 0~1 밖)도 같은 식으로 이어서 계산한다. 방 옆벽의 문처럼 바닥 범위를
/// 살짝 벗어난 칸이 있고, 거기서 끊기면 사람이 문을 드나들 때 튄다.
public func officeFloorQuadPoint(u: Double, v: Double, quad: OfficeFloorQuad) -> OfficeNormalizedPoint {
    // 단위 정사각형 → 사각형 사영 변환(Heckbert). 밑변이 평행하면 아래 분모가 0 이 되므로
    // 그때는 사다리꼴이 아니라 평행사변형이라 곱셈 항만 남는다.
    let x0 = quad.frontLeft.x, y0 = quad.frontLeft.y
    let x1 = quad.frontRight.x, y1 = quad.frontRight.y
    let x2 = quad.backRight.x, y2 = quad.backRight.y
    let x3 = quad.backLeft.x, y3 = quad.backLeft.y

    let dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
    let dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
    let denominator = dx1 * dy2 - dx2 * dy1

    let a13: Double
    let a23: Double
    if abs(denominator) < 1e-12 {
        a13 = 0
        a23 = 0
    } else {
        a13 = (dx3 * dy2 - dx2 * dy3) / denominator
        a23 = (dx1 * dy3 - dx3 * dy1) / denominator
    }
    let a11 = x1 - x0 + a13 * x1
    let a21 = x3 - x0 + a23 * x3
    let a31 = x0
    let a12 = y1 - y0 + a13 * y1
    let a22 = y3 - y0 + a23 * y3
    let a32 = y0

    let w = a13 * u + a23 * v + 1
    guard abs(w) > 1e-12 else {
        return OfficeNormalizedPoint(x0, y0)
    }
    return OfficeNormalizedPoint(
        (a11 * u + a21 * v + a31) / w,
        (a12 * u + a22 * v + a32) / w
    )
}

/// 격자 한 칸의 발밑 좌표를 방 그림의 바닥 위로 옮긴다(타일 단위, 순수).
///
/// - Parameters:
///   - floorRect: **논리 바닥** 사각형. 방 안에서 사람이 설 수 있는 칸 범위다(양옆 벽과 뒷벽 제외).
///   - imageRect: 방 그림이 덮는 사각형. 그림은 이 안에 늘려 깔린다.
///   - quad: 그 그림 안에서 바닥이 차지하는 네 모서리.
/// - Returns: 격자 좌표계의 점. y 는 위로 커진다(화면과 같은 방향).
public func officeCalibratedFloorPoint(
    tileX: Double,
    tileY: Double,
    footprintWidth: Double,
    floorRect: OfficeRect,
    imageRect: OfficeRect,
    quad: OfficeFloorQuad
) -> OfficeProjectedPoint {
    guard floorRect.width > 0, floorRect.height > 0, imageRect.width > 0, imageRect.height > 0
    else {
        return OfficeProjectedPoint(x: tileX + footprintWidth / 2, y: tileY)
    }
    let u = (tileX + footprintWidth / 2 - floorRect.x) / floorRect.width
    let v = (tileY - floorRect.y) / floorRect.height
    let point = officeFloorQuadPoint(u: u, v: v, quad: quad)
    return OfficeProjectedPoint(
        x: imageRect.x + point.x * imageRect.width,
        // 그림 좌표는 아래로 커지고 격자 좌표는 위로 커진다.
        y: imageRect.y + (1 - point.y) * imageRect.height
    )
}

/// 뒤쪽 사람·가구를 줄이는 **하한**. 바닥 폭 비율을 그대로 쓰면 뒤쪽이 6할 안팎까지 작아져
/// 이름표와 표정이 읽히지 않는다. 원근은 살리되 읽을 수 있는 선에서 멈춘다.
public let officeFloorDepthScaleFloor: Double = 0.75

/// 이 깊이에서 사람·가구를 얼마나 작게 그릴지. 바닥이 좁아지는 비율을 그대로 쓰되 하한에서 멈춘다.
///
/// `v` 는 앞 0 · 뒤 1. 앞쪽은 1.0(원래 크기)이고 뒤로 갈수록 작아진다.
public func officeFloorDepthScale(
    v: Double, quad: OfficeFloorQuad, floor: Double = officeFloorDepthScaleFloor
) -> Double {
    let frontWidth = officeFloorQuadPoint(u: 1, v: 0, quad: quad).x
        - officeFloorQuadPoint(u: 0, v: 0, quad: quad).x
    guard frontWidth > 1e-9 else {
        return 1
    }
    let width = officeFloorQuadPoint(u: 1, v: v, quad: quad).x
        - officeFloorQuadPoint(u: 0, v: v, quad: quad).x
    return min(1, max(floor, width / frontWidth))
}

/// 부서 방 그림의 바닥 사각형. 눈금을 그린 원화를 한 장씩 재서 넣은 값이다.
///
/// 붙박이 가구(책장·수납장·주방 상판) 앞까지만 바닥으로 본다 — 벽까지 열어 두면 뒷줄 사람이
/// 가구를 뚫고 선다.
public func officeRoomFloorQuad(department: Department) -> OfficeFloorQuad {
    switch department {
    case .planning:
        return OfficeFloorQuad(
            backLeft: OfficeNormalizedPoint(0.10, 0.44),
            backRight: OfficeNormalizedPoint(0.88, 0.43),
            frontRight: OfficeNormalizedPoint(1.00, 1.00),
            frontLeft: OfficeNormalizedPoint(0.00, 1.00)
        )
    case .quality:
        return OfficeFloorQuad(
            backLeft: OfficeNormalizedPoint(0.08, 0.44),
            backRight: OfficeNormalizedPoint(0.80, 0.43),
            frontRight: OfficeNormalizedPoint(1.00, 1.00),
            frontLeft: OfficeNormalizedPoint(0.00, 1.00)
        )
    case .evaluation:
        return OfficeFloorQuad(
            backLeft: OfficeNormalizedPoint(0.16, 0.48),
            backRight: OfficeNormalizedPoint(0.80, 0.47),
            frontRight: OfficeNormalizedPoint(1.00, 1.00),
            frontLeft: OfficeNormalizedPoint(0.00, 1.00)
        )
    case .treasury:
        return OfficeFloorQuad(
            backLeft: OfficeNormalizedPoint(0.10, 0.40),
            backRight: OfficeNormalizedPoint(0.90, 0.42),
            frontRight: OfficeNormalizedPoint(1.00, 1.00),
            frontLeft: OfficeNormalizedPoint(0.00, 1.00)
        )
    case .content:
        return OfficeFloorQuad(
            backLeft: OfficeNormalizedPoint(0.06, 0.33),
            backRight: OfficeNormalizedPoint(0.84, 0.30),
            frontRight: OfficeNormalizedPoint(1.00, 1.00),
            frontLeft: OfficeNormalizedPoint(0.00, 1.00)
        )
    case .internalOps:
        return OfficeFloorQuad(
            backLeft: OfficeNormalizedPoint(0.14, 0.45),
            backRight: OfficeNormalizedPoint(0.80, 0.42),
            frontRight: OfficeNormalizedPoint(1.00, 1.00),
            frontLeft: OfficeNormalizedPoint(0.00, 1.00)
        )
    }
}

/// 위쪽 공용 공간 그림의 바닥 사각형.
public func officeCommonAreaFloorQuad(kind: CommonAreaKind) -> OfficeFloorQuad {
    switch kind {
    case .meeting:
        return OfficeFloorQuad(
            backLeft: OfficeNormalizedPoint(0.22, 0.45),
            backRight: OfficeNormalizedPoint(0.86, 0.31),
            frontRight: OfficeNormalizedPoint(0.96, 1.00),
            frontLeft: OfficeNormalizedPoint(0.00, 1.00)
        )
    case .president:
        // 앞쪽 양 끝은 계단 난간이라 바닥이 아니다 — 앞 모서리를 안쪽으로 물린다.
        return OfficeFloorQuad(
            backLeft: OfficeNormalizedPoint(0.24, 0.33),
            backRight: OfficeNormalizedPoint(0.86, 0.32),
            frontRight: OfficeNormalizedPoint(0.96, 0.82),
            frontLeft: OfficeNormalizedPoint(0.06, 0.82)
        )
    case .pantry:
        return OfficeFloorQuad(
            backLeft: OfficeNormalizedPoint(0.06, 0.44),
            backRight: OfficeNormalizedPoint(0.92, 0.42),
            frontRight: OfficeNormalizedPoint(1.00, 1.00),
            frontLeft: OfficeNormalizedPoint(0.00, 1.00)
        )
    }
}

/// 공용 공간 그림이 덮는 사각형(타일). 렌더와 좌표 보정이 **같은 값**을 봐야 한다 — 한쪽만
/// 옮기면 사람이 그림 밖 바닥에 선다.
public let officeCommonAreaSurfaceBottomOffset: Double = 0.5
public let officeCommonAreaSurfaceHeight: Double = 3.70

public func officeCommonAreaSurfaceRect(originX: Int, width: Int, labelY: Int) -> OfficeRect {
    OfficeRect(
        x: Double(originX),
        y: Double(labelY) + officeCommonAreaSurfaceBottomOffset,
        width: Double(width),
        height: officeCommonAreaSurfaceHeight
    )
}

/// 공용 공간에서 사람이 설 수 있는 칸 범위. 양옆 한 칸은 벽이고, 맨 아래 줄은 가로 복도,
/// 맨 위 줄은 벽이다(`officeFloorPlan` 의 밴드 주석).
public func officeCommonAreaFloorRect(originX: Int, width: Int, labelY: Int) -> OfficeRect {
    OfficeRect(
        x: Double(originX + 1),
        y: Double(labelY + 1),
        width: Double(max(1, width - 2)),
        height: 3
    )
}

/// 부서 방에서 사람이 설 수 있는 칸 범위. 양옆 끝 열은 벽, 맨 위 줄은 뒷벽이다.
public func officeRoomFloorRect(zone: DepartmentZone) -> OfficeRect {
    OfficeRect(
        x: Double(zone.origin.x + 1),
        y: Double(zone.origin.y),
        width: Double(max(1, zone.width - 2)),
        height: Double(max(1, zone.height - 1))
    )
}
