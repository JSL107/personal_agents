import AppKit
import ConsoleCore
import SpriteKit

/// 미리 준비할 캐릭터 그림 하나. 인덱스와 포즈 조합이 캐시의 한 칸이다.
struct CozyCharacterRequest: Equatable {
    let assetIndex: Int
    let pose: String
}

/// 범위 안으로 접은 인덱스와 정규화한 포즈. 캐시 키와 파일명이 이 한 값에서 나온다.
private struct NormalizedCozyCharacter {
    let index: Int
    let pose: String

    var cacheKey: String {
        "\(index):\(pose)"
    }
}

enum SpriteLoader {
    private static var cache: [String: SKTexture] = [:]
    private static var cozyCharacterCache: [String: NSImage] = [:]
    /// 캐릭터 텍스처. **이미지만 캐시하면 부족하다** — `SKTexture(image:)` 는 만들 때마다
    /// GPU 로 올라가는 새 텍스처라, 걸음마다 포즈를 갈아끼우는 사람이 여럿이면 1145×1374
    /// (약 6MB) 업로드가 초당 수십 번 일어난다. 방·가구가 이미 텍스처 단위로 캐시하는데
    /// (`cozyRoomCache`·`cozyFurnitureCache`) 캐릭터만 빠져 있었다.
    private static var cozyCharacterTextureCache: [String: SKTexture] = [:]
    private static var cozyRoomCache: [String: SKTexture] = [:]
    private static var cozyRoomImageCache: [String: NSImage] = [:]
    private static var cozyFurnitureCache: [String: SKTexture] = [:]
    private static var cozyAccentImageCache: [String: NSImage] = [:]

    /// 이미 한 번 알린 결손. 같은 조합이 프레임마다 로그를 다시 찍지 않게 막는다.
    /// 워밍(백그라운드)과 렌더(메인) 양쪽에서 닿으므로 `reportLock` 으로 감싼다.
    private static var reportedMissingAssets: Set<String> = []
    private static let reportLock = NSLock()

    /// 워밍이 이미 맡은 칸. 같은 그림을 두 번 읽지 않게 막는다. **메인 스레드에서만 만진다.**
    private static var prewarmingKeys: Set<String> = []

    static func cozyCharacterHasDedicatedPose(assetIndex: Int, pose: String) -> Bool {
        let normalizedIndex = ((assetIndex % cozyCharacterAssetCount) + cozyCharacterAssetCount) % cozyCharacterAssetCount
        let normalizedPose = normalizedCozyPose(pose)
        guard normalizedPose != cozyIdlePose else {
            return false
        }
        return Bundle.module.url(
            forResource: "agent-\(normalizedIndex)-\(normalizedPose)",
            withExtension: "png",
            subdirectory: "cozy/characters"
        ) != nil
    }

    /// 요청 포즈를 실재하는 에셋으로 옮긴다. 계약은 코어(`resolveCozyPose`)가 갖고 여기서는
    /// "이 파일이 번들에 있는가" 만 대답한다 — 파일 목록을 두 곳에 두면 에셋을 갈 때 어긋난다.
    static func resolvedCozyPose(assetIndex: Int, pose: String) -> ResolvedCozyPose {
        resolveCozyPose(requested: pose, assetIndex: assetIndex) { candidate in
            cozyCharacterHasDedicatedPose(assetIndex: assetIndex, pose: candidate)
        }
    }

    /// 캐릭터 그림. `pose` 는 `resolvedCozyPose` 를 지난 이름이어야 한다.
    ///
    /// **없는 포즈를 조용히 기본 그림으로 바꿔치는 것은 더 이상 정상 경로가 아니다.** 예전에는
    /// 도트 시절 이름(`down`·`side`·`-walk1`)이 매번 여기까지 내려와 폴백 로그를 수십 줄씩
    /// 쏟았다. 이제 대체는 코어의 계약이 미리 끝내므로, 여기까지 와서 파일이 없다면 계약을
    /// 건너뛴 호출이거나 에셋이 실제로 빠진 것이다 — 둘 다 한 번은 알릴 값어치가 있다.
    @MainActor
    static func cozyCharacterImage(assetIndex: Int, pose: String = cozyIdlePose) -> NSImage? {
        let cacheKey = cozyCharacterCacheKey(assetIndex: assetIndex, pose: pose)
        if let cached = cozyCharacterCache[cacheKey] {
            return cached
        }
        guard let image = prepareCozyCharacterImage(assetIndex: assetIndex, pose: pose) else {
            return nil
        }
        cozyCharacterCache[cacheKey] = image
        return image
    }

