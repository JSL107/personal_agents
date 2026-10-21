import Foundation

public enum CozyPosePosture: String, Sendable, Equatable {
    case standing
    case seated
}

/// 요청 포즈를 실제 에셋으로 옮긴 결과.
public struct ResolvedCozyPose: Sendable, Equatable {
    /// 실제로 파일이 있는 포즈 이름(`agent-{index}-{pose}.png`). `idle` 은 접미사 없는 원본.
    public let pose: String
    public let posture: CozyPosePosture

    public init(pose: String, posture: CozyPosePosture) {
        self.pose = pose
        self.posture = posture
    }
}

/// 접미사 없는 기본 그림(`agent-{index}.png`). 스무 명 전원이 가지고 있어 최후의 대체가 된다.
public let cozyIdlePose = "idle"

/// 책상·콘솔 좌석에서 쓰는 포즈.
///
/// **등을 보이고 모니터를 향해 앉은 그림이다.** 방은 3/4 부감이라 책상이 사람보다 위(안쪽)에
/// 있는데, 정면 착석 원화(`sit`)를 쓰면 사람이 모니터를 등지고 화면 밖을 보는 그림이 됐다
/// (사용자 보고: "이 방향이면 등을 돌리고 모니터를 보는 게 낫지 않을까").
///
/// 좌석 포즈 이름은 여기 한 곳에서 정하지만, **이 값만 `"sit"` 으로 바꾸는 것으로는 되돌아가지
/// 않는다.** 뒷모습 원화는 의자까지 그려진 전신이고 정면 원화(`sit`)는 허리 아래가 없는 그림이라,
/// 화면 배치가 서로 반대 전제 위에 서 있다. 되돌릴 때 함께 되돌려야 하는 둘:
///
///   (`depth(of: assignment.desk)`), 상반신 그림은 앞판이 하반신을 **가려 주어야** 한다
///   (예전 값 `depth(of: assignment.seat) - 0.24`).
/// - `officeWorkstationSeatVisualOffsetTiles` — 가림이 없어진 만큼 덜 올린다. 0.60 에서 시작해
///   지금은 **음수**(몸을 상판 아래로 내린다)까지 내려왔다. 구체적인 값과 세 번 잰 기록은 그
///   상수의 주석에 있다 — **여기에 값을 다시 적지 않는다**(한쪽만 갱신돼 어긋난 적이 있다).
///
/// 셋 중 하나만 바꾸면 사람이 상판 위로 떠오르거나 다리가 중간에서 잘린다.
public let cozyDeskSeatPose = "sit-back"

/// **앉은 그림으로 취급하는 포즈 이름 전부.** 새 착석 포즈는 여기에만 넣는다.
///
/// 이 집합이 있는 이유는 같은 목록이 코드 여러 곳에 흩어져 있었고, 새 포즈를 넣을 때 한 곳을
/// 빠뜨리면 **파일도 있고 계약도 맞는데 화면만 안 바뀌는** 사고가 반복됐기 때문이다. 지금까지
/// 세 곳에서 당했다 — `resolveCozyPose` 의 앉은-요청 판정(빠뜨리면 원하는 자세가 `.standing`
/// 으로 잡혀 후보가 전부 걸러지고 조용히 `idle` 로 떨어진다), `sit()` 호출부, 그리고 도형
/// 폴백의 노트북 배지 제외(`cozyPoseSkipsLaptopBadge`).
///
/// `typing` 이 들어 있는 것은 그 요청이 책상 앞 작업이라 앉은 그림으로 풀리기 때문이다.
/// 가구 앞 자세(`sitting`·`sit-table`)와 책상 좌석(`sit`·`sit-back`)은 쓰임이 다르지만
/// "앉아 있는가" 라는 이 질문에는 함께 답한다.
public let cozySeatedPoseNames: Set<String> = [
    "sit", "sit-back", "sit-table", "sitting", "typing",
]

/// 도형으로 그린 캐릭터에 **납작한 노트북 배지를 얹지 않을** 포즈인가.
///
/// 배지는 원화가 없어 벡터 도형으로 떨어진 경우에만 붙는다. 그때도 책상 작업 자세에는 붙이면
/// 안 된다 — 씬이 이미 2.5D 작업대를 그려 두었으므로 납작한 배지가 원근을 깨고, 좌석용으로
/// 내려앉은 몸에서는 얼굴까지 가린다. 손에 이미 소품이 있는 자세(`writing`·`reading`)도
/// 같은 이유로 뺀다.
///
/// **앉은 포즈 전부가 대상이다.** 예전에는 `["sit", "writing", "reading"]` 으로 이름을 직접
/// 적어 두어, 뒤에 생긴 `sit-back`·`sit-table` 이 보호를 못 받았다.
public func cozyPoseSkipsLaptopBadge(_ normalized: String) -> Bool {
    cozySeatedPoseNames.contains(normalized) || normalized == "writing"
        || normalized == "reading"
}

