import AppKit
import ConsoleCore
import SpriteKit

/// 창문·벽등·빛무리 텍스처를 코드로 그린다.
///
/// PNG 로 두지 않는 이유는 **유리 색이 시간대마다 바뀌기 때문**이다. 다섯 장을 따로 그려
/// 두면 색을 손볼 때마다 에셋 파이프라인(raw 시트 → build-sprites.py)을 다시 돌려야 하는데,
/// 창문은 사각형과 반원 몇 개라 그럴 값어치가 없다. 캐릭터·가구처럼 형태가 복잡한 것만
/// 그림으로 두고, 색이 상태를 나타내는 것은 코드로 그린다.
///
/// 도트 격자는 `dotScale` 로 굵기를 맞춘다 — 1픽셀로 그리면 다른 스프라이트(원본 40px 를
/// 8배 축소한 도트)보다 결이 고와서, 같은 화면에서 창문만 매끈한 벡터처럼 튄다.
enum OfficeLightTexture {
    /// 텍스처 원본 한 변(px). 타일 기준 크기와 같게 두면 확대 배율이 다른 스프라이트와 같다.
    private static let side = 40
    /// 도트 한 칸(px). 2 면 20×20 도트가 되어 가구 스프라이트와 결이 맞는다.
    private static let dot = 2

    private static var cache: [String: SKTexture] = [:]

    /// 시간대별 창문. 아치 상단·창살·창턱을 갖춘 **세로 두 칸짜리** 창.
    ///
    /// 두 칸인 이유는 벽이 두 줄이기 때문이다 — 한 칸짜리로 그렸을 때는 창이 벽에 걸린 게
    /// 아니라 바닥에 누운 것처럼 보였다.
    static func window(_ light: OfficeWindowLight, daylight: OfficeDaylight) -> SKTexture? {
        texture(key: "window-\(daylight.rawValue)", width: side, height: side * 2) { context in
            drawWindow(context, light: light)
        }
    }

    /// 벽등. 켜짐/꺼짐 두 장뿐이라 시간대와 무관하게 캐시된다.
    static func wallLamp(lit: Bool) -> SKTexture? {
        texture(key: "lamp-\(lit)") { context in
            drawWallLamp(context, lit: lit)
        }
    }

    /// 광원 주위로 퍼지는 빛무리(흰색). 색은 노드 쪽에서 입힌다 —
    /// 시간대마다 다른 색으로 텍스처를 새로 굽지 않기 위해서다.
    static func glowHalo() -> SKTexture? {
        texture(key: "halo") { context in
            drawHalo(context)
        }
    }

    /// 창에서 바닥으로 떨어지는 빛기둥(흰색). 위가 밝고 아래로 갈수록 옅어지며 좌우로 벌어진다.
    ///
    /// 처음에는 사각형 세 장을 알파만 낮춰 겹쳤는데, 화면에서 빛이 아니라 **밝은 직사각형
    /// 세 개**로 보였다. 경계가 직선이라 계단이 그대로 드러났기 때문이다. 한 장으로 굽고
    /// 가장자리를 죽이면 노드 수가 오히려 줄면서 빛으로 읽힌다.
    static func windowShaft() -> SKTexture? {
        if let cached = cache["shaft"] {
            return cached
        }
        let width = 128
        let height = 128
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        for row in 0..<height {
            // 이 버퍼는 CGBitmapContext 로 그대로 넘어간다 — **row 0 이 이미지 맨 위**,
            // 즉 창 쪽이다. 여기를 아래로 착각해 세로가 통째로 뒤집히면 창 바로 아래는
            // 어둡고 세 칸 내려간 바닥이 가장 밝아져, 광원이 방 한가운데 있는 것처럼 보인다.
            let nearWindow = Double(height - 1 - row) / Double(height - 1)
            // 창 쪽에 밝기를 몰아 준다 — 선형으로 깔면 바닥 끝까지 허옇게 남는다.
            let verticalFade = pow(nearWindow, 1.7)
            // 창에서 멀어질수록 넓게 퍼진다(창 쪽 0.5 → 끝 1.0 폭).
            let spread = 1.0 - nearWindow * 0.5
            for column in 0..<width {
                let offset = abs(Double(column) - Double(width - 1) / 2) / (Double(width) / 2)
                let edge = max(0, 1 - pow(min(offset / spread, 1), 2.0))
                let alpha = verticalFade * edge
                let index = (row * width + column) * 4
                let value = UInt8(max(0, min(255, (alpha * 255).rounded())))
                // premultipliedLast — 흰색이므로 색 성분도 알파와 같은 값이 된다.
                pixels[index] = value
                pixels[index + 1] = value
                pixels[index + 2] = value
                pixels[index + 3] = value
            }
        }
        guard
            let context = CGContext(
                data: &pixels,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ),
            let image = context.makeImage()
        else {
            return nil
        }
        let texture = SKTexture(
            image: NSImage(cgImage: image, size: NSSize(width: width, height: height))
        )
        // 빛은 도트가 아니라 공기의 밝기라 여기만 보간을 켠다(계단이 보이면 이물감이 생긴다).
        texture.filteringMode = .linear
        cache["shaft"] = texture
        return texture
    }

