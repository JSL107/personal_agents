import Foundation

/// 씬이 실행할 연출 의도. 어떤 이벤트가 어떤 연출인지는 이 값으로 확정되고,
/// SpriteKit(SKAction) 실행은 OfficeScene 이 맡는다(코어는 SpriteKit 비의존).
public enum VisualIntent: Equatable, Sendable {
    case recolor(agentType: String, state: ConsoleAgentState)
    case working(agentType: String)
    case handoff(from: String, to: String)
    /// 일이 여럿에 걸쳐 이어지면 회의실에 모인다.
    ///
    /// `thenWorking` 은 회의가 끝난 뒤 자기 자리로 가서 일을 시작할 사람이다. 회의와
    /// `working` 을 따로 보내면 뒤따르는 `working` 이 회의를 시작하자마자 취소한다 —
    /// 둘 다 같은 사람을 걷게 하는 지시라서 나중 것이 이긴다.
    case meeting(agentTypes: [String], thenWorking: String)
    case summonToBand(agentType: String)
    case returnHome(agentType: String)
    case reject(agentType: String)
    case bubble(agentType: String, text: String)
    /// 출근 — 복도 진입점에서 자기 좌석까지 걸어온다.
    case arrive(agentType: String)
    /// 퇴근 — 좌석에서 복도 진입점까지 걸어간 뒤 화면에서 빠진다.
    case leave(agentType: String)
}

/// 실제 이벤트가 자율 배회를 즉시 끊을 대상을 연출 종류와 같은 순수 경계에서 확정한다.
public func affectedAgentTypes(of intent: VisualIntent) -> [String] {
    switch intent {
    case let .handoff(from, to):
        return [from, to]
    case let .meeting(agentTypes, thenWorking):
        return agentTypes.contains(thenWorking) ? agentTypes : agentTypes + [thenWorking]
    case let .recolor(agentType, _),
         let .working(agentType),
         let .summonToBand(agentType),
         let .returnHome(agentType),
         let .reject(agentType),
         let .bubble(agentType, _),
         let .arrive(agentType),
         let .leave(agentType):
        return [agentType]
    }
}

// MARK: - 포즈 계약 (요청 포즈 → 실제 에셋)
//
// 캐릭터 원화는 **정면 한 벌**뿐이다 — 측면·후면·걸음 프레임이 한 장도 없고, 사람마다
// 가진 포즈도 다르다(전원 `sit`, 절반쯤 `typing`, 넷 이하의 `reading`·`writing`·`drinking`).
// 도트 시절에는 `down`/`up`/`side` + `-walk1`·`-walk2` 로 파일을 찾았는데, 그 이름은 이제
// 어느 것도 실재하지 않아 요청이 전부 "없으면 정면 정지 그림" 한 갈래로 뭉개졌다.
//
// 여기서 요청 이름을 실재하는 에셋으로 옮기는 **단일 변환 지점**을 둔다. 렌더러가 아니라
// 코어에 두는 이유는 대체 선택이 캐릭터마다 다르기 때문이다 — 어느 그림이 어느 그림을
// 대신할 수 있는지는 그림을 그리는 규칙이 아니라 계약이고, 계약은 테스트가 닿아야 한다.

/// 캐릭터 원화가 앉은 그림인지 선 그림인지.
///
/// 앉은 그림을 서 있는 자리에 놓으면 공중에 주저앉은 사람이 되고, 선 그림을 책상 좌석에
/// 놓으면 책상 위에 올라선 사람이 된다. 좌석 하강값(`officeDedicatedSeatedSpriteDrop`)도
/// 이 구분을 보고 갈린다.
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
/// - `OfficeScene.placeAtWorkstation` 의 `depth` — 전신은 책상 앞판보다 **앞**에 그려야 하고
///   (`depth(of: assignment.desk)`), 상반신 그림은 앞판이 하반신을 **가려 주어야** 한다
///   (예전 값 `depth(of: assignment.seat) - 0.24`).
/// - `officeWorkstationSeatVisualOffsetTiles` — 가림이 없어진 만큼 덜 올린다. 0.60 에서 시작해
///   지금은 **음수**(몸을 상판 아래로 내린다)까지 내려왔다. 구체적인 값과 세 번 잰 기록은 그
///   상수의 주석에 있다 — **여기에 값을 다시 적지 않는다**(한쪽만 갱신돼 어긋난 적이 있다).
///
/// 셋 중 하나만 바꾸면 사람이 상판 위로 떠오르거나 다리가 중간에서 잘린다.
public let cozyDeskSeatPose = "sit-back"

