import AppKit
import ConsoleCore

/// 투명 여백 잘라내기(`SpriteLoader.imageByCroppingTransparentMargins`)의 계약을 고정한다.
///
/// **이 검사가 따로 있어야 하는 이유는 게이트 구조에 있다.** `ConsoleCoreTests` 는
/// `ConsoleCore` 타깃만 의존하므로 `Sources/IdaeriConsole` 의 이 경로를 한 줄도 밟지 않는다
/// — 단언 2만 건이 통과해도 크롭 수식의 회귀는 그쪽에서 잡히지 않는다. `--color-check` 와
/// 렌더 게이트는 화면이 그려지는지와 픽셀 밝기만 보고, 경계 계산이 맞는지는 단언하지 않는다.
/// (#602 가 이 사각지대를 실측 없이 통과했다 — 당시 검증은 레포 밖 일회성 프로그램이었다.)
///
/// 고정하는 계약 셋:
/// 1. **몸을 자르지 않는다** — 잘라낸 그림에서 알파 경계를 다시 재면 원본에서 잰 것과 같은
///    크기여야 한다. 축소 사본으로 경계를 재는 탓에 한 칸이 원본 여러 칸을 대표하는데, 되돌릴
///    때 안쪽으로 접히면 머리카락·발끝이 잘린다.
/// 2. **여백을 남긴다** — 경계가 그림 가장자리에 닿지 않아야 한다. 닿으면 배치 기준이 되는
///    발 아래 여백이 사라진다.
/// 3. **여백이 과하지 않다** — 남는 여백에 상한을 둔다. 여백이 커지면 같은 프레임에 맞출 때
///    캐릭터가 그만큼 작아진다.
func runCozyCropCheck() -> Bool {
    var valid = true

    // 프로브를 타는 크기(최장변 > 512)와 타지 않는 크기(≤ 512)를 각각 확인한다. 후자는 현재
    // 에셋 183장 어디에도 없어(전부 1145×1374) 실물로는 한 번도 실행되지 않는 경로다 —
    // 합성 이미지가 아니면 검사할 방법이 없다.
    let syntheticCases: [(label: String, width: Int, height: Int, body: CGRect)] = [
        ("프로브 경로 · 실제 시트 크기", 1145, 1374, CGRect(x: 300, y: 400, width: 500, height: 800)),
        ("프로브 경로 · 가로로 긴 그림", 1400, 600, CGRect(x: 120, y: 90, width: 900, height: 420)),
        ("프로브 경로 · 여백이 거의 없는 그림", 1145, 1374, CGRect(x: 2, y: 3, width: 1140, height: 1368)),
        ("직접 경로 · 상한 이하", 400, 380, CGRect(x: 40, y: 50, width: 220, height: 200)),
    ]
    for testCase in syntheticCases {
        guard let image = syntheticAlphaImage(
            width: testCase.width,
            height: testCase.height,
            body: testCase.body
        ) else {
            fputs("crop check: 합성 이미지를 만들지 못했다 — \(testCase.label)\n", stderr)
            valid = false
            continue
        }
        if !assertCropContract(image: image, label: testCase.label) {
            valid = false
        }
    }

    // 실물 에셋도 몇 장 통과시킨다. 합성 이미지는 경계가 반듯한 직사각형이라, 생성 그림처럼
    // 알파가 흐릿하게 번지는 가장자리를 재현하지 못한다. 장당 전수 스캔이 두 번 드므로
    // (원본 + 크롭 결과) 표본은 작게 둔다.
    let assetSamples = ["agent-0", "agent-3-typing", "agent-17-drinking", "agent-19-reading"]
    for name in assetSamples {
        guard let url = Bundle.module.url(
            forResource: name, withExtension: "png", subdirectory: "cozy/characters"
        ), let image = NSImage(contentsOf: url) else {
            fputs("crop check: 표본 에셋을 열지 못했다 — \(name).png\n", stderr)
            valid = false
            continue
        }
        if !assertCropContract(image: image, label: "실물 에셋 · \(name).png") {
            valid = false
        }
    }

    if valid {
        print("✓ 크롭 계약 통과 — 몸 경계 보존·여백 유지·여백 상한이 유효하다")
    }
    return valid
}

/// 남겨도 되는 여백의 상한(px). 프로브 상한이 512px 일 때 실제 여백은 7px 이고(원래의 4px +
/// 사본 한 칸이 대표하는 2.68px 을 올림한 3px), 프로브 상한을 128px 까지 낮춰도 15px 이라
/// 이 값 안에 든다. 여기에 걸린다면 여백 계산이 바뀐 것이므로 눈으로 확인할 값어치가 있다.
private let maximumAllowedMargin = 16