    /// 인덱스를 범위 안으로 접고 포즈 이름을 정규화한 값. 캐시 키와 파일명이 **같은 값에서**
    /// 나오게 하려고 한곳에 둔다 — 정규화를 양쪽에서 따로 하면 한쪽만 바뀌었을 때 캐시가
    /// 엉뚱한 파일을 가리키게 된다(리뷰가 잡은 중복이 그 상태였다).
    private static func normalizedCozyCharacter(
        assetIndex: Int, pose: String
    ) -> NormalizedCozyCharacter {
        let normalizedIndex = ((assetIndex % cozyCharacterAssetCount) + cozyCharacterAssetCount)
            % cozyCharacterAssetCount
        return NormalizedCozyCharacter(
            index: normalizedIndex, pose: normalizedCozyPose(pose)
        )
    }

    /// 조회·적재·워밍이 같은 칸을 가리키게 키 계산을 한곳에 둔다.
    private static func cozyCharacterCacheKey(assetIndex: Int, pose: String) -> String {
        normalizedCozyCharacter(assetIndex: assetIndex, pose: pose).cacheKey
    }

    /// 디스크에서 읽어 투명 여백을 잘라내기까지. 장당 약 32ms 가 드는 무거운 쪽이다.
    ///
    /// **캐시를 건드리지 않으므로 아무 스레드에서나 부를 수 있다.** 워밍이 백그라운드에서 이
    /// 함수만 쓰고, 캐시 적재는 메인으로 되돌린다 — 캐시 자체에 락을 걸면 렌더 경로(프레임마다
    /// 조회)가 그 락을 매번 지나야 하므로, 무거운 일만 옮기고 캐시는 메인 전용으로 남긴다.
    private static func prepareCozyCharacterImage(assetIndex: Int, pose: String) -> NSImage? {
        // 캐시 키와 **같은 정규화 결과**에서 파일명을 만든다. 따로 계산하면 둘이 갈린다.
        let normalized = normalizedCozyCharacter(assetIndex: assetIndex, pose: pose)
        let normalizedIndex = normalized.index
        let normalizedPose = normalized.pose
        let posedName = "agent-\(normalizedIndex)-\(normalizedPose)"
        let posedURL = normalizedPose == cozyIdlePose
            ? nil
            : Bundle.module.url(
                forResource: posedName, withExtension: "png", subdirectory: "cozy/characters"
            )
        let fallbackURL = Bundle.module.url(
            forResource: "agent-\(normalizedIndex)", withExtension: "png", subdirectory: "cozy/characters"
        )
        if posedURL == nil, normalizedPose != cozyIdlePose {
            reportMissingAsset("\(posedName).png — 포즈 계약을 거치지 않은 요청")
        }
        guard let url = posedURL ?? fallbackURL, let sourceImage = NSImage(contentsOf: url) else {
            reportMissingAsset("agent-\(normalizedIndex).png")
            return nil
        }
        return imageByCroppingTransparentMargins(sourceImage)
    }