/// 부서 특화 콘솔에서 쓰는 좌석 포즈 — **정면·상반신**(`sit`).
///
/// 뒷모습 원화를 쓰지 않는 이유는 **콘솔 그림이 자기 의자를 이미 그려 놓았기 때문**이다.
/// 의자까지 그려진 전신을 그 위에 앉히면 의자가 두 개로 보이고, 콘솔 앞판보다 앞에 두면
/// 사람이 작업면 위에 걸터앉은 그림이 된다(사용자 보고: "공공 에셋과 겹쳐서 이상하게
/// 보임" — 실제 앱 화면으로 확인). 반대로 뒤에 두면 전신의 다리가 중간에서 잘린다.
///
/// 정면 원화는 허리 아래가 없어 두 문제가 함께 사라진다 — 콘솔 앞판이 가려 줄 하반신이
/// 애초에 없고, 콘솔이 그려 둔 의자가 그 사람의 의자로 읽힌다. 일반 책상(`cozyDeskSeatPose`)
/// 과 갈라 두는 것이 이 상수의 존재 이유다.
public let officeFeatureConsoleSeatPose = "sit"

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
    case "typing":
        return assetIndex == 18 ? .standing : .seated
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
    case "typing":
        return ["sit-back", "sit", "typing"]
    case "reading":
        return ["reading"]
    case "writing":
        return ["writing", "reading"]
    case "drinking":
        return ["drinking"]
    case "carryingpapers":
        return ["writing", "reading"]
    case "stowing":
        return ["reading"]
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

// MARK: - 걸음 몸짓

/// 한 칸(한 걸음)에 걸리는 시간(초). 씬의 이동 시간(`OfficeScene.walk` 의 `stepDuration`)과
/// 같아야 몸 기울기가 발과 어긋나지 않는다.
public let officeWalkStepSeconds: Double = 0.20

/// 진행 방향으로 몸이 기우는 각도(라디안 ≈ 3.4도).
public let officeWalkLeanRadians: Double = 0.06

/// 걸음마다 좌우로 번갈아 흔들리는 각도(라디안 ≈ 2도).
public let officeWalkSwayRadians: Double = 0.035

/// `step` 번째 걸음에서 몸을 얼마나 기울일지(라디안, 양수 = 반시계 = 화면 왼쪽으로 기움).
///
/// **걸음 그림이 없으므로 몸짓이 그 자리를 대신한다.** 예전에는 `-walk1`·`-walk2` 를 번갈아
/// 걸었는데 그 파일이 실재하지 않아 매 걸음 같은 정면 그림으로 되돌아왔다 — 다리는 가만히
/// 있고 몸만 위아래로 떨려 "걷는다" 가 아니라 "제자리에서 통통 튄다" 로 읽힌 원인이다.
///
/// 발(스프라이트 anchor)을 축으로 기울이면 디딘 발 위로 무게중심이 넘어가는 것이 보인다.
/// 진행 방향 기울기는 어디로 가는지를, 좌우 번갈이는 몇 걸음째인지를 나른다. 위·아래로 가는
/// 걸음에는 화면상 진행 방향이 없어 번갈이만 남긴다.
public func officeWalkLean(facing: Facing, step: Int) -> Double {
    let sway = step.isMultiple(of: 2) ? officeWalkSwayRadians : -officeWalkSwayRadians
    switch facing {
    case .left:
        return officeWalkLeanRadians + sway
    case .right:
        return -officeWalkLeanRadians + sway
    case .up, .down:
        return sway
    }
}

/// 이벤트 번역에 필요한 주변 상태(부모 run·pending 조회용). 스냅샷 파생, 부작용 없음.
public struct ChoreographyContext: Sendable {
    public let agents: [ConsoleAgent]
    public let runs: [ConsoleRun]
    public let pendingCommands: [PendingCommand]

    public init(agents: [ConsoleAgent], runs: [ConsoleRun], pendingCommands: [PendingCommand]) {
        self.agents = agents
        self.runs = runs
        self.pendingCommands = pendingCommands
    }
}

