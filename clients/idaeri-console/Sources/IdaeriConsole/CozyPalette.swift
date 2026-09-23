import AppKit
import ConsoleCore
import SwiftUI

/// Shared colors for the warm, paper-and-pastel console illustration system.
enum CozyPalette {
    static let canvas = adaptiveColor(
        light: NSColor(red: 0.98, green: 0.95, blue: 0.89, alpha: 1),
        dark: NSColor(red: 0.16, green: 0.14, blue: 0.13, alpha: 1)
    )
    static let surface = adaptiveColor(
        light: NSColor(red: 1.00, green: 0.98, blue: 0.94, alpha: 1),
        dark: NSColor(red: 0.24, green: 0.21, blue: 0.19, alpha: 1)
    )
    static let ink = adaptiveColor(
        light: NSColor(red: 0.24, green: 0.18, blue: 0.15, alpha: 1),
        dark: NSColor(red: 0.96, green: 0.91, blue: 0.84, alpha: 1)
    )
    static let outline = adaptiveColor(
        light: NSColor(red: 0.38, green: 0.29, blue: 0.24, alpha: 1),
        dark: NSColor(red: 0.72, green: 0.62, blue: 0.53, alpha: 1)
    )
    /// 달력의 「빨간 날」(일요일·공휴일)과 토요일 파랑.
    ///
    /// 이 앱에는 빨강이 이미 둘 있다 — 실패 안내(`Color.red`)와 에이전트 실패 상태의 코랄
    /// 레드(`agentStatePaletteRGBA(.failed)` = 0.90/0.30/0.24). 종이 달력 쪽 주홍으로
    /// 낮춰 두긴 했으나 **값이 가까워 색만으로는 갈리지 않는다.** 뜻이 섞이지 않는 것은
    /// 서는 자리가 달라서다(공휴일은 격자 숫자, 실패는 상세 패널 문장·오피스 경고등).
    /// 앞으로 이 셋을 한 자리에 같이 세우게 되면 그때는 색을 더 벌려야 한다.
    ///
    /// 다크 모드에서는 어두운 바탕에 묻히지 않게 둘 다 올린다.
    static let holidayRed = adaptiveColor(
        light: NSColor(red: 0.78, green: 0.24, blue: 0.20, alpha: 1),
        dark: NSColor(red: 0.95, green: 0.48, blue: 0.44, alpha: 1)
    )
    static let weekendBlue = adaptiveColor(
        light: NSColor(red: 0.21, green: 0.42, blue: 0.70, alpha: 1),
        dark: NSColor(red: 0.58, green: 0.76, blue: 0.96, alpha: 1)
    )
    /// Illustration-only colors stay stable across appearance modes so faces and skin do not invert into the scene.
    static let avatarSkin = Color(red: 1.00, green: 0.93, blue: 0.82)
    static let avatarHair = Color(red: 0.24, green: 0.17, blue: 0.14)
    static let avatarFaceInk = Color(red: 0.30, green: 0.22, blue: 0.18)
    static let apricot = Color(red: 0.96, green: 0.62, blue: 0.45)
    static let butter = Color(red: 0.96, green: 0.80, blue: 0.42)
    static let sage = Color(red: 0.55, green: 0.72, blue: 0.55)
    static let lavender = Color(red: 0.68, green: 0.58, blue: 0.82)
    static let sky = Color(red: 0.49, green: 0.70, blue: 0.83)
    static let cocoa = Color(red: 0.82, green: 0.67, blue: 0.53)

    static func palette(index: Int) -> Color {
        switch index % 6 {
        case 0: return apricot
        case 1: return sage
        case 2: return lavender
        case 3: return butter
        case 4: return sky
        case 5: return cocoa
        default: return cocoa
        }
    }

    static func department(_ department: Department) -> Color {
        palette(index: department.cozyPaletteIndex)
    }

    private static func adaptiveColor(light: NSColor, dark: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        })
    }
}