/// 요청 이름을 에셋 어휘로 접는다.
///
/// **방향 이름과 걸음 프레임이 전부 `idle` 로 접히는 것이 이 함수의 요점이다.** `down`·`up`·
/// `side`·`down-walk1` 같은 도트 시절 이름은 실물이 없는데, 그것을 그대로 파일명으로 조립하면
/// 로더가 매번 없는 파일을 찾아 헛돈다(정상 실행에서 폴백 로그가 수십 줄 쏟아지던 원인).
/// 방향은 이제 그림이 아니라 몸짓(`officeWalkLean`)이 표현한다.
public func normalizedCozyPose(_ requested: String) -> String {
    switch requested.lowercased().replacingOccurrences(of: "_", with: "-") {
    // **`sit` 과 `sitting` 은 다른 요청이다.** `sit` 은 책상·콘솔 좌석이고, `sitting` 은
    // 소파·회의 테이블 앞에 앉는 연출이다. 예전에는 한 이름으로 합쳐 뒀는데, `sit` 원화가
    // 허리 아래 없는 그림으로 다시 그려지면서 갈라야 했다 — 그 그림은 책상 상판이
    // 하반신을 가려 주는 자리에서만 성립하고, 가려 줄 것이 없는 소파 앞에 놓으면
    // 상반신만 바닥에 떠 있게 된다(사용자 보고).
    case "sit":
        return "sit"
    // 책상 좌석의 뒷모습 그림. `sit` 과 갈라 두는 이유는 위와 같다 — 이쪽은 의자까지 그려진
    // 전신이라 가려 줄 상판이 없어도 성립하지만, 등을 보이므로 책상을 **향해** 앉는 자리에서만
    // 뜻이 맞는다. 소파·회의 테이블에 놓으면 손님에게 등을 돌린 그림이 된다.
    case "sit-back", "sitback":
        return "sit-back"
    case "sitting":
        return "sitting"
    // 의자를 들고 오는 테이블 앞 착석. `OfficeInteractionPose.sittingAtTable` 의 rawValue 가
    // 그대로 들어오므로 붙여 쓴 형태도 함께 받는다.
    case "sit-table", "sittable", "sittingattable":
        return "sit-table"
    case "typing":
        return "typing"
    case "reading":
        return "reading"
    case "writing":
        return "writing"
    case "drinking":
        return "drinking"
    case "carryingpapers", "carrying-papers":
        return "carryingpapers"
    case "tending":
        return "tending"
    case "stowing":
        return "stowing"
    case "walk":
        return "walk"
    case "walk-up", "walkup":
        return "walk-up"
    case "walk-up-idle", "walkupidle":
        return "walk-up-idle"
    case "walk-side", "walkside":
        return "walk-side"
    case "walk-side-idle", "walksideidle":
        return "walk-side-idle"
    default:
        return cozyIdlePose
    }
}

/// 그림 **안에** 가구가 이미 그려져 있는가(원화 전수 확인).
///
/// 한때 셋이 걸려 있었다 — 6번 원형 테이블, 7번 사무용 의자, 8번 사이드 테이블. 사람만
/// 오려낸 그림이 아니라 가구까지 한 덩어리라, 씬의 책상·소파 앞에 세우면 가구가 이중으로
/// 보여 "물건을 쓰는" 게 아니라 "물건이 겹친" 그림이 됐다. **셋 다 가구 없는 그림으로
/// 다시 그려 받아 배제가 필요 없어졌다**(교체본을 직접 열어 확인). 규칙 자체는 남긴다 —
/// 다음에 같은 방식으로 그려진 원화가 들어오면 여기에 한 줄 추가하는 것으로 막을 수 있고,
/// 그 자리가 없으면 화면에서 겹친 뒤에야 알게 된다.
public func cozyPoseDrawsOwnFurniture(assetIndex: Int, pose: String) -> Bool {
    switch (assetIndex, pose) {
    // **테이블 앞 착석은 전원이 의자째 그려져 있다.** 회의·응접 테이블 원화에서 의자를
    // 지웠던 동안에는 사람 쪽이 의자를 들고 오는 것이 유일한 해법이었지만, 의자가 함께
    // 그려진 테이블 원화가 들어오면서 전제가 뒤집혔다 — 이제 같은 자리에 의자가 둘이다
    // (사용자 보고: "앉는 이벤트에서 사무실의자를 가져와서 앉는 행위를 함").
    //
    // 파일은 지우지 않고 여기서 막는다. 되돌릴 때 이 한 줄만 지우면 되고, 테이블 원화를
    // 다시 의자 없는 것으로 바꾸는 판단이 생기면 그때 되살릴 그림이 남아 있어야 한다.
    case (_, "sit-table"):
        return true
    default:
        return false
    }
}