    private static func texture(
        key: String,
        width: Int = side,
        height: Int = side,
        draw: (CGContext) -> Void
    ) -> SKTexture? {
        if let cached = cache[key] {
            return cached
        }
        guard
            let context = CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        else {
            return nil
        }
        context.interpolationQuality = .none
        draw(context)
        guard let image = context.makeImage() else {
            return nil
        }
        let texture = SKTexture(
            image: NSImage(cgImage: image, size: NSSize(width: width, height: height))
        )
        texture.filteringMode = .nearest
        cache[key] = texture
        return texture
    }

    /// 도트 격자에 맞춰 사각형 하나를 칠한다. 좌표 단위는 도트(0~19), 원점은 좌하단.
    private static func fill(
        _ context: CGContext,
        x: Int,
        y: Int,
        width: Int,
        height: Int,
        color: (red: Double, green: Double, blue: Double),
        alpha: Double = 1
    ) {
        context.setFillColor(
            red: CGFloat(color.red),
            green: CGFloat(color.green),
            blue: CGFloat(color.blue),
            alpha: CGFloat(alpha)
        )
        context.fill(
            CGRect(
                x: x * dot,
                y: y * dot,
                width: width * dot,
                height: height * dot
            )
        )
    }

    // 창틀·벽등 몸체가 함께 쓰는 어두운 나무색. 벽 기본색(0.26,0.22,0.20)보다 어두워야
    // 벽에 파묻히지 않고 창의 윤곽이 선다.
    private static let frameColor = (red: 0.16, green: 0.12, blue: 0.10)
    private static let sillColor = (red: 0.42, green: 0.30, blue: 0.21)
    private static let metalColor = (red: 0.30, green: 0.26, blue: 0.22)

    /// 아치 한 줄의 유리 반폭(도트). 아래쪽 몸통은 반지름 그대로, 위쪽은 반원 방정식을 따른다.
    ///
    /// 반폭을 먼저 정수로 접고 좌우를 그 값으로 함께 만드는 것이 핵심 — 왼쪽 끝과 폭을 따로
    /// 반올림하면 줄마다 한쪽으로 1도트씩 쏠려 아치가 기울어 보인다(첫 렌더에서 실제로 그랬다).
    private static func archHalfDots(archBase: Int, radius: Double, row: Int) -> Int {
        guard row > archBase else {
            return Int(radius.rounded())
        }
        let height = Double(row - archBase)
        let squared = radius * radius - height * height
        let halfWidth = squared > 0 ? squared.squareRoot() : 0
        return Int(halfWidth.rounded())
    }

