import AppKit
import ConsoleCore

/// 워밍(`SpriteLoader.prewarmCozyCharacters`)이 **실제로 캐시를 채우는지** 확인한다.
///
/// 워밍은 눈에 보이지 않는 최적화라 조용히 죽어도 화면은 그대로다 — 준비가 렌더 스레드로
/// 되돌아가 느려질 뿐이고, 어느 게이트도 그것을 알려주지 않는다. 그래서 적재를 직접 본다.
///
/// 시간을 재서 "빨라졌으니 됐다"고 판정하지 않는다. 그 판정은 느린 기계와 첫 디코드의
/// 프레임워크 웜업에 흔들린다. 대신 `SpriteLoader.isCozyCharacterCached` 로 칸이 찼는지 본다.
func runCozyPrewarmCheck() -> Bool {
    var valid = true

    // 1) 요청 생성이 중복을 접는지. 같은 명단을 두 번 이어 붙여도 요청 수가 같아야 한다 —
    //    서로 다른 담당자가 같은 그림을 쓰는 경우가 실제로 있고, 접지 않으면 같은 파일을
    //    여러 번 읽는다.
    let singleRequests = cozyDashboardPrewarmRequests(for: dashboardPreviewAgents)
    let doubledRequests = cozyDashboardPrewarmRequests(
        for: dashboardPreviewAgents + dashboardPreviewAgents
    )
    if singleRequests.isEmpty {
        fputs("prewarm check: 고정 명단에서 요청이 하나도 나오지 않았다\n", stderr)
        valid = false
    }
    if doubledRequests.count != singleRequests.count {
        fputs(
            "prewarm check: 중복 요청이 접히지 않았다 — 명단을 두 배로 넣으면"
                + " \(singleRequests.count)건이어야 하는데 \(doubledRequests.count)건\n",
            stderr
        )
        valid = false
    }

    // 2) 워밍이 캐시를 채우는지. 아직 아무도 쓰지 않은 조합을 골라야 한다 — 이미 채워진 칸으로
    //    재면 워밍이 아무 일도 하지 않고도 통과한다.
    guard let target = firstUncachedRequest() else {
        fputs("prewarm check: 캐시가 비어 있는 조합을 찾지 못해 적재를 확인할 수 없다\n", stderr)
        return false
    }
    SpriteLoader.prewarmCozyCharacters([target])

    // 적재는 메인 큐로 되돌아온다. 이 함수가 메인을 붙잡고 있으면 그 블록이 실행되지 못하므로
    // 런루프를 돌려 준다 — `sleep` 으로 기다리면 영원히 채워지지 않는다.
    let deadline = Date().addingTimeInterval(15)
    while !SpriteLoader.isCozyCharacterCached(assetIndex: target.assetIndex, pose: target.pose),
        Date() < deadline
    {
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
    }

    if SpriteLoader.isCozyCharacterCached(assetIndex: target.assetIndex, pose: target.pose) {
        print("✓ 워밍 계약 통과 — 중복 요청이 접히고 백그라운드 준비가 캐시에 적재된다")
    } else {
        fputs(
            "prewarm check: 워밍이 캐시를 채우지 못했다 —"
                + " agent-\(target.assetIndex) / \(target.pose) (15초 대기)\n",
            stderr
        )
        valid = false
    }

    return valid
}

/// 캐시가 비어 있는 첫 조합. 검사가 "이미 채워진 칸"으로 재서 헛통과하는 것을 막는다.
private func firstUncachedRequest() -> CozyCharacterRequest? {
    for index in 0..<cozyCharacterAssetCount {
        let pose = cozyIdlePose
        if !SpriteLoader.isCozyCharacterCached(assetIndex: index, pose: pose) {
            return CozyCharacterRequest(assetIndex: index, pose: pose)
        }
    }
    return nil
}