/// 그 포즈 그림이 앉은 그림인지(원화 전수 확인).
///
/// 같은 포즈라도 사람마다 자세가 다르다 — `typing` 은 18번만 태블릿을 들고 서 있고 나머지는
/// 앉아 있다. `reading`·`writing` 은 반대로 앉은 쪽이 예외다(7·6번). 이 예외를 모르면
/// 18번만 자기 책상 앞에 선 채로 일하고, 7번만 복도에서 의자째 책을 읽는다.
public func cozyPosePosture(assetIndex: Int, pose: String) -> CozyPosePosture {
    switch pose {
    case "sit":
        return .seated
    case "sit-back":
        return .seated
    case "sit-table":
        return .seated
    // 18번만 태블릿을 들고 **서 있던** 예외가 있었다. 전원분 `typing` 원화가 다시 들어오면서
    // 18번도 앉은 그림이 됐으므로(교체본을 직접 열어 확인) 예외를 걷는다 — 남겨 두면 그
    // 사람만 자기 책상 앞에 선 채로 일한다.
    case "typing":
        return .seated
    case "sitting":
        return .seated
    // 6번 `writing`·7번 `reading` 은 예전에 앉은 그림이었다(각각 테이블·의자가 함께 그려져
    // 있었다). 가구 없는 **서 있는** 그림으로 교체돼 이제 예외가 아니다.
    default:
        return .standing
    }
}

/// 요청 포즈를 대신할 수 있는 에셋 포즈를 우선순위대로 준다(`idle` 은 제외 — 늘 마지막 보루).
///
/// 지금까지는 대체가 "없으면 정면 정지 그림" 하나뿐이라 의미가 다 뭉개졌다. 손에 든 물건이
/// 뜻을 가장 많이 나르므로, 서류를 든 자세(`carryingPapers`)는 쓰는 그림, 물건을 넣고 빼는
/// 자세(`stowing`)는 책을 든 그림으로 내려간다. 화분 손질(`tending`)은 닮은 그림이 없어
/// 그냥 서 있는 편이 낫다 — 엉뚱한 소품을 들리면 무엇을 하는지가 오히려 틀리게 읽힌다.
public func cozyPoseCandidates(_ normalized: String) -> [String] {
    switch normalized {
    case "sit":
        return ["sit"]
    // 뒷모습이 없는 인덱스는 정면 착석으로 내려간다. 자리가 틀리지는 않지만(둘 다 책상
    // 좌석용이다) 그 한 명만 화면 밖을 보게 되므로, 대체가 실제로 걸리면 그림이 빈 것이다.
    case "sit-back":
        return ["sit-back", "sit"]
    // 가구 앞에 앉는 연출은 **전용 원화를 쓴다.** 무릎을 굽히고 발이 바닥에 닿은 전신
    // 그림이라 소파·회의 테이블처럼 가려 줄 것이 없는 자리에서도 성립한다. 책상용
    // `sit`(허리 아래가 없는 그림)과는 쓰임이 정반대라 서로 대신하지 않는다 — 책상용을
    // 소파에 놓으면 상반신만 뜨고, 이쪽을 책상에 놓으면 다리가 상판 아래로 샌다.
    case "sitting":
        return ["sitting"]
    // 테이블용이 없으면 소파용으로 내려간다 — 자리는 맞고 의자만 사라져 공중에 앉은 것처럼
    // 보이지만, 서 있는 기본 그림으로 떨어지는 것보다는 뜻이 가깝다.
    case "sit-table":
        return ["sit-table", "sitting"]
    // **앉은 그림을 먼저 본다.** `sit` 원화는 허리 아래가 없고 팔을 앞으로 뻗은 그림으로
    // 다시 그려졌다 — 책상 뒤에 놓으면 다리가 샐 자리가 없어 "책상을 관통한" 인상이
    // 사라진다(사용자 보고로 재제작). 그 자세가 이미 타이핑이라 `typing` 원화를 따로
    // 쓸 이유가 없고, `typing` 은 의자에 앉아 다리를 뻗은 옛 그림이라 3/4 시점 책상과
    // 원근이 어긋난다. 아직 안 바뀐 인덱스를 위해 `typing` 은 대체로 남긴다.
    // 맨 뒤 `writing` 은 **선 자세를 요구하는 화면**을 위한 것이다. 대시보드 카드에는 책상도
    // 의자도 없어 앉은 그림을 쓸 수 없는데(`posture: .standing`), 전원분 `typing` 이 앉은
    // 그림으로 통일되면서 앞의 셋이 전부 걸러져 기본 그림으로 떨어졌다. 타이핑과 쓰기는
    // 손에 든 것이 다를 뿐 둘 다 "일하는 중" 이라 뜻이 가장 가깝다.
    case "typing":
        return ["sit-back", "sit", "typing", "writing"]
    case "reading":
        return ["reading"]
    case "writing":
        return ["writing", "reading"]
    case "drinking":
        return ["drinking"]
    // 전용 원화가 전원분 들어왔다(서류 뭉치를 안고 걷기·선반에 파일 꽂기·화분에 물 주기).
    // 닮은 그림으로 내려가던 대체는 뒤에 남겨 둔다 — 그림이 빠진 인덱스가 생기면 뜻이
    // 가장 가까운 쪽으로 떨어져야 한다.
    case "carryingpapers":
        return ["carryingpapers", "writing", "reading"]
    case "stowing":
        return ["stowing", "reading"]
    // 화분 손질은 닮은 그림이 없어 예전에는 그냥 서 있었다. 이제 전용 원화가 있다.
    case "tending":
        return ["tending"]
    // 걸음 그림은 **보는 방향이 다르면 대신할 수 없다.** 뒤통수 그림을 이쪽으로 걸어오는
    // 사람에게 쓰면 뒷걸음질이 되고, 그 반대도 마찬가지다. 없으면 정지 그림으로 내려가고
    // 그때는 몸 기울기(`officeWalkLean`)만 남는다.
    //
    // 정면·후면·측면 걸음 원화는 스무 명 전원이 가진다. 방향이 다른 원화는 서로 대체하지 않는다
    // — 반대쪽 그림이 들어가면 뒷걸음질로 보이기 때문이다.
    case "walk":
        return ["walk"]
    case "walk-up":
        return ["walk-up"]
    case "walk-up-idle":
        return ["walk-up-idle"]
    case "walk-side":
        return ["walk-side"]
    case "walk-side-idle":
        return ["walk-side-idle"]
    default:
        return []
    }
}

