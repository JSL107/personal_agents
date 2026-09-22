import AppKit
import ConsoleCore

/// 워밍(`SpriteLoader.prewarmCozyCharacters`)이 **실제로 캐시를 채우는지** 확인한다.
///
/// 워밍은 눈에 보이지 않는 최적화라 조용히 죽어도 화면은 그대로다 — 준비가 렌더 스레드로
/// 되돌아가 느려질 뿐이고, 어느 게이트도 그것을 알려주지 않는다. 그래서 적재를 직접 본다.
///
/// 시간을 재서 "빨라졌으니 됐다"고 판정하지 않는다. 그 판정은 느린 기계와 첫 디코드의
/// 프레임워크 웜업에 흔들린다. 대신 `SpriteLoader.isCozyCharacterCached` 로 칸이 찼는지 본다.
@MainActor
func runCozyPrewarmCheck() -> Bool {
    var valid = true

    // 1) 요청 생성이 중복을 접는지. 같은 명단을 두 번 이어 붙여도 요청 수가 같아야 한다 —
    //    서로 다른 담당자가 같은 그림을 쓰는 경우가 실제로 있고, 접지 않으면 같은 파일을
    //    여러 번 읽는다.
    let singleRequests = cozyDashboardPrewarmRequests(for: dashboardPreviewAgents)
    let doubledRequests = cozyDashboardPrewarmRequests(
        for: dashboardPreviewAgents + dashboardPreviewAgents
    )
    if doubledRequests.count != singleRequests.count {
        fputs(
            "prewarm check: 중복 요청이 접히지 않았다 — 명단을 두 배로 넣으면"
                + " \(singleRequests.count)건이어야 하는데 \(doubledRequests.count)건\n",
            stderr
        )
        valid = false
    }

    // **과다 접힘도 잡아야 한다.** 위 단언은 "두 배로 넣어도 늘지 않는다" 만 보므로, 키가 퇴화해
    // 모든 담당자가 한 칸으로 뭉치면 single=1 · doubled=1 로 통과한다 — 워밍이 카드 대부분을
    // 놓치는데도 게이트가 초록불이 된다(리뷰가 잡았다). 그래서 기대 조합 수를 따로 세어 맞춘다.
    // 세는 방식은 대상과 다르게 둔다 — 대상은 순서대로 훑으며 접고, 여기서는 집합으로 모은다.
    let expectedKeys = Set(
        dashboardPreviewAgents.map { agent -> String in
            let appearance = cozyAgentAppearance(
                agentType: agent.agentType, department: agent.resolvedDepartment
            )
            let pose = cozyDashboardPortraitPose(
                agentType: agent.agentType, state: agent.state, assetIndex: appearance.assetIndex
            )
            return "\(appearance.assetIndex):\(pose)"
        }
    )
    if expectedKeys.isEmpty {
        fputs("prewarm check: 고정 명단에서 요청이 하나도 나오지 않았다\n", stderr)
        valid = false
    }
    if singleRequests.count != expectedKeys.count {
        fputs(
            "prewarm check: 요청 수가 고유 조합 수와 다르다 — 담당자"
                + " \(dashboardPreviewAgents.count)명의 고유 조합 \(expectedKeys.count)건에"
                + " 대해 요청 \(singleRequests.count)건\n",
            stderr
        )
        valid = false
    }

    // 포즈 계약 — 카드에는 책상도 의자도 없어서 앉은 그림이 뽑히면 사람이 허공에 주저앉는다
    // (실제 사용자 보고). `cozyDashboardPortraitPose` 가 `posture: .standing` 으로 막고 있지만
    // 이번에 뷰 밖으로 나오면서 직접 호출이 가능해졌으므로 계약을 여기서 고정한다. 문제가
    // 실제로 났던 두 타입을 표본으로 둔다 — `typing` 은 18번을 빼면 전부 앉은 그림이다.
    for agentType in ["CODE_REVIEWER", "HUMANIZER"] {
        for index in 0..<cozyCharacterAssetCount {
            let pose = cozyDashboardPortraitPose(
                agentType: agentType, state: .inProgress, assetIndex: index
            )
            // **그림의 실제 자세를 본다.** `ResolvedCozyPose.posture` 는 요청한 자세를 되돌려
            // 줄 뿐이고(`posture` 를 안 넘기면 이름 규칙으로 `typing` → `.seated`), 18번처럼
            // 같은 이름이 사람마다 다른 예외는 `cozyPosePosture` 만 안다. 처음에 전자로 재서
            // 18번을 위반으로 잘못 짚었다.
            let posture = cozyPosePosture(assetIndex: index, pose: pose)
            if posture != .standing {
                fputs(
                    "prewarm check: 카드 초상화가 앉은 그림을 골랐다 —"
                        + " \(agentType) / agent-\(index) → \(pose) (\(posture))\n",
                    stderr
                )
                valid = false
            }
        }
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

    if !SpriteLoader.isCozyCharacterCached(assetIndex: target.assetIndex, pose: target.pose) {
        fputs(
            "prewarm check: 워밍이 캐시를 채우지 못했다 —"
                + " agent-\(target.assetIndex) / \(target.pose) (15초 대기)\n",
            stderr
        )
        valid = false
    }

    // 3) 렌더가 먼저 채운 칸을 워밍이 덮어쓰지 않는지. 같은 그림이어도 덮어쓰면 화면에 이미
    //    올라간 것과 다른 객체가 되어 의미 없는 교체가 된다. 완료 블록의 분기 중 하나이고
    //    어느 검사도 밟지 않던 자리다.
    if let raceTarget = firstUncachedRequest() {
        SpriteLoader.prewarmCozyCharacters([raceTarget])
        // 워밍이 백그라운드에서 준비하는 사이 렌더 경로로 **먼저** 채운다.
        let renderedFirst = SpriteLoader.cozyCharacterImage(
            assetIndex: raceTarget.assetIndex, pose: raceTarget.pose
        )
        // 워밍이 끝나고도 남을 만큼 기다린다. 짧으면 미검출(통과) 쪽으로 기울 뿐 오탐이 되지는
        // 않으므로 넉넉히 준다 — 준비 자체는 장당 수십 ms 다.
        let raceDeadline = Date().addingTimeInterval(5)
        while Date() < raceDeadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        }
        let afterPrewarm = SpriteLoader.cozyCharacterImage(
            assetIndex: raceTarget.assetIndex, pose: raceTarget.pose
        )
        if renderedFirst !== afterPrewarm {
            fputs(
                "prewarm check: 워밍이 렌더가 먼저 채운 칸을 덮어썼다 —"
                    + " agent-\(raceTarget.assetIndex) / \(raceTarget.pose)\n",
                stderr
            )
            valid = false
        }
    }

    // **준비 실패 분기(`image == nil`)는 검사하지 못한다.** 그 경로로 가려면 번들에서 그림이
    // 사라져야 하는데, 검사가 에셋을 지웠다 되돌리는 것은 다른 게이트(`--asset-check`·렌더)와
    // 같은 번들을 건드리는 일이라 하지 않는다. 그 분기가 하는 일은 키 해제뿐이고, 해제가
    // 빠지면 같은 칸을 다시 워밍할 수 없게 되므로 위 2)·3)이 반복 실행에서 간접적으로 걸린다.

    if valid {
        print("✓ 워밍 계약 통과 — 중복 접힘 · 적재 · 렌더 선점 보존이 유효하다")
    }

    return valid
}

/// 캐시가 비어 있는 첫 조합. 검사가 "이미 채워진 칸"으로 재서 헛통과하는 것을 막는다.
@MainActor
private func firstUncachedRequest() -> CozyCharacterRequest? {
    for index in 0..<cozyCharacterAssetCount {
        let pose = cozyIdlePose
        if !SpriteLoader.isCozyCharacterCached(assetIndex: index, pose: pose) {
            return CozyCharacterRequest(assetIndex: index, pose: pose)
        }
    }
    return nil
}