    /// 화면에 보이는 사람들의 **현재 포즈**를 백그라운드에서 미리 준비해 캐시에 채운다.
    ///
    /// 이것이 필요한 이유는 준비가 렌더 스레드에 있다는 것이다. 장당 32ms 라 30명이면 약 1초가
    /// 프레임 안에서 돌고, 그동안 창 전체가 멈춘다. 상태를 먼저 알려 주는 쪽(`store`)이 있으므로
    /// 그 시점에 준비를 시작하면 실제 렌더는 캐시를 집어 간다.
    ///
    /// **한계를 분명히 해 둔다.** SwiftUI 는 상태가 바뀌면 곧바로 `body` 를 다시 평가하므로,
    /// 상태 변화 **직후 첫 렌더**는 워밍과 경쟁해서 질 수 있다(그때는 기존처럼 동기 준비를
    /// 탄다). 확실히 이득인 구간은 탭 전환·스크롤로 새로 보이는 카드·재연결 스냅샷처럼 준비할
    /// 시간이 있는 경우다. 전 포즈를 미리 채우면 그 경쟁도 없앨 수 있지만 캐시 메모리가 함께
    /// 늘어나므로(장당 원본 크기) 여기서는 현재 포즈만 맡는다.
    ///
    /// 메인 전용인 것을 **주석이 아니라 `@MainActor` 로 못박는다.** 캐시(`Dictionary`)와 진행
    /// 목록(`Set`)을 렌더와 동시에 변형하면 오작동이 아니라 자료구조 손상이고, 안전 근거가
    /// 주석에만 있으면 잘못된 호출을 컴파일러가 막아 주지 못한다 — `View.task` 의 action 처럼
    /// 아이솔레이션을 상속하지 않는 자리에서 부르는 것이 실제로 있었다(리뷰가 잡았다).
    @MainActor
    static func prewarmCozyCharacters(_ requests: [CozyCharacterRequest]) {
        var pending: [CozyCharacterRequest] = []
        for request in requests {
            let key = cozyCharacterCacheKey(assetIndex: request.assetIndex, pose: request.pose)
            guard cozyCharacterCache[key] == nil, !prewarmingKeys.contains(key) else {
                continue
            }
            prewarmingKeys.insert(key)
            pending.append(request)
        }
        guard !pending.isEmpty else {
            return
        }
        DispatchQueue.global(qos: .utility).async {
            for request in pending {
                let image = prepareCozyCharacterImage(
                    assetIndex: request.assetIndex, pose: request.pose
                )
                let key = cozyCharacterCacheKey(assetIndex: request.assetIndex, pose: request.pose)
                DispatchQueue.main.async {
                    prewarmingKeys.remove(key)
                    // 그 사이 렌더가 같은 칸을 이미 채웠으면 그대로 둔다 — 같은 그림이지만
                    // 덮어쓰면 이미 화면에 올라간 인스턴스와 다른 객체가 되어 무의미한 교체가 된다.
                    if let image, cozyCharacterCache[key] == nil {
                        cozyCharacterCache[key] = image
                    }
                }
            }
        }
    }

    /// 그 그림이 이미 캐시에 있는지. 워밍이 실제로 적재까지 했는지 확인하는 검사
    /// (`--prewarm-check`)가 쓴다 — 시간을 재서 "빨라졌으니 됐다"고 판정하면 느린 기계에서
    /// 흔들리므로, 적재 여부를 직접 본다. 캐시를 읽으므로 위와 같은 이유로 메인 전용이다.
    @MainActor
    static func isCozyCharacterCached(assetIndex: Int, pose: String) -> Bool {
        cozyCharacterCache[cozyCharacterCacheKey(assetIndex: assetIndex, pose: pose)] != nil
    }

    private static func reportMissingAsset(_ description: String) {
        reportOnce("cozy character asset missing: \(description)")
    }

    /// 같은 사유를 프레임마다 다시 찍지 않게 한 번만 알린다.
    ///
    /// 결손 목록은 워밍(백그라운드)과 렌더(메인) 양쪽에서 닿으므로 락으로 감싼다. `fputs` 는
    /// 락 밖에서 부른다 — 파일 쓰기를 락 안에 두면 느린 터미널이 렌더를 붙잡는다.
    private static func reportOnce(_ message: String) {
        reportLock.lock()
        let isFirstTime = reportedMissingAssets.insert(message).inserted
        reportLock.unlock()
        guard isFirstTime else {
            return
        }
        fputs("\(message)\n", stderr)
    }

    /// 알파 경계를 **재기 위해** 줄이는 크기. 화면에 나가는 그림은 아래에서 원본을 잘라 만들므로
    /// 이 값은 화질과 무관하고, 정하는 것은 경계의 정밀도뿐이다 — 512px 이면 원본(최대 1374px)
    /// 기준 오차가 3px 미만이고, 그 몫은 `imageByCroppingTransparentMargins` 가 여백에 더해
    /// 흡수한다. 줄이지 않고 원본에서 재면 장당 217ms 가 든다(디버그 빌드 실측).
    ///
    /// `private` 이 아닌 것은 `runCozyCropCheck` 가 **자기 표본이 어느 경로를 타는지** 이 값과
    /// 대조하기 때문이다. 이 상한이 커지면 표본이 죄다 프로브를 타지 않게 되는데, 그러면
    /// 프로브 수식이 한 번도 검사되지 않으면서 검사는 통과한다 — 그 구멍을 막으려면 검사가
    /// 실제 상한을 알아야 한다.
    static let alphaProbeMaxDimension = 512