/// 요청 포즈 → 실제 에셋. **모든 캐릭터 그림 선택이 지나는 단 하나의 지점.**
///
/// `hasAsset` 은 "이 포즈 파일이 실제로 있는가" 를 묻는 창구다. 파일 목록을 코어가 따로
/// 베껴 두지 않으므로(베끼면 에셋을 갈아끼울 때 조용히 어긋난다) 존재 판정은 번들을 보는
/// 렌더러가 넘기고, 여기서는 **순서와 배제 규칙**만 갖는다.
public func resolveCozyPose(
    requested: String,
    assetIndex: Int,
    hasAsset: (String) -> Bool,
    posture requiredPosture: CozyPosePosture? = nil
) -> ResolvedCozyPose {
    let normalized = normalizedCozyPose(requested)
    // 앉아야 하는 요청인지는 보통 요청 이름이 정한다 — 책상에서 오는 요청은 `sit`·`typing`
    // 둘뿐이고 나머지(가구 앞 자세·걷기·기본)는 전부 서 있는 맥락이다.
    //
    // **앉을 자리가 없는 화면은 그것을 덮어쓸 수 있어야 한다.** 대시보드 카드에는 책상도
    // 의자도 없는데 `typing` 을 요청하면 앉은 그림이 뽑혀 사람이 공중에 주저앉는다
    // (사용자 보고). 그런 호출자는 `posture: .standing` 을 넘겨 선 그림만 받는다.
    // 앉은 요청인지는 `cozySeatedPoseNames` 한 곳이 정한다 — 예전에는 이 자리에 이름을 직접
    // 나열했고, 새 포즈를 넣을 때 그 목록을 빠뜨리는 사고가 반복됐다(아래 상수 주석 참조).
    let wanted: CozyPosePosture = requiredPosture
        ?? (cozySeatedPoseNames.contains(normalized) ? .seated : .standing)
    for candidate in cozyPoseCandidates(normalized) {
        guard !cozyPoseDrawsOwnFurniture(assetIndex: assetIndex, pose: candidate) else {
            continue
        }
        guard cozyPosePosture(assetIndex: assetIndex, pose: candidate) == wanted else {
            continue
        }
        guard hasAsset(candidate) else {
            continue
        }
        return ResolvedCozyPose(pose: candidate, posture: wanted)
    }
    return ResolvedCozyPose(pose: cozyIdlePose, posture: .standing)
}