    /// 창문. 가로 20 × 세로 40 도트 격자에 그린다(벽 두 줄에 걸치는 크기).
    ///
    /// 아치는 반원을 계산해 도트 줄마다 폭을 좁히는 식으로 만든다 — 곡선을 그대로 그리면
    /// 안티에일리어싱이 들어가 도트 경계가 흐려진다(다른 스프라이트와 질감이 어긋난다).
    ///
    /// 맨 위 여덟 줄은 비운다. 그 자리가 벽 윗면(천장 가장자리)이라, 창을 거기까지 올리면
    /// 벽을 뚫고 나온 것처럼 보인다.
    private static func drawWindow(_ context: CGContext, light: OfficeWindowLight) {
        let glassBottom = 4
        let archBase = 24
        let glassTop = 30
        let centerX = 10.0
        let radius = 7.0

        for row in glassBottom...glassTop {
            let halfDots = archHalfDots(archBase: archBase, radius: radius, row: row)
            guard halfDots >= 1 else {
                continue
            }
            let left = Int(centerX) - halfDots
            let width = halfDots * 2
            // 하늘색은 위아래를 잇는 계조. 픽셀아트라 연속 그라데이션 대신 줄 단위로 섞는다.
            let ratio = Double(row - glassBottom) / Double(glassTop - glassBottom)
            let color = (
                red: light.skyLow.red * (1 - ratio) + light.skyHigh.red * ratio,
                green: light.skyLow.green * (1 - ratio) + light.skyHigh.green * ratio,
                blue: light.skyLow.blue * (1 - ratio) + light.skyHigh.blue * ratio
            )
            fill(context, x: left, y: row, width: width, height: 1, color: color)
            // 같은 줄의 좌우 끝을 창틀로 덮어 아치 윤곽을 만든다.
            fill(context, x: left - 1, y: row, width: 1, height: 1, color: frameColor)
            fill(context, x: left + width, y: row, width: 1, height: 1, color: frameColor)
        }

        // 아치 꼭대기 마감 — 반원 계산만으로는 맨 윗줄이 뾰족하게 끊긴다. 맨 윗줄 유리 폭에
        // 맞춰 덮어야 지붕이 얹힌 것처럼 보인다(폭이 좁으면 유리 위에 조각이 뜬다).
        let topWidth = archHalfDots(archBase: archBase, radius: radius, row: glassTop) * 2
        fill(
            context,
            x: Int(centerX) - topWidth / 2,
            y: glassTop + 1,
            width: topWidth,
            height: 1,
            color: frameColor
        )
        // 창살 — 세로 하나로 두 짝 창처럼 보이게 하고, 가로 하나로 아치와 본체를 나눈다.
        fill(
            context,
            x: Int(centerX),
            y: glassBottom,
            width: 1,
            height: glassTop - glassBottom + 1,
            color: frameColor
        )
        fill(context, x: 3, y: archBase, width: 15, height: 1, color: frameColor)
        // 몸통이 세로로 길어 창살 하나로는 허전하다. 중간에 한 줄 더 넣어 네 짝 창으로 나눈다.
        fill(context, x: 3, y: (glassBottom + archBase) / 2, width: 15, height: 1, color: frameColor)
        // 창턱 — 아래에 밝은 띠를 두면 창이 벽에 붙어 있는 물건으로 읽힌다.
        fill(context, x: 2, y: glassBottom - 2, width: 17, height: 2, color: sillColor)
        fill(context, x: 2, y: glassBottom - 3, width: 17, height: 1, color: frameColor)
    }

    /// 벽등 한 칸. 브래킷 + 등피, 켜지면 등피가 노랗게 빛난다.
    private static func drawWallLamp(_ context: CGContext, lit: Bool) {
        // 꺼진 등은 벽보다 **어두워야** 형태가 남는다. 처음엔 중간 회색으로 뒀는데 벽면
        // 밝기(0.26,0.22,0.20 을 0.6 으로 섞은 값)와 겹쳐서, 낮 화면에서 등이 통째로 사라졌다.
        let shade = lit
            ? (red: 1.00, green: 0.84, blue: 0.46)
            : (red: 0.21, green: 0.20, blue: 0.19)
        let shadeEdge = lit
            ? (red: 0.86, green: 0.58, blue: 0.24)
            : (red: 0.13, green: 0.12, blue: 0.12)

        // 벽에 붙는 받침과 팔.
        fill(context, x: 9, y: 15, width: 2, height: 4, color: metalColor)
        fill(context, x: 8, y: 18, width: 4, height: 1, color: metalColor)
        // 등피 — 아래로 벌어지는 사다리꼴. 세 단이면 픽셀아트에서 충분히 갓으로 읽힌다.
        fill(context, x: 8, y: 13, width: 4, height: 2, color: shadeEdge)
        fill(context, x: 7, y: 11, width: 6, height: 2, color: shade)
        fill(context, x: 6, y: 9, width: 8, height: 2, color: shade)
        fill(context, x: 6, y: 8, width: 8, height: 1, color: shadeEdge)
        guard lit else {
            return
        }
        // 켜졌을 때만 심지 쪽에 흰 점을 둔다 — 갓 전체를 밝히는 것보다 광원이 또렷하다.
        fill(context, x: 9, y: 10, width: 2, height: 2, color: (red: 1, green: 0.98, blue: 0.90))
    }

    /// 광원 주위 빛무리. 가운데가 불투명하고 가장자리로 갈수록 사라지는 흰 원.
    ///
    /// 여기만 도트 격자를 쓰지 않는다 — 빛은 물체가 아니라 공기의 밝기라 계단을 만들면
    /// 오히려 이물감이 생긴다(레퍼런스로 삼은 픽셀 게임들도 빛무리는 부드럽게 깐다).
    private static func drawHalo(_ context: CGContext) {
        let colors = [
            CGColor(red: 1, green: 1, blue: 1, alpha: 1),
            CGColor(red: 1, green: 1, blue: 1, alpha: 0.45),
            CGColor(red: 1, green: 1, blue: 1, alpha: 0),
        ] as CFArray
        guard
            let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colors,
                locations: [0, 0.45, 1]
            )
        else {
            return
        }
        let center = CGPoint(x: side / 2, y: side / 2)
        context.drawRadialGradient(
            gradient,
            startCenter: center,
            startRadius: 0,
            endCenter: center,
            endRadius: CGFloat(side) / 2,
            options: []
        )
    }
}
