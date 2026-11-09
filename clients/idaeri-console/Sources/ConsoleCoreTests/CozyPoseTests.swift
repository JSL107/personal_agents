import Foundation

@testable import ConsoleCore

/// 포즈 계약 — 요청 이름이 실재하는 에셋으로만 내려가는지.
func runCozyPoseContractTests(_ t: TestRunner) {
    t.suite("CozyPoseContract")

    // 모르는 이름은 전부 기본 그림으로 접혀야 한다. 없는 이름을 파일명으로 조립하면 매번 없는
    // 파일을 찾는다 — 정상 실행에서 폴백 로그가 수십 줄씩 쏟아지던 원인이다. 오피스와 함께
    // 걷어낸 착석·걷기 이름도 여기에 든다.
    for name in [
        "down", "up", "side", "down-walk1", "default",
        "sit", "sit-back", "sitting", "walk", "walk-up", "carryingPapers", "tending",
    ] {
        t.expectEqual(normalizedCozyPose(name), cozyIdlePose, "\(name) → 기본 그림")
    }
    t.expectEqual(normalizedCozyPose("Writing"), "writing", "대문자 요청도 같은 이름")

    // 카드가 요청하는 넷은 전용 그림으로 풀린다.
    for pose in ["writing", "reading", "drinking"] {
        t.expectEqual(
            resolveCozyPose(requested: pose, hasAsset: cozyPoseAssetExists(1)), pose,
            "\(pose) 는 전용 그림을 쓴다")
    }
    // `typing` 은 원화가 없다 — 손에 든 것만 다른 "일하는 중" 인 쓰는 그림으로 내려간다.
    // 기본 그림까지 떨어지면 카드에서 무엇을 하는 중인지가 통째로 사라진다.
    t.expectEqual(
        resolveCozyPose(requested: "typing", hasAsset: cozyPoseAssetExists(1)), "writing",
        "타이핑 요청은 쓰는 그림")
    t.expectEqual(
        resolveCozyPose(requested: "writing", hasAsset: { $0 == "reading" }), "reading",
        "쓰는 그림이 없으면 책을 든 그림")
    t.expectEqual(
        resolveCozyPose(requested: "typing", hasAsset: { _ in false }), cozyIdlePose,
        "대체까지 없으면 기본 그림")

    // **해결 결과는 반드시 실재해야 한다.** 계약이 없는 파일을 가리키면 그 사람만 화면에서
    // 사라지거나 로더가 조용히 다른 그림을 끼운다. 에셋 목록을 손으로 베끼지 않고 실제 파일을
    // 세므로, 에셋을 갈아끼우면 여기서 걸린다.
    let requests = ["idle", "default", "typing", "writing", "reading", "drinking"]
    var unresolved: [String] = []
    for assetIndex in 0..<cozyCharacterAssetCount {
        for request in requests {
            let resolved = resolveCozyPose(
                requested: request, hasAsset: cozyPoseAssetExists(assetIndex)
            )
            if resolved != cozyIdlePose, !cozyPoseAssetExists(assetIndex)(resolved) {
                unresolved.append("agent-\(assetIndex)-\(resolved) (요청 \(request))")
            }
        }
    }
    t.expectEqual(unresolved.count, 0, "없는 에셋으로 내려간 조합: \(unresolved)")

    // 기본 그림은 스무 명 전원이 가져야 한다 — 최후의 보루가 비면 대체가 성립하지 않는다.
    let missingIdle = (0..<cozyCharacterAssetCount).filter { !cozyCharacterAssetFileExists("agent-\($0)") }
    t.expectEqual(missingIdle.count, 0, "기본 그림이 없는 캐릭터: \(missingIdle)")

}


func cozyPoseAssetExists(_ assetIndex: Int) -> (String) -> Bool {
    { pose in cozyCharacterAssetFileExists("agent-\(assetIndex)-\(pose)") }
}

func cozyCharacterAssetFileExists(_ name: String) -> Bool {
    let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("Sources/IdaeriConsole/Resources/cozy/characters")
    return FileManager.default.fileExists(
        atPath: directory.appendingPathComponent("\(name).png").path
    )
}