/// 한 장에 대해 계약 셋을 모두 확인한다.
private func assertCropContract(image: NSImage, label: String) -> Bool {
    guard let sourceImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
          let sourceBounds = independentAlphaBounds(of: sourceImage) else {
        fputs("crop check: 원본에서 알파 경계를 찾지 못했다 — \(label)\n", stderr)
        return false
    }
    let cropped = SpriteLoader.imageByCroppingTransparentMargins(image)
    guard let croppedImage = cropped.cgImage(forProposedRect: nil, context: nil, hints: nil),
          let croppedBounds = independentAlphaBounds(of: croppedImage) else {
        fputs("crop check: 잘라낸 그림에서 알파 경계를 찾지 못했다 — \(label)\n", stderr)
        return false
    }

    var valid = true

    // 계약 1 — 몸을 자르지 않았다. 여백만 걷혔다면 경계의 크기는 그대로다.
    if croppedBounds.width != sourceBounds.width || croppedBounds.height != sourceBounds.height {
        fputs(
            "crop check: 몸 경계가 달라졌다 — \(label)"
                + " 원본 \(Int(sourceBounds.width))×\(Int(sourceBounds.height))"
                + " → 잘라낸 뒤 \(Int(croppedBounds.width))×\(Int(croppedBounds.height))\n",
            stderr
        )
        valid = false
    }

    // 계약 2 — 여백이 남았다. 원본에 여백이 없던 그림(경계가 이미 가장자리에 닿은 경우)은
    // 잘라낼 여백 자체가 없으므로 이 계약의 대상이 아니다.
    let sourceHadMargin = sourceBounds.minX > 0 && sourceBounds.minY > 0
        && Int(sourceBounds.maxX) < sourceImage.width && Int(sourceBounds.maxY) < sourceImage.height
    if sourceHadMargin, croppedBounds.minX <= 0 || croppedBounds.minY <= 0 {
        fputs("crop check: 잘라낸 그림의 알파가 가장자리에 닿았다 — \(label)\n", stderr)
        valid = false
    }

    // 계약 3 — 여백이 과하지 않다.
    let marginX = croppedImage.width - Int(croppedBounds.width)
    let marginY = croppedImage.height - Int(croppedBounds.height)
    if marginX > maximumAllowedMargin * 2 || marginY > maximumAllowedMargin * 2 {
        fputs(
            "crop check: 남은 여백이 상한을 넘었다 — \(label)"
                + " 가로 \(marginX)px · 세로 \(marginY)px (양쪽 합 상한 \(maximumAllowedMargin * 2)px)\n",
            stderr
        )
        valid = false
    }

    return valid
}

/// 알려진 알파 사각형 하나만 불투명한 그림. `body` 는 `CGContext` 좌표(아래가 원점)이지만
/// 계약은 경계의 **크기**로만 판정하므로 위아래 방향은 문제가 되지 않는다.
private func syntheticAlphaImage(width: Int, height: Int, body: CGRect) -> NSImage? {
    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        return nil
    }
    context.clear(CGRect(x: 0, y: 0, width: width, height: height))
    context.setFillColor(CGColor(red: 0.24, green: 0.42, blue: 0.78, alpha: 1))
    context.fill(body)
    guard let cgImage = context.makeImage() else {
        return nil
    }
    return NSImage(cgImage: cgImage, size: NSSize(width: width, height: height))
}

/// 알파가 찍힌 가장 바깥 픽셀의 사각형. **`SpriteLoader` 의 것을 빌려 쓰지 않는다** — 검사가
/// 대상과 같은 구현을 쓰면 그 구현이 틀렸을 때 둘이 똑같이 틀려 아무것도 잡지 못한다.
/// 임계값 8 은 대상과 맞춘다(그 값이 계약의 일부다).
private func independentAlphaBounds(of cgImage: CGImage) -> CGRect? {
    guard let provider = cgImage.dataProvider,
          let data = provider.data,
          let bytes = CFDataGetBytePtr(data) else {
        return nil
    }
    let bytesPerPixel = cgImage.bitsPerPixel / 8
    guard bytesPerPixel > 0 else {
        return nil
    }
    let alphaInfo = cgImage.alphaInfo
    guard alphaInfo != .none, alphaInfo != .noneSkipFirst, alphaInfo != .noneSkipLast else {
        return nil
    }
    let alphaOffset = alphaInfo == .first || alphaInfo == .premultipliedFirst
        ? 0
        : bytesPerPixel - 1
    var left = cgImage.width
    var top = cgImage.height
    var right = -1
    var bottom = -1
    for y in 0..<cgImage.height {
        let row = y * cgImage.bytesPerRow
        for x in 0..<cgImage.width {
            if bytes[row + x * bytesPerPixel + alphaOffset] > 8 {
                left = min(left, x)
                top = min(top, y)
                right = max(right, x)
                bottom = max(bottom, y)
            }
        }
    }
    guard right >= left, bottom >= top else {
        return nil
    }
    return CGRect(x: left, y: top, width: right - left + 1, height: bottom - top + 1)
}