/// SSE 이벤트 하나를 연출 의도 배열로 번역한다(순수).
/// 미지의 agentType 이거나 오피스와 무관한 이벤트(session·command.info·approvalResolved 의 미상 등)는 빈 배열.
public func visualIntents(for event: ConsoleEvent, context: ChoreographyContext) -> [VisualIntent] {
    func knows(_ agentType: String) -> Bool {
        context.agents.contains { $0.agentType == agentType }
    }
    func agent(_ agentType: String) -> ConsoleAgent? {
        context.agents.first { $0.agentType == agentType }
    }
    /// 이 사람이 지금 결재를 기다리는가 — **스토어가 적용한 결과**를 본다.
    ///
    /// 열린 승인이 있으면 스토어가 상태를 `AWAITING_APPROVAL` 로 맞추고 그 뒤 오는 상태
    /// 변경을 얹지 않는다(`ConsoleStore.markAwaitingApproval` · `hasOpenApproval`).
    /// 여기서 이벤트가 실은 상태를 따로 판단하면 **두 계층이 다른 답을 낸다** — 실제로
    /// 그랬다: 스토어는 억제했는데 연출은 사람을 책상으로 걷게 했다.
    ///
    /// 스토어는 `apply(event:)` 안에서 상태를 먼저 바꾸고 **마지막에** 이벤트를 흘려보내므로
    /// (`eventStream.send`), 이 시점의 `context.agents` 는 이미 적용 결과다.
    func isAwaitingApproval(_ agentType: String) -> Bool {
        agent(agentType)?.state == .awaitingApproval
    }

    switch event {
    case let .runStarted(run):
        guard knows(run.agentType) else {
            return []
        }
        // 결재를 기다리며 줄에 선 사람은 새 런이 시작돼도 자리로 보내지 않는다.
        // **`run.started` 가 `state.changed` 보다 먼저 발행되므로**(`AgentRunService.execute`)
        // 아래 `stateChanged` 분기만 막으면 이 이벤트가 이미 사람을 걷게 한다.
        guard !isAwaitingApproval(run.agentType) else {
            return []
        }
        // 체인에 여럿이 얽혔으면 회의실로 모은다. 화면에서 자리를 뜨는 사람이 여럿이라
        // "지금 이 일에 누가 관여하는지" 가 한눈에 보인다 — 1:1 전달로는 두 사람만 보인다.
        let participants = officeChainParticipants(run: run, runs: context.runs).filter(knows)
        if participants.count >= officeMeetingMinimumParticipants {
            return [.meeting(agentTypes: participants, thenWorking: run.agentType)]
        }
        if let parentId = run.parentId,
           let parent = context.runs.first(where: { $0.id == parentId }),
           knows(parent.agentType) {
            return [.handoff(from: parent.agentType, to: run.agentType), .working(agentType: run.agentType)]
        }
        return [.working(agentType: run.agentType)]

    case let .runFinished(run):
        guard let found = agent(run.agentType) else {
            return []
        }
        return [.recolor(agentType: found.agentType, state: found.state), .bubble(agentType: found.agentType, text: found.bubble)]

    case let .approvalOpened(approval):
        guard let agentType = approval.agentType, knows(agentType) else {
            return []
        }
        // 색을 여기서 함께 확정한다. 뒤따라올 state.changed(AWAITING_APPROVAL) 에 기대면
        // 그 이벤트가 누락된 경우 줄에 선 사람만 대기색으로 남는다.
        var intents: [VisualIntent] = [
            .summonToBand(agentType: agentType),
            .recolor(agentType: agentType, state: .awaitingApproval),
        ]
        if let found = agent(agentType) {
            intents.append(.bubble(agentType: agentType, text: found.bubble))
        }
        return intents

    case let .approvalResolved(approval):
        guard let agentType = approval.agentType, knows(agentType) else {
            return []
        }
        return [.returnHome(agentType: agentType)]

    case let .approvalFailed(approval, _):
        guard let agentType = approval.agentType, knows(agentType) else {
            return []
        }
        // 카드가 다시 열린 것과 같은 상태다. `approvalOpened` 와 같은 연출을 주지 않으면
        // 승인 목록에는 카드가 돌아왔는데 오피스에서는 그 사람이 자리로 돌아가 있어, 화면 둘이
        // 서로 다른 말을 한다.
        return [
            .summonToBand(agentType: agentType),
            .recolor(agentType: agentType, state: .awaitingApproval),
        ]

    case let .stateChanged(agentType, state, _):
        guard knows(agentType) else {
            return []
        }
        switch state {
        case .inProgress:
            guard !isAwaitingApproval(agentType) else {
                return []
            }
            return [.working(agentType: agentType)]
        case .awaitingApproval:
            return [.summonToBand(agentType: agentType), .recolor(agentType: agentType, state: state)]
        default:
            return [.recolor(agentType: agentType, state: state)]
        }

    case let .commandRejected(commandId, _):
        guard
            let id = UUID(uuidString: commandId),
            let pending = context.pendingCommands.first(where: { $0.id == id }),
            let agentType = pending.effectiveAgentType,
            knows(agentType)
        else {
            return []
        }
        return [.reject(agentType: agentType)]

    case .sessionOpened, .sessionUpdated, .sessionClosed, .commandInfo, .commandAnswered:
        return []
    }
}
