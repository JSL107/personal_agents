import Foundation

@testable import ConsoleCore

/// 포즈 계약 — 요청 이름이 실재하는 에셋으로만 내려가는지, 걸음 몸짓이 걸음을 나르는지.
func runCozyPoseContractTests(_ t: TestRunner) {
    t.suite("CozyPoseContract")

    // 방향·걸음 이름은 전부 기본 그림으로 접혀야 한다. 원화는 정면 한 벌뿐이라 `down`·`side`·
    // `-walk1` 을 파일명으로 조립하면 매번 없는 파일을 찾는다 — 정상 실행에서 폴백 로그가
    // 수십 줄씩 쏟아지던 원인이고, 화면에는 어차피 같은 그림이 나왔다.
    for name in ["down", "up", "side", "left", "right", "down-walk1", "side-walk2", "default"] {
        t.expectEqual(normalizedCozyPose(name), cozyIdlePose, "\(name) → 기본 그림")
    }
    // `sit`(책상 좌석)과 `sitting`(소파·회의 테이블 앞)은 **다른 요청**이다. 착석 원화가
    // 허리 아래 없는 그림이라, 상판이 가려 주는 책상에서만 쓸 수 있다.
    t.expectEqual(normalizedCozyPose("sitting"), "sitting", "sitting 은 sit 으로 합치지 않는다")
    // 가구 앞 앉기는 **전용 원화**를 쓴다. 책상용 `sit`(허리 아래 없음)과 쓰임이 정반대라
    // 서로 대신하지 않는다 — 여기서 `sit` 이 새면 소파 위에 상반신만 뜬다.
    t.expectEqual(
        resolveCozyPose(requested: "sitting", assetIndex: 1, hasAsset: cozyPoseAssetExists(1)),
        ResolvedCozyPose(pose: "sitting", posture: .seated),
        "가구 앞 앉기는 전용 그림을 쓴다")
    t.expectEqual(
        resolveCozyPose(
            requested: "sitting", assetIndex: 1, hasAsset: { $0 == "sit" }
        ).pose,
        cozyIdlePose, "가구 앞 원화가 없으면 책상용으로 대신하지 않는다")
    t.expectEqual(
        resolveCozyPose(
            requested: "sit", assetIndex: 1, hasAsset: { $0 == "sitting" }
        ).pose,
        cozyIdlePose, "책상 좌석도 가구 앞 그림으로 대신하지 않는다")
    t.expectEqual(
        resolveCozyPose(requested: "sit", assetIndex: 1, hasAsset: cozyPoseAssetExists(1)),
        ResolvedCozyPose(pose: "sit", posture: .seated),
        "책상 좌석은 착석 원화를 그대로 쓴다")
    t.expectEqual(normalizedCozyPose("carryingPapers"), "carryingpapers", "대문자 요청도 같은 이름")

    // MARK: - 책상 좌석 뒷모습(`sit-back`)

    t.expectEqual(normalizedCozyPose("sit-back"), "sit-back", "뒷모습은 sit 으로 합치지 않는다")
    t.expectEqual(normalizedCozyPose("sitback"), "sit-back", "붙여 쓴 요청도 같은 이름")

    // **좌석 포즈가 계약에 등록돼 있는지.** `cozyDeskSeatPose` 를 새 이름으로 바꾸고
    // `normalizedCozyPose` 에 넣는 것을 잊으면 요청이 조용히 `idle` 로 접혀, 화면의 전원이 선 채로
    // 책상에 붙어 선다. 상수만 고치고 계약을 안 고치는 실수를 여기서 끊는다.
    t.expectEqual(
        normalizedCozyPose(cozyDeskSeatPose), cozyDeskSeatPose,
        "씬이 쓰는 좌석 포즈 이름은 계약이 알고 있어야 한다")

    // **좌석 요청이 앉은 자세로 풀리는지.** `resolveCozyPose` 안에는 "어떤 이름이 앉은 요청인가"
    // 를 정하는 목록이 따로 있어(`wanted`), 후보·자세 표를 다 채워도 그 목록에서 빠지면 원하는
    // 자세가 `.standing` 으로 잡혀 앉은 후보가 전부 걸러진다. `sit-back` 을 넣을 때 실제로 그렇게
    // 되어 에셋·계약이 다 맞는데도 화면만 안 바뀌었다 — 그 조합을 이 단언이 잡는다.
    t.expectEqual(
        resolveCozyPose(
            requested: cozyDeskSeatPose, assetIndex: 3, hasAsset: cozyPoseAssetExists(3)
        ),
        ResolvedCozyPose(pose: cozyDeskSeatPose, posture: .seated),
        "책상 좌석 뒷모습 요청은 앉은 자세의 뒷모습 그림으로 풀린다")

    // 뒷모습이 없는 인덱스는 정면 착석으로 내려간다 — 자리는 맞고 방향만 틀리다.
    t.expectEqual(
        resolveCozyPose(
            requested: "sit-back", assetIndex: 1, hasAsset: { $0 == "sit" }
        ),
        ResolvedCozyPose(pose: "sit", posture: .seated),
        "뒷모습이 없으면 정면 착석으로 대신한다")
    // 가구 앞 그림으로는 내려가지 않는다. 소파용 전신을 책상에 놓으면 다리가 상판 아래로 샌다.
    t.expectEqual(
        resolveCozyPose(
            requested: "sit-back", assetIndex: 1, hasAsset: { $0 == "sitting" }
        ).pose,
        cozyIdlePose, "책상 뒷모습은 가구 앞 그림으로 대신하지 않는다")
    // 반대 방향도 막는다 — 소파 앞에 등을 돌린 그림을 놓으면 손님에게 등을 보이고 앉는다.
    t.expectEqual(
        resolveCozyPose(
            requested: "sitting", assetIndex: 1, hasAsset: { $0 == "sit-back" }
        ).pose,
        cozyIdlePose, "가구 앞 앉기는 책상 뒷모습으로 대신하지 않는다")

    // MARK: - 테이블 앞 착석(`sit-table`)

    t.expectEqual(normalizedCozyPose("sit-table"), "sit-table", "테이블 착석은 별도 이름")
    t.expectEqual(
        resolveCozyPose(
            requested: "sit-table", assetIndex: 3, hasAsset: cozyPoseAssetExists(3)
        ),
        ResolvedCozyPose(pose: "sitting", posture: .seated),
        // 전용 그림(`sit-table`)은 **의자까지 그려져 있어** 배제된다
        // (`cozyPoseDrawsOwnFurniture`). 테이블 원화가 의자를 되찾은 뒤로는 같은 자리에
        // 의자가 둘이 되기 때문이다. 자리는 그대로이고 그림만 의자 없는 쪽으로 간다.
        "테이블 착석 요청은 의자가 그려지지 않은 그림으로 풀린다")
    // 전용 그림이 없으면 소파용으로 내려간다 — 의자가 사라져 공중에 앉은 것처럼 보이지만,
    // 서 있는 기본 그림으로 떨어지는 것보다는 뜻이 가깝다.
    t.expectEqual(
        resolveCozyPose(
            requested: "sit-table", assetIndex: 1, hasAsset: { $0 == "sitting" }
        ),
        ResolvedCozyPose(pose: "sitting", posture: .seated),
        "테이블 그림이 없으면 소파용으로 대신한다")

    // 앉은 요청은 **앉은 그림**으로만 내려간다. 서 있는 그림으로 내려가면 그 사람만 책상 위에
    // 올라선 것처럼 보인다. 10번은 `typing` 이 없는 캐릭터다.
    t.expectEqual(
        resolveCozyPose(requested: "typing", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)),
        ResolvedCozyPose(pose: cozyDeskSeatPose, posture: .seated),
        "타이핑 그림이 없으면 기본 그림이 아니라 앉은 그림")
    // 타이핑 요청은 **책상 좌석 그림을 먼저 본다.** 그 그림이 뒷모습 전신으로 바뀐 뒤에도
    // 같다 — 책상에서 하는 일은 결국 모니터를 보는 것이라, 자세가 이미 타이핑이다. 옛
    // `typing` 원화는 의자에 앉아 다리를 뻗은 그림이라 3/4 시점 책상과 원근이 어긋난다.
    t.expectEqual(
        resolveCozyPose(requested: "typing", assetIndex: 0, hasAsset: cozyPoseAssetExists(0)),
        ResolvedCozyPose(pose: cozyDeskSeatPose, posture: .seated),
        "타이핑 요청은 책상 좌석 그림으로 해결한다")
    // 18번 `typing` 은 태블릿을 들고 **서 있는** 그림이다. 책상 좌석에 쓰면 혼자 선 채로 일한다.
    t.expectEqual(
        resolveCozyPose(requested: "typing", assetIndex: 18, hasAsset: cozyPoseAssetExists(18)),
        ResolvedCozyPose(pose: cozyDeskSeatPose, posture: .seated),
        "서 있는 타이핑 그림은 좌석에서 쓰지 않는다")

    // 한때 가구가 함께 그려져 배제됐던 셋. 가구 없는 그림으로 교체된 뒤에는 **제 포즈가
    // 그대로 뽑혀야** 한다 — 배제 규칙이 남아 있으면 새로 그린 그림이 조용히 안 쓰인다.
    t.expectEqual(
        resolveCozyPose(requested: "writing", assetIndex: 6, hasAsset: cozyPoseAssetExists(6)),
        ResolvedCozyPose(pose: "writing", posture: .standing),
        "가구를 걷어낸 6번 writing 은 그대로 쓰인다")
    t.expectEqual(
        resolveCozyPose(requested: "reading", assetIndex: 7, hasAsset: cozyPoseAssetExists(7)),
        ResolvedCozyPose(pose: "reading", posture: .standing),
        "가구를 걷어낸 7번 reading 은 그대로 쓰인다")
    t.expectEqual(
        resolveCozyPose(requested: "drinking", assetIndex: 8, hasAsset: cozyPoseAssetExists(8)),
        ResolvedCozyPose(pose: "drinking", posture: .standing),
        "가구를 걷어낸 8번 drinking 은 그대로 쓰인다")

    // 호출자가 자세를 요구하면 그 자세의 그림만 뽑힌다. 대시보드 카드처럼 앉을 자리가
    // 없는 화면이 쓰는 경로다 — 여기서 앉은 그림이 새면 사람이 허공에 주저앉는다.
    //
    // `typing` 원화는 **전원이 앉은 그림**이다. 한때 18번만 태블릿을 들고 서 있어 그 하나만
    // 선 자세 요구에 그대로 뽑혔는데, 전원분 교체본이 들어오면서 그 예외가 사라졌다.
    //
    // 그래서 두 인덱스가 같은 답을 낸다 — 앉은 `typing` 이 걸러지고 뜻이 가장 가까운
    // `writing`(손에 든 것만 다른 "일하는 중")으로 내려간다. **답이 `writing` 이라는 사실
    // 자체가 앉은 그림이 걸러졌다는 증거**다. 기본 그림(`idle`)까지 떨어지면 카드에서
    // 무엇을 하는 중인지가 통째로 사라지므로, 그 아래로 내려가지 않는 것도 함께 고정한다.
    for assetIndex in [1, 18] {
        t.expectEqual(
            resolveCozyPose(
                requested: "typing", assetIndex: assetIndex,
                hasAsset: cozyPoseAssetExists(assetIndex), posture: .standing
            ),
            ResolvedCozyPose(pose: "writing", posture: .standing),
            "선 자세를 요구하면 앉은 타이핑 대신 쓰는 그림(\(assetIndex)번)")
    }
    // 대체까지 없으면 기본 그림으로 떨어진다 — 허공에 주저앉는 것보다는 서 있는 편이 낫다.
    t.expectEqual(
        resolveCozyPose(
            requested: "typing", assetIndex: 1,
            hasAsset: { $0 != "writing" && cozyPoseAssetExists(1)($0) }, posture: .standing
        ),
        ResolvedCozyPose(pose: cozyIdlePose, posture: .standing),
        "선 자세 후보가 하나도 없으면 기본 그림")
    // 인자를 생략하면 예전대로 요청 이름이 자세를 정한다.
    t.expectEqual(
        resolveCozyPose(requested: "typing", assetIndex: 1, hasAsset: cozyPoseAssetExists(1)),
        ResolvedCozyPose(pose: cozyDeskSeatPose, posture: .seated),
        "자세를 요구하지 않으면 typing 은 여전히 앉은 자세로 해결된다")

    // 걸음 그림은 **보는 방향으로 갈린다.** 스무 명 전원이 정면·후면을 둘 다 가지지만,
    // 반대 방향 그림으로 대신하면 뒷걸음질이 되므로 포즈 대체는 여전히 막는다.
    t.expectEqual(
        resolveCozyPose(requested: "walk", assetIndex: 1, hasAsset: cozyPoseAssetExists(1)),
        ResolvedCozyPose(pose: "walk", posture: .standing),
        "앞모습 걸음 그림이 있으면 그대로")
    t.expectEqual(
        resolveCozyPose(requested: "walk-up", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)),
        ResolvedCozyPose(pose: "walk-up", posture: .standing),
        "뒷모습 걸음 그림이 있으면 그대로")
    t.expectEqual(
        resolveCozyPose(
            requested: "walk-up-idle", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)
        ),
        ResolvedCozyPose(pose: "walk-up-idle", posture: .standing),
        "뒷모습 정지 그림이 있으면 그대로")
    t.expectEqual(
        resolveCozyPose(
            requested: "walk-side", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)
        ),
        ResolvedCozyPose(pose: "walk-side", posture: .standing),
        "측면 걸음 그림이 있으면 그대로")
    t.expectEqual(
        resolveCozyPose(
            requested: "walk-side-idle", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)
        ),
        ResolvedCozyPose(pose: "walk-side-idle", posture: .standing),
        "측면 정지 그림이 있으면 그대로")
    t.expectEqual(
        resolveCozyPose(requested: "walk", assetIndex: 10, hasAsset: cozyPoseAssetExists(10)),
        ResolvedCozyPose(pose: "walk", posture: .standing),
        "10번도 정면 걸음 그림을 그대로 쓴다")
    t.expectEqual(
        resolveCozyPose(requested: "walk-up", assetIndex: 1, hasAsset: cozyPoseAssetExists(1)),
        ResolvedCozyPose(pose: "walk-up", posture: .standing),
        "앞뒤를 다 가지면 요청한 방향이 뽑힌다")
    // 뒷모습만 없는 상황을 합성해 **앞모습이 새지 않는지**를 본다. 실제 원화는 전원
    // 뒷모습을 가지고 있어 파일만으로는 이 갈래를 재현할 수 없다.
    t.expectEqual(
        resolveCozyPose(
            requested: "walk-up", assetIndex: 1, hasAsset: { $0 == "walk" }
        ).pose,
        cozyIdlePose, "뒷모습이 없으면 앞모습을 대신 쓰지 않는다")
    t.expectEqual(
        resolveCozyPose(
            requested: "walk", assetIndex: 10, hasAsset: { $0 == "walk-up" }
        ).pose,
        cozyIdlePose, "정면이 없는 가상 상황에서 후면을 대신 쓰지 않는다")
    t.expectEqual(
        resolveCozyPose(
            requested: "walk-side", assetIndex: 10, hasAsset: { $0 == "walk" }
        ).pose,
        cozyIdlePose, "측면이 없는 가상 상황에서 정면을 대신 쓰지 않는다")
    t.expectEqual(
        resolveCozyPose(requested: "walk", assetIndex: 10, hasAsset: { _ in false }).pose,
        cozyIdlePose, "걸음 그림 파일이 없으면 정지 그림")

    // 서류 나르기·정리·화분 손질은 **전용 원화가 전원분 들어왔다.** 자기 그림이 먼저다.
    t.expectEqual(
        resolveCozyPose(requested: "carryingPapers", assetIndex: 0, hasAsset: cozyPoseAssetExists(0)).pose,
        "carryingpapers", "서류 나르기 → 전용 그림")
    t.expectEqual(
        resolveCozyPose(requested: "stowing", assetIndex: 19, hasAsset: cozyPoseAssetExists(19)).pose,
        "stowing", "물건 넣기 → 전용 그림")
    t.expectEqual(
        resolveCozyPose(requested: "tending", assetIndex: 0, hasAsset: cozyPoseAssetExists(0)).pose,
        "tending", "화분 손질 → 전용 그림")

    // **대체 규칙은 그대로 살아 있어야 한다.** 새 인덱스가 늘어 전용 그림이 빠지는 일은
    // 실제로 반복됐고(사람이 늘 때마다 원화는 뒤따라 들어온다), 그때 손에 든 물건이 뜻을
    // 가장 많이 나른다. 전용만 없다고 가정해 순서가 살아 있는지 본다.
    func withoutOwnArt(_ index: Int, _ pose: String) -> (String) -> Bool {
        { candidate in candidate != pose && cozyPoseAssetExists(index)(candidate) }
    }
    t.expectEqual(
        resolveCozyPose(
            requested: "carryingPapers", assetIndex: 0,
            hasAsset: withoutOwnArt(0, "carryingpapers")
        ).pose,
        "writing", "전용이 없으면 쓰는 그림")
    t.expectEqual(
        resolveCozyPose(
            requested: "stowing", assetIndex: 19, hasAsset: withoutOwnArt(19, "stowing")
        ).pose,
        "reading", "전용이 없으면 책을 든 그림")
    // 화분 손질은 닮은 그림이 없다. 엉뚱한 소품을 들리면 무엇을 하는지가 오히려 틀리게 읽힌다.
    t.expectEqual(
        resolveCozyPose(
            requested: "tending", assetIndex: 0, hasAsset: withoutOwnArt(0, "tending")
        ).pose,
        cozyIdlePose, "화분 손질은 대체 없이 기본 그림")

    // **해결 결과는 반드시 실재해야 한다.** 계약이 없는 파일을 가리키면 그 사람만 화면에서
    // 사라지거나 로더가 조용히 다른 그림을 끼운다. 에셋 목록을 손으로 베끼지 않고 실제 파일을
    // 세므로, 에셋을 갈아끼우면 여기서 걸린다.
    let requests = [
            "idle", "default", "down", "side", "down-walk1", "sit", "typing",
            "walk-side", "walk-side-idle",
        ]
    var unresolved: [String] = []
    var furnitureLeaks: [String] = []
    for assetIndex in 0..<cozyCharacterAssetCount {
        for request in requests {
            let resolved = resolveCozyPose(
                requested: request, assetIndex: assetIndex, hasAsset: cozyPoseAssetExists(assetIndex)
            )
            if resolved.pose != cozyIdlePose, !cozyPoseAssetExists(assetIndex)(resolved.pose) {
                unresolved.append("agent-\(assetIndex)-\(resolved.pose) (요청 \(request))")
            }
            if cozyPoseDrawsOwnFurniture(assetIndex: assetIndex, pose: resolved.pose) {
                furnitureLeaks.append("agent-\(assetIndex)-\(resolved.pose) (요청 \(request))")
            }
            if resolved.posture != cozyPosePosture(assetIndex: assetIndex, pose: resolved.pose) {
                unresolved.append("자세 불일치 agent-\(assetIndex)-\(resolved.pose)")
            }
        }
    }
    t.expectEqual(unresolved.count, 0, "없는 에셋으로 내려간 조합: \(unresolved)")
    t.expectEqual(furnitureLeaks.count, 0, "가구가 그려진 에셋이 새어 나온 조합: \(furnitureLeaks)")

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
