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
