import AppKit
import ConsoleCore
import SpriteKit

/// 번들에 담긴 픽셀 스프라이트를 SKTexture 로 읽는다.
///
/// 확대·축소에 `nearest` 를 강제하는 것이 핵심 — 기본 선형 보간을 쓰면 도트 경계가 흐려져
/// 픽셀아트가 뭉개진 그림처럼 보인다.
///
/// 텍스처는 한 번 만들어 캐시한다. 26개뿐이라 전부 상주해도 부담이 없고, 매 배치마다
/// 디스크를 다시 읽으면 씬 재구성(창 크기 변경)이 눈에 띄게 끊긴다.
/// 0~255 범위로 자른 바이트 값.
private func clampByte(_ value: Double) -> UInt8 {
    UInt8(max(0, min(255, value.rounded())))
}

enum SpriteLoader {
    private static var cache: [String: SKTexture] = [:]

    static func texture(_ name: String) -> SKTexture? {
        if let cached = cache[name] {
            return cached
        }
        guard
            let url = Bundle.module.url(
                forResource: name, withExtension: "png", subdirectory: "sprites"
            ),
            let image = NSImage(contentsOf: url)
        else {
            return nil
        }
        let texture = SKTexture(image: image)
        texture.filteringMode = .nearest
        cache[name] = texture
        return texture
    }

    /// 머리색·셔츠색·바지색을 바꿔 찍어낸 캐릭터 텍스처.
    ///
    /// 캐릭터 스프라이트가 한 장뿐이라 26명이 전부 같은 사람으로 보인다. 실루엣은 그대로 두고
    /// 머리·셔츠·바지 색만 갈아끼우면, 도트 그림에서는 충분히 다른 사람으로 읽힌다.
    ///
    /// 색 구분은 밝기로 한다(실측):
    ///  - 머리 rgb(59,59,58) — 밝기 55 근처, 무채색
    ///  - 바지 rgb(5~17)     — 밝기 15 이하라 머리 범위 밖
    ///  - 셔츠 rgb(255)      — 밝기 최대, 무채색
    ///  - 얼굴 rgb(254,225,191) — 밝지만 채도가 있어 셔츠와 갈린다
    static func characterTexture(
        pose: String,
        sheet: Int,
        hair: (red: Double, green: Double, blue: Double),
        shirt: (red: Double, green: Double, blue: Double),
        pants: (red: Double, green: Double, blue: Double)
    ) -> SKTexture? {
        // 후보 순서는 규약이라 코어(`characterSpriteCandidates`)가 정하고, 여기서는 실제로
        // 번들에 있는 첫 파일을 고른다. 걸음 프레임은 에셋 파이프라인이 다리를 못 찾으면
        // 만들어지지 않으므로, 파일 유무를 안 보고 이름만 조립하면 그 사람이 걷는 동안
        // 통째로 안 그려진다.
        let candidates = characterSpriteCandidates(sheet: sheet, pose: pose)
        guard
            let name = candidates.first(where: {
                Bundle.module.url(forResource: $0, withExtension: "png", subdirectory: "sprites")
                    != nil
            })
        else {
            return nil
        }
        let key = String(
            format: "%@#%02X%02X%02X#%02X%02X%02X#%02X%02X%02X",
            name,
            Int(hair.red * 255), Int(hair.green * 255), Int(hair.blue * 255),
            Int(shirt.red * 255), Int(shirt.green * 255), Int(shirt.blue * 255),
            Int(pants.red * 255), Int(pants.green * 255), Int(pants.blue * 255)
        )
        if let cached = cache[key] {
            return cached
        }
        guard
            let url = Bundle.module.url(
                forResource: name, withExtension: "png", subdirectory: "sprites"
            ),
            let source = NSImage(contentsOf: url),
            let tiff = source.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff),
            let pixels = bitmap.bitmapData
        else {
            return nil
        }