    /// 생성 이미지마다 투명 캔버스 여백이 조금씩 달라도 실제 머리/발 경계가 같은 기준으로
    /// 배치되게 한다. 전체 1145×1374 캔버스를 기준으로 세우면 발 아래 여백까지 몸 높이로
    /// 계산되어 포즈마다 그림자에서 뜨는 양이 달라진다.
    ///
    /// **경계는 줄인 사본에서 재고, 자르는 것은 원본이다.** 알파 경계 탐색은 픽셀을 하나씩
    /// 훑는 일이라 원본 해상도(157만 픽셀)에서는 장당 217ms 가 걸리는데, 이 함수는 카드
    /// 렌더(`CozyAgentAvatarView.body`)와 오피스 씬 구성 도중 메인 스레드에서 불려 그 시간만큼
    /// 화면이 통째로 멈췄다 — 캐릭터를 채운 오피스 렌더가 7.6초였다. 포즈가 바뀌면 캐시가 비어
    /// 클릭 직후에도 같은 정지가 났다.
    ///
    /// 줄인 사본을 **그대로 반환하면 안 된다.** 방을 확대하면 캐릭터가 440px 넘게 그려지고
    /// 큰 창에서는 더 커져, 512px 사본은 그때 늘려 쓰이며 머리카락 결이 뭉개진다(전후 렌더를
    /// 3배 확대해 대조 확인). 사본은 경계를 찾는 데만 쓰고 화면에 나가는 픽셀은 원본에서 온다.
    ///
    /// `private` 이 아닌 것은 `runCozyCropCheck`(`--crop-check`) 가 이 계약을 고정하기
    /// 때문이다 — `ConsoleCoreTests` 는 `ConsoleCore` 타깃만 의존해 이 파일을 한 줄도 밟지
    /// 않으므로, 단언 2만 건이 통과해도 아래 수식의 회귀는 그쪽에서 잡히지 않는다.
    static func imageByCroppingTransparentMargins(_ image: NSImage) -> NSImage {
        guard let sourceImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            return image
        }
        let alphaInfo = sourceImage.alphaInfo
        guard alphaInfo != .none, alphaInfo != .noneSkipFirst, alphaInfo != .noneSkipLast else {
            return image
        }
        let probe = downscaledAlphaProbe(sourceImage)
        let measured = probe ?? sourceImage
        guard let bounds = alphaBounds(of: measured) else { return image }
        // 되돌리는 비율은 **축마다 따로** 잡는다. 사본 크기는 정수로 반올림해 만들어지므로
        // 가로·세로 비율이 정확히 같지 않고(1145×1374 → 427×512 이면 2.6815 대 2.6836),
        // 한쪽 비율로 두 축을 환산하면 반대 축 끝에서 1px 이 밀린다.
        let ratioX = CGFloat(sourceImage.width) / CGFloat(measured.width)
        let ratioY = CGFloat(sourceImage.height) / CGFloat(measured.height)
        // 줄인 사본의 한 칸은 원본 여러 칸을 대표한다. 되돌릴 때 그만큼 바깥으로 벌려 실제 몸
        // 경계를 안쪽으로 자르는 일이 없게 하고, 원래의 여백 4px 을 그 위에 얹는다. 사본을 못
        // 만들어 원본에서 그대로 쟀다면 벌릴 것이 없다.
        //
        // 이 벌림은 **방어로 남겨 둔 것**이다. 에셋 183장 전수로 재 보니 벌리지 않아도 몸이
        // 잘린 장은 0건이고(`.rounded(.down)` 이 이미 바깥으로 보낸다), 벌린 만큼 캐릭터가
        // 0.37%p 작아진다. 그래도 두는 이유는 축소 평균이 임계값 8 근처의 희박한 알파를 삼키는
        // 경우를 덮기 때문이다 — 생성 이미지를 픽셀 팩으로 바꾸는 후속이 열려 있어 에셋이
        // 교체되면 그 경우가 생길 수 있다. 떼려면 `--crop-check` 표본을 전수로 늘려 먼저 확인할 것.
        let padding = 4 + (probe == nil ? 0 : Int(max(ratioX, ratioY).rounded(.up)))
        let minX = max(0, Int((bounds.minX * ratioX).rounded(.down)) - padding)
        let minY = max(0, Int((bounds.minY * ratioY).rounded(.down)) - padding)
        let maxX = min(sourceImage.width, Int((bounds.maxX * ratioX).rounded(.up)) + padding)
        let maxY = min(sourceImage.height, Int((bounds.maxY * ratioY).rounded(.up)) + padding)
        guard maxX > minX, maxY > minY else { return image }
        let crop = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY).integral
        guard let cropped = sourceImage.cropping(to: crop) else { return image }
        return NSImage(
            cgImage: cropped,
            size: NSSize(width: cropped.width, height: cropped.height)
        )
    }

    /// 알파가 실제로 찍힌 가장 바깥 픽셀의 사각형. 전부 투명하면 nil.
    private static func alphaBounds(of cgImage: CGImage) -> CGRect? {
        guard let provider = cgImage.dataProvider,
              let data = provider.data,
              let bytes = CFDataGetBytePtr(data) else {
            return nil
        }
        let bytesPerPixel = cgImage.bitsPerPixel / 8
        guard bytesPerPixel > 0 else { return nil }
        let alphaInfo = cgImage.alphaInfo
        let alphaOffset = alphaInfo == .first || alphaInfo == .premultipliedFirst
            ? 0
            : bytesPerPixel - 1
        var minX = cgImage.width
        var minY = cgImage.height
        var maxX = -1
        var maxY = -1
        for y in 0..<cgImage.height {
            let row = y * cgImage.bytesPerRow
            for x in 0..<cgImage.width {
                if bytes[row + x * bytesPerPixel + alphaOffset] > 8 {
                    minX = min(minX, x)
                    minY = min(minY, y)
                    maxX = max(maxX, x)
                    maxY = max(maxY, y)
                }
            }
        }
        guard maxX >= minX, maxY >= minY else { return nil }
        return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    /// 경계를 재기 위한 축소 사본. 상한보다 작은 그림은 만들지 않는다(그대로 재면 된다).
    ///
    /// 색공간은 원본 것을 그대로 이어받는다 — 사본은 경계를 재는 데만 쓰여 색이 정확할 필요가
    /// 없지만, 변환을 한 겹 걷어 두면 축소가 그만큼 싸다. **알파가 실릴 위치는 색공간과
    /// 무관하다** — 그것은 아래 `bitmapInfo` 가 정하고 `alphaBounds` 가 넘겨받은 그림의
    /// `alphaInfo` 로 다시 읽는다(이 주석은 한때 색공간이 알파 위치를 옮긴다고 적고 있었다).
    private static func downscaledAlphaProbe(_ cgImage: CGImage) -> CGImage? {
        let longestSide = max(cgImage.width, cgImage.height)
        guard longestSide > alphaProbeMaxDimension else { return nil }
        let ratio = CGFloat(alphaProbeMaxDimension) / CGFloat(longestSide)
        let width = Int((CGFloat(cgImage.width) * ratio).rounded())
        let height = Int((CGFloat(cgImage.height) * ratio).rounded())
        guard width > 0, height > 0 else { return nil }
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: cgImage.colorSpace ?? CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            // 8bpc + premultipliedLast 로 열 수 없는 색공간(그레이스케일·CMYK·인덱스)이면
            // 여기서 끊긴다. 부르는 쪽은 원본 전수 스캔으로 되돌아가 장당 217ms 를 메인
            // 스레드에서 쓰므로, 조용히 느려지지 않게 한 번은 알린다.
            reportOnce(
                "알파 경계용 축소 사본을 만들지 못했다 — 원본 전수 스캔으로 되돌아간다"
                    + " (\(cgImage.width)×\(cgImage.height), bpp=\(cgImage.bitsPerPixel))"
            )
            return nil
        }
        context.interpolationQuality = .high
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage()
    }

    @MainActor
    static func cozyCharacterTexture(assetIndex: Int, pose: String = "idle") -> SKTexture? {
        // 키는 `cozyCharacterImage` 와 같은 기준으로 잡는다 — 인덱스를 범위 안으로 접고
        // 포즈 이름을 정규화한 뒤라야, `walkside` 같은 다른 표기가 같은 칸을 쓴다.
        let normalizedIndex = ((assetIndex % cozyCharacterAssetCount) + cozyCharacterAssetCount)
            % cozyCharacterAssetCount
        let cacheKey = "\(normalizedIndex):\(normalizedCozyPose(pose))"
        if let cached = cozyCharacterTextureCache[cacheKey] {
            return cached
        }
        guard let image = cozyCharacterImage(assetIndex: assetIndex, pose: pose) else {
            return nil
        }
        let texture = SKTexture(image: image)
        texture.filteringMode = .linear
        cozyCharacterTextureCache[cacheKey] = texture
        return texture
    }

    static func cozyDepartmentRoomTexture(_ department: Department) -> SKTexture? {
        cozyRoomTexture(named: "\(department.rawValue)-shell")
    }

    static func cozySharedOakFloorTexture() -> SKTexture? {
        cozyRoomTexture(named: "shared-oak-corridor")
    }

    static func cozyDepartmentRoomImage(_ department: Department) -> NSImage? {
        let name = "\(department.rawValue)-shell"
        if let cached = cozyRoomImageCache[name] { return cached }
        guard let url = Bundle.module.url(
            forResource: name,
            withExtension: "png",
            subdirectory: "cozy/rooms"
        ), let image = NSImage(contentsOf: url) else {
            return nil
        }
        cozyRoomImageCache[name] = image
        return image
    }

    static func cozyDashboardAccentImage(
        agentType: String,
        department: Department
    ) -> NSImage? {
        let roleAsset: String?
        switch agentType {
        case "VACATION":
            roleAsset = "vacation-accent"
        case "CAREER_MATE":
            roleAsset = "career-accent"
        default:
            roleAsset = nil
        }
        if let roleAsset, let image = cozyAccentImage(named: roleAsset) {
            return image
        }
        return cozyDepartmentAccentImage(department)
    }

    static func cozyDepartmentAccentImage(_ department: Department) -> NSImage? {
        // The evaluation and internal-ops renders came back with each other's strongest visual
        // metaphor. Route by meaning: charts belong to evaluation, gear/file tray to operations.
        let name: String
        switch department {
        case .evaluation:
            name = "internal-ops-accent"
        case .internalOps:
            name = "evaluation-accent"
        default:
            name = "\(department.rawValue)-accent"
        }
        return cozyAccentImage(named: name)
    }

    private static func cozyAccentImage(named name: String) -> NSImage? {
        if let cached = cozyAccentImageCache[name] { return cached }
        guard let url = Bundle.module.url(
            forResource: name,
            withExtension: "png",
            subdirectory: "cozy/props"
        ), let image = NSImage(contentsOf: url) else {
            return nil
        }
        cozyAccentImageCache[name] = image
        return image
    }

    static func cozyCommonAreaTexture(_ kind: CommonAreaKind) -> SKTexture? {
        cozyRoomTexture(named: "\(kind.rawValue)-shell")
    }

    static func cozyFurnitureTexture(_ kind: FurnitureKind) -> SKTexture? {
        let assetName: String?
        switch kind {
        case .desk:
            assetName = "workstation"
        case .chairDown, .chairUp:
            assetName = "chair"
        case .sofa2, .sofa3:
            assetName = "sofa"
        case .meetingTable:
            assetName = "meeting-table"
        // 응접 테이블은 전용 원화가 생겼다. 예전에는 회의 테이블 그림을 같이 썼는데, 여섯
        // 사람이 둘러앉는 큰 타원이 소파 앞 낮은 탁자 자리에 들어가 방의 뜻이 바뀌었다.
        case .coffeeTable:
            assetName = "coffee-table"
        // 책장 원화는 여기 남는다. **그릴지 말지는 `officeCozyDrawnFurnitureKinds` 가
        // 정한다** — 이 함수에서 nil 을 돌리면 안 그려지는 것이 아니라 옛 도트 도형
        // fallback 으로 내려가, 3D 방 배경 위에 납작한 판때기가 뜬다(실측으로 확인).
        case .bookshelf, .wallShelf:
            assetName = "bookshelf"
        case .coffeeMachine, .sinkCounter:
            assetName = "coffee-station"
        case .trash:
            assetName = "waste-bin"
        // 방과 방 사이 경계에 세우는 문. 에셋이 없으면 nil 이 돌아가 **아무것도 그려지지
        // 않는다** — 지금까지와 같은 화면이므로, 원화가 들어오는 순간에만 문이 선다.
        case .doorClosed:
            assetName = "door-closed"
        case .doorOpen:
            assetName = "door-open"
        default:
            assetName = nil
        }
        guard let assetName else {
            return nil
        }
        return cozyFurnitureTexture(named: assetName)
    }

    /// 로봇청소기 그림. 없으면 nil 을 돌려 부르는 쪽이 도형 fallback 으로 내려간다 —
    /// 청소기는 장식이 아니라 "주간 청소가 살아 있다" 는 신호라, 번들이 어긋났다고
    /// 표시 자체가 사라지면 안 된다.
    static func cozyVacuumRobotTexture() -> SKTexture? {
        cozyFurnitureTexture(named: "vacuum-robot")
    }

    /// 회의 테이블 위에 올리는 작업물(노트북·머그·서류). 없으면 nil 을 돌려 상판을 비운다 —
    /// 도형으로 흉내 내던 시절에는 3D 상판 위에 평면 사각형이 떠 있었다.
    static func cozyDeskItemsTexture() -> SKTexture? {
        cozyFurnitureTexture(named: "desk-items")
    }

    /// 청소기가 못 치우고 남긴 몫. 청소기와 마찬가지로 없으면 nil 을 돌려 도형으로 내려간다.
    static func cozyPendingDustTexture() -> SKTexture? {
        cozyFurnitureTexture(named: "dust-pile")
    }

    private static func cozyFurnitureTexture(named assetName: String) -> SKTexture? {
        if let cached = cozyFurnitureCache[assetName] {
            return cached
        }
        guard let url = Bundle.module.url(
            forResource: assetName,
            withExtension: "png",
            subdirectory: "cozy/furniture-3d"
        ), let image = NSImage(contentsOf: url) else {
            return nil
        }
        let texture = SKTexture(image: image)
        texture.filteringMode = .linear
        cozyFurnitureCache[assetName] = texture
        return texture
    }

    static func cozyDepartmentFeatureTexture(_ department: Department) -> SKTexture? {
        let assetName: String
        switch department {
        case .planning:
            assetName = "planning-board-table"
        case .quality:
            assetName = "quality-review-station"
        case .evaluation:
            assetName = "evaluation-kpi-console"
        case .treasury:
            assetName = "treasury-ledger-console"
        case .content:
            assetName = "content-storyboard-station"
        case .internalOps:
            assetName = "internal-ops-control-desk"
        }
        return cozyFurnitureTexture(named: assetName)
    }

    private static func cozyRoomTexture(named name: String) -> SKTexture? {
        if let cached = cozyRoomCache[name] {
            return cached
        }
        guard let url = Bundle.module.url(
            forResource: name,
            withExtension: "png",
            subdirectory: "cozy/rooms"
        ), let image = NSImage(contentsOf: url) else {
            return nil
        }
        let texture = SKTexture(image: image)
        texture.filteringMode = .linear
        cozyRoomCache[name] = texture
        return texture
    }

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
    case .wallLandscape:
        return "furn-wall-landscape"
    case .wallAbstract:
        return "furn-wall-abstract"
    case .wallCalendar:
        return "furn-wall-calendar"
    case .wallCertificate:
        return "furn-wall-certificate"
    case .wallPinboard:
        return "furn-wall-pinboard"
    case .wallWhiteboard:
        return "furn-wall-whiteboard"
    case .wallShelf:
        return "furn-wall-shelf"
    case .wallMonitor:
        return "furn-wall-monitor"
    case .wallPoster:
        return "furn-wall-poster"
    case .wallPlantHanging:
        return "furn-wall-plant-hanging"
    case .doorClosed:
        return "furn-door-closed"
    case .doorOpen:
        return "furn-door-open"
    case .filingCabinet:
        return "furn-filing-cabinet"
    case .lockers2:
        return "furn-lockers-2"
    case .partitionLow:
        return "furn-partition-low"
    case .vendingMachine:
        return "furn-vending-machine"
    case .refrigerator:
        return "furn-refrigerator"
    case .sinkCounter:
        return "furn-sink-counter"
    case .partitionGlass:
        return "furn-partition-glass"
    case .rugGreen:
        return "furn-rug-green"
    case .rugBeige:
        return "furn-rug-beige"
    case .rugNavy:
        return "furn-rug-navy"
    }
}
