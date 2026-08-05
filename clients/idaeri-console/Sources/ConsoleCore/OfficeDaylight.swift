import Foundation

/// 창밖 시간대. 하루를 다섯 구간으로 나눈다.
///
/// 예전에는 네 구간이었고, 시간대를 **화면 전체를 덮는 반투명 색막**으로 표현했다. 그 방식은
/// 조명이 아니라 색 필터였다 — 모든 픽셀이 같은 비율로 한 색에 끌려가 명암이 사라진다.
/// 실측: 저녁 주황 rgb(255,140,64) 을 불투명도 0.22 로 씌우면 배경 rgb(23,23,28) 이
/// rgb(74,49,36) 까지 **밝아진다.** 저녁 빛은 그림자를 더 어둡게 만드는데 반대로 간 셈이라,
/// 화면 전체가 세피아 사진처럼 보였다.
///
/// 지금은 색막을 걷고 **빛이 들어오는 자리만** 물들인다. 시간대는 창유리 색과 창 아래로
/// 떨어지는 빛으로 읽히고, 어두운 곳은 어두운 채로 남는다.
public enum OfficeDaylight: String, Sendable, CaseIterable {
    case dawn
    case morning
    case day
    case evening
    case night
}

/// 알파 없는 색 3원. SpriteKit 타입을 Core 로 끌어들이지 않으려고 둔다.
public struct OfficeColor: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }
}

/// 창문 한 칸이 시간대마다 띠는 색과, 실내로 떨어지는 빛의 세기.
public struct OfficeWindowLight: Equatable, Sendable {
    /// 유리 위쪽(하늘 높은 곳).
    public let skyHigh: OfficeColor
    /// 유리 아래쪽(지평선 쪽). 위아래를 갈라야 노을이 노을로 보인다 — 한 색으로 채우면
    /// 새벽·저녁이 그냥 "주황 유리" 가 된다.
    public let skyLow: OfficeColor
    /// 실내 바닥에 떨어지는 빛의 색.
    public let glow: OfficeColor
    /// 바닥 빛의 세기(0~1). 밝은 쪽에 더하는 합성이라 0.25 를 넘으면 바닥 무늬가 날아간다.
    public let glowStrength: Double
    /// 벽등을 켜는가. 해가 낮은 시간(새벽·저녁·밤)에만 켠다 — 낮에 켜면 빛이 두 겹이 되어
    /// 어느 쪽이 광원인지 읽히지 않는다.
    public let lampLit: Bool

    public init(
        skyHigh: OfficeColor,
        skyLow: OfficeColor,
        glow: OfficeColor,
        glowStrength: Double,
        lampLit: Bool
    ) {
        self.skyHigh = skyHigh
        self.skyLow = skyLow
        self.glow = glow
        self.glowStrength = glowStrength
        self.lampLit = lampLit
    }
}

/// 음수와 24시 밖 입력도 같은 24시간 시계로 접어 경계 판정이 흔들리지 않게 한다.
public func officeDaylight(hour: Int) -> OfficeDaylight {
    let normalizedHour = ((hour % 24) + 24) % 24
    switch normalizedHour {
    case 5...7:
        return .dawn
    case 8...10:
        return .morning
    case 11...16:
        return .day
    case 17...19:
        return .evening
    default:
        return .night
    }
}

/// 시간대 → 창유리·바닥 빛 색.
///
/// 값은 하늘 사진의 계조를 픽셀 팔레트로 줄인 것이다. 두 가지를 지킨다.
///  - **낮이 가장 밝고 밤이 가장 어둡다.** 바닥 빛 세기가 단조롭게 오르내려야 시간이 읽힌다.
///  - **새벽과 저녁은 서로 다른 색이다.** 둘 다 붉지만 새벽은 위가 남보라(해 뜨기 전 하늘),
///    저녁은 위가 자주빛이라 유리만 보고도 아침인지 저녁인지 갈린다.
public func officeWindowLight(hour: Int) -> OfficeWindowLight {
    switch officeDaylight(hour: hour) {
    case .dawn:
        return OfficeWindowLight(
            skyHigh: OfficeColor(red: 0.24, green: 0.27, blue: 0.52),
            skyLow: OfficeColor(red: 0.94, green: 0.62, blue: 0.52),
            glow: OfficeColor(red: 1.00, green: 0.78, blue: 0.68),
            glowStrength: 0.12,
            lampLit: true
        )
    case .morning:
        return OfficeWindowLight(
            skyHigh: OfficeColor(red: 0.42, green: 0.68, blue: 0.96),
            skyLow: OfficeColor(red: 0.80, green: 0.90, blue: 0.99),
            glow: OfficeColor(red: 1.00, green: 0.96, blue: 0.86),
            glowStrength: 0.17,
            lampLit: false
        )
    case .day:
        return OfficeWindowLight(
            skyHigh: OfficeColor(red: 0.33, green: 0.60, blue: 0.95),
            skyLow: OfficeColor(red: 0.70, green: 0.86, blue: 0.99),
            glow: OfficeColor(red: 1.00, green: 0.99, blue: 0.94),
            glowStrength: 0.21,
            lampLit: false
        )
    case .evening:
        return OfficeWindowLight(
            skyHigh: OfficeColor(red: 0.44, green: 0.30, blue: 0.56),
            skyLow: OfficeColor(red: 0.99, green: 0.55, blue: 0.30),
            glow: OfficeColor(red: 1.00, green: 0.72, blue: 0.46),
            glowStrength: 0.16,
            lampLit: true
        )
    case .night:
        return OfficeWindowLight(
            skyHigh: OfficeColor(red: 0.04, green: 0.06, blue: 0.16),
            skyLow: OfficeColor(red: 0.10, green: 0.13, blue: 0.30),
            glow: OfficeColor(red: 0.52, green: 0.64, blue: 1.00),
            glowStrength: 0.05,
            lampLit: true
        )
    }
}