        let bytesPerPixel = bitmap.bitsPerPixel / 8
        let bytesPerRow = bitmap.bytesPerRow
        // 머리는 스프라이트 위쪽에만 있다. 밝기만으로 가르면 시트에 따라 바지까지 머리로
        // 잡혀(어두운 회색 바지가 같은 밝기 대역) 사람마다 바지 색이 제멋대로 바뀐다.
        let hairZoneBottom = Int(Double(bitmap.pixelsHigh) * 0.45)
        for y in 0..<bitmap.pixelsHigh {
            for x in 0..<bitmap.pixelsWide {
                let offset = y * bytesPerRow + x * bytesPerPixel
                let red = Int(pixels[offset])
                let green = Int(pixels[offset + 1])
                let blue = Int(pixels[offset + 2])
                if bytesPerPixel > 3, pixels[offset + 3] < 16 {
                    continue
                }
                let brightness = (red + green + blue) / 3
                let saturation = max(red, green, blue) - min(red, green, blue)
                guard saturation < 26 else {
                    continue  // 얼굴·소품처럼 색이 있는 부분은 건드리지 않는다
                }
                let replacement: (red: Double, green: Double, blue: Double)?
                // 명암 단계를 정규화할 기준값. 부위마다 원본 밝기 대역이 달라 하나로 나누면
                // 어두운 부위가 통째로 검게 눌린다(바지 밝기 상한이 17 인데 60 으로 나누면 0.28).
                let shadeDivisor: Double
                if brightness >= 40, brightness <= 110, y < hairZoneBottom {
                    replacement = hair
                    shadeDivisor = 60
                } else if brightness >= 228 {
                    replacement = shirt
                    shadeDivisor = 255
                } else if brightness <= 24, y >= hairZoneBottom {
                    // 바지. 위치 조건이 함께 걸려야 한다 — 밝기만 보면 머리 윤곽선까지 잡힌다.
                    // 상한 24 는 원본 실측(5~17)에 여유를 둔 값이다.
                    replacement = pants
                    shadeDivisor = 17
                } else {
                    replacement = nil
                    shadeDivisor = 1
                }
                guard let replacement else {
                    continue
                }
                // 원본의 명암 단계를 유지한 채 색만 갈아끼운다 — 통짜로 칠하면 입체감이 사라진다.
                let shade = Double(brightness) / shadeDivisor
                pixels[offset] = clampByte(replacement.red * 255 * shade)
                pixels[offset + 1] = clampByte(replacement.green * 255 * shade)
                pixels[offset + 2] = clampByte(replacement.blue * 255 * shade)
            }
        }

        let recolored = NSImage(size: source.size)
        recolored.addRepresentation(bitmap)
        let texture = SKTexture(image: recolored)
        texture.filteringMode = .nearest
        cache[key] = texture
        return texture
    }

    static func floorTexture(_ tile: FloorTile) -> SKTexture? {
        texture(floorSpriteName(tile))
    }

    static func furnitureTexture(_ kind: FurnitureKind) -> SKTexture? {
        texture(furnitureSpriteName(kind))
    }
}

/// 바닥 타일 → 스프라이트 파일명.
func floorSpriteName(_ tile: FloorTile) -> String {
    switch tile {
    case .woodA:
        return "tile-wood-a"
    case .woodB:
        return "tile-wood-b"
    case .carpetLight:
        return "tile-carpet-light"
    case .carpetDark:
        return "tile-carpet-dark"
    case .ceramic:
        return "tile-ceramic"
    // 통로는 전용 에셋이 없어 세라믹(타일) 텍스처를 재사용하고 밝기로 갈린다.
    //
    // 한때 우드를 재사용했다. 그런데 우드는 리뷰·경영 두 방의 바닥재이기도 해서, 렌더 픽셀을
    // 재 보니 복도 RGB (80,39,17) 이 리뷰방 (71,34,16) · 경영방 (69,33,12) 과 거의 같았다 —
    // 복도가 그 두 방의 바닥과 이어져 보였다. "부서 바닥재가 통로와 같으면 안 된다" 는 회귀
    // 테스트가 있었지만 `FloorTile` 값만 비교해서, 값이 다르고 **텍스처가 같은** 이 경우를
    // 놓쳤다. 다섯 텍스처가 여섯 방에 모두 쓰여 안 겹치는 선택지가 없으므로 밝기로 가른다.
    case .corridor:
        return "tile-ceramic"
    case .wall:
        return "tile-wall"
    }
}

/// 가구 → 스프라이트 파일명.
func furnitureSpriteName(_ kind: FurnitureKind) -> String {
    switch kind {
    case .desk:
        return "furn-desk"
    case .chairDown:
        return "furn-chair-down"
    case .chairUp:
        return "furn-chair-up"
    case .meetingTable:
        return "furn-meeting-table"
    case .sofa2:
        return "furn-sofa-2"
    case .sofa3:
        return "furn-sofa-3"
    case .coffeeTable:
        return "furn-coffee-table"
    case .coffeeMachine:
        return "furn-coffee-machine"
    case .waterCooler:
        return "furn-water-cooler"
    case .whiteboard:
        return "furn-whiteboard"
    case .printer:
        return "furn-printer"
    case .plantTall:
        return "furn-plant-tall"
    case .plantSmall:
        return "furn-plant-small"
    case .bookshelf:
        return "furn-bookshelf"
    case .clock:
        return "furn-clock"
    case .trash:
        return "furn-trash"
    }
}

/// 캐릭터 방향 → 포즈 이름과 좌우 반전 여부.
///
/// 좌향·우향 스프라이트가 서로 미러 관계(불일치 3.7%)라 한 장만 담고 코드에서 뒤집는다.
/// 원본 side 는 왼쪽을 보고 있어, 오른쪽을 볼 때만 x 를 뒤집는다.
func characterSprite(for facing: Facing) -> (pose: String, flipped: Bool) {
    switch facing {
    case .down:
        return ("down", false)
    case .up:
        return ("up", false)
    case .left:
        return ("side", false)
    case .right:
        return ("side", true)
    }
}
