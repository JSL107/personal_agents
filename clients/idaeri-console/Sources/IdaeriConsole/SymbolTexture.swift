import AppKit
import SpriteKit

/// SF Symbol(시스템 제공)을 지정 색·크기로 렌더해 SKTexture 로 변환한다. 리소스 번들 불필요.
/// 유효하지 않은 심볼명이거나 렌더 실패 시 nil(호출자가 이니셜 등으로 폴백).
func symbolTexture(systemName: String, pointSize: CGFloat, color: NSColor) -> SKTexture? {
    guard let base = NSImage(systemSymbolName: systemName, accessibilityDescription: nil) else {
        return nil
    }
    let configuration = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .semibold)
        .applying(NSImage.SymbolConfiguration(paletteColors: [color]))
    guard let rendered = base.withSymbolConfiguration(configuration) else {
        return nil
    }
    return SKTexture(image: rendered)
}
